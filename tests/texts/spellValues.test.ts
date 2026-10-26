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

  it('names calibrated stat ratios and keeps a generic label for unknown stat ids', () => {
    const spell: SpellData = {
      DataValues: [{ name: 'Base', values: [0, 40, 40] }],
      mSpellCalculations: {
        Dmg: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'Base' }, { __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.5, mStat: 2, mStatFormula: 2 }] },
        OnlyStat: { mFormulaParts: [{ __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.3 }] },
        Odd: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 5 }, { __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.1, mStat: 15 }] },
        Stacks: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 5 }, { __type: 'BuffCounterByCoefficientCalculationPart', mCoefficient: 2 }] },
      },
    };
    expect(resolveSpellValues('@Dmg@ و@OnlyStat@ و@Odd@ و@Stacks@', spell)).toEqual({
      text: '40 <scaleAD>(+50% من ضرر الهجوم الإضافي)</scaleAD> و<scaleAP>30% من قوة القدرة</scaleAP> و5 (+10% من إحصاءات) و5 (+إحصاءات)',
      unresolved: 0,
    });
  });

  it('shows every ability rank, with per-rank ratios, cooldown-style lists and old effect slots', () => {
    const spell: SpellData = {
      DataValues: [
        { name: 'Base', values: [0, 70, 120, 170, 220, 270, 320] },
        { name: 'Ratio', values: [0, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6] },
        { name: 'Same', values: [2, 2, 2, 2, 2, 2, 2] },
      ],
      mEffectAmount: [{ value: [0, 1, 2, 3, 4, 5, 0] }],
      mSpellCalculations: {
        Dmg: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'Base' }, { __type: 'StatByNamedDataValueCalculationPart', mDataValue: 'Ratio' }] },
        Sweet: { __type: 'GameCalculationModified', mModifiedGameCalculation: 'Dmg', mMultiplier: { __type: 'NumberCalculationPart', mNumber: 2 } },
        Pct: { mDisplayAsPercent: true, mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 0.04 }, { __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.0001 }] },
      },
    };
    const r = resolveSpellValues('@Dmg@ | @Sweet@ | @Same@ | @Effect1Amount@ | @Pct@', spell, { ranks: 5 });
    expect(r).toEqual({
      text: '70/120/170/220/270 <scaleAP>(+60% من قوة القدرة)</scaleAP> | 140/240/340/440/540 <scaleAP>(+120% من قوة القدرة)</scaleAP> | 2 | 1/2/3/4/5 | 4% <scaleAP>(+1% لكل 100 قوة القدرة)</scaleAP>',
      unresolved: 0,
    });
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
