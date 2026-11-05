// What a card does for a champion, by arithmetic only: the champion's ability numbers and cooldowns from the game files, item stats, and the
// numbers in each augment's text (knowledge/augment-math-*.jsonl). No pick rate or win rate enters here. One fixed fight against one target
// gives damage dealt and effective health, so cards that multiply each other show it without any table of pairs. What the text does that the
// model can't run is named, never filled in from how often it's picked. Never a win chance.

import type { GameItem } from '../texts/gameData.js';
import { calculationsAt, type SpellData } from '../texts/spellValues.js';
import { buildStats, championRecord, statReader, type BuildStats } from './calculator.js';
import { SPELL_HITS } from './cardMathData.js';

type Amount = number | { min: number; max: number };
export interface DamageFormula { flat?: Amount; mana?: number; ap?: number; ad?: number; bonus_ad?: number; hp?: number; bonus_hp?: number; armor?: number; mr?: number; bonus_armor?: number; bonus_mr?: number; target_max_hp?: number; target_missing_hp?: number; target_current_hp?: number }
export type CardOp =
  | { op: 'add'; stat: string; value: Amount; after_quest?: boolean }
  | { op: 'mult'; stat: string; factor: number; scope?: string; after_quest?: boolean }
  | { op: 'damage_amp'; scope: string; factor: number; after_quest?: boolean }
  | { op: 'mana_amp'; scope: string; per100: number; after_quest?: boolean }
  | { op: 'mana_cost'; factor: number; after_quest?: boolean }
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
/** growthProcsPerLevel: procs a game has given an item that grows for good (Heartsteel) by this level: one every 30 s of fighting and a minute of fighting a level, an assumption tried at 0 to 3 a level (knowledge/item-fit-knowledge.md). */
/** gapSeconds: the time between two fights, when mana comes back; an assumption tried at 0, 20 and 40 s on the owner's cases; 40 kept on the owner's word (Ezreal passes, Soraka still fails). */
/** carryCooldowns: the next fight starts gapSeconds after this one ends, with what is still on cooldown (an ultimate cast at the start of a 15 s fight with 90 s of cooldown misses the next), so haste counts there. */
export const FIGHT = { partialLastCast: false, carryCooldowns: false, gapSeconds: 40, growthProcsPerLevel: 2, attackUptime: { melee: 0.8, ranged: 0.7 }, everyDamageStacks: { at18: 200, power: 3.5 }, seconds: 15, target: { armor: 80, mr: 60, hp: 3500 }, killTimes: [5, 10], stacksByLevel: (level: number) => Math.round(level * 1.5) };

/** Very high move speed is slowed: the game's soft caps at 415 and 490. shortcut: from memory, not from a file; check on screen. */
const softSpeed = (x: number) => (x > 490 ? x * 0.5 + 230 : x > 415 ? x * 0.8 + 83 : x);

/** ALLY: the ally an enchanter heals or shields, whom Ardent Censer and Staff of Flowing Water then raise: his damage a second after resists, attacks a second, AP, and the share of his damage from attacks. An assumption, to try on the owner's cases. */
export const ALLY = { dps: 600, attacksPerSecond: 1.2, ap: 300, attackShare: 0.5 };

