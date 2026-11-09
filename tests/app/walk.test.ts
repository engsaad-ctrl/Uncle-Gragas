import { describe, expect, it } from 'vitest';
import { rankOffer, walkItems } from '../../src/app/walk.js';

describe('rankOffer', () => {
  it('puts the highest percent first and unknown last', () => {
    const p: Record<string, number | undefined> = { a: 40, b: undefined, c: 90 };
    expect(rankOffer(['a', 'b', 'c'], (x) => p[x])).toEqual(['c', 'a', 'b']);
  });
  it('leaves the list it was given alone', () => {
    const cards = ['a', 'b'];
    rankOffer(cards, () => 1);
    expect(cards).toEqual(['a', 'b']);
  });
});

describe('walkItems', () => {
  it('leaves out what he owns, and names what the list no longer holds', () => {
    expect(walkItems([1, 2, 3], [1, 9])).toEqual({ next: [2, 3], offPath: [9] });
  });
  it('fits the six slots', () => {
    expect(walkItems([1, 2, 3, 4, 5, 6, 7], [1, 8, 9, 10, 11]).next).toEqual([2]);
    expect(walkItems([1, 2], [3, 4, 5, 6, 7, 8]).next).toEqual([]);
  });
  it('gives the whole list with nothing bought', () => {
    expect(walkItems([1, 2], [])).toEqual({ next: [1, 2], offPath: [] });
  });
});

describe('rankOffer with open conditions', () => {
  it('puts settled cards first, then open-condition ones, then unknown, each by percent', () => {
    const p: Record<string, number | undefined> = { a: 40, b: undefined, c: 90, d: 95, e: 10 };
    const open = new Set(['d', 'e']);
    expect(rankOffer(['a', 'b', 'c', 'd', 'e'], (x) => p[x], (x) => open.has(x))).toEqual(['c', 'a', 'd', 'e', 'b']);
  });
});
