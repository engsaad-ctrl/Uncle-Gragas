// Damage calculator for the AI build advisor: a build's stats and its abilities' numbers, read from the game files.
// Item and augment passives are not in the stat fields; the model reads them from the texts and hands them over as
// effects (an AP multiplier, on-hit damage, a burn, an attack speed cap), and the arithmetic happens here.

import { z } from 'zod';
import type { GameItem } from '../texts/gameData.js';
import { calculationsAt, type SpellData, type StatOf } from '../texts/spellValues.js';

type Mod = { baseValue?: number } | undefined;
interface CharacterRecord {
  __type: 'CharacterRecord';
  spells?: string[];
  baseHPModifiable?: Mod;
  hpPerLevelModifiable?: Mod;
  baseDamageModifiable?: Mod;
  damagePerLevelModifiable?: Mod;
  baseArmorModifiable?: Mod;
  armorPerLevelModifiable?: Mod;
  baseMR?: Mod;
  mrPerLevel?: Mod;
  baseMoveSpeedModifiable?: Mod;
  attackRangeModifiable?: Mod;
  attackSpeedModifiable?: Mod;
  attackSpeedRatioModifiable?: Mod;
  attackSpeedPerLevelModifiable?: Mod;
}
type BinSpell = SpellData & { mClientData?: { mTooltipData?: { mLists?: { LevelUp?: { levelCount?: number } } } } };
type Bin = Record<string, { __type?: string; mSpell?: BinSpell } | undefined>;

export interface BuildStats {
  ad: number;
  bonusAd: number;
  ap: number;
  attackSpeed: number;
  bonusAttackSpeed: number;
  crit: number;
  critDamage: number;
  hp: number;
  bonusHp: number;
  armor: number;
  bonusArmor: number;
  mr: number;
  bonusMr: number;
  haste: number;
  lethality: number;
  armorPenPercent: number;
  magicPen: number;
  magicPenPercent: number;
  lifeSteal: number;
  omnivamp: number;
  moveSpeed: number;
  range: number;
}

const val = (m: Mod) => m?.baseValue ?? 0;
/** Riot's per-level growth: level 1 is the base, level 18 adds 17 × the per-level value. */
const grown = (base: number, per: number, level: number) => base + per * (level - 1) * (0.7025 + 0.0175 * (level - 1));

export function championRecord(bin: Record<string, unknown>): CharacterRecord | undefined {
  return Object.values(bin as Bin).find((v) => v?.__type === 'CharacterRecord') as CharacterRecord | undefined;
}

/** `attackSpeedCap` null: no cap (an augment can lift the usual 2.5). */
export function buildStats(record: CharacterRecord, items: GameItem[], level: number, attackSpeedCap: number | null = 2.5): BuildStats {
  const sum = (name: string) => items.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === name)?.values?.[0] ?? 0), 0);
  const baseAd = grown(val(record.baseDamageModifiable), val(record.damagePerLevelModifiable), level);
  const baseHp = grown(val(record.baseHPModifiable), val(record.hpPerLevelModifiable), level);
  const baseArmor = grown(val(record.baseArmorModifiable), val(record.armorPerLevelModifiable), level);
  const baseMr = grown(val(record.baseMR), val(record.mrPerLevel), level);
  const bonusAttackSpeed = grown(0, val(record.attackSpeedPerLevelModifiable), level) / 100 + sum('PercentAttackSpeedMod');
  const baseAs = val(record.attackSpeedModifiable);
  const bonusAd = sum('FlatPhysicalDamageMod');
  const bonusHp = sum('FlatHPPoolMod');
  const bonusArmor = sum('FlatArmorMod');
  const bonusMr = sum('FlatSpellBlockMod');
  return {
    ad: baseAd + bonusAd,
    bonusAd,
    ap: sum('FlatMagicDamageMod'),
    attackSpeed: Math.min(attackSpeedCap ?? Infinity, baseAs + (val(record.attackSpeedRatioModifiable) || baseAs) * bonusAttackSpeed),
    bonusAttackSpeed,
    crit: Math.min(1, sum('FlatCritChanceMod')),
    critDamage: 1.75 + sum('FlatCritDamageMod'),
    hp: baseHp + bonusHp,
    bonusHp,
    armor: baseArmor + bonusArmor,
    bonusArmor,
    mr: baseMr + bonusMr,
    bonusMr,
    haste: sum('AbilityHasteMod'),
    lethality: sum('PhysicalLethality'),
    armorPenPercent: Math.min(1, sum('PercentArmorPenetrationMod')),
    magicPen: sum('FlatMagicPenetrationMod'),
    magicPenPercent: Math.min(1, sum('PercentMagicPenetrationMod')),
    lifeSteal: sum('PercentLifeStealMod'),
    omnivamp: sum('PercentOmnivampMod'),
    // shortcut: no movement speed soft caps; only shown to the model, never compared.
    moveSpeed: (val(record.baseMoveSpeedModifiable) + sum('FlatMovementSpeedMod')) * (1 + sum('PercentMovementSpeedMod')),
    range: val(record.attackRangeModifiable) + sum('FlatAttackRangeMod'),
  };
}

