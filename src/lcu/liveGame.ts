// The game's own Live Client Data API (https://127.0.0.1:2999/liveclientdata), which Riot serves on this machine while a match runs:
// every player's champion and the items he holds right now. Read-only, no login. The owner, 2026-11-08: the engine reads the enemy's real items.
import { lcuCaller } from './client.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

/** Each player's held item ids by his champion's alias (rawChampionName "game_character_displayname_MissFortune" -> MissFortune); the display name is in the client's language. */
export function itemsByChampion(playerlist: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const p of Array.isArray(playerlist) ? playerlist.map(obj) : []) {
    const alias = /displayname_(\w+)$/.exec(String(p?.rawChampionName ?? ''))?.[1];
    if (!alias) continue;
    out[alias] = (Array.isArray(p?.items) ? p.items.map(obj) : []).flatMap((it) => (Number(it?.itemID) > 0 ? [Number(it!.itemID)] : []));
  }
  return out;
}

/** The players' items now, or null when no match is running (the API answers only in game). */
export async function liveItems(): Promise<Record<string, number[]> | null> {
  const call = lcuCaller({ port: 2999, password: '' });
  const list = await call('GET', '/liveclientdata/playerlist').catch(() => null);
  return list ? itemsByChampion(list) : null;
}
