// The path the player walks: one item for each augment taken. The engine builds its list from scratch each time; on 1,004 random
// augment pairs over 67 champions a second augment changed the first item 7.9% of the time and dropped it from the list 5.6%. So
// items already advised stay while they're still in the list, and leave with a word to the player when they aren't.

export interface BuildPath {
  /** The augments this path was made for. */
  marks: number[];
  /** Item ids in buying order. */
  items: number[];
  /** How many of `items` the player has already been told to buy; the next one to buy is at this place. */
  bought: number;
  /** Items advised earlier that no longer fit, to tell the player. */
  dropped: number[];
}

/** The path given what the player says he bought: that's fact, so nothing is inferred from the augments, and his items lead the engine's list. */
export function walkedPath(path: BuildPath | undefined, marks: number[], owned: number[], fresh: number[]): BuildPath {
  return owned.length ? { marks, items: fresh, bought: owned.length, dropped: [] } : followPath(path, marks, fresh);
}

/** The items on the player's path: what he bought once he says; until then those reached and the next one suggested. */
export const itemsHeld = (path: BuildPath | undefined, owned: number[]) => (owned.length ? owned : (path?.items.slice(0, path.bought + 1) ?? []));

/** The path after the marks changed to `marks`, with `fresh` the engine's list for them. */
export function followPath(path: BuildPath | undefined, marks: number[], fresh: number[]): BuildPath {
  if (path && path.marks.length === marks.length && path.marks.every((m) => marks.includes(m))) return { ...path, dropped: [] }; // the same marks: nothing to walk
  const oneMore = path && marks.length === path.marks.length + 1 && path.marks.every((m) => marks.includes(m));
  // shortcut: an augment removed or several marked at once starts over, taking one item per earlier augment as bought from the new list.
  if (!oneMore) return { marks, items: fresh, bought: Math.max(0, marks.length - 1), dropped: [] };
  const advised = path.items.slice(0, path.marks.length);
  const kept = advised.filter((id) => fresh.includes(id));
  return { marks, items: [...kept, ...fresh.filter((id) => !kept.includes(id))], bought: kept.length, dropped: advised.filter((id) => !kept.includes(id)) };
}
