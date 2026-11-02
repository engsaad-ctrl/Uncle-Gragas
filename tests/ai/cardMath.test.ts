import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIGHT, cardGain, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';

// These tests count attacks exactly; the uptime has its own test.
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.5; });

const num = (baseValue: number) => ({ baseValue });
const bin = {
  rec: {
    __type: 'CharacterRecord', spells: [],
    baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
    baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
    attackRangeModifiable: num(500), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  },
};
const kit = { damage: 'physical' as const, attacks: true };
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const run = (cards: CardNumbers[] = [], passive?: CardOp[]) => fight({ bin, shop: {}, kit, items: [], cards, level: 1, passive });

describe('the fight', () => {
  it('counts attacks from attack speed', () => {
    expect(run().attacks).toBe(9); // 0.6 a second over 15 seconds, the first at once
  });
  it('raises damage by a flat stat', () => {
    expect(run([card('ad', [{ op: 'add', stat: 'ad', value: 100 }])]).fromAttacks / run().fromAttacks).toBeCloseTo(2);
  });
  it('leaves health and attacks apart', () => {
    const g = cardGain({ bin, shop: {}, kit, items: [], cards: [], level: 1 }, card('hp', [{ op: 'mult', stat: 'hp', factor: 2 }]));
    expect(g.effectiveHp).toBeCloseTo(1);
    expect(g.damage).toBeCloseTo(0);
  });
});

it('adds the mode\'s health and resists by attack range, as screens show', () => {
  const at = (range: number) => fight({ bin: { rec: { ...bin.rec, attackRangeModifiable: num(range) } }, shop: {}, kit, items: [], cards: [], level: 10 }).stats;
  expect(at(500).hp).toBeCloseTo(1000 + 20 + (380 * 9) / 17);
  expect(at(500).armor).toBeCloseTo(50);
  expect(at(125).hp).toBeCloseTo(1000 + 20 + (580 * 9) / 17);
  expect(at(125).armor).toBeCloseTo(65);
  expect(at(125).mr).toBeCloseTo(65);
});

describe('what happens over time', () => {
  const excited: CardOp = { op: 'timed', trigger: 'takedown', stat: 'move_speed', value: 1, mode: 'percent', duration: 4 };
  const passive: CardOp[] = [{ op: 'timed', trigger: 'takedown', stat: 'move_speed', value: 1.75, mode: 'percent', duration: 6, decays: true }, { op: 'timed', trigger: 'takedown', stat: 'attack_speed', value: 0.25, mode: 'percent', duration: 6 }];
  const tap = card('tap', [{ op: 'timed', trigger: 'attack', stat: 'move_speed', value: 10, mode: 'add', duration: 5, stacks_max: null, refresh: true }, { op: 'convert', from: 'move_speed', to: 'attack_speed', ratio: 0.001 }]);
  it('gives a buff only for its time', () => {
    expect(run([], passive).attacks).toBeGreaterThan(run().attacks);
    expect(run([], passive).peakMoveSpeed).toBeGreaterThan(run().peakMoveSpeed);
  });
  it('stacks a card on the passive', () => {
    expect(run([card('e', [excited])], passive).peakMoveSpeed).toBeGreaterThan(run([], passive).peakMoveSpeed);
  });
  it('lets speed feed attacks and attacks feed speed', () => {
    const plain = run([], passive), fed = run([tap], passive);
    expect(fed.attacks).toBeGreaterThan(plain.attacks);
    expect(fed.peakMoveSpeed).toBeGreaterThan(plain.peakMoveSpeed);
  });
  it('slows very high speed', () => {
    expect(run([card('e', [{ ...excited, value: 10 }])], [{ op: 'timed', trigger: 'always', stat: 'move_speed', value: 0, mode: 'add', duration: 1 }]).peakMoveSpeed).toBeLessThan(325 * 11);
  });
  it('respects a proc internal cooldown', () => {
    const proc = (internal_cooldown: number | null): CardNumbers => card('p', [{ op: 'proc', trigger: 'attack', internal_cooldown, damage: { flat: 100 }, type: 'true' }]);
    expect(run([proc(null)]).fromCards).toBeCloseTo(900);
    expect(run([proc(5)]).fromCards).toBeLessThan(500);
  });
  it('never fires a takedown card without its trigger', () => {
    expect(run([card('p', [{ op: 'proc', trigger: 'ult_cast', damage: { flat: 100 }, type: 'true' }])]).fromCards).toBe(0);
  });
});
