import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseOpgg } from '../../src/stats/opggFormat.js';
import { BUILD_FIELDS, OpggStats, toBuild, type CallTool } from '../../src/stats/opgg.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/opgg/${name}`, import.meta.url), 'utf8');
let cacheDir: string;
let calls: { name: string; args: Record<string, unknown> }[];

const fake = (answers: Record<string, string>): CallTool => async (name, args) => {
  calls.push({ name, args });
  const key = name === 'lol_get_champion_analysis' ? `${args.game_mode}` : name;
  if (!(key in answers)) throw new Error('offline');
  return answers[key];
};
const answers = { ranked: fixture('ahri-ranked-mid.txt'), aram: fixture('ahri-aram.txt'), lol_list_aram_augments: fixture('ahri-mayhem-augments.txt') };

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'lolh-opgg-'));
  calls = [];
});

describe('OpggStats.build', () => {
  it('asks OP.GG for the right champion, mode and fields', async () => {
    await new OpggStats(fake(answers), cacheDir).build('Ahri', 'ranked', 'mid');
    expect(calls).toEqual([
      { name: 'lol_get_champion_analysis', args: { champion: 'AHRI', game_mode: 'ranked', position: 'mid', lang: 'en_US', desired_output_fields: BUILD_FIELDS } },
    ]);
  });

  it('maps the real ranked answer into a build', async () => {
    const { data: b } = await new OpggStats(fake(answers), cacheDir).build('Ahri', 'ranked', 'mid');
    expect(b).toMatchObject({ games: 104125, winRate: 0.51, pickRate: 0.1, banRate: 0.03 });
    expect(b.core).toMatchObject({ ids: [3118, 4645, 3157], games: 6908 });
    expect(b.core!.winRate).toBeCloseTo(3619 / 6908);
    expect(b.boots!.ids).toEqual([3020]);
    expect(b.starter!.ids).toEqual([1056, 2003, 2003]);
    expect(b.fourth.map((p) => p.ids)).toEqual([[3089], [3157], [3135]]); // Rabadon, Zhonya, Void Staff
    expect(b.sixth).toHaveLength(3);
    expect(b.spells!.ids).toEqual([4, 14]);
    expect(b.runes).toMatchObject({ primaryStyle: 8100, subStyle: 8200, perks: [8112, 8139, 8140, 8106, 8210, 8226], statMods: [5005, 5008, 5001] });
    expect(b.skillOrder.slice(0, 3)).toEqual(['W', 'Q', 'E']);
    expect(b.skillPriority).toEqual(['Q', 'W', 'E']);
  });

  it('copes with sections missing from the ARAM answer', async () => {
    const { data: b } = await new OpggStats(fake(answers), cacheDir).build('Ahri', 'aram', 'mid');
    expect(b.sixth).toEqual([]);
    expect(b.core!.ids.length).toBeGreaterThan(0);
  });

  it('caches for 6 hours, then refetches', async () => {
    let now = 1_000;
    const stats = new OpggStats(fake(answers), cacheDir, () => now);
    await stats.build('Ahri', 'ranked', 'mid');
    now += 6 * 3600_000 - 1;
    await stats.build('Ahri', 'ranked', 'mid');
    expect(calls).toHaveLength(1);
    now += 1;
    await stats.build('Ahri', 'ranked', 'mid');
    expect(calls).toHaveLength(2);
  });

  it('serves stale data when OP.GG fails, and throws when there is none', async () => {
    let now = 1_000;
    await new OpggStats(fake(answers), cacheDir, () => now).build('Ahri', 'ranked', 'mid');
    now += 7 * 3600_000;
    const stale = await new OpggStats(fake({}), cacheDir, () => now).build('Ahri', 'ranked', 'mid');
    expect(stale).toMatchObject({ stale: true, fetchedAt: 1_000 });
    await expect(new OpggStats(fake({}), cacheDir).build('Ahri', 'aram', 'mid')).rejects.toThrow('offline');
  });
});

describe('toBuild counters', () => {
  it('reads who the champion beats and who beats it, with its own win rate (real Ahri mid answer)', () => {
    const b = toBuild(parseOpgg(readFileSync(new URL('../fixtures/opgg/ahri-counters.txt', import.meta.url), 'utf8')));
    expect(b.strongAgainst[0]).toEqual({ id: 901, games: 134, winRate: 0.63 }); // Smolder
    expect(b.weakAgainst.map((c) => c.id)).toEqual([887, 99, 238]); // Gwen, Lux, Zed
    expect(b.weakAgainst[0].winRate).toBe(0.45);
  });
});

