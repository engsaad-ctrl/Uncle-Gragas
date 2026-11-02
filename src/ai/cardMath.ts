// What a card does for a champion, by arithmetic only: the champion's ability numbers and cooldowns from the game files, item stats, and the
// numbers in each augment's text (knowledge/augment-math-*.jsonl). No pick rate or win rate enters here. One fixed fight against one target
// gives damage dealt and effective health, so cards that multiply each other show it without any table of pairs. What the text does that the
// model can't run is named, never filled in from how often it's picked. Never a win chance.

import type { GameItem } from '../texts/gameData.js';
import { calculationsAt, type SpellData } from '../texts/spellValues.js';
import { buildStats, championRecord, statReader, type BuildStats } from './calculator.js';
import { SPELL_HITS } from './cardMathData.js';

type Amount = number | { min: number; max: number };
export interface DamageFormula { flat?: Amount; ap?: number; ad?: number; bonus_ad?: number; hp?: number; bonus_hp?: number; armor?: number; mr?: number; bonus_armor?: number; bonus_mr?: number; target_max_hp?: number; target_missing_hp?: number; target_current_hp?: number }
export type CardOp =
  | { op: 'add'; stat: string; value: Amount; after_quest?: boolean }
  | { op: 'mult'; stat: string; factor: number; scope?: string; after_quest?: boolean }
  | { op: 'damage_amp'; scope: string; factor: number; after_quest?: boolean }
  | { op: 'convert'; from: string; to: string; ratio: number; after_quest?: boolean }
  | { op: 'per_stack'; stat: string; value: number; mode: 'add' | 'mult'; per: string; cap?: number | null; lost_on_death?: number | null; after_quest?: boolean }
  | { op: 'lock'; key: string; after_quest?: boolean }
  | { op: 'cooldown'; scope: string; factor: number; after_quest?: boolean }
  | { op: 'refund'; scope: string; amount: Amount; unit: string; trigger: string; internal_cooldown?: number | null; after_quest?: boolean }
  | { op: 'recast'; key: string; internal_cooldown?: number | null; after_quest?: boolean }
  | { op: 'proc'; trigger: string; internal_cooldown?: number | null; damage: DamageFormula; type: string; after_quest?: boolean }
  | { op: 'dot'; per_second: DamageFormula; duration: number; type: string; stacks_max?: number | null; trigger?: string; after_quest?: boolean }
  | { op: 'heal' | 'shield'; amount: DamageFormula; trigger: string; internal_cooldown?: number | null; after_quest?: boolean }
  | { op: 'crit_abilities'; extra: number; after_quest?: boolean }
  | { op: 'crit_dot'; extra: number; after_quest?: boolean }
  | { op: 'heal_damage'; ratio: number; after_quest?: boolean }
  | { op: 'abilities_on_hit'; after_quest?: boolean }
  | { op: 'on_hit_repeat'; extra_hits: number; trigger: string; after_quest?: boolean }
  | { op: 'timed'; trigger: string; stat: string; value: Amount; mode: 'add' | 'percent'; duration: number; decays?: boolean; stacks_max?: number | null; refresh?: boolean; internal_cooldown?: number | null; after_quest?: boolean };

export interface CardNumbers { id: number; name: string; status: string; ops: CardOp[]; needs?: string | null; not_modelled?: string | null }

/** The fixed fight. Assumptions, all visible: changing them changes every card alike, not who is popular. */
/** attackUptime: a real fight has moving and chasing; these best fit the share of a team's damage in stored games. */
export const FIGHT = { attackUptime: { melee: 0.8, ranged: 0.7 }, everyDamageStacks: { at18: 200, power: 3.5 }, seconds: 15, target: { armor: 80, mr: 60, hp: 3500 }, killTimes: [5, 10], stacksByLevel: (level: number) => Math.round(level * 1.5) };

/** Very high move speed is slowed: the game's soft caps at 415 and 490. shortcut: from memory, not from a file; check on screen. */
const softSpeed = (x: number) => (x > 490 ? x * 0.5 + 230 : x > 415 ? x * 0.8 + 83 : x);

