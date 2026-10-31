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
