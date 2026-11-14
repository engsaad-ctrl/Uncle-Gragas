// T072: a card's effect that waits on the player's own health falling, said as a declared condition beside the card's value and never folded into
// it (Codex, T070-codex-review.md, answer a). Read from the card's live ops by their fields, never by a name; no fight, no pressure, no chance.
import { isLiveOp, type CardOp } from './cardMath.js';

/** The share of his own health an op waits for («on falling below 35% Health»). The same pattern the fight's lowMark reads (cardMath.ts), so the
 *  line and the fight agree on which ops wait; an op on a target's health is not his own. */
export const ownLowHealthMark = (x: CardOp): number => {
  const needs = String((x as { needs?: string }).needs ?? '');
  const m = /(?:falling below|takes health below|at or below|below|at) (\d+)% (?:remaining )?health/i.exec(needs);
  return m && !/target/i.test(needs) ? +m[1]! / 100 : 0;
};

/** What the page may say about a card's low-health effect. 'shield': a shield whose whole amount is a share of his maximum health. 'unread': an op waits on
 *  his health but its amount is not that one readable form, or it is not a live op; the reason is said and no number is shown. */
export type LowHealthTerm =
  | { kind: 'shield'; below: number; maxHealthShare: number; decays: boolean }
  | { kind: 'unread'; below: number; reason: 'not-live' | 'amount-unread' | 'not-a-shield' };

/** The card's own-low-health shield, if any: the first live shield op that waits on his health with an amount of exactly {hp: share}. */
export function lowHealthTermOf(card: { ops: CardOp[] }): LowHealthTerm | undefined {
  const waiting = card.ops.filter((x) => ownLowHealthMark(x) > 0);
  if (!waiting.length) return undefined;
  const live = waiting.filter(isLiveOp);
  const shield = live.find((x) => x.op === 'shield');
  if (shield && shield.op === 'shield') {
    const amount = shield.amount as Record<string, unknown>;
    const keys = Object.keys(amount ?? {});
    const share = amount?.hp;
    if (keys.length === 1 && keys[0] === 'hp' && typeof share === 'number' && share > 0) return { kind: 'shield', below: ownLowHealthMark(shield), maxHealthShare: share, decays: (shield as { decays?: boolean }).decays === true };
    return { kind: 'unread', below: ownLowHealthMark(shield), reason: 'amount-unread' };
  }
  if (!live.length) return { kind: 'unread', below: ownLowHealthMark(waiting[0]!), reason: 'not-live' };
  return { kind: 'unread', below: ownLowHealthMark(live[0]!), reason: 'not-a-shield' };
}