export interface Kit { damage: 'magic' | 'physical' | 'mixed'; attacks: boolean }
/** The real enemies when they're known: what their resists do to his damage, and how much of their damage his armor answers rather than his magic resist. */
export interface EnemyTeam { armor: number; mr: number; physicalShare: number }
export interface FightResult {
  damage: number;
  /** Damage dealt by the end of each second, so a burst counts even if he dies soon after. */
  damageBySecond: number[];
  fromAbilities: number;
  fromAttacks: number;
  fromCards: number;
  effectiveHp: number;
  /** Healing and shields he gives himself in the fight, as effective health: vamp, and what cards and items say. */
  healedHp: number;
  /** Healing and shields his abilities give, on whoever they reach, with heal power: the files don't say whom. */
  abilityHealing: number;
  attacks: number;
  peakMoveSpeed: number;
  peakAttackSpeed: number;
  casts: Record<string, number>;
  /** Each ability's damage on one cast, before resists. */
  perCast: Record<string, number>;
  stats: Pick<BuildStats, 'ad' | 'ap' | 'hp' | 'armor' | 'mr' | 'attackSpeed' | 'crit' | 'haste'>;
  notModelled: string[];
}

type Bin = Record<string, { __type?: string; mSpell?: SpellData & { cooldownTime?: number[]; Cooldown?: number; mClientData?: { mTooltipData?: { mLists?: { LevelUp?: { levelCount?: number } } } } } } | undefined>;
const scaled = (a: Amount, level: number) => (typeof a === 'number' ? a : a.min + ((a.max - a.min) * (Math.min(level, 18) - 1)) / 17);
const CAST_SECONDS = 0.75;
const NO_COOLDOWN_IN_FILE = 10; // shortcut: Morgana Q, Milio Q and a few have none in any record; a typical basic ability
/** The mode's extra base health, 20 at level 1 to this at 18 (Kimi, from the wiki); see the screen check. */
const MODE_HEALTH_AT_18 = { melee: 600, ranged: 400 };
const ATTACK_SPEED_CAP = 5; // Mayhem's cap (Kimi); screens show 2.81, past the usual 2.5.
const MELEE_RESISTS = 15;
const DAMAGE_NAME = /damage|dmg|dps/i;
const HEALING_NAME = /heal|shield/i;
const NOT_ANY_DAMAGE = /monster|minion|shield|heal|cap|tooltiponly/i;
const HEALTH_SHARE_NAME = /(percent|max|total).*(health|hp)|(health|hp).*(percent|damage)|percent.*damage/i;
const NOT_HEALTH_SHARE = /heal$|healing|shield|cost|decay|monster|minion|cap|missing|tooltip$/i;
const NOT_DAMAGE = /monster|minion|shield|heal|bonus|floor|secondary/i;

function formula(d: DamageFormula, s: BuildStats, level: number): number {
  const t = FIGHT.target.hp;
  return (d.flat === undefined ? 0 : scaled(d.flat, level)) + (d.ap ?? 0) * s.ap + (d.ad ?? 0) * s.ad + (d.bonus_ad ?? 0) * s.bonusAd + (d.hp ?? 0) * s.hp + (d.bonus_hp ?? 0) * s.bonusHp + (d.armor ?? 0) * s.armor + (d.mr ?? 0) * s.mr + (d.bonus_armor ?? 0) * s.bonusArmor + (d.bonus_mr ?? 0) * s.bonusMr + (d.target_max_hp ?? 0) * t + (d.target_missing_hp ?? 0) * (t / 2) + (d.target_current_hp ?? 0) * (t / 2);
}

