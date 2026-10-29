import { join } from 'node:path';
import { diskCache, getJson } from '../diskCache.js';
import { buildAugmentTexts, type AugmentListEntry, type AugmentText } from './augments.js';
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

export interface AugmentsResult {
  version: string;
  augments: AugmentText[];
  stale: boolean;
}

// Bump when AugmentText changes shape so old caches are rebuilt.
const CACHE_SCHEMA = 12;

/** Keeps only AugmentData entries, each with its root spell's values attached (the rest of the bin is dropped). */
function augmentDataOnly(bin: Record<string, unknown>) {
  return Object.values(bin).flatMap((v) => {
    const a = v as { __type?: string; RootSpell?: string } | null;
    if (a?.__type !== 'AugmentData') return [];
    const spell = (a.RootSpell ? (bin[a.RootSpell] as { mSpell?: unknown } | undefined) : undefined)?.mSpell;
    return [{ ...a, __spell: spell }];
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
      for (const url of AUGMENT_URLS.bins) bins.push(augmentDataOnly(await getJson<Record<string, unknown>>(fetchImpl, url)));
      return { version, augments: await buildAugmentTexts({ listAr, listEn, bins, strings }) };
    },
    { key: version === null ? undefined : schema + version },
  );
  return { version: r.data.version, augments: r.data.augments, stale: r.stale || version === null };
}