/** The value a spell ratio reads: the game's stat tag, and " أساسي"/" إضافي" for base or bonus. */
export function statReader(s: BuildStats): StatOf {
  return (tag, suffix) => {
    const part = suffix?.includes('إضافي') ? 'bonus' : suffix?.includes('أساسي') ? 'base' : 'total';
    const pick = (total: number, bonus: number) => (part === 'bonus' ? bonus : part === 'base' ? total - bonus : total);
    switch (tag) {
      case 'scaleAP': return s.ap;
      case 'scaleAD': return pick(s.ad, s.bonusAd);
      case 'scaleHealth': return pick(s.hp, s.bonusHp);
      case 'scaleArmor': return pick(s.armor, s.bonusArmor);
      case 'scaleMR': return pick(s.mr, s.bonusMr);
      case 'scaleAS': return part === 'total' ? s.attackSpeed : s.bonusAttackSpeed;
      case 'scaleCrit': return s.crit;
      case 'scaleCritMult': return s.critDamage;
      case 'scaleAPen': return s.lethality;
      case 'scaleMS': return s.moveSpeed;
      case 'scaleRange': return s.range;
      default: return NaN; // mana and the rest are not tracked: calculationsAt marks the value partial
    }
  };
}

// shortcut: damage calculations are found by name; one stored under a hashed or odd name is left out.
const DAMAGE = /damage|dmg|heal|shield/i;
const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

const ratio = z.number().min(0).max(10);
const damageType = z.enum(['physical', 'magic', 'true']);
const base = { source: z.number().int(), evidence: z.string().max(300) };
/** A passive read from an item's or augment's text. `source` is its item or augment id; `evidence` the sentence. */
export const Effect = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('statMultiplier'), ...base, stat: z.enum(['ap', 'ad', 'hp']), factor: z.number().min(0.5).max(3) }),
  z.object({ kind: z.literal('onHit'), ...base, damageType, flat: z.number().min(0).max(1000), apRatio: ratio, totalAdRatio: ratio, bonusAdRatio: ratio }),
  z.object({ kind: z.literal('burn'), ...base, damageType, fractionPerSecond: z.number().min(0).max(0.1), durationSeconds: z.number().min(0).max(10) }),
  z.object({ kind: z.literal('attackSpeedCap'), ...base, cap: z.number().min(1).max(10).nullable() }),
  z.object({ kind: z.literal('abilityDamage'), ...base, factor: z.number().min(0.5).max(3) }),
]);

// Multipliers the items file states and that always apply (Rabadon's APAmp 0.3, Warmog's HPAmp 0.12). The many
// conditional ones (low-health targets, stacks, ranged) stay with the model, which reads them from the texts.
const FILE_AMP: Record<string, 'ap' | 'hp'> = { APAmp: 'ap', HPAmp: 'hp' };
const fileAmps = (item: GameItem) =>
  (item.DataValues ?? []).flatMap((d) => (FILE_AMP[d.name] && d.values?.[0] ? [{ stat: FILE_AMP[d.name], amount: d.values[0] }] : []));
export type Effect = z.infer<typeof Effect>;

export interface Target {
  armor: number;
  mr: number;
  hp: number;
}

export interface BuildResult {
  items: number[];
  stats: BuildStats;
  /** Auto attacks only, before the target's armor: AD × attack speed × the average crit multiplier. */
  autoAttackDps: number;
  /** On-hit effects per second, after the target's resists (on-hit does not crit). */
  onHitDps: number;
  /** One full application of every burn on the target, after resists. */
  burnDamage: number;
  /** Share of raw physical / magic damage the target takes after its armor / magic resist and this build's pen. */
  physicalTaken: number;
  magicTaken: number;
  /** Health the champion effectively has against physical / magic damage. */
  effectiveHp: { physical: number; magic: number };
  /** Cooldowns are multiplied by this (ability haste). */
  cooldownFactor: number;
  /** Q, W, E, R at their top rank: each damage, heal or shield calculation as one raw number (damage after abilityDamage). */
  abilities: { key: 'Q' | 'W' | 'E' | 'R'; values: { name: string; value: number; partial: boolean }[] }[];
}

/**
 * Each build is one to six different known items; anything else is refused, not quietly changed. An effect applies to
 * a build when its source is one of the build's items, or not an item at all (an augment, which every build has).
 */
