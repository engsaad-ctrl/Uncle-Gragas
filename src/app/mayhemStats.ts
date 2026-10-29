// What the stored Mayhem games say about one champion: how often each augment and item was taken, and how often it won.

import type { MayhemGame } from '../lcu/mayhemGames.js';

export interface PickStat {
  id: number;
  games: number;
  wins: number;
}

export interface MayhemStats {
  /** Every stored game, and this champion's appearances in them. */
  games: number;
  championGames: number;
  augments: PickStat[];
  items: PickStat[];
}

/** Most taken first; an id counts once per player even if listed twice. */
function tally(rows: { win: boolean; ids: number[] }[]): PickStat[] {
  const m = new Map<number, PickStat>();
  for (const r of rows) {
    for (const id of new Set(r.ids)) {
      const t = m.get(id) ?? { id, games: 0, wins: 0 };
      t.games++;
      if (r.win) t.wins++;
      m.set(id, t);
    }
  }
  return [...m.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
}

export function mayhemStats(games: MayhemGame[], champion: number): MayhemStats {
  const rows = games.flatMap((g) => g.players).filter((p) => p.champion === champion);
  return {
    games: games.length,
    championGames: rows.length,
    augments: tally(rows.map((p) => ({ win: p.win, ids: p.augments }))),
    items: tally(rows.map((p) => ({ win: p.win, ids: p.items }))),
  };
}
