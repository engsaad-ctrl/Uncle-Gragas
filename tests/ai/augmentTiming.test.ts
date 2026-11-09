import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { augmentStage } from '../../src/ai/augmentProgress.js';

const num = (baseValue: number) => ({ baseValue });
const bin = { rec: {
  __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500),
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
} };
const base = { bin, shop: {}, items: [], kit: { damage: 'physical' as const, attacks: true } };
const growth = (acquiredLevel: number | undefined, per = 'every_ability_damage', cap?: number): CardNumbers => ({ id: 1, name: 'growth', status: 'conditional', acquiredLevel, ops: [{ op: 'per_stack', stat: 'ap', value: 1, mode: 'add', per, cap }] });
const ap = (level: number, card: CardNumbers) => fight({ ...base, level, cards: [card] }).stats.ap;

describe('a permanent augment starts accumulating when chosen', () => {
  it.each(['every_ability_damage', 'takedown', 'kill', 'ability_hit'])('does not grant historical %s stacks to a new card', (per) => {
    expect(ap(15, growth(15, per))).toBe(0);
    expect(ap(15, growth(3, per))).toBeGreaterThan(ap(15, growth(11, per)));
    expect(ap(15, growth(11, per))).toBeGreaterThan(0);
  });
  it('applies a stack cap after excluding events before acquisition', () => {
    expect(ap(8, growth(7, 'takedown', 10))).toBeCloseTo(2.2);
    expect(ap(18, growth(3, 'takedown', 10))).toBe(10);
  });
  it('leaves a flat on-pick grant intact', () => {
    const card = growth(15); card.ops.push({ op: 'add', stat: 'ap', value: 30 });
    expect(ap(15, card)).toBe(30);
  });
  it('does not reset the champion passive when a late augment is chosen', () => {
    const passive: CardOp[] = [{ op: 'per_stack', stat: 'ap', value: 1, mode: 'add', per: 'takedown' }];
    const before = fight({ ...base, level: 15, cards: [], passive }).stats.ap;
    expect(fight({ ...base, level: 15, cards: [growth(15)], passive }).stats.ap).toBe(before);
  });
  it('keeps the older model available to existing callers with unknown history', () => {
    expect(ap(15, growth(undefined, 'takedown'))).toBeCloseTo(15 * 2.2);
  });
  it('counts an unreadable earlier pick when deriving later acquisition levels', () => {
    const unknown = 9999, known = 1;
    const stage = augmentStage([unknown, known], { level: 11 });
    expect(stage.acquiredLevels[known]).toBe(7);
    expect(ap(11, growth(stage.acquiredLevels[known]))).toBeLessThan(ap(11, growth(3)));
  });
});
