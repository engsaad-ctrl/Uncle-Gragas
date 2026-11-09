import { el } from './dom.js';

export function calculationNotes(items: { missing?: string[] }[]): HTMLElement[] {
  const notes = [...new Set(items.flatMap((i) => i.missing ?? []))];
  if (!notes.length) return [];
  const details = el('details', 'hint');
  details.append(el('summary', '', `غير محسوب أو مقدّر (${notes.length})`), ...notes.map((note) => el('p', '', note)));
  return [details];
}
