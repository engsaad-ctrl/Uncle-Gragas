import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { tagWeight } from '../../src/ai/tagWeight.js';

// T051: an op of a card acts only while he lives ('live', the default). 'death' ops wait for his death, which the fight has none of; 'unknown' ops
// have a state, event or target that is not proven. Neither runs, and each is said to be left out. A card tagged on_death counts its live ops
// only when each of its ops says which it is; else, as before, the whole card gives nothing.
const num = (baseValue: number) => ({ baseValue });
const bin = { rec: {
  __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340),
  attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0),
} };
const card = (ops: CardOp[], name = 'x'): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const run = (ops: CardOp[]) => fight({ bin, shop: {}, kit: { damage: 'physical', attacks: true }, items: [], cards: [card(ops, 'Card')], level: 9 });
const hit: CardOp = { op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { flat: 30 }, type: 'physical' };
const burst: CardOp = { op: 'proc', trigger: 'periodic', internal_cooldown: 15, damage: { flat: 500 }, type: 'magic' };

describe('op eligibility in the fight', () => {
  it('a death op does not run: the damage is the live part only, and the note says why', () => {
    const r = run([{ ...hit, eligibility: 'live' }, { ...burst, eligibility: 'death', eligibilityWhy: 'on death' }]);
    expect(r.damage).toBeCloseTo(run([hit]).damage, 9);
    expect(r.damage).toBeGreaterThan(run([]).damage);
    expect(r.notModelled.join(' ')).toContain('عند موته');
  });
  it('an unknown op does not run, not even a stat: health as with nothing, and said to be', () => {
    const r = run([{ op: 'mult', stat: 'hp', factor: 1.2, eligibility: 'unknown', eligibilityWhy: 'state not read' }]);
    expect(r.effectiveHp).toBeCloseTo(run([]).effectiveHp, 9);
    expect(r.notModelled.join(' ')).toContain('state not read');
  });
  it('an op with no eligibility runs as before (live is the default)', () => {
    expect(run([burst]).damage).toBeGreaterThan(run([]).damage);
  });
});

describe('the card weight, per op', () => {
  const onDeath = { tags: ['on_death'] };
  it('on_death with every op declared: weight 1 (its live ops count)', () => {
    expect(tagWeight(onDeath, [{ ...hit, eligibility: 'live' }, { ...burst, eligibility: 'death' }]).weight).toBe(1);
  });
  it('on_death with an op not declared: weight 0, as before', () => {
    expect(tagWeight(onDeath, [{ ...hit, eligibility: 'live' }, burst]).weight).toBe(0);
  });
  it('an unknown op leaves the card open (never settled), with its reason', () => {
    const w = tagWeight(onDeath, [{ op: 'mult', stat: 'hp', factor: 1.2, eligibility: 'unknown', eligibilityWhy: 'state not read' }]);
    expect(w).toMatchObject({ weight: 1, unread: true });
    expect(w.open).toContain('state not read');
  });
  it('no on_death tag: weight 1 whatever the ops', () => {
    expect(tagWeight({ tags: [] }, [burst]).weight).toBe(1);
  });
});

describe('the generated data (knowledge/card-eligibility.jsonl)', () => {
  const of = (id: number) => CARD_NUMBERS.find((c) => c.id === id)!.ops.map((x) => x.eligibility);
  it('Clown College: Backstab live, the attack after Deceive unknown', () => expect(of(1310)).toEqual(['live', 'unknown']));
  // T150: Mad Scientist's state is the player's F7 switch now, so its ops carry a state (grow/shrink), not an unknown eligibility.
  it('Mad Scientist: no eligibility row; its ops carry their state instead', () => {
    expect(of(1053)).toEqual([undefined, undefined, undefined]);
    expect(CARD_NUMBERS.find((c) => c.id === 1053)!.ops.map((x) => x.state)).toEqual(['grow', 'shrink', 'shrink']);
  });
  it('Shark Bait, DropBear, Hellbent: death ops only', () => {
    expect(of(2032)).toEqual(['death']);
    expect(of(2031)).toEqual(['death']);
    expect(of(2107)).toEqual(['death', 'death', 'death']);
  });
});
