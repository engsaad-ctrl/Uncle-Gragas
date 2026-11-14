// T061: his attack range state for the range display only (knowledge/codex-claude/T055-range-cases/T055-codex-review.md, T061). One reader, so
// the service and the page never hold their own champion conditions. The fight, attackUptime, the search and fact.ranged keep the record's base
// range: this reading changes no number in them.
//
// In order:
//   1. a held card with a live `melee` op (T051: death or unknown ops don't count) makes him melee at the engine's 200 (the T053 contract);
//   2. a champion whose form changes and whose current form is not read: unknown, with no assumed range;
//   3. a passive that raises his attack range by level: each <li> of the passive's tooltip that names a level placeholder (@LevelForPassiveRankN@)
//      and an attack range placeholder (@...AttackRange@) pairs them, with the numbers from the passive spell's DataValues (Kayle 16.22: Rank1
//      level 6 → UpgradedAttackRange 525, Rank3 level 16 → FinalAttackRange 625). A pair whose number is missing is unknown, never the base range.
//      v2 (Codex's T061 review): when the passive file itself declares a level-dependent range (a LevelForPassiveRank* and an *AttackRange data
//      value; in 16.22 only Kayle), a missing or unreadable tooltip, a missing key, or text with no clean pair is unknown, never the base range:
//      no evidence of the transition is not evidence that he stays melee. A pair is read only inside one closed list item (<li …>…</li>); an
//      unclosed or nested item, or an item naming two levels or two ranges, is ambiguous and reads nothing;
//   4. otherwise the record's base range (attackRangeModifiable.baseValue); none: unknown.
// Melee is under 300, as T053 decides it.

export type RangeUnknown = 'range-unread' | 'form-unread' | 'rank-values-missing' | 'level-range-text-unread';
export type RangeState =
  | { known: true; range: number; melee: boolean; source: 'base' | 'held-melee' | 'passive-rank'; level: number }
  | { known: false; reason: RangeUnknown; level: number };

/** Champions whose attack range depends on a form the engine does not read (T055: Nidalee, Jayce, Gnar, Elise), by the record's own name. */
export const FORM_UNREAD = new Set(['Nidalee', 'Jayce', 'Gnar', 'Elise']);
export const MELEE_BELOW = 300;
const HELD_MELEE_RANGE = 200;

type Bin = Record<string, unknown>;
interface DataValue { name?: string; values?: number[] }
interface Record_ { __type?: string; mCharacterName?: string; mCharacterPassiveSpell?: string; attackRangeModifiable?: { baseValue?: number } }

/** The pairs a passive tooltip states, each from one closed list item: the level variable and the range variable named inside the same
 * <li …>…</li>. ambiguous: an <li> with no closing tag, a nested <li>, or an item naming more than one level or more than one range variable;
 * then no pair is read at all (v2: never across items, nor from a paragraph after the list). */
export function passiveRangeReading(tooltip: string | undefined): { pairs: { levelVar: string; rangeVar: string }[]; ambiguous: boolean } {
  if (!tooltip) return { pairs: [], ambiguous: false };
  const opens = (tooltip.match(/<li\b[^>]*>/gi) ?? []).length;
  const items = [...tooltip.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)].map((m) => m[1]!);
  if (items.length !== opens || items.some((x) => /<li\b/i.test(x))) return { pairs: [], ambiguous: true };
  const pairs: { levelVar: string; rangeVar: string }[] = [];
  for (const item of items) {
    const levels = [...item.matchAll(/@(LevelForPassiveRank\d+)@/g)].map((m) => m[1]!);
    const ranges = [...item.matchAll(/@(\w*AttackRange)@/g)].map((m) => m[1]!);
    if (levels.length > 1 || ranges.length > 1) return { pairs: [], ambiguous: true };
    if (levels.length && ranges.length) pairs.push({ levelVar: levels[0]!, rangeVar: ranges[0]! });
  }
  return { pairs, ambiguous: false };
}
export const passiveRangePairs = (tooltip: string | undefined) => passiveRangeReading(tooltip).pairs;

export function rangeState(o: { bin: Bin; strings: Record<string, string>; level: number; heldMelee: boolean }): RangeState {
  const { level } = o;
  if (o.heldMelee) return { known: true, range: HELD_MELEE_RANGE, melee: true, source: 'held-melee', level };
  const record = Object.values(o.bin).find((v) => (v as Record_ | null)?.__type === 'CharacterRecord') as Record_ | undefined;
  if (record?.mCharacterName && FORM_UNREAD.has(record.mCharacterName)) return { known: false, reason: 'form-unread', level };
  const base = record?.attackRangeModifiable?.baseValue;
  const passive = record?.mCharacterPassiveSpell ? (o.bin[record.mCharacterPassiveSpell] as { mSpell?: { DataValues?: DataValue[]; mClientData?: { mTooltipData?: { mLocKeys?: { keyTooltip?: string } } } } } | undefined)?.mSpell : undefined;
  const key = passive?.mClientData?.mTooltipData?.mLocKeys?.keyTooltip;
  const names = (passive?.DataValues ?? []).map((d) => d.name ?? '');
  const declared = names.some((n) => /^LevelForPassiveRank\d+$/.test(n)) && names.some((n) => /AttackRange$/.test(n));
  const reading = passiveRangeReading(key ? o.strings[key.toLowerCase()] : undefined);
  // v2: the file says his range changes by level, but the text that pairs a level with a range is missing, unclosed or gives no pair: unknown.
  if (declared && (reading.ambiguous || !reading.pairs.length)) return { known: false, reason: 'level-range-text-unread', level };
  const pairs = reading.pairs;
  if (declared) {
    // A surviving later step does not prove the missing earlier range. Every declared range value needs its own text link.
    const linked = new Set(pairs.map((p) => p.rangeVar));
    if (names.some((n) => /AttackRange$/.test(n) && !linked.has(n))) return { known: false, reason: 'level-range-text-unread', level };
  }
  if (pairs.length) {
    const dv = (name: string) => passive?.DataValues?.find((d) => d.name === name)?.values?.[0];
    const steps = pairs.map((p) => ({ at: dv(p.levelVar), range: dv(p.rangeVar) }));
    if (steps.some((s) => typeof s.at !== 'number' || typeof s.range !== 'number' || !Number.isFinite(s.at) || !Number.isFinite(s.range))) return { known: false, reason: 'rank-values-missing', level };
    // Different variables may still name the same numeric level; two ranges at that level are not a settled reading.
    if (steps.some((s, i) => steps.some((other, j) => i !== j && s.at === other.at && s.range !== other.range))) return { known: false, reason: 'level-range-text-unread', level };
    const reached = steps.filter((s) => s.at! <= level).sort((a, b) => b.at! - a.at!)[0];
    if (reached) return { known: true, range: reached.range!, melee: reached.range! < MELEE_BELOW, source: 'passive-rank', level };
  }
  if (typeof base !== 'number' || !Number.isFinite(base)) return { known: false, reason: 'range-unread', level };
  return { known: true, range: base, melee: base < MELEE_BELOW, source: 'base', level };
}
