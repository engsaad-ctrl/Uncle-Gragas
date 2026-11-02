import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { augmentLift, augmentLink, heroEdge, openStats, toOpenStats } from '../../src/stats/openStats.js';

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

describe('augmentLink', () => {
  const s = toOpenStats('16.21', { 1: { games: 1000, wins: 500 }, 2: { games: 1000, wins: 500 } }, { 1: { 10: { games: 300, wins: 150 }, 20: { games: 100, wins: 90 }, 40: { games: 29, wins: 29 } }, 2: { 10: { games: 100, wins: 50 }, 20: { games: 100, wins: 10 } } });
  const shrunk = (games: number, usual: number) => (games + 50 * usual) / (1000 + 50) / usual;
  it('reads how much more often the champion takes it than everyone does', () => {
    expect(augmentLink(s, 1, 10)).toBeCloseTo(shrunk(300, 0.2));
    expect(augmentLink(s, 2, 10)).toBeCloseTo(shrunk(100, 0.2));
    expect(augmentLink(s, 1, 10)!).toBeGreaterThan(1);
    expect(augmentLink(s, 2, 10)!).toBeLessThan(1);
  });
  it('leaves winning out', () => {
    expect(augmentLink(s, 1, 20)).toBeCloseTo(1);
    expect(augmentLink(s, 2, 20)).toBeCloseTo(1);
  });
  it('is null without data, or with too few games to say', () => {
    expect(augmentLink(s, 3, 10)).toBeNull();
    expect(augmentLink(s, 1, 30)).toBeNull();
    expect(augmentLink(s, 1, 40)).toBeNull();
  });
  it('pulls a small cell toward 1', () => {
    const small = toOpenStats('16.21', { 1: { games: 40, wins: 20 }, 2: { games: 9960, wins: 4980 } }, { 1: { 10: { games: 30, wins: 15 } }, 2: { 10: { games: 70, wins: 35 } } });
    const raw = 30 / 40 / (100 / 10000);
    expect(augmentLink(small, 1, 10)!).toBeLessThan(raw);
    expect(augmentLink(small, 1, 10)!).toBeGreaterThan(1);
  });
});
