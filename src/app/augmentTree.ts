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
export const LINE_STEP = 10; // T269: halfway from 6 to the 15 creator picks preferred (owner «طبّقه بنصف القوة»)
/** Once a line holds 2+ cards, a card from another line drops by this much. A card in no line (gold, anvils, pure utility, traps)
 *  is exempt on purpose: it never belonged to a line, and FIT_T was fitted with this exemption (knowledge/tree-trial/fit.mjs). */
export const OFF_LINE = 3; // T269: halfway from 6 to 0
/** Weight of the after rules' deltas (T269: halfway from 1 to the learned 1.5). */
export const AFTER_WEIGHT = 1.25;
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

/** The enemy team as the tree reads it (owner 2026-11-27 «قواعد من النص بوزن صغير»): how many of the five are frontline tanks and how many
 *  rely on crowd control, from their kits. */
export interface EnemyCounts { tanks: number; cc: number; magic?: number; healers?: number }
export const enemyCounts = (kits: readonly { id: number; traits: string[]; relies: string[] }[], foes: number[]): EnemyCounts => {
  const of = foes.map((id) => kits.find((k) => k.id === id)).filter((k): k is NonNullable<typeof k> => !!k);
  return { tanks: of.filter((k) => k.traits.includes('frontline')).length, cc: of.filter((k) => k.relies.includes('crowd_control')).length, magic: of.filter((k) => (k as { damage?: string }).damage === 'magic').length, healers: of.filter((k) => k.relies.includes('healing')).length };
};
/** Text-read card classes (knowledge/tree-trial/measure/enemy-classes.mjs, hand-checked): with 3+ such enemies each class gets ENEMY_STEP.
 *  A small weight by the owner's choice: the games show enemy effects are small (measure/enemy-rules.mjs), so this is an assumption to measure. */
export const ENEMY_STEP = 5;
const ENEMY_RULES: { feat: keyof EnemyCounts; ids: Set<number>; why: string }[] = [
  { feat: 'tanks', ids: new Set([25, 28, 36, 84, 133, 195, 1025, 1028, 1036, 1084, 1133, 1195, 1321, 1325, 1409, 2098, 2133, 3016, 3150]), why: 'أمامك 3 مدرّعين أو أكثر: ضرر نسبة الصحة والضرر الحقيقي والاختراق أنفع.' },
  { feat: 'cc', ids: new Set([112, 305, 1001, 1112, 1305]), why: 'فريق الخصم كثير التحكّم: الثبات ومقاومة الإبطاء أنفع.' },
];

export function fitOffer(tree: CompactTree, offered: number[], held: number[] = [], enemy?: EnemyCounts): TreeFit[] {
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
    const after = AFTER_WEIGHT * rules.reduce((s, r) => s + r[2], 0);
    const foes = enemy ? ENEMY_RULES.filter((r) => (enemy[r.feat] ?? 0) >= 3 && r.ids.has(id)) : [];
    return { id, base, fit: base + line + off + after + ENEMY_STEP * foes.length, pct: 0, why: row?.[1], because: [...rules.map((r) => r[3]), ...foes.map((r) => r.why)], lines: mine.map((l) => tree.lines[l]?.[0]).filter((n): n is string => !!n) };
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
export const fitPercent = (tree: CompactTree, id: number, held: number[] = [], enemy?: EnemyCounts) => Math.max(0, Math.min(100, Math.round(fitOffer(tree, [id], held, enemy)[0].fit)));

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

/** Owner 2026-11-27 «اكمل»: the tree line's items answer the enemy team with one swap per need, from the end of the list (boots and the
 *  first items stay): anti-heal against 2+ healers, penetration against 3+ tanks, magic resist against 3+ magic damage dealers. The item
 *  for each need follows his own damage (magic, physical, or a frontline tank) and whether the line already crits. */
const CRIT = new Set(['Infinity Edge', 'Navori Flickerblade', "Yun Tal Wildarrows", 'Phantom Dancer', 'Statikk Shiv', 'Essence Reaver', 'The Collector', 'Rapid Firecannon', 'Bloodthirster']);
const BOOTS = /Boots|Greaves|Treads|Steelcaps|Shoes|Swiftness|Lucidity|Symbiotic|Synchronized|Gunmetal|Crimson|Spellslinger|Armored Advance|Chainlaced|Forever Forward/;
export interface ItemSwap { out: string; in: string; why: string }
export function adaptItems(items: string[], me: { damage: string; frontline: boolean }, enemy?: EnemyCounts): { items: string[]; swaps: ItemSwap[] } {
  const out = [...items], swaps: ItemSwap[] = [];
  if (!enemy) return { items: out, swaps };
  const magic = me.damage === 'magic', crit = items.some((i) => CRIT.has(i));
  const needs: [boolean, string, string][] = [
    [(enemy.healers ?? 0) >= 2, magic ? 'Morellonomicon' : me.frontline ? 'Thornmail' : crit ? 'Mortal Reminder' : 'Chempunk Chainsword', 'في فريق الخصم معالجون: غرض يقطع العلاج.'],
    [enemy.tanks >= 3, magic ? 'Void Staff' : me.frontline ? 'Black Cleaver' : crit ? "Lord Dominik's Regards" : "Serylda's Grudge", 'أمامك 3 مدرّعين أو أكثر: غرض اختراق.'],
    [(enemy.magic ?? 0) >= 3, me.frontline ? 'Force of Nature' : magic ? "Banshee's Veil" : 'Maw of Malmortius', '3 من الخصوم أو أكثر ضررهم سحري: غرض مقاومة سحر.'],
  ];
  let slot = out.length - 1;
  for (const [need, item, why] of needs) {
    if (!need || out.includes(item)) continue;
    while (slot >= 2 && (BOOTS.test(out[slot]) || swaps.some((s) => s.in === out[slot]))) slot--;
    if (slot < 2) break;
    swaps.push({ out: out[slot], in: item, why });
    out[slot] = item;
    slot--;
  }
  return { items: out, swaps };
}
