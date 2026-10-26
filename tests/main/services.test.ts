import { describe, expect, it } from 'vitest';
import { parseAppMode, parseLane, parsePageRequest } from '../../src/main/services.js';

describe('parsePageRequest', () => {
  it('accepts known values', () => {
    expect(parsePageRequest(103, 'ranked', 'mid')).toEqual({ id: 103, mode: 'ranked', position: 'mid' });
    expect(parsePageRequest(103, 'flex', 'top').mode).toBe('flex');
    expect(parsePageRequest(103, 'arena', 'mid').mode).toBe('arena');
  });
  it.each([
    [1.5, 'ranked', 'mid'], [-1, 'ranked', 'mid'], ['103', 'ranked', 'mid'],
    [103, 'clash', 'mid'], [103, 'ranked', 'bottom'], [103, undefined, undefined],
  ])('rejects %j / %j / %j', (id, mode, position) => {
    expect(() => parsePageRequest(id, mode, position)).toThrow(/bad/);
  });
});

describe('parseAppMode / parseLane', () => {
  it('accepts known values only', () => {
    expect(parseAppMode('mayhem')).toBe('mayhem');
    expect(parseLane('adc')).toBe('adc');
    expect(() => parseAppMode('urf')).toThrow(/bad mode/);
    expect(() => parseLane('bottom')).toThrow(/bad position/);
    expect(() => parseAppMode(undefined)).toThrow(/bad mode/);
  });
});
