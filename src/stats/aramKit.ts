// One champion's Mayhem numbers from ARAMKit (aramkit.com), read the way its page reads them, only when that champion is
// looked at and at most once a day: its terms allow personal, non-commercial use and forbid bulk scraping, so this never
// walks the site. Only the numbers used are kept. Against AramHex its augment lifts correlate 0.968, so it adds item rates
// more than new augment evidence; if the site changes or is out of reach, the app goes on without it.

import { join } from 'node:path';
import { diskCache, type Cached } from '../diskCache.js';

const SITE = 'https://aramkit.com';
const DATA = 'https://data.aramkit.com/data';
const DAY = 86_400_000;
const WAIT_MS = 8000;

export interface KitRow {
  id: number;
  games: number;
  winRate: number;
}

export interface KitStats {
  games: number;
  winRate: number;
  augments: KitRow[];
  items: KitRow[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const validRate = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const rows = (v: unknown): KitRow[] =>
  (Array.isArray(v) ? v : []).flatMap((r) =>
    isObject(r) && Number.isInteger(r.id) && (r.id as number) > 0 && typeof r.sampleCount === 'number' && r.sampleCount > 0 && validRate(r.winRate)
      ? [{ id: r.id as number, games: r.sampleCount, winRate: r.winRate }]
      : [],
  );

/** A champion's file, down to the numbers used. A shape that changed throws, and the older copy stays in use. */
export function toKitStats(answer: unknown): KitStats {
  const a = isObject(answer) ? answer : {};
  const champion = isObject(a.champion) && isObject(a.champion.stats) ? a.champion.stats : {};
  const augments = isObject(a.augments) ? rows(a.augments.all) : [];
  const items = isObject(a.items) && isObject(a.items.unfiltered) ? rows(a.items.unfiltered.all) : [];
  if (typeof champion.sampleCount !== 'number' || champion.sampleCount <= 0 || !validRate(champion.winRate) || !augments.length || !items.length) throw new Error('aramkit: unexpected shape');
  return { games: champion.sampleCount, winRate: champion.winRate, augments, items };
}

/** The data version is named in the site's own page, e.g. "16.21-20261030-5f02d4c12c0d". */
export function kitVersion(html: string): string {
  const m = /data\/(\d+\.\d+-\d+-[0-9a-f]{6,})/.exec(html);
  if (!m) throw new Error('aramkit: no data version on the page');
  return m[1];
}

export function kitStats(champion: number, opts: { cacheDir: string; fetchImpl: typeof fetch; now?: () => number }): Promise<Cached<KitStats>> {
  const now = opts.now ?? Date.now;
  const get = async (url: string) => {
    const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(WAIT_MS) }); // slow internet: go on without it
    if (!res.ok) throw new Error(`aramkit: HTTP ${res.status}`);
    return res;
  };
  return diskCache(
    join(opts.cacheDir, 'aramkit', `${champion}.json`),
    (e) => now() - e.fetchedAt < DAY,
    async () => {
      const version = kitVersion(await (await get(`${SITE}/en-US`)).text());
      return toKitStats(await (await get(`${DATA}/${version}/stats/all/champion-details/${champion}.json`)).json());
    },
    { now },
  );
}
