import { cleanText, isUntranslated } from './clean.js';
import { stringTableKey } from './stringhash.js';

export interface AugmentListEntry {
  id: number;
  augmentNameId: string;
  nameTRA: string;
  augmentSmallIconPath: string;
  rarity: string;
}

export type Rarity = 'silver' | 'gold' | 'prismatic' | 'event';
export type Mode = 'arena' | 'mayhem';

export interface AugmentText {
  id: number;
  name: string;
  enName: string;
  html: string;
  described: boolean;
  rarity: Rarity;
  modes: Mode[];
  iconUrl: string;
}

export interface AugmentSources {
  listAr: AugmentListEntry[];
  listEn: AugmentListEntry[];
  bins: object[];
  strings: Record<string, string>;
}

interface AugmentData {
  __type?: string;
  AugmentPlatformId?: number;
  DescriptionTra?: string;
  AugmentTooltipTra?: string;
}

const RARITY: Record<string, Rarity> = { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic', kEventChoice: 'event' };
const ASSETS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';

export const iconUrl = (path: string) => ASSETS + path.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase();

export async function buildAugmentTexts(src: AugmentSources): Promise<AugmentText[]> {
  const data = new Map<number, AugmentData>();
  for (const bin of src.bins) {
    for (const v of Object.values(bin) as AugmentData[]) {
      if (v?.__type === 'AugmentData' && v.AugmentPlatformId && !data.has(v.AugmentPlatformId)) data.set(v.AugmentPlatformId, v);
    }
  }
  const byLower = new Map(Object.entries(src.strings).map(([k, v]) => [k.toLowerCase(), v]));
  const lookup = async (key?: string) =>
    key ? (byLower.get(key.toLowerCase()) ?? src.strings[await stringTableKey(key)]) : undefined;
  const enNames = new Map(src.listEn.map((a) => [a.id, a.nameTRA]));

  const out: AugmentText[] = [];
  for (const a of src.listAr) {
    const d = data.get(a.id);
    // shortcut: a description that only references another key ({{Other_Key}}) renders as ؟; resolve one level if users hit it.
    const raw = (await lookup(d?.DescriptionTra)) ?? (await lookup(d?.AugmentTooltipTra)) ?? '';
    const html = isUntranslated(raw) ? '' : cleanText(raw);
    const enName = enNames.get(a.id) ?? '';
    const name = isUntranslated(a.nameTRA) ? enName : a.nameTRA;
    if (!name || /^[?؟\s]+$/.test(name)) continue; // "???" = unreleased test augment
    out.push({
      id: a.id,
      name,
      enName,
      html,
      described: html !== '',
      rarity: RARITY[a.rarity] ?? 'event',
      // The Arena map file (map30) holds only ids < 1000; the Mayhem files (kiwi*) only ids >= 1000.
      modes: [a.id < 1000 ? 'arena' : 'mayhem'],
      iconUrl: iconUrl(a.augmentSmallIconPath),
    });
  }

  // An augment that exists in both modes with the same text is shown once.
  const merged = new Map<string, AugmentText>();
  for (const t of out) {
    const twin = merged.get(`${t.name}\u0000${t.html}`);
    if (!twin) merged.set(`${t.name}\u0000${t.html}`, t);
    else if (!twin.modes.includes(t.modes[0])) twin.modes.push(t.modes[0]);
  }
  return [...merged.values()].sort((x, y) => x.name.localeCompare(y.name, 'ar'));
}
