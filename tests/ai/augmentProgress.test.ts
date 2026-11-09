import { describe, expect, it } from 'vitest';
import { augmentStage, parseAugmentProgress } from '../../src/ai/augmentProgress.js';

describe('Mayhem progresses between separate augment offers', () => {
  it.each([[0, 3, 6], [1, 7, 10], [2, 11, 14], [3, 15, 18], [4, 15, 18]])('uses the next unlock for a preview with %i held cards', (count, level, untilLevel) => {
    expect(augmentStage(Array.from({ length: count }, (_, i) => i + 1))).toMatchObject({ level, untilLevel, estimatedLevel: true });
  });
  it('uses the actual delayed choice level and stops before the next offer', () => {
    expect(augmentStage([1], { level: 9, acquiredLevels: { 1: 5 } })).toMatchObject({ level: 9, untilLevel: 10, levels: [9, 10], acquiredLevels: { 1: 5 }, estimatedLevel: false, estimatedHistory: false });
  });
  it('keeps late choices late and labels missing acquisition history as estimated', () => {
    expect(augmentStage([1, 2], { level: 13, acquiredLevels: { 2: 12 } })).toMatchObject({ acquiredLevels: { 1: 3, 2: 12 }, estimatedHistory: true, levels: [13, 14] });
  });
  it('has a finite final horizon even at level 18 or with extra cards', () => {
    expect(augmentStage([1, 2, 3, 4, 5], { level: 18 })).toMatchObject({ levels: [18], nextOffer: undefined });
  });
  it('never estimates a current level before a recorded late acquisition when live data disappears', () => {
    expect(augmentStage([1, 2], { acquiredLevels: { 1: 9, 2: 17 } })).toMatchObject({ level: 17, levels: [17, 18], acquiredLevels: { 1: 9, 2: 17 }, estimatedLevel: true });
  });
});

describe('progress input from a renderer or phone', () => {
  it('accepts optional progress and a bounded history', () => {
    expect(parseAugmentProgress(undefined)).toBeUndefined();
    expect(parseAugmentProgress({ level: 9, acquiredLevels: { 1390: 3, 1180: 9 } })).toEqual({ level: 9, acquiredLevels: { 1390: 3, 1180: 9 } });
  });
  it.each([[], '9', { level: 2 }, { level: 19 }, { level: 7.5 }, { level: NaN }, { acquiredLevels: [] }, { acquiredLevels: { 0: 3 } }, { level: 7, acquiredLevels: { 1: 9 } }, { acquiredLevels: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i + 1, 3])) }])('rejects invalid progress %j', (value) => {
    expect(() => parseAugmentProgress(value)).toThrow(/bad augment/);
  });
  it('preserves independent targets for held and offered augments', () => {
    expect(parseAugmentProgress({ level: 9, abilityTargets: { 1103: 'W', 1150: 'Q' } })).toEqual({ level: 9, acquiredLevels: {}, abilityTargets: { 1103: 'W', 1150: 'Q' } });
    expect(parseAugmentProgress({ abilityTargets: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, 'E'])) })?.abilityTargets).toHaveProperty('9', 'E');
  });
  it.each([null, [], 'Q', { 1103: 'P' }, { 1103: 'q' }, { 1103: 1 }, { 0: 'Q' }, { '1.5': 'Q' }, { '9007199254740992': 'Q' }, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 'Q']))])('rejects invalid ability target maps %j', (abilityTargets) => {
    expect(() => parseAugmentProgress({ abilityTargets })).toThrow(/bad augment ability targets/);
  });
});
