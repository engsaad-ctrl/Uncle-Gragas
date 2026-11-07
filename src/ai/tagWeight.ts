import type { CardOp } from './cardMath.js';

/** What share of a card's fight value counts, from its tags (knowledge/fight-rules.md, conditions): one that works on his death gives nothing in a fight
 * he survives; one whose condition the fight doesn't check (no condition on its ops) counts half, as likely met as not. */
export function tagWeight(tags: { tags: string[] } | undefined, ops: CardOp[]): { weight: number; unread: boolean } {
  const unread = !!tags?.tags.some((t) => t.startsWith('condition:')) && !ops.some((x) => typeof (x as { needs?: unknown }).needs === 'string');
  return { weight: tags?.tags.includes('on_death') ? 0 : unread ? 0.5 : 1, unread };
}
