import { describe, expect, it } from 'vitest';
import { compareBuilds } from '../../src/ai/calculator.js';
import type { GameItem } from '../../src/texts/gameData.js';

const mod = (baseValue: number) => ({ baseValue });
// Ahri's numbers from the 2026-10 game files, one spell: Q's 135 (rank 5) + 50% AP.
const bin = {
  'Characters/Ahri/CharacterRecords/Root': {
    __type: 'CharacterRecord',
    spells: ['Characters/Ahri/Spells/AhriQAbility/AhriQ'],
    baseHPModifiable: mod(590), hpPerLevelModifiable: mod(104),
    baseDamageModifiable: mod(53), damagePerLevelModifiable: mod(3),
    baseArmorModifiable: mod(21), armorPerLevelModifiable: mod(4.2),
    baseMR: mod(30), mrPerLevel: mod(1.3),
    attackSpeedModifiable: mod(0.668), attackSpeedRatioModifiable: mod(0.625), attackSpeedPerLevelModifiable: mod(2.2),
    baseMoveSpeedModifiable: mod(330), attackRangeModifiable: mod(550),
  },
  'Characters/Ahri/Spells/AhriQAbility/AhriQ': {
    __type: 'SpellObject',
    mSpell: {
      DataValues: [{ name: 'BaseDamage', values: [0, 55, 75, 95, 115, 135, 155] }],
      mSpellCalculations: {
        TotalDamage: { __type: 'GameCalculation', mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }, { __type: 'StatByCoefficientCalculationPart', mCoefficient: 0.5 }] },
        ManaRefund: { __type: 'GameCalculation', mFormulaParts: [{ __type: 'AbilityResourceByCoefficientCalculationPart', mCoefficient: 0.1 }] },
      },
    },
  },
};
const items: Record<number, GameItem> = {
  3089: { DataValues: [{ name: 'FlatMagicDamageMod', values: [130] }] },
  4645: { DataValues: [{ name: 'FlatMagicDamageMod', values: [110] }, { name: 'FlatMagicPenetrationMod', values: [20] }] },
};

describe('compareBuilds', () => {
  const target = { armor: 100, mr: 80, hp: 3000 };

  it('adds the items to the level-18 stats and fills the ability ratios', () => {
    const [bare, ap] = compareBuilds({ bin, items, builds: [[3089], [3089, 4645]], target });
    expect(bare.stats.hp).toBe(2358); // 590 + 104 × 17
    expect(bare.abilities[0]).toEqual({ key: 'Q', values: [{ name: 'TotalDamage', value: 200, partial: false }] }); // 135 + 50% × 130
    expect(ap.stats.ap).toBe(240);
    expect(ap.abilities[0].values[0].value).toBe(255); // 135 + 50% × 240
    expect(ap.magicTaken).toBe(0.625); // 100 / (100 + 80 − 20)
  });

  it('refuses unknown, repeated or too many items instead of changing the build', () => {
    expect(() => compareBuilds({ bin, items, builds: [[3089, 999]] })).toThrow(/unknown/);
    expect(() => compareBuilds({ bin, items, builds: [[3089, 3089]] })).toThrow(/different/);
    expect(() => compareBuilds({ bin, items, builds: [[]] })).toThrow();
  });

  it('applies effects read from the texts: an AP multiplier only with its item, on-hit and burns after resists', () => {
    const effects = [
      { kind: 'statMultiplier', source: 3089, evidence: '+30% AP', stat: 'ap', factor: 1.3 },
      { kind: 'onHit', source: 1205, evidence: 'magic on-hit', damageType: 'magic', flat: 20, apRatio: 0.1, totalAdRatio: 0, bonusAdRatio: 0 },
      { kind: 'burn', source: 1205, evidence: '1% max health per second', damageType: 'true', fractionPerSecond: 0.01, durationSeconds: 3 },
    ] as const;
    const [withAmp, without] = compareBuilds({ bin, items, builds: [[3089, 4645], [4645]], effects: [...effects], target });
    expect(withAmp.stats.ap).toBe(312); // 240 × 1.3
    expect(without.stats.ap).toBe(110); // no Rabadon, no multiplier
    expect(without.burnDamage).toBe(90); // 1% × 3000 × 3s, true damage
    expect(without.onHitDps).toBeCloseTo((20 + 11) * without.stats.attackSpeed * 0.625, 0);
  });

  it('lifts the attack speed cap when an augment says so', () => {
    const fast = { 1: { DataValues: [{ name: 'PercentAttackSpeedMod', values: [5] }] } };
    const [capped] = compareBuilds({ bin, items: fast, builds: [[1]] });
    const [free] = compareBuilds({ bin, items: fast, builds: [[1]], effects: [{ kind: 'attackSpeedCap', source: 1999, evidence: 'no cap', cap: null }] });
    expect(capped.stats.attackSpeed).toBe(2.5);
    expect(free.stats.attackSpeed).toBeGreaterThan(2.5);
  });
});
