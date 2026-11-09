/** A pick waits for an existing background read, then requires a fresh one. Concurrent fresh reads share their result. */
export function progressRequests<T>(read: (champion: number, fresh: boolean) => Promise<T>) {
  const pending = new Map<number, { fresh: boolean; result: Promise<T> }>();
  const request = (champion: number, fresh = false): Promise<T> => {
    const existing = pending.get(champion);
    if (existing) {
      if (!fresh || existing.fresh) return existing.result;
      return existing.result.catch(() => undefined).then(() => request(champion, true));
    }
    const entry = { fresh, result: Promise.resolve().then(() => read(champion, fresh)) };
    pending.set(champion, entry);
    entry.result = entry.result.finally(() => { if (pending.get(champion) === entry) pending.delete(champion); });
    return entry.result;
  };
  return request;
}