export function compareBuilds(o: {
  bin: Record<string, unknown>;
  items: Record<number, GameItem>;
  builds: number[][];
  effects?: Effect[];
  level?: number;
  target?: Target;
}): BuildResult[] {
  const record = championRecord(o.bin);
  if (!record) throw new Error('no character record in the champion file');
  const level = o.level ?? 18;
  const target = o.target ?? { armor: 100, mr: 80, hp: 3000 };
  const bin = o.bin as Bin;
  const spellRef = (name: string) => {
    const tail = `/${name.toLowerCase()}`;
    return Object.entries(bin).find(([path, v]) => v?.__type === 'SpellObject' && path.toLowerCase().endsWith(tail))?.[1]?.mSpell;
  };
  return o.builds.map((ids) => {
    if (!ids.length || ids.length > 6 || new Set(ids).size !== ids.length) throw new Error(`a build is 1 to 6 different items: ${ids.join(',')}`);
    const unknown = ids.filter((id) => !o.items[id]);
    if (unknown.length) throw new Error(`unknown items: ${unknown.join(',')}`);
    const effects = (o.effects ?? []).filter((e) => !o.items[e.source] || ids.includes(e.source));
    const caps = effects.flatMap((e) => (e.kind === 'attackSpeedCap' ? [e.cap] : []));
    const cap = !caps.length ? 2.5 : caps.includes(null) ? null : Math.max(...caps.filter((c): c is number => c !== null));
    const s = buildStats(record, ids.map((id) => o.items[id]), level, cap);
    const fromFile = ids.flatMap((id) => fileAmps(o.items[id]).map((a) => ({ kind: 'statMultiplier' as const, source: id, stat: a.stat, factor: 1 + a.amount })));
    // The file's number wins over the model's reading of the same item and stat: counted once, and always counted.
    const read = effects.filter((e) => e.kind !== 'statMultiplier' || !fromFile.some((f) => f.source === e.source && f.stat === e.stat));
    for (const e of [...fromFile, ...read]) {
      if (e.kind !== 'statMultiplier') continue;
      if (e.stat === 'ap') s.ap *= e.factor;
      if (e.stat === 'ad') (s.bonusAd += s.ad * (e.factor - 1)), (s.ad *= e.factor);
      if (e.stat === 'hp') (s.bonusHp += s.hp * (e.factor - 1)), (s.hp *= e.factor);
    }
    const abilityAmp = effects.reduce((m, e) => (e.kind === 'abilityDamage' ? m * e.factor : m), 1);
    const statOf = statReader(s);
    const abilities = (['Q', 'W', 'E', 'R'] as const).map((key, i) => {
      const spell = bin[record.spells?.[i] ?? '']?.mSpell;
      const ranks = spell?.mClientData?.mTooltipData?.mLists?.LevelUp?.levelCount ?? (key === 'R' ? 3 : 5);
      const values = calculationsAt(spell, { ranks, rank: ranks, level, statOf, spellRef })
        .filter((c) => DAMAGE.test(c.name))
        .map((c) => ({ ...c, value: round(/damage|dmg/i.test(c.name) ? c.value * abilityAmp : c.value) })); // heals and shields are not damage
      return { key, values };
    });
    const armor = Math.max(0, target.armor * (1 - s.armorPenPercent) - s.lethality);
    const mr = Math.max(0, target.mr * (1 - s.magicPenPercent) - s.magicPen);
    const taken = { physical: 100 / (100 + armor), magic: 100 / (100 + mr), true: 1 };
    let onHitDps = 0;
    let burnDamage = 0;
    for (const e of effects) {
      if (e.kind === 'onHit') onHitDps += (e.flat + e.apRatio * s.ap + e.totalAdRatio * s.ad + e.bonusAdRatio * s.bonusAd) * s.attackSpeed * taken[e.damageType];
      if (e.kind === 'burn') burnDamage += e.fractionPerSecond * target.hp * e.durationSeconds * taken[e.damageType];
    }
    return {
      items: ids,
      stats: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, round(v, 3)])) as unknown as BuildStats,
      autoAttackDps: round(s.ad * s.attackSpeed * (1 + s.crit * (s.critDamage - 1))),
      onHitDps: round(onHitDps),
      burnDamage: round(burnDamage),
      physicalTaken: round(taken.physical, 3),
      magicTaken: round(taken.magic, 3),
      effectiveHp: { physical: Math.round(s.hp * (1 + Math.max(0, s.armor) / 100)), magic: Math.round(s.hp * (1 + Math.max(0, s.mr) / 100)) },
      cooldownFactor: round(100 / (100 + s.haste), 3),
      abilities,
    };
  });
}
