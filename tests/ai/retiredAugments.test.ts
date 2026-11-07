import { describe, expect, it } from 'vitest';
import { RETIRED_AUGMENTS } from '../../src/ai/retiredAugments.js';

describe('augments out of Mayhem (knowledge/fight-rules.md, augments)', () => {
  it('holds an augment nobody picks any more, and not one still picked', () => {
    expect(RETIRED_AUGMENTS.has(1406)).toBe(true); // Grandma's Chili Oil: picked in 16.4 to 16.11 only
    expect(RETIRED_AUGMENTS.has(1004)).toBe(false); // Back To Basics, still picked
  });
});
