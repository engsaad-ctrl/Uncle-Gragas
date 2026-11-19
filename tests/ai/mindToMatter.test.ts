import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T121: Mind to Matter (1056) adds 50% of his total modeled maximum mana as health, from the 16.22 file (ManaToHealthCalc: one
// AbilityResourceByCoefficientCalculationPart, coefficient 0.5). Its ConvertCap=99999 is not modeled; the row says so. These tests use the generated card.
const fixture = JSON.parse(readFileSync('tests/fixtures/game/mind-to-matter-16.22.json', 'utf8'));
const spell = fixture.records['Maps/ModeSpecificData/Augments/ARAM_MindtoMatter/Augment_ARAM_MindtoMatter'].mSpell;
const mtm = CARD_NUMBERS.find((c) => c.id === 1056)!;

const num = (baseValue: number) => ({ baseValue });
const rec = (resource?: { arType: number; base: number; perLevel: number }, spells: string[] = []) => ({
  __type: 'CharacterRecord', spells,
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(500), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  ...(resource ? { primaryAbilityResource: { arType: resource.arType, '{726ee5cd}': num(resource.base), '{6216bf7b}': num(resource.perLevel) } } : {}),
});
const MANA_ITEM = 7777;
const shop = { [MANA_ITEM]: { DataValues: [{ name: 'FlatMPPoolMod', values: [600] }] } } as never;
const kit = { damage: 'physical' as const, attacks: true };
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const run = (o: { record: ReturnType<typeof rec>; cards?: CardNumbers[]; items?: number[]; level?: number; mana?: number; extraBin?: Record<string, unknown> }) =>
  fight({ bin: { rec: o.record, ...o.extraBin }, shop, kit, items: o.items ?? [], cards: o.cards ?? [], level: o.level ?? 1, ...(o.mana === undefined ? {} : { mana: o.mana }) });
const gain = (o: Parameters<typeof run>[0]) => run({ ...o, cards: [...(o.cards ?? []), mtm] }).stats.hp - run(o).stats.hp;
const MANA = (base: number, perLevel = 0) => rec({ arType: 0, base, perLevel });

describe('Mind to Matter (T121)', () => {
  it('is the 16.22 file\'s linear conversion, partial, with the cap limitation said', () => {
    expect(fixture.version).toBe('16.22.8348910+branch.releases-16-22.content.release');
    const part = spell.mSpellCalculations.ManaToHealthCalc.mFormulaParts;
    expect(part).toEqual([{ mCoefficient: 0.5, __type: 'AbilityResourceByCoefficientCalculationPart' }]);
    expect(mtm.ops).toEqual([{ op: 'convert', from: 'mana', to: 'hp', ratio: part[0].mCoefficient }]);
    expect(mtm.status).toBe('partial');
    expect(mtm.not_modelled).toContain('ConvertCap=99999');
    expect(spell.DataValues.find((d: { name: string }) => d.name === 'ConvertCap').values[0]).toBe(99999);
    // Only the Mayhem id carries these numbers; no name-based row reaches the Arena twin (56).
    expect(CARD_NUMBERS.filter((c) => c.name === 'Mind to Matter').map((c) => c.id)).toEqual([1056]);
  });

  it('adds half of his total maximum mana as health', () => {
    expect(gain({ record: MANA(1000) })).toBeCloseTo(500, 9);
    expect(gain({ record: MANA(1000), items: [MANA_ITEM] })).toBeCloseTo(800, 9);
    expect(gain({ record: MANA(1000, 20), level: 9 })).toBeCloseTo(580, 9);
  });

  it('gives nothing to a manaless or energy champion, even holding a mana item', () => {
    expect(gain({ record: rec(undefined), items: [MANA_ITEM] })).toBe(0);
    expect(gain({ record: rec({ arType: 1, base: 200, perLevel: 0 }), items: [MANA_ITEM] })).toBe(0);
  });

  it('reads maximum mana, not the mana he starts the fight with', () => {
    expect(gain({ record: MANA(1000), mana: 0 })).toBeCloseTo(500, 9);
    expect(gain({ record: MANA(1000), mana: 1000 })).toBeCloseTo(500, 9);
  });

  // 100 mana, one ability at 40 with a 2 s cooldown and no regeneration: the card must not change what he can cast, in this fight or the next.
  const casterBin = { 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [2, 2, 2, 2, 2, 2], mana: [40, 40, 40, 40, 40] } } };
  const caster = rec({ arType: 0, base: 100, perLevel: 0 }, ['x/q']);
  it('spends no mana and makes no resource pool', () => {
    const plain = run({ record: caster, extraBin: casterBin }), held = run({ record: caster, extraBin: casterBin, cards: [mtm] });
    expect(held.casts).toEqual(plain.casts);
    expect(held.again!().casts).toEqual(plain.again!().casts);
  });

  it('counts the same health again in a later fight, never adding it twice', () => {
    const plain = run({ record: caster, extraBin: casterBin }), held = run({ record: caster, extraBin: casterBin, cards: [mtm] });
    expect(held.stats.hp - plain.stats.hp).toBeCloseTo(50, 9);
    expect(held.again!().stats.hp - plain.again!().stats.hp).toBeCloseTo(50, 9);
    expect(held.again!().stats.hp).toBeCloseTo(held.stats.hp, 9);
  });

  it('feeds health multipliers and health-based damage, whatever the card order', () => {
    const tank = card('Tank', [{ op: 'mult', stat: 'hp', factor: 1.1 }]);
    const withTank = run({ record: MANA(1000), cards: [tank] });
    const both = run({ record: MANA(1000), cards: [mtm, tank] }), reversed = run({ record: MANA(1000), cards: [tank, mtm] });
    expect(both.stats.hp - withTank.stats.hp).toBeCloseTo(550, 9);
    expect(reversed.stats.hp).toBeCloseTo(both.stats.hp, 9);
    const hpHit = card('Health hit', [{ op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { hp: 0.01 }, type: 'physical' }]);
    const hitPlain = run({ record: MANA(1000), cards: [hpHit] }), hitHeld = run({ record: MANA(1000), cards: [hpHit, mtm] });
    expect(hitHeld.attacks).toBe(hitPlain.attacks);
    expect(hitHeld.fromCards).toBeGreaterThan(hitPlain.fromCards);
  });

  it('removing the card gives back the fight without it', () => {
    const plain = run({ record: MANA(1000) }), again = run({ record: MANA(1000), cards: [] });
    expect(again.stats).toEqual(plain.stats);
    expect(run({ record: MANA(1000), cards: [mtm] }).stats.hp).not.toBe(plain.stats.hp);
  });
});
