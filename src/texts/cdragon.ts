import { join } from 'node:path';
import { diskCache, type Cached } from '../diskCache.js';

export const CDRAGON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global';

// CommunityDragon serves English under the locale name "default".
export type Locale = 'ar_ae' | 'default';

export interface LoadOptions {
  cacheDir: string;
  ttlMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export type Loaded<T> = Cached<T>;

export function loadCdragonJson<T>(locale: Locale, file: string, opts: LoadOptions): Promise<Loaded<T>> {
  const { cacheDir, ttlMs = 24 * 60 * 60 * 1000, now = Date.now, fetchImpl = fetch } = opts;
  return diskCache<T>(
    join(cacheDir, 'cdragon', locale, file),
    (e) => now() - e.fetchedAt < ttlMs,
    async () => {
      const res = await fetchImpl(`${CDRAGON_BASE}/${locale}/v1/${file}`);
      if (!res.ok) throw new Error(`CommunityDragon ${locale}/${file}: HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    { now },
  );
}
