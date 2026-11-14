import { describe, expect, it } from 'vitest';
import { partInteraction, partnerTerms, pickPartners, recommend } from '../../src/ai/partners.js';

// T052: the contract's denominator table and the selection rule, with an oracle computed apart.
describe('partnerTerms', () => {
  it('additive and independent (100, 150, 120, 170): I = 0, not a conflict, though the Dell ratio difference is −6.67 points', () => {
    // F(C) = F(A) = 150, F(C+B) = 170, F(R) = F(nothing) = 100, F(R+B) = 120.
    const t = partnerTerms({ C: 150, CB: 170, R: 100, RB: 120 })!;
    expect(t.interaction).toBeCloseTo(0, 12);
    expect(t.gain).toBeCloseTo(170 / 150 - 1, 12);
    const dell = (170 / 150 - 1) - (120 / 100 - 1);
    expect(dell * 100).toBeCloseTo(-6.667, 3);
  });
  it('multiplicative (100, 150, 120, 180): I = +10, while the Dell ratio difference is 0', () => {
    const t = partnerTerms({ C: 150, CB: 180, R: 100, RB: 120 })!;
    expect(t.interaction).toBeCloseTo(10, 12);
    expect((180 / 150 - 1) - (120 / 100 - 1)).toBeCloseTo(0, 12);
  });
  it('a denominator that is not positive, or a number that is not finite: not comparable (no huge ratio)', () => {
    expect(partnerTerms({ C: 0, CB: 10, R: 0, RB: 5 })).toBeUndefined();
    expect(partnerTerms({ C: 100, CB: NaN, R: 90, RB: 95 })).toBeUndefined();
  });
  it('the card weight scales both, so G is the offer value (an on_death card weighed 0 gives 0, not a partner)', () => {
    expect(partnerTerms({ C: 150, CB: 180, R: 100, RB: 120 }, 0)).toEqual({ gain: 0, interaction: 0 });
  });
  it('a part interaction uses the same formula', () => expect(partInteraction(10, 30, 5, 15)).toBe(10));
});

describe('pickPartners', () => {
  const rows = [
    { id: 5, gain: 0.3, interaction: 2 }, { id: 2, gain: 0.3, interaction: 1 }, { id: 9, gain: 0.5, interaction: -1 },
    { id: 7, gain: -0.1, interaction: 4 }, { id: 3, gain: 0.1, interaction: 0.5 }, { id: 4, gain: 0.05, interaction: 0.1 },
  ];
  it('G and I both above zero, ordered by G, a tie broken by id with no claimed difference, at most three', () => {
    expect(pickPartners(rows).map((r) => r.id)).toEqual([2, 5, 3]);
  });
  it('a big I does not rank a weak card higher (the order is G)', () => {
    expect(pickPartners([{ id: 1, gain: 0.01, interaction: 99 }, { id: 2, gain: 0.2, interaction: 0.1 }]).map((r) => r.id)).toEqual([2, 1]);
  });
});

describe('recommend (T052 v2)', () => {
  it('a row no fight part explains is never listed, even with the highest G and I', () => {
    const rows = [{ id: 1, gain: 0.9, interaction: 50, explained: false }, { id: 2, gain: 0.2, interaction: 1, explained: true }];
    expect(recommend(rows).map((r) => r.id)).toEqual([2]);
  });
});
