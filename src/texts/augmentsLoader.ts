import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
const CACHE_SCHEMA = 2;

interface Cache {
  schema: number;
  version: string;
  augments: AugmentText[];
}

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const augmentDataOnly = (bin: object) =>
  Object.values(bin).filter((v) => (v as { __type?: string } | null)?.__type === 'AugmentData');

export async function loadAugments(opts: { cacheDir: string; fetchImpl?: typeof fetch }): Promise<AugmentsResult> {
  const { cacheDir, fetchImpl = fetch } = opts;
  const path = join(cacheDir, 'augments.json');
  const cached = await readFile(path, 'utf8')
    .then((s) => JSON.parse(s) as Cache)
    .then((c) => (c.schema === CACHE_SCHEMA ? c : null))
    .catch(() => null);

  try {
    const { version } = await getJson<{ version: string }>(fetchImpl, AUGMENT_URLS.version);
    if (cached?.version === version) return { version, augments: cached.augments, stale: false };

    const [listAr, listEn, strings] = await Promise.all([
      getJson<AugmentListEntry[]>(fetchImpl, AUGMENT_URLS.listAr),
      getJson<AugmentListEntry[]>(fetchImpl, AUGMENT_URLS.listEn),
      getJson<{ entries: Record<string, string> }>(fetchImpl, AUGMENT_URLS.strings).then((t) => t.entries),
    ]);
    const bins: object[] = [];
    // One at a time and trimmed right away: these files are 4–21MB each.
    for (const url of AUGMENT_URLS.bins) bins.push(augmentDataOnly(await getJson<object>(fetchImpl, url)));

    const fresh: Cache = { schema: CACHE_SCHEMA, version, augments: await buildAugmentTexts({ listAr, listEn, bins, strings }) };
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(fresh));
    return { version, augments: fresh.augments, stale: false };
  } catch (err) {
    if (cached) return { version: cached.version, augments: cached.augments, stale: true };
    throw err;
  }
}
