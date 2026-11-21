import { afterAll, beforeAll, expect, it } from 'vitest';
import { kitWithCards } from '../../src/ai/augmentChoice.js';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';

// T196b (Codex T197 follow-up to T196): a kit with no attacks of its own and an after-cast card (Armored Impact on Thresh) attacks only to
// spend each cast's charge, not at an attacker's full pace (T196 gave 11 ordinary attacks for 4 casts).
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const num = (baseValue: number) => ({ baseValue });
const rec = {
  __type: 'CharacterRecord', spells: ['q'],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(500), attackSpeedModifiable: num(1), attackSpeedRatioModifiable: num(1), attackSpeedPerLevelModifiable: num(0),
};
const q = { mSpell: { cooldownTime: [4, 4], mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 50 }] } } } };
const card = (trigger: string): CardNumbers => ({ id: 1, name: trigger, status: 'computed', ops: [{ op: 'proc', trigger, damage: { flat: 1 }, type: 'true' } as CardOp] });
const run = (chargeAttacks: boolean) => fight({ bin: { rec, q }, shop: {}, kit: { damage: 'magic', attacks: false, ...(chargeAttacks ? { chargeAttacks } : {}) }, items: [], cards: [card('next_attack')], level: 9 });

it('kitWithCards: an after-cast card on a non-attacker sets chargeAttacks, not attacks', () => {
  const magic = { damage: 'magic' as const, attacks: false };
  expect(kitWithCards(magic, [card('next_attack')])).toEqual({ ...magic, chargeAttacks: true });
  expect(kitWithCards(magic, [card('on_hit')])).toEqual({ ...magic, attacks: true, cardAttacks: true }); // T196c
  expect(kitWithCards(magic, [card('ability_hit')])).toEqual(magic);
  expect(kitWithCards({ damage: 'physical', attacks: true }, [card('next_attack')])).toEqual({ damage: 'physical', attacks: true });
});

it('a charge attack spends each cast\'s charge, and no attack comes without a cast', () => {
  const r = run(true);
  expect(r.casts.Q).toBeGreaterThan(1);
  expect(r.attacks).toBeLessThanOrEqual(r.casts.Q);
  expect(r.attacks).toBeGreaterThanOrEqual(r.casts.Q - 1); // the last cast may find no time before the fight ends
  expect(r.fromCards).toBeCloseTo(r.attacks, 6);
});

it('without it a magic non-attacker still makes no attacks', () => {
  const r = run(false);
  expect(r.attacks).toBe(0);
  expect(r.fromCards).toBe(0);
});

// Codex T196b review, required 1: an approach scenario with no contact (melee, standing still, out of range) gives no charge attack.
it('a charge attack waits on contact: none when the target is never reached', () => {
  const r = fight({ bin: { rec: { ...rec, attackRangeModifiable: num(175) }, q }, shop: {}, kit: { damage: 'magic', attacks: false, chargeAttacks: true }, items: [], cards: [card('next_attack')], level: 9, attackAccess: { distance: 1000, moveSpeed: 0, strings: {} } });
  expect(r.casts.Q).toBeGreaterThan(1);
  expect(r.attacks).toBe(0);
  expect(r.fromCards).toBe(0);
});

// Codex T196b review, required 2: a charge attack still pending when an attack-flagged ability (Ezreal Q-like W) spends the charge is cancelled,
// so every attack spends one (attack speed 0.14: the charge attack falls due after W has spent the charge): next_attack procs (1 each) = attacks + W casts, attack procs (1000 each) = attacks.
it('a pending charge attack is dropped when another hit spends the charge first', () => {
  const slow = { ...rec, spells: ['q', 'w'], attackSpeedModifiable: num(0.14), attackSpeedRatioModifiable: num(0.14) };
  const q2 = { mSpell: { ...q.mSpell, cooldownTime: [2, 2] } };
  const w = { mSpell: { ...q.mSpell, mApplyAttackEffect: true } };
  const hit = (trigger: string, flat: number): CardNumbers => ({ id: flat, name: trigger, status: 'computed', ops: [{ op: 'proc', trigger, damage: { flat }, type: 'true' } as CardOp] });
  const r = fight({ bin: { rec: slow, q: q2, w }, shop: {}, kit: { damage: 'magic', attacks: false, chargeAttacks: true }, items: [], cards: [hit('next_attack', 1), hit('attack', 1000)], level: 9 });
  expect(r.casts.W).toBeGreaterThan(0);
  expect(r.attacks).toBeGreaterThan(0);
  expect(r.fromCards).toBeCloseTo(1001 * r.attacks + r.casts.W, 6);
});
