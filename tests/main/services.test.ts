import { describe, expect, it } from 'vitest';
import { parsePageRequest } from '../../src/main/services.js';

describe('parsePageRequest', () => {
  it('accepts known values', () => {
    expect(parsePageRequest(103, 'ranked', 'mid')).toEqual({ id: 103, mode: 'ranked', position: 'mid' });
  });
  it.each([
    [1.5, 'ranked', 'mid'], [-1, 'ranked', 'mid'], ['103', 'ranked', 'mid'],
    [103, 'arena', 'mid'], [103, 'ranked', 'bottom'], [103, undefined, undefined],
  ])('rejects %j / %j / %j', (id, mode, position) => {
    expect(() => parsePageRequest(id, mode, position)).toThrow(/bad/);
  });
});
