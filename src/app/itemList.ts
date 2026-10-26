import type { MapItem } from '../stats/opgg.js';
import { assetUrl } from '../texts/assets.js';
import type { NamedText } from '../texts/champions.js';
import type { ItemText } from '../texts/items.js';

export type ItemGroup = 'starter' | 'consumable' | 'boots' | 'basic' | 'epic' | 'legendary';

export interface ItemEntry extends NamedText {
  gold: number;
  group: ItemGroup;
}

/** Shop-style group, from the map's own build tree (Arena items differ from Summoner's Rift). */
function groupOf(item: MapItem, text: ItemText): ItemGroup {
  if (text.categories.includes('Consumable') || text.categories.includes('Trinket')) return 'consumable';
  if (text.categories.includes('Boots')) return 'boots';
  if (item.from.length && !item.into.length) return 'legendary';
  if (item.from.length) return 'epic';
  if (item.into.length) return 'basic';
  return 'starter';
}

export function composeItemList(mapItems: MapItem[], texts: Map<number, ItemText>): ItemEntry[] {
  return mapItems.flatMap((m) => {
    const t = texts.get(m.id);
    if (!m.purchasable || !t || !t.name) return [];
    return [{ id: m.id, name: t.name, enName: t.enName, html: t.html, iconUrl: assetUrl(t.iconPath), gold: m.gold, group: groupOf(m, t) }];
  });
}
