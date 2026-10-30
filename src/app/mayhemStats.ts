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

/** An item that wins more often with an augment than without it, over every champion's games. */
export interface Synergy {
  augment: number;
  item: number;
  games: number;
  wins: number;
  /** Win rate with the item (pulled toward the augment's own, see PRIOR_GAMES) minus win rate without it. */
  lift: number;
}

/** What the players of an augment also had (items or other augments), each with how much more they won with it. */
function pairedWith(games: MayhemGame[], anchor: number, pick: (p: MayhemGame['players'][number]) => number[], minGames: number) {
  const rows = games.flatMap((g) => g.players).filter((p) => p.augments.includes(anchor));
  const wins = rows.filter((p) => p.win).length;
  const base = rows.length ? wins / rows.length : 0.5;
  return tally(rows.map((p) => ({ win: p.win, ids: pick(p) })))
    .filter((t) => t.games >= minGames && rows.length - t.games >= minGames)
    .map((t) => ({ ...t, lift: (t.wins + PRIOR_GAMES * base) / (t.games + PRIOR_GAMES) - (wins - t.wins) / (rows.length - t.games) }));
}

/**
 * For each augment, the items its players won more with: Steel Your Heart with Heartsteel and Overlord's Bloodmail,
 * Upgrade Stormsurge with Stormsurge. Counted over all champions, so pairs a single champion never shows still turn up;
 * only items bought in at least minGames of those games, and not bought in at least as many.
 */
export function augmentItemSynergy(games: MayhemGame[], augments: number[], isItem: (id: number) => boolean, minGames = 15): Synergy[] {
  return augments.flatMap((augment) =>
    pairedWith(games, augment, (p) => p.items.filter(isItem), minGames)
      .filter((t) => t.lift > 0)
      .map(({ id, games: n, wins, lift }) => ({ augment, item: id, games: n, wins, lift }))
      .sort((a, b) => b.lift - a.lift),
  );
}

/**
 * How well each other augment went with the chosen ones: its lift with each chosen augment it was taken alongside
 * (minGames each way), averaged. Lets the list re-rank once the first augment is picked.
 */
export function augmentPairs(games: MayhemGame[], chosen: number[], minGames = 15): Map<number, { games: number; lift: number }> {
  const sum = new Map<number, { games: number; lift: number; n: number }>();
  for (const anchor of chosen) {
    for (const t of pairedWith(games, anchor, (p) => p.augments.filter((a) => !chosen.includes(a)), minGames)) {
      const s = sum.get(t.id) ?? { games: 0, lift: 0, n: 0 };
      sum.set(t.id, { games: s.games + t.games, lift: s.lift + t.lift, n: s.n + 1 });
    }
  }
  return new Map([...sum].map(([id, s]) => [id, { games: s.games, lift: s.lift / s.n }]));
}
