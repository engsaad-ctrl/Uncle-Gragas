import { describe, expect, it } from 'vitest';
import { pickThemeIndex, THEMES } from '../../src/renderer/theme.js';

describe('pickThemeIndex', () => {
  it('never repeats the last launch when there is a choice', () => {
    for (let r = 0; r < 1; r += 0.05) expect(pickThemeIndex(2, 4, () => r)).not.toBe(2);
  });
  it('covers every other theme and stays in range at the edges', () => {
    expect(new Set([0, 0.3, 0.6, 0.999999].map((r) => pickThemeIndex(2, 4, () => r)))).toEqual(new Set([0, 1, 3]));
    expect(pickThemeIndex(-1, 4, () => 0.999999)).toBe(3);
  });
  it('returns the only theme when there is one', () => {
    expect(pickThemeIndex(0, 1, () => 0.5)).toBe(0);
  });
  it('ships four themes with readable colours', () => {
    expect(THEMES.map((t) => t.name)).toEqual(['malphite-shamrock', 'gragas-gentleman', 'blitzcrank', 'gragas-hillbilly']);
    for (const t of THEMES) expect(t.accent).toMatch(/^#[0-9a-f]{6}$/);
  });
});
