// A recommendation is not a purchase. Only observed or explicitly entered inventory fixes an item on the path.

export interface BuildPath {
  /** The augments this path was made for. */
  marks: number[];
  /** Item ids in buying order. */
  items: number[];
  /** The owned prefix; never inferred from augment count. */
  bought: number;
  /** Items advised earlier that no longer fit, to tell the player. */
  dropped: number[];
}

export function walkedPath(path: BuildPath | undefined, marks: number[], owned: number[], fresh: number[]): BuildPath {
  const available = [...new Set(fresh)];
  const bought = [...new Set(owned)].filter((id) => available.includes(id));
  return {
    marks: [...marks], items: [...bought, ...available.filter((id) => !bought.includes(id))], bought: bought.length,
    dropped: (path?.items ?? []).filter((id) => !available.includes(id) && !owned.includes(id)),
  };
}
