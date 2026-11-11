import { describe, expect, it, vi } from 'vitest';
import { restorePicks } from '../../src/renderer/pickRestore.js';
import type { PickSnapshot } from '../../src/main/pickLog.js';

// T012: what F7 brings back when it loads (the decision overlay.load takes through restorePicks). The bridge is a fake; the old build's
// augments (lastAiPicks) are for this champion and must never fill a live match's picks.
const CHAMP = 25, OLD = [1375, 1323];
const snap = (o: Partial<PickSnapshot> = {}): PickSnapshot => ({ game: 1, championId: CHAMP, version: 1, held: [], pending: 0, startedBeforeOffers: true, declaredComplete: false, canDeclare: false, ...o });
const bridge = (log: unknown) => ({ pickLog: vi.fn(async () => log as never), lastAiPicks: vi.fn(async () => ({ championId: CHAMP, augmentIds: OLD })) });
const known = () => true;

describe('F7 load: where the picks come from (T012)', () => {
  it('takes an empty live log as it is and never fills it from the last build', async () => {
    for (const log of [snap(), null, snap({ pending: 1 })]) {
      const b = bridge(log);
      const plan = await restorePicks(b, { game: 1, championId: CHAMP, known, manualAllowed: true });
      expect(plan.source).toBe('log');
      expect(b.lastAiPicks).not.toHaveBeenCalled();
      expect(plan.source === 'log' && plan.followPending).toBe(log !== null && (log as PickSnapshot).pending > 0);
    }
  });

  it('brings back a live log that holds picks', async () => {
    const plan = await restorePicks(bridge(snap({ held: [{ id: 1003, recordedLevel: 3 }] })), { game: 1, championId: CHAMP, known, manualAllowed: true });
    expect(plan).toMatchObject({ source: 'log', snap: { held: [{ id: 1003 }] } });
  });

  it('uses nothing old when main answers that the match changed or refused', async () => {
    for (const error of ['pick-stale: stale pick request', 'pick-rejected: bad pick request']) {
      const b = bridge({ error });
      expect((await restorePicks(b, { game: 1, championId: CHAMP, known, manualAllowed: true })).source).toBe('none');
      expect(b.lastAiPicks).not.toHaveBeenCalled();
    }
  });

  it('keeps the manual marks, uncertified, only where there is no live log (no match, the phone page)', async () => {
    for (const log of [{ error: 'pick-unavailable: no active Mayhem match' }, { error: 'البرنامج على الكمبيوتر غير متصل.' }]) {
      const plan = await restorePicks(bridge(log), { game: 1, championId: CHAMP, known, manualAllowed: true });
      expect(plan).toEqual({ source: 'manual', ids: OLD });
    }
    expect(await restorePicks(bridge(null), { game: undefined, championId: CHAMP, known, manualAllowed: true })).toEqual({ source: 'manual', ids: OLD });
    expect(await restorePicks(bridge({ error: 'pick-unavailable: x' }), { game: 1, championId: CHAMP, known, manualAllowed: false })).toEqual({ source: 'manual', ids: [] });
  });
});
