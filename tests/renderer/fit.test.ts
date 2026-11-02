import { describe, expect, it } from 'vitest';
import { gradeOf, gradesFor, healthChain, nextToPicked, outsidePoints, playedOnly, siteBonus, TRIAL_LINK_POINTS, trialScoring } from '../../src/renderer/fit.js';

describe('the health chain', () => {
  it('links Steel Your Heart and Tank Engine either way', () => {
    expect(healthChain([1152], 1353)).toBe(2);
    expect(healthChain([1353, 1181], 1152)).toBe(2);
  });
  it('needs the other part marked', () => {
    expect(healthChain([], 1353)).toBe(0);
    expect(healthChain([1353], 1353)).toBe(0);
    expect(healthChain([1181], 1353)).toBe(0);
    expect(healthChain([1353], undefined)).toBe(0);
  });
});

describe('next to the marked augments', () => {
  it('stays as it was unless the trial is on', () => {
    expect(nextToPicked(2, 0.03, false)).toBeCloseTo(5);
    expect(nextToPicked(2, undefined, false)).toBe(2);
  });
  it('in the trial counts links by their measured size and leaves out the pair table', () => {
    expect(nextToPicked(2, 0.03, true)).toBeCloseTo(2 * TRIAL_LINK_POINTS);
  });
  it('is off when the choice cannot be read', () => {
    expect(trialScoring()).toBe(false);
  });
});

describe('gradeOf', () => {
  it('splits a ranking of 100 into a tenth S, a quarter A, 40% B and the rest C', () => {
    const letters = Array.from({ length: 100 }, (_, i) => gradeOf(i, 100));
    const count = (l: string) => letters.filter((x) => x === l).length;
    expect([count('S'), count('A'), count('B'), count('C')]).toEqual([10, 25, 40, 25]);
    expect(letters[0]).toBe('S');
    expect(letters[99]).toBe('C');
  });
});

describe('gradesFor', () => {
  it('compares an augment only with its own rarity', () => {
    const list = [{ id: 1, rarity: 'gold', s: 9 }, { id: 2, rarity: 'gold', s: 1 }, { id: 3, rarity: 'silver', s: 0 }];
    const g = gradesFor(list, (a) => a.s);
    expect([g.get(1), g.get(2)]).toEqual(['A', 'B']);
    expect(g.get(3)).toBe('B');
  });
});

describe('playedOnly', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const many = new Map(Array.from({ length: 200 }, (_, i) => [i + 1000, 0]));
  it('hides what no stored game took, keeping the marked ones', () => {
    expect(playedOnly(list, new Map([...many, [1, 0]]), new Set([3])).map((a) => a.id)).toEqual([1, 3]);
  });
  it('hides nothing while too few games are stored', () => {
    expect(playedOnly(list, new Map([[1, 0]]))).toEqual(list);
  });
});

describe('siteBonus', () => {
  it('turns a tier into points, and adds nothing without one', () => {
    expect(siteBonus('S+')).toBeCloseTo(2.34);
    expect(siteBonus('D')).toBeLessThan(0);
    expect(siteBonus(undefined)).toBe(0);
    expect(siteBonus('Z')).toBe(0);
  });
});

describe('outsidePoints', () => {
  it('prefers the open data, and falls back on the site only where it knows nothing', () => {
    expect(outsidePoints(2, 'S+')).toBeCloseTo(5.2);
    expect(outsidePoints(0, 'S+')).toBe(0);
    expect(outsidePoints(undefined, 'S+')).toBeCloseTo(siteBonus('S+'));
    expect(outsidePoints(undefined, undefined)).toBe(0);
  });
});
