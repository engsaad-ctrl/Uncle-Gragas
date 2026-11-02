// What a team lacks, from its champions' kits. Only the two gaps that stood out in our games: a frontline and a second kind of damage.
// On 1,276 games each was worth about 4 to 5 win-chance points a unit, but on 1,915 newer games they didn't improve prediction
// (log loss +0.00007, 95% range -0.00373 to +0.00429), so this is a note for the player and never moves the ranking.

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