describe('OpggStats.mayhemAugments', () => {
  it('maps the real answer to id/tier/performance/popularity', async () => {
    const { data } = await new OpggStats(fake(answers), cacheDir).mayhemAugments(103);
    expect(calls[0]).toMatchObject({ name: 'lol_list_aram_augments', args: { champion_id: 103 } });
    expect(data.length).toBeGreaterThan(100);
    expect(data[0]).toEqual({ id: 2127, tier: 3, performance: 88.9, popularity: 0.2 });
  });
});

describe('OpggStats.laneMeta / mapItems', () => {
  const metaAnswers = { lol_list_lane_meta_champions: fixture('meta-all.txt'), lol_list_items: fixture('items-SUMMONERS_RIFT.json') };

  it('maps the real tier list for every lane', async () => {
    const { data } = await new OpggStats(fake(metaAnswers), cacheDir).laneMeta();
    expect(calls[0]).toMatchObject({ name: 'lol_list_lane_meta_champions', args: { position: 'all' } });
    expect(Object.keys(data)).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
    expect(data.mid[0]).toEqual({ champion: 'Ahri', tier: 1, rank: 1, rankPrev: 1, winRate: 0.51, pickRate: 0.1, banRate: 0.03, games: 100660 });
    expect(data.jungle[0].champion).toBe("Cho'Gath");
    expect(data.adc).toHaveLength(39);
  });

  it('maps the real item list of a map and caches it for a day', async () => {
    let now = 0;
    const stats = new OpggStats(fake(metaAnswers), cacheDir, () => now);
    const { data } = await stats.mapItems('SUMMONERS_RIFT');
    expect(calls[0]).toMatchObject({ name: 'lol_list_items', args: { map: 'SUMMONERS_RIFT' } });
    expect(data).toHaveLength(314);
    expect(data[0]).toEqual({ id: 1001, gold: 300, purchasable: true, from: [], into: [3005, 3047, 3008, 3006, 3009, 3010, 3020, 3111, 3117, 3158] });
    now = 23 * 3600_000;
    await stats.mapItems('SUMMONERS_RIFT');
    expect(calls).toHaveLength(1);
  });
});

describe('OpggStats.aramTiers', () => {
  // The real answer shape for one champion's ARAM summary (2026-10): play, win_rate, pick_rate, ban_rate, kda, tier, rank
  const summary = (s: string) => `class LolGetChampionAnalysis: data\nclass Data: summary\nclass Summary: average_stats\nclass AverageStats: play,win_rate,pick_rate,ban_rate,kda,tier,rank\n\nLolGetChampionAnalysis(Data(Summary(AverageStats(${s}))))`;
  const byChampion: Record<string, string> = { AHRI: summary('53798,0.52,0.11,null,3.49,2,16'), ZED: summary('27599,0.46,0.06,null,2.76,4,164') };
  const call: CallTool = async (name, args) => {
    calls.push({ name, args });
    if (!(String(args.champion) in byChampion)) throw new Error('no data');
    return byChampion[String(args.champion)];
  };
  const champs = [{ alias: 'Zed', enName: 'Zed' }, { alias: 'Ahri', enName: 'Ahri' }, { alias: 'Nope', enName: 'Nope' }];

  it('ranks every champion by its ARAM summary, skipping ones without data, and caches the list for a day', async () => {
    const { data } = await new OpggStats(call, cacheDir).aramTiers(champs);
    expect(data.map((r) => [r.champion, r.rank, r.tier, r.games])).toEqual([['Ahri', 16, 2, 53798], ['Zed', 164, 4, 27599]]);
    expect(calls.every((c) => c.args.game_mode === 'aram')).toBe(true);
    await new OpggStats(call, cacheDir).aramTiers(champs);
    expect(calls).toHaveLength(3);
  });

  it('fails when no champion answers, so a saved list is used instead of an empty one', async () => {
    await expect(new OpggStats(fake({}), cacheDir).aramTiers(champs)).rejects.toThrow(/ARAM/);
  });
});
