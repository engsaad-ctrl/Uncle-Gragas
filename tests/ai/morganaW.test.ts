import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { SPELL_HITS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

// T183: Morgana W (Tormented Shadow) deals TotalMinDamage every second for WDuration 5 s (its tooltip); with no reading row the engine read
// TotalMaxDamage once. Fixture: her 16.23 character record and W spell from the game files.
const fixture = JSON.parse(readFileSync('tests/fixtures/game/morgana-w-16.23.json', 'utf8'));
const path = 'Characters/Morgana/Spells/MorganaWAbility/MorganaW';
const itemOps = Object.fromEntries(ITEM_NUMBERS.map((item) => [item.id, item.ops]));
const run = (level: number, rank: number, ap: number) => fight({
  bin: fixture.bin, shop: {}, itemOps, items: [], passive: [], level,
  kit: { damage: 'magic', attacks: false },
  knownRanks: { level, ranks: { Q: 0, W: rank, E: 0, R: 0 } },
  cards: ap ? [{ id: 990001, name: 'AP oracle', status: 'computed', ops: [{ op: 'add', stat: 'ap', value: ap }] } as CardNumbers] : [],
  enemy: { hp: 3500, armor: 0, mr: 0, physicalShare: 0.5 },
});
const dv = (name: string, rank: number) => fixture.bin[path].mSpell.DataValues.find((d: { name: string }) => d.name === name).values[rank];

it('Morgana W reads five seconds of its per-second minimum', () => {
  expect(fixture.bin.rec.spells[1]).toBe(path);
  expect(dv('WDuration', 1)).toBe(5);
  expect(SPELL_HITS[path]).toMatchObject({ hits: 5, calc: 'TotalMinDamage' });
  expect(SPELL_HITS[path].notModelled).toMatch(/خمس ثوانٍ/); // the scenario is said: full exposure, credited at the cast, no missing-health rise
});

it.each([[3, 1], [9, 3], [13, 5]])('Morgana W at level %s rank %s deals 5 x (BaseDamage + 0.2 AP) a cast', (level, rank) => {
  for (const ap of [0, 100]) {
    const result = run(level, rank, ap);
    expect(result.casts.W).toBeGreaterThan(0);
    expect(result.fromAbilities / result.casts.W).toBeCloseTo(5 * (dv('BaseDamage', rank) + dv('BaseAPRatio', rank) * ap), 4);
  }
});
