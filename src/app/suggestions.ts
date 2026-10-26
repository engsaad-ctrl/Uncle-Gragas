// Pick suggestions for champ select: answers to the enemy picks shown so far, else the strongest picks of the lane.

import type { Counter } from '../stats/opgg.js';
import type { ChampionListEntry } from '../texts/champions.js';
import type { TierRow } from './tierList.js';

export interface Suggestion {
  champion: ChampionListEntry;
  /** Enemies it answers, with its win rate against each. Empty for a meta pick. */
  vs: { enemy: ChampionListEntry; winRate: number }[];
  /** Meta picks only: the lane tier (1 = best) and win rate. */
  tier?: number;
  winRate?: number;
}

/**
 * `beatenBy` holds, per enemy champion, the opponents that beat it in this lane (its weakAgainst list, where
 * winRate is the enemy's own). An answer scores by how far above 50% it wins, summed over the enemies it answers.
 */
export function counterPicks(beatenBy: Map<number, Counter[]>, champions: ChampionListEntry[], taken: Set<number>, limit = 8): Suggestion[] {
  const byId = new Map(champions.map((c) => [c.id, c]));
  const found = new Map<number, Suggestion & { score: number }>();
  for (const [enemyId, list] of beatenBy) {
    const enemy = byId.get(enemyId);
    if (!enemy) continue;
    for (const c of list) {
      const champion = byId.get(c.id);
      if (!champion || taken.has(c.id)) continue;
      const winRate = 1 - c.winRate;
      const s = found.get(c.id) ?? { champion, vs: [], score: 0 };
      s.vs.push({ enemy, winRate });
      s.score += winRate - 0.5;
      found.set(c.id, s);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...s }) => s);
}

/** Before any enemy is shown: the best tiers of the lane, best rank first. */
export function metaPicks(rows: TierRow[], champions: ChampionListEntry[], taken: Set<number>, limit = 8): Suggestion[] {
  const byId = new Map(champions.map((c) => [c.id, c]));
  return rows
    .filter((r) => r.id !== null && !taken.has(r.id) && byId.has(r.id))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => ({ champion: byId.get(r.id!)!, vs: [], tier: r.tier, winRate: r.winRate }));
}
