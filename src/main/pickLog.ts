// The F7 pick log, kept by main for the running match (T010, fixed in T011). The page sends only the match number it sees, the champion, the
// augment and whether it is marked. What this proves, and no more:
// - recordedLevel is the game's level when the mark reached main, not a proven time the augment was taken;
// - seq is the order in which marks reached main (taken before any wait, and committed in that order);
// - "complete" is the player's own statement that every pick was marked in order, each when it was taken. Main accepts it only when it saw the
//   log open before the first offer (a live level below 3), in the same active match and app run, with every mark at a known level and none
//   ever undone. It is shown as "complete as you confirmed", never "from the game".
// Outside an active Mayhem match nothing is served or certified. Nothing is written to disk, and no player name or account id is kept.
import type { AugmentProgress } from '../ai/augmentProgress.js';
import type { LiveSnapshot } from '../lcu/liveGame.js';

export const MAX_EVENTS = 48; // at most 6 held; room for corrections. Past it the log refuses more and stops counting as whole, never drops old events.
const MAX_HELD = 6;
const WAIT_MS = 15_000; // how long a reloaded page may wait for marks still being recorded

/** Errors the page tells apart: no log here (keep marking locally, said so), a refused mark (keep the log, show why), an answer from a match that changed. */
const unavailable = (why: string) => new Error(`pick-unavailable: ${why}`);
const rejected = (why: string) => new Error(`pick-rejected: ${why}`);
const stale = () => new Error('pick-stale: stale pick request');

export interface PickEvent { seq: number; id: number; kind: 'pick' | 'unpick'; recordedLevel?: number }
export interface PickSnapshot {
  game: number; championId: number;
  /** Rises with every change a page could see (a mark joining or leaving the line, a commit, the statement), so a page keeps the newer of two snapshots. */
  version: number;
  /** Held augments in the order marked, with the level main recorded at each mark (absent when no live level was read). */
  held: { id: number; recordedLevel?: number }[];
  /** Marks that reached main and are still being recorded. */
  pending: number;
  startedBeforeOffers: boolean; declaredComplete: boolean; broken?: string;
  canDeclare: boolean; /** Why the statement can't be taken now, in the page's words. */ reason?: string;
}
export interface LiveRead { level?: number; belowThree?: boolean }
export interface PickIdentity { game: number; championId: number }
export interface PickDeskDeps {
  /** The match counter (MatchEpoch.value) and the champion main follows now. */
  game: () => number; champion: () => number | undefined;
  /** A Mayhem match is running now (phase InProgress, mode mayhem). */
  active: () => boolean;
  /** A fresh read of his level from the game; undefined when no match answers. */
  readLive: (championId: number) => Promise<LiveRead | undefined>;
  /** True for a Mayhem augment id this champion can take. */
  knownAugment: (id: number) => Promise<boolean>;
}

