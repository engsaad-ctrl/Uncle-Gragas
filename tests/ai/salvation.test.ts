import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T122c: Salvation (3039), the wave's damage only: 100-500 by level + 125% bonus AD + 75% AP magic damage, once, when his health falls below 50%
// (the existing estimate of when), for enemies within 600 (the attack-range proxy). The ally heal and knockback are left out. Generated card.
const fixture = JSON.parse(readFileSync('tests/fixtures/game/salvation-16.22.json', 'utf8'));
const spell = fixture.records['Maps/ModeSpecificData/Augments/Salvation/Augment_Salvation'].mSpell;
const salvation = CARD_NUMBERS.find((c) => c.id === 3039)!;

const num = (baseValue: number) => ({ baseValue });
const rec = (range = 550) => ({
  __type: 'CharacterRecord', spells: [],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(range), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
});
const AD_ITEM = 7001, AP_ITEM = 7002;
const shop = { [AD_ITEM]: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [40] }] }, [AP_ITEM]: { DataValues: [{ name: 'FlatMagicDamageMod', values: [100] }] } } as never;
const run = (o: { cards?: CardNumbers[]; items?: number[]; level?: number; mr?: number; range?: number; incomingDps?: number }) =>
  fight({ bin: { rec: rec(o.range) }, shop, kit: { damage: 'magic', attacks: false }, items: o.items ?? [], cards: o.cards ?? [], level: o.level ?? 1, enemy: { armor: 0, mr: o.mr ?? 0, physicalShare: 0.5 }, ...(o.incomingDps === undefined ? {} : { incomingDps: o.incomingDps }) });
const wave = (o: Parameters<typeof run>[0]) => run({ ...o, cards: [salvation] }).fromCards;

describe('Salvation (T122c)', () => {
  it('is the file\'s Damage calculation and 50% trigger, partial, its omissions said', () => {
    expect(spell.DataValues.find((d: { name: string }) => d.name === 'HealthPercentTrigger').values[0]).toBe(0.5);
    expect(spell.DataValues.find((d: { name: string }) => d.name === 'AuraCooldown').values[0]).toBe(90);
    const parts = spell.mSpellCalculations.Damage.mFormulaParts;
    expect([parts[0].mStartValue, parts[0].mEndValue, parts[1].mCoefficient, parts[2].mCoefficient]).toEqual([100, 500, 1.25, 0.75]);
    expect(salvation.ops).toHaveLength(1);
    expect(salvation.status).toBe('partial');
    expect(salvation.not_modelled).toMatch(/ally heal/);
  });

  it('deals 100 at level 1 and 500 at level 18, from bonus AD and AP but not base AD', () => {
    expect(wave({})).toBeCloseTo(100, 6);
    expect(wave({ level: 18 })).toBeCloseTo(500, 6);
    expect(wave({ items: [AD_ITEM] })).toBeCloseTo(100 + 1.25 * 40, 6);
    expect(wave({ items: [AP_ITEM] })).toBeCloseTo(100 + 0.75 * 100, 6);
  });

  it('is magic damage that magic resist reduces', () => {
    expect(wave({ mr: 100 })).toBeCloseTo(50, 6);
  });

  it('fires once, and only after his health is estimated to fall below 50%', () => {
    const r = run({ cards: [salvation] }), plain = run({});
    const extra = r.damageBySecond.map((d, i) => d - (plain.damageBySecond[i] ?? 0));
    const first = extra.findIndex((d) => d > 1e-9);
    expect(first).toBeGreaterThan(0);
    expect(extra.slice(first).every((d) => Math.abs(d - extra[first]!) < 1e-9)).toBe(true);
    expect(wave({ incomingDps: 10 })).toBe(0); // too little pressure: no fall below 50% inside the fight
  });

  it('follows the attack-range proxy: within 600 fires, beyond it does not', () => {
    expect(wave({ range: 600 })).toBeGreaterThan(0);
    expect(wave({ range: 650 })).toBe(0);
  });

  it('heals and shields nothing', () => {
    expect(run({ cards: [salvation] }).healedHp).toBe(run({}).healedHp);
    expect(run({ cards: [salvation] }).effectiveHp).toBe(run({}).effectiveHp);
  });

  it('removing the card gives back the fight without it', () => {
    expect(run({ cards: [] }).damage).toBe(run({}).damage);
  });
});
