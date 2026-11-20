import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fight } from '../../src/ai/cardMath.js';
import { SPELL_HITS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

// T192: three abilities keep their damage in data values that no calculation reads, so the fight cast them for 0. Fixtures: each champion's 16.22
// record and that spell from the game files (frozen cache).
const itemOps = Object.fromEntries(ITEM_NUMBERS.map((item) => [item.id, item.ops]));
const HP = 2500;
const cases = [
  { file: 'drmundo-q', key: 'Q', kit: { damage: 'magic' as const, attacks: true } },
  { file: 'evelynn-e', key: 'E', kit: { damage: 'magic' as const, attacks: true } },
  { file: 'garen-r', key: 'R', kit: { damage: 'physical' as const, attacks: true } },
];
const load = (file: string) => JSON.parse(readFileSync(`tests/fixtures/game/${file}-16.22.json`, 'utf8'));
const run = (fixture: { bin: Record<string, unknown> }, key: string, level: number, rank: number) => fight({
  bin: fixture.bin as never, shop: {}, itemOps, items: [], passive: [], level, kit: cases.find((c) => c.key === key)!.kit,
  knownRanks: { level, ranks: { Q: 0, W: 0, E: 0, R: 0, [key]: rank } },
  cards: [], enemy: { hp: HP, armor: 0, mr: 0, physicalShare: 0.5 },
});
const dv = (fixture: { path: string; bin: Record<string, { mSpell: { DataValues: { name: string; values: number[] }[] } }> }, name: string, rank: number) =>
  fixture.bin[fixture.path]!.mSpell.DataValues.find((d) => d.name === name)!.values[rank]!;

it.each([[3, 1], [9, 3], [13, 5]])('Dr. Mundo Q at level %s rank %s deals CurrentHealthDamage of half the target health', (level, rank) => {
  const f = load('drmundo-q');
  expect(SPELL_HITS[f.path]).toMatchObject({ share: 'CurrentHealthDamage', current: true });
  const r = run(f, 'Q', level, rank);
  expect(r.casts.Q).toBeGreaterThan(0);
  expect(Math.abs(r.perCast.Q - (dv(f, 'CurrentHealthDamage', rank) * HP * 0.5))).toBeLessThanOrEqual(0.5); // perCast is rounded to a whole number
});

it.each([[3, 1], [9, 3], [13, 5]])('Evelynn E at level %s rank %s deals BaseDamage plus BasePercentHealth points of max health', (level, rank) => {
  const f = load('evelynn-e');
  const r = run(f, 'E', level, rank);
  expect(r.casts.E).toBeGreaterThan(0);
  expect(Math.abs(r.perCast.E - (dv(f, 'BaseDamage', rank) + (dv(f, 'BasePercentHealth', rank) / 100) * HP))).toBeLessThanOrEqual(0.5); // perCast is rounded to a whole number
});

it.each([[6, 1], [11, 2], [16, 3]])('Garen R at level %s rank %s deals its BaseDamage', (level, rank) => {
  const f = load('garen-r');
  const r = run(f, 'R', level, rank);
  expect(r.casts.R).toBeGreaterThan(0);
  expect(Math.abs(r.perCast.R - (dv(f, 'BaseDamage', rank)))).toBeLessThanOrEqual(0.5); // perCast is rounded to a whole number
  expect(SPELL_HITS[f.path]!.notModelled).toMatch(/ExecuteDamage/); // the missing-health part is said, not guessed
});
