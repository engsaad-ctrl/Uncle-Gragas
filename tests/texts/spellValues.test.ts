import { describe, expect, it } from 'vitest';
import spells from '../fixtures/augments/spells.json' with { type: 'json' };
import { binHash, resolveSpellValues, type SpellData } from '../../src/texts/spellValues.js';

const axiom = spells.ArcaneAxiom as SpellData;
const bigShot = spells.BigShot as SpellData;

describe('binHash', () => {
  it('is FNV-1a of the lowercased name, as in Riot bin files', () => {
    expect(binHash('Calc_Bonus_Crit_Damage')).toBe('{d130a2db}');
    expect(binHash('ConversionCritNum')).toBe('{18ca104b}');
  });
});

describe('resolveSpellValues (real augment spells)', () => {
  it('fills data values and level-scaled calculations', () => {
    const r = resolveSpellValues('خلال @ResetWindow@ث، تستعيد @UltimateRefund@ من فترة التبريد.', axiom);
    expect(r).toEqual({ text: 'خلال 3ث، تستعيد 15%–30% من فترة التبريد.', unresolved: 0 });
  });

  it('finds calculations stored under hashed names, honouring display-as-percent and precision', () => {
    const r = resolveSpellValues('<crit>@Calc_Bonus_Crit_Damage@ ضرر حرج</crit> و@Calc_Bonus_AD@ ضرر هجوم و@Calc_Crit_Conversion@', bigShot);
    expect(r.text).toBe('<crit>35% ضرر حرج</crit> و25% ضرر هجوم و@Calc_Crit_Conversion@');
    expect(r.unresolved).toBe(1);
  });

  it('applies "*N" multipliers written in the text', () => {
    expect(resolveSpellValues('@ResetWindow*100@', axiom).text).toBe('300');
  });

  it('drops lines that only show live in-game counters (@f1@ …)', () => {
    const r = resolveSpellValues('يمنح @ResetWindow@ث.<br><br>الضرر الإجمالي: @f1@<br>الإطاحات: @f2.0@', axiom);
    expect(r).toEqual({ text: 'يمنح 3ث.<br>', unresolved: 0 });
  });

  it('marks stat scaling it cannot name instead of guessing the stat', () => {
    const spell: SpellData = {
      DataValues: [{ name: 'Base', values: [0, 40, 40] }],
      mSpellCalculations: {
        Dmg: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'Base' }, { __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.5, mStat: 2 }] },
        OnlyStat: { mFormulaParts: [{ __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.3 }] },
      },
    };
    expect(resolveSpellValues('@Dmg@ و@OnlyStat@', spell)).toEqual({ text: '40 (+إحصاءات) و@OnlyStat@', unresolved: 1 });
  });

  it('handles sums, products, breakpoints and multipliers', () => {
    const spell: SpellData = {
      mSpellCalculations: {
        Sum: { mFormulaParts: [{ __type: 'SumOfSubPartsCalculationPart', mSubparts: [{ __type: 'NumberCalculationPart', mNumber: 10 }, { __type: 'NumberCalculationPart', mNumber: 5 }] }] },
        Prod: { mFormulaParts: [{ __type: 'ProductOfSubPartsCalculationPart', mPart1: { __type: 'NumberCalculationPart', mNumber: 3 }, mPart2: { __type: 'NumberCalculationPart', mNumber: 4 } }] },
        Steps: { mFormulaParts: [{ __type: 'ByCharLevelBreakpointsCalculationPart', mLevel1Value: 10, mBreakpoints: [{ mLevel: 6, mAdditionalBonusAtThisLevel: 5 }, { mLevel: 11, mBonusPerLevelAtAndAfter: 1 }] }] },
        Mult: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 2 }], mMultiplier: { __type: 'NumberCalculationPart', mNumber: 0.5 } },
      },
    };
    expect(resolveSpellValues('@Sum@ @Prod@ @Steps@ @Mult@', spell).text).toBe('15 12 10–23 1');
  });

  it('leaves text without placeholders untouched', () => {
    expect(resolveSpellValues('نص عادي', undefined)).toEqual({ text: 'نص عادي', unresolved: 0 });
  });
});
