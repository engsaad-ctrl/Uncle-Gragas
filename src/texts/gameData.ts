// Game files used for in-game style ability and item tooltips, cached per game version.
// The string table is 38MB; only the tooltip and spell-name keys (about 1MB) are kept.

import { join } from 'node:path';
import { diskCache, getJson } from '../diskCache.js';
import type { SpellData } from './spellValues.js';

const RAW = 'https://raw.communitydragon.org/latest';
export const GAME_URLS = {
  version: `${RAW}/content-metadata.json`,
  strings: `${RAW}/game/ar_ae/data/menu/en_us/lol.stringtable.json`,
  championBin: (alias: string) => `${RAW}/game/data/characters/${alias}/${alias}.bin.json`,
  items: `${RAW}/game/items.cdtb.bin.json`,
};

interface Opts {
  cacheDir: string;
  fetchImpl: typeof fetch;
}

/**
 * Disk cache valid for one game version. With no version (it could not be fetched), any saved copy is used:
 * offline or a CommunityDragon outage should not cost the detailed descriptions already on disk.
 */
async function perVersion<T>(path: string, version: string | null, load: () => Promise<T>): Promise<T> {
  const r = await diskCache(
    path,
    (e) => version === null || e.key === version,
    version === null ? () => Promise.reject(new Error('تعذّر معرفة نسخة اللعبة، ولا توجد نسخة محفوظة.')) : load,
    { key: version ?? undefined },
  );
  return r.data;
}

export const loadGameVersion = (o: Opts) => getJson<{ version: string }>(o.fetchImpl, GAME_URLS.version).then((m) => m.version);

/** Named keys a tooltip can need: spell/buff/passive tooltips (passives live only here), spell names they embed, item tooltips. */
export const isTooltipKey = (k: string) =>
  !k.startsWith('{') &&
  (/^game_(character_passive|buff_tooltip)/.test(k) ||
    /^generatedtip_item_\d+_description$/.test(k) || // the full item tooltip (passives, active, rules)
    /^item_[a-z]/.test(k) || // shared item templates it embeds ({{ Item_Cooldown }})
    (/^(buff|spell|passive)/.test(k) && /_(tooltip\d?|name)$/.test(k)));

/** Replaces {{ Other_Key }} references from the string table; templates can nest once more. */
export function expandRefs(text: string, strings: (key: string) => string | undefined): string {
  let out = text;
  for (let i = 0; i < 3; i++) out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => strings(key) ?? whole);
  return out;
}

/** The full game string table (38MB), saved once per version so the augments and tooltip builders share one download. */
export function loadStringTable(o: Opts, version: string | null): Promise<Record<string, string>> {
  return perVersion(join(o.cacheDir, 'game', 'strings-full.json'), version, async () =>
    (await getJson<{ entries: Record<string, string> }>(o.fetchImpl, GAME_URLS.strings)).entries,
  );
}

export function loadTooltipStrings(o: Opts, version: string | null): Promise<Record<string, string>> {
  return perVersion(join(o.cacheDir, 'game', 'tooltip-strings.json'), version, async () =>
    Object.fromEntries(Object.entries(await loadStringTable(o, version)).filter(([k]) => isTooltipKey(k.toLowerCase()))),
  );
}

/** The champion's bin, trimmed to what the tooltips read: the character record and its spells' data. */
export function loadChampionBin(o: Opts, version: string | null, alias: string): Promise<Record<string, object>> {
  const a = alias.toLowerCase();
  return perVersion(join(o.cacheDir, 'game', 'champions', `${a}.json`), version, async () => {
    const bin = await getJson<Record<string, { __type?: string; mSpell?: unknown }>>(o.fetchImpl, GAME_URLS.championBin(a));
    return Object.fromEntries(
      Object.entries(bin).flatMap(([k, v]) =>
        v?.__type === 'CharacterRecord' ? [[k, v]] : v?.__type === 'SpellObject' ? [[k, { __type: v.__type, mSpell: v.mSpell }]] : [],
      ),
    );
  });
}

/** An item's tooltip key and its numbers, in the shape resolveSpellValues reads. */
export interface GameItem extends SpellData {
  tooltipKey?: string;
}

interface RawItemData {
  [field: string]: unknown;
  __type?: string;
  itemID?: number;
  spellName?: string;
  mDataValues?: { mName: string; mValue?: number }[];
  mItemCalculations?: SpellData['mSpellCalculations'];
  mEffectAmount?: number[];
  mItemDataClient?: { mDescription?: string };
}
type ItemSpell = { mSpell?: SpellData & { cooldownTime?: number[] } };

/** The items bin (16MB), trimmed to each item's values (its active spell's included) and tooltip key. */
export function loadGameItems(o: Opts, version: string | null): Promise<Record<number, GameItem>> {
  return perVersion(join(o.cacheDir, 'game', 'items.json'), version, async () => {
    const bin = await getJson<Record<string, RawItemData & ItemSpell>>(o.fetchImpl, GAME_URLS.items);
    const out: Record<number, GameItem> = {};
    for (const v of Object.values(bin)) {
      if (v?.__type !== 'ItemData' || !v.itemID) continue;
      // The active's spell, when its name points at one (about half do): cooldown and active values live there.
      const spell = v.spellName ? (bin[`Items/Spells/${v.spellName}`] ?? bin[`Items/Spells/${v.spellName.replace(/Spell$/, '')}`])?.mSpell : undefined;
      out[v.itemID] = {
        tooltipKey: v.mItemDataClient?.mDescription,
        DataValues: [
          ...(v.mDataValues ?? []).map((d) => ({ name: d.mName, values: [d.mValue ?? 0] })),
          // Item stats the text quotes directly, e.g. @FlatHPRegenMod*5@ reads mFlatHPRegenMod
          ...Object.entries(v).flatMap(([k, x]) => (/^m(Flat|Percent)\w+Mod$/.test(k) && typeof x === 'number' ? [{ name: k.slice(1), values: [x] }] : [])),
          ...(spell?.DataValues ?? []),
          ...(spell?.cooldownTime ? [{ name: 'Cooldown', values: spell.cooldownTime }] : []),
        ],
        mSpellCalculations: { ...spell?.mSpellCalculations, ...v.mItemCalculations },
        mEffectAmount: (v.mEffectAmount ?? []).map((x) => ({ value: [x] })), // items have no rank 0: one value per slot
      };
    }
    return out;
  });
}
