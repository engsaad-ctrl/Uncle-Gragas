import { describe, expect, it } from 'vitest';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T146 (Codex T140 A list): Forged By The Master (2127), kiwi 16.23 Calc_Damage_Amp 0.45: the damage his items and augments deal themselves
// rises 45%; his champion's own (passive, abilities, attacks) does not. Codex oracle: item 100 + augment 100 + passive 100 + spell 100 -> 145+145+100+100.
const hit = (flat: number): CardOp => ({ op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { flat }, type: 'true' });
const ITEM = 9999;
const spell = { __type: 'SpellObject', mSpell: { cooldownTime: [4, 4, 4, 4, 4], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
const bin = { rec: { __type: 'CharacterRecord', spells: ['x/q', '', '', ''], attackRangeM: 550 }, 'x/q': spell };
const forged = CARD_NUMBERS.find((c) => c.id === 2127)!;
const augmentHit: CardNumbers = { id: 0, name: 'Test augment hit', status: 'computed', ops: [hit(100)] };
const run = (cards: CardNumbers[]) => fight({ bin, shop: { [ITEM]: { DataValues: [] } } as never, itemOps: { [ITEM]: [hit(100)] }, passive: [hit(100)], kit: { damage: 'magic', attacks: true }, items: [ITEM], cards, level: 11, enemy: { armor: 0, mr: 0, physicalShare: 0.5 } });

describe('Forged By The Master (2127)', () => {
  it('has the generated row', () => {
    expect(forged.ops).toEqual([{ op: 'damage_amp', scope: 'items_and_augments', factor: 1.45 }] as CardOp[]);
  });
  it('raises the item and augment hits by 45% and leaves his passive hit, his ability and his attacks as they were', () => {
    const base = run([augmentHit]), with_ = run([augmentHit, forged]);
    expect(with_.attacks).toBe(base.attacks);
    expect(with_.fromCards / with_.attacks).toBeCloseTo(145 + 145 + 100, 6);
    expect(base.fromCards / base.attacks).toBeCloseTo(300, 6);
    expect(with_.fromAbilities).toBe(base.fromAbilities);
    expect(with_.fromAttacks).toBe(base.fromAttacks);
  });
  it('raises an augment burn and a delayed augment hit once, and never a passive burn', () => {
    const burn: CardOp = { op: 'dot', per_second: { flat: 10 }, duration: 3, type: 'true', trigger: 'on_hit', stacks_max: 1 };
    const later: CardOp = { op: 'delayed_dot', trigger: 'on_hit', cooldown: 4, delay: 1, duration: 2, ticksPerSecond: 2, damage: { flat: 40 }, type: 'true' };
    const only = (cards: CardNumbers[], passive: CardOp[]) => fight({ bin, shop: {}, passive, kit: { damage: 'magic', attacks: true }, items: [], cards, level: 11, enemy: { armor: 0, mr: 0, physicalShare: 0.5 } }).fromCards;
    for (const op of [burn, later]) {
      const card: CardNumbers = { id: 0, name: 'Test', status: 'computed', ops: [op] };
      expect(only([card, forged], [])).toBeGreaterThan(0);
      expect(only([card, forged], []) / only([card], [])).toBeCloseTo(1.45, 6); // once: no second 1.45 on the same damage
      expect(only([forged], [op])).toBeCloseTo(only([], [op]), 6); // his passive's own burn stays
    }
  });
  // Codex T147: the other paths an item or augment deals damage by, and the champion's own damage that must stay.
  const num = (baseValue: number) => ({ baseValue });
  const caster = (mana?: number) => ({ ...bin, rec: { ...bin.rec, baseDamageModifiable: num(100), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), ...(mana ? { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(mana), '{6216bf7b}': num(0) } } : {}) } });
  const go = (o: { cards?: CardNumbers[]; passive?: CardOp[]; itemOps?: Record<number, CardOp[]>; shop?: never; attacks?: boolean; mana?: number; kit?: 'magic' | 'physical' }) =>
    fight({ bin: caster(o.mana), shop: o.shop ?? ({ [ITEM]: { DataValues: [] } } as never), ...(o.itemOps ? { itemOps: o.itemOps } : {}), passive: o.passive ?? [], kit: { damage: o.kit ?? 'magic', attacks: o.attacks ?? true }, items: [ITEM], cards: o.cards ?? [], level: 11, enemy: { armor: 0, mr: 0, physicalShare: 0.5 } });
  const card = (ops: CardOp[]): CardNumbers => ({ id: 0, name: 'Test', status: 'computed', ops });
  const circle = CARD_NUMBERS.find((c) => c.id === 1015)!;
  const heal: CardOp = { op: 'heal', amount: { flat: 100 }, trigger: 'attack', internal_cooldown: 100 };
  it("Circle of Death: 100 healing gives 70 damage, 101.5 with Forged; the heal itself is unchanged, from an augment's heal or his own", () => {
    for (const from of [{ cards: [card([heal])] }, { passive: [heal] }]) {
      const without = go({ ...from, cards: [...(from.cards ?? []), circle] }), with_ = go({ ...from, cards: [...(from.cards ?? []), circle, forged] });
      expect(without.fromCards).toBeCloseTo(70, 6);
      expect(with_.fromCards).toBeCloseTo(101.5, 6);
      expect(with_.healedHp).toBeCloseTo(without.healedHp, 6);
    }
  });
  it("Runaan's bolts x1.45, the main attack unchanged", () => {
    const bolts: CardOp = { op: 'bolts', ranged: 2, melee: 1, ad: 0.6 };
    const b = 1 * FIGHT.boltHitShare * 0.6; // the test record reads as melee (no attackRangeModifiable): one bolt
    const main = go({ kit: 'physical' }).fromAttacks;
    expect(main).toBeGreaterThan(0);
    expect(go({ kit: 'physical', itemOps: { [ITEM]: [bolts] } }).fromAttacks).toBeCloseTo(main * (1 + b), 6);
    expect(go({ kit: 'physical', itemOps: { [ITEM]: [bolts] }, cards: [forged] }).fromAttacks).toBeCloseTo(main * (1 + 1.45 * b), 6);
  });
  it('BEES on-hit share: item and augment child hits and the delayed payload x1.45 once; a passive child hit stays', () => {
    const bees: CardOp = { op: 'delayed_dot', trigger: 'ability_hit', cooldown: 4, delay: 0.5, duration: 1, ticksPerSecond: 2, damage: { flat: 40 }, type: 'true', onHitEfficacy: 0.5 };
    const onHit = hit(100);
    const gearOnly = (extra: CardNumbers[]) => go({ attacks: false, cards: [card([bees]), ...extra], itemOps: { [ITEM]: [onHit] } }).fromCards;
    expect(gearOnly([forged]) / gearOnly([])).toBeCloseTo(1.45, 6);
    // Codex T148: an augment's own on-hit set off by the share, too.
    const augChild = (extra: CardNumbers[]) => go({ attacks: false, cards: [card([bees]), card([onHit]), ...extra] }).fromCards;
    expect(augChild([forged]) / augChild([])).toBeCloseTo(1.45, 6);
    const payload = go({ attacks: false, cards: [card([bees])] }).fromCards;
    const withPassive = (extra: CardNumbers[]) => go({ attacks: false, cards: [card([bees]), ...extra], passive: [onHit] }).fromCards;
    expect(payload).toBeGreaterThan(0);
    expect(withPassive([forged]) - withPassive([])).toBeCloseTo(0.45 * payload, 6);
  });
  it("an item's file proc (a share of mana on hit) x1.45", () => {
    const shop = { [ITEM]: { DataValues: [{ name: 'OnHitManaRatioTOOLTIPONLY', values: [0.01] }] } } as never;
    const without = go({ kit: 'physical', shop, mana: 1000 }).fromCards, with_ = go({ kit: 'physical', shop, mana: 1000, cards: [forged] }).fromCards;
    expect(without).toBeGreaterThan(0);
    expect(with_ / without).toBeCloseTo(1.45, 6);
  });
  it('his ability damage stays: four Q casts of 100 in 15 s, the same with Forged', () => {
    const base = go({ attacks: false });
    expect(base.casts.Q).toBe(4);
    expect(base.fromAbilities).toBeCloseTo(400, 6);
    expect(go({ attacks: false, cards: [forged] }).fromAbilities).toBe(base.fromAbilities);
  });
});

