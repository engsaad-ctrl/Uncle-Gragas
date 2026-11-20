import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { SPELL_HITS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

// T188: three abilities whose tooltip deals a per-second amount for some seconds, read before as one second (no SPELL_HITS row; the
// engine takes one calculation once). Fixtures: each champion's 16.23 record and that spell from the game files.
const itemOps = Object.fromEntries(ITEM_NUMBERS.map((item) => [item.id, item.ops]));
const cases = [
  { file: 'fiddlesticks', key: 'W', hits: 2, calc: 'DrainDamageCalc', base: 'DamagePerSecond', ap: 0.45 },
  { file: 'nidalee', key: 'W', hits: 4, calc: 'DamagePerSecond', base: 'BaseDamagePerTick', ap: 0.05 },
  { file: 'renekton', key: 'R', hits: 15, calc: 'TotalDamagePerSecond', base: 'AuraDamagePerSecond', ap: 0.1 },
] as const;

it.each(cases)('$file $key reads $hits seconds of its per-second $calc', ({ file, key, hits, calc, base, ap }) => {
  const fixture = JSON.parse(readFileSync(`tests/fixtures/game/${file}-tick-16.23.json`, 'utf8'));
  const path = fixture.path as string;
  expect(fixture.bin.rec.spells['QWER'.indexOf(key)]).toBe(path);
  expect(fixture.bin[path].mSpell.mSpellCalculations[calc]).toBeDefined();
  expect(SPELL_HITS[path]).toMatchObject({ hits, calc });
  expect(SPELL_HITS[path].notModelled).toBeTruthy();
  const dv = (name: string, rank: number) => fixture.bin[path].mSpell.DataValues.find((d: { name: string }) => d.name === name).values[rank];
  for (const [level, rank] of [[11, 2], [16, 3]] as const) for (const apAdd of [0, 100]) {
    const ranks = { Q: 0, W: 0, E: 0, R: 0, [key]: rank };
    const result = fight({
      bin: fixture.bin, shop: {}, itemOps, items: [], passive: [], level,
      kit: { damage: 'magic', attacks: false }, knownRanks: { level, ranks },
      cards: apAdd ? [{ id: 990001, name: 'AP oracle', status: 'computed', ops: [{ op: 'add', stat: 'ap', value: apAdd }] } as CardNumbers] : [],
      enemy: { hp: 3500, armor: 0, mr: 0, physicalShare: 0.5 },
    });
    expect(result.casts[key]).toBeGreaterThan(0);
    expect(result.fromAbilities / result.casts[key]).toBeCloseTo(hits * (dv(base, rank) + ap * apAdd), 4);
  }
});
