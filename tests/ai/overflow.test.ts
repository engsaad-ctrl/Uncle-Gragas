import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T122b: Overflow (1311) ability damage takes one bonus, 0.01 x (10 + 0.005 x maximum mana) (16.22 ManaCalc), added: 1.10 + 0.00005 x mana,
// not 1.10 x (1 + 0.00005 x mana). Generated card.
const fixture = JSON.parse(readFileSync('tests/fixtures/game/overflow-16.22.json', 'utf8'));
const manaCalc = fixture.records['Maps/ModeSpecificData/Augments/ARAM_Overflow/Augment_ARAM_Overflow'].mSpell.mSpellCalculations.ManaCalc;
const overflow = CARD_NUMBERS.find((c) => c.id === 1311)!;

const num = (baseValue: number) => ({ baseValue });
const rec = (mana?: number) => ({
  __type: 'CharacterRecord', spells: ['q'],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(550), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  ...(mana === undefined ? {} : { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(mana), '{6216bf7b}': num(0) } }),
});
// No mana cost: the cast schedule is the same with and without the card, so the damage ratio is the amplifier.
const q = (cost?: number) => ({ mSpell: { cooldownTime: [3, 3], ...(cost === undefined ? {} : { mana: [cost, cost] }), mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } } } });
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const run = (o: { mana?: number; cards?: CardNumbers[]; start?: number; cost?: number }) =>
  fight({ bin: { rec: rec(o.mana), q: q(o.cost) }, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: o.cards ?? [], level: 1, ...(o.start === undefined ? {} : { mana: o.start }) });
const ratio = (o: Parameters<typeof run>[0], extra: CardNumbers[] = []) => run({ ...o, cards: [...extra, overflow] }).fromAbilities / run({ ...o, cards: extra }).fromAbilities;

describe('Overflow (T122b)', () => {
  it('is the file\'s one bonus: 10% plus 0.5% per 100 maximum mana', () => {
    expect(manaCalc.mFormulaParts.map((p: { __type: string }) => p.__type)).toEqual(['NamedDataValueCalculationPart', 'AbilityResourceByCoefficientCalculationPart']);
    expect(manaCalc.mMultiplier.mNumber).toBeCloseTo(0.01, 9);
    expect(overflow.ops[0]).toEqual({ op: 'mana_amp', scope: 'abilities', base: 0.1, per100: 0.005 });
    expect(overflow.ops.some((x) => x.op === 'damage_amp')).toBe(false);
    expect(overflow.status).toBe('partial');
  });

  it('multiplies ability damage by 1.15 at 1,000 mana and 1.20 at 2,000', () => {
    expect(ratio({ mana: 1000 })).toBeCloseTo(1.15, 9);
    expect(ratio({ mana: 2000 })).toBeCloseTo(1.2, 9);
  });

  it('reads maximum mana, not the mana he starts with', () => {
    expect(ratio({ mana: 1000, start: 0 })).toBeCloseTo(1.15, 9);
  });

  it('keeps the flat 10% for a manaless champion (control)', () => {
    expect(ratio({})).toBeCloseTo(1.1, 9);
  });

  it('still doubles mana costs (control)', () => {
    // 300 mana paced over three fights, Q at 40 every 3 s, no regeneration: two casts at cost 40, one at the doubled 80.
    expect([run({ mana: 300, cost: 40 }).casts.Q, run({ mana: 300, cost: 40, cards: [overflow] }).casts.Q]).toEqual([2, 1]);
  });

  it('stacks with an independent ability amplifier by multiplying', () => {
    expect(ratio({ mana: 1000 }, [card('Amp', [{ op: 'damage_amp', scope: 'abilities', factor: 1.2 }])])).toBeCloseTo(1.15, 9);
    expect(run({ mana: 1000, cards: [card('Amp', [{ op: 'damage_amp', scope: 'abilities', factor: 1.2 }]), overflow] }).fromAbilities / run({ mana: 1000 }).fromAbilities).toBeCloseTo(1.15 * 1.2, 9);
  });

  it('removing the card gives back the fight without it', () => {
    expect(run({ mana: 1000, cards: [] }).fromAbilities).toBe(run({ mana: 1000 }).fromAbilities);
  });
});
