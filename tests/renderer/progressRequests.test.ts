import { describe, expect, it, vi } from 'vitest';
import { progressRequests } from '../../src/renderer/progressRequests.js';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
describe('fresh progression before a choice', () => {
  it('waits for a background poll and then gets a fresh level', async () => {
    const old = deferred<number>();
    const read = vi.fn((_id: number, fresh: boolean) => fresh ? Promise.resolve(11) : old.promise);
    const request = progressRequests(read);
    const background = request(103), pick = request(103, true);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    old.resolve(10);
    expect(await background).toBe(10);
    expect(await pick).toBe(11);
    expect(read).toHaveBeenLastCalledWith(103, true);
  });
  it('shares concurrent fresh reads', async () => {
    const next = deferred<number>(), read = vi.fn(() => next.promise), request = progressRequests(read);
    const a = request(103, true), b = request(103, true);
    next.resolve(9);
    expect(await Promise.all([a, b])).toEqual([9, 9]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('tries a fresh read even when the preceding background read failed', async () => {
    const request = progressRequests((_id, fresh) => fresh ? Promise.resolve(7) : Promise.reject(new Error('offline')));
    const old = request(103).catch(() => undefined), pick = request(103, true);
    await old;
    expect(await pick).toBe(7);
  });
  it('does not let another champion block the current one', async () => {
    const old = deferred<number>(), request = progressRequests((id) => id === 103 ? old.promise : Promise.resolve(15));
    const previous = request(103);
    expect(await request(55, true)).toBe(15);
    old.resolve(3); await previous;
  });
});
