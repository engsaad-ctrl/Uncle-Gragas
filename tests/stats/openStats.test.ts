import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { augmentLift, heroEdge, openStats, toOpenStats } from '../../src/stats/openStats.js';

const heroes = { 4: { name: 'x', games: 1000, wins: 570, win_rate: 0.57 }, bad: { games: 1, wins: 1 }, 5: { games: 10, wins: 11 } };
const augments = { 4: { 1054: { games: 100000, wins: 68000, low_sample: false }, 1055: { games: 3, wins: 3 } } };

describe('toOpenStats', () => {
  it('keeps the numbers and drops what is wrong', () => {
    const s = toOpenStats('16.21', heroes, augments);
    expect(s.heroes).toEqual({ 4: { games: 1000, wins: 570 } });
    expect(s.augments[4][1054]).toEqual({ games: 100000, wins: 68000 });
  });
  it('refuses a changed or empty shape', () => {
    expect(() => toOpenStats(1, heroes, augments)).toThrow();
    expect(() => toOpenStats('16.21', [], augments)).toThrow();
    expect(() => toOpenStats('16.21', {}, {})).toThrow();
  });
});

describe('what it says', () => {
  const s = toOpenStats('16.21', heroes, augments);
  it('gives a champion its distance from even', () => {
    expect(heroEdge(s, 4)).toBeCloseTo(7);
    expect(heroEdge(s, 9)).toBeNull();
  });
  it('gives an augment what it adds, and keeps a tiny sample near nothing', () => {
    expect(augmentLift(s, 4, 1054)!.points).toBeGreaterThan(10);
    expect(augmentLift(s, 4, 1055)!.points).toBeLessThan(1);
    expect(augmentLift(s, 4, 9)).toBeNull();
  });
});

describe('openStats', () => {
  const server = (paths: Record<string, unknown>) => (async (url: string) => {
    const hit = Object.entries(paths).find(([k]) => url.endsWith(k));
    return new Response(hit ? JSON.stringify(hit[1]) : '', { status: hit ? 200 : 404 });
  }) as unknown as typeof fetch;
  const dir = () => mkdtempSync(join(tmpdir(), 'open-'));

  it('follows latest.json, and keeps the old copy when the source breaks', async () => {
    const cacheDir = dir();
    const ok = server({ '/latest.json': { path: 'patches/16.21/normal', patch: '16.21' }, '/heroes.json': heroes, '/hero_augments.json': augments });
    expect((await openStats({ cacheDir, fetchImpl: ok })).data.patch).toBe('16.21');
    const later = () => Date.now() + 7 * 3_600_000;
    const r = await openStats({ cacheDir, fetchImpl: server({}), now: later });
    expect(r.stale).toBe(true);
    expect(r.data.heroes[4].wins).toBe(570);
  });
  it('refuses a path that leaves the data folder', async () => {
    await expect(openStats({ cacheDir: dir(), fetchImpl: server({ '/latest.json': { path: '../../evil', patch: '16.21' } }) })).rejects.toThrow(/bad path/);
  });
});
