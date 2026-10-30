import { describe, expect, it } from 'vitest';
import { augmentItemSynergy, augmentPairs, latestPatch, mayhemStats, rankByWins } from '../../src/app/mayhemStats.js';

const player = (champion: number, win: boolean, augments: number[], items: number[] = []) => ({ champion, win, augments, items });

describe('mayhemStats', () => {
  it("counts one champion's augments and items with their wins, most taken first", () => {
    const s = mayhemStats(
      [
        { id: 1, at: 0, version: '', players: [player(110, true, [5, 6], [9]), player(21, true, [5])] },
        { id: 2, at: 0, version: '', players: [player(110, false, [6, 6], [9])] },
      ],
      110,
    );
    expect(s.games).toBe(2);
    expect(s.championGames).toBe(2);
    expect(s.championWins).toBe(1);
    expect(s.augments).toEqual([{ id: 6, games: 2, wins: 1 }, { id: 5, games: 1, wins: 1 }]);
    expect(s.items).toEqual([{ id: 9, games: 2, wins: 1 }]);
  });
});

describe('latestPatch', () => {
  it("keeps only the newest game's patch", () => {
    const g = (id: number, at: number, version: string) => ({ id, at, version, players: [] });
    expect(latestPatch([g(1, 5, '16.21.1.2'), g(2, 9, '16.21.3.4'), g(3, 7, '16.20.9.9')]).map((x) => x.id)).toEqual([1, 2]);
    expect(latestPatch([])).toEqual([]);
  });
});

describe('rankByWins', () => {
  it('puts the most winning first, but does not trust a few lucky games', () => {
    const champion = { games: 200, wins: 100 }; // wins half its games
    const order = rankByWins(
      [
        { name: 'common', games: 100, wins: 50 },
        { name: 'lucky', games: 2, wins: 2 },
        { name: 'strong', games: 60, wins: 42 },
        { name: 'weak', games: 60, wins: 20 },
      ],
      champion,
    ).map((x) => x.name);
    expect(order).toEqual(['strong', 'lucky', 'common', 'weak']);
  });
});

describe('augmentItemSynergy', () => {
  it('finds the items an augment wins more with, over every champion, and only with enough games each way', () => {
    // Augment 7: with item 50 its players win 15 of 20; without it, 5 of 20. Without augment 7, item 50 makes no
    // difference (half the games either way). Item 60: too few games to judge.
    const p = (champion: number, win: boolean, items: number[]) => ({ champion, win, augments: [7], items });
    const players = [
      ...Array.from({ length: 20 }, (_, i) => p(i % 3, i < 15, [50])),
      ...Array.from({ length: 20 }, (_, i) => p(i % 3, i < 5, i < 3 ? [60] : [])),
      ...Array.from({ length: 200 }, (_, i) => ({ champion: 1, win: i % 2 === 0, augments: [], items: i < 100 ? [50] : [] })),
    ];
    const s = augmentItemSynergy([{ id: 1, at: 0, version: '', players }], [7], () => true);
    expect(s.map((x) => x.item)).toEqual([50]);
    expect(s[0]).toMatchObject({ augment: 7, games: 20, wins: 15 });
    expect(s[0].lift).toBeGreaterThan(0.2);
  });
});

describe('augmentPairs', () => {
  it('scores what an augment adds next to the chosen one beyond its usual strength', () => {
    // Augment 8 wins half its games overall but 70% next to 7; augment 9 the reverse.
    const p = (win: boolean, augments: number[]) => ({ champion: 1, win, augments, items: [] });
    const block = (n: number, wins: number, augments: number[]) => Array.from({ length: n }, (_, i) => p(i < wins, augments));
    const players = [...block(100, 70, [7, 8]), ...block(100, 30, [7, 9]), ...block(100, 30, [8]), ...block(100, 70, [9])];
    const fit = augmentPairs([{ id: 1, at: 0, version: '', players }], [7]);
    expect(fit.get(8)!.lift).toBeGreaterThan(0.15);
    expect(fit.get(9)!.lift).toBeLessThan(-0.15);
    expect(fit.get(8)!.games).toBe(100);
    expect(fit.has(7)).toBe(false);
  });
});
