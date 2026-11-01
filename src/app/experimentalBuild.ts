// A second build for what the main one can't reach: a whole build that fits the chosen augments. Tests found no proof that
// such builds win more (5,880 games: augment by build shape made predictions worse, 0.7030 against 0.6841 log loss), so it
// is an option with a label and never moves the main build. Two sources: a creator's recipe, or a shape the champion's
// players turn to with the augment.

import { AUGMENT_MECHANICS, ITEM_MECHANICS } from '../ai/mechanicsData.js';
import { boughtAs } from './buildEngine.js';
import { CREATOR_RECIPES, type Recipe } from './creatorRecipes.js';

/** Players of the champion with the augment; fewer says nothing about what the augment does. */
export const MIN_WITH_AUGMENT = 5;
/** Players of the champion without it, to know its usual shape. */
export const MIN_USUAL = 20;
/** Share of those players on the other shape before it counts as a move. */
export const MIN_SHIFT = 0.5;
/**
 * How much more of them are on it than players without the augment. Without this, champions played two ways (Shaco, Miss
 * Fortune, Bard) showed a "move" for almost any augment that tipped them over half.
 */
export const MIN_RISE = 0.25;
/** Fewer items isn't a build. */
export const MIN_ITEMS = 3;
/** A build this close to the main one adds nothing. */
export const MIN_DIFFERENT = 2;

export type BuildShape = 'ap' | 'ad' | 'tank' | 'mixed';

const AD = new Set(['ad', 'bonus_ad', 'lethality']);
const TOUGH = new Set(['health', 'bonus_health', 'armor', 'mr', 'resists']);
const kinds = new Map<number, BuildShape>();
for (const m of ITEM_MECHANICS) {
  const gives = m.gives.map((g) => g.stat);
  const ad = gives.some((s) => AD.has(s));
  const ap = gives.includes('ap');
  if (m.id < 10000) kinds.set(m.id, ap && !ad ? 'ap' : ad && !ap ? 'ad' : !ap && !ad && gives.some((s) => TOUGH.has(s)) ? 'tank' : 'mixed');
}

/** A build's shape: three or more items of one kind. */
export function shapeOf(items: number[]): BuildShape {
  const count: Record<BuildShape, number> = { ap: 0, ad: 0, tank: 0, mixed: 0 };
  for (const id of new Set(items.map((x) => boughtAs(x) % 10000))) count[kinds.get(id) ?? 'mixed']++;
  return count.ap >= 3 ? 'ap' : count.ad >= 3 ? 'ad' : count.tank >= 3 ? 'tank' : 'mixed';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** The champion's recipe naming the most of the chosen augments; `chosen` holds each augment's ids (its copies). */
export function recipeFor(champion: string, chosen: number[][]): Recipe | undefined {
  const names = new Set(chosen.flat().flatMap((id) => AUGMENT_MECHANICS.filter((m) => m.id === id).map((m) => norm(m.name))));
  const hits = (r: Recipe) => r.augments.filter((a) => names.has(norm(a))).length;
  return CREATOR_RECIPES.filter((r) => norm(r.champion) === norm(champion) && hits(r)).sort((a, b) => hits(b) - hits(a))[0];
}

interface Player {
  champion: number;
  augments: number[];
  items: number[];
}

const mostCommon = (shapes: BuildShape[]) => {
  const count = new Map<BuildShape, number>();
  for (const s of shapes) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0];
};

/**
 * What the champion's players build when the chosen augments turn them to a shape that isn't its usual one: their most
 * bought items, at most one boots. `shop` maps the shop's ids to whether the item is boots. Empty when they don't move.
 */
export function shiftedBuild(players: Player[], champion: number, chosen: number[], shop: Map<number, { boots: boolean }>): number[] {
  const own = players.filter((p) => p.champion === champion);
  const took = (p: Player) => p.augments.some((a) => chosen.includes(a));
  const withIt = own.filter(took);
  const rest = own.filter((p) => !took(p));
  if (withIt.length < MIN_WITH_AUGMENT || rest.length < MIN_USUAL) return [];
  const [usual] = mostCommon(rest.map((p) => shapeOf(p.items)));
  const [shape, count] = mostCommon(withIt.map((p) => shapeOf(p.items)));
  const share = count / withIt.length;
  const shareWithout = rest.filter((p) => shapeOf(p.items) === shape).length / rest.length;
  if (shape === usual || shape === 'mixed' || share < MIN_SHIFT || share - shareWithout < MIN_RISE) return [];
  const bought = new Map<number, number>();
  for (const p of withIt) {
    if (shapeOf(p.items) !== shape) continue;
    const ids = p.items.flatMap((id) => [boughtAs(id), boughtAs(id % 10000)].find((x) => shop.has(x)) ?? []);
    for (const id of new Set(ids)) bought.set(id, (bought.get(id) ?? 0) + 1);
  }
  const out: number[] = [];
  for (const [id, n] of [...bought].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    if (n < 2 || out.length >= 6) continue; // one player's item is that player's
    if (shop.get(id)!.boots && out.some((x) => shop.get(x)!.boots)) continue;
    out.push(id);
  }
  return out;
}

/** Worth showing next to the main build. */
export const worthShowing = (items: number[], main: number[]) => items.length >= MIN_ITEMS && items.filter((id) => !main.includes(id)).length >= MIN_DIFFERENT;
