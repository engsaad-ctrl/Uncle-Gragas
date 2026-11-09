// The player's own walk: the cards on offer and the items he really bought, typed in by him, since the engine can't see them.

/** Cards on offer, highest percent first, cards with no percent last. */
/** Settled cards first by percent, then cards with an open condition by percent (the owner, 2026-11-09: kept apart), then unknown. */
export const rankOffer = <T>(cards: T[], percent: (card: T) => number | undefined, open: (card: T) => boolean = () => false): T[] =>
  [...cards].sort((a, b) => { const group = (c: T) => (percent(c) === undefined ? 2 : open(c) ? 1 : 0); return group(a) - group(b) || (percent(b) ?? 0) - (percent(a) ?? 0); });

/** What's left to buy from the advised list, in six slots, and what he bought that the list no longer holds. */
export function walkItems(advised: number[], owned: number[]): { next: number[]; offPath: number[] } {
  return { next: advised.filter((id) => !owned.includes(id)).slice(0, Math.max(0, 6 - owned.length)), offPath: owned.filter((id) => !advised.includes(id)) };
}
