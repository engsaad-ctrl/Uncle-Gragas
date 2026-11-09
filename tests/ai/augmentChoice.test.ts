import { describe, expect, it } from 'vitest';
import { compareAugmentPlan, kitWithCards, type AugmentPlan } from '../../src/ai/augmentChoice.js';
import { dominantOffer } from '../../src/app/offerComparison.js';
import type { GameItem } from '../../src/texts/gameData.js';
import type { CardNumbers } from '../../src/ai/cardMath.js';

const num = (baseValue: number) => ({ baseValue });
const bin = { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) } };
const item = (stat: string, n: number) => ({ DataValues: [{ name: stat, values: [n] }] }) as unknown as GameItem;
const shop = { 1: item('FlatPhysicalDamageMod', 100), 2: item('FlatMagicDamageMod', 300) };
const candidate: CardNumbers = { id: 90001, name: 'AP on-hit', status: 'computed', acquiredLevel: 3, ops: [{ op: 'proc', trigger: 'on_hit', damage: { ap: 1 }, type: 'magic' }] };
const base = { bin, shop, cards: [], items: [], level: 15, kit: { damage: 'physical' as const, attacks: true } };
const place = { share: 0.2, rise: 0, health0: 1000, enemyDps: 1000, absorbedWorth: 1 };

it('values the build an augment opens, rather than keeping the old items for both sides', () => {
  const fixed = compareAugmentPlan({ base, candidate, place, baselineItems: [1], items: [1] });
  const changed = compareAugmentPlan({ base, candidate, place, baselineItems: [1], items: [2] });
  expect(fixed.damage).toBe(0); // the AD item gives this AP effect nothing
  expect(changed.damage).toBeGreaterThan(0);
  expect(changed.value).toBeGreaterThan(fixed.value);
  expect(changed).toMatchObject({ level: 15, items: [2], baselineItems: [1] });
});
it('enables attacks for the same attack-trigger cards as the item search', () => {
  expect(kitWithCards({ damage: 'magic', attacks: false }, [candidate]).attacks).toBe(true);
  expect(kitWithCards({ damage: 'magic', attacks: false }, []).attacks).toBe(false);
});

describe('a strong final plan cannot hide a weaker current phase', () => {
  const plan = (value: number): AugmentPlan => ({ value, level: 15, items: [], baselineItems: [], damage: 0, health: 0, missing: [] });
  it('does not declare a winner when early and late advantages disagree', () => {
    expect(dominantOffer([{ id: 1, value: 0.2, certain: true, plan: plan(0.1) }, { id: 2, value: 0.1, certain: true, plan: plan(0.4) }])).toBeUndefined();
  });
  it('finds an offer that improves both stages over every alternative', () => {
    expect(dominantOffer([{ id: 1, value: 0.2, certain: true, plan: plan(0.4) }, { id: 2, value: 0.1, certain: true, plan: plan(0.3) }, { id: 3, value: 0.2, certain: true, plan: plan(0.1) }])).toBe(1);
  });
  it('does not recommend from missing calculations or exact ties', () => {
    expect(dominantOffer([{ id: 1, value: 0.2, certain: true, plan: plan(0.4) }, { id: 2, value: 0.1, certain: true }])).toBeUndefined();
    expect(dominantOffer([{ id: 1, value: 0.2, certain: true, plan: plan(0.4) }, { id: 2, value: 0.2, certain: true, plan: plan(0.4) }])).toBeUndefined();
  });
  it('does not turn an unmodelled effect or estimated condition into a losing alternative', () => {
    const winner = { id: 1, value: 0.2, certain: true, plan: plan(0.4) };
    const rival = { id: 2, value: 0.1, certain: true, plan: plan(0.3) };
    expect(dominantOffer([winner, { ...rival, certain: false }])).toBeUndefined();
    expect(dominantOffer([{ ...winner, certain: false }, rival])).toBeUndefined();
    expect(dominantOffer([winner, { ...rival, missing: 'Chosen ability is unknown' }])).toBeUndefined();
    expect(dominantOffer([winner, { ...rival, plan: { ...rival.plan, missing: ['Quest completion is unknown'] } }])).toBeUndefined();
  });
});
