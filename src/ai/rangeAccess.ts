// T053: the range term for melee champions, from Codex's reference model (knowledge/codex-claude/T053/range-access.mjs). A declared scenario, not
// match telemetry: a straight approach to one stationary target, at a constant speed, in the same unit as attack range. Casts, attack windups,
// dashes, collision, terrain and incoming threats are outside it. The result is a potential in-range window: never damage, an attack count or a
// win estimate, and it is not attackUptime.

export interface RangeReach { travelDistance: number; contactSeconds: number | null; inRangeSeconds: number; reachedWithinWindow: boolean }
export interface RangeAccess {
  scenario: 'straight-to-stationary-target';
  distance: number; moveSpeed: number; windowSeconds: number;
  beforeRange: number; afterRange: number; rangeDelta: number;
  before: RangeReach; after: RangeReach;
  /** The in-range window won back (after − before), in seconds; negative when range is lost. */
  recoveredSeconds: number;
}

/** The example scenario the page shows by default (T053 contract: an illustrative input, not a measured distance or a calibration). */
export const RANGE_SCENARIO = { distance: 600, windowSeconds: 15 } as const;

export function rangeAccess(o: { distance: number; beforeRange: number; afterRange: number; moveSpeed: number; windowSeconds: number }): RangeAccess {
  for (const [key, value] of Object.entries(o)) if (!Number.isFinite(value) || value < 0) throw new RangeError(`${key} must be a finite non-negative number`);
  const reach = (range: number): RangeReach => {
    const travel = Math.max(0, o.distance - range);
    // Already in range: no travel. Out of range at no speed: he never gets there (no division by zero).
    const contactSeconds = travel === 0 ? 0 : o.moveSpeed === 0 ? null : travel / o.moveSpeed;
    const inRangeSeconds = contactSeconds === null ? 0 : Math.max(0, o.windowSeconds - contactSeconds);
    return { travelDistance: travel, contactSeconds, inRangeSeconds, reachedWithinWindow: contactSeconds !== null && contactSeconds <= o.windowSeconds };
  };
  const before = reach(o.beforeRange), after = reach(o.afterRange);
  return { scenario: 'straight-to-stationary-target', distance: o.distance, moveSpeed: o.moveSpeed, windowSeconds: o.windowSeconds, beforeRange: o.beforeRange,
    afterRange: o.afterRange, rangeDelta: o.afterRange - o.beforeRange, before, after, recoveredSeconds: after.inRangeSeconds - before.inRangeSeconds };
}
