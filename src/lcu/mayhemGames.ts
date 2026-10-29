// Mayhem games from the client's match history: champion, win, augments and items of all ten players. Riot's public
// match API leaves Mayhem out, so this is the only source of real Mayhem builds. No names or accounts are kept.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LcuCall } from './client.js';
import { isMayhem } from './diagnostics.js';

export interface MayhemPlayer {
  champion: number;
  win: boolean;
  augments: number[];
  items: number[];
}

export interface MayhemGame {
  id: number;
  /** When the game started (ms). */
  at: number;
  /** The game's patch as the client reports it, e.g. "16.21.712.4567". */
  version: string;
  players: MayhemPlayer[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const AUGMENT_KEYS = [1, 2, 3, 4, 5, 6].map((i) => `playerAugment${i}`);
const ITEM_KEYS = [0, 1, 2, 3, 4, 5, 6].map((i) => `item${i}`);

/** /lol-match-history/v1/games/{id}, reduced to what a build needs; null for anything but a Mayhem game with augments. */
export function toMayhemGame(answer: unknown): MayhemGame | null {
  const g = obj(answer);
  if (!g || !isMayhem(g)) return null;
  const players = arr(g.participants).map(obj).filter((p): p is Json => p !== null).map((p) => {
    const s = obj(p.stats) ?? {};
    const ids = (keys: string[]) => keys.map((k) => s[k]).filter((v): v is number => typeof v === 'number' && v > 0);
    return { champion: Number(p.championId), win: s.win === true, augments: ids(AUGMENT_KEYS), items: ids(ITEM_KEYS) };
  });
  if (!players.some((p) => p.augments.length)) return null;
  return { id: Number(g.gameId), at: Number(g.gameCreation) || 0, version: String(g.gameVersion ?? ''), players };
}

/** The stored games; none when the file does not exist yet. A damaged file throws, so it is never overwritten. */
export async function readMayhemGames(file: string): Promise<MayhemGame[]> {
  const text = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return '[]';
    throw err;
  });
  const games: unknown = JSON.parse(text);
  if (!Array.isArray(games)) throw new Error(`${file}: not a list of games`);
  return games as MayhemGame[];
}

// The other players of the player's own new games are looked up too, slowly and only one step out: never the players of
// their games (Riot asks for wide use of the client's API to be registered).
const OTHERS_MAX_GAMES = 40;
const OTHERS_PAUSE_MS = 300;
const history = (puuid: string, last: number) => `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=${last - 1}`;
const listed = (list: unknown) => arr(obj(obj(list)?.games)?.games).map(obj);
const puuids = (detail: unknown) =>
  arr(obj(detail)?.participantIdentities).map((i) => obj(obj(i)?.player)?.puuid).filter((p): p is string => typeof p === 'string' && p !== '');

/**
 * Adds the Mayhem games among the player's last 50 that are not stored yet, then those among the last 20 of each other
 * player of those new games (at most 40 of them per run); returns how many it added.
 */
export async function collectMayhemGames(
  call: LcuCall,
  file: string,
  pause: (ms: number) => Promise<unknown> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<number> {
  const me = obj(await call('GET', '/lol-summoner/v1/current-summoner'));
  if (typeof me?.puuid !== 'string') return 0;
  const list = await call('GET', history(me.puuid, 50));
  const stored = await readMayhemGames(file);
  const have = new Set(stored.map((g) => g.id));
  const added: MayhemGame[] = [];
  const others = new Set<string>();
  const take = async (g: Json | null) => {
    if (!g || !isMayhem(g) || have.has(Number(g.gameId))) return null;
    const detail = await call('GET', `/lol-match-history/v1/games/${g.gameId}`);
    const game = toMayhemGame(detail);
    if (!game) return null;
    added.push(game);
    have.add(game.id);
    return detail;
  };
  for (const g of listed(list)) {
    const detail = await take(g);
    for (const p of detail ? puuids(detail) : []) if (p !== me.puuid) others.add(p);
  }
  const mine = added.length;
  others: for (const p of others) {
    try {
      await pause(OTHERS_PAUSE_MS);
      for (const g of listed(await call('GET', history(p, 20)))) {
        if (added.length - mine >= OTHERS_MAX_GAMES) break others;
        if (g && isMayhem(g) && !have.has(Number(g.gameId))) await pause(OTHERS_PAUSE_MS);
        await take(g);
      }
    } catch {
      // one player's history failing (hidden, or the client busy) leaves the rest
    }
  }
  if (!added.length) return 0;
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify([...stored, ...added]));
  await rename(tmp, file); // a crash mid-write leaves the old file whole
  return added.length;
}
