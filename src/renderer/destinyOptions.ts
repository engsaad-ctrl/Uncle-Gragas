import type { ItemEntry } from '../app/itemList.js';

/** T193 (Codex T194): the choices for Weapon of Destiny's weapon. Only finished legendaries he holds (no boots, no components); a weapon he
 * named and no longer holds stays shown and selected, so the select never reads "unknown" while a weapon is still set. */
export function destinyOptions(held: number[], items: Pick<ItemEntry, 'id' | 'name' | 'group'>[], selected?: number): { value: string; text: string; selected: boolean }[] {
  const legendary = (id: number) => items.find((i) => i.group === 'legendary' && i.id % 10000 === id % 10000);
  const ids = [...new Set(held.map((id) => id % 10000))].filter((id) => legendary(id));
  const out = [{ value: '', text: 'غير محدد', selected: selected === undefined }];
  for (const id of ids) out.push({ value: String(id), text: legendary(id)!.name, selected: selected !== undefined && selected % 10000 === id });
  if (selected !== undefined && !ids.includes(selected % 10000)) out.push({ value: String(selected), text: `${legendary(selected)?.name ?? selected} (لم يعد معك)`, selected: true });
  return out;
}
