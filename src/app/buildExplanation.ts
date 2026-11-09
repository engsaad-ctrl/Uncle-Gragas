import type { BuildAmounts, BuildExplanation } from '../ai/buildExplanation.js';

const LABELS: Record<keyof BuildAmounts, string> = { damage: 'ضرر', effectiveHp: 'تحمّل', selfSustain: 'علاج ودروع ذاتية بعد المقاومات', abilitySupport: 'علاج ودروع قدرات', healingDenied: 'شفاء ممنوع للعدو' };
export const amountWords = (amounts: BuildAmounts): string => (Object.keys(LABELS) as (keyof BuildAmounts)[])
  .filter((key) => Number.isFinite(amounts[key]) && Math.abs(amounts[key]) >= 0.5)
  .map((key) => `${LABELS[key]} ${amounts[key] >= 0 ? '+' : ''}${Math.round(amounts[key]).toLocaleString('en')}`).join('، ') || 'لا يتغير الجزء المحسوب';

/** One strongest interaction per quantity, with no blended link score. */
export function itemExplanationWords(explanation: BuildExplanation, id: number, name: (kind: 'item' | 'augment', id: number) => string): string[] {
  const item = explanation.items.find((i) => i.id === id);
  if (!item) return [];
  const strongest = (key: keyof BuildAmounts) => [...item.interactions].filter((i) => Math.abs(i.delta[key]) >= 0.5).sort((a, b) => Math.abs(b.delta[key]) - Math.abs(a.delta[key]))[0];
  const links = [...new Set((Object.keys(LABELS) as (keyof BuildAmounts)[]).map(strongest).filter((i) => i !== undefined))];
  return [
    `أثره داخل البناء في مستوى ${explanation.level} خلال ${explanation.seconds}ث: ${amountWords(item.delta)}`,
    ...links.map((l) => `تفاعل حسابي مع ${name(l.kind, l.id)}: ${amountWords(l.delta)}؛ مشروط بباقي البناء`),
  ];
}
