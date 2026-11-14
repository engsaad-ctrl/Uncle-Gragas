import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fight, type CardNumbers, type FightResult } from '../../src/ai/cardMath.js';
import { BURST, fightValue, type TeamPlace } from '../../src/ai/itemMath.js';

// T035: Circle of Death's damage lands with each heal, so the timeline and fightValue see it when it happens, once.
const circle = CARD_NUMBERS.find((c) => c.id === 1015)!;
const source = (op: 'heal' | 'shield', needs?: string, id = 99999): CardNumbers => ({
  id, name: `Test ${op}`, status: 'computed',
  ops: [{ op, amount: { flat: 300 }, trigger: 'periodic', internal_cooldown: 5, ...(needs ? { needs } : {}) } as CardNumbers['ops'][number]],
});
const rec = { __type: 'CharacterRecord', spells: [], baseHPModifiable: { baseValue: 1000 }, attackRangeModifiable: { baseValue: 500 } };
const run = (cards: CardNumbers[], enemy?: { armor: number; mr: number; physicalShare: number; hp: number }) =>
  fight({ bin: { rec }, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 11, ...(enemy ? { enemy } : {}) });
const gainBySecond = (a: FightResult, b: FightResult) => a.damageBySecond.map((v, i) => v - (b.damageBySecond[i] ?? 0));
const place: TeamPlace = { share: 1, rise: 0, health0: 1000, enemyDps: 0, absorbedWorth: 0 };
const HEALING_WORTH = 0.127; // itemMath's worth of a healed point in fightValue's survival

describe('Circle of Death on the fight timeline (T035)', () => {
  it('rises only at the three heals (0, 5, 10 s), and the last second holds the whole', () => {
    const before = run([source('heal')]), after = run([source('heal'), circle]);
    const g = gainBySecond(after, before);
    for (let i = 0; i < 15; i++) expect(g[i]!, `second ${i + 1}`).toBeCloseTo(131.25 * (1 + Math.floor(i / 5)));
    expect(g.at(-1)!).toBeCloseTo(after.damage - before.damage);
    expect(after.damage - before.damage).toBeCloseTo(393.75); // T034's total, unchanged by the move
  });
  it('a shield alone adds nothing to the total or the timeline; with a heal, the heal part only', () => {
    const shield = run([source('shield')]), withCircle = run([source('shield'), circle]);
    expect(withCircle.damage).toBe(shield.damage);
    expect(gainBySecond(withCircle, shield).every((v) => v === 0)).toBe(true);
    const mixed = run([source('heal'), source('shield', undefined, 99998), circle]), mixedPlain = run([source('heal'), source('shield', undefined, 99998)]);
    expect(gainBySecond(mixed, mixedPlain)).toEqual(gainBySecond(run([source('heal'), circle]), run([source('heal')])));
  });
  it('a 3 s burst window sees only the first heal; a heal at 10 s adds nothing before 10 s', () => {
    const g = gainBySecond(run([source('heal'), circle]), run([source('heal')]));
    expect(g[BURST.window - 1]!).toBeCloseTo(131.25);
    const late = source('heal', '10 seconds in champion combat');
    const lateGain = gainBySecond(run([late, circle]), run([late]));
    for (let i = 0; i < 10; i++) expect(lateGain[i]!, `second ${i + 1}`).toBe(0);
    expect(lateGain.at(-1)!).toBeCloseTo(131.25); // the one heal, at 10 s
  });
  it('fightValue gains from real heals, not from shields, and only for damage before he falls', () => {
    const heal = run([source('heal')]), healCircle = run([source('heal'), circle]);
    expect(fightValue(healCircle, place) - fightValue(heal, place)).toBeCloseTo(3 * 393.75); // three fights in a row, the same each
    const shield = run([source('shield')]), shieldCircle = run([source('shield'), circle]);
    expect(fightValue(shieldCircle, place)).toBe(fightValue(shield, place));
    // He lasts half the fight (7.5 s): the heal at 10 s comes after he falls, so its damage is worth nothing; damage moved to the start would show.
    const late = source('heal', '10 seconds in champion combat');
    const plain = run([late]), withCircle = run([late, circle]);
    const stays = plain.effectiveHp + HEALING_WORTH * plain.healedHp;
    const short: TeamPlace = { ...place, enemyDps: (2 * stays) / 15 };
    expect(withCircle.effectiveHp).toBe(plain.effectiveHp);
    expect(withCircle.healedHp).toBe(plain.healedHp);
    expect(fightValue(withCircle, short)).toBeCloseTo(fightValue(plain, short));
    // The same short place still sees the early heals' damage, so the zero above is the window, not a dead place.
    const early = run([source('heal')]), earlyCircle = run([source('heal'), circle]);
    expect(fightValue(earlyCircle, short) - fightValue(early, short)).toBeGreaterThan(100);
  });
  it('keeps the magic-resist reading: 70% of 900 against 100 magic resist is 315', () => {
    const enemy = { armor: 0, mr: 100, physicalShare: 0.5, hp: 2000 };
    expect(run([source('heal'), circle], enemy).damage - run([source('heal')], enemy).damage).toBeCloseTo(315);
  });
});
