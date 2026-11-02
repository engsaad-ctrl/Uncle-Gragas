// Lines: groups of augments and items that build on each other, which a player walks step by step. Parts come from what players said
// and the game's numbers imply (knowledge/network.jsonl), kept to links said good twice or more, or verified by src/ai/setCalc.ts.
// Coherence here is a count, not a win chance: how many of the parts already held share a line with a card.

import { linksWith, type Mechanic } from './mechanics.js';
import { AUGMENT_MECHANICS, ITEM_MECHANICS } from './mechanicsData.js';

export type ChampionDamage = 'ap' | 'ad' | 'mixed';

export interface Line {
  id: string;
  name: string;
  /** What the line is built on: Tank Engine and Heartsteel's stacks multiply, by screen tests on 12 games (knowledge/state-windows.jsonl). */
  core: number[];
  /** What adds to it. */
  branches: number[];
  /** When it fails, shown to the player. */
  breaks: string[];
  /** Champions it can work on; every champion when absent. */
  damage?: ChampionDamage[];
}

/** An item as a line part. Items are negative since some ids are both: 3036 is Double Time and Lord Dominik's. */
export const itemPart = (id: number) => -id;
const it = itemPart;

export const LINES: Line[] = [
  {
    id: 'health',
    name: 'خط الصحة',
    core: [1353, 1152, it(3084), it(3083)], // Tank Engine, Steel Your Heart, Heartsteel, Warmog's
    branches: [1181, 1041, it(2501), it(2502), it(3748), it(4633)], // Heavy Hitter, Goliath, Overlord's Bloodmail, Unending Despair, Titanic Hydra, Riftmaker
    breaks: ['الموت يأخذ 65% من تكديسات Tank Engine', 'Steel Your Heart يحتاج Heartsteel بـ300 تكديسة', 'Heavy Hitter لا يعمل إلا بالهجمات'],
  },
  {
    id: 'ap',
    name: 'خط قوة السحر',
    core: [1390, it(3089), 1156, it(228002)], // Phenomenal Evil, Rabadon's, Wooglet's quest and its reward
    branches: [1030, 1129, 1048, 2132, 1180, 1097, it(3135), it(3157), it(2503)], // Eureka, Marksmage, Jeweled Gauntlet, Warlock Juicebox, Big Brain, Witchful Thinking, Void Staff, Zhonya's, Blackfire Torch
    breaks: ['Phenomenal Evil يحتاج إصابة الأبطال بالقدرات', 'كويست Wooglet يأخذ مكان Rabadon وZhonya', 'Marksmage يحتاج الهجمات'],
    damage: ['ap', 'mixed'],
  },
  {
    id: 'crit',
    name: 'خط الضربة الحرجة',
    core: [1048, 1356, 1092, it(3031)], // Jeweled Gauntlet, Critical Missile, Vulnerability, Infinity Edge
    branches: [1336, 1047, 1328, it(3036), it(6676)], // Upgrade Infinity Edge, It's Critical, Critical Rhythm, Lord Dominik's, The Collector
    breaks: ['دون نسبة ضربة حرجة كافية يضعف الخط كله', 'الضربات غير الحرجة لا تستفيد منه'],
  },
  {
    id: 'onhit',
    name: 'خط تأثيرات الهجوم',
    core: [2010, 1225, it(3124), it(3153)], // Double Tap, Dual Wield, Guinsoo's, Blade of the Ruined King
    branches: [1036, 1129, 1029, 1058, 2009, 1087, it(3085), it(3115), it(6672)], // Firebrand, Marksmage, Ethereal Weapon, Mystic Punch, Zealot, Typhoon, Runaan's, Nashor's, Kraken
    breaks: ['يحتاج هجوماً مستمراً على الأبطال، فالهجوم على الأبراج لا يكفي', 'Blade of the Ruined King يضعف إذا كان الخصوم قليلي الصحة'],
  },
  {
    id: 'casting',
    name: 'خط تكرار القدرات',
    core: [1030, it(6657), it(3003), it(3040)], // Eureka, Rod of Ages, Archangel's, Seraph's
    branches: [2072, 1113, 1311, 1103, 1133, it(6653), it(4645), it(2503)], // Spell Split, Skilled Sniper, Overflow, Bread And Butter, Magic Missile, Liandry's, Shadowflame, Blackfire Torch
    breaks: ['نفاد المانا يوقف الخط', 'تكديس Archangel وRod of Ages بطيء في البداية'],
  },
];

