import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const CDRAGON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global';

export type Locale = 'ar_ae' | 'en_us';

export interface LoadOptions {
  cacheDir: string;
  ttlMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface Loaded<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

export async function loadCdragonJson<T>(locale: Locale, file: string, opts: LoadOptions): Promise<Loaded<T>> {
  const { cacheDir, ttlMs = 24 * 60 * 60 * 1000, now = Date.now, fetchImpl = fetch } = opts;
  const path = join(cacheDir, 'cdragon', locale, file);
  const cached = await readFile(path, 'utf8')
    .then((s) => JSON.parse(s) as { fetchedAt: number; data: T })
    .catch(() => null);
  if (cached && now() - cached.fetchedAt < ttlMs) return { ...cached, stale: false };

  try {
    const res = await fetchImpl(`${CDRAGON_BASE}/${locale}/v1/${file}`);
    if (!res.ok) throw new Error(`CommunityDragon ${locale}/${file}: HTTP ${res.status}`);
    const fresh = { fetchedAt: now(), data: (await res.json()) as T };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(fresh));
    return { ...fresh, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}
