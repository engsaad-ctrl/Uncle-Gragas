import { describe, expect, it } from 'vitest';
import { fight, multipliesHealth, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { parseAugmentProgress } from '../../src/ai/augmentProgress.js';

// T153 (owner «Yes, add it»): Steel Your Heart (1152), kiwi 16.23 StackThreshold 300, StackMultiplication 3. Heartsteel's stacks S are what the
// player reads in game and types in F7; they replace the engine's estimate of Heartsteel's health, and from 300 they count 3 times.
const num = (baseValue: number) => ({ baseValue });
const bin = { rec: { __type: 'CharacterRecord', spells: [], baseHPModifiable: num(1000), hpPerLevelModifiable: num(0) } };
const HEARTSTEEL = 3084;
const shop = { [HEARTSTEEL]: { DataValues: [{ name: 'DamageToMaxHealthRatio', values: [0.1] }, { name: 'BaseDamage', values: [70] }, { name: 'HPRatio', values: [0.06] }] } } as never;
const steel = (): CardNumbers => CARD_NUMBERS.find((c) => c.id === 1152)!;
const run = (cards: CardNumbers[], heartsteelStacks?: number, items = [HEARTSTEEL], heartsteelRewarded = false) => fight({ bin, shop, kit: { damage: 'magic', attacks: false }, items, cards, level: 11, ...(heartsteelStacks === undefined ? {} : { heartsteelStacks }), ...(heartsteelRewarded ? { heartsteelRewarded } : {}) });
const hpWithout = run([], undefined, []).stats.hp;

describe('Steel Your Heart (1152) and the Heartsteel reading (T153/T154)', () => {
  it('has the generated row', () => {
    expect(steel().ops).toEqual([{ op: 'heartsteel_stacks', threshold: 300, factor: 3 }]);
  });
  it('the reading is Heartsteel health with or without the card (it replaces the estimate); unread, the estimate stays', () => {
    expect(run([], 200).stats.hp).toBeCloseTo(hpWithout + 200, 6);
    expect(run([], 900).stats.hp).toBeCloseTo(hpWithout + 900, 6);
    expect(run([steel()], 200).stats.hp).toBe(run([], 200).stats.hp); // under 300: removing the card changes nothing
    expect(run([]).stats.hp).toBeGreaterThan(hpWithout); // the estimate
  });
  it('quest not done: from 300 the reading counts three times; under 300 as it is', () => {
    expect(run([steel()], 299).stats.hp).toBeCloseTo(hpWithout + 299, 6);
    expect(run([steel()], 300).stats.hp).toBeCloseTo(hpWithout + 900, 6);
  });
  it('reading marked as holding the tripling: 900 stays 900 (never 2,700), a later 1,000 is 1,000, and it stays so after unpick and re-pick (the mark belongs to the reading)', () => {
    expect(run([steel()], 900, [HEARTSTEEL], true).stats.hp).toBeCloseTo(hpWithout + 900, 6);
    expect(run([steel()], 1000, [HEARTSTEEL], true).stats.hp).toBeCloseTo(hpWithout + 1000, 6);
    // unpicked, then picked again: the fight input still says the reading holds the reward
    expect(run([], 900, [HEARTSTEEL], true).stats.hp).toBeCloseTo(hpWithout + 900, 6);
    expect(run([steel()], 900, [HEARTSTEEL], true).stats.hp).toBeCloseTo(hpWithout + 900, 6);
  });
  it('a comparison taking the card out of a rewarded reading cannot split its share: the reading stays, and the fight says so', () => {
    const without = run([], 900, [HEARTSTEEL], true);
    expect(without.notModelled).toContain('Steel Your Heart: الرقم المكتوب يشمل مضاعفتها، وما قبلها غير مقروء؛ حصتها من صحة Heartsteel غير قابلة للفصل');
    expect(run([steel()], 900, [HEARTSTEEL], true).notModelled.join(' ')).not.toContain('غير قابلة للفصل');
  });
  it('the planner reads it as a health multiplier (the one-tank-item limit lifts), like Tank Engine', () => {
    expect(multipliesHealth(steel())).toBe(true);
    expect(multipliesHealth({ id: 0, name: 'Tank Engine', status: 'computed', ops: [{ op: 'mult', stat: 'hp', factor: 1.1 }] })).toBe(true);
    expect(multipliesHealth({ id: 0, name: 'Flat', status: 'computed', ops: [{ op: 'add', stat: 'hp', value: 100 }] })).toBe(false);
  });
  it('card held, reading empty: the estimate stays and the row says the stacks are not typed', () => {
    const r = run([steel()]);
    expect(r.stats.hp).toBe(run([]).stats.hp);
    expect(r.notModelled).toContain('Steel Your Heart: تكدسات Heartsteel غير مكتوبة في F7؛ أثره غير محسوب');
  });
  it('no Heartsteel held: nothing, whatever is typed', () => {
    expect(run([steel()], 450, []).stats.hp).toBe(hpWithout);
  });
  it('the page may send only a whole number from 0 to 20000', () => {
    expect(parseAugmentProgress({ level: 9, heartsteelStacks: 320, heartsteelRewarded: true })).toEqual({ level: 9, acquiredLevels: {}, heartsteelStacks: 320, heartsteelRewarded: true });
    for (const heartsteelRewarded of [false, 'yes', 1]) expect(() => parseAugmentProgress({ heartsteelRewarded })).toThrow('bad heartsteel stacks');
    for (const heartsteelStacks of [-1, 1.5, '300', 20001, null]) expect(() => parseAugmentProgress({ heartsteelStacks })).toThrow('bad heartsteel stacks');
  });
});
