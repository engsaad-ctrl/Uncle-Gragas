import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T171 (Codex T140 B list): Double Time (3036), kiwi 16.23: hitting with two different abilities within 4 s (DamageWindowSeconds) deals 10%
// of his mana as magic damage ({aa7499cd} AbilityResourceByCoefficient 0.1) and gives 25 max mana (ManaGain), 4 s lock (ManaGainCD).
// Synthetic kit: Q and W deal 100 each, cooldown cq / cw, no mana cost; mana bar 1000; enemy without resists.
const num = (baseValue: number) => ({ baseValue });
const spell = (cd: number) => ({ __type: 'SpellObject', mSpell: { castRange: [600, 600, 600, 600, 600, 600], cooldownTime: [cd, cd, cd, cd, cd, cd], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } });
const rec = (mana: boolean) => ({ __type: 'CharacterRecord', spells: ['x/q', 'x/w', '', ''], ...(mana ? { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(1000), '{6216bf7b}': num(0) } } : {}) });
const bin = (cq: number, cw: number, mana = true) => ({ rec: rec(mana), 'x/q': spell(cq), 'x/w': spell(cw) });
const dt = CARD_NUMBERS.find((c) => c.id === 3036)!;
const run = (b: ReturnType<typeof bin>, cards: CardNumbers[]) => fight({ bin: b, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 11, enemy: { armor: 0, mr: 0, physicalShare: 0.5 } });
const noLock = { ...dt, ops: dt.ops.map((x) => ({ ...x, internal_cooldown: 0 })) } as CardNumbers;

describe('Double Time (3036)', () => {
  it('has the generated row', () => {
    expect(dt.ops.map((x) => x.op)).toEqual(['proc', 'timed']);
    expect(dt.ops[0]).toMatchObject({ trigger: 'ability_pair', pairWindow: 4, internal_cooldown: 4, damage: { mana: 0.1 }, type: 'magic' });
  });
  it('one ability alone never sets it off', () => {
    const only = fight({ bin: { rec: { ...rec(true), spells: ['x/q', '', '', ''] }, 'x/q': spell(4) }, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: [dt], level: 11, enemy: { armor: 0, mr: 0, physicalShare: 0.5 } });
    expect(only.fromCards).toBe(0);
  });
  it('no mana bar: nothing', () => {
    expect(run(bin(4, 4, false), [dt]).fromCards).toBe(0);
  });
  // With procs k = 0..p-1 the damage is the sum of 0.1 x (1000 + 25k) = 100p + 1.25p(p-1).
  const sum = (p: number) => 100 * p + 1.25 * p * (p - 1);
  it('each proc reads his mana then adds 25 max mana: Q and W every 2 s, the 4 s lock gives 4 procs (0, 4, 8, 12 s) = 415', () => {
    expect(run(bin(2, 2), [dt]).fromCards).toBeCloseTo(sum(4), 6);
  });
  it('without the lock every hit after the first pairs: 15 procs = 1762.5, so the lock is what bounds it', () => {
    expect(run(bin(2, 2), [noLock]).fromCards).toBeCloseTo(sum(15), 6);
  });
  it('a 6 s cooldown: 3 casts each, 3 procs = 307.5', () => {
    expect(run(bin(6, 6), [dt]).fromCards).toBeCloseTo(sum(3), 6);
  });
  it('a W cast once at the start pairs with the first Q only: the later Q casts (5, 10 s) are more than 4 s after it and never pair with Q itself', () => {
    expect(run(bin(5, 30), [noLock]).fromCards).toBeCloseTo(sum(1), 6);
  });
});
