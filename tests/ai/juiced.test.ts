import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T122a: Juiced (2016) on-hit magic damage is 7% of maximum mana, x0.8 for ranged champions (16.22 Calc_Damage mRangedMultiplier). Generated card.
const fixture = JSON.parse(readFileSync('tests/fixtures/game/juiced-16.22.json', 'utf8'));
const calc = fixture.records['Maps/ModeSpecificData/Augments/ARAM_Juiced/Augment_ARAM_Juiced'].mSpell.mSpellCalculations.Calc_Damage;
const juiced = CARD_NUMBERS.find((c) => c.id === 2016)!;

const num = (baseValue: number) => ({ baseValue });
const rec = (range: number, resource?: { arType: number; base: number }, spells: string[] = []) => ({
  __type: 'CharacterRecord', spells,
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(range), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  ...(resource ? { primaryAbilityResource: { arType: resource.arType, '{726ee5cd}': num(resource.base), '{6216bf7b}': num(0) } } : {}),
});
const MANA_ITEM = 7777;
const shop = { [MANA_ITEM]: { DataValues: [{ name: 'FlatMPPoolMod', values: [600] }] } } as never;
const enemy = { armor: 0, mr: 0, physicalShare: 0.5 };
const run = (o: { record: ReturnType<typeof rec>; cards?: CardNumbers[]; items?: number[]; mana?: number; extraBin?: Record<string, unknown>; attacks?: boolean }) =>
  fight({ bin: { rec: o.record, ...o.extraBin }, shop, kit: { damage: 'physical', attacks: o.attacks ?? true }, items: o.items ?? [], cards: o.cards ?? [], level: 1, enemy, ...(o.mana === undefined ? {} : { mana: o.mana }) });
const perHit = (o: Parameters<typeof run>[0]) => { const r = run({ ...o, cards: [juiced] }); return r.fromCards / r.attacks; };
const MELEE = 125, RANGED = 550;

describe('Juiced (T122a)', () => {
  it('is the file\'s 7% of maximum mana, x0.8 ranged, partial with its omissions said', () => {
    expect(calc.mFormulaParts[0].DataValue).toBe('ManaPercentDamagePercent');
    expect(calc.mRangedMultiplier.mNumber).toBeCloseTo(0.8, 6);
    expect(juiced.ops.map((x) => [(x as { damage: { mana: number } }).damage.mana, (x as { needs?: string }).needs])).toEqual([[0.07, 'melee'], [0.056, 'ranged']]);
    expect(juiced.status).toBe('partial');
    expect(juiced.not_modelled).toMatch(/critical strike/);
  });

  it('deals 70 a melee on-hit at 1,000 maximum mana and no resist, from maximum mana, not the mana he starts with (control)', () => {
    expect(perHit({ record: rec(MELEE, { arType: 0, base: 1000 }) })).toBeCloseTo(70, 6);
    expect(perHit({ record: rec(MELEE, { arType: 0, base: 1000 }), mana: 0 })).toBeCloseTo(70, 6);
  });

  it('deals 56 a ranged on-hit at 1,000 maximum mana, and counts item mana', () => {
    expect(perHit({ record: rec(RANGED, { arType: 0, base: 1000 }) })).toBeCloseTo(56, 6);
    expect(perHit({ record: rec(RANGED, { arType: 0, base: 1000 }), items: [MANA_ITEM] })).toBeCloseTo(1600 * 0.056, 6);
  });

  it('gives no mana damage to a manaless or energy champion', () => {
    for (const record of [rec(RANGED), rec(RANGED, { arType: 1, base: 200 })]) expect(run({ record, cards: [juiced] }).fromCards).toBe(0);
  });

  it('an ability that applies on-hit uses the ranged coefficient too', () => {
    const spell = { mSpell: { cooldownTime: [30, 30], mApplyAttackEffect: true, mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } } } };
    const r = run({ record: rec(RANGED, { arType: 0, base: 1000 }, ['q']), extraBin: { q: spell }, cards: [juiced], attacks: false });
    expect(r.fromCards).toBeGreaterThan(0);
    expect(r.fromCards % 56).toBeCloseTo(0, 6);
  });

  it('removing the card gives back the fight without it', () => {
    const plain = run({ record: rec(RANGED, { arType: 0, base: 1000 }) });
    expect(run({ record: rec(RANGED, { arType: 0, base: 1000 }), cards: [] }).damage).toBe(plain.damage);
    expect(run({ record: rec(RANGED, { arType: 0, base: 1000 }), cards: [juiced] }).damage).toBeGreaterThan(plain.damage);
  });
});
