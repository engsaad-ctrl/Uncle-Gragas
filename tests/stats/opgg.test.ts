import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD_FIELDS, OpggStats, type CallTool } from '../../src/stats/opgg.js';

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

describe('OpggStats.mayhemAugments', () => {
  it('maps the real answer to id/tier/performance/popularity', async () => {
    const { data } = await new OpggStats(fake(answers), cacheDir).mayhemAugments(103);
    expect(calls[0]).toMatchObject({ name: 'lol_list_aram_augments', args: { champion_id: 103 } });
    expect(data.length).toBeGreaterThan(100);
    expect(data[0]).toEqual({ id: 2127, tier: 3, performance: 88.9, popularity: 0.2 });
  });
});
