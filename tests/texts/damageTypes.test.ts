import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight } from '../../src/ai/cardMath.js';
import { damageTypesOf, withDamageTypes } from '../../src/texts/damageTypes.js';

// Pinned 16.22 Arabic tooltips (tests/fixtures/sim/16.22/tooltips.cut.json, URL and SHA256 in its manifest): the tags stay English.
const tips = JSON.parse(readFileSync('tests/fixtures/sim/16.22/tooltips.cut.json', 'utf8')) as Record<string, string>;

describe('damage types from tooltips', () => {
  it('reads each marked value and every span', () => {
    expect(damageTypesOf(tips['spell_ahriorbofdeception_tooltip']!)).toEqual({ byName: { totaldamage: ['magic', 'true'] }, all: ['magic', 'true'] });
    expect(damageTypesOf(tips['spell_nasusq_tooltip']!).byName.totaldamage).toEqual(['physical']);
    expect(damageTypesOf(tips['spell_nasuse_tooltip']!)).toEqual({ byName: { initialdamage: ['magic'], totaldotdamage: ['magic'] }, all: ['magic', 'magic'] });
    expect(damageTypesOf('<magicDamage>@X*100@% max Health</magicDamage>').byName).toEqual({ x: ['magic'] });
    expect(damageTypesOf('no damage here')).toEqual({ byName: {}, all: [] });
  });
  it('attaches them to the spells whose tooltip it has, and leaves the rest as they are', () => {
    const bin = { rec: { __type: 'CharacterRecord' }, q: { __type: 'SpellObject', mSpell: { mClientData: { mTooltipData: { mLocKeys: { keyTooltip: 'Spell_NasusQ_Tooltip' } } } } }, w: { __type: 'SpellObject', mSpell: {} } };
    const out = withDamageTypes(bin, tips);
    expect((out.q.mSpell as { __damageTypes?: unknown }).__damageTypes).toEqual({ byName: { totaldamage: ['physical'] }, all: ['physical'] });
    expect(out.w).toBe(bin.w);
    expect(out.rec).toBe(bin.rec);
  });
});

describe('the fight takes each hit by its own type', () => {
  const num = (baseValue: number) => ({ baseValue });
  const rec = { __type: 'CharacterRecord', spells: ['x/q'], baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackRangeModifiable: num(500), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) };
  const q = (tooltip?: string) => ({ __type: 'SpellObject', mSpell: { cooldownTime: [20, 20, 20, 20, 20, 20], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } }, ...(tooltip ? { mClientData: { mTooltipData: { mLocKeys: { keyTooltip: tooltip } } } } : {}) } });
  // One cast of 100 at level 1 against armor 80 (taken 100/180) and magic resist 60 (100/160), a magic kit that makes no attacks.
  const cast = (tooltip?: string) => fight({ bin: withDamageTypes({ rec, 'x/q': q(tooltip) }, { Spell_T_Tooltip: tooltip === 'Spell_T_Tooltip' ? 'deals <physicalDamage>@TotalDamage@</physicalDamage>' : 'x', Spell_M_Tooltip: 'out <magicDamage>@TotalDamage@</magicDamage> back <trueDamage>@TotalDamage@</trueDamage>' }), shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: [], level: 1 }).fromAbilities;
  it('uses the marked type over the kit type', () => {
    expect(cast()).toBeCloseTo(100 * 100 / 160); // no tooltip read: the kit's magic, as before
    expect(cast('Spell_T_Tooltip')).toBeCloseTo(100 * 100 / 180);
    expect(cast('Spell_M_Tooltip')).toBeCloseTo(100 * (100 / 160 + 1) / 2); // half magic, half true
  });
});