/** settled: this mark and every mark before it are done (committed or refused), so a refused one in the middle never lets a later one ahead. */
interface Pending { seq: number; id: number; kind: 'pick' | 'unpick'; settled: Promise<void> }
interface Log { game: number; championId: number; startedBeforeOffers: boolean; events: PickEvent[]; pending: Pending[]; declaredComplete: boolean; broken?: string; nextSeq: number; version: number }

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isGame = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function createPickDesk(deps: PickDeskDeps) {
  let log: Log | undefined;
  const now = (): PickIdentity | undefined => { const championId = deps.champion(); return deps.active() && championId !== undefined ? { game: deps.game(), championId } : undefined; };
  const same = (a: PickIdentity | undefined, b: PickIdentity) => !!a && a.game === b.game && a.championId === b.championId;
  const current = (id: PickIdentity) => (log && log.game === id.game && log.championId === id.championId ? log : undefined);
  /** A log for this match and champion, opened by the first live reading main sees for them. */
  const open = (id: PickIdentity, read: LiveRead | undefined) => {
    if (current(id)) return log!;
    log = { ...id, startedBeforeOffers: read?.belowThree === true, events: [], pending: [], declaredComplete: false, nextSeq: 1, version: 0 };
    return log;
  };
  const heldOf = (l: Log) => {
    const held = new Map<number, PickEvent>();
    for (const e of l.events) { if (e.kind === 'pick') held.set(e.id, e); else held.delete(e.id); }
    return [...held.values()];
  };
  const reasonOf = (l: Log): string | undefined =>
    l.broken ?? (!l.startedBeforeOffers ? 'بدأ التسجيل بعد أول عرض أو بعد إعادة تشغيل التطبيق' : heldOf(l).some((e) => e.recordedLevel === undefined) ? 'علامة بلا مستوى مقروء من اللعبة' : !heldOf(l).length ? 'لا اختيارات مسجلة بعد' : l.pending.length ? 'علامة ما زالت تُسجَّل' : undefined);
  const snapshot = (l: Log): PickSnapshot => {
    const reason = l.declaredComplete ? undefined : reasonOf(l);
    return {
      game: l.game, championId: l.championId, version: l.version, held: heldOf(l).map((e) => ({ id: e.id, ...(e.recordedLevel === undefined ? {} : { recordedLevel: e.recordedLevel }) })),
      pending: l.pending.length, startedBeforeOffers: l.startedBeforeOffers, declaredComplete: l.declaredComplete, ...(l.broken ? { broken: l.broken } : {}),
      canDeclare: !l.declaredComplete && reason === undefined, ...(reason ? { reason } : {}),
    };
  };
  /** The page's request, checked against the active match main sees now. */
  const check = (expectedGame: unknown, championId: unknown): PickIdentity => {
    if (!isGame(expectedGame) || !isId(championId)) throw rejected('bad pick request');
    const id = now();
    if (!id) throw unavailable('no active Mayhem match');
    if (expectedGame !== id.game || championId !== id.championId) throw stale(); // an earlier match or champion
    return id;
  };

  return {
    /** Main saw a live reading taken for `at`: opens that match's log if none (before any mark, so a start below level 3 is seen as such).
     * A reading whose match or champion is no longer the active one opens nothing. */
    observe(read: LiveRead | undefined, at: PickIdentity) {
      if (read && same(now(), at)) open(at, read);
    },
    async mark(expectedGame: unknown, championId: unknown, id: unknown, on: unknown): Promise<PickSnapshot> {
      const at = check(expectedGame, championId);
      if (!isId(id) || typeof on !== 'boolean') throw rejected('bad pick request');
      const l = open(at, undefined); // a log first opened by a mark never counts as started before the offers
      if (l.events.length + l.pending.length >= MAX_EVENTS) { l.broken ??= 'سجل طويل جداً: لم يعد يُعد كاملاً'; throw rejected('pick log full'); }
      // Its place is taken now, before any wait, and marks are committed in that order whatever their checks and reads take.
      const seq = l.nextSeq++;
      const before = l.pending.at(-1)?.settled ?? Promise.resolve();
      let settle!: () => void;
      const own = new Promise<void>((r) => (settle = r));
      const mine: Pending = { seq, id, kind: on ? 'pick' : 'unpick', settled: before.then(() => own) };
      l.pending.push(mine);
      l.version++;
      const done = () => { const i = l.pending.indexOf(mine); if (i >= 0) { l.pending.splice(i, 1); l.version++; } settle(); };
      try {
        const known = await deps.knownAugment(id);
        if (!same(now(), at) || log !== l) throw stale();
        if (!known) throw rejected('unknown augment');
        let read: LiveRead | undefined;
        try { read = await deps.readLive(at.championId); } catch { read = undefined; }
        await before; // the marks that reached main earlier go first
        // The match may have changed while waiting: the answer belongs to the old one and is dropped.
        if (!same(now(), at) || log !== l) throw stale();
        const held = new Set(heldOf(l).map((e) => e.id));
        if (on ? held.has(id) : !held.has(id)) { done(); return snapshot(l); } // a repeat changes nothing
        if (on && held.size >= MAX_HELD) throw rejected('too many picks');
        l.events.push({ seq, id, kind: mine.kind, ...(on && read?.level !== undefined ? { recordedLevel: read.level } : {}) });
        l.version++;
        // An undone mark is a correction of the record, not a lost augment: the earlier event stays, and the order is no longer trusted.
        if (!on) { l.broken ??= 'عُدّل السجل بإلغاء علامة: ترتيب الاختيارات غير مؤكد'; l.declaredComplete = false; }
        if (on && read?.level === undefined) l.declaredComplete = false;
        done(); // out of the line before the answer, so the answer doesn't count itself as still being recorded
        return snapshot(l);
      } finally { done(); }
    },
    declare(expectedGame: unknown, championId: unknown): PickSnapshot {
      const l = current(check(expectedGame, championId));
      if (!l) throw unavailable('no pick log');
      if (reasonOf(l) === undefined) { l.declaredComplete = true; l.version++; }
      return snapshot(l);
    },
    /** This match's log, or null. */
    get(expectedGame: unknown, championId: unknown): PickSnapshot | null {
      const l = current(check(expectedGame, championId));
      return l ? snapshot(l) : null;
    },
    /** The log once the marks still being recorded are in: what a page that reloaded meanwhile asks for (one bounded wait, not polling).
     * If the match changes during the wait it gets nothing from the old one. */
    async whenRecorded(expectedGame: unknown, championId: unknown): Promise<PickSnapshot | null> {
      const at = check(expectedGame, championId);
      const l = current(at);
      if (!l || !l.pending.length) return l ? snapshot(l) : null;
      const last = l.pending.at(-1)!.settled;
      return Promise.race([last, new Promise<void>((r) => setTimeout(r, WAIT_MS))]).then(() => {
        if (!same(now(), at) || log !== l) throw stale();
        return snapshot(l);
      });
    },
    /** The engine's fields from the log, only in the active match, for its champion, and only when the request holds exactly the logged augments.
     * An offered card compared as a possibility is not in the log, and the request carrying it gets no certificate from it. */
    progressFor(championId: number, augmentIds: number[]): Pick<AugmentProgress, 'acquiredLevels' | 'pickOrder' | 'historyComplete' | 'historySource'> {
      const at = now();
      if (!at || at.championId !== championId) return {};
      const l = current(at);
      if (!l) return {};
      const held = heldOf(l);
      const ids = [...new Set(augmentIds)];
      if (ids.length !== augmentIds.length || ids.length !== held.length || !held.every((e) => ids.includes(e.id))) return {};
      const acquiredLevels = Object.fromEntries(held.flatMap((e) => (e.recordedLevel === undefined ? [] : [[e.id, e.recordedLevel]])));
      const complete = l.declaredComplete && !l.broken && !l.pending.length && held.every((e) => e.recordedLevel !== undefined);
      return { acquiredLevels, historySource: complete ? 'player-confirmed' : 'recorded-at-mark', ...(complete ? { historyComplete: true, pickOrder: held.map((e) => e.id) } : {}) };
    },
  };
}
export type PickDesk = ReturnType<typeof createPickDesk>;

