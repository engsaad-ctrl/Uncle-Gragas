// What a team lacks, from its champions' kits: a frontline and a second kind of damage.
// The damage balance moves the ranking: on 17,694 Mayhem games (2026-11-06, tests/zz-teamfit), judged on the newest 5,309, team fit beat
// champion strength alone (log loss gain 0.0015, 95% 0.0006 to 0.0024, placebo 95th 0.0003), and a unit of balance was worth
// 1.7 win-chance points (0.3 to 3.6). A frontline leans the same way (+1.7, -0.8 to 3.7) but isn't proven: a note only.

import { CHAMPION_KITS } from './championKits.js';

export interface TeamGaps {
  frontline: boolean;
  /** The kind of damage nobody brings. */
  damage?: 'magic' | 'physical';
}

const kitOf = (id: number) => CHAMPION_KITS.find((k) => k.id === id);

/** With fewer than two allies known, nothing can be said yet. */
export function teamGaps(allies: number[]): TeamGaps {
  const kits = allies.flatMap((id) => kitOf(id) ?? []);
  if (kits.length < 2) return { frontline: false };
  const brings = (d: 'magic' | 'physical') => kits.some((k) => k.damage === d || k.damage === 'mixed');
  return {
    frontline: !kits.some((k) => k.traits.includes('frontline')),
    ...(!brings('magic') ? { damage: 'magic' as const } : !brings('physical') ? { damage: 'physical' as const } : {}),
  };
}

/** How many of the gaps this champion fills. */
export function fillsGaps(id: number, gaps: TeamGaps): number {
  const k = kitOf(id);
  if (!k) return 0;
  return (gaps.frontline && k.traits.includes('frontline') ? 1 : 0) + (gaps.damage && (k.damage === gaps.damage || k.damage === 'mixed') ? 1 : 0);
}

/** Win-chance points a unit of damage balance is worth (see the top of the file). */
export const BALANCE_POINTS = 1.7;
const magicOf = (id: number) => { const d = kitOf(id)?.damage; return d === 'magic' ? 1 : d === 'mixed' ? 0.5 : d === 'physical' ? 0 : undefined; };
/** How evenly a team of five splits magic and physical damage: the smaller side, 0 to 2.5; mixed kits count half; unknown kits count half. */
export const damageBalance = (team: number[]) => { const m = team.reduce((s, id) => s + (magicOf(id) ?? 0.5), 0); return Math.min(m, team.length - m); };
/** Points each choice adds to the team by its damage balance, against the mean of the choices; nothing with fewer than two allies known. */
export function balancePoints(choices: number[], allies: number[]): Map<number, number> {
  if (allies.filter((id) => kitOf(id)).length < 2) return new Map();
  const b = choices.map((id) => damageBalance([...allies, id]));
  const mean = b.reduce((s, x) => s + x, 0) / (b.length || 1);
  return new Map(choices.map((id, i) => [id, BALANCE_POINTS * (b[i]! - mean)]));
}
