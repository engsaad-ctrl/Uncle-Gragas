import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T179: Bouncing Bees (3048) had no row, so the engine valued it as "not computed" in the creator rounds (Ben D0ver's Ezreal).
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const num = (baseValue: number) => ({ baseValue });
const rec = {
  __type: 'CharacterRecord', spells: ['q', 'w'],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(500), attackSpeedModifiable: num(1), attackSpeedRatioModifiable: num(1), attackSpeedPerLevelModifiable: num(0),
};
const spell = (asAttack = false) => ({ mSpell: { cooldownTime: [4, 4], mApplyAttackEffect: asAttack, mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 50 }] } } } });
const kit = { damage: 'physical' as const, attacks: true };
const bees = CARD_NUMBERS.find((c) => c.id === 3048)!;
const control = (ad: number): CardNumbers => ({ id: 2, name: 'control', status: 'computed', ops: [{ op: 'proc', trigger: 'next_attack', damage: { ad }, type: 'physical' } as CardOp] });
const run = (cards: CardNumbers[], spells = ['q', 'w'], asAttack = false, questsDone?: number[]) => fight({
  bin: { rec: { ...rec, spells }, q: spell(asAttack), w: spell() }, shop: {}, kit, items: [], cards: cards.map((c) => ({ ...c, questDone: questsDone?.includes(c.id) })), level: 9,
});

describe('Bouncing Bees (T179)', () => {
  it('has a generated row: a bounce on the attack after an ability, and 30 AD only after its quest', () => {
    expect(bees.status).toBe('partial');
    expect(bees.ops).toEqual([
      { op: 'proc', trigger: 'next_attack', internal_cooldown: null, damage: { ad: 0.375 }, type: 'physical' },
      { op: 'add', stat: 'ad', value: 30, after_quest: true },
    ]);
    expect(bees.not_modelled).toMatch(/shortcut: .*level midpoint 75%.*boltHitShare 0\.5/);
    expect(bees.needs).toBeUndefined(); // the 700-range chance is in the coefficient, not a ranking condition (Codex T182)
  });

  it('bounces once per attack that follows an ability: 0.375 of what a full-AD next-attack proc deals', () => {
    const withBees = run([bees]).fromCards, full = run([control(1)]).fromCards;
    expect(full).toBeGreaterThan(0);
    expect(withBees / full).toBeCloseTo(0.375, 6);
  });

  it('gives nothing without an ability to cast', () => {
    expect(run([bees], []).fromCards).toBe(0);
  });

  it('bounces off an ability that hits as an attack (Ezreal Q), one charge a cast, never twice', () => {
    // One ability only, flagged as an attack (mApplyAttackEffect). A 1-true-damage next_attack proc counts the charges spent.
    const counter: CardNumbers = { id: 3, name: 'counter', status: 'computed', ops: [{ op: 'proc', trigger: 'next_attack', damage: { flat: 1 }, type: 'true' } as CardOp] };
    // attacks false: a magic non-attacker makes no attacks at all (a physical one still attacks between casts at quarter pace).
    const fightOf = (cards: CardNumbers[], attacks: boolean) => fight({ bin: { rec: { ...rec, spells: ['q'] }, q: spell(true) }, shop: {}, kit: { damage: attacks ? 'physical' as const : 'magic' as const, attacks }, items: [], cards, level: 9 });
    for (const attacks of [false, true]) {
      const r = fightOf([counter], attacks);
      expect(r.casts.Q).toBeGreaterThan(0);
      if (!attacks) expect(r.attacks).toBe(0);
      // One charge per cast, spent by that cast's own Q hit (T184), as in the game; ordinary attacks after it find no charge left.
      expect(r.fromCards).toBeCloseTo(r.casts.Q, 6);
      const withBees = fightOf([bees], attacks).fromCards, full = fightOf([control(1)], attacks).fromCards;
      expect(withBees / full).toBeCloseTo(0.375, 6);
    }
    // Without the attack flag on Q and with no ordinary attacks, nothing spends the charge.
    expect(fight({ bin: { rec: { ...rec, spells: ['q'] }, q: spell(false) }, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards: [counter], level: 9 }).fromCards).toBe(0);
  });

  it('adds its 30 AD to attacks only once the quest is done', () => {
    const none = run([]).fromAttacks, open = run([bees]).fromAttacks, done = run([bees], ['q', 'w'], false, [3048]).fromAttacks;
    expect(open).toBe(none);
    expect(done).toBeGreaterThan(none);
  });
});
