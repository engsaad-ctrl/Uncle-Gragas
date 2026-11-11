import { describe, expect, it } from 'vitest';
import { createPickDesk, MAX_EVENTS, withPickLog, type LiveRead } from '../../src/main/pickLog.js';

// T010: the pick log main keeps for the running match. The game, the champion and the live level are fakes the test moves by hand.
const CHAMP = 25, A = 1001, B = 1002, C = 1003;
const world = (o: { level?: number; belowThree?: boolean } = {}) => {
  const w = {
    game: 1, champion: CHAMP as number | undefined, live: { level: o.level, belowThree: o.belowThree } as LiveRead | undefined,
    // A read that waits until the test releases it, to put answers out of order.
    hold: false, waiting: [] as ((r: LiveRead | undefined) => void)[],
  };
  const desk = createPickDesk({
    game: () => w.game, champion: () => w.champion, active: () => true,
    readLive: () => (w.hold ? new Promise((res) => w.waiting.push(res)) : Promise.resolve(w.live)),
    knownAugment: async (id) => [A, B, C, 1375, 90011].includes(id),
  });
  return { w, desk };
};
const startEarly = () => { const t = world({ belowThree: true }); t.desk.observe(t.w.live, { game: 1, championId: CHAMP }); return t; };
const at = (t: ReturnType<typeof world>, level: number) => { t.w.live = { level }; };

