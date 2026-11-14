import { describe, expect, it } from 'vitest';
import { rangeComparison, type RangeCompareCard } from '../../src/renderer/offerView.js';

// T053 v3 (Codex's T053 review): what may be said when a card on offer has a range term. The fight is compared among settled cards only, a tie is
// a tie, the range top is named only among read amounts, and an unread range still blocks any overall winner.
const yi: RangeCompareCard[] = [
  { id: 1115, group: 'settled', stage: 0, range: { supported: true, delta: 250 } },
  { id: 1054, group: 'settled', stage: 0.028 },
  { id: 1081, group: 'settled', stage: 0.229 },
];

describe('rangeComparison', () => {
  it('no range term on offer: nothing to say here (the old comparison stands)', () => {
    expect(rangeComparison(yi.slice(1))).toBeUndefined();
  });
  it('the Yi offer: Tap Dancer tops the settled fight, Scopiest the range', () => {
    expect(rangeComparison(yi)).toEqual({ fightTop: 1081, fightTie: [], amongSettled: false, rangeTop: 1115, rangeUnread: false });
  });
  it('an unread range (ranged champion): still a range term, so the caller shows no winner; no range top is named, and the amount is said to be unread', () => {
    const r = rangeComparison([{ id: 1115, group: 'settled', stage: 0, range: { supported: false } }, { id: 1081, group: 'settled', stage: 0.229 }])!;
    expect(r).toEqual({ fightTop: 1081, fightTie: [], amongSettled: false, rangeUnread: true });
  });
  it('a conditional card with a higher number does not top the settled ones; the comparison says it is among the settled', () => {
    const r = rangeComparison([{ id: 1, group: 'open', stage: 2.0 }, { id: 2, group: 'settled', stage: 0.2 }, { id: 1115, group: 'settled', stage: 0, range: { supported: true, delta: 250 } }])!;
    expect([r.fightTop, r.amongSettled]).toEqual([2, true]);
  });
  it('a tie in the fight is a tie: no top is made up', () => {
    const r = rangeComparison([{ id: 1, group: 'settled', stage: 0.1 }, { id: 2, group: 'settled', stage: 0.1 }, { id: 1115, group: 'settled', stage: 0, range: { supported: true, delta: 250 } }])!;
    expect([r.fightTop, r.fightTie]).toEqual([undefined, [1, 2]]);
  });
  it('a tie in range: no range top', () => {
    const r = rangeComparison([{ id: 1, group: 'settled', stage: 0, range: { supported: true, delta: 150 } }, { id: 2, group: 'settled', stage: 0, range: { supported: true, delta: 150 } }])!;
    expect(r.rangeTop).toBeUndefined();
  });
});
