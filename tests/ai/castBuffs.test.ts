import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fight, FIGHT } from '../../src/ai/cardMath.js';
import { SPELL_HITS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

// T203: Twitch R and Vayne R deal no damage of their own; they give attack damage for a while (BonusAD for Duration, BonusAttackDamage for
// BaseDuration). Before, the cast gave nothing. Fixtures: each champion's 16.22 record and that spell (frozen cache).
const itemOps = Object.fromEntries(ITEM_NUMBERS.map((item) => [item.id, item.ops]));
const load = (file: string) => JSON.parse(readFileSync(`tests/fixtures/game/${file}-16.22.json`, 'utf8'));
const dv = (f: { path: string; bin: Record<string, { mSpell: { DataValues: { name: string; values: number[] }[] } }> }, name: string, rank: number) =>
  f.bin[f.path]!.mSpell.DataValues.find((d) => d.name === name)!.values[rank]!;
const run = (f: { bin: Record<string, unknown> }, level: number, rank: number) => fight({
  bin: f.bin as never, shop: {}, itemOps, items: [], passive: [], level, kit: { damage: 'physical', attacks: true },
  knownRanks: { level, ranks: { Q: 0, W: 0, E: 0, R: rank } },
  cards: [], enemy: { hp: 2500, armor: 0, mr: 0, physicalShare: 0.5 },
});

it('the rows name the buff and its duration in the file', () => {
  expect(SPELL_HITS[load('twitch-r').path]!.buff).toEqual({ stat: 'ad', value: 'BonusAD', duration: 'Duration' });
  expect(SPELL_HITS[load('vayne-r').path]!.buff).toEqual({ stat: 'ad', value: 'BonusAttackDamage', duration: 'BaseDuration' });
});

it('Vayne R at rank 3 over a fight no longer than it: every attack carries BonusAttackDamage more AD', () => {
  const f = load('vayne-r');
  const seconds = FIGHT.seconds;
  try {
    FIGHT.seconds = dv(f, 'BaseDuration', 3); // 12 s: cast first, so it covers every attack
    const withR = run(f, 16, 3), withoutR = run(f, 16, 0);
    expect(withR.casts.R).toBe(1);
    expect(withR.attacks).toBe(withoutR.attacks);
    const full = (withoutR.stats.ad + dv(f, 'BonusAttackDamage', 3)) / withoutR.stats.ad, ratio = withR.fromAttacks / withoutR.fromAttacks;
    expect(ratio).toBeLessThanOrEqual(full + 1e-9);
    expect(ratio).toBeGreaterThan(1 + (full - 1) * (withR.attacks - 3) / withR.attacks); // only the attacks before the cast go without it
  } finally { FIGHT.seconds = seconds; }
});

it.each([[6, 1], [11, 2], [16, 3]])('Twitch R at level %s rank %s raises attack damage only while it lasts', (level, rank) => {
  const f = load('twitch-r');
  const withR = run(f, level, rank), withoutR = run(f, level, 0);
  const full = (withoutR.stats.ad + dv(f, 'BonusAD', rank)) / withoutR.stats.ad;
  expect(withR.fromAttacks).toBeGreaterThan(withoutR.fromAttacks);
  expect(withR.fromAttacks / withoutR.fromAttacks).toBeLessThan(full); // Duration 6 s is shorter than the fight
});
