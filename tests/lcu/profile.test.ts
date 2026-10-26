import { describe, expect, it } from 'vitest';
import fx from '../fixtures/lcu/profile.json' with { type: 'json' };
import type { LcuCall } from '../../src/lcu/client.js';
import { loadProfile, parsePuuid, toMatches, toRanked, toRecentPlayers } from '../../src/lcu/profile.js';

// Synthetic answers in the shapes the LCU documents; not yet checked against a live client.
const ME = fx.summoner.puuid;

describe('client profile answers', () => {
  it('keeps only ranked queues with a rank', () => {
    expect(toRanked(fx.ranked)).toEqual([{ queue: 'solo', tier: 'GOLD', division: 'II', lp: 54, wins: 30, losses: 25 }]);
    expect(toRanked({ queueMap: { RANKED_FLEX_SR: { tier: 'SILVER', division: 'I', leaguePoints: 10, wins: 3, losses: 1 } } })[0]).toMatchObject({ queue: 'flex', tier: 'SILVER' });
    expect(toRanked(null)).toEqual([]);
  });

  it('reads my line of each game, newest first, with CS, items and spells', () => {
    const m = toMatches(fx.matches, ME);
    expect(m.map((x) => x.gameId)).toEqual([102, 101]);
    expect(m[1]).toMatchObject({ championId: 103, win: true, kills: 8, deaths: 2, assists: 6, cs: 200, level: 16, items: [3089, 3020, 3340], spells: [4, 14], queueId: 420 });
    expect(m[0]).toMatchObject({ championId: 238, win: false, cs: 0, items: [], spells: [] });
  });

  it('lists recent players once each, newest first, without me', () => {
    const r = toRecentPlayers(fx.recent, ME);
    expect(r.map((x) => [x.gameName, x.championId])).toEqual([['OldName', 54], ['Ally', 238]]);
  });

  it('accepts only puuid-shaped ids from the window', () => {
    expect(parsePuuid(undefined)).toBeNull();
    expect(parsePuuid(ME)).toBe(ME);
    for (const bad of ['../lol-perks/v1/pages', 'a b', 'x'.repeat(10), 5]) expect(() => parsePuuid(bad)).toThrow(/bad puuid/);
  });

  it('asks the client for me, or for another player by puuid', async () => {
    const asked: string[] = [];
    const answers: Record<string, unknown> = {
      '/lol-summoner/v1/current-summoner': fx.summoner,
      '/lol-ranked/v1/current-ranked-stats': fx.ranked,
      [`/lol-match-history/v1/products/lol/${ME}/matches?begIndex=0&endIndex=19`]: fx.matches,
      '/lol-match-history/v1/recently-played-summoners': fx.recent,
    };
    const call: LcuCall = async (_m, path) => (asked.push(path), answers[path] ?? null);
    const me = await loadProfile(call, null);
    expect(me).toMatchObject({ gameName: 'Saad', tagLine: 'ME1', level: 312, iconId: 29 });
    expect(me.recent).toHaveLength(2);
    asked.length = 0;
    await expect(loadProfile(call, 'p2-puuid-bbbbbbbbbbbbbbbbbbbbbbbb')).rejects.toThrow(/لم يجد العميل/); // unknown player
    expect(asked).toEqual(['/lol-summoner/v2/summoners/puuid/p2-puuid-bbbbbbbbbbbbbbbbbbbbbbbb']);
  });
});
