import type { MetaRow } from '../stats/opgg.js';
import type { ChampionListEntry } from '../texts/champions.js';

export interface TierRow extends MetaRow {
  /** null when the champion is missing from the champion data (shown without a link). */
  id: number | null;
  name: string;
  enName: string;
  portraitUrl: string;
  /** Places gained since the previous period (negative = dropped). */
  change: number;
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
