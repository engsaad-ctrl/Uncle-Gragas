import type { LanePosition, MetaRow } from '../stats/opgg.js';
import type { ChampionListEntry } from '../texts/champions.js';

export interface TierRow extends MetaRow {
  /** null when the champion is missing from the champion data (shown without a link). */
  id: number | null;
  name: string;
  enName: string;
  portraitUrl: string;
  /** Places gained since the previous period (negative = dropped). */
  change: number;
  /** The row's lane, in the all-lanes list. */
  lane?: LanePosition;
}

export function composeTierList(rows: MetaRow[], champions: ChampionListEntry[]): TierRow[] {
  const byEnName = new Map(champions.map((c) => [c.enName, c]));
  return rows.map((r) => {
    const c = byEnName.get(r.champion);
    return {
      ...r,
      id: c?.id ?? null,
      name: c?.name ?? r.champion,
      enName: r.champion,
      portraitUrl: c?.portraitUrl ?? '',
      change: r.rankPrev ? r.rankPrev - r.rank : 0,
    };
  });
}

/**
 * Every lane in one list, like the stat sites' default view: a champion appears once per lane it is played in,
 * best tier first, then highest win rate. Lane ranks do not compare across lanes, so rows are renumbered.
 */
export function composeAllLanes(byLane: Record<LanePosition, MetaRow[]>, champions: ChampionListEntry[]): TierRow[] {
  return (Object.keys(byLane) as LanePosition[])
    .flatMap((lane) => composeTierList(byLane[lane], champions).map((r) => ({ ...r, lane, change: 0 })))
    .sort((a, b) => a.tier - b.tier || b.winRate - a.winRate)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** The lane the champion has the most games in (pages opened without a lane, blind pick); Mid when unknown. */
export function mainLane(byLane: Record<LanePosition, MetaRow[]> | undefined, enName: string): LanePosition {
  let best: LanePosition = 'mid';
  let most = 0;
  for (const lane of Object.keys(byLane ?? {}) as LanePosition[]) {
    const games = byLane![lane].find((r) => r.champion === enName)?.games ?? 0;
    if (games > most) [best, most] = [lane, games];
  }
  return best;
}
