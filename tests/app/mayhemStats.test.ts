import { describe, expect, it } from 'vitest';
import { latestPatch, mayhemStats, rankByWins } from '../../src/app/mayhemStats.js';

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
