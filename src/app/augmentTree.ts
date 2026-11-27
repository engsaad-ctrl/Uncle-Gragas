import { AUGMENT_TAGS } from '../ai/augmentTags.js';
import { ABILITY_FIT, AUGMENT_CRIT, CHOSEN_ABILITY, ITEM_CRIT, ITEM_GROUPS, ITEM_KIND } from '../ai/augmentTreesData.js';
// The augment tree (owner 2026-11-26): one fit score per card for each champion, drawn from the principles in knowledge/tree-trial/,
// and the fit changes with every augment already taken: base score + line following + specific "after" rules.
// Percentages are fit percentages over the offered cards (softmax), not win chances.

/** One champion's tree in compact form: lines [name, why, items], cards id → [score, why, line indexes], after [held, boost, delta, why]. */
export interface CompactTree {
  lines: [string, string, string[]][];
  a: Record<string, [number, string, number[]]>;
  after: [number, number, number, string][];
  /** Per card, how many of its holders' finished items matched each line best (knowledge/tree-trial/line-table.mjs). */
  lt?: Record<string, number[]>;
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

/** T270 (owner «طبّقها وانشر»): each stat the offered card gives that a held card also gives (style tags, src/ai/augmentTags.ts), up to 3,
 *  adds STAT_STEP: stacking one stat. Chosen on 881 creator rounds; on 118 unseen rounds top-1 60% -> 61%. */
export const STAT_STEP = 6;
const STAT_AR: Record<string, string> = { ap: 'AP', ad: 'AD', attackspeed: 'سرعة الهجوم', haste: 'تسريع المهارات', crit: 'الضربة الحرجة', health: 'الصحة', tank: 'التحمّل', onhit: 'تأثير عند الضرب', mana: 'المانا', lethality: 'الفتك' };
const stylesOf = (id: number) => (AUGMENT_TAGS[id]?.tags ?? []).filter((t) => t.startsWith('style:')).map((t) => t.slice(6));

/** Owner 2026-11-27 «نعم، أصلحها»: crit chance stops at 100%. The build line's crit items (25% each) plus the held cards' crit (their text)
 *  is what he will have; the part of an offered card's crit above 100% is lost, CRIT_CAP_STEP per 25 points, and it no longer counts as
 *  stacking crit. Champions whose kit changes crit (Yasuo, Yone) are not modelled. */
export const CRIT_CAP_STEP = 10;
// Item crit comes from the game item text (ITEM_CRIT, made by bundle-trees.mjs), not a hand list.
const critOf = (id: number) => AUGMENT_CRIT[String(id)] ?? 0;
export const critHeld = (tree: CompactTree, held: number[]) => (buildLine(tree, held)?.items.reduce((s, i) => s + (ITEM_CRIT[i] ?? 0), 0) ?? 0) + held.reduce((s, h) => s + critOf(h), 0);

/** Owner 2026-11-27 «اضف نسبة توافق مع كل ابلتي»: Mayhem picks Q, W or E for a chosen-ability card on every offer. With the key he reads
 *  on the card, its fit drops by up to ABILITY_STEP below the champion's best key for that card (ABILITY_FIT from his ability sheet). */
export const ABILITY_STEP = 20;
export type AbilityKey3 = 'Q' | 'W' | 'E';
export const isChosenAbility = (id: number) => CHOSEN_ABILITY[String(id)] !== undefined;
export function abilityShift(champion: number | undefined, id: number, key: AbilityKey3 | undefined): number {
  const kind = CHOSEN_ABILITY[String(id)], w = champion === undefined ? undefined : ABILITY_FIT[String(champion)]?.[kind ?? 'd'];
  if (!kind || !key || !w) return 0;
  const best = Math.max(...w);
  return best > 0 ? ABILITY_STEP * (w[['Q', 'W', 'E'].indexOf(key)] / best - 1) : 0;
}
export interface AbilityPick { champion?: number; keys: Partial<Record<number, AbilityKey3>> }

/** Owner 2026-11-27 (Shyvana's AP build offered Blunt Force at 61): once his cards point to a build, a card of the other damage kind
 *  (only AD styles on an AP build, only AP styles on an AD build) loses KIND_STEP. Build kind: 3+ items of one kind and at most 1 of the
 *  other (ITEM_KIND from the game item text); card kind from its style tags. */
export const KIND_STEP = 8; // 980 creator rounds: 8 keeps 64.5%, 15 gives 64.3%, 25 gives 64.2%
const cardKind = (id: number) => { const st = stylesOf(id); return st.includes('ap') && !st.includes('ad') ? 'ap' : st.includes('ad') && !st.includes('ap') ? 'ad' : null; };
export function buildKind(items: string[]): 'ap' | 'ad' | null {
  const k = items.map((n) => ITEM_KIND[n]); const ap = k.filter((x) => x === 'ap' || x === 'both').length, ad = k.filter((x) => x === 'ad' || x === 'both').length;
  return ap >= 3 && ad <= 1 ? 'ap' : ad >= 3 && ap <= 1 ? 'ad' : null;
}

export function fitOffer(tree: CompactTree, offered: number[], held: number[] = [], enemy?: EnemyCounts, ability?: AbilityPick): TreeFit[] {
  const kindNow = held.length ? buildKind(buildLine(tree, held)?.items ?? []) : null;
  const linesOf = (id: number) => tree.a[id]?.[2] ?? [];
  const have = critHeld(tree, held);
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
    const heldStyles = new Set(held.flatMap(stylesOf));
    const lost = Math.min(critOf(id), Math.max(0, have + critOf(id) - 100));
    const shared = stylesOf(id).filter((st) => heldStyles.has(st) && !(st === 'crit' && lost > 0)).slice(0, 3);
    const foes = enemy ? ENEMY_RULES.filter((r) => (enemy[r.feat] ?? 0) >= 3 && r.ids.has(id)) : [];
    const cap = (CRIT_CAP_STEP * lost) / 25;
    const key = ability?.keys[id], shift = abilityShift(ability?.champion, id, key);
    const ck = cardKind(id), wrongKind = !!kindNow && !!ck && ck !== kindNow;
    return { id, base, fit: base + line + off + after + ENEMY_STEP * foes.length + STAT_STEP * shared.length - cap + shift - (wrongKind ? KIND_STEP : 0), pct: 0, why: row?.[1], because: [...rules.map((r) => r[3]), ...foes.map((r) => r.why), ...(shared.length ? [`يجمع ${shared.map((st) => STAT_AR[st] ?? st).join(' و')} مع ما عندك.`] : []), ...(lost ? [`الضربة الحرجة تصل إلى 100% بما عندك: يضيع ${lost}% من هذا التعزيز.`] : []), ...(key && shift < 0 ? [`على ${key}: أقل من أنسب مهارة لبطلك.`] : []), ...(wrongKind ? [`بلدك ${kindNow === 'ap' ? 'AP' : 'AD'}: هذا التعزيز يعطي ${ck === 'ap' ? 'AP' : 'AD'} لا يفيده.`] : [])], lines: mine.map((l) => tree.lines[l]?.[0]).filter((n): n is string => !!n) };
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
export const fitPercent = (tree: CompactTree, id: number, held: number[] = [], enemy?: EnemyCounts, ability?: AbilityPick) => Math.max(0, Math.min(100, Math.round(fitOffer(tree, [id], held, enemy, ability)[0].fit)));

/** The card's 0-100 fit on each of Q, W and E, for a chosen-ability card. */
export const abilityFits = (tree: CompactTree, champion: number | undefined, id: number, held: number[] = [], enemy?: EnemyCounts) =>
  (['Q', 'W', 'E'] as const).map((key) => ({ key, pct: fitPercent(tree, id, held, enemy, { champion, keys: { [id]: key } }) }));

/** The line whose items the build page shows (owner 2026-11-27: the tree's build first): the line his picks point to, else the tree's first
 *  line, which the writers put first as the champion's main line. */
export const buildLine = (tree: CompactTree, held: number[]) => heldLine(tree, held) ?? (tree.lines[0] ? { name: tree.lines[0][0], why: tree.lines[0][1], items: tree.lines[0][2] } : undefined);

/** The line the held cards point to most (ties: the earlier line), with its items; undefined before any held card serves a line. */
/** Weight of the tree's own line membership in the line choice, in nats per held card (knowledge/two-keys/line-follow.mjs part 4). */
export const LINE_LOGIC = 0; // owner 2026-11-27: Brand burns with everything (Wooglet's adds burn) and Jinx builds crit always, as the data says; logic weight off

export function heldLine(tree: CompactTree, held: number[]): { name: string; why: string; items: string[] } | undefined {
  // Owner 2026-11-27 «نعم، طبّقه»: with the data table, Bayes over the lines: the champion's prior (all rows summed) counted once, plus
  // how far each held card moves the share of each line. On held-out games: players' items matched 45.7% (old count 43.2%), and the shown
  // line leaves his most common line 58.8% of the time (summing raw shares gave 48.0% but stayed on the common line 93% of the time).
  const L = tree.lines.length, rows = held.map((h) => tree.lt?.[String(h)]).filter((r): r is number[] => !!r && r.length === L);
  if (rows.length) {
    const prior = new Array<number>(L).fill(0); for (const r of Object.values(tree.lt ?? {})) if (r.length === L) r.forEach((x, i) => (prior[i] += x));
    const ptot = prior.reduce((a, b) => a + b, 0), lp = (i: number) => Math.log((prior[i] + 1) / (ptot + L));
    // Logic counts too (owner: Jinx builds crit always, with Hexoptics when she plays range): LINE_LOGIC nats per held card the tree writes
    // into the line. Held-out cost 0.4 points of item match (45.3%), and the line follows the cards more often (64.5%).
    const logic = (i: number) => LINE_LOGIC * held.filter((h) => (tree.a[h]?.[2] ?? []).includes(i)).length;
    const score = tree.lines.map((_, i) => lp(i) + logic(i) + rows.reduce((s, r) => s + Math.log((r[i] + 1) / (r.reduce((a, b) => a + b, 0) + L)) - lp(i), 0));
    const l = tree.lines[score.indexOf(Math.max(...score))];
    return { name: l[0], why: l[1], items: l[2] };
  }
  const count = new Map<number, number>();
  for (const h of held) for (const l of tree.a[h]?.[2] ?? []) count.set(l, (count.get(l) ?? 0) + 1);
  const best = [...count].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
  const l = best && tree.lines[best[0]];
  return l ? { name: l[0], why: l[1], items: l[2] } : undefined;
}

/** Owner 2026-11-27 «1، بلد بديل»: a second build under the shown one, the best-scored line that really differs from it (shares at most 3 of
 *  its non-boot items). Scores: the data table's Bayes with his cards (the champion's prior alone before any card), else the tree's order. */
export function altLine(tree: CompactTree, held: number[]): { name: string; why: string; items: string[] } | undefined {
  const shown = buildLine(tree, held); if (!shown) return undefined;
  const L = tree.lines.length, rows = held.map((h) => tree.lt?.[String(h)]).filter((r): r is number[] => !!r && r.length === L);
  const prior = new Array<number>(L).fill(0); for (const r of Object.values(tree.lt ?? {})) if (r.length === L) r.forEach((x, i) => (prior[i] += x));
  const ptot = prior.reduce((a, b) => a + b, 0), lp = (i: number) => (ptot ? Math.log((prior[i] + 1) / (ptot + L)) : -i);
  const score = tree.lines.map((_, i) => lp(i) + rows.reduce((s, r) => s + Math.log((r[i] + 1) / (r.reduce((a, b) => a + b, 0) + L)) - lp(i), 0));
  const core = (items: string[]) => items.filter((n) => !BOOTS.test(n));
  const mine = new Set(core(shown.items));
  const pick = tree.lines.map((l, i) => ({ l, s: score[i] })).filter(({ l }) => l[0] !== shown.name && core(l[2]).filter((n) => mine.has(n)).length <= 3).sort((x, y) => y.s - x.s)[0];
  return pick ? { name: pick.l[0], why: pick.l[1], items: pick.l[2] } : undefined;
}

/** Owner 2026-11-27 «اكمل»: the tree line's items answer the enemy team with one swap per need, from the end of the list (boots and the
 *  first items stay): anti-heal against 2+ healers, penetration against 3+ tanks, magic resist against 3+ magic damage dealers. The item
 *  for each need follows his own damage (magic, physical, or a frontline tank) and whether the line already crits. */
const BOOTS = /Boots|Greaves|Treads|Steelcaps|Shoes|Swiftness|Lucidity|Symbiotic|Synchronized|Gunmetal|Crimson|Spellslinger|Armored Advance|Chainlaced|Forever Forward/;
export interface ItemSwap { out: string; in: string; why: string }
/** Items that share one unique passive: only one of each group can be held (owner 2026-11-27: Lord Dominik's and Mortal Reminder together). */
// Owner, same day: «وكثير ايمات نفس الشي من عائله واحدة»; Hydras stay allowed together when a held card's quest asks for them.
// The groups come from the game item file's unique limits (ITEM_GROUPS, made by bundle-trees.mjs).
const UNIQUE_GROUPS = ITEM_GROUPS;
let questItems = new Set<string>(); // set by adaptItems: a held card's quest lifts its group's limit (Ultra Hydra needs all three Hydras)
// An item in two groups (Archangel's, Terminus) conflicts with both: its group is their union.
const groupOf = (item: string) => { const gs = UNIQUE_GROUPS.filter((g) => g.includes(item) && !g.some((x) => questItems.has(x))); return gs.length ? [...new Set(gs.flat())] : undefined; };
const FILLERS: Record<string, string[]> = { magic: ["Zhonya's Hourglass", "Banshee's Veil", "Rabadon's Deathcap", 'Void Staff', 'Shadowflame', "Liandry's Torment"], physical: ['Guardian Angel', "Death's Dance", 'Black Cleaver', 'Spear of Shojin', 'Spirit Visage'], tank: ["Thornmail", "Force of Nature", "Randuin's Omen", "Spirit Visage", "Kaenic Rookern", "Jak'Sho, The Protean"] };
/** Items a held card asks for (owner 2026-11-27 «نعم، أضفه»): its needs_item and quest tags (src/ai/augmentTags.ts); any one of a card's
 *  items answers it. held: each held card's ids (twins) and name. */
// A quest (Wooglet's: Rabadon's and Zhonya's; Ultra Hydra: all three Hydras) needs every item: all is true and each missing one goes in.
export function neededItems(held: { ids: number[]; name: string }[]): { card: string; items: string[]; all?: boolean }[] {
  return held.flatMap((h) => {
    const tags = h.ids.flatMap((id) => AUGMENT_TAGS[id]?.tags ?? []);
    const quest = [...new Set(tags.flatMap((t) => (t.startsWith('quest:') ? t.slice(6).split('|') : [])))];
    if (quest.length) return [{ card: h.name, items: quest, all: true }];
    const items = [...new Set(tags.flatMap((t) => (t.startsWith('needs_item:') ? [t.slice(11)] : [])))];
    return items.length ? [{ card: h.name, items }] : [];
  });
}

export function adaptItems(items: string[], me: { damage: string; frontline: boolean }, enemy?: EnemyCounts, need: { card: string; items: string[]; all?: boolean }[] = []): { items: string[]; swaps: ItemSwap[] } {
  const out = [...items], swaps: ItemSwap[] = [];
  questItems = new Set(need.flatMap((n) => (n.all ? n.items : [])));
  let slot = out.length - 1;
  // A held card's own item comes first: it is the card's point (an upgrade, a quest).
  const pinned = new Set(need.flatMap((n) => n.items));
  for (const n of need) {
    const add = n.all ? n.items.filter((i) => !out.includes(i)) : n.items.some((i) => out.includes(i)) ? [] : [n.items[0]];
    for (const item of add) {
      while (slot >= 1 && (BOOTS.test(out[slot]) || pinned.has(out[slot]))) slot--;
      if (slot < 1) break;
      swaps.push({ out: out[slot], in: item, why: `تعزيز ${n.card} يحتاج ${n.items.join(n.all ? ' و' : ' أو ')}.` });
      out[slot] = item;
      slot--;
    }
  }
  if (!enemy) return uniqueOnly(out, swaps, me);
  const magic = me.damage === 'magic', crit = items.some((i) => (ITEM_CRIT[i] ?? 0) > 0);
  const needs: [boolean, string, string][] = [
    [(enemy.healers ?? 0) >= 2, magic ? 'Morellonomicon' : me.frontline ? 'Thornmail' : crit ? 'Mortal Reminder' : 'Chempunk Chainsword', 'في فريق الخصم معالجون: غرض يقطع العلاج.'],
    [enemy.tanks >= 3, magic ? 'Void Staff' : me.frontline ? 'Black Cleaver' : crit ? "Lord Dominik's Regards" : "Serylda's Grudge", 'أمامك 3 مدرّعين أو أكثر: غرض اختراق.'],
    [(enemy.magic ?? 0) >= 3, me.frontline ? 'Force of Nature' : magic ? "Banshee's Veil" : 'Maw of Malmortius', '3 من الخصوم أو أكثر ضررهم سحري: غرض مقاومة سحر.'],
  ];
  for (const [need, item, why] of needs) {
    if (!need || out.includes(item)) continue;
    while (slot >= 2 && (BOOTS.test(out[slot]) || swaps.some((s) => s.in === out[slot]))) slot--;
    if (slot < 2) break;
    swaps.push({ out: out[slot], in: item, why });
    out[slot] = item;
    slot--;
  }
  return uniqueOnly(out, swaps, me);
}

/** Keeps one item of each unique group: a swapped-in item replaces its group's earlier item in place; a second item of a group already in
 *  the line becomes a filler of his damage kind not yet held. */
function uniqueOnly(items: string[], swaps: ItemSwap[], me: { damage: string; frontline: boolean }): { items: string[]; swaps: ItemSwap[] } {
  const out = [...items];
  for (const s of swaps) { const g = groupOf(s.in); if (!g) continue; const i = out.findIndex((x, k) => g.includes(x) && x !== s.in && k !== out.indexOf(s.in)); if (i >= 0 && i < out.indexOf(s.in)) { out[out.indexOf(s.in)] = s.out; out[i] = s.in; s.out = items[i]; } }
  const fill = FILLERS[me.frontline ? 'tank' : me.damage === 'magic' ? 'magic' : 'physical'];
  out.forEach((x, k) => {
    const g = groupOf(x); if (!g) return;
    if (out.findIndex((y) => g.includes(y)) === k) return;
    const f = fill.find((c) => !out.includes(c) && !out.some((y) => groupOf(c)?.includes(y))); if (!f) return;
    swaps.push({ out: x, in: f, why: `${x} لا يُجمع مع ${out.find((y) => g.includes(y))}: ميزة واحدة لا تتكرر.` });
    out[k] = f;
  });
  return { items: out, swaps };
}
