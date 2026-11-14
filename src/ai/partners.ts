// T052: a held card's partners, from four fight readings of one state (knowledge/codex-claude/T052-augment-partners-contract.md). C is every held
// card, R the same state with only A's effect turned off, and B a candidate. G is B's gain in the full state (the value cardValues gives at this
// level); I is the extra effect tied to A, in the fight value's own units: I = F(C+B) − F(C) − F(R+B) + F(R). I is never a percent or a score,
// and never added to G. A difference of ratios is not used: it moves with the denominator.

export interface FourReadings { C: number; CB: number; R: number; RB: number }
export interface PartnerTerms { gain: number; interaction: number }

/** G and I, or undefined when the state can't be compared (a denominator that is not positive, or a number that is not finite). `weight` is the card
 * weight cardValues applies (tagWeight), so G is the same number the offer shows. */
export function partnerTerms(f: FourReadings, weight = 1): PartnerTerms | undefined {
  if (![f.C, f.CB, f.R, f.RB, weight].every(Number.isFinite) || !(f.C > 0)) return undefined;
  return { gain: weight * (f.CB / f.C - 1), interaction: weight * (f.CB - f.C - f.RB + f.R) };
}

/** The same extra effect for one part of the fight's result (damage, effective health, healing and shields), to explain a row: never added up. */
export const partInteraction = (c: number, cb: number, r: number, rb: number) => cb - c - rb + r;

/** Up to `limit` partners: G and I both above zero, ordered by G, then by id (a tie is not a difference). */
export function pickPartners<T extends { id: number; gain: number; interaction: number }>(rows: T[], limit = 3, eps = 1e-9): T[] {
  return rows.filter((r) => r.gain > eps && r.interaction > eps).sort((a, b) => b.gain - a.gain || a.id - b.id).slice(0, limit);
}

/** T052 v2: the partners recommended in one group: explained rows only (a part of the fight grew with the held card), then pickPartners. A row no
 * part explains is never listed, whatever its G and I. */
export const recommend = <T extends { id: number; gain: number; interaction: number; explained: boolean }>(rows: T[], limit = 3): T[] => pickPartners(rows.filter((r) => r.explained), limit);