const partsOf = (l: Line) => [...l.core, ...l.branches];
const open = (l: Line, damage: ChampionDamage | undefined) => !l.damage || !damage || l.damage.includes(damage);

export interface CardFit {
  line: Line;
  /** Share of the held parts that lie on the line, 0 to 1; undefined with none held on any line, where it could start one. */
  share?: number;
}

/** The line a card fits best next to what's held; undefined when it's on no line, which means unknown rather than a bad fit. */
export function cardFit(held: number[], card: number | undefined, damage?: ChampionDamage): CardFit | undefined {
  if (card === undefined) return undefined;
  const known = held.filter((id) => id !== card && LINES.some((l) => partsOf(l).includes(id)));
  const options = LINES.filter((l) => open(l, damage) && partsOf(l).includes(card));
  if (!options.length) return undefined;
  const scored = options.map((line) => ({ line, on: known.filter((id) => partsOf(line).includes(id)).length }));
  const best = scored.reduce((a, b) => (b.on > a.on ? b : a));
  return known.length ? { line: best.line, share: best.on / known.length } : { line: best.line };
}

/**
 * Pairs that work against each other, kept apart from having no link. The first four rest on one player's test or reasoning in the video
 * notes (knowledge/network.jsonl) that the augment's text supports; none has been checked in the game. Back To Basics locks the ultimate by
 * its text, and of 955 stored players who held it, 1 bought Malignance (10.9% of others), 1 Axiom Arc (3.5%), and at most 1 took any of
 * these cards (0.5 to 4.0%; Surge Field has no data). `blocks`: the build leaves that item out while the augment is held. It didn't move
 * how well the build names 442 stored players' items; it stays since the text is certain.
 */
const ULT_ITEMS = [3118, 2512, 3073, 6696]; // Malignance, Fiendhunter Bolts, Experimental Hexplate, Axiom Arc
const ULT_CARDS = [3055, 1349, 1344, 1112, 1088, 1211, 2134, 1194, 1413, 1011, 3118]; // Ultimate Recursion, Ultimate Awakening, Final Form, Ultimate Unstoppable, Ultimate Revolution, It's Killing Time, Surge Field, Fey Magic, Stuck In Here With Me, Can't Touch This, Arcane Axiom
const LOCKED = 'Back To Basics يقفل القدرة الخارقة، فلا يعمل ما يعتمد عليها';

export const CONFLICTS: { a: number; b: number; unless?: number; why: string; blocks?: boolean }[] = [
  { a: 1048, b: it(6653), unless: 1092, why: 'حرق Liandry لا يكون حرجاً مع Jeweled Gauntlet إلا مع Vulnerability' },
  { a: 1103, b: 1058, why: 'Mystic Punch يعيد تبريد Q، فلا قيمة لتسارع Bread And Butter عليه' },
  { a: 1030, b: 1311, why: 'Overflow يفرغ المانا بسرعة مع كثرة القدرات التي يعطيها Eureka' },
  { a: 1092, b: it(2512), why: 'الضرر الإضافي من Fiendhunter Bolts لا يكون حرجاً مع Vulnerability' },
  ...ULT_ITEMS.map((id) => ({ a: 1004, b: it(id), why: LOCKED, blocks: true })),
  ...ULT_CARDS.map((id) => ({ a: 1004, b: id, why: LOCKED })),
];

/** Items the held augments make pointless. */
export const blockedItems = (augments: number[]): number[] => CONFLICTS.filter((c) => c.blocks && augments.includes(c.a)).map((c) => -c.b);

/**
 * Augments that need any one of a group, which `needs` can't say, since the build forces every id in it. Of 619 stored players with Upgrade
 * Immolate, 92.2% owned Sunfire Aegis or Hollow Radiance, none both. Upgrade Sheen stays out: forcing a Spellblade item named less of 481
 * stored builds (first item 49.3% to 47.0%), and those without one won no less.
 */
