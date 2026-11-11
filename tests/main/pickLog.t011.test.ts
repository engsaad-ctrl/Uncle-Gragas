import { describe, expect, it } from 'vitest';
import * as pickLog from '../../src/main/pickLog.js';
import { createPickDesk, type LiveRead } from '../../src/main/pickLog.js';

// T011: what the T010 review found. Every wait the log makes (the augment check, the level read, the champion list) is a promise the test
// releases by hand, so their order can be turned around.
const CHAMP = 25, A = 1001, B = 1002;
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; };
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const world = () => {
  const w = { game: 1, champion: CHAMP as number | undefined, active: true, holdCheck: false, holdRead: false, checks: [] as ((ok: boolean) => void)[], reads: [] as ((r: LiveRead | undefined) => void)[], level: 3 as number | undefined };
  const desk = createPickDesk({
    game: () => w.game, champion: () => w.champion, active: () => w.active,
    knownAugment: (id) => (w.holdCheck ? new Promise<boolean>((res) => w.checks.push(res)) : Promise.resolve(id !== 777)),
    readLive: () => (w.holdRead ? new Promise((res) => w.reads.push(res)) : Promise.resolve({ level: w.level })),
  });
  desk.observe({ belowThree: true }, { game: 1, championId: CHAMP });
  return { w, desk };
};

describe('pick log fixes after the T010 review (T011)', () => {
  it('keeps the order of arrival when the second request finishes its augment check first', async () => {
    const { w, desk } = world(); w.holdCheck = true;
    const first = desk.mark(1, CHAMP, A, true), second = desk.mark(1, CHAMP, B, true);
    await tick();
    w.checks[1]!(true); await tick(); // B's check ends first
    w.checks[0]!(true);
    await Promise.all([first, second]);
    expect(desk.get(1, CHAMP)?.held.map((h) => h.id)).toEqual([A, B]);
    desk.declare(1, CHAMP);
    expect(desk.progressFor(CHAMP, [A, B]).pickOrder).toEqual([A, B]);
  });

  it('keeps the order when the checks and then the level reads finish in reverse', async () => {
    const { w, desk } = world(); w.holdCheck = true; w.holdRead = true;
    const first = desk.mark(1, CHAMP, A, true), second = desk.mark(1, CHAMP, B, true);
    await tick(); w.checks[1]!(true); await tick(); w.checks[0]!(true); await tick();
    // B's check ended first, so B's read started first (reads[0]); it answers first too, then A's.
    w.reads[0]!({ level: 7 }); await tick(); w.reads[1]!({ level: 5 });
    await Promise.all([first, second]);
    expect(desk.get(1, CHAMP)?.held).toEqual([{ id: A, recordedLevel: 5 }, { id: B, recordedLevel: 7 }]);
  });

  it('lets a refused first request leave the line without counting or blocking the next', async () => {
    const { w, desk } = world(); w.holdCheck = true;
    const bad = desk.mark(1, CHAMP, 777, true), good = desk.mark(1, CHAMP, A, true);
    await tick(); w.checks[1]!(true); await tick(); w.checks[0]!(false);
    await expect(bad).rejects.toThrow(/^pick-rejected/);
    await good;
    expect(desk.get(1, CHAMP)).toMatchObject({ held: [{ id: A }], pending: 0 });
  });

  it('serves no log and no certificate outside an active match, even to the same champion and match number', async () => {
    const { w, desk } = world();
    await desk.mark(1, CHAMP, A, true);
    desk.declare(1, CHAMP);
    expect(desk.progressFor(CHAMP, [A]).historyComplete).toBe(true);
    w.active = false; // the match ended, or champ select, or another mode
    await expect(desk.mark(1, CHAMP, B, true)).rejects.toThrow(/^pick-unavailable/);
    expect(() => desk.declare(1, CHAMP)).toThrow(/^pick-unavailable/);
    expect(() => desk.get(1, CHAMP)).toThrow(/^pick-unavailable/);
    expect(desk.progressFor(CHAMP, [A])).toEqual({});
  });

  it('opens no log from a reading taken before the match changed', async () => {
    const { w, desk } = world();
    w.game = 2;
    desk.observe({ belowThree: true }, { game: 1, championId: CHAMP }); // a level 1 read from match 1, arriving after the switch
    expect(desk.get(2, CHAMP)).toBeNull();
    await desk.mark(2, CHAMP, A, true);
    expect(desk.get(2, CHAMP)).toMatchObject({ startedBeforeOffers: false, canDeclare: false });
  });

  it('drops the reading when the match changes while the champion list loads (the helper main uses)', async () => {
    const { w, desk } = world(); w.game = 2;
    const list = deferred<string | undefined>();
    const readActive = pickLog.readActive;
    const r = readActive({
      desk, game: () => w.game, champion: () => w.champion, active: () => w.active, championId: CHAMP,
      snapshot: async () => ({ players: {}, active: { alias: 'Morgana', items: [], belowThree: true } }),
      aliasOf: () => list.promise,
    });
    await tick(); w.game = 3; list.resolve('Morgana');
    expect(await r).toBeUndefined();
    expect(desk.get(3, CHAMP)).toBeNull();
  });

  it('gives a page that reloads while a mark is pending the log once that mark is in', async () => {
    const { w, desk } = world(); w.holdRead = true;
    const marking = desk.mark(1, CHAMP, A, true);
    await tick();
    const reloaded = desk.whenRecorded(1, CHAMP); // the new page asks, waiting
    w.reads[0]!({ level: 4 }); await marking;
    expect(await reloaded).toMatchObject({ held: [{ id: A, recordedLevel: 4 }], pending: 0 });
  });

  it('refuses to hand a waiting page a log from a match that ended meanwhile', async () => {
    const { w, desk } = world(); w.holdRead = true;
    const marking = desk.mark(1, CHAMP, A, true);
    await tick();
    const reloaded = desk.whenRecorded(1, CHAMP);
    w.game = 2; w.reads[0]!({ level: 4 });
    await expect(marking).rejects.toThrow(/^pick-stale/);
    await expect(reloaded).rejects.toThrow(/^pick-stale/);
  });

  it('numbers each snapshot so a page can keep the newer one', async () => {
    const { desk } = world();
    const s1 = await desk.mark(1, CHAMP, A, true), s2 = await desk.mark(1, CHAMP, B, true);
    expect(s2.version).toBeGreaterThan(s1.version);
  });
});

