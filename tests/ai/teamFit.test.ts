import { describe, expect, it } from 'vitest';
import { CHAMPION_KITS } from '../../src/ai/championKits.js';
import { BALANCE_POINTS, balancePoints, damageBalance, fillsGaps, teamGaps } from '../../src/ai/teamFit.js';

const find = (test: (k: (typeof CHAMPION_KITS)[number]) => boolean) => CHAMPION_KITS.filter(test).map((k) => k.id);
const physicalBacks = find((k) => k.damage === 'physical' && !k.traits.includes('frontline'));
const magicBacks = find((k) => k.damage === 'magic' && !k.traits.includes('frontline'));
const magicFront = find((k) => k.damage === 'magic' && k.traits.includes('frontline'));
const physicalFront = find((k) => k.damage === 'physical' && k.traits.includes('frontline'));

describe('teamGaps', () => {
  it('says nothing with fewer than two allies', () => {
    expect(teamGaps([])).toEqual({ frontline: false });
    expect(teamGaps([physicalBacks[0]!])).toEqual({ frontline: false });
  });
  it('sees a missing frontline and a missing kind of damage', () => {
    expect(teamGaps(physicalBacks.slice(0, 3))).toEqual({ frontline: true, damage: 'magic' });
    expect(teamGaps(magicBacks.slice(0, 2))).toEqual({ frontline: true, damage: 'physical' });
  });
  it('finds nothing missing on a mixed team with a frontline', () => {
    expect(teamGaps([physicalFront[0]!, magicBacks[0]!])).toEqual({ frontline: false });
  });
  it('ignores a champion with no kit', () => {
    expect(teamGaps([999999, physicalBacks[0]!])).toEqual({ frontline: false });
  });
});

describe('fillsGaps', () => {
  const gaps = { frontline: true, damage: 'magic' as const };
  it('counts each gap the champion fills', () => {
    expect(fillsGaps(magicFront[0]!, gaps)).toBe(2);
    expect(fillsGaps(magicBacks[0]!, gaps)).toBe(1);
    expect(fillsGaps(physicalFront[0]!, gaps)).toBe(1);
    expect(fillsGaps(physicalBacks[0]!, gaps)).toBe(0);
  });
  it('fills nothing when nothing is missing or the kit is unknown', () => {
    expect(fillsGaps(magicFront[0]!, { frontline: false })).toBe(0);
    expect(fillsGaps(999999, gaps)).toBe(0);
  });
});

describe('damage balance', () => {
  it('is the smaller side of magic against physical damage', () => {
    expect(damageBalance(physicalBacks.slice(0, 5))).toBe(0);
    expect(damageBalance([...physicalBacks.slice(0, 3), ...magicBacks.slice(0, 2)])).toBe(2);
  });
  it('ranks the choice that balances an all-physical team above another physical one, by the measured points', () => {
    const allies = physicalBacks.slice(0, 4);
    const p = balancePoints([magicBacks[0]!, physicalBacks[4]!], allies);
    expect(p.get(magicBacks[0]!)! - p.get(physicalBacks[4]!)!).toBeCloseTo(BALANCE_POINTS);
  });
  it('moves nothing with fewer than two allies known', () => {
    expect(balancePoints([magicBacks[0]!, physicalBacks[0]!], [physicalBacks[1]!]).size).toBe(0);
  });
});