/** Main's reading of his live state (playerNow): the identity is taken before any wait and checked again after the last one, so a reading
 * from a match or champion that changed meanwhile is dropped and opens no log. */
export async function readActive(o: {
  desk: PickDesk; game: () => number; champion: () => number | undefined; active: () => boolean; championId: number;
  snapshot: () => Promise<LiveSnapshot | null>; aliasOf: (id: number) => Promise<string | undefined>;
}): Promise<NonNullable<LiveSnapshot['active']> | undefined> {
  if (o.championId !== o.champion()) return undefined;
  const at: PickIdentity = { game: o.game(), championId: o.championId };
  const snap = await o.snapshot();
  const alias = snap?.active ? await o.aliasOf(o.championId) : undefined;
  if (o.game() !== at.game || o.champion() !== at.championId) return undefined; // the match or champion changed while reading
  const active = snap?.active && snap.active.alias === alias ? snap.active : undefined;
  if (active && o.active()) o.desk.observe({ level: active.level, belowThree: active.belowThree }, at);
  return active;
}

/** The progress a build request gets: the page's parsed fields, with the log's added only for the exact augments it logged (main.ts uses this). */
export function withPickLog<T extends AugmentProgress | undefined>(desk: PickDesk, championId: number, augmentIds: number[], timing: T): T | AugmentProgress {
  const fromLog = desk.progressFor(championId, augmentIds);
  return Object.keys(fromLog).length ? { ...timing, ...fromLog, acquiredLevels: fromLog.acquiredLevels } : timing;
}
