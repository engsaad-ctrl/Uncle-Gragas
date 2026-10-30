// What augments and items do, as data read once from their texts (src/ai/mechanicsData.ts), and the links between them:
// one produces a stat another turns into something. These are the pairs too rare in our games to prove by numbers:
// Steel Your Heart stacks health, Riftmaker turns bonus health into AP; Phenomenal Evil stacks AP without limit, Big
// Brain's shield grows with AP.

export interface Mechanic {
  id: number;
  name: string;
  /** Stats it grants; unbounded = keeps growing all game (permanent stacks). */
  gives: { stat: string; unbounded: boolean }[];
  /** Stats one of its effects grows with. */
  scales: { stat: string; effect: string }[];
  converts: { from: string; to: string }[];
  /** What the player must do for it to matter: attacks, abilities, healing ... */
  relies: string[];
  /** Items it is built around (a quest for Heartsteel, "Upgrade Hubris"). */
  needs: (number | string)[];
  /** One English line with its numbers. */
  note: string;
}

export interface Link {
  /** The producer and the consumer. */
  from: number;
  to: number;
  stat: string;
  /** feeds: a granted stat another scales with or converts; chain: a converted stat fed on; needs: built around it. */
  kind: 'feeds' | 'chain' | 'needs';
  strength: number;
}

// A stat feeds its narrower forms: health gained is bonus health; resists are armor and magic resist.
const FEEDS: Record<string, string[]> = { health: ['bonus_health'], ad: ['bonus_ad'], resists: ['armor', 'mr'] };
const fed = (stat: string) => [stat, ...(FEEDS[stat] ?? [])];
// Base stats every item of a kind has (an AD item, an AP mage augment) link everything to everything: only a stat that
// grows without limit, or a conversion, says something particular.
const usesOf = (m: Mechanic) => new Set([...m.scales.map((s) => s.stat), ...m.converts.map((c) => c.from)]);

/** Every link from a to b (a produces, b uses), strongest first. */
export function linksBetween(a: Mechanic, b: Mechanic): Link[] {
  if (a.id === b.id) return [];
  const out: Link[] = [];
  const uses = usesOf(b);
  for (const g of a.gives) {
    if (!g.unbounded) continue;
    for (const stat of fed(g.stat)) if (uses.has(stat)) out.push({ from: a.id, to: b.id, stat, kind: 'feeds', strength: 2 });
  }
  for (const c of a.converts) for (const stat of fed(c.to)) if (uses.has(stat)) out.push({ from: a.id, to: b.id, stat, kind: 'chain', strength: 1.5 });
  if (a.needs.includes(b.id)) out.push({ from: a.id, to: b.id, stat: '', kind: 'needs', strength: 3 });
  return out.sort((x, y) => y.strength - x.strength);
}

/** Links either way between any of the chosen and a candidate; the candidate's score is their summed strength. */
export function linksWith(chosen: Mechanic[], candidate: Mechanic): Link[] {
  return chosen.flatMap((c) => [...linksBetween(c, candidate), ...linksBetween(candidate, c)]);
}

/** A champion's kit, read once from its ability texts (src/ai/championKits.ts). */
export interface ChampionKit {
  id: number;
  name: string;
  damage: 'magic' | 'physical' | 'mixed';
  /** What its damage and effects grow with: ap, ad, health, attack_speed ... */
  scales: string[];
  /** What the kit is built on, in the same words as an augment's relies: attacks, abilities, healing ... */
  relies: string[];
  traits: string[];
  note: string;
}

const ATTACK_BASED = new Set(['attacks', 'on_hit', 'crit']);
const AP_SIDE = new Set(['ap']);
const AD_SIDE = new Set(['ad', 'bonus_ad', 'crit', 'attack_speed', 'lethality', 'armor_pen']);

/**
 * How well an augment suits a champion's kit, as a small signed score: +1 for each thing the augment relies on that the
 * kit is built on, +1 when the augment grants, scales with or converts a stat the kit grows with; -1 when it relies on
 * basic attacks the kit does not use, and -1 when it pulls toward the other damage side (AP for an AD kit or AD for an
 * AP one). The reasons come back for display.
 */
export function championFit(kit: ChampionKit, aug: Mechanic): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  for (const r of aug.relies) {
    if (kit.relies.includes(r)) (score += 1), reasons.push(`+${r}`);
    else if (ATTACK_BASED.has(r) && !kit.relies.includes('attacks')) (score -= 1), reasons.push(`-${r}`);
  }
  const stats = new Set([...aug.gives.map((g) => g.stat), ...aug.scales.map((s) => s.stat), ...aug.converts.map((c) => c.from)]);
  const shared = kit.scales.filter((s) => stats.has(s));
  if (shared.length) (score += 1), reasons.push(`+${shared.join('/')}`);
  const apKit = kit.scales.some((s) => AP_SIDE.has(s)) && !kit.scales.some((s) => AD_SIDE.has(s));
  const adKit = kit.scales.some((s) => AD_SIDE.has(s)) && !kit.scales.some((s) => AP_SIDE.has(s));
  const augAp = [...stats].some((s) => AP_SIDE.has(s)) && ![...stats].some((s) => AD_SIDE.has(s));
  const augAd = [...stats].some((s) => AD_SIDE.has(s)) && ![...stats].some((s) => AP_SIDE.has(s));
  if ((apKit && augAd) || (adKit && augAp)) (score -= 1), reasons.push('-damage side');
  return { score, reasons };
}

/** A link as one English line for the model: who produces what, and who uses it. */
export function explainLink(l: Link, name: (id: number) => string): string {
  if (l.kind === 'needs') return `${name(l.from)} is built around ${name(l.to)}`;
  const how = l.kind === 'feeds' ? `grows ${l.stat} without limit` : `turns another stat into ${l.stat}`;
  return `${name(l.from)} ${how}; ${name(l.to)} uses ${l.stat}`;
}
