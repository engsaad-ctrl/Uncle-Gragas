import { cleanText, isUntranslated, pickText } from './clean.js';

export interface RawItem {
  id: number;
  name: string;
  description: string;
  inStore: boolean;
  iconPath: string;
  categories?: string[];
}

export interface ItemText {
  id: number;
  name: string;
  /** English client name; the UI shows it by default next to the Arabic description. */
  enName: string;
  html: string;
  translated: boolean;
  inStore: boolean;
  iconPath: string;
  /** Shop tags such as Boots, Consumable, Trinket. */
  categories: string[];
}

export function buildItemTexts(ar: RawItem[], en: RawItem[]): Map<number, ItemText> {
  const enById = new Map(en.map((i) => [i.id, i]));
  const out = new Map<number, ItemText>();
  for (const a of ar) {
    const e = enById.get(a.id);
    const name = pickText(a.name, e?.name);
    const desc = pickText(a.description, e?.description);
    out.set(a.id, {
      id: a.id,
      name: name.text,
      enName: isUntranslated(e?.name) ? '' : e!.name,
      html: cleanText(desc.text),
      translated: name.translated && desc.translated,
      inStore: a.inStore,
      iconPath: a.iconPath,
      categories: a.categories ?? [],
    });
  }
  return out;
}
