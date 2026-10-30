import { describe, expect, it } from 'vitest';
import { gradeOf } from '../../src/renderer/fit.js';

describe('gradeOf', () => {
  it('splits a ranking of 100 into a tenth S, a quarter A, 40% B and the rest C', () => {
    const letters = Array.from({ length: 100 }, (_, i) => gradeOf(i, 100));
    const count = (l: string) => letters.filter((x) => x === l).length;
    expect([count('S'), count('A'), count('B'), count('C')]).toEqual([10, 25, 40, 25]);
    expect(letters[0]).toBe('S');
    expect(letters[99]).toBe('C');
  });
});
