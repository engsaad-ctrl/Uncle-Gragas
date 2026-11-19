import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { needsAbilityTarget } from '../../src/ai/abilityTarget.js';

// Overloaded (2123, kiwi 16.23): "Using another Ability resets the cooldown of {{SpellName}}."
// Q: 100 damage, 10 s cooldown. W: 100 damage, 4 s cooldown. No mana costs, no attacks.
const spell = (cd: number) => ({ __type: 'SpellObject', mSpell: { cooldownTime: [cd, cd, cd, cd, cd], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } });
const bin = { rec: { __type: 'CharacterRecord', spells: ['x/q', 'x/w', 'x/e', 'x/r'], attackRangeM: 550 }, 'x/q': spell(10), 'x/w': spell(4) };
const run = (cards: CardNumbers[]) => fight({ bin, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 11 });
const overloaded = (abilityKey?: 'Q' | 'W' | 'E' | 'R'): CardNumbers => ({ ...CARD_NUMBERS.find((c) => c.id === 2123)!, ...(abilityKey ? { abilityKey } : {}) });

describe('Overloaded: another ability resets the chosen one (2123)', () => {
  it('has the generated row and asks the player for the ability', () => {
    expect(overloaded().ops).toEqual([{ op: 'refund', scope: 'chosen_ability', amount: 1, unit: 'fraction', trigger: 'ability_cast' } as CardOp]);
    expect(needsAbilityTarget([2123])).toBe(true);
  });
  it('casts the chosen ability again after each other cast, and adds damage', () => {
    const base = run([]), q = run([overloaded('Q')]);
    expect(q.casts.Q!).toBeGreaterThan(base.casts.Q!);
    expect(q.casts.W!).toBe(base.casts.W!); // W keeps its own cooldown
    expect(q.damage).toBeGreaterThan(base.damage);
  });
  it('a reset never fires from the chosen ability\'s own cast', () => {
    // With W chosen and Q the only other: W comes back after each Q cast only.
    const base = run([]), w = run([overloaded('W')]);
    expect(w.casts.W! - base.casts.W!).toBeLessThanOrEqual(base.casts.Q!);
  });
  it('does nothing and says so without a chosen ability', () => {
    const none = run([overloaded()]), base = run([]);
    expect(none.casts).toEqual(base.casts);
    expect(none.notModelled.some((m) => m.includes('Overloaded') && m.includes('إعادة ضبط التبريد'))).toBe(true);
  });
});
