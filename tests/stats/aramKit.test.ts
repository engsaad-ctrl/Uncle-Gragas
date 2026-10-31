import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kitStats, kitVersion, toKitStats } from '../../src/stats/aramKit.js';

const file = {
  champion: { stats: { sampleCount: 1000, winRate: 0.57, name: 'x' } },
  augments: { all: [{ id: 1054, sampleCount: 500, winRate: 0.6, extra: 1 }, { id: -1, sampleCount: 5, winRate: 0.5 }, { id: 7, sampleCount: 5, winRate: 7 }] },
  items: { unfiltered: { all: [{ id: 3084, sampleCount: 100, winRate: 0.5 }] } },
};

describe('toKitStats', () => {
  it('keeps the numbers used and drops the rest', () => {
    expect(toKitStats(file)).toEqual({ games: 1000, winRate: 0.57, augments: [{ id: 1054, games: 500, winRate: 0.6 }], items: [{ id: 3084, games: 100, winRate: 0.5 }] });
  });
  it('refuses a changed shape', () => {
    for (const bad of [null, {}, { ...file, champion: {} }, { ...file, augments: { all: [] } }, { ...file, items: {} }]) expect(() => toKitStats(bad)).toThrow(/shape/);
  });
});

it('finds the data version in the page, and refuses a page without one', () => {
  expect(kitVersion('x "https://data.aramkit.com/data/16.21-20261030-5f02d4c12c0d/stats" y')).toBe('16.21-20261030-5f02d4c12c0d');
  expect(() => kitVersion('<html>')).toThrow(/version/);
});

describe('kitStats', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'kit-'));
  const site = (log: string[] = []) => (async (url: string) => {
    log.push(url);
    return url.endsWith('/en-US') ? new Response('key:data/16.21-20261030-abcdef12:x') : new Response(JSON.stringify(file));
  }) as unknown as typeof fetch;

  it('reads a champion once a day', async () => {
    const cacheDir = dir(), log: string[] = [];
    expect((await kitStats(4, { cacheDir, fetchImpl: site(log) })).data.games).toBe(1000);
    await kitStats(4, { cacheDir, fetchImpl: site(log) });
    expect(log).toEqual(['https://aramkit.com/en-US', 'https://data.aramkit.com/data/16.21-20261030-abcdef12/stats/all/champion-details/4.json']);
  });
  it('keeps the old copy when the site is out of reach, and fails plainly without one', async () => {
    const cacheDir = dir();
    await kitStats(4, { cacheDir, fetchImpl: site() });
    const down = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const later = () => Date.now() + 2 * 86_400_000;
    expect((await kitStats(4, { cacheDir, fetchImpl: down, now: later })).stale).toBe(true);
    await expect(kitStats(5, { cacheDir, fetchImpl: down })).rejects.toThrow(/500/);
  });
});
