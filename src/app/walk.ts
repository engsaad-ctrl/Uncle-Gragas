// The player's own walk: the cards on offer and the items he really bought, typed in by him, since the engine can't see them.

/** Search complete builds after all three cards are entered or the player requests a partial comparison. */
export const offerPlanIds = (offer: ReadonlySet<number>, comparePartial: boolean): number[] =>
  offer.size === 3 || comparePartial ? [...offer] : [];

/** Settled cards first by percent, then cards with an open condition by percent (the owner, 2026-11-09: kept apart), then unknown. */
export const rankOffer = <T>(cards: T[], percent: (card: T) => number | undefined, open: (card: T) => boolean = () => false): T[] =>
  [...cards].sort((a, b) => { const group = (c: T) => (percent(c) === undefined ? 2 : open(c) ? 1 : 0); return group(a) - group(b) || (percent(b) ?? 0) - (percent(a) ?? 0); });

/** What's left to buy from the advised list, in six slots, and what he bought that the list no longer holds. */
export function walkItems(advised: number[], owned: number[]): { next: number[]; offPath: number[] } {
  return { next: advised.filter((id) => !owned.includes(id)).slice(0, Math.max(0, 6 - owned.length)), offPath: owned.filter((id) => !advised.includes(id)) };
}

/** What a card changes in the items still to buy (T014, T015). */
export type PathChange = { kind: 'same' } | { kind: 'none' } | { kind: 'changed' | 'reordered'; step: number; was?: number; now?: number };
/**
 * The full plan with the card against the plan without it, from one search with the same items held, style and level (services cardValues).
 * The held prefix is the one each search itself kept and sent with its plan (baselineOwned, itemsOwned: mathBuild's 'owned' rows, as main
 * used them), never the page's own list, which may be a read behind (T015). Both must be sent, be the same, and open their plan; otherwise
 * there is no verdict. It compares the two plans only: it says nothing of whether the held items are right, or of gold and timing.
 */
export function pathChange(baseline: number[], withCard: number[], baselineOwned: number[] | undefined, itemsOwned: number[] | undefined): PathChange | undefined {
  if (!baselineOwned || !itemsOwned || baselineOwned.join() !== itemsOwned.join()) return undefined;
  const k = baselineOwned.length;
  if (baseline.slice(0, k).join() !== baselineOwned.join() || withCard.slice(0, k).join() !== itemsOwned.join()) return undefined;
  const was = baseline.slice(k), now = withCard.slice(k);
  if ([...was, ...now].some((id) => baselineOwned.includes(id))) return undefined;
  if (!was.length && !now.length) return { kind: 'none' };
  const differ = was.findIndex((id, i) => id !== now[i]);
  const at = differ >= 0 ? differ : now.length > was.length ? was.length : -1;
  if (at < 0) return { kind: 'same' };
  const reordered = was.length === now.length && [...was].sort().join() === [...now].sort().join();
  return { kind: reordered ? 'reordered' : 'changed', step: at + 1, ...(was[at] !== undefined ? { was: was[at] } : {}), ...(now[at] !== undefined ? { now: now[at] } : {}) };
}

/**
 * The reason the card's own plan gives for the item a verdict names (T017): the new item where the plans part, or the next item to buy when
 * they don't. From that plan's itemsWhy only (mathBuild's words for its own rows), the internal 'owned' tag and empty words dropped; nothing
 * for a removed item, for plans with nothing past the held items, or when the search gave no words.
 */
export function planReason(change: PathChange | undefined, items: number[], owned: number[], itemsWhy: { id: number; why: string[] }[] | undefined): { id: number; why: string[] } | undefined {
  if (!change || !itemsWhy || change.kind === 'none') return undefined;
  const id = change.kind === 'same' ? items[owned.length] : change.now;
  const why = itemsWhy.find((x) => x.id === id)?.why.filter((w) => w && w !== 'owned');
  return id !== undefined && why?.length ? { id, why } : undefined;
}

/** pathChange in words, or nothing when there is no verdict or an item's name is unknown. */
export function pathChangeLine(change: PathChange | undefined, name: (id: number) => string | undefined): string | undefined {
  const head = 'الخطة المكتملة مع هذا التعزيز: ';
  if (!change) return undefined;
  if (change.kind === 'same') return `${head}لا يتغير ترتيب الأغراض القادمة.`;
  if (change.kind === 'none') return 'الخطتان، مع هذا التعزيز وبدونه، لا تقترحان أغراضاً بعد ما تملكه.';
  const was = change.was === undefined ? undefined : name(change.was), now = change.now === undefined ? undefined : name(change.now);
  if ((change.was !== undefined && !was) || (change.now !== undefined && !now)) return undefined;
  const at = `الخطوة القادمة رقم ${change.step}`;
  if (was && now) return `${head}${change.kind === 'reordered' ? 'الأغراض القادمة نفسها بترتيب آخر؛ ' : ''}${now} بدل ${was} عند ${at}.`;
  return now ? `${head}تضيف ${now} عند ${at}.` : `${head}تخلو من ${was}، وهو ${at} بدونه.`;
}
