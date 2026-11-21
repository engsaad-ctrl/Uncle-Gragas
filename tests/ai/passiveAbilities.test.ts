import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

// T201: four abilities with a cooldown of 0 at every rank, no mana and no reading row are not cast (a list, Codex T201). Before, the slot loop
// cast each every second for 0 (Vayne W 12 times a fight), and each cast fired ability_cast. Vayne W and Vi W are third-hit passives: a share
// of the target's max health every third attack, held as an average per attack. Fixtures: each champion's 16.22 record and that spell.
const itemOps = Object.fromEntries(ITEM_NUMBERS.map((item) => [item.id, item.ops]));
const HP = 2500;
const load = (file: string) => JSON.parse(readFileSync(`tests/fixtures/game/${file}-16.22.json`, 'utf8'));
const dv = (f: { path: string; bin: Record<string, { mSpell: { DataValues: { name: string; values: number[] }[] } }> }, name: string, rank: number) =>
  f.bin[f.path]!.mSpell.DataValues.find((d) => d.name === name)!.values[rank]!;
const run = (f: { bin: Record<string, unknown> }, key: 'W' | 'E', level: number, rank: number, cards: CardNumbers[] = []) => fight({
  bin: f.bin as never, shop: {}, itemOps, items: [], passive: [], level, kit: { damage: 'physical', attacks: true },
  knownRanks: { level, ranks: { Q: 0, W: 0, E: 0, R: 0, [key]: rank } },
  cards, enemy: { hp: HP, armor: 0, mr: 0, physicalShare: 0.5 },
});
const card = (ops: CardNumbers['ops']): CardNumbers => ({ id: 990201, name: 'AD oracle', status: 'computed', ops });

it.each([[3, 1], [9, 3], [13, 5]])('Vayne W at level %s rank %s is no cast; every attack deals a third of max(DamageFloor, MaxHealthRatio x health) true', (level, rank) => {
  const f = load('vayne-w');
  const r = run(f, 'W', level, rank);
  expect(r.casts.W ?? 0).toBe(0);
  expect(r.attacks).toBeGreaterThan(0);
  expect(r.fromCards / r.attacks).toBeCloseTo(Math.max(dv(f, 'DamageFloor', rank), dv(f, 'MaxHealthRatio', rank) * HP) / 3, 6);
});

it.each([[3, 1], [9, 3], [13, 5]])('Vi W at level %s rank %s is no cast; every attack deals MaxHealthDamage points of health over three attacks', (level, rank) => {
  const f = load('vi-w');
  const r = run(f, 'W', level, rank);
  expect(r.casts.W ?? 0).toBe(0);
  expect(dv(f, 'StacksBeforeEffect', rank)).toBe(2); // the third attack carries it
  expect(r.fromCards / r.attacks).toBeCloseTo((dv(f, 'MaxHealthDamage', rank) / 100) * HP / 3, 6); // no bonus AD here, so ADCoefficient adds 0
});

it('Vi W reads bonus AD at each hit: 100 bonus AD held adds ADCoefficient x 100 points; gained mid-fight, only the later hits carry it', () => {
  const f = load('vi-w');
  const rank = 3, n = dv(f, 'StacksBeforeEffect', rank) + 1;
  const each = (bonusAd: number) => ((dv(f, 'MaxHealthDamage', rank) + dv(f, 'ADCoefficient', rank) * bonusAd) / 100) * HP / n;
  const held = run(f, 'W', 9, rank, [card([{ op: 'add', stat: 'ad', value: 100 }])]);
  expect(held.fromCards / held.attacks).toBeCloseTo(each(100), 6);
  const none = run(f, 'W', 9, rank);
  const later = run(f, 'W', 9, rank, [card([{ op: 'timed', trigger: 'attack', stat: 'ad', value: 100, mode: 'add', duration: Infinity, decays: false, stacks_max: 1, refresh: true, internal_cooldown: null } as CardNumbers['ops'][number]])]);
  expect(later.attacks).toBe(none.attacks);
  expect(later.fromCards).toBeGreaterThan(none.fromCards + (later.attacks - 2) * (each(100) - each(0)) - 1e-6); // every hit after the first carries it
  expect(later.fromCards).toBeLessThanOrEqual(none.fromCards + later.attacks * (each(100) - each(0)) + 1e-6);
});

it('Gangplank E (barrel charges, no cooldown or mana in the file) is no cast and says it is not modelled', () => {
  const r = run(load('gangplank-e'), 'E', 9, 3);
  expect(r.casts.E ?? 0).toBe(0);
  expect(r.notModelled.some((n) => /^E: قدرة بلا تبريد/.test(n))).toBe(true);
});
