// Champion and champion x augment win rates of Mayhem on the Chinese servers, from aramhex-data (about 21 million games
// on patch 16.21; github.com/czgreat/aramhex-data, CC BY-NC 4.0: credit it, no commercial use). Numbers only: no games,
// no players, no items. Winning with an augment isn't proof the augment caused it, but on 1,057 of our held-out games
// these rank winners at AUC 0.684 against 0.633 for our own model.

import { join } from 'node:path';
import { diskCache, getJson, type Cached } from '../diskCache.js';

const BASE = 'https://raw.githubusercontent.com/czgreat/aramhex-data/main';
const SIX_HOURS = 6 * 3_600_000;
/** Games an augment needs before its own rate weighs as much as the champion's: few games stay near no effect. */
const PRIOR_GAMES = 200;

export interface OpenStats {
  patch: string;
  /** Champion id: wins and games. */
  heroes: Record<string, { games: number; wins: number }>;
  /** Champion id, then augment id: wins and games. */
  augments: Record<string, Record<string, { games: number; wins: number }>>;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown) => (isObject(v) && Number.isFinite(v.games) && Number.isFinite(v.wins) && (v.games as number) > 0 && (v.wins as number) >= 0 && (v.wins as number) <= (v.games as number) ? { games: v.games as number, wins: v.wins as number } : null);
const counts = (o: Json) => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => { const c = count(v); return c && /^\d+$/.test(k) ? [[k, c]] : []; }));

/** Downloaded data, down to the numbers used. A shape that changed throws, and the older copy stays in use. */
export function toOpenStats(patch: unknown, heroes: unknown, augments: unknown): OpenStats {
  if (typeof patch !== 'string' || !isObject(heroes) || !isObject(augments)) throw new Error('aramhex-data: unexpected shape');
  const h = counts(heroes);
  const a = Object.fromEntries(Object.entries(augments).flatMap(([k, v]) => (isObject(v) && /^\d+$/.test(k) ? [[k, counts(v)]] : [])));
  if (!Object.keys(h).length || !Object.keys(a).length) throw new Error('aramhex-data: empty');
  return { patch, heroes: h, augments: a };
}

export function openStats(opts: { cacheDir: string; fetchImpl: typeof fetch; now?: () => number }): Promise<Cached<OpenStats>> {
  const now = opts.now ?? Date.now;
  return diskCache(
    join(opts.cacheDir, 'aramhex', 'latest.json'),
    (e) => now() - e.fetchedAt < SIX_HOURS,
    async () => {
      const latest = await getJson<{ path?: unknown; patch?: unknown }>(opts.fetchImpl, `${BASE}/latest.json`);
      if (typeof latest.path !== 'string' || !/^patches\/[\w.-]+\/[\w-]+$/.test(latest.path)) throw new Error('aramhex-data: bad path');
      const [heroes, augments] = await Promise.all([
        getJson<unknown>(opts.fetchImpl, `${BASE}/${latest.path}/heroes.json`),
        getJson<unknown>(opts.fetchImpl, `${BASE}/${latest.path}/hero_augments.json`),
      ]);
      return toOpenStats(latest.patch, heroes, augments);
    },
    { now },
  );
}

const logit = (p: number) => Math.log(p / (1 - p));

/** What winning `wins` of `games` adds to a champion's `rate`, in points (25 per unit of log-odds near even); few games stay near nothing. */
export const liftPoints = (wins: number, games: number, rate: number) => 25 * (logit((wins + PRIOR_GAMES * rate) / (games + PRIOR_GAMES)) - logit(rate));

/** How far a champion's win rate is from even, in points. */
export function heroEdge(s: OpenStats, champion: number): number | null {
  const h = s.heroes[String(champion)];
  return h ? (100 * h.wins) / h.games - 50 : null;
}

/** What an augment adds to its champion's win chance here, in points (25 per unit of log-odds near even), and from how many games. */
export function augmentLift(s: OpenStats, champion: number, augment: number): { points: number; games: number } | null {
  const h = s.heroes[String(champion)];
  const a = s.augments[String(champion)]?.[String(augment)];
  if (!h || !a) return null;
  const rate = h.wins / h.games;
  if (rate <= 0 || rate >= 1) return null;
  return { points: liftPoints(a.wins, a.games, rate), games: a.games };
}
