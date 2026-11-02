// The player's own walk: the cards on offer and the items he really bought, typed in by him, since the engine can't see them.

/** Cards on offer, highest percent first, cards with no percent last. */
export const rankOffer = <T>(cards: T[], percent: (card: T) => number | undefined): T[] =>
  [...cards].sort((a, b) => (percent(b) ?? -1) - (percent(a) ?? -1));

/** What's left to buy from the advised list, in six slots, and what he bought that the list no longer holds. */
export function walkItems(advised: number[], owned: number[]): { next: number[]; offPath: number[] } {
  return { next: advised.filter((id) => !owned.includes(id)).slice(0, Math.max(0, 6 - owned.length)), offPath: owned.filter((id) => !advised.includes(id)) };
}
