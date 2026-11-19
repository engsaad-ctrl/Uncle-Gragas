import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { needsAbilityTarget } from '../../src/ai/abilityTarget.js';
import { HIT_QUEST_AUGMENTS } from '../../src/ai/augmentProgress.js';

// T142 (Codex T140): Pursuit of Power (2116) and Pursuit of Haste (2100) reward the chosen ability only, once the hit quest is marked done.
// Q: 100 damage, 10 s cooldown. W: 100 damage, 4 s cooldown. No mana costs, no attacks.
const spell = (cd: number) => ({ __type: 'SpellObject', mSpell: { cooldownTime: [cd, cd, cd, cd, cd], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } });
const bin = { rec: { __type: 'CharacterRecord', spells: ['x/q', 'x/w', 'x/e', 'x/r'], attackRangeM: 550 }, 'x/q': spell(10), 'x/w': spell(4) };
const run = (cards: CardNumbers[]) => fight({ bin, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 11 });
const pursuit = (id: 2116 | 2100, abilityKey?: 'Q' | 'W', questDone = true): CardNumbers => ({ ...CARD_NUMBERS.find((c) => c.id === id)!, ...(abilityKey ? { abilityKey } : {}), questDone });

describe('Pursuit of Power: 30% on the chosen ability only (2116)', () => {
  it('has the generated row, asks for the ability and is a hit quest', () => {
    expect(pursuit(2116).ops).toEqual([{ op: 'damage_amp', scope: 'chosen_ability', factor: 1.3, after_quest: true } as CardOp]);
    expect(needsAbilityTarget([2116])).toBe(true);
    expect((HIT_QUEST_AUGMENTS as readonly number[]).includes(2116)).toBe(true);
  });
  it('raises the chosen Q by 30% and leaves W as it was (it was 10% on each before)', () => {
    const base = run([]), q = run([pursuit(2116, 'Q')]);
    expect(q.perCast.Q! / base.perCast.Q!).toBeCloseTo(1.3, 6);
    expect(q.perCast.W).toBe(base.perCast.W);
    expect(q.casts).toEqual(base.casts);
  });
  it('gives nothing before the quest is marked done, or without a chosen ability (and says so)', () => {
    const base = run([]);
    expect(run([pursuit(2116, 'Q', false)]).perCast).toEqual(base.perCast);
    const none = run([pursuit(2116)]);
    expect(none.perCast).toEqual(base.perCast);
    const missing = 'Pursuit of Power: المهارة المستهدفة غير محددة؛ زيادة ضرر القدرة غير محسوب';
    expect(none.notModelled).toContain(missing);
    expect(run([pursuit(2116, 'Q')]).notModelled).not.toContain(missing);
  });
});

describe('Pursuit of Haste: 80 haste on the chosen ability after the quest (2100)', () => {
  it('has the generated row, asks for the ability and is a hit quest', () => {
    expect(pursuit(2100).ops).toEqual([{ op: 'add', stat: 'haste', value: 80, scope: 'chosen_ability', after_quest: true } as CardOp]);
    expect(needsAbilityTarget([2100])).toBe(true);
    expect((HIT_QUEST_AUGMENTS as readonly number[]).includes(2100)).toBe(true);
  });
  it('the chosen Q comes back sooner; W keeps its own cooldown', () => {
    const base = run([]), q = run([pursuit(2100, 'Q')]);
    expect(q.casts.Q!).toBeGreaterThan(base.casts.Q!); // 10 s at 80 haste is 5.6 s: 3 casts in 15 s instead of 2
    expect(q.casts.W).toBe(base.casts.W);
  });
  it('gives nothing before the quest is marked done', () => {
    expect(run([pursuit(2100, 'Q', false)]).casts).toEqual(run([]).casts);
  });
});

// Codex T143 (T139b x T142): with the per-call partial last cast, the waited share of the next Q carries Pursuit of Power's 1.3 exactly once,
// an unselected ability is unchanged, and Pursuit of Haste's slot haste still moves the chosen Q.
describe('Pursuit with partialLastCast (card values)', () => {
  const qOnly = { rec: { __type: 'CharacterRecord', spells: ['x/q', '', '', ''], attackRangeM: 550 }, 'x/q': spell(10) };
  const go = (cards: CardNumbers[]) => fight({ bin: qOnly, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 11, partialLastCast: true });
  it('Q x1.3 with its credited share, once; bound to W it changes nothing', () => {
    const base = go([]), q = go([pursuit(2116, 'Q')]), whole = fight({ bin: qOnly, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards: [], level: 11 });
    expect(base.fromAbilities).toBeGreaterThan(whole.fromAbilities); // the share was credited
    expect(q.fromAbilities / base.fromAbilities).toBeCloseTo(1.3, 9);
    expect(go([pursuit(2116, 'W')]).fromAbilities).toBe(base.fromAbilities);
  });
  it('Pursuit of Haste moves the chosen Q with the share counted', () => {
    expect(go([pursuit(2100, 'Q')]).fromAbilities).toBeGreaterThan(go([]).fromAbilities);
  });
});

