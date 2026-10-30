import { describe, expect, it } from 'vitest';
import { parseRect } from '../../src/main/gameWindow.js';

describe('parseRect', () => {
  it('reads the window, also on a screen left of the main one', () => {
    expect(parseRect('-2560 0 0 1440\r\n')).toEqual({ x: -2560, y: 0, width: 2560, height: 1440 });
  });
  it('rejects no answer, no size and a minimised window', () => {
    for (const bad of ['', 'error', '0 0 0 0', '-32000 -32000 -31840 -31972']) expect(parseRect(bad)).toBeNull();
  });
});
