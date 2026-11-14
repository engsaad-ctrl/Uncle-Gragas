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
/** The mode files the loader reads (AUGMENT_URLS.bins); a pool's file says which mode it is. */
export type PoolSource = 'cherry' | 'kiwi' | 'kiwi_jade' | 'map30';
/** T050: the mode each file's pool stands for. kiwi is the Mayhem pool: its 242 links are the 16.22 Mayhem augments (T045/T046, checked on the
 * saved kiwi.bin). cherry and map30 are Arena's files: that mapping is by file, not checked here on their bytes. kiwi_jade is a variant whose
 * mode is not proven, so its pool gives no mode. */
export const POOL_MODE: Record<PoolSource, Mode | undefined> = { kiwi: 'mayhem', cherry: 'arena', map30: 'arena', kiwi_jade: undefined };
/** T050: the entry's id that stands for it in Mayhem: the id whose own pools include a Mayhem one (a merged twin's Arena id never does). A copy
 * without pools (old cache) keeps its old rule: the entry's first id when it is labelled Mayhem. Undefined when no id is a Mayhem member. */
export const mayhemIdOf = (a: Pick<AugmentText, 'id' | 'ids' | 'modes' | 'pools'>) =>
  a.pools ? a.ids.find((id) => (a.pools![id] ?? []).some((s) => POOL_MODE[s] === 'mayhem')) : a.modes.includes('mayhem') ? a.id : undefined;
/** T050: may this id be marked as a pick in a Mayhem match? Yes for a Mayhem pool member, and for an id no pool lists (unknown: absence from a
 * pool does not prove it is never offered); no for an id whose every pool is Arena's. A copy without pools (old cache) keeps its old label. */
export const markableInMayhem = (augments: Pick<AugmentText, 'ids' | 'modes' | 'pools'>[], id: number) =>
  augments.some((a) => a.ids.includes(id) && (a.pools ? !(a.pools[id]?.length) || a.pools[id]!.some((s) => POOL_MODE[s] !== 'arena') : a.modes.includes('mayhem')));
/** A mode file's augment pool, kept by the loader before it trims the file: the platform ids its links resolve to. */
export interface AugmentPool { __type: 'AugmentPool'; source: PoolSource; ids: number[]; unresolved: number }

export interface AugmentText {
  id: number;
  /** Every platform id merged into this entry (Arena and Mayhem twins share one entry). */
  ids: number[];
  name: string;
  enName: string;
  html: string;
  described: boolean;
  rarity: Rarity;
  /** From the mode pools that list its ids (pools), never from the id's size. Empty when no loaded pool lists it (unknown). */
  modes: Mode[];
  /** T050: for each of its ids, the mode files whose augment pool (AugmentList) lists it, in the loaded patch. */
  pools?: Record<number, PoolSource[]>;
  iconUrl: string;
  /** The patch's own numbers, for an augment the engine reads from its files (src/ai/augmentFiles.ts); same download as the text, so one version. */
  game?: AugmentGameData;
}

/** An augment's root spell values and the missiles it sends, as the mode file of the loaded patch has them. */
export interface AugmentGameData {
  spell: Pick<SpellData, 'DataValues' | 'mSpellCalculations'>;
  missiles: { script: string; travelTime?: number; speed?: number }[];
}

/** Augments (AugmentNameId) whose numbers src/ai/augmentFiles.ts reads from the files instead of a copy in knowledge/. */
export const FILE_READ_AUGMENTS = new Set(['BEES', 'Ability_SelfAOE_DoubleCast', 'ARAM_Dashing', 'ARAM_ApexInventor']);

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
  AugmentNameId?: string;
  /** The augment's root spell data, attached by the loader (bin[RootSpell].mSpell). */
  __spell?: SpellData;
  /** Its additional spells' missile movement, attached by the loader for FILE_READ_AUGMENTS only. */
  __missiles?: AugmentGameData['missiles'];
}

/**
 * String-table keys tried when the mode files carry no entry for an augment (about 1 in 14, e.g. Mayhem's
 * "ReEnergize" → kiwi_reenergize_tooltip, "ARAM_TheBrutalizer" → cherry_thebrutalizer_summary).
 */
function fallbackKeys(nameId: string | undefined): string[] {
  if (!nameId) return [];
  const n = nameId.replace(/^ARAM_/i, '').replace(/_Active$/i, '').toLowerCase();
  return ['kiwi_', 'kiwi_augment_', 'cherry_', 'augment_'].flatMap((p) => [`${p}${n}_tooltip`, `${p}${n}_summary`]);
}

