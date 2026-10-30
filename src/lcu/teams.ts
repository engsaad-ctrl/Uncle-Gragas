// Both teams once a game is loaded (the loading screen onwards), from the client's gameflow session: the same players
// and champions the loading screen shows. Fields are read defensively; the player's team is the one with their champion.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export interface GamePlayer {
  championId: number;
  /** Empty when the client hides it. */
  puuid: string;
  name: string;
}

export function teamsInGame(gameflow: unknown, myChampion: number | null | undefined): { mine: GamePlayer[]; enemy: GamePlayer[] } | null {
  const data = obj(obj(gameflow)?.gameData);
  const team = (v: unknown): GamePlayer[] =>
    (Array.isArray(v) ? v : []).map(obj).flatMap((p) => {
      const championId = Number(p?.championId) || 0;
      if (!championId) return [];
      return [{ championId, puuid: str(p?.puuid), name: str(p?.riotIdGameName) || str(p?.gameName) || str(p?.summonerName) }];
    });
  const one = team(data?.teamOne), two = team(data?.teamTwo);
  if (!myChampion || !one.length || !two.length) return null;
  if (one.some((p) => p.championId === myChampion)) return { mine: one, enemy: two };
  if (two.some((p) => p.championId === myChampion)) return { mine: two, enemy: one };
  return null;
}
