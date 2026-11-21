import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T198: Upgrade Collector (1320) raises The Collector's execute share by ExecutionInc 0.005 an execute, up to MaxCount 15 (game file),
// counted per kill since the card was taken (an upper bound). Without an executing item it does nothing.
const num = (baseValue: number) => ({ baseValue });
const rec = {
  __type: 'CharacterRecord', spells: [],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(500), attackSpeedModifiable: num(1), attackSpeedRatioModifiable: num(1), attackSpeedPerLevelModifiable: num(0),
};
const dv = (name: string, value: number) => ({ name, values: [value, value] });
const shop = {
  6676: { DataValues: [dv('FlatPhysicalDamageMod', 50), dv('ExecuteThreshold', 0.05)] }, // The Collector-like: executes below 5%
  1036: { DataValues: [dv('FlatPhysicalDamageMod', 50)] }, // same AD, no execute
} as never;
const card = CARD_NUMBERS.find((c) => c.id === 1320)!;
const run = (items: number[], level: number, with_?: Partial<CardNumbers>) =>
  fight({ bin: { rec }, shop, kit: { damage: 'physical', attacks: true }, items, cards: with_ ? [{ ...card, acquiredLevel: 8, ...with_ }] : [], level });

describe('Upgrade Collector (T198)', () => {
  it('has a row: +0.005 execute share a kill, capped at 15', () => {
    expect(card.ops).toEqual([{ op: 'per_stack', stat: 'execute_threshold', value: 0.005, mode: 'add', per: 'kill', cap: 15 }]);
  });

  it('adds to the execute damage with The Collector held', () => {
    const base = run([6676], 14), up = run([6676], 14, {});
    expect(up.damage).toBeGreaterThan(base.damage);
  });

  it('does nothing without an executing item', () => {
    expect(run([1036], 14, {}).damage).toBeCloseTo(run([1036], 14).damage, 6);
  });

  it('grows by the executes counted, and stops at the cap', () => {
    const base = run([6676], 14).damage;
    const capped = (cap: number) => run([6676], 14, { ops: [{ ...card.ops[0]!, cap } as CardNumbers['ops'][number]] }).damage - base;
    // 0.67 kills a level x 6 levels = 4 kills: cap 1 and 2 bind, so the gain doubles; cap 15 does not bind, 4 kills count
    expect(capped(2) / capped(1)).toBeCloseTo(2, 6);
    expect(capped(15) / capped(1)).toBeCloseTo(0.67 * 6, 6);
  });
});
