import { afterAll, beforeAll, expect, it } from 'vitest';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';

// T184: an ability whose file says it hits as an attack (mApplyAttackEffect: Ezreal's Q) spends the Spellblade-type charge its own cast
// makes, as in the game (Ezreal Q procs Sheen; Ben D0ver's Bouncing Bees bounced on every Q). Before, the charge was armed after the hit,
// so the first such cast spent nothing and each later one spent the previous cast's charge, leaving one for an ordinary attack.
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const num = (baseValue: number) => ({ baseValue });
const rec = {
  __type: 'CharacterRecord',
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(500), attackSpeedModifiable: num(1), attackSpeedRatioModifiable: num(1), attackSpeedPerLevelModifiable: num(0),
};
const spell = (asAttack: boolean) => ({ mSpell: { cooldownTime: [4, 4], mApplyAttackEffect: asAttack, mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 50 }] } } } });
// One true damage on every attack after an ability: counts the charges spent.
const counter: CardNumbers = { id: 1, name: 'counter', status: 'computed', ops: [{ op: 'proc', trigger: 'next_attack', damage: { flat: 1 }, type: 'true' } as CardOp] };
// attacks false: a magic non-attacker makes no attacks at all (a physical one attacks between casts, cardMath).
const run = (spells: string[], bin: Record<string, unknown>, attacks: boolean) => fight({ bin: { rec: { ...rec, spells }, ...bin }, shop: {}, kit: { damage: attacks ? 'physical' : 'magic', attacks }, items: [], cards: [counter], level: 9 });

it('an attack-flagged cast spends its own charge: one a cast, from the first cast on', () => {
  for (const attacks of [false, true]) {
    const r = run(['q'], { q: spell(true) }, attacks);
    expect(r.casts.Q).toBeGreaterThan(1);
    expect(r.fromCards).toBeCloseTo(r.casts.Q, 6); // was casts - 1
  }
});

it('a plain cast still arms the next ordinary attack, and nothing without attacks', () => {
  const withAttacks = run(['q'], { q: spell(false) }, true);
  // Each cast arms the next attack; the last cast may find no attack before second 15.
  expect(withAttacks.fromCards).toBeGreaterThanOrEqual(withAttacks.casts.Q - 1);
  expect(withAttacks.fromCards).toBeLessThanOrEqual(withAttacks.casts.Q);
  expect(run(['q'], { q: spell(false) }, false).fromCards).toBe(0);
});

it('after a plain cast, an attack-flagged cast spends one charge, not two', () => {
  const r = run(['q', 'w'], { q: spell(true), w: spell(false) }, false);
  expect(r.casts.Q).toBeGreaterThan(0);
  expect(r.casts.W).toBeGreaterThan(0);
  expect(r.fromCards).toBeCloseTo(r.casts.Q, 6); // W arms, Q refreshes and spends; no attacks to spend a second charge
});

// T187: an ability hit that applies on-hit by a card (Ethereal Weapon: abilities_on_hit, 1 s per target) fires next_attack on its own hit;
// it then must not also leave the cast's charge for the next ordinary attack. When its lock blocks the hit, the charge waits for an attack.
const ethereal = (icd: number): CardNumbers => ({ id: 2, name: 'ethereal', status: 'computed', ops: [{ op: 'abilities_on_hit', internal_cooldown: icd } as CardOp] });
const runE = (icd: number, attacks: boolean, cd = 4) => fight({ bin: { rec: { ...rec, spells: ['q'] }, q: { mSpell: { cooldownTime: [cd, cd], mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 50 }] } } } } }, shop: {}, kit: { damage: attacks ? 'physical' : 'magic', attacks }, items: [], cards: [counter, ethereal(icd)], level: 9 });

it('an ethereal ability hit spends one charge a cast, never a second on the next attack', () => {
  for (const attacks of [false, true]) {
    const r = runE(0, attacks);
    if (!attacks) expect(r.attacks).toBe(0);
    expect(r.casts.Q).toBeGreaterThan(1);
    expect(r.fromCards).toBeCloseTo(r.casts.Q, 6); // before T187, with attacks: up to two a cast
  }
});

it('an ethereal hit its lock blocks leaves the charge to the next attack, one a cast', () => {
  const r = runE(30, true); // the lock lets only the first cast hit as on-hit
  expect(r.casts.Q).toBeGreaterThan(2);
  expect(r.fromCards).toBeGreaterThanOrEqual(r.casts.Q - 1);
  expect(r.fromCards).toBeLessThanOrEqual(r.casts.Q);
});
