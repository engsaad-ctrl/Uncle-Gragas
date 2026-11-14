import { describe, expect, it } from 'vitest';
import { rangeAccess } from '../../src/ai/rangeAccess.js';

// T053: Codex's 15 reference checks (knowledge/codex-claude/T053/check-range-access.mjs) on the TypeScript model. The oracle is geometry, computed
// apart: the distance the range does not cover, divided by the speed, inside the window.
const base = { distance: 600, beforeRange: 175, afterRange: 425, moveSpeed: 355, windowSeconds: 15 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe('rangeAccess, the 15 reference cases', () => {
  it('independent oracle: distance to contact divided by speed', () => {
    const r = rangeAccess(base);
    close(r.before.contactSeconds!, 425 / 355); close(r.after.contactSeconds!, 175 / 355); close(r.recoveredSeconds, 250 / 355);
  });
  it('zero distance gives no recovered time', () => close(rangeAccess({ ...base, distance: 0 }).recoveredSeconds, 0));
  it('already in range: saturation gives zero', () => close(rangeAccess({ ...base, distance: 150 }).recoveredSeconds, 0));
  it('after range beyond the target saturates at the first approach time', () => close(rangeAccess({ ...base, distance: 300, afterRange: 900 }).recoveredSeconds, 125 / 355));
  it('both unreachable in the window give zero', () => close(rangeAccess({ ...base, distance: 10000, windowSeconds: 1 }).recoveredSeconds, 0));
  it('only the improved range reaches during the window', () => {
    const r = rangeAccess({ ...base, distance: 700, beforeRange: 100, afterRange: 500, moveSpeed: 100, windowSeconds: 5 });
    close(r.before.inRangeSeconds, 0); close(r.after.inRangeSeconds, 3);
  });
  it('stacked range uses the held range as baseline', () => {
    const first = rangeAccess({ ...base, afterRange: 425 }), second = rangeAccess({ ...base, beforeRange: 425, afterRange: 575 });
    close(first.rangeDelta, 250); close(second.rangeDelta, 150); close(second.recoveredSeconds, 150 / 355);
  });
  it('zero speed outside both ranges is unreachable, never Infinity', () => {
    const r = rangeAccess({ ...base, moveSpeed: 0 });
    expect([r.before.contactSeconds, r.after.contactSeconds]).toEqual([null, null]); close(r.recoveredSeconds, 0);
  });
  it('zero speed can benefit when range alone reaches the target', () => close(rangeAccess({ ...base, distance: 300, moveSpeed: 0 }).recoveredSeconds, 15));
  it('zero window gives zero recovered time', () => close(rangeAccess({ ...base, windowSeconds: 0 }).recoveredSeconds, 0));
  it('a range loss remains a loss, not clamped to zero', () => close(rangeAccess({ ...base, beforeRange: 425, afterRange: 175 }).recoveredSeconds, -250 / 355));
  it('equal ranges give zero', () => close(rangeAccess({ ...base, afterRange: 175 }).recoveredSeconds, 0));
  it('invalid inputs are rejected', () => { for (const x of [-1, NaN, Infinity]) expect(() => rangeAccess({ ...base, moveSpeed: x })).toThrow(RangeError); });
  it('the input is not changed', () => { const args = Object.freeze({ ...base }); rangeAccess(args); expect(args).toEqual(base); });
  it('the gain is monotone in range and bounded by the window', () => {
    let previous = 0;
    for (const afterRange of [175, 250, 425, 575, 600, 1000]) {
      const r = rangeAccess({ ...base, afterRange });
      expect(r.recoveredSeconds).toBeGreaterThanOrEqual(previous - 1e-10);
      expect(r.recoveredSeconds).toBeLessThanOrEqual(base.windowSeconds);
      previous = r.recoveredSeconds;
    }
  });
});