/** buffsAllies: the kit heals or shields allies (Sona, Lulu, Janna), so items that act on the ally he heals do something. */
export interface Kit { damage: 'magic' | 'physical' | 'mixed'; attacks: boolean; buffsAllies?: boolean }
/** The real enemies when they're known: what their resists do to his damage, and how much of their damage his armor answers rather than his magic resist. */
/** hp: the health a share of the target's health is taken from, when the enemies are known (FIGHT.target.hp otherwise). */
export interface EnemyTeam { armor: number; mr: number; physicalShare: number; hp?: number }
export interface FightResult {
  damage: number;
  /** Damage dealt by the end of each second, so a burst counts even if he dies soon after. */
  damageBySecond: number[];
  fromAbilities: number;
  fromAttacks: number;
  fromCards: number;
  /** Extra damage allies deal from his items' buffs on the ally he heals or shields. */
  fromAllies?: number;
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
  /** The next fight, started with the mana this one left; this same fight when that mana covers it. */
  again?: () => FightResult;
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
/** Tear items and what they turn into: Manamune into Muramana, Archangel's into Seraph's, Winter's Approach into Fimbulwinter. */
const UPGRADES: Record<number, number> = { 3004: 3042, 3003: 3040, 3119: 3121 };
// Off for now (above any level): at 11, Muramana sent Jinx to Trinity and Manamune and Soraka to Dusk and Dawn, owner cases 11 -> 10; the owner decides.
const UPGRADE_LEVEL = 99;
/** Abilities whose hit takes seconds off all his cooldowns, with the field that holds them, each checked against its tooltip: Mystic Shot lowers Ezreal's cooldowns by 1.5 s. */
const REFUND_ON_HIT: Record<string, string> = { 'Characters/Ezreal/Spells/EzrealQAbility/EzrealQ': 'CDRefund' };
const HEALING_NAME = /heal|shield/i;
const NOT_ANY_DAMAGE = /monster|minion|shield|heal|cap|tooltiponly/i;
const HEALTH_SHARE_NAME = /(percent|max|total).*(health|hp)|(health|hp).*(percent|damage)|percent.*damage/i;
const NOT_HEALTH_SHARE = /heal$|healing|shield|cost|decay|monster|minion|cap|missing|tooltip$/i;
const NOT_DAMAGE = /monster|minion|shield|heal|bonus|floor|secondary/i;

function formula(d: DamageFormula, s: BuildStats, level: number, t = FIGHT.target.hp): number {
  return (d.flat === undefined ? 0 : scaled(d.flat, level)) + (d.mana ?? 0) * (s.mana ?? 0) + (d.ap ?? 0) * s.ap + (d.ad ?? 0) * s.ad + (d.bonus_ad ?? 0) * s.bonusAd + (d.hp ?? 0) * s.hp + (d.bonus_hp ?? 0) * s.bonusHp + (d.armor ?? 0) * s.armor + (d.mr ?? 0) * s.mr + (d.bonus_armor ?? 0) * s.bonusArmor + (d.bonus_mr ?? 0) * s.bonusMr + (d.target_max_hp ?? 0) * t + (d.target_missing_hp ?? 0) * (t / 2) + (d.target_current_hp ?? 0) * (t / 2);
}

const STAT_ADD: Record<string, (s: BuildStats, v: number) => void> = {
  ap: (s, v) => { s.ap += v; },
  ad: (s, v) => { s.ad += v; s.bonusAd += v; },
  bonus_ad: (s, v) => { s.ad += v; s.bonusAd += v; },
  hp: (s, v) => { s.hp += v; s.bonusHp += v; },
  mana: (s, v) => { if (s.mana !== undefined) s.mana += v; },
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
const statValue = (s: BuildStats, k: string) => ({ move_speed: s.moveSpeed, ap: s.ap, ad: s.ad, bonus_ad: s.bonusAd, hp: s.hp, bonus_hp: s.bonusHp, armor: s.armor, mr: s.mr, attack_speed: s.bonusAttackSpeed, crit: s.crit, haste: s.haste, mana: s.mana }[k] ?? NaN);

/** One fight, second by second, with these items and cards at this level, so anything that feeds itself shows up. Cards apply in order: flat stats, then conversions, then multipliers; then the fight runs. */
export function fight(o: { bin: Record<string, unknown>; shop: Record<number, GameItem>; kit: Kit; items: number[]; cards: CardNumbers[]; level: number; passive?: CardOp[]; itemOps?: Record<number, CardOp[]>; enemy?: EnemyTeam; ampStack?: 'add'; mana?: number; cooldowns?: Record<string, number> }): FightResult {
  const record = championRecord(o.bin);
  if (!record) throw new Error('no character record');
  // Tear items turn into their finished form; in Mayhem two augment rounds after purchase (their mode records' RoundCount 2): an assumption that a build has them by level 11.
  const held = o.items.map((id) => (o.level >= UPGRADE_LEVEL && UPGRADES[id % 10000] && o.shop[UPGRADES[id % 10000]!] ? UPGRADES[id % 10000]! : id));
  const owned = held.flatMap((id) => o.shop[id] ?? []);
  const s = buildStats(record, owned, o.level);
  // The mode's own stats: melee also gets 15 armor and magic resist (Singed, Nasus on screen); the wiki's ranged resists don't show on screen.
  const melee = ((record as unknown as { attackRangeModifiable?: { baseValue?: number } }).attackRangeModifiable?.baseValue ?? 0) < 300;
  s.hp += 20 + (((melee ? MODE_HEALTH_AT_18.melee : MODE_HEALTH_AT_18.ranged) - 20) * (o.level - 1)) / 17;
  if (melee) { s.armor += MELEE_RESISTS; s.bonusArmor += MELEE_RESISTS; s.mr += MELEE_RESISTS; s.bonusMr += MELEE_RESISTS; }
  const itemAmp = (name: string) => owned.reduce((m, it) => m * (1 + (it.DataValues?.find((d) => d.name === name)?.values?.[0] ?? 0)), 1);
  const healPower = owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'PercentHealingAmountMod')?.values?.[0] ?? 0), 0);
  // What his items do for the ally he heals or shields, from their files: Ardent Censer's attack speed and on-hit, Staff of Flowing Water's AP and haste, each for its seconds; Moonstone Renewer heals a second ally for a share.
  const allyBuffs = o.kit.buffsAllies ? owned.flatMap((it) => {
    const dv = (n: string) => it.DataValues?.find((d) => d.name === n)?.values?.[0] ?? 0;
    if (dv('OnHitMin')) return [{ perSecond: ALLY.dps * ALLY.attackShare * dv('AttackSpeedMin') + dv('OnHitMin') * ALLY.attacksPerSecond, seconds: dv('Duration'), until: -1 }];
    if (dv('AHMod')) return [{ perSecond: ALLY.dps * (1 - ALLY.attackShare) * (dv('APMod') / ALLY.ap + dv('AHMod') / 100), seconds: dv('BuffDuration'), until: -1 }];
    return [];
  }) : [];
  const chainHeal = o.kit.buffsAllies ? owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'ChainHeal')?.values?.[0] ?? 0), 0) : 0;
  const itemMana = owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'FlatMPPoolMod')?.values?.[0] ?? 0), 0);
  const res = (record as unknown as { primaryAbilityResource?: Record<string, { baseValue?: number } | number | string | undefined> }).primaryAbilityResource;
  const resBase = (res?.['{726ee5cd}'] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  const resLevel = (res?.['{6216bf7b}'] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  if ((res?.arType ?? 0) === 0 && resBase > 0) s.mana = resBase + resLevel * (o.level - 1) + itemMana;
  // A finished tear item with no reading of its own gives what its file names: mana into AP or AD, and Shock, a share of mana on attacks and on each ability once in its lockout.
  const fromFile = held.flatMap((id): CardOp[] => {
    if (o.itemOps?.[id % 10000]) return [];
    const dv = (n: string) => o.shop[id]?.DataValues?.find((d) => d.name === n)?.values?.[0] ?? 0;
    const onAbility = dv(melee ? 'AbilityManaRatioMeleeTOOLTIPONLY' : 'AbilityManaRatioRangedTOOLTIPONLY');
    return [
      ...(dv('APFromMana') ? [{ op: 'convert', from: 'mana', to: 'ap', ratio: dv('APFromMana') } as CardOp] : []),
      ...(dv('BonusADManaRatioTOOLTIPONLY') ? [{ op: 'convert', from: 'mana', to: 'bonus_ad', ratio: dv('BonusADManaRatioTOOLTIPONLY') } as CardOp] : []),
      ...(dv('OnHitManaRatioTOOLTIPONLY') ? [{ op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { mana: dv('OnHitManaRatioTOOLTIPONLY') }, type: 'physical' } as CardOp] : []),
      // shortcut: the lockout is per ability in the game, one for all here; per-ability lockouts if Shock champions look short.
      ...(onAbility ? [{ op: 'proc', trigger: 'ability_hit', internal_cooldown: dv('PerCastIDLockout') || null, damage: { mana: onAbility }, type: 'physical' } as CardOp] : []),
    ];
  });
  // An item's effect marked for the other attack type doesn't count, nor a button's buff; a button's damage is pressed when ready.
  // A stat that comes only near death (Overlord's Bloodmail: 12% AD at or below 30% health) isn't held through the fight.
  const applies = (x: CardOp) => { const n = String((x as { needs?: string }).needs ?? ''); const atStacks = /at (\d+) (stacks|glory)/i.exec(n); return !(melee ? /^ranged/ : /^melee/).test(n) && !(/item active|active item/.test(n) && x.op !== 'proc') && !(atStacks && 0.6 * o.level < +atStacks[1]!) && !((x.op === 'mult' || x.op === 'add') && /below \d+% remaining health/i.test(n)); };
  const ops = [...(o.passive ?? []), ...o.cards.flatMap((c) => c.ops).filter(applies), ...held.flatMap((id) => o.itemOps?.[id % 10000] ?? []).filter(applies), ...fromFile].filter((x) => !x.after_quest);
  const notModelled = o.cards.flatMap((c) => (c.not_modelled ? [`${c.name}: ${c.not_modelled}`] : []));
  // Stacks held by this level, read from 23 screen windows with Tank Engine (health order: Heartsteel, then the multiplier, which one reading of Mundo forces): 0.6 a level when deaths take most of them, 2.2 a level of takedowns when they don't. Other stacks are a guess.
  // Stacks from every instance of ability damage grow fast with the game (Phenomenal Evil); fitted to screens.
  const stacksOf = (x: Extract<CardOp, { op: 'per_stack' }>) => { const n = x.per === 'takedown' || x.per === 'kill' ? (x.lost_on_death ? 0.6 : 2.2) * o.level : x.per === 'every_ability_damage' ? FIGHT.everyDamageStacks.at18 * (o.level / 18) ** FIGHT.everyDamageStacks.power : FIGHT.stacksByLevel(o.level); return x.cap ? Math.min(x.cap, n) : n; };
  const add = (t: BuildStats, stat: string, v: number) => { STAT_ADD[stat]?.(t, v); };
  for (const x of ops) if (x.op === 'add') add(s, x.stat, scaled(x.value, o.level));
  for (const x of ops) if (x.op === 'per_stack' && x.mode === 'add') add(s, x.stat, x.value * stacksOf(x));
  // An item whose proc leaves max health for good (Heartsteel: DamageToMaxHealthRatio of 70 + 6% of max health a proc) has grown by this level.
  for (const it of owned) {
    const dv = (n: string) => it.DataValues?.find((d) => d.name === n)?.values?.[0] ?? 0;
    const keep = dv('DamageToMaxHealthRatio');
    if (keep) for (let i = 0; i < Math.round(FIGHT.growthProcsPerLevel * o.level); i++) add(s, 'hp', keep * (dv('BaseDamage') + dv('HPRatio') * s.hp));
  }
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
  // An amp that needs some seconds in champion combat (Riftmaker 4, Liandry's 3) starts then, so a burst window of 3 s mostly misses it.
  const combatSeconds = (x: CardOp) => +(/(\d+(?:\.\d+)?) seconds? in champion combat/i.exec(String((x as { needs?: string }).needs ?? ''))?.[1] ?? 0);
  const amp = (scope: string, t = Infinity) => { const fs = ops.flatMap((x) => (x.op !== 'damage_amp' || t < combatSeconds(x) ? [] : x.scope === 'all' || x.scope === scope || (x.scope === 'magic' && scope === 'abilities' && o.kit.damage !== 'physical') ? [x.factor] : x.scope === 'one_ability' && scope === 'abilities' ? [1 + (x.factor - 1) / 3] : [])); const byMana = ops.reduce((m, x) => (x.op === 'mana_amp' && (x.scope === 'all' || x.scope === scope) && Number.isFinite(fullMana) ? m * (1 + (x.per100 * fullMana) / 100) : m), 1); return byMana * (o.ampStack === 'add' ? 1 + fs.reduce((m, f) => m + f - 1, 0) : fs.reduce((m, f) => m * f, 1)); };
  const cdFactor = (scope: string) => ops.reduce((m, x) => (x.op === 'cooldown' && (x.scope === 'all' || x.scope === scope) ? m * x.factor : m), 1);
  const locked = new Set(ops.flatMap((x) => (x.op === 'lock' ? [x.key] : [])));
  const critExtra = ops.reduce((m, x) => (x.op === 'crit_abilities' ? m + x.extra : m), 0);
  const dotCrit = ops.reduce((m, x) => (x.op === 'crit_dot' ? m + x.extra : m), 0);
  const bin = o.bin as Bin;
  const spellRef = (name: string) => { const tail = `/${name.toLowerCase()}`; return Object.entries(bin).find(([path, v]) => v?.__type === 'SpellObject' && path.toLowerCase().endsWith(tail))?.[1]?.mSpell; };

  // The file names the base and per-level mana only by hash (Karthus: 467 and 31).
  const fullMana = s.mana ?? Infinity;
  const manaCost = ops.reduce((m, x) => (x.op === 'mana_cost' ? m * x.factor : m), 1);
  // Mana a second from the champion's record (base and per level) raised by items' percent of base; flat item regen read as per 5 s, the smaller reading.
  const regenOf = (n: string) => (res?.[n] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  const manaRegen = Number.isFinite(fullMana) ? (regenOf('{c4ab3550}') + regenOf('{3a509002}') * (o.level - 1)) * (1 + owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'PercentBaseMPRegenMod')?.values?.[0] ?? 0), 0)) + owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'FlatMPRegenMod')?.values?.[0] ?? 0), 0) / 5 : 0;
  const startMana = Math.min(fullMana, o.mana ?? Infinity);
  let mana = startMana;

  interface Slot { path: string; key: string; spell: NonNullable<NonNullable<Bin[string]>['mSpell']>; rank: number; ranks: number; cooldown: number; cost: number; perSecond: boolean; overTime: boolean; toggle: boolean; ready: number; on: boolean; recast: boolean; crits: boolean; last?: number; dealt?: number }
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
    // Jinx's Q: she fights in minigun, each attack a stack of attack speed (3 stacks for 2.5 s, 30% to 130% in all by rank), so Q is no cast of its own.
    // shortcut: the rockets' splash and range aren't modelled; upgrade when area damage is (knowledge: area-model).
    const minigun = spell.DataValues?.find((d) => d.name === 'MinigunAttackSpeedMax')?.values?.[rank];
    if (minigun) {
      const value = (name: string, fallback: number) => spell.DataValues?.find((d) => d.name === name)?.values?.[rank] || fallback;
      const n = value('MinigunAttackSpeedStacks', 3);
      ops.push({ op: 'timed', trigger: 'attack', stat: 'attack_speed', value: minigun / 100 / n, mode: 'add', duration: value('MinigunAttackSpeedDuration', 2.5), decays: false, stacks_max: n, refresh: true, internal_cooldown: null });
      return;
    }
    const names = Object.keys(spell.mSpellCalculations ?? {});
    // shortcut: a stated cooldown of a second or less is a toggle (Jinx's Q, Karthus's E); upgrade with a per-champion list if a real spell has one.
    // An ability whose calculation reads crit damage (stat 9) crits like an attack: Yasuo and Yone's Q, Garen's E, Talon's Q, and 40 more.
    const crits = JSON.stringify((spell as { mSpellCalculations?: unknown }).mSpellCalculations ?? {}).includes('"mStat":9');
    slots.push({ crits, path, key, spell, rank, ranks, cooldown: stated || 1, cost: (spell.mana?.[rank - 1] ?? sibling?.mana?.[rank - 1] ?? 0) * manaCost, perSecond: names.some((n) => /dps/i.test(n)), overTime: names.some((n) => /dps|persecond/i.test(n)), toggle: stated > 0 && stated <= 1, ready: o.cooldowns?.[key] ?? 0, on: false, recast: key === 'R' && ops.some((x) => x.op === 'recast' && x.key === 'R') });
  });

  const dt = 0.05;
  const targetHp = o.enemy?.hp ?? FIGHT.target.hp;
  const stateOf = new Map<CardOp, { stacks: number; until: number; start: number }>();
  const dots: { op: Extract<CardOp, { op: 'dot' }>; until: number; stacks: number; fromAbility: boolean }[] = [];
  const lastProc = new Map<CardOp, number>();
  let armed = false, repeatCarry = 0, abilityHealing = 0, fromAbilities = 0, fromAttacks = 0, fromCards = 0, attacks = 0, nextAttack = o.kit.attacks || o.kit.damage !== 'magic' ? 0 : Infinity, nextCast = 0, peakMs = 0, peakAs = 0, critCarry = 0;
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
  let healed = 0, fromAllies = 0;
  const fire = (trigger: string, t: number, c: BuildStats) => {
    const taken = takenBy(c);
    for (const x of ops) {
      if (!('trigger' in x) || (x.trigger !== trigger && !(trigger === 'ability_hit' && (x.trigger === 'spell_hit' || x.trigger === 'burn')))) continue;
      // A card's summoner spell or chosen spell comes once in a fight, whatever the abilities do.
      const icd = x.trigger === 'spell_hit' ? (('internal_cooldown' in x ? x.internal_cooldown : 0) || FIGHT.seconds) : 'internal_cooldown' in x ? (x.internal_cooldown ?? 0) : 0;
      if (icd && t - (lastProc.get(x) ?? -Infinity) < icd) continue;
      if (x.op === 'heal' || x.op === 'shield') { healed += formula(x.amount, c, o.level, targetHp); lastProc.set(x, t); }
      // An extra on-hit on the attack after an ability (Dusk and Dawn), not on every attack.
      if (x.op === 'on_hit_repeat' && trigger === 'next_attack') { for (let k = 0; k < x.extra_hits; k++) fire('on_hit', t, c); lastProc.set(x, t); }
      if (x.op === 'proc') { fromCards += formula(x.damage, c, o.level, targetHp) * (taken[x.type as keyof typeof taken] ?? taken.adaptive) * amp('all', t); lastProc.set(x, t); }
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
  const onHitRepeat = (c: BuildStats) => ops.reduce((n, x) => (x.op === 'on_hit_repeat' && x.trigger !== 'next_attack' ? n + x.extra_hits * (x.trigger === 'crit' ? c.crit : 1) : n), 0);

  for (let t = 0; t < FIGHT.seconds; t += dt) {
    const c = current(t);
    mana = Math.min(fullMana, mana + manaRegen * dt);
    peakMs = Math.max(peakMs, c.moveSpeed);
    peakAs = Math.max(peakAs, c.attackSpeed);
    const taken = takenBy(c);
    while (kills.length && t >= kills[0]!) { kills.shift(); fire('takedown', t, c); fire('kill', t, c); }
    // A mage or support who doesn't fight with attacks makes none (the owner: Ahri, Soraka); a physical non-attacker attacks between casts only, an assumption.
    if (t >= nextAttack) {
      attacks++;
      nextAttack = t + 1 / (c.attackSpeed * (o.kit.attacks ? 1 : o.kit.damage === 'magic' ? 0 : 0.25) * (melee ? FIGHT.attackUptime.melee : FIGHT.attackUptime.ranged));
      fromAttacks += c.ad * (1 + c.crit * (c.critDamage - 1)) * amp('attacks', t) * taken.physical;
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
        const healing = Math.max(0, ...read.filter((v) => HEALING_NAME.test(v.name) && !/monster|minion/i.test(v.name)).map((v) => v.value));
        abilityHealing += healing;
        if (healing > 0) for (const b of allyBuffs) b.until = t + b.seconds;
        const each = (values.length ? Math.max(...values.map((v) => v.value)) : 0) + (chosen.length ? 0 : healthShare * targetHp);
        const one = each * (sl.toggle && sl.perSecond ? 1 : reading?.hits ?? 1); // a damage-per-second toggle already counts its seconds
        // A cast that deals damage over time (Miss Fortune's E: TotalDamagePerSecond for 2 s) is dealt at once here, so a card that crits damage over time crits it here; a toggle's goes through the dots.
        const overTime = sl.overTime && !sl.toggle ? 1 + c.crit * dotCrit : 1;
        const hit = one * amp('abilities', t) * amp(scope, t) * overTime * (1 + c.crit * (critExtra + (sl.crits ? c.critDamage - 1 : 0))); // shortcut: a crit raises the whole hit, not only its AD part
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
          sl.last = t;
          sl.dealt = hit * abilityTaken;
          sl.ready = t + Math.max(0.5, (sl.cooldown * cdFactor(scope) * 100) / (100 + haste(scope)));
          if (sl.recast) { sl.ready = t + CAST_SECONDS; sl.recast = false; }
        }
        const refund = REFUND_ON_HIT[sl.path] && sl.spell.DataValues?.find((v) => v.name === REFUND_ON_HIT[sl.path])?.values?.[sl.rank];
        if (one > 0 && refund) reduce('all', refund, 'seconds', t);
        // The file's flag for an ability that hits as an attack (Ezreal's Q): on-hit effects, and the spellblade an earlier ability armed.
        const asAttack = (sl.spell as { mApplyAttackEffect?: boolean }).mApplyAttackEffect === true;
        if (one > 0 && asAttack && armed) { armed = false; fire('next_attack', t, c); }
        if (one > 0) { fire('ability_hit', t, c); if (asAttack || ops.some((x) => x.op === 'abilities_on_hit')) fire('on_hit', t, c); }
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
      const each = formula(d.op.per_second, c, o.level, targetHp) * dt * d.stacks * (taken[d.op.type as keyof typeof taken] ?? taken.adaptive) * (1 + c.crit * dotCrit);
      if (d.fromAbility) fromAbilities += each;
      else fromCards += each;
    }
    for (const b of allyBuffs) if (t < b.until) fromAllies += b.perSecond * dt;
    if (t + dt >= damageBySecond.length + 1) damageBySecond.push(fromAbilities + fromAttacks + fromCards + fromAllies);
  }
  // Whole casts make a cooldown cut count only when it fits one more in 15 s (25 haste added nothing for 46 champions); the share of the
  // next cast already waited out counts instead, when the mana for it is there. Off: tried 2026-11-04, owner cases 11 of 13 either way, first
  // item changed for 20 of 172, DeepSeek's core items in the first three 268 -> 261, its "never" items 4 -> 2; no proven gain, the owner decides.
  if (FIGHT.partialLastCast) for (const sl of slots) if (sl.dealt && sl.last !== undefined && sl.ready > FIGHT.seconds && mana >= sl.cost) {
    const part = (sl.dealt * (FIGHT.seconds - sl.last)) / (sl.ready - sl.last);
    fromAbilities += part;
    if (damageBySecond.length) damageBySecond[damageBySecond.length - 1]! += part;
  }
  fromCards += healed * ops.reduce((m, x) => (x.op === 'heal_damage' ? m + x.ratio : m), 0) * takenBy(s).magic;
  for (const sl of slots) perCast[sl.key] ??= 0;
  const physical = s.hp * (1 + Math.max(0, s.armor) / 100), magic = s.hp * (1 + Math.max(0, s.mr) / 100);
  const reduction = ops.reduce((m, x) => (x.op === 'add' && x.stat === 'damage_reduction' ? m * (1 - scaled(x.value, o.level)) : m), 1);
  // The next fight starts with what is left plus what comes back between them; it is the same fight while that covers what this one spent.
  const left = mana, next = Math.min(fullMana, left + manaRegen * FIGHT.gapSeconds);
  const short = Number.isFinite(left) && next < startMana - left;
  const waiting = FIGHT.carryCooldowns ? Object.fromEntries(slots.flatMap((sl) => (sl.ready > FIGHT.seconds + FIGHT.gapSeconds ? [[sl.key, sl.ready - FIGHT.seconds - FIGHT.gapSeconds]] : []))) : {};
  const result: FightResult = {
    again: () => (short || Object.keys(waiting).length ? fight({ ...o, mana: short ? next : o.mana, cooldowns: waiting }) : result),
    damage: fromAbilities + fromAttacks + fromCards + fromAllies,
    damageBySecond,
    fromAbilities,
    fromAttacks,
    fromCards,
    fromAllies,
    abilityHealing: abilityHealing * (1 + healPower + chainHeal + ops.reduce((m, x) => (x.op === 'add' && x.stat === 'heal_shield_power' ? m + scaled(x.value, o.level) : x.op === 'mana_amp' && x.scope === 'heal_shield' && Number.isFinite(fullMana) ? m + (x.per100 * fullMana) / 100 : m), 0)),
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
  return result;
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