export const NEEDS_ONE_OF: Record<number, number[]> = { 1319: [3068, 6664] };

/** What in the path works against this card, in words. */
export function conflictsWith(path: number[], card: number | undefined): string[] {
  return CONFLICTS.filter((c) => (c.a === card && path.includes(c.b)) || (c.b === card && path.includes(c.a)))
    .filter((c) => c.unless === undefined || !path.includes(c.unless))
    .map((c) => c.why);
}

const mechanicOf = (part: number): Mechanic | undefined => (part < 0 ? ITEM_MECHANICS : AUGMENT_MECHANICS).find((m) => m.id === Math.abs(part));
const sameLine = (a: number, b: number) => LINES.some((l) => partsOf(l).includes(a) && partsOf(l).includes(b));

/**
 * The share of the player's path that a card works with: augments taken and items suggested, each joined to it by a line or by a text
 * link. Parts the tables don't know are left out. A card they do know with no link to the path gets 0, so it can't outrank one known to
 * conflict. Undefined at the start of the path, or for a card the tables don't know.
 */
export function pathShare(path: number[], card: number | undefined): number | undefined {
  if (card === undefined) return undefined;
  const mech = mechanicOf(card);
  const known = path.filter((p) => p !== card && mechanicOf(p));
  if (!mech || !known.length) return undefined;
  const clashes = (p: number) => conflictsWith([p, ...path.filter((x) => x !== p)], card).length > 0 && CONFLICTS.some((c) => (c.a === p && c.b === card) || (c.b === p && c.a === card));
  return known.filter((p) => !clashes(p) && (sameLine(p, card) || linksWith([mechanicOf(p)!], mech).length > 0)).length / known.length;
}

/**
 * Each augment's place among those given, 0 for the lowest and 1 for the highest; ties share a place. Places within a rarity
 * are what a round of cards compares, since cards in one offer share it.
 */
export function placesOf(points: Map<number, number>): Map<number, number> {
  const all = [...points.values()];
  return new Map([...points].map(([id, p]) => [id, all.length > 1 ? all.filter((x) => x < p).length / (all.length - 1) : 1]));
}

/** How much a card's percent leans on the path rather than on the champion. A first guess. */
export const HELD_WEIGHT = 0.5;

/**
 * A card's link percent: its place by how tied it is to this champion (augmentLink in src/stats/openStats.ts), and the share of the
 * player's path it works with (pathShare). Unknown without data. Winning plays no part: the owner asked for this over win rates.
 */
export const compatibility = (place: number | undefined, share: number | undefined): number | undefined =>
  place === undefined ? undefined : Math.round(100 * (share === undefined ? place : (1 - HELD_WEIGHT) * place + HELD_WEIGHT * share));

/**
 * What the player's augments ask of the build: each item on the fullest open lines and how much it adds, on the build's scale where
 * a core item is about 1. No champion filter, since the player chose: Phenomenal Evil on Nasus asks for AP items. The sizes are a first
 * guess, so this stays behind the trial switch: a core item counts in full from two held parts, a branch item half. Only an augment opens
 * a line: in the video pilot one bought Blackfire Torch put Archangel's Staff first on champions who rarely buy it.
 */
export function lineItems(held: number[]): Map<number, number> {
  const lines = openLines(held).filter((l) => l.held.some((part) => part > 0));
  const out = new Map<number, number>();
  for (const { line, held: on } of lines.filter((l) => l.held.length === lines[0]!.held.length)) {
    const size = Math.min(1, on.length / 2);
    for (const part of line.branches) if (part < 0) out.set(-part, Math.max(out.get(-part) ?? 0, 0.5 * size));
    for (const part of line.core) if (part < 0) out.set(-part, Math.max(out.get(-part) ?? 0, size));
  }
  return out;
}

/** The lines with held parts, most held first, with the core parts still missing. */
export function openLines(held: number[], damage?: ChampionDamage) {
  return LINES.filter((l) => open(l, damage))
    .map((line) => ({ line, held: partsOf(line).filter((id) => held.includes(id)), missing: line.core.filter((id) => !held.includes(id)) }))
    .filter((x) => x.held.length)
    .sort((a, b) => b.held.length - a.held.length);
}
