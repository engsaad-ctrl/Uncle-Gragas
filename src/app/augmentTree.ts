// The augment tree (owner 2026-11-26): one fit score per card for each champion, drawn from the principles in knowledge/tree-trial/,
// and the fit changes with every augment already taken: base score + line following + specific "after" rules.
// Percentages are fit percentages over the offered cards (softmax), not win chances.

/** One champion's tree in compact form: lines [name, why, items], cards id → [score, why, line indexes], after [held, boost, delta, why]. */
export interface CompactTree {
  lines: [string, string, string[]][];
  a: Record<string, [number, string, number[]]>;
  after: [number, number, number, string][];
}
export type TreeBundle = Record<string, CompactTree>;

/** Each held card in a line raises the line's other cards by this much (up to 3 held per line). */
export const LINE_STEP = 6;
/** Once a line holds 2+ cards, a card from another line drops by this much. A card in no line (gold, anvils, pure utility, traps)
 *  is exempt on purpose: it never belonged to a line, and FIT_T was fitted with this exemption (knowledge/tree-trial/fit.mjs). */
export const OFF_LINE = 6;
/** Softmax temperature fitted on creator offers (knowledge/tree-trial/win-test-plan.md, addendum 2). */
export const FIT_T = 36;

export interface TreeFit {
  id: number;
  /** The card's base score in this champion's tree (50 when the tree has no row for it). */
  base: number;
  fit: number;
  /** Share among the offered cards, 0–100. */
  pct: number;
  why?: string;
  /** Reasons of the "after" rules that moved this card, given what is held. */
  because: string[];
  /** Names of the build lines this card serves. */
  lines: string[];
}

export function fitOffer(tree: CompactTree, offered: number[], held: number[] = []): TreeFit[] {
  const linesOf = (id: number) => tree.a[id]?.[2] ?? [];
  const heldPerLine = new Map<number, number>();
  for (const h of held) for (const l of linesOf(h)) heldPerLine.set(l, (heldPerLine.get(l) ?? 0) + 1);
  const committed = [...heldPerLine.values()].some((n) => n >= 2);
  const rows = offered.map((id) => {
    const row = tree.a[id];
    const base = row?.[0] ?? 50;
    const mine = linesOf(id);
    const line = mine.reduce((s, l) => s + LINE_STEP * Math.min(3, heldPerLine.get(l) ?? 0), 0);
    const off = committed && mine.length && !mine.some((l) => heldPerLine.has(l)) ? -OFF_LINE : 0;
    const rules = tree.after.filter(([h, b]) => b === id && held.includes(h));
    const after = rules.reduce((s, r) => s + r[2], 0);
    return { id, base, fit: base + line + off + after, pct: 0, why: row?.[1], because: rules.map((r) => r[3]), lines: mine.map((l) => tree.lines[l]?.[0]).filter((n): n is string => !!n) };
  });
  if (!rows.length) return rows;
  const top = Math.max(...rows.map((r) => r.fit));
  const e = rows.map((r) => Math.exp((r.fit - top) / FIT_T));
  const z = e.reduce((s, v) => s + v, 0);
  rows.forEach((r, i) => { r.pct = Math.round((100 * e[i]) / z); });
  return rows.sort((x, y) => y.fit - x.fit);
}

/** The champion's tree, only in Mayhem: Arena and the other modes keep their own order (T261 review). */
export const treeFor = (trees: TreeBundle, mode: string | null | undefined, champion: number | undefined) => (mode === 'mayhem' && champion !== undefined ? trees[String(champion)] : undefined);

/** One card's fit with what is held, as a 0–100 bar value: base + line following + "after" rules, clamped. Moves with every pick. */
export const fitPercent = (tree: CompactTree, id: number, held: number[] = []) => Math.max(0, Math.min(100, Math.round(fitOffer(tree, [id], held)[0].fit)));

/** The line whose items the build page shows (owner 2026-11-27: the tree's build first): the line his picks point to, else the tree's first
 *  line, which the writers put first as the champion's main line. */
export const buildLine = (tree: CompactTree, held: number[]) => heldLine(tree, held) ?? (tree.lines[0] ? { name: tree.lines[0][0], why: tree.lines[0][1], items: tree.lines[0][2] } : undefined);

/** The line the held cards point to most (ties: the earlier line), with its items; undefined before any held card serves a line. */
export function heldLine(tree: CompactTree, held: number[]): { name: string; why: string; items: string[] } | undefined {
  const count = new Map<number, number>();
  for (const h of held) for (const l of tree.a[h]?.[2] ?? []) count.set(l, (count.get(l) ?? 0) + 1);
  const best = [...count].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
  const l = best && tree.lines[best[0]];
  return l ? { name: l[0], why: l[1], items: l[2] } : undefined;
}
