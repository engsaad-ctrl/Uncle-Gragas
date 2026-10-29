// Diagnostics export: raw client answers with anything identifying removed, so the owner can share the file.

const SENSITIVE = /name|tagline|puuid|summonerid|accountid|playerid|token|password|chat|email/i;
const KEEP = /^(nameVisibilityType|championName|gameName_?visible)$/i; // flags/labels, not identities

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) && !KEEP.test(k) ? '[حُذف]' : scrub(v)]),
    );
  }
  return value;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isMayhem = (g: Json) => g.queueId === 2400 || g.gameMode === 'KIWI' || (g.mapId === 12 && g.gameMode !== 'ARAM');

/**
 * Do the client's game details keep a Mayhem game's augments? (Riot's match-v5 does not list Mayhem games.)
 * `list` is the player's match history, `details` reads /lol-match-history/v1/games/{id}. Champions and augment ids only.
 */
export async function mayhemAugmentCheck(list: unknown, details: (gameId: number) => Promise<unknown>): Promise<unknown> {
  const games = arr(obj(obj(list)?.games)?.games).map(obj).filter((g): g is Json => g !== null);
  const queues = [...new Set(games.map((g) => `${g.queueId}/${g.gameMode}/map${g.mapId}`))];
  const found = games.find(isMayhem);
  if (!found) return { found: false, gamesRead: games.length, queues };
  const game = obj(await details(Number(found.gameId)));
  const players = arr(game?.participants).map(obj).filter((p): p is Json => p !== null);
  const rows = players.map((p) => {
    const s = obj(p.stats) ?? {};
    return { championId: p.championId, win: s.win, augments: [1, 2, 3, 4, 5, 6].map((i) => s[`playerAugment${i}`] ?? null) };
  });
  return {
    found: true,
    gamesRead: games.length,
    queues,
    game: { queueId: game?.queueId, gameMode: game?.gameMode, mapId: game?.mapId, createdAt: game?.gameCreation },
    playersWithAugments: rows.filter((r) => r.augments.some((a) => typeof a === 'number' && a > 0)).length,
    players: rows.length,
    augmentFields: Object.keys(obj(players[0]?.stats) ?? {}).filter((k) => /augment/i.test(k)),
    rows,
  };
}
