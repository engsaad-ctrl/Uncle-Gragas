import { cleanText, isUntranslated, pickText } from './clean.js';
import { expandRefs, type GameItem } from './gameData.js';
import { resolveSpellValues } from './spellValues.js';

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

/**
 * Item tooltips rebuilt from the game files, keyed by item id: CommunityDragon prints 0 for values the game
 * computes (burn damage, ratios…); the game's own tooltip text and numbers fill them. Only fully resolved texts are kept.
 */
export function buildItemDetails(items: Record<number, GameItem>, strings: (key: string) => string | undefined): Map<number, string> {
  const out = new Map<number, string>();
  for (const [id, item] of Object.entries(items)) {
    const raw = item.tooltipKey ? strings(item.tooltipKey) : undefined;
    if (!raw) continue;
    // Sections: title, stats (CommunityDragon has those right), then passives, active and rules.
    const body = meleeRanged(expandRefs(raw, strings)).split(/<\/?section>/).filter((x, i) => i % 2 === 1).slice(2).filter((x) => x.trim()).join('<br><br>');
    const r = resolveSpellValues(body, item);
    if (r.text.trim() && r.unresolved === 0 && !/@[^@\s]+@|\{\{/.test(r.text)) out.set(Number(id), r.text);
  }
  return out;
}

/**
 * The game picks one of two values by the holder's range (@ChampRange@); outside a match both are shown.
 * Templates seen: Item_Range_Type_{Melee,Ranged}[_Dynamic][_B|_C|_D|_Perc] reading @MeleeItemCalcValueB@ / @MeleeValue*100@ …
 */
function meleeRanged(text: string): string {
  return text.replace(/\{\{\s*Item_Range_Mod_@ChampRange@(\w*)\s*\}\}/gi, (_, suffix: string) => {
    if (/_Perc$/i.test(suffix)) return '@MeleeValue*100@% (قريب) / @RangedValue*100@% (بعيد)';
    const letter = /_([B-D])$/i.exec(suffix)?.[1].toUpperCase() ?? '';
    return `@MeleeItemCalcValue${letter}@ (قريب) / @RangedItemCalcValue${letter}@ (بعيد)`;
  });
}

/** Keeps CommunityDragon's stats block (it has the real numbers) and swaps in the detailed body. */
function withDetail(desc: string, body: string | undefined): string {
  if (!body) return desc;
  const stats = /<stats>[\s\S]*?<\/stats>/.exec(desc)?.[0] ?? '';
  return `<mainText>${stats}${stats ? '<br><br>' : ''}${body}</mainText>`;
}

export function buildItemTexts(ar: RawItem[], en: RawItem[], details?: Map<number, string>): Map<number, ItemText> {
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
      html: cleanText(withDetail(desc.text, details?.get(a.id))),
      translated: name.translated && desc.translated,
      inStore: a.inStore,
      iconPath: a.iconPath,
      categories: a.categories ?? [],
    });
  }
  return out;
}
