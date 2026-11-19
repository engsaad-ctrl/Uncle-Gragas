import { describe, expect, it } from 'vitest';
import { fight, liveCard, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T150 (owner «Yes, add it»): Mad Scientist (1053) counts only the state the player sets in F7. Grow: +20% health (its 30% adaptive force is
// not computed, Codex T151). Shrink: +70 haste (+40% move speed, outside the score).
const num = (baseValue: number) => ({ baseValue });
const spell = { __type: 'SpellObject', mSpell: { cooldownTime: [8, 8, 8, 8, 8], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
const bin = { rec: { __type: 'CharacterRecord', spells: ['x/q', '', '', ''], baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0) }, 'x/q': spell };
const mad = (state?: 'grow' | 'shrink'): CardNumbers => ({ ...CARD_NUMBERS.find((c) => c.id === 1053)!, ...(state ? { state } : {}) });
const stat = (k: 'ap' | 'ad', v: number): CardNumbers => ({ id: 0, name: 'Test', status: 'computed', ops: [{ op: 'add', stat: k, value: v } as CardOp] });
const run = (cards: CardNumbers[]) => fight({ bin, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 11 });

describe('Mad Scientist (1053)', () => {
  it('unset counts nothing and says so', () => {
    const base = run([stat('ap', 100)]), none = run([stat('ap', 100), mad()]);
    expect(none.stats).toEqual(base.stats);
    expect(none.casts).toEqual(base.casts);
    expect(none.notModelled).toContain('Mad Scientist: حالته الآن (كبير أو صغير) غير محددة في F7؛ أثره غير محسوب');
  });
  it('grown: +20% health only; the 30% adaptive force is not computed (Codex T151: AP or AD is not proven) and the note says so', () => {
    for (const k of ['ap', 'ad'] as const) {
      const base = run([stat(k, 100)]), grow = run([stat(k, 100), mad('grow')]);
      expect(grow.stats.hp).toBeCloseTo(base.stats.hp * 1.2, 6);
      expect(grow.stats.ap).toBe(base.stats.ap);
      expect(grow.stats.ad).toBe(base.stats.ad);
    }
    expect(mad().not_modelled).toMatch(/30% adaptive force is not computed/);
  });
  it('every reader sees the same parts (liveCard): grow keeps the health multiplier the planner reads, shrink and unset do not', () => {
    const hpMult = (c: CardNumbers) => liveCard(c).ops.some((x) => x.op === 'mult' && x.stat === 'hp');
    expect(hpMult(mad('grow'))).toBe(true);
    expect(hpMult(mad('shrink'))).toBe(false);
    expect(hpMult(mad())).toBe(false);
    expect(liveCard(mad('shrink')).ops.map((x) => x.op === 'add' || x.op === 'mult' ? x.stat : x.op)).toEqual(['haste', 'move_speed']);
  });
  it('shrunk: +70 haste (more casts), no health or damage stats', () => {
    const base = run([stat('ap', 100)]), shrink = run([stat('ap', 100), mad('shrink')]);
    expect(shrink.stats.haste).toBe(base.stats.haste + 70);
    expect(shrink.casts.Q!).toBeGreaterThan(base.casts.Q!);
    expect(shrink.stats.hp).toBe(base.stats.hp);
    expect(shrink.stats.ap).toBe(base.stats.ap);
  });
});
