// T072: the words the page shows for a card's own-low-health shield (src/ai/conditionalEffect.ts reads it in the main process; the page imports
// only its type, so no engine module reaches the renderer).
import type { LowHealthTerm } from '../ai/conditionalEffect.js';

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
/** The line the player reads. «يتلاشى» only when the shield op itself says it decays. */
export function lowHealthText(t: LowHealthTerm): string {
  if (t.kind === 'shield') return `عند هبوط صحتك إلى ${pct(t.below)}: درع ${pct(t.maxHealthShare)} من صحتك القصوى${t.decays ? '، يتلاشى' : ''}. احتمال تفعيله واستهلاكه غير مقدرين هنا، وهذا وصف شرطي، لا مكسب إضافي يُجمع مع النسبة أعلاه.`;
  const why = { 'not-live': 'أثره غير محسوب في القتال', 'amount-unread': 'مقداره غير مقروء', 'not-a-shield': 'أثره ليس درعاً مقروءاً' }[t.reason];
  return `له أثر عند هبوط صحتك إلى ${pct(t.below)}، و${why}؛ لا رقم له هنا.`;
}
