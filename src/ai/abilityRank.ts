/** Rank availability from CharacterRecord.SpellLevelUpInfoList (when overridden by a champion), and a legal
 * skill-point allocation over it (allocateAbilityRanks). Neither is a record of the player's choices unless
 * his actual ranks are passed in.
 */
export interface AbilityRankRecord {
  SpellLevelUpInfoList?: {
    List?: {
      mRequirements?: {
        mRequirements?: { __type?: string; mLevel?: number }[];
      }[];
    }[];
  };
}
export type AbilityKey = 'Q' | 'W' | 'E' | 'R';
const KEYS: AbilityKey[] = ['Q', 'W', 'E', 'R'];

/** Each rank's minimum champion level. Ordinary basics: 1/3/5/7/9 (rank n at level 2n-1); ordinary R: 6/11/16. */
function rankLevels(record: AbilityRankRecord, key: AbilityKey, tooltipRanks?: number): number[] {
  const overrides = record.SpellLevelUpInfoList?.List?.['QWER'.indexOf(key)]?.mRequirements;
  const requirements = Array.isArray(overrides) && overrides.length > 0 && overrides.length <= 6 ? overrides : undefined;
  const ranks = tooltipRanks !== undefined && Number.isInteger(tooltipRanks) && tooltipRanks > 0 && tooltipRanks <= 6 ? tooltipRanks : requirements?.length ?? (key === 'R' ? 3 : 5);
  // Ordinary R: 6/11/16. Four-rank transformations start at 1; one-rank stances also
  // start at 1. Champions such as Udyr override R with the basic-skill requirements.
  const defaults = key === 'R' ? (ranks === 4 ? [1, 6, 11, 16] : ranks === 1 ? [1] : ranks === 3 ? [6, 11, 16] : []) : [];
  const levels: number[] = [];
  for (let i = 0; i < ranks; i++) {
    if (requirements && !requirements[i]) { levels.push(Infinity); continue; } // an absent override row is not an unrestricted rank
    const rules = requirements?.[i]?.mRequirements;
    const named = (rules ?? []).flatMap((r) => r.__type === 'CharacterLevelRequirement' ? [r.mLevel ?? 1] : []);
    const ultimate = key === 'R' && ranks <= 4;
    // A level the file names stands; otherwise an ultimate's default, and a basic rank n from level 2n - 1 (the game's rule).
    levels.push(named.length ? Math.max(...named) : ultimate ? (requirements ? 1 : defaults[i] ?? 1) : 2 * i + 1);
  }
  for (let i = 1; i < levels.length; i++) levels[i] = Math.max(levels[i]!, levels[i - 1]!); // a rank never opens before the one below it
  return levels;
}

/** Ranks open by this level (the rank bound), and the rank count. */
export function estimatedAbilityRank(record: AbilityRankRecord, key: AbilityKey, level: number, tooltipRanks?: number): { rank: number; ranks: number } {
  const levels = rankLevels(record, key, tooltipRanks);
  return { rank: levels.filter((l) => l <= level).length, ranks: levels.length };
}

/**
 * Ranks at this level from one skill point a level, each spent when taken: an ordinary ultimate (four ranks or fewer) as soon as a rank opens,
 * a rank open from level 1 of such an ultimate given free (Jayce, Elise, Nidalee, Karma start with it), the rest on the basic skills (and an Udyr-like R):
 * first one point in each, then by `order` when the player's max order is known, else evenly (the lowest rank first, Q W E R on ties).
 * `from`: his ranks read from the game at a level; at that level they are used as they are, and later levels go on from them by the same rule.
 * `sequence`: a level-by-level order (the build page's most picked, the owner's choice 2026-11-09): each level takes its key when that rank is legal there, else the rule above.
 * shortcut: the even spread is a neutral default, not how most players level; pass `sequence`, `order` or `from` when known.
 */
export interface KnownRanks { level: number; ranks: Partial<Record<AbilityKey, number>> }
export interface SkillPlan { order?: AbilityKey[]; sequence?: AbilityKey[] }
/** A plan from a page's strings: only Q W E R kept; empty when nothing usable. */
export function skillPlanOf(sequence: string[] | undefined, order: string[] | undefined): SkillPlan | undefined {
  const keys = (list?: string[]) => (list ?? []).map((s) => s.trim().toUpperCase()).filter((s): s is AbilityKey => s === 'Q' || s === 'W' || s === 'E' || s === 'R');
  const plan = { sequence: keys(sequence).slice(0, 18), order: keys(order).filter((k) => k !== 'R') };
  return plan.sequence.length || plan.order.length ? { ...(plan.sequence.length ? { sequence: plan.sequence } : {}), ...(plan.order.length ? { order: plan.order } : {}) } : undefined;
}
export function allocateAbilityRanks(record: AbilityRankRecord, tooltipRanks: Partial<Record<AbilityKey, number>>, level: number, o: { order?: AbilityKey[]; sequence?: AbilityKey[]; from?: KnownRanks } = {}): Record<AbilityKey, { rank: number; ranks: number; read: boolean }> {
  const levels = Object.fromEntries(KEYS.map((k) => [k, rankLevels(record, k, tooltipRanks[k])])) as Record<AbilityKey, number[]>;
  const out = Object.fromEntries(KEYS.map((k) => [k, { rank: 0, ranks: levels[k].length, read: false }])) as Record<AbilityKey, { rank: number; ranks: number; read: boolean }>;
  const ult = levels.R.length <= 4; // an Udyr-like R (five or six ranks) is levelled as a basic skill
  const basics = KEYS.filter((k) => k !== 'R' || !ult);
  const L = Math.max(1, Math.min(18, Math.floor(level)));
  // Known ranks at or below this level: start there (each clamped to its rank count); an earlier level cannot use a later reading.
  const from = o.from && o.from.level <= L ? o.from : undefined;
  if (from) for (const k of KEYS) { const v = from.ranks[k]; if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = { rank: Math.min(v, out[k].ranks), ranks: out[k].ranks, read: from.level === L }; }
  for (let at = from ? from.level + 1 : 1; at <= L; at++) {
    if (ult) while (out.R.rank < levels.R.length && levels.R[out.R.rank] === 1 && at === 1) out.R.rank++; // free at level 1
    // An ordinary ultimate is taken when it opens, even when a page's sequence leaves R out (players take it at once).
    if (ult && out.R.rank < levels.R.length && levels.R[out.R.rank]! <= at) { out.R.rank++; continue; }
    const planned = o.sequence?.[at - 1];
    if (planned && out[planned].rank < levels[planned].length && levels[planned][out[planned].rank]! <= at) { out[planned].rank++; continue; }
    const open = basics.filter((k) => out[k].rank < levels[k].length && levels[k][out[k].rank]! <= at);
    if (!open.length) continue; // a point with nowhere to go is kept unspent
    const first = open.find((k) => out[k].rank === 0);
    const byOrder = o.order?.find((k) => open.includes(k));
    const even = open.reduce((a, b) => (out[b].rank < out[a].rank ? b : a));
    out[first ?? byOrder ?? even].rank++;
  }
  return out;
}
