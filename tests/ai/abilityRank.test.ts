import { describe, expect, it } from 'vitest';
import metadata from '../fixtures/game/spell-ranks-16.21.json' with { type: 'json' };
import { allocateAbilityRanks, estimatedAbilityRank, skillPlanOf, type AbilityRankRecord } from '../../src/ai/abilityRank.js';
import { fight } from '../../src/ai/cardMath.js';

const fixtures: Record<string, { record: AbilityRankRecord; tooltipRanks: (number | null)[] }> = metadata.champions;
const rank = (alias: string, level: number, key: 'Q' | 'W' | 'E' | 'R' = 'R') => {
  const { record, tooltipRanks } = fixtures[alias]!;
  return estimatedAbilityRank(record, key, level, tooltipRanks['QWER'.indexOf(key)] ?? undefined);
};

describe('rank availability from the 16.21 game assets', () => {
  it.each(['ahri', 'gragas', 'nasus', 'karthus', 'aphelios', 'hwei'])('%s unlocks ordinary R at 6/11/16', (alias) => {
    expect([3, 5, 6, 10, 11, 15, 16, 18].map((level) => rank(alias, level).rank)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it.each(['elise', 'nidalee', 'karma'])('%s keeps its four-rank R available from level 1', (alias) => {
    expect([1, 5, 6, 10, 11, 15, 16, 18].map((level) => rank(alias, level).rank)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('reads Jayce single-rank stance when the tooltip omits the count', () => {
    expect(rank('jayce', 1)).toEqual({ rank: 1, ranks: 1 });
    expect(rank('jayce', 18)).toEqual({ rank: 1, ranks: 1 });
    expect(rank('jayce', 18, 'Q')).toEqual({ rank: 6, ranks: 6 });
  });

  it('bounds the six-rank Udyr stance by the levels its file names', () => {
    expect([1, 6, 11, 15, 18].map((level) => rank('udyr', level).rank)).toEqual([1, 3, 6, 6, 6]);
  });

  it('uses tooltip count before override length, and treats an omitted level as unrestricted', () => {
    expect(rank('aphelios', 18, 'W')).toEqual({ rank: 5, ranks: 5 });
    expect(rank('hwei', 1, 'Q')).toEqual({ rank: 1, ranks: 5 });
  });

  it('clamps the basic estimate when a custom rank is unavailable', () => {
    const record: AbilityRankRecord = { SpellLevelUpInfoList: { List: [{ mRequirements: [{}, { mRequirements: [{ __type: 'CharacterLevelRequirement', mLevel: 12 }] }] }] } };
    expect(estimatedAbilityRank(record, 'Q', 10, 2)).toEqual({ rank: 1, ranks: 2 });
    expect(estimatedAbilityRank(record, 'Q', 12, 2)).toEqual({ rank: 2, ranks: 2 });
  });

  it('does not accept an invalid tooltip rank count', () => {
    expect(estimatedAbilityRank({}, 'R', 5, Infinity)).toEqual({ rank: 0, ranks: 3 });
    expect(estimatedAbilityRank({}, 'Q', 18, 0)).toEqual({ rank: 5, ranks: 5 });
    expect(estimatedAbilityRank({ SpellLevelUpInfoList: { List: [{ mRequirements: [{}] }] } }, 'Q', 18, 5)).toEqual({ rank: 1, ranks: 5 });
  });
});

it('does not cast a locked-by-level R, and reads each available rank in the fight', () => {
  const bin = {
    rec: { __type: 'CharacterRecord', spells: ['', '', '', 'r'], baseHPModifiable: { baseValue: 1000 } },
    r: { __type: 'SpellObject', mSpell: {
      cooldownTime: [90, 90, 90, 90],
      DataValues: [{ name: 'Damage', values: [0, 100, 200, 300, 300, 300, 300] }],
      mClientData: { mTooltipData: { mLists: { LevelUp: { levelCount: 3 } } } },
      mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'Damage' }] } },
    } },
  };
  const at = (level: number) => fight({ bin, level, shop: {}, items: [], cards: [], kit: { damage: 'magic', attacks: false } });
  expect(at(5).casts.R).toBeUndefined();
  expect(at(5).fromAbilities).toBe(0);
  expect([6, 10, 11, 15, 16].map((level) => at(level).perCast.R)).toEqual([100, 100, 200, 200, 300]);
  expect([6, 11, 16].map((level) => at(level).casts.R)).toEqual([1, 1, 1]);
});

describe('legal skill-point allocation', () => {
  const ranksOf = (alias: string, level: number, o?: Parameters<typeof allocateAbilityRanks>[3]) => {
    const { record, tooltipRanks } = fixtures[alias]!;
    const counts = Object.fromEntries(['Q', 'W', 'E', 'R'].map((k, i) => [k, tooltipRanks[i] ?? undefined]));
    const a = allocateAbilityRanks(record, counts, level, o);
    return [a.Q.rank, a.W.rank, a.E.rank, a.R.rank];
  };
  it('spends one point a level, never above a rank the level allows, for every pinned champion', () => {
    for (const [alias, { record, tooltipRanks }] of Object.entries(fixtures)) for (let level = 1; level <= 18; level++) {
      const counts = Object.fromEntries(['Q', 'W', 'E', 'R'].map((k, i) => [k, tooltipRanks[i] ?? undefined]));
      const a = allocateAbilityRanks(record, counts, level);
      for (const k of ['Q', 'W', 'E', 'R'] as const) expect(a[k].rank, `${alias} ${k} ${level}`).toBeLessThanOrEqual(estimatedAbilityRank(record, k, level, counts[k]).rank);
      const free = a.R.ranks <= 4 && a.R.ranks !== 3 && a.R.rank > 0 ? 1 : 0; // a starting form's rank comes with level 1
      expect(a.Q.rank + a.W.rank + a.E.rank + a.R.rank - free, `${alias} ${level}`).toBeLessThanOrEqual(level);
    }
  });
  it('gives an ordinary champion one point in each basic first, R when it opens, then the lowest rank', () => {
    expect(ranksOf('ahri', 1)).toEqual([1, 0, 0, 0]);
    expect(ranksOf('ahri', 3)).toEqual([1, 1, 1, 0]);
    expect(ranksOf('ahri', 9)).toEqual([3, 3, 2, 1]); // the old level/3 estimate gave 3, 3, 3 and R: ten points at level 9
    expect(ranksOf('ahri', 18)).toEqual([5, 5, 5, 3]);
  });
  it('gives a starting form its free rank at level 1 (Elise, Nidalee, Karma, Jayce)', () => {
    expect(ranksOf('elise', 1)).toEqual([1, 0, 0, 1]);
    expect(ranksOf('jayce', 1)).toEqual([1, 0, 0, 1]);
  });
  it('follows a known max order within the rank rule', () => {
    expect(ranksOf('ahri', 9, { order: ['Q', 'E', 'W'] })).toEqual([5, 1, 2, 1]); // level 8 cannot take Q5 (level 9), so E
  });
  it('levels an Udyr-like R as a basic skill, all points spent by 18', () => {
    const r = ranksOf('udyr', 18);
    expect(r.reduce((a, b) => a + b, 0)).toBe(18);
  });
  it('uses ranks read at a level as they are, and goes on from them at later levels only', () => {
    const from = { level: 9, ranks: { Q: 5, W: 1, E: 2, R: 1 } };
    expect(ranksOf('ahri', 9, { from })).toEqual([5, 1, 2, 1]);
    expect(ranksOf('ahri', 11, { from })).toEqual([5, 2, 2, 2]); // level 10 to the lowest rank (W), level 11 to R
    expect(ranksOf('ahri', 7, { from })).toEqual(ranksOf('ahri', 7)); // a later reading says nothing of level 7
    const { record, tooltipRanks } = fixtures.ahri!;
    const a = allocateAbilityRanks(record, { Q: tooltipRanks[0]!, W: tooltipRanks[1]!, E: tooltipRanks[2]!, R: tooltipRanks[3]! }, 9, { from: { level: 9, ranks: { Q: 9 } } });
    expect([a.Q.rank, a.Q.read]).toEqual([5, true]); // clamped to the rank count
  });
});

describe('skill order from the build page', () => {
  const at = (level: number, o: Parameters<typeof allocateAbilityRanks>[3]) => { const a = allocateAbilityRanks({}, { Q: 5, W: 5, E: 5, R: 3 }, level, o); return [a.Q.rank, a.W.rank, a.E.rank, a.R.rank]; };
  it('follows a level-by-level sequence where it is legal, the rule elsewhere', () => {
    const sequence = ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W', 'R', 'W', 'W'] as const;
    expect(at(9, { sequence: [...sequence] })).toEqual([5, 1, 2, 1]);
    expect(at(18, { sequence: [...sequence] })).toEqual([5, 5, 5, 3]);
    // Q at level 2 is not legal (rank 2 from level 3): that point goes by the rule, to W.
    expect(at(2, { sequence: ['Q', 'Q'] })).toEqual([1, 1, 0, 0]);
  });
  it('keeps only Q W E R from a page, and nothing when nothing is usable', () => {
    expect(skillPlanOf(['q', ' W', 'x', 'E'], ['Q', 'R', 'E', 'W'])).toEqual({ sequence: ['Q', 'W', 'E'], order: ['Q', 'E', 'W'] });
    expect(skillPlanOf([], undefined)).toBeUndefined();
    expect(skillPlanOf(['?'], ['?'])).toBeUndefined();
  });
});

describe('review fixes (2026-11-09 night)', () => {
  it('takes an ordinary ultimate when it opens even if the page sequence never lists R', () => {
    const a = allocateAbilityRanks({}, { Q: 5, W: 5, E: 5, R: 3 }, 11, { sequence: ['Q', 'W', 'E', 'Q', 'Q', 'Q', 'Q', 'E', 'E', 'E', 'E'] });
    expect([a.Q.rank, a.W.rank, a.E.rank, a.R.rank]).toEqual([4, 1, 4, 2]); // R at 6 and 11 instead of the page's Q and E there
    expect(a.Q.rank + a.W.rank + a.E.rank + a.R.rank).toBe(11);
  });
});
