import { describe, expect, it } from 'vitest';
import spells from '../fixtures/augments/spells.json' with { type: 'json' };
import { cleanText } from '../../src/texts/clean.js';
import { binHash, mostlyResolved, resolveSpellValues, type SpellData } from '../../src/texts/spellValues.js';

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

  it('names calibrated stat ratios and stacks; an unknown stat id is a bare "(+إحصاءات)", never a made-up ratio', () => {
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
      text: '40 <scaleAD><nowrap>(+50% %i:scaleAD% إضافي)</nowrap></scaleAD> و<scaleAP><nowrap>30% %i:scaleAP%</nowrap></scaleAP> و5 <nowrap>(+إحصاءات)</nowrap> و5 <nowrap>(+2 لكل تكديسة)</nowrap>',
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
      text: '70 / 120 / 170 / 220 / 270 <scaleAP><nowrap>(+60% %i:scaleAP%)</nowrap></scaleAP> | 140 / 240 / 340 / 440 / 540 <scaleAP><nowrap>(+120% %i:scaleAP%)</nowrap></scaleAP> | 2 | 1 / 2 / 3 / 4 / 5 | 4% <scaleAP><nowrap>(+1% لكل 100 %i:scaleAP%)</nowrap></scaleAP>',
      unresolved: 0,
    });
  });

  it('words melee/ranged splits as one short aside so the sentence still reads', () => {
    const spell: SpellData = {
      DataValues: [{ name: 'MeleeValue', values: [0.1] }, { name: 'RangedValue', values: [0.05] }, { name: 'Ms', values: [40] }],
      mSpellCalculations: {
        Split: { __type: '{e9a3c91d}', mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'Ms' }], mRangedMultiplier: { __type: 'NumberCalculationPart', mNumber: 0.5 } },
        M: { mFormulaParts: [{ __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.4, mStat: 2 }] },
        R: { mFormulaParts: [{ __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.2, mStat: 2 }] },
      },
    };
    expect(resolveSpellValues('@Split@ | @M~R@ | @MeleeValue~RangedValue%@', spell).text).toBe(
      '40 (20 للمدى البعيد) | <scaleAD><nowrap>40% %i:scaleAD%</nowrap></scaleAD> (20% للمدى البعيد) | 10% (5% للمدى البعيد)',
    );
  });

  it('reads the newer part types the game files only name by hash, and conditional defaults', () => {
    const spell: SpellData = {
      DataValues: [
        { name: 'Lv1', values: [0, 10, 20] }, { name: 'Per', values: [0, 1, 1] }, { name: 'Add', values: [0, 5, 5] },
        { name: 'Start', values: [0, 30, 40] }, { name: 'End', values: [0, 90, 100] },
      ],
      mSpellCalculations: {
        Bp: { mFormulaParts: [{ __type: '{4ce08984}', '{91d404a5}': 'Lv1', '{bbd778a2}': 'Per', '{9823b29a}': [{ level: 6, '{ae9b464d}': 'Add', __type: '{0333530c}' }] }] },
        Lerp: { mFormulaParts: [{ __type: '{ee18a47b}', StartDataValue: 'Start', EndDataValue: 'End' }] },
        Ref: { mFormulaParts: [{ __type: '{f3cbe7b2}', mSpellCalculationKey: 'Lerp' }] },
        Ext: { mFormulaParts: [{ __type: '{9e9e2e5c}', SourceObject: 'Characters/X/Spells/XE', DataValue: 'Bonus' }] },
        Formula: { mFormulaParts: [{ __type: 'ByCharLevelFormulaCalculationPart', values: [16, 26, 36, 46, 56, 66, 76, 86, 96, 106, 116, 126, 136, 146, 156, 166, 176, 186, 196] }] },
        Cond: { __type: 'GameCalculationConditional', mDefaultGameCalculation: 'Lerp' },
        Grow: { mFormulaParts: [{ __type: 'StatBySubPartCalculationPart', mStat: 2, mStatFormula: 2, mSubpart: { __type: 'ByCharLevelInterpolationCalculationPart', mStartValue: 0.05, mEndValue: 0.15 } }] },
      },
    };
    const other: SpellData = { DataValues: [{ name: 'Bonus', values: [0, 7, 8] }] };
    const r = resolveSpellValues('@Bp@ | @Lerp@ | @Ref@ | @Ext@ | @Formula@ | @Cond@ | @Grow@', spell, { ranks: 2, spellRef: (n) => (n === 'XE' ? other : undefined) });
    expect(r).toEqual({
      text: '10–42 | 30–100 | 30–100 | 7 / 8 | 26–196 | 30–100 | <scaleAD><nowrap>5%–15% %i:scaleAD% إضافي</nowrap></scaleAD>',
      unresolved: 0,
    });
  });

  it('finds loosely named melee/ranged pairs in item texts', () => {
    const spell: SpellData = {
      DataValues: [{ name: 'BonusASMelee', values: [50] }, { name: 'BonusASRanged', values: [25] }, { name: 'ShieldShred', values: [50] }, { name: 'ShieldShredRange', values: [35] }],
    };
    expect(resolveSpellValues('@BonusAS@% سرعة | @ShieldShredMeleeRangedSplit@%', spell).text).toBe('50% (25% للمدى البعيد) سرعة | 50% (35% للمدى البعيد)');
  });

  it('keeps a detailed text when at most half its values are match-only', () => {
    expect(mostlyResolved('@A@ @B@ @C@', { text: 'x', unresolved: 1 })).toBe(true);
    expect(mostlyResolved('@A@ @B@ @C@', { text: 'x', unresolved: 2 })).toBe(false);
    expect(mostlyResolved('@A@ @f1@', { text: 'x {{ Missing }}', unresolved: 0 })).toBe(false);
    expect(mostlyResolved('نص بلا أرقام', { text: 'نص بلا أرقام', unresolved: 0 })).toBe(true);
  });

  it('keeps a computed 0 as a number after cleanText (only CommunityDragon zeros mean "unknown")', () => {
    const spell: SpellData = { DataValues: [{ name: 'Bonus', values: [0, 0, 10, 20] }] };
    const r = resolveSpellValues('يكسب @Bonus@ سرعة', spell, { ranks: 3 });
    expect(cleanText(r.text)).toBe('يكسب 0 / 10 / 20 سرعة');
    expect(cleanText('يلحق 0 ضرر')).toContain('؟');
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

  it("matches Jhin's passive: a breakpoint's per-level bonus replaces the earlier one, crit/AS ratios per 1%", () => {
    // Real values from Jhin's bin (2026-10); the in-game tooltip reads 4–44% (+0.35% per 1% crit)(+0.3% per 1% bonus AS).
    const spell: SpellData = {
      mSpellCalculations: {
        TotalADPercent: {
          mDisplayAsPercent: true,
          mFormulaParts: [
            { __type: 'ByCharLevelBreakpointsCalculationPart', mLevel1Value: 0.04, mInitialBonusPerLevel: 0.01, mBreakpoints: [{ mLevel: 10, mBonusPerLevelAtAndAfter: 0.02 }, { mLevel: 12, mBonusPerLevelAtAndAfter: 0.04 }] },
            { __type: 'StatByCoefficientCalculationPart', mStat: 8, mCoefficient: 0.35 },
            { __type: 'StatByCoefficientCalculationPart', mStat: 4, mStatFormula: 2, mCoefficient: 0.3 },
          ],
        },
      },
    };
    const text = resolveSpellValues('@TotalADPercent@', spell).text;
    expect(text).toMatch(/^4%–44% /);
    expect(text).toContain('0.35% لكل 1% %i:scaleCrit%');
    expect(text).toContain('0.3% لكل 1% %i:scaleAS% إضافي');
  });

  it('reads "@Spell.X:Y@" written with a capital S, and cleanText never shows a raw placeholder', () => {
    const other: SpellData = { DataValues: [{ name: 'SlowAmount', values: [0.2, 0.3] }] };
    const r = resolveSpellValues('@Spell.GlacialStorm:SlowAmount*100@%', { DataValues: [] }, { ranks: 1, spellRef: (n) => (n.toLowerCase() === 'glacialstorm' ? other : undefined) });
    expect(r.text).not.toContain('@');
    expect(cleanText('ضرر @A~B@ و @X*-100@ و @spell.Q:Y@')).not.toContain('@');
  });

  it('leaves text without placeholders untouched', () => {
    expect(resolveSpellValues('نص عادي', undefined)).toEqual({ text: 'نص عادي', unresolved: 0 });
  });
});
