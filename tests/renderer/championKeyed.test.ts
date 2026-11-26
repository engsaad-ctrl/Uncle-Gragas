import { describe, expect, it } from 'vitest';
import { keyedTo, readFor } from '../../src/renderer/championKeyed.js';

describe('champion-keyed stats', () => {
  it('hides the previous champion\'s numbers until the new ones arrive', () => {
    let win = keyedTo(1, new Map([[7, 0.91]]));
    expect(readFor(win, 1, 7)).toBe(0.91);
    expect(readFor(win, 2, 7)).toBeUndefined(); // switched to champion 2, request still out
    win = keyedTo(2, new Map([[7, 0.32]])); // the deferred response lands
    expect(readFor(win, 2, 7)).toBe(0.32);
    expect(readFor(keyedTo<number>(), undefined, 7)).toBeUndefined();
  });
});
