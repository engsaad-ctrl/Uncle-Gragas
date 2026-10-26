import type { MapItem } from '../stats/opgg.js';
import { assetUrl } from '../texts/assets.js';
import type { NamedText } from '../texts/champions.js';
import type { ItemClass, ItemText } from '../texts/items.js';

export type ItemGroup = 'starter' | 'consumable' | 'boots' | 'basic' | 'epic' | 'legendary';

export interface ItemEntry extends NamedText {
  gold: number;
  group: ItemGroup;
  classes: ItemClass[];
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
  const entries = mapItems.flatMap((m) => {
    const t = texts.get(m.id);
    if (!m.purchasable || !t || !t.name) return [];
    return [{ id: m.id, name: t.name, enName: t.enName, html: t.html, iconUrl: assetUrl(t.iconPath), gold: m.gold, group: groupOf(m, t), classes: t.classes }];
  });
  // OP.GG's map lists also carry mode copies of an item (ids like 323075 or 773075 next to 3075).
  // shortcut: which copy the ARAM shop really uses is unverified; we keep the base item (id < 10000), else the smallest id.
  const rank = (e: ItemEntry) => (e.id < 10000 ? 0 : 1e9) + e.id;
  // A copy is grouped under its base item even when its English name differs (773072 "The Bloodthirster" → 3072).
  const byId = new Map(entries.map((e) => [e.id, e]));
  const nameOf = (e: ItemEntry) => {
    const base = e.id >= 10000 ? byId.get(e.id % 10000) : undefined;
    return (base ?? e).enName || (base ?? e).name;
  };
  const byName = new Map<string, ItemEntry>();
  for (const e of entries) {
    const key = nameOf(e);
    const kept = byName.get(key);
    if (!kept || rank(e) < rank(kept)) byName.set(key, e);
  }
  return [...byName.values()];
}
