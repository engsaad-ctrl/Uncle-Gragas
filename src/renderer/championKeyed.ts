// Per-champion stats that load after the page draws (T261 review): kept with the champion they were fetched for, so a switch to
// another champion never shows the previous one's numbers while the new request is still out.
export interface ChampionKeyed<T> { champion?: number; map: Map<number, T> }

export const keyedTo = <T>(champion?: number, map = new Map<number, T>()): ChampionKeyed<T> => ({ champion, map });

/** The value for this card, only when the stats were fetched for this champion. */
export const readFor = <T>(k: ChampionKeyed<T>, champion: number | undefined, id: number): T | undefined =>
  champion !== undefined && k.champion === champion ? k.map.get(id) : undefined;