const RARITY: Record<string, Rarity> = { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic', kEventChoice: 'event' };

export async function buildAugmentTexts(src: AugmentSources): Promise<AugmentText[]> {
  const data = new Map<number, AugmentData>();
  const pools = new Map<number, PoolSource[]>();
  for (const bin of src.bins) {
    for (const v of Object.values(bin) as (AugmentData | AugmentPool)[]) {
      if (v?.__type === 'AugmentPool') { const pool = v as AugmentPool; for (const id of pool.ids) { const p = pools.get(id) ?? []; if (!p.includes(pool.source)) p.push(pool.source); pools.set(id, p); } }
      else if (v?.__type === 'AugmentData') { const d = v as AugmentData; if (d.AugmentPlatformId && !data.has(d.AugmentPlatformId)) data.set(d.AugmentPlatformId, d); }
    }
  }
  const modesOf = (ids: number[]) => [...new Set(ids.flatMap((id) => (pools.get(id) ?? []).flatMap((s) => POOL_MODE[s] ?? [])))].sort();
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
    for (const key of [d?.AugmentTooltipTra, d?.DescriptionTra, ...fallbackKeys(a.augmentNameId)]) {
      const raw = await lookup(key);
      if (raw === undefined || isUntranslated(raw)) continue;
      const c = resolveSpellValues(await expand(raw), d?.__spell, { dropLiveLines: true });
      if (c.text.replace(/<[^>]+>/g, '').trim()) candidates.push(c); // every line was a live counter: nothing to show
    }
    const best =
      candidates.find((c) => c.unresolved === 0) ??
      candidates.reduce<(typeof candidates)[number] | undefined>((b, c) => (!b || c.unresolved <= b.unresolved ? c : b), undefined);
    const html = best ? cleanText(best.text) : '';
    const enName = enNames.get(a.id) ?? '';
    const name = isUntranslated(a.nameTRA) ? enName : a.nameTRA;
    // "???" = unreleased test augment; a blank English name = the game's internal placeholder (GoH_PentakillAug_Generic_BlankName).
    if (!name || /^[?؟\s]+$/.test(name) || (enNames.has(a.id) && !enName.trim())) continue;
    out.push({
      id: a.id,
      ids: [a.id],
      name,
      enName,
      html,
      described: html !== '',
      rarity: RARITY[a.rarity] ?? 'event',
      // T050: the pools that list it, not the id's size. No pool lists it: no mode (unknown), not a guess.
      modes: modesOf([a.id]),
      pools: pools.has(a.id) ? { [a.id]: pools.get(a.id)! } : {},
      iconUrl: assetUrl(a.augmentSmallIconPath),
      ...(d?.__missiles && d.__spell ? { game: { spell: { DataValues: d.__spell.DataValues, mSpellCalculations: d.__spell.mSpellCalculations }, missiles: d.__missiles } } : {}),
    });
  }

  // An augment that exists in both modes with the same text is shown once.
  const merged = new Map<string, AugmentText>();
  for (const t of out) {
    const twin = merged.get(`${t.name}\u0000${t.html}`);
    if (!twin) merged.set(`${t.name}\u0000${t.html}`, t);
    else {
      // Each id keeps its own pools: an Arena id does not borrow its Mayhem twin's membership.
      twin.ids.push(t.id);
      twin.pools = { ...twin.pools, ...t.pools };
      twin.modes = modesOf(twin.ids);
      // T050 v4: the Mayhem id leads the entry (its id, rarity, icon and file data), whatever the list's order, so every consumer that reads
      // the entry's id (the offers, the plan, the values) reads the Mayhem one. Its file data is its own: none borrowed from the Arena twin.
      const isMayhem = (id: number) => (pools.get(id) ?? []).some((s) => POOL_MODE[s] === 'mayhem');
      if (isMayhem(t.id) && !isMayhem(twin.id)) {
        Object.assign(twin, { id: t.id, ids: [t.id, ...twin.ids.filter((x) => x !== t.id)], rarity: t.rarity, iconUrl: t.iconUrl });
        if (t.game) twin.game = t.game; else delete twin.game;
      }
    }
  }
  return [...merged.values()].sort((x, y) => x.name.localeCompare(y.name, 'ar'));
}
