// The build without AI, in two layers. The base: what players of the champion buy in normal ARAM on OP.GG (tens of
// thousands of games, same map) and in our Mayhem games. The augment layer on top: items an augment is built around come
// first, items its mechanics feed or that won more with it move up, and items of the other damage kind drop out. The
// player's chosen augments change the build by changing that layer only.

/** What one unit of text-link strength is worth next to the base scores (a core item is about 1). */
export const LINK_WEIGHT = 0.6;
/** How far magic resist moves for the enemy team's damage (see scoreItems). */
export const ENEMY_WEIGHT = 0.5;
/**
 * Share of the champion's players an item needs before links, lift or the enemy team can move it. Without this a link
 * alone put items nobody plays on the champion in the build (Riftmaker on Braum, Phantom Dancer on Mordekaiser): 14% of
 * the picks in a held-out test. Win-rate-wise the gate was neutral (correlation difference 0.001, 95% range -0.008 to 0.010).
 */
export const MIN_SHARE = 0.03;

export interface EngineItem {
  id: number;
  boots: boolean;
  /** What the item gives: AP only, AD only, or neither/both (see itemDamage in services). */
  damage: 'ap' | 'ad' | 'none';
  /** It gives magic resist. */
  mr?: boolean;
}

export interface EngineInput {
  /** The champion's damage kind from its abilities ('mixed' allows both). */
  championDamage: 'ap' | 'ad' | 'mixed';
  /** A chosen augment turns one damage kind into the other (ADAPt): both allowed. */
  switchesDamage?: boolean;
  pool: EngineItem[];
  /** OP.GG's normal-ARAM build for the champion: its options with pick and win rates. */
  base: { ids: number[]; pickRate: number; winRate: number; core?: boolean }[];
  /** Items players of the champion bought in our Mayhem games. */
  mayhem: { id: number; games: number; wins: number }[];
  /** How often the champion was played in those games. */
  mayhemGames: number;
  /** Items a chosen augment is built around (Heartsteel for Steel Your Heart). */
  required: number[];
  /** Summed text-link strength between each item and the chosen augments (src/ai/mechanics.ts). */
  links: Map<number, number>;
  /** Measured win lift of each item with the chosen augments, beyond its usual strength (augmentItemSynergy). */
  synergy: Map<number, number>;
  /** Magic damage among the five enemies (magic 1, mixed 0.5), once the game is loaded; unknown before. */
  enemyMagic?: number;
}

export interface EngineResult {
  items: number[];
  /** Why each item is in: base, mayhem, link, synergy, required (shown to the player). */
  why: Map<number, string[]>;
}

// Items that turn into another and cannot be bought as such count as the one bought: Muramana is a Manamune, Seraph's
// Embrace an Archangel's Staff, Fimbulwinter a Winter's Approach (OP.GG and the game's records name the final form). The
// map's copies share the last four digits (773042 is a Muramana too).
const BOUGHT_AS: Record<number, number> = { 3042: 3004, 3040: 3003, 3121: 3119 };
export const boughtAs = (id: number) => {
  const tail = id % 10000;
  return BOUGHT_AS[tail] ? id - tail + BOUGHT_AS[tail] : id;
};

/** Each item's score; the parts are kept for the explanation. */
export function scoreItems(input: EngineInput): Map<number, { score: number; why: string[] }> {
  const out = new Map<number, { score: number; why: string[] }>();
  const add = (id: number, v: number, why: string) => {
    const s = out.get(id) ?? { score: 0, why: [] };
    s.score += v;
    if (v > 0.05) s.why.push(why);
    out.set(id, s);
  };
  const inBase = new Set(input.base.flatMap((b) => b.ids.map(boughtAs)));
  const bought = new Map<number, number>();
  for (const m of input.mayhem) bought.set(boughtAs(m.id), (bought.get(boughtAs(m.id)) ?? 0) + m.games);
  // A champion with no data at all has nothing to gate by: the links are all there is.
  const known = (id: number) =>
    (!inBase.size && !input.mayhemGames) || inBase.has(boughtAs(id)) || (input.mayhemGames > 0 && (bought.get(boughtAs(id)) ?? 0) / input.mayhemGames >= MIN_SHARE);
  // Base: how often the champion's ARAM players take it (core items count fully), nudged by how much it wins.
  for (const b of input.base) {
    const weight = (b.core ? 1 : b.pickRate) * (1 + 4 * (b.winRate - 0.5));
    for (const id of b.ids) add(boughtAs(id), weight, 'base');
  }
  // Our Mayhem games: share of the champion's players buying it, the same nudge, pulled toward even with few games.
  for (const m of input.mayhem) {
    const share = input.mayhemGames ? m.games / input.mayhemGames : 0;
    const win = (m.wins + 10) / (m.games + 20);
    add(boughtAs(m.id), share * (1 + 4 * (win - 0.5)), 'mayhem');
  }
  for (const [id, s] of input.links) if (known(id)) add(id, LINK_WEIGHT * s, 'link');
  for (const [id, lift] of input.synergy) if (known(id)) add(id, 3 * lift, 'synergy');
  // The one enemy answer our games bear out: magic resist bought against 3+ magic-damage enemies led by 6.6 points more
  // than against 1.5 or fewer (difference in differences, 95% range 2.8 to 9.9). Armor against physical teams, anti-heal
  // against healers and penetration against tanks did not show it, so they are left to the base.
  if (input.enemyMagic !== undefined) {
    const tilt = input.enemyMagic >= 3 ? ENEMY_WEIGHT : input.enemyMagic <= 1.5 ? -ENEMY_WEIGHT : 0;
    if (tilt) for (const i of input.pool) if (i.mr && known(i.id)) add(i.id, tilt, 'enemy');
  }
  return out;
}

/**
 * Six items: the required ones, the best boots (when the champion's players buy boots), then the best-scoring others.
 * Never two boots or repeats; items of the other damage kind are left out unless an augment switches it.
 */
export function buildFor(input: EngineInput): EngineResult {
  const byId = new Map(input.pool.map((i) => [i.id, i]));
  const scores = scoreItems(input);
  const offKind = (i: EngineItem) =>
    !input.switchesDamage && input.championDamage !== 'mixed' && i.damage !== 'none' && i.damage !== input.championDamage;
  const ranked = [...scores]
    .filter(([id]) => byId.has(id) && !offKind(byId.get(id)!))
    .sort((a, b) => b[1].score - a[1].score);
  const items: number[] = [];
  const why = new Map<number, string[]>();
  const take = (id: number, reasons: string[]) => {
    if (items.includes(id) || items.length >= 6) return;
    const it = byId.get(id);
    if (!it || (it.boots && items.some((x) => byId.get(x)!.boots))) return;
    items.push(id);
    why.set(id, reasons);
  };
  for (const id of input.required) take(id, ['required', ...(scores.get(id)?.why ?? [])]);
  const boots = ranked.find(([id]) => byId.get(id)!.boots);
  if (boots && boots[1].score > 0.3) take(boots[0], boots[1].why);
  for (const [id, s] of ranked) if (!byId.get(id)!.boots && s.score > 0) take(id, s.why);
  // Boots go first in the list, as players buy them.
  items.sort((a, b) => Number(byId.get(b)!.boots) - Number(byId.get(a)!.boots));
  return { items, why };
}
