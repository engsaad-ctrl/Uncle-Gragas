import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diskCache } from '../src/diskCache.js';

describe('diskCache', () => {
  it('shares one load between calls for the same file made while it runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolh-dc-'));
    let loads = 0;
    const load = async () => (loads++, await new Promise((r) => setTimeout(r, 20)), { n: 1 });
    const [a, b] = await Promise.all([diskCache(join(dir, 'x.json'), () => false, load), diskCache(join(dir, 'x.json'), () => false, load)]);
    expect(loads).toBe(1);
    expect(a).toBe(b);
    expect(await readdir(dir)).toEqual(['x.json']); // written through a temp file, nothing left behind
    expect(JSON.parse(await readFile(join(dir, 'x.json'), 'utf8')).data).toEqual({ n: 1 });
  });

  it('keeps the key it was saved under, and returns the old copy marked stale when a refresh fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolh-dc-'));
    const path = join(dir, 'v.json');
    await diskCache(path, () => false, async () => 'old', { key: '16.21', now: () => 5 });
    const fresh = await diskCache(path, (e) => e.key === '16.21', async () => 'new');
    expect(fresh).toEqual({ data: 'old', fetchedAt: 5, stale: false });
    const failed = await diskCache(path, (e) => e.key === '16.22', async () => Promise.reject(new Error('offline')));
    expect(failed).toEqual({ data: 'old', fetchedAt: 5, stale: true });
  });
});
