// What a shared Mayhem game may contain. Checked by the server before storing and by the app before using, since anyone
// can send anything: only known keys pass, so a name or an account id cannot travel inside a game.

import type { MayhemGame } from './mayhemGames.js';

export const STAT_KEYS = [
  'kills', 'deaths', 'assists', 'champLevel', 'goldEarned',
  'totalDamageDealtToChampions', 'physicalDamageDealtToChampions', 'magicDamageDealtToChampions', 'trueDamageDealtToChampions',
  'totalDamageTaken', 'damageSelfMitigated', 'totalHeal', 'totalUnitsHealed',
  'timeCCingOthers', 'totalTimeCrowdControlDealt', 'damageDealtToTurrets',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

const GAME_KEYS = new Set(['id', 'at', 'duration', 'version', 'players']);
const PLAYER_KEYS = new Set(['champion', 'win', 'augments', 'items', 'stats']);
const STATS = new Set<string>(STAT_KEYS);
const DAY = 86_400_000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o: object, allowed: Set<string>) => Object.keys(o).every((k) => allowed.has(k));
const ids = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => Number.isInteger(x) && x > 0 && x < 1_000_000);

function validPlayer(p: unknown): boolean {
  if (!isObject(p) || !onlyKeys(p, PLAYER_KEYS)) return false;
  if (!Number.isInteger(p.champion) || (p.champion as number) <= 0 || (p.champion as number) > 5000 || typeof p.win !== 'boolean') return false;
  if (!ids(p.augments, 6) || !ids(p.items, 7)) return false;
  if (p.stats === undefined) return true;
  return isObject(p.stats) && onlyKeys(p.stats, STATS) && Object.values(p.stats).every((x) => typeof x === 'number' && x >= 0 && x < 10_000_000);
}

/** Ten players split into a winning and a losing five, on a real patch, not from the future. */
export function validGame(g: unknown, now = Date.now()): g is MayhemGame {
  if (!isObject(g) || !onlyKeys(g, GAME_KEYS)) return false;
  if (!Number.isSafeInteger(g.id) || (g.id as number) <= 0) return false;
  if (typeof g.at !== 'number' || g.at < now - 400 * DAY || g.at > now + DAY) return false;
  if (g.duration !== undefined && (typeof g.duration !== 'number' || g.duration < 60 || g.duration > 7200)) return false;
  if (typeof g.version !== 'string' || !/^\d+\.\d+\.[\d.+\w-]{0,30}$/.test(g.version)) return false;
  if (!Array.isArray(g.players) || g.players.length !== 10 || !g.players.every(validPlayer)) return false;
  const players = g.players as { win: boolean }[];
  const team = (list: { win: boolean }[]) => list.every((p) => p.win === list[0].win);
  return team(players.slice(0, 5)) && team(players.slice(5)) && players[0].win !== players[5].win;
}

/**
 * A shared game's number, from what happened in it: the same for every sender, so a repeat is still caught, and it
 * can't be looked up the way Riot's game id could. 53 bits (cyrb53), plenty for games of a patch.
 */
export function shareId(g: Pick<MayhemGame, 'version' | 'players'>): number {
  const text = JSON.stringify([g.version, g.players.map((p) => [p.champion, p.augments, p.items])]);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 2654435761);
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** What leaves this machine: Riot's game id replaced, and the start time only to the hour. */
export const anonymous = (g: MayhemGame): MayhemGame => ({ ...g, id: shareId(g), at: g.at - (g.at % 3_600_000) });

/** A shared game as it must arrive: valid, and carrying its own number rather than Riot's. */
export const validShared = (g: unknown, now = Date.now()): g is MayhemGame => validGame(g, now) && g.id === shareId(g);

/** A game collected here and the same game received from others count once. */
export function uniqueGames(games: MayhemGame[]): MayhemGame[] {
  const seen = new Set<number>();
  return games.filter((g) => {
    const id = shareId(g);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
