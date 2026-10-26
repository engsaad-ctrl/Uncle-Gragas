import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CDRAGON_BASE, loadCdragonJson } from '../../src/texts/cdragon.js';

const DAY = 24 * 60 * 60 * 1000;
let cacheDir: string;
let calls: string[];

const okFetch = (body: unknown) =>
  (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

const failFetch = (async (url: string | URL | Request) => {
  calls.push(String(url));
  throw new Error('offline');
}) as typeof fetch;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'lolh-'));
  calls = [];
});

describe('loadCdragonJson', () => {
  it('fetches the right URL and caches the result', async () => {
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    expect(r).toEqual({ data: [1], fetchedAt: 1000, stale: false });
    expect(calls).toEqual([`${CDRAGON_BASE}/ar_ae/v1/items.json`]);
  });

  it('serves the cache inside the TTL without fetching', async () => {
    await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    calls = [];
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000 + DAY - 1, fetchImpl: okFetch([2]) });
    expect(r.data).toEqual([1]);
    expect(calls).toEqual([]);
  });

  it('refetches after the TTL', async () => {
    await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000 + DAY, fetchImpl: okFetch([2]) });
    expect(r).toEqual({ data: [2], fetchedAt: 1000 + DAY, stale: false });
  });

  it('returns the stale cache when the fetch fails', async () => {
    await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000 + DAY, fetchImpl: failFetch });
    expect(r).toEqual({ data: [1], fetchedAt: 1000, stale: true });
  });

  it('treats a non-200 response as a failure', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(loadCdragonJson('ar_ae', 'x.json', { cacheDir, fetchImpl: notFound })).rejects.toThrow('HTTP 404');
  });

  it('throws when the fetch fails and there is no cache', async () => {
    await expect(loadCdragonJson('en_us', 'perks.json', { cacheDir, fetchImpl: failFetch })).rejects.toThrow('offline');
  });
});
