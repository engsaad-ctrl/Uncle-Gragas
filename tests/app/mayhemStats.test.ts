import { describe, expect, it } from 'vitest';
import { mayhemStats } from '../../src/app/mayhemStats.js';

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
    expect(s.augments).toEqual([{ id: 6, games: 2, wins: 1 }, { id: 5, games: 1, wins: 1 }]);
    expect(s.items).toEqual([{ id: 9, games: 2, wins: 1 }]);
  });
});
