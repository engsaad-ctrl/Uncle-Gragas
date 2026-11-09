import type { AugmentPlan } from '../ai/augmentChoice.js';

/** Do not blend early strength and a conditional final build with an invented weight. */
export function dominantOffer(offers: { id: number; value: number; certain?: boolean; missing?: string | null; plan?: AugmentPlan }[]): number | undefined {
  if (offers.length < 2 || offers.some((o) => o.certain !== true || o.missing || !o.plan || o.plan.missing.length > 0 || !Number.isFinite(o.value) || !Number.isFinite(o.plan.value))) return undefined;
  return offers.find((a) => offers.every((b) => a === b || (a.value >= b.value && a.plan!.value >= b.plan!.value && (a.value > b.value || a.plan!.value > b.plan!.value))))?.id;
}
