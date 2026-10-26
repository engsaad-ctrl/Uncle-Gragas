import { assetUrl } from './assets.js';
import { cleanText, isUntranslated } from './clean.js';
import { resolveSpellValues, type SpellData } from './spellValues.js';
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
  /** Every platform id merged into this entry (Arena and Mayhem twins share one entry). */
  ids: number[];
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
  /** The augment's root spell data, attached by the loader (bin[RootSpell].mSpell). */
  __spell?: SpellData;
}

const RARITY: Record<string, Rarity> = { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic', kEventChoice: 'event' };

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
  /** Replaces {{ Other_Key }} references, hashed keys included (two levels: shared texts can nest once). */
  const expand = async (text: string) => {
    for (let depth = 0; depth < 2; depth++) {
      const found = new Map<string, string | undefined>();
      for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) if (!found.has(m[1])) found.set(m[1], await lookup(m[1]));
      if (!found.size) break;
      text = text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => found.get(key) ?? whole);
    }
    return text;
  };

  const out: AugmentText[] = [];
  for (const a of src.listAr) {
    const d = data.get(a.id);
    // The tooltip has the numbers; the short description has fewer placeholders. Take the tooltip when every
    // value resolves, else whichever leaves fewer unknowns (ties go to the description).
    const candidates: { text: string; unresolved: number }[] = [];
    for (const key of [d?.AugmentTooltipTra, d?.DescriptionTra]) {
      const raw = await lookup(key);
      if (raw !== undefined && !isUntranslated(raw)) candidates.push(resolveSpellValues(await expand(raw), d?.__spell, { dropLiveLines: true }));
    }
    const best =
      candidates.find((c) => c.unresolved === 0) ??
      candidates.reduce<(typeof candidates)[number] | undefined>((b, c) => (!b || c.unresolved <= b.unresolved ? c : b), undefined);
    const html = best ? cleanText(best.text) : '';
    const enName = enNames.get(a.id) ?? '';
    const name = isUntranslated(a.nameTRA) ? enName : a.nameTRA;
    if (!name || /^[?؟\s]+$/.test(name)) continue; // "???" = unreleased test augment
    out.push({
      id: a.id,
      ids: [a.id],
      name,
      enName,
      html,
      described: html !== '',
      rarity: RARITY[a.rarity] ?? 'event',
      // The Arena map file (map30) holds only ids < 1000; the Mayhem files (kiwi*) only ids >= 1000.
      modes: [a.id < 1000 ? 'arena' : 'mayhem'],
      iconUrl: assetUrl(a.augmentSmallIconPath),
    });
  }

  // An augment that exists in both modes with the same text is shown once.
  const merged = new Map<string, AugmentText>();
  for (const t of out) {
    const twin = merged.get(`${t.name}\u0000${t.html}`);
    if (!twin) merged.set(`${t.name}\u0000${t.html}`, t);
    else {
      twin.ids.push(t.id);
      if (!twin.modes.includes(t.modes[0])) twin.modes.push(t.modes[0]);
    }
  }
  return [...merged.values()].sort((x, y) => x.name.localeCompare(y.name, 'ar'));
}
