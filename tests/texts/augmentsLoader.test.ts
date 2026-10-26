import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import fx from '../fixtures/augments/sample.json' with { type: 'json' };
import { AUGMENT_URLS, loadAugments } from '../../src/texts/augmentsLoader.js';

let cacheDir: string;
let calls: string[];

function fakeFetch(version: string) {
  const bodies = new Map<string, unknown>([
    [AUGMENT_URLS.version, { version }],
    [AUGMENT_URLS.listAr, fx.listAr],
    [AUGMENT_URLS.listEn, fx.listEn],
    [AUGMENT_URLS.strings, { entries: fx.strings }],
    [AUGMENT_URLS.bins[0], fx.bins.cherry],
    [AUGMENT_URLS.bins[1], fx.bins.kiwi],
    [AUGMENT_URLS.bins[2], fx.bins.kiwi_jade],
    [AUGMENT_URLS.bins[3], fx.bins.map30],
  ]);
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    const body = bodies.get(String(url));
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(JSON.stringify(body));
  }) as typeof fetch;
}

const offline = (async () => {
  throw new Error('offline');
}) as typeof fetch;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'lolh-aug-'));
  calls = [];
});

describe('loadAugments', () => {
  it('downloads every source, builds the list and caches it', async () => {
    const r = await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    expect(r.version).toBe('16.21.1');
    expect(r.stale).toBe(false);
    expect(r.augments).toHaveLength(6);
    expect(new Set(calls)).toEqual(new Set([AUGMENT_URLS.version, AUGMENT_URLS.listAr, AUGMENT_URLS.listEn, AUGMENT_URLS.strings, ...AUGMENT_URLS.bins]));
    await expect(access(join(cacheDir, 'augments.json'))).resolves.toBeUndefined();
  });

  it('only checks the version when the cache is current', async () => {
    await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    calls = [];
    const r = await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    expect(calls).toEqual([AUGMENT_URLS.version]);
    expect(r.augments).toHaveLength(6);
  });

  it('rebuilds when the game version changes', async () => {
    await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    calls = [];
    const r = await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.22.1') });
    expect(r.version).toBe('16.22.1');
    expect(calls).toContain(AUGMENT_URLS.strings);
  });

  it('falls back to the cache when offline', async () => {
    await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    const r = await loadAugments({ cacheDir, fetchImpl: offline });
    expect(r).toMatchObject({ version: '16.21.1', stale: true });
    expect(r.augments).toHaveLength(6);
  });

  it('throws when offline with no cache', async () => {
    await expect(loadAugments({ cacheDir, fetchImpl: offline })).rejects.toThrow('offline');
  });
});
