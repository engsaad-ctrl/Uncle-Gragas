import { join } from 'node:path';
import { diskCache, getJson } from '../diskCache.js';
import { buildAugmentTexts, FILE_READ_AUGMENTS, type AugmentListEntry, type AugmentPool, type AugmentText, type PoolSource } from './augments.js';
import { CDRAGON_BASE } from './cdragon.js';

const RAW = 'https://raw.communitydragon.org/latest';

export const AUGMENT_URLS = {
  version: `${RAW}/content-metadata.json`,
  listAr: `${CDRAGON_BASE}/ar_ae/v1/cherry-augments.json`,
  listEn: `${CDRAGON_BASE}/default/v1/cherry-augments.json`,
  strings: `${RAW}/game/ar_ae/data/menu/en_us/lol.stringtable.json`,
  bins: [
    ...['cherry', 'kiwi', 'kiwi_jade'].map((n) => `${RAW}/game/maps/modespecificdata/${n}.bin.json`),
    `${RAW}/game/data/maps/shipping/map30/map30.bin.json`,
  ],
};
/** The file each of AUGMENT_URLS.bins is, in the same order: its pool's source. */
export const BIN_SOURCES: PoolSource[] = ['cherry', 'kiwi', 'kiwi_jade', 'map30'];

/** T050: what the modes came from. 'pools': the loaded patch's own pools (ids each pool's links resolve to, per file). 'old-cache': a copy written
 * before the pools were kept (schema < 18), used offline or after a failed refresh: its modes are the old id-size labels and prove nothing. */
export type Membership = { from: 'pools'; pools: Partial<Record<PoolSource, { ids: number; unresolved: number }>> } | { from: 'old-cache' };

export interface AugmentsResult {
  version: string;
  augments: AugmentText[];
  stale: boolean;
  membership: Membership;
}

// Bump when AugmentText changes shape or what it keeps, so old caches are rebuilt.
// 18 (T050): keeps each id's mode pools. 17 is T047's (Apex Inventor's file values), kept apart until both are reviewed. An older copy is rebuilt
// online; offline or after a failed refresh diskCache still returns it, stale, and its modes are marked as from an old copy (membership).
const CACHE_SCHEMA = 18;

type MissileSpell = { mScriptName?: string; mSpell?: { mMissileSpec?: { movementComponent?: { mTravelTime?: number; mSpeed?: number } } } };

/** Keeps only AugmentData entries, each with its root spell's values attached (the rest of the bin is dropped).
 * Augments the engine reads from the files (FILE_READ_AUGMENTS) also keep their additional spells' missile movement. */
export function augmentDataOnly(bin: Record<string, unknown>, source?: PoolSource) {
  return [...augmentPools(bin, source), ...Object.values(bin).flatMap((v) => {
    const a = v as { __type?: string; RootSpell?: string; AugmentNameId?: string; AdditionalSpells?: string[] } | null;
    if (a?.__type !== 'AugmentData') return [];
    const spell = (a.RootSpell ? (bin[a.RootSpell] as { mSpell?: unknown } | undefined) : undefined)?.mSpell;
    if (!FILE_READ_AUGMENTS.has(a.AugmentNameId ?? '')) return [{ ...a, __spell: spell }];
    const missiles = (a.AdditionalSpells ?? []).flatMap((key) => {
      const o = bin[key] as MissileSpell | undefined, m = o?.mSpell?.mMissileSpec?.movementComponent;
      return m ? [{ script: o?.mScriptName ?? key, travelTime: m.mTravelTime, speed: m.mSpeed }] : [];
    });
    return [{ ...a, __spell: spell, __missiles: missiles }];
  })];
}

/** T050: the file's augment pools (an object with an AugmentList of links to AugmentData), resolved to platform ids before the file is trimmed.
 * Links match the file's keys without regard to case. A link that resolves to no AugmentData counts as unresolved; nothing is guessed for it. */
export function augmentPools(bin: Record<string, unknown>, source?: PoolSource): AugmentPool[] {
  if (!source) return [];
  const lower = new Map(Object.entries(bin).map(([k, v]) => [k.toLowerCase(), v as { __type?: string; AugmentPlatformId?: number } | null]));
  return Object.values(bin).flatMap((v) => {
    const list = (v as { AugmentList?: unknown } | null)?.AugmentList;
    if (!Array.isArray(list)) return [];
    const found = list.map((k) => (typeof k === 'string' ? lower.get(k.toLowerCase()) : undefined));
    const ids = [...new Set(found.flatMap((d) => (d?.__type === 'AugmentData' && d.AugmentPlatformId ? [d.AugmentPlatformId] : [])))];
    return [{ __type: 'AugmentPool' as const, source, ids, unresolved: found.filter((d) => !(d?.__type === 'AugmentData' && d.AugmentPlatformId)).length }];
  });
}

export async function loadAugments(opts: {
  cacheDir: string;
  fetchImpl?: typeof fetch;
  /** The game string table, when the caller already shares one download of it (see gameData.loadStringTable). */
  strings?: () => Promise<Record<string, string>>;
}): Promise<AugmentsResult> {
  const { cacheDir, fetchImpl = fetch } = opts;
  let offline: unknown;
  const version = await getJson<{ version: string }>(fetchImpl, AUGMENT_URLS.version).then(
    (m) => m.version,
    (err) => ((offline = err), null),
  );
  const schema = `${CACHE_SCHEMA}:`;
  const r = await diskCache(
    join(cacheDir, 'augments.json'),
    // Offline: any copy in the current format will do.
    (e) => (version === null ? Boolean(e.key?.startsWith(schema)) : e.key === schema + version),
    async () => {
      if (version === null) throw offline;
      const [listAr, listEn, strings] = await Promise.all([
        getJson<AugmentListEntry[]>(fetchImpl, AUGMENT_URLS.listAr),
        getJson<AugmentListEntry[]>(fetchImpl, AUGMENT_URLS.listEn),
        opts.strings?.() ?? getJson<{ entries: Record<string, string> }>(fetchImpl, AUGMENT_URLS.strings).then((t) => t.entries),
      ]);
      const bins: object[] = [];
      // One at a time and trimmed right away: these files are 4–21MB each.
      for (const [i, url] of AUGMENT_URLS.bins.entries()) bins.push(augmentDataOnly(await getJson<Record<string, unknown>>(fetchImpl, url), BIN_SOURCES[i]));
      const pools: Partial<Record<PoolSource, { ids: number; unresolved: number }>> = {};
      for (const p of bins.flat() as AugmentPool[]) if (p.__type === 'AugmentPool') { const s = (pools[p.source] ??= { ids: 0, unresolved: 0 }); s.ids += p.ids.length; s.unresolved += p.unresolved; }
      // No Mayhem pool, or one with a broken link: not written. The old copy stays (stale) rather than a list that labels nothing Mayhem.
      if (!pools.kiwi?.ids || pools.kiwi.unresolved) throw new Error(`Mayhem pool missing or invalid in kiwi.bin (${JSON.stringify(pools.kiwi ?? null)})`);
      return { version, augments: await buildAugmentTexts({ listAr, listEn, bins, strings }), pools };
    },
    { key: version === null ? undefined : schema + version },
  );
  const pools = (r.data as { pools?: Extract<Membership, { from: 'pools' }>['pools'] }).pools;
  return { version: r.data.version, augments: r.data.augments, stale: r.stale || version === null, membership: pools ? { from: 'pools', pools } : { from: 'old-cache' } };
}
