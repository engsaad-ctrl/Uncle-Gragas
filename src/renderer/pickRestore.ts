// Where F7's picks come from when it loads (T012), the one decision overlay.load takes:
// - a successful answer from main's live pick log is the source, even when it is empty or there is no log yet (null): the last build asked
//   for (lastAiPicks) is never poured into a running match's picks, which today's decision knows nothing about;
// - an answer from a changed match, or a refusal, brings nothing back;
// - only where there is no live log (no active match, the phone page, main unreachable) do the last build's augments come back, as manual
//   marks with no certificate, once per champion (manualAllowed).
import type { PickSnapshot } from '../main/pickLog.js';

type Reply<T> = T | { error: string };
export interface RestoreBridge {
  pickLog(game: number, championId: number, wait?: boolean): Promise<Reply<PickSnapshot | null>>;
  lastAiPicks(): Promise<{ championId: number; augmentIds: number[] } | null>;
}
export type RestorePlan =
  | { source: 'log'; snap: PickSnapshot | null; followPending: boolean }
  | { source: 'manual'; ids: number[] }
  | { source: 'none' };

const failed = (r: unknown): r is { error: string } => typeof r === 'object' && r !== null && 'error' in r;

export async function restorePicks(bridge: RestoreBridge, o: { game: number | undefined; championId: number; known: (id: number) => boolean; manualAllowed: boolean }): Promise<RestorePlan> {
  if (o.game !== undefined) {
    const r = await bridge.pickLog(o.game, o.championId);
    if (!failed(r)) return { source: 'log', snap: r, followPending: !!r?.pending };
    if (/^pick-(stale|rejected)/.test(r.error)) return { source: 'none' };
  }
  if (!o.manualAllowed) return { source: 'manual', ids: [] };
  const last = await bridge.lastAiPicks();
  return { source: 'manual', ids: last?.championId === o.championId ? last.augmentIds.filter(o.known) : [] };
}
