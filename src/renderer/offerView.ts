// How the cards on offer are read side by side (T037 b): the stage's effect (now, his items as they are) and the finished plan's (items
// searched again for each card) stay two numbers, the relative place among cards of the same group stays a third, and the groups
// (settled, conditional, not computed) are named. Display only: no score, no ranking or winner of its own.

export type OfferGroup = 'settled' | 'open' | 'unmeasured';
export interface OfferCard { id: number; group: OfferGroup; stage?: number; plan?: number }

/** Each group's heading where the group starts, for the cards in the order rankOffer gave them. */
export const OFFER_GROUP_TITLE: Record<OfferGroup, string> = {
  settled: 'محسوبة',
  open: 'مشروطة: نسبتها بين المشروطة وحدها، والقيمة إن تحقق الشرط',
  unmeasured: 'أثر غير محسوب: لا يمكن ترتيبها حسابياً، وهذا لا يعني أنها أضعف',
};

/** The two settled cards the stage and the finished plan each put higher, when they differ: a trade-off to show, not a winner. */
export function offerTradeoff(cards: OfferCard[]): { stage: number; plan: number } | undefined {
  const both = cards.filter((c) => c.group === 'settled' && c.stage !== undefined && c.plan !== undefined);
  if (both.length < 2) return undefined;
  const top = (k: 'stage' | 'plan') => both.reduce((a, b) => (b[k]! > a[k]! ? b : a));
  const stage = top('stage'), plan = top('plan');
  if (stage.id === plan.id || stage.stage === plan.stage || stage.plan === plan.plan) return undefined;
  return { stage: stage.id, plan: plan.id };
}

/** T053 v3: when a card on offer has a range term (read or not), what may be said side by side. No winner overall: range sits outside both numbers.
 * The fight is compared among settled cards with a stage number only (a conditional card never tops a settled one); a tie is a tie. The range top
 * is named only among read amounts; an unread amount is said to be unread. Display only: no score, and no row order of its own. */
export interface RangeCompareCard { id: number; group: OfferGroup; stage?: number; range?: { supported: boolean; delta?: number } }
export interface RangeComparison { fightTop?: number; fightTie: number[]; amongSettled: boolean; rangeTop?: number; rangeUnread: boolean }
export function rangeComparison(cards: RangeCompareCard[]): RangeComparison | undefined {
  if (!cards.some((c) => c.range)) return undefined;
  const settled = cards.filter((c) => c.group === 'settled' && c.stage !== undefined && Number.isFinite(c.stage));
  const best = Math.max(...settled.map((c) => c.stage!));
  const tops = settled.filter((c) => Math.abs(c.stage! - best) < 1e-12);
  const read = cards.filter((c) => c.range?.supported && (c.range.delta ?? 0) > 0);
  const most = Math.max(...read.map((c) => c.range!.delta!));
  const ranged = read.filter((c) => c.range!.delta === most);
  return {
    ...(tops.length === 1 ? { fightTop: tops[0]!.id } : {}), fightTie: tops.length > 1 ? tops.map((c) => c.id) : [],
    amongSettled: cards.some((c) => c.group !== 'settled'),
    ...(ranged.length === 1 ? { rangeTop: ranged[0]!.id } : {}), rangeUnread: cards.some((c) => c.range && !c.range.supported),
  };
}

/** T137: the stored games' win lift for a card the fight cannot value (src/ai/gameLift.ts). Its own line, never ranked or added to the fight. */
export function gameLiftLine(lift: { points: number; players: number; stable: boolean } | undefined): string | undefined {
  if (!lift) return undefined;
  // T138 Codex wording. No card today has a rule that proves it cannot act on a champion (needHolds 'no' needs a melee/ranged need, none exists), so the line is never hidden by champion.
  return `من المباريات، مجمّع عبر الأبطال: ⁦${lift.points > 0 ? '+' : ''}${lift.points.toFixed(1)}⁩ نقطة مئوية في الفوز (${lift.players.toLocaleString('en')} مشاركة). فرق معدّل حسب البطل ومقلّص نحو الصفر؛ ارتباط لا سبب، وخارج نسبة القتال.${lift.stable ? '' : ' اتجاه الفرق يختلف بين نصفي المباريات.'}`;
}
