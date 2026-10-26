// The one JSON cache on disk used by every downloader (CommunityDragon, game files, OP.GG, augments).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Cached<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

interface Entry<T> {
  fetchedAt: number;
  /** What the copy belongs to, e.g. the game version. */
  key?: string;
  data: T;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Returns the copy on disk while `fresh` accepts it, else loads and saves a new one.
 * When loading fails the older copy comes back marked stale; with no copy the error is thrown.
 * Calls for the same file while one is loading share that load (no duplicate downloads, no racing writes).
 */
export function diskCache<T>(
  path: string,
  fresh: (entry: { fetchedAt: number; key?: string }) => boolean,
  load: () => Promise<T>,
  opts: { key?: string; now?: () => number } = {},
): Promise<Cached<T>> {
  const running = inFlight.get(path);
  if (running) return running as Promise<Cached<T>>;
  const work = (async (): Promise<Cached<T>> => {
    const cached = await readFile(path, 'utf8')
      .then((s) => JSON.parse(s) as Entry<T>)
      .catch(() => null);
    if (cached && fresh(cached)) return { data: cached.data, fetchedAt: cached.fetchedAt, stale: false };
    try {
      const entry: Entry<T> = { fetchedAt: (opts.now ?? Date.now)(), key: opts.key, data: await load() };
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(entry));
      await rename(tmp, path); // readers never see a half-written file
      return { data: entry.data, fetchedAt: entry.fetchedAt, stale: false };
    } catch (err) {
      if (cached) return { data: cached.data, fetchedAt: cached.fetchedAt, stale: true };
      throw err;
    }
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, work);
  return work;
}

export async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
