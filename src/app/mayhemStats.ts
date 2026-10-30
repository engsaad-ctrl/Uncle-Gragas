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
  // What an item adds anyway, over all players: subtracted, so an item that is simply strong does not pass for a pairing.
  const players = games.flatMap((g) => g.players);
  const wins = players.filter((p) => p.win).length;
  const general = new Map(
    tally(players.map((p) => ({ win: p.win, ids: p.items.filter(isItem) }))).map((t) => [t.id, t.wins / t.games - (wins - t.wins) / Math.max(1, players.length - t.games)]),
  );
  return augments.flatMap((augment) =>
    pairedWith(games, augment, (p) => p.items.filter(isItem), minGames)
      .map(({ id, games: n, wins: w, lift }) => ({ augment, item: id, games: n, wins: w, lift: lift - (general.get(id) ?? 0) }))
      .filter((s) => s.lift > 0)
      .sort((a, b) => b.lift - a.lift),
  );
}

// Games a pair needs before its own difference counts as much as "no relationship": pairs are rare and noisy.
const PAIR_PRIOR = 100;

/**
 * How much better each other augment did next to the chosen ones than it does anyway. For a chosen A and another B: how
 * much more A-players won with B than without it, minus how much more everyone wins with B than without it, so an
 * augment that is simply strong does not pass for a fit; then pulled toward zero by PAIR_PRIOR. Averaged over the chosen
 * augments; games counts the distinct players who had B with any of them. Big Brain with Phenomenal Evil is such a pair.
 */
export function augmentPairs(games: MayhemGame[], chosen: number[], minGames = 50): Map<number, { games: number; lift: number }> {
  const players = games.flatMap((g) => g.players);
  const wins = players.filter((p) => p.win).length;
  const general = new Map(
    tally(players.map((p) => ({ win: p.win, ids: p.augments }))).map((t) => [t.id, t.wins / t.games - (wins - t.wins) / Math.max(1, players.length - t.games)]),
  );
  const sum = new Map<number, { lift: number; n: number }>();
  for (const anchor of chosen) {
    const rows = players.filter((p) => p.augments.includes(anchor));
    const rowWins = rows.filter((p) => p.win).length;
    for (const t of tally(rows.map((p) => ({ win: p.win, ids: p.augments.filter((a) => !chosen.includes(a)) })))) {
      if (t.games < minGames || rows.length - t.games < minGames) continue;
      const withA = t.wins / t.games - (rowWins - t.wins) / (rows.length - t.games);
      const lift = ((withA - (general.get(t.id) ?? 0)) * t.games) / (t.games + PAIR_PRIOR);
      const s = sum.get(t.id) ?? { lift: 0, n: 0 };
      sum.set(t.id, { lift: s.lift + lift, n: s.n + 1 });
    }
  }
  const support = (id: number) => players.filter((p) => p.augments.includes(id) && chosen.some((a) => p.augments.includes(a))).length;
  return new Map([...sum].map(([id, s]) => [id, { games: support(id), lift: s.lift / s.n }]));
}
