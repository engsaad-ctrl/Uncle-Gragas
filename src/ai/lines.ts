// Lines: groups of augments and items that build on each other, which a player walks step by step. Parts come from what players said
// and the game's numbers imply (knowledge/network.jsonl), kept to links said good twice or more, or verified by src/ai/setCalc.ts.
// Coherence here is a count, not a win chance: how many of the parts already held share a line with a card.

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

/** The lines with held parts, most held first, with the core parts still missing. */
export function openLines(held: number[], damage?: ChampionDamage) {
  return LINES.filter((l) => open(l, damage))
    .map((line) => ({ line, held: partsOf(line).filter((id) => held.includes(id)), missing: line.core.filter((id) => !held.includes(id)) }))
    .filter((x) => x.held.length)
    .sort((a, b) => b.held.length - a.held.length);
}
