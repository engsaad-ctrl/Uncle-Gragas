// Profile, ranked stats, match history and recently played players, read from the League client's local API
// (the same data the client's own profile page shows). Answer shapes follow the LCU's documented endpoints;
// every field is read defensively because none of this is verified against a live client yet.

import type { LcuCall } from './client.js';

export interface RankedQueue {
  queue: 'solo' | 'flex';
  tier: string;
  division: string;
  lp: number;
  wins: number;
  losses: number;
}

export interface MatchRow {
  gameId: number;
  createdAt: number;
  durationSec: number;
  queueId: number;
  gameMode: string;
  championId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  level: number;
  items: number[];
  spells: number[];
}

export interface RecentPlayer {
  puuid: string;
  gameName: string;
  tagLine: string;
  championId: number;
  playedAt: number;
}

export interface RawProfile {
  puuid: string;
  gameName: string;
  tagLine: string;
  level: number;
  iconId: number;
  ranked: RankedQueue[];
  matches: MatchRow[];
  /** Only for the logged-in player. */
  recent: RecentPlayer[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const QUEUE_KEY: Record<string, RankedQueue['queue']> = { RANKED_SOLO_5x5: 'solo', RANKED_FLEX_SR: 'flex' };

/** /lol-ranked/v1/current-ranked-stats or /ranked-stats/{puuid}: unranked queues are left out. */
export function toRanked(answer: unknown): RankedQueue[] {
  const a = obj(answer);
  const queues = arr(a?.queues).length ? arr(a?.queues) : Object.entries(obj(a?.queueMap) ?? {}).map(([k, v]) => ({ ...obj(v), queueType: k }));
  return queues.flatMap((q) => {
    const o = obj(q);
    const queue = QUEUE_KEY[str(o?.queueType)];
    const tier = str(o?.tier);
    if (!queue || !tier || tier === 'NONE') return [];
    return [{ queue, tier, division: str(o?.division) === 'NA' ? '' : str(o?.division), lp: num(o?.leaguePoints), wins: num(o?.wins), losses: num(o?.losses) }];
  });
}

/**
 * /lol-match-history/v1/products/lol/{puuid}/matches: each game lists only the player asked about,
 * so the participant whose identity matches the puuid is "mine" (the first one if identities are missing).
 */
export function toMatches(answer: unknown, puuid: string): MatchRow[] {
  const games = arr(obj(obj(answer)?.games)?.games);
  return games.flatMap((g) => {
    const game = obj(g);
    const ids = arr(game?.participantIdentities).map(obj);
    const pid = num(ids.find((i) => str(obj(i?.player)?.puuid) === puuid)?.participantId);
    const parts = arr(game?.participants).map(obj);
    const me = parts.find((p) => num(p?.participantId) === pid) ?? parts[0];
    const s = obj(me?.stats);
    if (!game || !me || !s) return [];
    return [{
      gameId: num(game.gameId),
      createdAt: num(game.gameCreation),
      durationSec: num(game.gameDuration),
      queueId: num(game.queueId),
      gameMode: str(game.gameMode),
      championId: num(me.championId),
      win: s.win === true,
      kills: num(s.kills),
      deaths: num(s.deaths),
      assists: num(s.assists),
      cs: num(s.totalMinionsKilled) + num(s.neutralMinionsKilled),
      level: num(s.champLevel),
      items: [0, 1, 2, 3, 4, 5, 6].map((i) => num(s[`item${i}`])).filter((id) => id > 0),
      spells: [num(me.spell1Id), num(me.spell2Id)].filter((id) => id > 0),
    }];
  }).sort((a, b) => b.createdAt - a.createdAt);
}

/** /lol-match-history/v1/recently-played-summoners, newest first, one row per player. */
export function toRecentPlayers(answer: unknown, myPuuid: string): RecentPlayer[] {
  const seen = new Set<string>([myPuuid]);
  return arr(answer)
    .map(obj)
    .flatMap((p) => {
      const puuid = str(p?.puuid);
      if (!puuid || seen.has(puuid)) return [];
      seen.add(puuid);
      return [{ puuid, gameName: str(p?.gameName) || str(p?.summonerName), tagLine: str(p?.tagLine), championId: num(p?.championId), playedAt: num(p?.gameCreationDate) }];
    })
    .sort((a, b) => b.playedAt - a.playedAt);
}

/** A puuid from the window: Riot's are 78 characters of letters, digits, "-" and "_". */
export function parsePuuid(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^[\w-]{20,100}$/.test(v)) throw new Error('bad puuid');
  return v;
}

/** The logged-in player (puuid null) or another player, as the client knows them. */
export async function loadProfile(call: LcuCall, puuid: string | null): Promise<RawProfile> {
  const summoner = obj(await call('GET', puuid ? `/lol-summoner/v2/summoners/puuid/${puuid}` : '/lol-summoner/v1/current-summoner'));
  const id = str(summoner?.puuid);
  if (!summoner || !id) throw new Error(puuid ? 'لم يجد العميل هذا اللاعب.' : 'لم يُسجَّل الدخول في عميل اللعبة بعد.');
  const [ranked, matches, recent] = await Promise.all([
    call('GET', puuid ? `/lol-ranked/v1/ranked-stats/${id}` : '/lol-ranked/v1/current-ranked-stats').catch(() => null),
    call('GET', `/lol-match-history/v1/products/lol/${id}/matches?begIndex=0&endIndex=19`).catch(() => null),
    puuid ? Promise.resolve(null) : call('GET', '/lol-match-history/v1/recently-played-summoners').catch(() => null),
  ]);
  return {
    puuid: id,
    gameName: str(summoner.gameName) || str(summoner.displayName),
    tagLine: str(summoner.tagLine),
    level: num(summoner.summonerLevel),
    iconId: num(summoner.profileIconId),
    ranked: toRanked(ranked),
    matches: toMatches(matches, id),
    recent: toRecentPlayers(recent, id),
  };
}
