import { describe, expect, it } from 'vitest';
import { walkedPath } from '../../src/app/buildPath.js';

describe('recommendations follow actual purchases', () => {
  it('does not infer purchases from several augments marked together', () => {
    expect(walkedPath(undefined, [1, 2, 3], [], [10, 20, 30])).toEqual({ marks: [1, 2, 3], items: [10, 20, 30], bought: 0, dropped: [] });
  });
  it('uses the newly calculated order when an earlier suggestion was never purchased', () => {
    const first = walkedPath(undefined, [1], [], [10, 20, 30]);
    expect(walkedPath(first, [1, 2], [], [20, 10, 30])).toMatchObject({ items: [20, 10, 30], bought: 0 });
  });
  it('keeps observed items first while refreshing recommendations with the same augments', () => {
    const first = walkedPath(undefined, [1], [10], [10, 20, 30]);
    expect(walkedPath(first, [1], [10], [30, 10, 40])).toEqual({ marks: [1], items: [10, 30, 40], bought: 1, dropped: [20] });
  });
  it('records superseded suggestions and clears them on the following refresh', () => {
    const first = walkedPath(undefined, [1], [], [10, 20]);
    const second = walkedPath(first, [1, 2], [], [30, 40]);
    expect(second.dropped).toEqual([10, 20]);
    expect(walkedPath(second, [1, 2], [], [30, 40]).dropped).toEqual([]);
  });
  it('recomputes after removing an augment without manufacturing purchases', () => {
    const first = walkedPath(undefined, [1, 2, 3], [], [10, 20]);
    expect(walkedPath(first, [1], [], [30, 40])).toMatchObject({ marks: [1], items: [30, 40], bought: 0 });
  });
  it('does not duplicate an owned or suggested item', () => {
    expect(walkedPath(undefined, [1], [10, 10], [10, 20, 10])).toMatchObject({ items: [10, 20], bought: 1 });
  });
});
