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
  championWins: number;
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
    championWins: rows.filter((p) => p.win).length,
    augments: tally(rows.map((p) => ({ win: p.win, ids: p.augments }))),
    items: tally(rows.map((p) => ({ win: p.win, ids: p.items }))),
  };
}

/** A game's patch: "16.21.712.4567" is "16.21". */
export const patchOf = (g: MayhemGame) => g.version.split('.').slice(0, 2).join('.');

/** The games of the newest patch among them: an older patch's numbers say little about this one. */
export function latestPatch(games: MayhemGame[]): MayhemGame[] {
  const newest = games.reduce<MayhemGame | null>((a, g) => (!a || g.at > a.at ? g : a), null);
  return newest ? games.filter((g) => patchOf(g) === patchOf(newest)) : [];
}

// Games an augment needs before its own win rate weighs as much as the champion's.
const PRIOR_GAMES = 20;

/** Best first by win rate, each pulled toward the champion's own until it has enough games to stand on. */
export function rankByWins<T extends { games: number; wins: number }>(list: T[], champion: { games: number; wins: number }): T[] {
  const base = champion.games ? champion.wins / champion.games : 0.5;
  const score = (x: T) => (x.wins + PRIOR_GAMES * base) / (x.games + PRIOR_GAMES);
  return [...list].sort((a, b) => score(b) - score(a));
}
