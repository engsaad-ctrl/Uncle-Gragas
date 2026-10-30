import { describe, expect, it } from 'vitest';
import { gradeOf, gradesFor, playedOnly, siteBonus } from '../../src/renderer/fit.js';

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