describe('the line after a refused request in the middle (T012)', () => {
  it('never commits C ahead of A when B between them is refused', async () => {
    const { w, desk } = world(); w.holdCheck = true; w.holdRead = true;
    const a = desk.mark(1, CHAMP, A, true), b = desk.mark(1, CHAMP, 777, true), c = desk.mark(1, CHAMP, B, true);
    await tick();
    w.checks[0]!(true); w.checks[2]!(true); await tick(); // A and C pass their checks; their reads start (reads[0] A, reads[1] C)
    w.reads[1]!({ level: 6 }); await tick(); // C's read is done, A's still waits
    w.checks[1]!(false); await expect(b).rejects.toThrow(/^pick-rejected/); await tick();
    expect(desk.get(1, CHAMP)).toMatchObject({ held: [], pending: 2 }); // C has not gone in ahead of A
    w.reads[0]!({ level: 5 });
    await Promise.all([a, c]);
    expect(desk.get(1, CHAMP)).toMatchObject({ held: [{ id: A, recordedLevel: 5 }, { id: B, recordedLevel: 6 }], pending: 0 });
    desk.declare(1, CHAMP);
    expect(desk.progressFor(CHAMP, [A, B]).pickOrder).toEqual([A, B]);
  });

  it('keeps a waiting page waiting for A, not released by B being refused', async () => {
    const { w, desk } = world(); w.holdCheck = true; w.holdRead = true;
    const a = desk.mark(1, CHAMP, A, true), b = desk.mark(1, CHAMP, 777, true);
    await tick(); w.checks[0]!(true); await tick();
    let answered: unknown;
    const reloaded = desk.whenRecorded(1, CHAMP).then((s) => (answered = s));
    w.checks[1]!(false); await expect(b).rejects.toThrow(/^pick-rejected/); await tick();
    expect(answered).toBeUndefined(); // B is out of the line, A is still being recorded
    w.reads[0]!({ level: 5 }); await a; await reloaded;
    expect(answered).toMatchObject({ held: [{ id: A, recordedLevel: 5 }], pending: 0 });
  });

  it('raises the version with every change a page could see, not only a commit', async () => {
    const { w, desk } = world(); w.holdRead = true;
    const v0 = desk.get(1, CHAMP)!.version;
    const m = desk.mark(1, CHAMP, A, true); await tick();
    const v1 = desk.get(1, CHAMP)!.version; // a mark now in the line
    w.reads[0]!({ level: 3 }); const v2 = (await m).version;
    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
  });
});