describe('the pick log main keeps for a match (T010)', () => {
  it('takes the statement after a start seen below level 3, and gives the order, the levels and where they came from', async () => {
    const t = startEarly();
    at(t, 3); await t.desk.mark(1, CHAMP, A, true);
    at(t, 7); const s = await t.desk.mark(1, CHAMP, B, true);
    expect(s).toMatchObject({ held: [{ id: A, recordedLevel: 3 }, { id: B, recordedLevel: 7 }], startedBeforeOffers: true, canDeclare: true });
    expect(t.desk.progressFor(CHAMP, [A, B])).toEqual({ acquiredLevels: { [A]: 3, [B]: 7 }, historySource: 'recorded-at-mark' }); // not complete before the statement
    expect(t.desk.declare(1, CHAMP)).toMatchObject({ declaredComplete: true, canDeclare: false });
    expect(t.desk.progressFor(CHAMP, [B, A])).toEqual({ acquiredLevels: { [A]: 3, [B]: 7 }, historySource: 'player-confirmed', historyComplete: true, pickOrder: [A, B] });
  });

  it('never becomes complete after a late start, an app restart or a mark with no level', async () => {
    const late = world({ level: 5 }); late.desk.observe(late.w.live, { game: 1, championId: CHAMP });
    at(late, 5); await late.desk.mark(1, CHAMP, A, true);
    expect(late.desk.declare(1, CHAMP)).toMatchObject({ declaredComplete: false, canDeclare: false, startedBeforeOffers: false });
    // A new app run: a new desk whose log is first opened by a mark, mid-match.
    const restarted = world({ level: 9 });
    expect(await restarted.desk.mark(1, CHAMP, A, true)).toMatchObject({ startedBeforeOffers: false, canDeclare: false });
    const blind = startEarly(); blind.w.live = undefined;
    expect(await blind.desk.mark(1, CHAMP, A, true)).toMatchObject({ held: [{ id: A }], canDeclare: false });
    expect(blind.desk.declare(1, CHAMP).declaredComplete).toBe(false);
    expect(blind.desk.progressFor(CHAMP, [A]).historyComplete).toBeUndefined();
  });

  it('orders two marks at one level by when they reached main', async () => {
    const t = startEarly(); at(t, 7);
    await t.desk.mark(1, CHAMP, B, true); await t.desk.mark(1, CHAMP, A, true);
    t.desk.declare(1, CHAMP);
    expect(t.desk.progressFor(CHAMP, [A, B]).pickOrder).toEqual([B, A]);
  });

  it('keeps one event for a repeated mark', async () => {
    const t = startEarly(); at(t, 3);
    await t.desk.mark(1, CHAMP, A, true);
    expect((await t.desk.mark(1, CHAMP, A, true)).held).toEqual([{ id: A, recordedLevel: 3 }]);
    expect(t.desk.declare(1, CHAMP).declaredComplete).toBe(true); // a repeat is not an edit
  });

  it('treats an undone mark as an edit: the statement is refused for the rest of the match, even after marking it again', async () => {
    const t = startEarly(); at(t, 3);
    await t.desk.mark(1, CHAMP, A, true);
    expect(t.desk.declare(1, CHAMP).declaredComplete).toBe(true);
    expect(await t.desk.mark(1, CHAMP, A, false)).toMatchObject({ held: [], declaredComplete: false, canDeclare: false, broken: expect.stringContaining('عُدّل') });
    at(t, 4); await t.desk.mark(1, CHAMP, A, true);
    expect(t.desk.declare(1, CHAMP)).toMatchObject({ declaredComplete: false, canDeclare: false });
    expect(t.desk.progressFor(CHAMP, [A])).toEqual({ acquiredLevels: { [A]: 4 }, historySource: 'recorded-at-mark' });
  });

  it('gives an F7 reload the same log, and a new match with the same champion a new one', async () => {
    const t = startEarly(); at(t, 3);
    await t.desk.mark(1, CHAMP, A, true);
    expect(t.desk.get(1, CHAMP)?.held).toEqual([{ id: A, recordedLevel: 3 }]);
    t.w.game = 2;
    expect(() => t.desk.get(1, CHAMP)).toThrow(/stale/); // a page still on the old match
    expect(t.desk.get(2, CHAMP)).toBeNull();
    expect(t.desk.progressFor(CHAMP, [A])).toEqual({});
  });

  it('drops a mark whose level read finished after the match changed', async () => {
    const t = startEarly(); at(t, 3); t.w.hold = true;
    const late = t.desk.mark(1, CHAMP, A, true);
    await Promise.resolve();
    t.w.game = 2; t.w.waiting.shift()!({ level: 3 });
    await expect(late).rejects.toThrow(/stale/);
    expect(t.desk.get(2, CHAMP)).toBeNull();
    t.w.hold = false; at(t, 4);
    expect((await t.desk.mark(2, CHAMP, B, true)).held).toEqual([{ id: B, recordedLevel: 4 }]); // the new match starts clean
  });

  it('keeps the order of arrival when the second read answers first', async () => {
    const t = startEarly(); t.w.hold = true;
    const first = t.desk.mark(1, CHAMP, A, true), second = t.desk.mark(1, CHAMP, B, true);
    await Promise.resolve(); await Promise.resolve();
    t.w.waiting[1]!({ level: 7 }); await Promise.resolve(); await Promise.resolve();
    expect(t.desk.declare(1, CHAMP).declaredComplete).toBe(false); // marks still waiting (the second waits for the first): no statement yet
    t.w.waiting[0]!({ level: 7 }); await first; await second;
    t.desk.declare(1, CHAMP);
    expect(t.desk.progressFor(CHAMP, [A, B]).pickOrder).toEqual([A, B]);
  });

  it('refuses forged or out-of-place requests and gives no certificate for a different set of augments', async () => {
    const t = startEarly(); at(t, 3);
    await expect(t.desk.mark(1, CHAMP, 'x', true)).rejects.toThrow(/bad/);
    await expect(t.desk.mark(1, CHAMP, A, 'yes')).rejects.toThrow(/bad/);
    await expect(t.desk.mark(1.5, CHAMP, A, true)).rejects.toThrow(/bad/);
    await expect(t.desk.mark(1, 99, A, true)).rejects.toThrow(/stale/); // not the champion main follows
    await expect(t.desk.mark(1, CHAMP, 777, true)).rejects.toThrow(/unknown/);
    await t.desk.mark(1, CHAMP, A, true); t.desk.declare(1, CHAMP);
    expect(t.desk.progressFor(CHAMP, [A, B])).toEqual({}); // an offered card beside the logged one: no history from the log
    expect(t.desk.progressFor(CHAMP, [A, A])).toEqual({});
    expect(t.desk.progressFor(CHAMP, [])).toEqual({});
    // The page's own claims are dropped before the log's fields join (main's withPickLog after parseAugmentProgress).
    expect(withPickLog(t.desk, CHAMP, [B], { level: 9, acquiredLevels: { [B]: 3 } })).toEqual({ level: 9, acquiredLevels: { [B]: 3 } });
  });

  it('stops at its size limit without dropping what it holds or allowing the statement', async () => {
    const t = startEarly(); at(t, 3);
    let n = 0;
    try { for (; n < MAX_EVENTS + 5; n++) await t.desk.mark(1, CHAMP, n % 2 ? B : A, n % 4 < 2); } catch { /* full */ }
    const s = t.desk.get(1, CHAMP)!;
    expect(n).toBeLessThan(MAX_EVENTS + 5);
    expect(s.canDeclare).toBe(false);
    expect(s.broken).toBeDefined();
  });
});
