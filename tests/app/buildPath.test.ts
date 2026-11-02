import { describe, expect, it } from 'vitest';
import { followPath } from '../../src/app/buildPath.js';

describe('followPath', () => {
  it('starts with the engine list and nothing bought', () => {
    expect(followPath(undefined, [1], [10, 20, 30])).toEqual({ marks: [1], items: [10, 20, 30], bought: 0, dropped: [] });
  });
  it('keeps the first item when a new augment reorders the list, and moves on to the next', () => {
    const first = followPath(undefined, [1], [10, 20, 30]);
    expect(followPath(first, [1, 2], [20, 10, 30])).toEqual({ marks: [1, 2], items: [10, 20, 30], bought: 1, dropped: [] });
  });
  it('says so when an advised item no longer fits', () => {
    const first = followPath(undefined, [1], [10, 20, 30]);
    expect(followPath(first, [1, 2], [20, 30, 40])).toEqual({ marks: [1, 2], items: [20, 30, 40], bought: 0, dropped: [10] });
  });
  it('holds earlier items over several steps', () => {
    let p = followPath(undefined, [1], [10, 20, 30]);
    p = followPath(p, [1, 2], [20, 10, 30]);
    p = followPath(p, [1, 2, 3], [30, 40, 20, 10]);
    expect(p.items).toEqual([10, 20, 30, 40]);
    expect(p.bought).toBe(2);
  });
  it('changes nothing for the same marks, and clears the old notice', () => {
    const first = followPath(undefined, [1], [10, 20]);
    const second = followPath(first, [1, 2], [20, 30]);
    expect(followPath(second, [2, 1], [99, 98])).toEqual({ ...second, dropped: [] });
  });
  it('starts over when an augment is removed', () => {
    const second = followPath(followPath(undefined, [1], [10, 20]), [1, 2], [20, 10]);
    expect(followPath(second, [1], [30, 40])).toEqual({ marks: [1], items: [30, 40], bought: 0, dropped: [] });
  });
  it('takes earlier items as bought when several are marked at once', () => {
    expect(followPath(undefined, [1, 2, 3], [10, 20, 30]).bought).toBe(2);
  });
});