const STAT_ADD: Record<string, (s: BuildStats, v: number) => void> = {
  ap: (s, v) => { s.ap += v; },
  ad: (s, v) => { s.ad += v; s.bonusAd += v; },
  bonus_ad: (s, v) => { s.ad += v; s.bonusAd += v; },
  hp: (s, v) => { s.hp += v; s.bonusHp += v; },
  armor: (s, v) => { s.armor += v; s.bonusArmor += v; },
  mr: (s, v) => { s.mr += v; s.bonusMr += v; },
  attack_speed: (s, v) => { s.bonusAttackSpeed += v; },
  crit: (s, v) => { s.crit = Math.min(1, s.crit + v); },
  crit_damage: (s, v) => { s.critDamage += v; },
  haste: (s, v) => { s.haste += v; },
  lethality: (s, v) => { s.lethality += v; },
  armor_pen: (s, v) => { s.armorPenPercent = Math.min(1, s.armorPenPercent + v); },
  magic_pen: (s, v) => { s.magicPenPercent = Math.min(1, s.magicPenPercent + v); },
  omnivamp: (s, v) => { s.omnivamp += v; },
  life_steal: (s, v) => { s.lifeSteal += v; },
  move_speed: (s, v) => { s.moveSpeed += v; },
};
const statValue = (s: BuildStats, k: string) => ({ move_speed: s.moveSpeed, ap: s.ap, ad: s.ad, bonus_ad: s.bonusAd, hp: s.hp, bonus_hp: s.bonusHp, armor: s.armor, mr: s.mr, attack_speed: s.bonusAttackSpeed, crit: s.crit, haste: s.haste }[k] ?? NaN);

