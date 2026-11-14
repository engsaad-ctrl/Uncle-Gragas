import { describe, expect, it } from 'vitest';
import { FIGHT, fight, type CardOp } from '../../src/ai/cardMath.js';
import { ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

/**
 * Kraken Slayer's Bring It Down, by champion level. Oracle read by hand from the frozen snapshot
 * game/items-v6.json (sha256 e7643ae512b5f9df8dc85e7fb8a8476d898572c44ab87187aa6e2a024167e026):
 * mSpellCalculations.DamageAmount is a ByCharLevelBreakpointsCalculationPart with mLevel1Value 150
 * and one breakpoint { mLevel: 9, mBonusPerLevelAtAndAfter: 5 }. So the file declares a ramp with a
 * breakpoint, flat to level 8 and rising from level 9, not a straight line from level 1 to 18.
 *
 * This batch keeps the two assumptions the row already declares and changes neither: the mean
 * missing-health multiplier (1 + MaxAmpNumber 1.75) / 2 = 1.375, and a third of the third attack on
 * every attack (AttackCount 3). Only the level is at stake here.
 */
const damageAmount = (level: number) => 150 + 5 * Math.max(0, level - 8);
const proc = (level: number) => (damageAmount(level) * 1.375) / 3;

const num = (baseValue: number) => ({ baseValue });
/** A champion with no growth at all, so his attacks deal the same damage at every level and the proc is the only difference. */
const binAt = (range: number) => ({
  rec: {
    __type: 'CharacterRecord', spells: [],
    baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
    baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
    attackRangeModifiable: num(range), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  },
});
const kit = { damage: 'physical' as const, attacks: true };
/** No resists on the target, so a physical proc arrives whole and the damage difference is the proc itself. */
const enemy = { armor: 0, mr: 0, physicalShare: 1, hp: FIGHT.target.hp, healPerSecond: 0 };
const RANGED = 500, MELEE = 150;

/** The proc's damage per attack: the whole fight with the ops minus the same fight without them, over its attacks. */
const perAttack = (level: number, range: number, ops: CardOp[], id = 6672) => {
  const of = (itemOps: Record<number, CardOp[]>) =>
    fight({ bin: binAt(range), shop: { [id]: {} } as never, kit, items: [id], itemOps, cards: [], level, enemy });
  const without = of({ [id]: [] }), withOps = of({ [id]: ops });
  expect(withOps.attacks).toBe(without.attacks);
  expect(withOps.attacks).toBeGreaterThan(0);
  return (withOps.damage - without.damage) / withOps.attacks;
};

const kraken = () => ITEM_NUMBERS.find((i) => i.id === 6672)!;

describe("Kraken Slayer's damage follows the level ramp its own file declares", () => {
  it('has both of its rows, one for melee and one for ranged', () => {
    const ops = kraken().ops;
    expect(ops).toHaveLength(2);
    expect(ops.map((x) => String((x as { needs?: string }).needs)).sort()).toEqual(['melee', 'ranged']);
    // RangedDamageMultiplier is 1 in the Mayhem file, so both rows carry the same number.
    expect(JSON.stringify((ops[0] as { damage: unknown }).damage)).toBe(JSON.stringify((ops[1] as { damage: unknown }).damage));
  });

  // Level 1 and 8 are the flat part; 9 is the breakpoint; 15 and 18 are the rise. A straight line from 1 to 18
  // agrees at 1 and 18 and is wrong in between, so the middle levels are what this test is for.
  for (const level of [1, 8, 9, 15, 18]) {
    for (const [what, range] of [['ranged', RANGED], ['melee', MELEE]] as const) {
      it(`deals ${proc(level).toFixed(4)} a ${what} attack at level ${level}`, () => {
        expect(perAttack(level, range, kraken().ops)).toBeCloseTo(proc(level), 3);
      });
    }
  }

  it('is flat from level 1 to level 8 and rises by a third of 5 x 1.375 a level after it', () => {
    const at = (level: number) => perAttack(level, RANGED, kraken().ops);
    expect(at(8)).toBeCloseTo(at(1), 6);
    const step = (5 * 1.375) / 3;
    for (const level of [9, 10, 14, 15, 18]) expect(at(level) - at(level - 1)).toBeCloseTo(step, 6);
    expect(at(18) - at(8)).toBeCloseTo(10 * step, 6);
  });
});

describe('the three wrong readings this test has to catch', () => {
  const amount = (ops: CardOp[], level: number) => perAttack(level, RANGED, ops);
  const flat = (f: unknown): CardOp[] => [{ op: 'proc', trigger: 'attack', internal_cooldown: null, damage: { flat: f }, type: 'physical', needs: 'ranged' } as unknown as CardOp];

  it('catches a straight line from level 1 to 18', () => {
    const line = flat({ min: proc(1), max: proc(18) });
    expect(amount(line, 1)).toBeCloseTo(proc(1), 3); // a line agrees at the ends
    expect(amount(line, 18)).toBeCloseTo(proc(18), 3);
    expect(amount(line, 8)).not.toBeCloseTo(proc(8), 1); // and is wrong in between
    expect(amount(line, 15)).not.toBeCloseTo(proc(15), 1);
  });

  it('catches the breakpoint moved a level either way', () => {
    const step = (5 * 1.375) / 3;
    for (const from of [8, 10]) {
      const moved = flat({ level1: proc(1), per: step, from });
      const wrongAt = from === 8 ? 8 : 9;
      const got = amount(moved, wrongAt);
      expect(Number.isFinite(got)).toBe(true); // a real wrong number, not a NaN that passes by accident
      expect(got).not.toBeCloseTo(proc(wrongAt), 3);
      expect(amount(moved, 18)).toBeCloseTo(proc(18) + (from === 8 ? step : -step), 3); // off by exactly one level's step at the top
    }
  });

  it('catches a reading that only pins level 1', () => {
    const pinned = flat(proc(1)); // one number for every level
    expect(amount(pinned, 1)).toBeCloseTo(proc(1), 3);
    expect(amount(pinned, 15)).not.toBeCloseTo(proc(15), 1);
  });
});

describe('the older min/max rows are read exactly as before', () => {
  it('still reads a min/max pair as a straight line from level 1 to 18', () => {
    const line: CardOp[] = [{ op: 'proc', trigger: 'attack', internal_cooldown: null, damage: { flat: { min: 100, max: 270 } }, type: 'physical', needs: 'ranged' } as unknown as CardOp];
    expect(perAttack(1, RANGED, line)).toBeCloseTo(100, 6);
    expect(perAttack(18, RANGED, line)).toBeCloseTo(270, 6);
    expect(perAttack(15, RANGED, line)).toBeCloseTo(100 + (170 * 14) / 17, 6); // 240
  });

  it("leaves Bloodthirster's shield a min/max pair", () => {
    const bt = ITEM_NUMBERS.find((i) => i.id === 3072)!;
    const shield = bt.ops.find((x) => x.op === 'shield') as { amount: { flat: { min: number; max: number } } };
    expect(shield.amount.flat).toEqual({ min: 165, max: 315 });
  });
});
