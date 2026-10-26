// The profile page the window shows: the client's raw profile joined with names and icons.

import type { MatchRow, RankedQueue, RawProfile } from '../lcu/profile.js';
import { assetUrl } from '../texts/assets.js';
import type { ChampionListEntry, NamedText } from '../texts/champions.js';
import type { ItemText } from '../texts/items.js';

export interface MatchView extends Omit<MatchRow, 'items' | 'spells' | 'championId'> {
  champion: ChampionListEntry | null;
  queue: string;
  items: NamedText[];
  spells: NamedText[];
}

export interface ProfilePage {
  puuid: string;
  gameName: string;
  tagLine: string;
  level: number;
  iconUrl: string;
  ranked: RankedQueue[];
  matches: MatchView[];
  /** Over the matches shown. */
  summary: { games: number; wins: number; kills: number; deaths: number; assists: number; top: { champion: ChampionListEntry; games: number; wins: number }[] };
  recent: { puuid: string; gameName: string; tagLine: string; champion: ChampionListEntry | null; playedAt: number }[];
  /** True for the logged-in player. */
  me: boolean;
}

// Queue ids as the client reports them (2026-10). Unknown ids fall back to the game mode's name.
const QUEUES: Record<number, string> = {
  420: 'Ranked Solo/Duo', 440: 'Ranked Flex', 400: 'Normal Draft', 430: 'Normal Blind', 490: 'Quickplay', 480: 'Swiftplay',
  450: 'ARAM', 2400: 'ARAM Mayhem', 1700: 'Arena', 1710: 'Arena', 900: 'URF', 1900: 'URF', 1300: 'Nexus Blitz', 0: 'Custom',
  830: 'Co-op vs AI', 840: 'Co-op vs AI', 850: 'Co-op vs AI', 870: 'Co-op vs AI', 880: 'Co-op vs AI', 890: 'Co-op vs AI',
};
const MODES: Record<string, string> = { CLASSIC: "Summoner's Rift", ARAM: 'ARAM', CHERRY: 'Arena', KIWI: 'ARAM Mayhem', URF: 'URF' };

export const profileIconUrl = (id: number) => assetUrl(`/lol-game-data/assets/v1/profile-icons/${id}.jpg`);

export function composeProfile(
  raw: RawProfile,
  champions: ChampionListEntry[],
  items: Map<number, ItemText>,
  spells: Map<number, NamedText>,
  me: boolean,
): ProfilePage {
  const champ = new Map(champions.map((c) => [c.id, c]));
  const item = (id: number): NamedText[] => {
    const t = items.get(id);
    return t ? [{ id, name: t.name, enName: t.enName, html: t.html, iconUrl: assetUrl(t.iconPath) }] : [];
  };
  const matches = raw.matches.map(({ items: ids, spells: sp, championId, ...m }) => ({
    ...m,
    champion: champ.get(championId) ?? null,
    queue: QUEUES[m.queueId] ?? MODES[m.gameMode] ?? m.gameMode,
    items: ids.flatMap(item),
    spells: sp.flatMap((id) => (spells.has(id) ? [spells.get(id)!] : [])),
  }));
  const byChamp = new Map<number, { champion: ChampionListEntry; games: number; wins: number }>();
  for (const m of matches) {
    if (!m.champion) continue;
    const t = byChamp.get(m.champion.id) ?? { champion: m.champion, games: 0, wins: 0 };
    t.games++;
    if (m.win) t.wins++;
    byChamp.set(m.champion.id, t);
  }
  const sum = (f: (m: MatchView) => number) => matches.reduce((a, m) => a + f(m), 0);
  return {
    puuid: raw.puuid,
    gameName: raw.gameName,
    tagLine: raw.tagLine,
    level: raw.level,
    iconUrl: profileIconUrl(raw.iconId),
    ranked: raw.ranked,
    matches,
    summary: {
      games: matches.length,
      wins: matches.filter((m) => m.win).length,
      kills: sum((m) => m.kills),
      deaths: sum((m) => m.deaths),
      assists: sum((m) => m.assists),
      top: [...byChamp.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 5),
    },
    recent: raw.recent.slice(0, 20).map((r) => ({ puuid: r.puuid, gameName: r.gameName, tagLine: r.tagLine, champion: champ.get(r.championId) ?? null, playedAt: r.playedAt })),
    me,
  };
}
