import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { SPELL_HITS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

const fixture = JSON.parse(readFileSync('tests/fixtures/game/galio-w-16.22.json','utf8'));
const path = 'Characters/Galio/Spells/GalioWAbility/GalioW';
const itemOps = Object.fromEntries(ITEM_NUMBERS.map(item => [item.id,item.ops]));
const run = (level: number, rank: number, ap: number) => fight({
  bin: fixture.bin, shop: {}, itemOps, items: [], passive: [], level,
  kit: { damage: 'magic', attacks: false },
  knownRanks: { level, ranks: { Q: 0, W: rank, E: 0, R: 0 } },
  cards: ap ? [{ id: 990001, name: 'AP oracle', status: 'computed', ops: [{ op: 'add', stat: 'ap', value: ap }] } as CardNumbers] : [],
  enemy: { hp: 3500, armor: 0, mr: 0, physicalShare: 0.5 },
});

it('Galio W names an actual W-slot calculation and declares the minimum-charge scenario', () => {
  expect(fixture.bin.rec.spells[1]).toBe(path);
  expect(fixture.bin[path].mSpell.mSpellCalculations.MinTotalDamage).toBeDefined();
  expect(SPELL_HITS[path]).toMatchObject({ hits: 1, calc: 'MinTotalDamage' });
  expect(SPELL_HITS[path].notModelled).toMatch(/أدنى شحن/);
});

it.each([[1,1,20],[5,3,40],[9,5,60],[15,5,60],[18,5,60]])('Galio W at level %s rank %s pays the hand-read base %s', (level,rank,base) => {
  for (const ap of [0,100]) {
    const result = run(level,rank,ap);
    expect(result.casts.W).toBeGreaterThan(0);
    expect(result.casts.Q).toBeUndefined();
    // Raw file MinTotalDamage: MinimumWBaseDamage + 0.3 AP. No target resists or attack damage.
    expect(result.fromAbilities / result.casts.W).toBeCloseTo(base + 0.3*ap,4);
  }
});
