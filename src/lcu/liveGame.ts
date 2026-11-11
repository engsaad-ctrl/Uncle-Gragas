// The game's own Live Client Data API (https://127.0.0.1:2999/liveclientdata), which Riot serves on this machine while a match runs:
// every player's champion and the items he holds right now. Read-only, no login. The owner, 2026-11-08: the engine reads the enemy's real items.
import { lcuCaller } from './client.js';
import { MAYHEM_MAX_LEVEL } from '../ai/augmentProgress.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

export type LiveTeam = 'ORDER' | 'CHAOS';
export interface LivePlayer { items: number[]; level?: number; team?: LiveTeam }
/** The active player's skill ranks (activeplayer.abilities.X.abilityLevel), read only for him. */
export type LiveRanks = Partial<Record<'Q' | 'W' | 'E' | 'R', number>>;
/** belowThree: his live level was 1 or 2, before the first augment offer (the pick log's start). Kept apart from level, which stays 3 to MAYHEM_MAX_LEVEL (21 in Superfans). */
export interface LiveSnapshot { players: Record<string, LivePlayer>; active?: LivePlayer & { alias: string; ranks?: LiveRanks; belowThree?: true }; enemies?: Record<string, LivePlayer> }

/** Q W E R ranks from activeplayer.abilities; a missing or odd value is left out, never guessed. */
export function ranksFromLive(abilities: unknown): LiveRanks | undefined {
  const a = obj(abilities);
  if (!a) return undefined;
  const out: LiveRanks = {};
  for (const k of ['Q', 'W', 'E', 'R'] as const) { const v = obj(a[k])?.abilityLevel; if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6) out[k] = v; }
  // All four or none: a skill left out would be read as rank 0 and the rest allocated around it.
  return Object.keys(out).length === 4 ? out : undefined;
}

/** A failed LCU poll is not a new match. Keep the epoch across disconnects and temporary live-API failures. */
export class MatchEpoch {
  value = 0;
  private pending = true;
  private id: number | undefined;
  observe(phase: string, session: unknown): boolean {
    if (['None', 'Lobby', 'ChampSelect', 'EndOfGame', 'PreEndOfGame'].includes(phase)) this.pending = true;
    if (phase !== 'InProgress') return false;
    const rawId = obj(obj(session)?.gameData)?.gameId;
    const id = typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : undefined;
    const changed = this.pending || (id !== undefined && this.id !== undefined && id !== this.id);
    if (changed) { this.value++; this.id = id; }
    this.pending = false;
    if (id !== undefined) this.id = id;
    return changed;
  }
}

/** Strip the live response down to game facts; names and player identifiers never leave this reader. */
export function playersByChampion(playerlist: unknown): Record<string, LivePlayer> {
  const out: Record<string, LivePlayer> = {};
  const duplicates = new Set<string>();
  for (const p of Array.isArray(playerlist) ? playerlist.map(obj) : []) {
    const alias = /displayname_(\w+)$/.exec(String(p?.rawChampionName ?? ''))?.[1];
    if (!alias || alias === '__proto__' || alias === 'constructor' || alias === 'prototype') continue;
    if (Object.hasOwn(out, alias) || duplicates.has(alias)) { delete out[alias]; duplicates.add(alias); continue; }
    const level = p?.level;
    const items = (Array.isArray(p?.items) ? p.items.map(obj) : []).flatMap((it) => typeof it?.itemID === 'number' && Number.isSafeInteger(it.itemID) && it.itemID > 0 ? [it.itemID] : []);
    out[alias] = { items, ...(typeof level === 'number' && Number.isInteger(level) && level >= 3 && level <= MAYHEM_MAX_LEVEL ? { level } : {}), ...(p?.team === 'ORDER' || p?.team === 'CHAOS' ? { team: p.team } : {}) };
  }
  return out;
}

/** Match the active player before removing identity. Champion alias alone is ambiguous in mirror matches. */
export function activeFromLive(active: unknown, playerlist: unknown): LiveSnapshot['active'] {
  const a = obj(active);
  if (!a || !Array.isArray(playerlist)) return undefined;
  const identity = (p: Json) => [
    typeof p.riotId === 'string' && p.riotId ? `riot:${p.riotId}` : undefined,
    typeof p.riotIdGameName === 'string' && p.riotIdGameName && typeof p.riotIdTagLine === 'string' && p.riotIdTagLine ? `riot:${p.riotIdGameName}#${p.riotIdTagLine}` : undefined,
    typeof p.summonerName === 'string' && p.summonerName ? `legacy:${p.summonerName}` : undefined,
  ].filter((s): s is string => s !== undefined);
  const players = playerlist.map(obj).filter((p): p is Json => p !== undefined);
  for (const key of identity(a)) {
    const matches = players.filter((p) => identity(p).includes(key) && (!key.startsWith('legacy:') || !identity(a).some((s) => s.startsWith('riot:')) || !identity(p).some((s) => s.startsWith('riot:'))));
    if (matches.length !== 1) continue;
    const [entry] = Object.entries(playersByChampion(matches));
    if (!entry) return undefined;
    const [alias, player] = entry;
    const level = a.level;
    const ranks = ranksFromLive(a.abilities);
    return { alias, ...player, ...(typeof level === 'number' && Number.isInteger(level) && level >= 3 && level <= MAYHEM_MAX_LEVEL ? { level } : {}), ...(level === 1 || level === 2 ? { belowThree: true as const } : {}), ...(ranks ? { ranks } : {}) };
  }
  return undefined;
}

export function snapshotFromLive(active: unknown, playerlist: unknown): LiveSnapshot | null {
  if (!Array.isArray(playerlist)) return null;
  const own = activeFromLive(active, playerlist);
  const enemyTeam = own?.team === 'ORDER' ? 'CHAOS' : own?.team === 'CHAOS' ? 'ORDER' : undefined;
  return { players: playersByChampion(playerlist), active: own, ...(enemyTeam ? { enemies: playersByChampion(playerlist.filter((p) => obj(p)?.team === enemyTeam)) } : {}) };
}

/** Two narrow official endpoints; identities are used transiently for matching and never returned or saved. */
export async function liveSnapshot(): Promise<LiveSnapshot | null> {
  const call = lcuCaller({ port: 2999, password: '' });
  const [list, active] = await Promise.all([
    call('GET', '/liveclientdata/playerlist').catch(() => null),
    call('GET', '/liveclientdata/activeplayer').catch(() => null),
  ]);
  return snapshotFromLive(active, list);
}

/** Each player's held item ids by his champion's alias (rawChampionName "game_character_displayname_MissFortune" -> MissFortune); the display name is in the client's language. */
export function itemsByChampion(playerlist: unknown): Record<string, number[]> {
  return Object.fromEntries(Object.entries(playersByChampion(playerlist)).map(([alias, p]) => [alias, p.items]));
}

/** The players' items now, or null when no match is running (the API answers only in game). */
export async function liveItems(): Promise<Record<string, number[]> | null> {
  const players = await livePlayers();
  return players ? Object.fromEntries(Object.entries(players).map(([alias, p]) => [alias, p.items])) : null;
}

export async function livePlayers(): Promise<Record<string, LivePlayer> | null> {
  const call = lcuCaller({ port: 2999, password: '' });
  const list = await call('GET', '/liveclientdata/playerlist').catch(() => null);
  return Array.isArray(list) ? playersByChampion(list) : null;
}
