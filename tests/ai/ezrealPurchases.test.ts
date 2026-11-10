import { describe, expect, it } from 'vitest';
import { ezrealNextItems, ezrealTearStage } from '../../src/app/ezrealPurchases.js';

describe('Ezreal purchases', () => {
  const build = [3004, 3078, 3158, 6697, 3036, 3072];

  it('starts with Tear alone', () => {
    expect(ezrealNextItems([], build, false)).toEqual([3070]);
    expect(ezrealNextItems([3078], build, true)).toEqual([3070]);
  });

  it('buys the rest of the plan while Tear charges and prioritizes Manamune once confirmed', () => {
    expect(ezrealNextItems([323070, 323078], build, false)).toEqual([3158, 6697, 3036, 3072]);
    expect(ezrealNextItems([323070, 323078], build, true)).toEqual([3004, 3158, 6697, 3036, 3072]);
  });

  it('treats both Manamune and transformed Muramana as complete', () => {
    for (const id of [3004, 323004, 3042, 773042]) {
      expect(ezrealTearStage([id], false)).toBe('complete');
      expect(ezrealNextItems([id, 3078], build, false)).toEqual([3158, 6697, 3036, 3072]);
    }
  });
});
