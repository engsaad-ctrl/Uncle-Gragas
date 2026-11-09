import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { enemyTeam, fightValue, teamPlace } from '../../src/ai/itemMath.js';
import type { GameItem } from '../../src/texts/gameData.js';

const num = (baseValue: number) => ({ baseValue });
const bin = {
  rec: { __type: 'CharacterRecord', spells: [] as string[], baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), attackRangeModifiable: num(500), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0), baseMoveSpeedModifiable: num(325) },
};
const kit = { damage: 'magic' as const, attacks: false };
const support = (values: Record<string, number>) => ({
  ...bin, rec: { ...bin.rec, spells: ['q'] },
  q: { __type: 'SpellObject', mSpell: { cooldownTime: [99, 99, 99, 99, 99, 99], mSpellCalculations: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: value }] }])) } },
});
const run = (b: Record<string, unknown>, cards: CardNumbers[] = []) => fight({ bin: b, shop: {}, kit, items: [], cards, level: 15 });

describe('healing eligible for Grievous Wounds', () => {
  it.each([
    [{ ShieldAmount: 300 }, 0],
    [{ HealAmount: 100 }, 100],
    [{ HealAmount: 100, ShieldAmount: 300 }, 100],
  ] as [Record<string, number>, number][])('keeps ability shields out of anti-heal for %j', (values, healing) => {
    const b = support(values);
    const r = run(b);
    expect(r.abilityHealing).toBe(Math.max(...Object.values(values))); // combined support channel is preserved
    const enemy = enemyTeam([{ bin: b, kit }], {})!;
    for (const id of [3165, 3033, 6609, 3075]) {
      const shop = { [id]: { DataValues: [{ name: 'GrievousAmount', values: [0.4] }] } } as Record<number, GameItem>;
      const result = (items: number[]) => fight({ bin, shop, kit, items, cards: [], level: 15, enemy });
      expect(result([id]).healingDenied).toBeCloseTo(0.4 * healing);
      expect(result([id]).damage).toBe(result([]).damage);
    }
    expect(r.abilityHealingOnly).toBe(healing);
  });
  it('applies heal power to actual ability healing while retaining shield support value', () => {
    const b = support({ HealAmount: 100, ShieldAmount: 300 });
    const r = run(b, [{ id: 1, name: 'Power', status: 'computed', ops: [{ op: 'add', stat: 'heal_shield_power', value: 0.5 }] }]);
    expect(r.abilityHealingOnly).toBe(150);
    expect(r.abilityHealing).toBe(450);
  });
  it('excludes explicit kit shields and keeps explicit kit heals in the existing self-heal channel', () => {
    const read = (op: 'heal' | 'shield') => enemyTeam([{ bin, kit, passive: [{ op, amount: { flat: 100 }, trigger: 'periodic', internal_cooldown: 99, kit: true }] }], {})!.healPerSecond;
    expect(read('shield')).toBe(0);
    expect(read('heal')).toBeCloseTo(100 / 15);
  });
  it('values healing prevented separately without generating omnivamp or damage events', () => {
    const shop = { 1: { DataValues: [{ name: 'GrievousAmount', values: [0.4] }] } } as Record<number, GameItem>;
    const enemy = { armor: 0, mr: 0, physicalShare: 1, healPerSecond: 100 };
    const r = fight({ bin, shop, kit, items: [1], cards: [{ id: 1, name: 'Vamp', status: 'computed', ops: [{ op: 'add', stat: 'omnivamp', value: 1 }] }], level: 15, enemy });
    expect(r.healingDenied).toBe(600);
    expect(r.damage).toBe(0);
    expect(r.damageBySecond.every((d) => d === 0)).toBe(true);
    expect(r.healParts!.omnivamp).toBe(0);
    const place = { ...teamPlace({ championId: 103, bin, shop, kit, enemy }), absorbedWorth: 0, enemyDps: 0, window: 15 };
    expect(fightValue(r, place)).toBe(1800); // three fights, one benefit channel
    expect(fightValue(r, { ...place, window: 3 })).toBe(360);
    expect(fightValue(r, { ...place, carriesHealth: true, draw: 1, enemyDps: r.effectiveHp / (place.share * 15 * 0.25) })).toBeCloseTo(150); // falls after one quarter of the first fight
  });
});
