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

/** Adds the Mayhem games among the player's last 50 that are not stored yet; returns how many it added. */
export async function collectMayhemGames(call: LcuCall, file: string): Promise<number> {
  const me = obj(await call('GET', '/lol-summoner/v1/current-summoner'));
  if (typeof me?.puuid !== 'string') return 0;
  const list = await call('GET', `/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=49`);
  const stored = await readMayhemGames(file);
  const have = new Set(stored.map((g) => g.id));
  const added: MayhemGame[] = [];
  for (const g of arr(obj(obj(list)?.games)?.games).map(obj)) {
    if (!g || !isMayhem(g) || have.has(Number(g.gameId))) continue;
    const game = toMayhemGame(await call('GET', `/lol-match-history/v1/games/${g.gameId}`));
    if (game) added.push(game);
  }
  if (!added.length) return 0;
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify([...stored, ...added]));
  await rename(tmp, file); // a crash mid-write leaves the old file whole
  return added.length;
}