/** One fight, second by second, with these items and cards at this level, so anything that feeds itself shows up. Cards apply in order: flat stats, then conversions, then multipliers; then the fight runs. */
export function fight(o: { bin: Record<string, unknown>; shop: Record<number, GameItem>; kit: Kit; items: number[]; cards: CardNumbers[]; level: number; passive?: CardOp[]; itemOps?: Record<number, CardOp[]>; enemy?: EnemyTeam }): FightResult {
  const record = championRecord(o.bin);
  if (!record) throw new Error('no character record');
  const owned = o.items.flatMap((id) => o.shop[id] ?? []);
  const s = buildStats(record, owned, o.level);
  // The mode's own stats: melee also gets 15 armor and magic resist (Singed, Nasus on screen); the wiki's ranged resists don't show on screen.
  const melee = ((record as unknown as { attackRangeModifiable?: { baseValue?: number } }).attackRangeModifiable?.baseValue ?? 0) < 300;
  s.hp += 20 + (((melee ? MODE_HEALTH_AT_18.melee : MODE_HEALTH_AT_18.ranged) - 20) * (o.level - 1)) / 17;
  if (melee) { s.armor += MELEE_RESISTS; s.bonusArmor += MELEE_RESISTS; s.mr += MELEE_RESISTS; s.bonusMr += MELEE_RESISTS; }
  const itemAmp = (name: string) => owned.reduce((m, it) => m * (1 + (it.DataValues?.find((d) => d.name === name)?.values?.[0] ?? 0)), 1);
  const healPower = owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'PercentHealingAmountMod')?.values?.[0] ?? 0), 0);
  const itemMana = owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'FlatMPPoolMod')?.values?.[0] ?? 0), 0);
  // An item's effect marked for the other attack type doesn't count, nor a button's buff; a button's damage is pressed when ready.
  const applies = (x: CardOp) => { const n = String((x as { needs?: string }).needs ?? ''); const atStacks = /at (\d+) (stacks|glory)/i.exec(n); return !(melee ? /^ranged/ : /^melee/).test(n) && !(/item active|active item/.test(n) && x.op !== 'proc') && !(atStacks && 0.6 * o.level < +atStacks[1]!); };
  const ops = [...(o.passive ?? []), ...o.cards.flatMap((c) => c.ops).filter(applies), ...o.items.flatMap((id) => o.itemOps?.[id % 10000] ?? []).filter(applies)].filter((x) => !x.after_quest);
  const notModelled = o.cards.flatMap((c) => (c.not_modelled ? [`${c.name}: ${c.not_modelled}`] : []));
  // Stacks held by this level, read from 23 screen windows with Tank Engine (health order: Heartsteel, then the multiplier, which one reading of Mundo forces): 0.6 a level when deaths take most of them, 2.2 a level of takedowns when they don't. Other stacks are a guess.
  // Stacks from every instance of ability damage grow fast with the game (Phenomenal Evil); fitted to screens.
  const stacksOf = (x: Extract<CardOp, { op: 'per_stack' }>) => { const n = x.per === 'takedown' || x.per === 'kill' ? (x.lost_on_death ? 0.6 : 2.2) * o.level : x.per === 'every_ability_damage' ? FIGHT.everyDamageStacks.at18 * (o.level / 18) ** FIGHT.everyDamageStacks.power : FIGHT.stacksByLevel(o.level); return x.cap ? Math.min(x.cap, n) : n; };
  const add = (t: BuildStats, stat: string, v: number) => { STAT_ADD[stat]?.(t, v); };
  for (const x of ops) if (x.op === 'add') add(s, x.stat, scaled(x.value, o.level));
  for (const x of ops) if (x.op === 'per_stack' && x.mode === 'add') add(s, x.stat, x.value * stacksOf(x));
  for (const x of ops) if (x.op === 'convert' && x.from !== 'move_speed') { const from = statValue(s, x.from); if (!Number.isNaN(from)) add(s, x.to, from * x.ratio); }
  const multiply = (t: BuildStats, stat: string, factor: number) => {
    if (stat === 'ap') t.ap *= factor;
    if (stat === 'ad') { t.bonusAd += t.ad * (factor - 1); t.ad *= factor; }
    if (stat === 'bonus_ad') { t.ad += t.bonusAd * (factor - 1); t.bonusAd *= factor; }
    if (stat === 'hp') { t.bonusHp += t.hp * (factor - 1); t.hp *= factor; }
    if (stat === 'armor') t.armor *= factor;
    if (stat === 'mr') t.mr *= factor;
    if (stat === 'attack_speed') t.bonusAttackSpeed *= factor;
    if (stat === 'move_speed') t.moveSpeed *= factor;
  };
  multiply(s, 'ap', itemAmp('APAmp'));
  multiply(s, 'hp', itemAmp('HPAmp'));
  for (const x of ops) if (x.op === 'mult') { if (x.stat === 'hp' && x.scope === 'bonus') { s.hp += s.bonusHp * (x.factor - 1); s.bonusHp *= x.factor; } else multiply(s, x.stat, x.factor); }
  for (const x of ops) if (x.op === 'per_stack' && x.mode === 'mult') multiply(s, x.stat, 1 + (x.value >= 1 ? x.value - 1 : x.value) * stacksOf(x)); // readers wrote +5% a stack as 1.05 or 0.05
  const baseRates = record as unknown as { attackSpeedModifiable?: { baseValue?: number }; attackSpeedRatioModifiable?: { baseValue?: number } };
  const as0 = baseRates.attackSpeedModifiable?.baseValue ?? 0.625;
  const asRatio = baseRates.attackSpeedRatioModifiable?.baseValue || as0;
  // An amp for magic damage reaches a champion's abilities unless the kit deals only physical.
  // An amp on one chosen ability counts for one of the three basic ones.
  const amp = (scope: string) => ops.reduce((m, x) => (x.op !== 'damage_amp' ? m : x.scope === 'all' || x.scope === scope || (x.scope === 'magic' && scope === 'abilities' && o.kit.damage !== 'physical') ? m * x.factor : x.scope === 'one_ability' && scope === 'abilities' ? m * (1 + (x.factor - 1) / 3) : m), 1);
  const cdFactor = (scope: string) => ops.reduce((m, x) => (x.op === 'cooldown' && (x.scope === 'all' || x.scope === scope) ? m * x.factor : m), 1);
  const locked = new Set(ops.flatMap((x) => (x.op === 'lock' ? [x.key] : [])));
  const critExtra = ops.reduce((m, x) => (x.op === 'crit_abilities' ? m + x.extra : m), 0);
  const dotCrit = ops.reduce((m, x) => (x.op === 'crit_dot' ? m + x.extra : m), 0);
  const bin = o.bin as Bin;
  const spellRef = (name: string) => { const tail = `/${name.toLowerCase()}`; return Object.entries(bin).find(([path, v]) => v?.__type === 'SpellObject' && path.toLowerCase().endsWith(tail))?.[1]?.mSpell; };

  // The file names the base and per-level mana only by hash (Karthus: 467 and 31).
  const res = (record as unknown as { primaryAbilityResource?: Record<string, { baseValue?: number } | number | string | undefined> }).primaryAbilityResource;
  const resBase = (res?.['{726ee5cd}'] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  const resLevel = (res?.['{6216bf7b}'] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  let mana = (res?.arType ?? 0) === 0 && resBase > 0 ? resBase + resLevel * (o.level - 1) + itemMana : Infinity;

  interface Slot { path: string; key: string; spell: NonNullable<NonNullable<Bin[string]>['mSpell']>; rank: number; ranks: number; cooldown: number; cost: number; perSecond: boolean; toggle: boolean; ready: number; on: boolean; recast: boolean }
  const slots: Slot[] = [];
  (['R', 'Q', 'W', 'E'] as const).forEach((key) => {
    const path = record.spells?.['QWER'.indexOf(key)] ?? '';
    const spell = bin[path]?.mSpell;
    if (!spell || locked.has(key)) return;
    const ranks = spell.mClientData?.mTooltipData?.mLists?.LevelUp?.levelCount ?? (key === 'R' ? 3 : 5);
    const rank = Math.max(1, key === 'R' ? Math.min(ranks, Math.floor((o.level + 2) / 5)) : Math.min(ranks, Math.ceil(o.level / 3)));
    // Some abilities keep their numbers in a sibling record of the same folder (Lux Q in LuxLightBindingMis), or name a base cooldown (Veigar W).
    const folder = path.slice(0, path.lastIndexOf('/') + 1);
    const sibling = folder ? Object.entries(bin).find(([p, v]) => p !== path && p.startsWith(folder) && (v?.mSpell?.cooldownTime?.[rank] ?? 0) > 1)?.[1]?.mSpell : undefined;
    const stated = spell.cooldownTime?.[rank] || sibling?.cooldownTime?.[rank] || spell.DataValues?.find((d) => d.name === 'BaseCooldown')?.values?.[rank] || (spell.cooldownTime ? 0 : NO_COOLDOWN_IN_FILE);
    const names = Object.keys(spell.mSpellCalculations ?? {});
    // shortcut: a stated cooldown of a second or less is a toggle (Jinx's Q, Karthus's E); upgrade with a per-champion list if a real spell has one.
    slots.push({ path, key, spell, rank, ranks, cooldown: stated || 1, cost: spell.mana?.[rank - 1] ?? sibling?.mana?.[rank - 1] ?? 0, perSecond: names.some((n) => /dps/i.test(n)), toggle: stated > 0 && stated <= 1, ready: 0, on: false, recast: key === 'R' && ops.some((x) => x.op === 'recast' && x.key === 'R') });
  });

  const dt = 0.05;
  const stateOf = new Map<CardOp, { stacks: number; until: number; start: number }>();
  const dots: { op: Extract<CardOp, { op: 'dot' }>; until: number; stacks: number; fromAbility: boolean }[] = [];
  const lastProc = new Map<CardOp, number>();
  let armed = false, repeatCarry = 0, abilityHealing = 0, fromAbilities = 0, fromAttacks = 0, fromCards = 0, attacks = 0, nextAttack = 0, nextCast = 0, peakMs = 0, peakAs = 0, critCarry = 0;
  const casts: Record<string, number> = {}, perCast: Record<string, number> = {};
  const kills = [...FIGHT.killTimes];
  const damageBySecond: number[] = [];
  const current = (t: number) => {
    const c: BuildStats = { ...s };
    let flatMs = 0, pctMs = 0;
    for (const [x, st] of stateOf) {
      if (x.op !== 'timed' || t > st.until) continue;
      const fade = x.decays && x.duration ? Math.max(0, 1 - (t - st.start) / x.duration) : 1;
      const v = scaled(x.value, o.level) * st.stacks * fade;
      if (x.stat === 'move_speed') { if (x.mode === 'percent') pctMs += v; else flatMs += v; }
      else if (x.mode === 'percent' && x.stat !== 'attack_speed') multiply(c, x.stat, 1 + v);
      else add(c, x.stat, v);
    }
    const ms = softSpeed((c.moveSpeed + flatMs) * (1 + pctMs));
    for (const x of ops) if (x.op === 'convert' && x.from === 'move_speed') add(c, x.to, ms * x.ratio);
    c.attackSpeed = Math.min(ATTACK_SPEED_CAP, as0 + asRatio * c.bonusAttackSpeed);
    c.moveSpeed = ms;
    return c;
  };
  const takenBy = (c: BuildStats) => {
    const armor = Math.max(0, (o.enemy?.armor ?? FIGHT.target.armor) * (1 - c.armorPenPercent) - c.lethality), mr = Math.max(0, (o.enemy?.mr ?? FIGHT.target.mr) * (1 - c.magicPenPercent) - c.magicPen);
    return { physical: 100 / (100 + armor), magic: 100 / (100 + mr), true: 1, adaptive: c.ap > c.bonusAd ? 100 / (100 + mr) : 100 / (100 + armor) };
  };
  const reduce = (scope: string, amount: Amount, unit: string, t: number) => {
    for (const sl of slots) {
      if (scope !== 'all' && scope !== 'one_ability' && (scope === 'ult') !== (sl.key === 'R')) continue;
      const left = sl.ready - t;
      if (left > 0) sl.ready -= unit === 'fraction' ? left * Math.min(1, scaled(amount, o.level)) : scaled(amount, o.level);
    }
  };
  let healed = 0;
  const fire = (trigger: string, t: number, c: BuildStats) => {
    const taken = takenBy(c);
    for (const x of ops) {
      if (!('trigger' in x) || (x.trigger !== trigger && !(trigger === 'ability_hit' && (x.trigger === 'spell_hit' || x.trigger === 'burn')))) continue;
      // A card's summoner spell or chosen spell comes once in a fight, whatever the abilities do.
      const icd = x.trigger === 'spell_hit' ? (('internal_cooldown' in x ? x.internal_cooldown : 0) || FIGHT.seconds) : 'internal_cooldown' in x ? (x.internal_cooldown ?? 0) : 0;
      if (icd && t - (lastProc.get(x) ?? -Infinity) < icd) continue;
      if (x.op === 'heal' || x.op === 'shield') { healed += formula(x.amount, c, o.level); lastProc.set(x, t); }
      if (x.op === 'proc') { fromCards += formula(x.damage, c, o.level) * (taken[x.type as keyof typeof taken] ?? taken.adaptive) * amp('all'); lastProc.set(x, t); }
      if (x.op === 'refund') { reduce(x.scope, x.amount, x.unit, t); lastProc.set(x, t); }
      if (x.op === 'dot') { const d = dots.find((y) => y.op === x); if (d) { d.until = t + (x.duration ?? FIGHT.seconds); d.stacks = Math.min(x.stacks_max ?? 1, d.stacks + 1); } else dots.push({ op: x, until: t + (x.duration ?? FIGHT.seconds), stacks: 1, fromAbility: false }); }
      if (x.op === 'timed') {
        const st = stateOf.get(x);
        const live = st && t <= st.until;
        if (live && !x.refresh && (x.stacks_max ?? 1) <= 1) continue;
        stateOf.set(x, { stacks: live ? Math.min(x.stacks_max ?? Infinity, st.stacks + 1) : 1, until: t + (x.duration ?? FIGHT.seconds), start: t }); // a card that names no end lasts the fight
        lastProc.set(x, t);
      }
    }
  };
  for (const x of ops) if (x.op === 'timed' && x.trigger === 'always') stateOf.set(x, { stacks: 1, until: Infinity, start: 0 });
  const onHitRepeat = (c: BuildStats) => ops.reduce((n, x) => (x.op === 'on_hit_repeat' ? n + x.extra_hits * (x.trigger === 'crit' ? c.crit : 1) : n), 0);

  for (let t = 0; t < FIGHT.seconds; t += dt) {
    const c = current(t);
    peakMs = Math.max(peakMs, c.moveSpeed);
    peakAs = Math.max(peakAs, c.attackSpeed);
    const taken = takenBy(c);
    while (kills.length && t >= kills[0]!) { kills.shift(); fire('takedown', t, c); fire('kill', t, c); }
    // Non-attackers attack between casts only: an assumption, the same for every card.
    if (t >= nextAttack) {
      attacks++;
      nextAttack = t + 1 / (c.attackSpeed * (o.kit.attacks ? 1 : 0.25) * (melee ? FIGHT.attackUptime.melee : FIGHT.attackUptime.ranged));
      fromAttacks += c.ad * (1 + c.crit * (c.critDamage - 1)) * amp('attacks') * taken.physical;
      repeatCarry += onHitRepeat(c);
      fire('on_hit', t, c);
      for (; repeatCarry >= 1; repeatCarry--) fire('on_hit', t, c); // a share of attacks hits twice
      fire('attack', t, c);
      if (armed) { armed = false; fire('next_attack', t, c); } // an attack after an ability: it comes no faster than his attacks
      critCarry += c.crit;
      if (critCarry >= 1) { critCarry -= 1; fire('crit', t, c); }
    }
    if (t >= nextCast) {
      const haste = (scope: string) => c.haste + ops.reduce((n, x) => (x.op === 'add' && x.stat === `${scope}_haste` ? n + scaled(x.value, o.level) : n), 0);
      for (const sl of slots) {
        if (t < sl.ready || sl.on || mana < sl.cost) continue;
        const scope = sl.key === 'R' ? 'ult' : 'basic';
        const read = calculationsAt(sl.spell, { ranks: sl.ranks, rank: sl.rank, level: o.level, statOf: statReader(c), spellRef });
        const named = read.filter((v) => DAMAGE_NAME.test(v.name) && !NOT_DAMAGE.test(v.name));
        // A spell whose only damage is named as bonus or secondary still deals it; a share of the target's health counts on the target.
        const reading = SPELL_HITS[sl.path];
        const chosen = reading?.calc ? read.filter((v) => v.name === reading.calc) : [];
        const values = chosen.length ? chosen : named.length ? named : read.filter((v) => DAMAGE_NAME.test(v.name) && !NOT_ANY_DAMAGE.test(v.name));
        const healthShare = Math.max(0, ...read.filter((v) => HEALTH_SHARE_NAME.test(v.name) && !NOT_HEALTH_SHARE.test(v.name)).map((v) => (v.value <= 1 ? v.value : v.value <= 100 ? v.value / 100 : 0)));
        abilityHealing += Math.max(0, ...read.filter((v) => HEALING_NAME.test(v.name) && !/monster|minion/i.test(v.name)).map((v) => v.value));
        const each = (values.length ? Math.max(...values.map((v) => v.value)) : 0) + (chosen.length ? 0 : healthShare * FIGHT.target.hp);
        const one = each * (sl.toggle && sl.perSecond ? 1 : reading?.hits ?? 1); // a damage-per-second toggle already counts its seconds
        const hit = one * amp('abilities') * amp(scope) * (1 + c.crit * critExtra);
        perCast[sl.key] = Math.round(hit);
        casts[sl.key] = (casts[sl.key] ?? 0) + 1;
        const abilityTaken = o.kit.damage === 'physical' ? taken.physical : o.kit.damage === 'magic' ? taken.magic : (taken.physical + taken.magic) / 2;
        mana -= sl.cost;
        if (sl.toggle) {
          sl.on = true;
          if (sl.perSecond) dots.push({ op: { op: 'dot', per_second: { flat: hit }, duration: FIGHT.seconds, type: o.kit.damage === 'physical' ? 'physical' : 'magic' }, until: FIGHT.seconds, stacks: 1, fromAbility: true });
          else fromAbilities += hit * abilityTaken;
        } else {
          fromAbilities += hit * abilityTaken;
          sl.ready = t + Math.max(0.5, (sl.cooldown * cdFactor(scope) * 100) / (100 + haste(scope)));
          if (sl.recast) { sl.ready = t + CAST_SECONDS; sl.recast = false; }
        }
        if (one > 0) { fire('ability_hit', t, c); if (ops.some((x) => x.op === 'abilities_on_hit')) fire('on_hit', t, c); }
        armed = true;
        fire('ability_cast', t, c);
        if (sl.key === 'R') fire('ult_cast', t, c);
        nextCast = t + CAST_SECONDS;
        break;
      }
    }
    for (const x of ops) if ((x.op === 'proc' || x.op === 'heal' || x.op === 'shield') && x.trigger === 'periodic' && t - (lastProc.get(x) ?? -Infinity) >= (x.internal_cooldown || FIGHT.seconds)) fire('periodic', t, c);
    for (const d of dots) {
      if (t > d.until) continue;
      const each = formula(d.op.per_second, c, o.level) * dt * d.stacks * (taken[d.op.type as keyof typeof taken] ?? taken.adaptive) * (1 + c.crit * dotCrit);
      if (d.fromAbility) fromAbilities += each;
      else fromCards += each;
    }
    if (t + dt >= damageBySecond.length + 1) damageBySecond.push(fromAbilities + fromAttacks + fromCards);
  }
  fromCards += healed * ops.reduce((m, x) => (x.op === 'heal_damage' ? m + x.ratio : m), 0) * takenBy(s).magic;
  for (const sl of slots) perCast[sl.key] ??= 0;
  const physical = s.hp * (1 + Math.max(0, s.armor) / 100), magic = s.hp * (1 + Math.max(0, s.mr) / 100);
  const reduction = ops.reduce((m, x) => (x.op === 'add' && x.stat === 'damage_reduction' ? m * (1 - scaled(x.value, o.level)) : m), 1);
  return {
    damage: fromAbilities + fromAttacks + fromCards,
    damageBySecond,
    fromAbilities,
    fromAttacks,
    fromCards,
    abilityHealing: abilityHealing * (1 + healPower + ops.reduce((m, x) => (x.op === 'add' && x.stat === 'heal_shield_power' ? m + scaled(x.value, o.level) : m), 0)),
    healedHp: Math.max(0, healed + s.omnivamp * (fromAbilities + fromAttacks + fromCards) + s.lifeSteal * fromAttacks) * ((o.enemy ? 1 / (o.enemy.physicalShare / physical + (1 - o.enemy.physicalShare) / magic) : (physical + magic) / 2) / s.hp),
    effectiveHp: (o.enemy ? 1 / (o.enemy.physicalShare / physical + (1 - o.enemy.physicalShare) / magic) : (physical + magic) / 2) / reduction,
    attacks,
    peakMoveSpeed: Math.round(peakMs),
    peakAttackSpeed: Math.round(peakAs * 100) / 100,
    casts,
    perCast,
    stats: { ad: s.ad, ap: s.ap, hp: s.hp, armor: s.armor, mr: s.mr, attackSpeed: Math.min(ATTACK_SPEED_CAP, as0 + asRatio * s.bonusAttackSpeed), crit: s.crit, haste: s.haste },
    notModelled,
  };
}

/** Whether a card's condition holds for this champion and build. "unknown": the card keeps its number but can't be ranked as certain. */
export type CardNeed = { class: string; items?: string[] | null; ability_kind?: string | null };
export function needHolds(need: CardNeed | undefined, o: { owned: string[]; ranged: boolean; traits: string[] }): 'yes' | 'no' | 'unknown' {
  if (!need) return 'yes';
  switch (need.class) {
    case 'always': case 'window': case 'chosen_ability': case 'summoner': return 'yes';
    case 'item': return (need.items ?? []).some((n) => o.owned.includes(n)) ? 'yes' : 'no';
    case 'melee': return o.ranged ? 'no' : 'yes';
    case 'ranged': return o.ranged ? 'yes' : 'no';
    case 'ability_kind': return o.traits.includes(need.ability_kind ?? '') ? 'yes' : 'unknown';
    default: return 'unknown';
  }
}

/** What a card adds, given what's already held: the difference it makes in the same fight. */
export function cardGain(o: Parameters<typeof fight>[0], card: CardNumbers): { damage: number; effectiveHp: number; before: FightResult; after: FightResult } {
  const before = fight(o), after = fight({ ...o, cards: [...o.cards, card] });
  return { damage: before.damage ? after.damage / before.damage - 1 : 0, effectiveHp: before.effectiveHp ? after.effectiveHp / before.effectiveHp - 1 : 0, before, after };
}
