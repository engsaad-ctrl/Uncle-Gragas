import { expect, it } from 'vitest';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';

const value = (baseValue: number) => ({ baseValue });
const v = (n: number) => Array(7).fill(n);
const bin = {
  rec: { __type: 'CharacterRecord', spells: ['test/q'], baseHPModifiable: value(1000), hpPerLevelModifiable: value(0), baseDamageModifiable: value(100), damagePerLevelModifiable: value(0), baseArmorModifiable: value(50), armorPerLevelModifiable: value(0), baseMR: value(50), mrPerLevel: value(0), baseMoveSpeedModifiable: value(325), attackRangeModifiable: value(500), attackSpeedModifiable: value(0.6), attackSpeedRatioModifiable: value(0.6), attackSpeedPerLevelModifiable: value(0) },
  'test/q': { mSpell: { cooldownTime: v(0), DataValues: [{ name: 'BaseDamage', values: v(50) }, { name: 'ActiveADRatio', values: v(1) }, { name: 'AttackSpeedCap', values: v(0.9) }, { name: 'ExcessAttackSpeedToADMult', values: v(0.6) }] } },
};
const kit = { damage: 'physical' as const, attacks: true };
const card = (ops: CardOp[]) => ({ id: 990900, name: 'temporal oracle', status: 'computed', ops } as CardNumbers);
const run = (ops: CardOp[]) => fight({ bin, shop: {}, itemOps: {}, items: [], passive: [], cards: ops.length ? [card(ops)] : [], kit, level: 1 });
const transient = (stat: string, amount: number): CardOp[] => [
  { op: 'proc', trigger: 'periodic', internal_cooldown: 100, damage: { flat: 0 }, type: 'true' },
  { op: 'timed', trigger: 'periodic', stat, value: amount, mode: 'add', duration: 5, decays: false, stacks_max: 1, refresh: false, internal_cooldown: 100 },
];
const armor = 100 / 180;

it('Zeri reads AD on each attack before and after temporary AD ends', () => {
  // The periodic grant follows the first attack: only 2.4 and 4.8 have +100 AD.
  const r = run(transient('ad', 100));
  expect(r.attacks).toBe(7);
  expect(r.damageBySecond[4]).toBeCloseTo((150 + 2 * 250) * armor, 5);
  expect(r.fromAttacks).toBeCloseTo((2 * 250 + 5 * 150) * armor, 5);
});

it('Zeri grants excess-AS AD only while temporary AS is active, and preserves the flat hit part', () => {
  // Attack0 precedes the grant, attacks2.4/4.0 have excess, then5.6/8.0/10.4/12.8 do not.
  const r = run(transient('attack_speed', 1));
  expect(r.attacks).toBe(7);
  expect(r.damageBySecond[4]).toBeCloseTo((150 + 2 * 180) * armor, 5);
  expect(r.fromAttacks).toBeCloseTo((2 * 180 + 5 * 150) * armor, 5);
});

it.each([[0.25,150],[0.5,150],[0.75,165]])('Zeri handles below/at/above cap: bonus AS %s gives raw hit %s', (bonusAs, rawHit) => {
  const r = run([{ op: 'add', stat: 'attack_speed', value: bonusAs }]);
  expect(r.fromAttacks / r.attacks).toBeCloseTo(rawHit * armor, 5);
});
