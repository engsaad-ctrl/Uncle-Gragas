import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T169 (Codex T140 defect): From Downtown (2103)'s blast counts only on a hit from an ability that reaches beyond 600 (kiwi 16.23 BangBang
// SnipeDistance 600), not on every ability hit. Q reaches 1000, W 300; both deal 100 every 4 s; quest marked done.
const spell = (range: number) => ({ __type: 'SpellObject', mSpell: { castRange: [range, range, range, range, range, range], cooldownTime: [4, 4, 4, 4, 4], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } });
const bin = (q: number, w: number) => ({ rec: { __type: 'CharacterRecord', spells: ['x/q', 'x/w', '', ''] }, 'x/q': spell(q), 'x/w': spell(w) });
const downtown: CardNumbers = { ...CARD_NUMBERS.find((c) => c.id === 2103)!, questDone: true };
const run = (b: ReturnType<typeof bin>, cards: CardNumbers[]) => fight({ bin: b, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 11 });

describe('From Downtown (2103)', () => {
  it('the row carries the 600 snipe distance', () => {
    expect((downtown.ops[0] as { minHitRange?: number }).minHitRange).toBe(600);
  });
  it('a champion whose abilities all reach 600 or less gets nothing from it', () => {
    expect(run(bin(600, 300), [downtown]).fromCards).toBe(0);
  });
  it('a long Q sets it off; the same fight with only short abilities does not; the 8 s per-target lock holds', () => {
    const long = run(bin(1000, 300), [downtown]), short = run(bin(500, 300), [downtown]);
    expect(long.fromCards).toBeGreaterThan(0);
    expect(short.fromCards).toBe(0);
    const casts = long.casts.Q!; // Q at 0, 4, 8, 12 s: the blast at most every 8 s, so 2 in 15 s
    expect(casts).toBe(4);
    const one = run(bin(1000, 300), [{ ...downtown, ops: [{ ...(downtown.ops[0] as object), internal_cooldown: 0 } as never] }]).fromCards / 4;
    expect(long.fromCards / one).toBeCloseTo(2, 6);
  });
});
