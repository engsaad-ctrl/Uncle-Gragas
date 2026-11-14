import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FIGHT, fight, dueTicks, type CardNumbers } from '../../src/ai/cardMath.js';
import { SPELL_HITS } from '../../src/ai/cardMathData.js';

// T041/T042: a damage-per-second toggle's damage comes for the time it is on, tick by tick, booked when each tick lands; never a whole segment
// summed up front at the switch-on. Amumu W from the frozen 16.22 cache (tests/fixtures/amumu-w-16.22.json, unchanged):
// the text says "@BaseDamage@ + @TotalHealthDamage@% max health magic damage ... every second"; its two modified calculations halve both
// (BaseDamage x 0.5, TotalHealthDamage x 0.005 = x 0.5 as a share), the half-second tick; the wiki (V7.7) says it applies every half second.
// TotalHealthDamage is in percentage points at every size (1 at rank 1 is 1%, not 100%): its reading declares healthUnit 'percent' (T042).
// When the first tick lands after the switch-on is not in the data: taken here as one tick later (an assumption).
const src = JSON.parse(readFileSync('tests/fixtures/amumu-w-16.22.json', 'utf8')) as { record: object; spellPath: string; spell: { mSpell: { DataValues: { name: string; values: number[] }[] } } };
const value = (name: string, rank: number) => src.spell.mSpell.DataValues.find((d) => d.name === name)!.values[rank]!;
const MAGIC_TAKEN = 100 / (100 + FIGHT.target.mr);
// The oracle, from the source parts only: a tick is half of 10 + (health % + 0.005 x AP)% of the target's 3,500, landing every 0.5 s from 0.5 s after the switch-on, before the fight's end.
const oracle = (rank: number, ap: number, seconds: number) => {
  const perSecond = value('BaseDamage', rank) + ((value('HealthDamage', rank) + value('APRatio', rank) * ap) / 100) * FIGHT.target.hp;
  const ticks = Math.ceil(seconds / 0.5 - 1e-9) - 1; // 0.5, 1.0, ... strictly before the end
  return { ticks, damage: ticks * (perSecond / 2) * MAGIC_TAKEN };
};
const ap = (n: number): CardNumbers => ({ id: 9, name: `ap ${n}`, status: 'computed', ops: [{ op: 'add', stat: 'ap', value: n }] });
const withSpell = (spell: object, rank: number, cards: CardNumbers[] = []) => fight({
  bin: { rec: { ...src.record, spells: ['', src.spellPath, '', ''] }, [src.spellPath]: spell },
  shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 11, knownRanks: { level: 11, ranks: { Q: 0, W: rank, E: 0, R: 0 } },
});
const amumuW = (rank: number, cards: CardNumbers[] = []) => withSpell(src.spell, rank, cards);
const seconds = FIGHT.seconds;
afterEach(() => { FIGHT.seconds = seconds; });

describe('Amumu W from the frozen file', () => {
  for (const [rank, extra] of [[1, 0], [1, 1], [2, 0], [3, 0], [5, 0], [3, 100]] as const) {
    it(`rank ${rank}${extra ? `, ${extra} AP` : ''}: 5 s and 15 s match the oracle, tick by tick (not one sum at the switch-on)`, () => {
      for (const s of [5, 15]) {
        FIGHT.seconds = s;
        const r = amumuW(rank, extra ? [ap(extra)] : []), o = oracle(rank, extra, s);
        expect(r.casts.W).toBe(1);
        expect(r.fromAbilities).toBeCloseTo(o.damage, 6);
      }
    });
  }
  it('AP never lowers it: rank 1 with 1 AP deals a little more than with none (1.005%, not a jump from 100% to 1%)', () => {
    const none = amumuW(1).fromAbilities, one = amumuW(1, [ap(1)]).fromAbilities;
    expect(one).toBeGreaterThan(none);
    expect(one - none).toBeCloseTo(oracle(1, 1, 15).damage - oracle(1, 0, 15).damage, 6);
  });
  it('a health part of 0 adds nothing from the target\'s health (it does not turn into a whole share): BaseDamage alone', () => {
    const spell = structuredClone(src.spell);
    spell.mSpell.DataValues.find((d) => d.name === 'HealthDamage')!.values = Array(7).fill(0);
    expect(withSpell(spell, 1).fromAbilities).toBeCloseTo(oracle(1, 0, 15).ticks * (10 / 2) * MAGIC_TAKEN, 6);
  });
  it('the damage lands in its seconds: the timeline climbs a tick at a time, not all at 0 s', () => {
    const r = amumuW(3), o = oracle(3, 0, 15);
    const perTick = o.damage / o.ticks;
    expect(r.damageBySecond[0]).toBeCloseTo(perTick, 6); // the 0.5 s tick only, in the first second
    expect(r.damageBySecond[1]! - r.damageBySecond[0]!).toBeCloseTo(2 * perTick, 6);
    expect(r.damageBySecond.at(-1)).toBeCloseTo(o.damage, 6);
  });
  it('one switch-on is one cast: the ticks are no casts and fire no cast events', () => {
    const r = amumuW(3);
    expect(r.casts).toEqual({ W: 1 });
    // one ability instance a tick, plus the one every per-second toggle's switch-on counts (as Karthus E's): 1 + 29, where D counted 14 at once
    expect(r.abilityInstances).toBeCloseTo(1 + oracle(3, 0, 15).ticks, 6);
  });
});

describe('the declared unit against the old size rule', () => {
  // Synthetic: one calculation named as a health share (MaxHealthDamage), its value set by a data value; the reading declares the unit or not.
  const path = 'Characters/Test/Spells/X/HealthTick';
  const spell = (v: number) => ({ mSpell: {
    cooldownTime: [1, 1, 1, 1, 1, 1], mana: Array(6).fill(0), DataValues: [{ name: 'Share', values: Array(7).fill(v) }],
    mSpellCalculations: { MaxHealthDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'Share' }] } },
    mClientData: { mTooltipData: { mLists: { LevelUp: { levelCount: 5 } } } },
  } });
  const dealt = (v: number) => fight({
    bin: { rec: { ...src.record, spells: ['', path, '', ''] }, [path]: spell(v) }, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: [], level: 11,
    knownRanks: { level: 11, ranks: { Q: 0, W: 1, E: 0, R: 0 } },
  }).fromAbilities;
  const perSecondOf = (share: number) => oracle(1, 0, 15).ticks * (share * FIGHT.target.hp / 2) * MAGIC_TAKEN;
  afterEach(() => { delete SPELL_HITS[path]; });
  it('declared in percentage points: 1 is 1% and 0.5 is 0.5%', () => {
    SPELL_HITS[path] = { hits: 1, rate: 'second', tick: 0.5, healthUnit: 'percent' };
    expect(dealt(1)).toBeCloseTo(perSecondOf(0.01), 6);
    expect(dealt(0.5)).toBeCloseTo(perSecondOf(0.005), 6);
  });
  it('undeclared, the old size rule stays as it was (a stated limit, not reviewed here): 0.01 is 1%, 1 is the whole share', () => {
    SPELL_HITS[path] = { hits: 1, rate: 'second', tick: 0.5 };
    expect(dealt(0.01)).toBeCloseTo(perSecondOf(0.01), 6);
    expect(dealt(1)).toBeCloseTo(perSecondOf(1), 6);
  });
});

describe('the fight\'s own tick clock (dueTicks, which the fight calls each step)', () => {
  const DT = 0.05;
  // A segment is a dot with its own clock: on at `on`, first tick one tick later, none at or after `end`. Step it as the fight does.
  const segment = (on: number, end: number, tick = 0.5) => {
    const d = { tick, nextTick: on + tick }, at: number[] = [];
    for (let t = on + DT; t < FIGHT.seconds; t += DT) { const n = dueTicks(d, t, end); for (let i = 0; i < n; i++) at.push(Math.round(t * 100) / 100); }
    return at;
  };
  it('ticks every 0.5 s from 0.5 s after the switch-on, strictly before its end', () => {
    expect(segment(0, 15)).toHaveLength(29);
    expect(segment(0, 1.2)).toEqual([0.5, 1]);
    expect(segment(0.3, 0.7)).toEqual([]); // a segment shorter than a tick deals nothing
  });
  it('switched off and on after a gap: no tick in the gap, none carried over, nothing paid ahead', () => {
    expect([...segment(0, 2), ...segment(3, 5)]).toEqual([0.5, 1, 1.5, 3.5, 4, 4.5]);
  });
  it('a dot without a tick has no clock (other dots and Karthus E keep their even damage per step)', () => {
    expect(dueTicks({}, 3, 15)).toBe(0);
  });
});
// Karthus E and the non-periodic abilities: the sim report (tests/fixtures/sim/report.json) must not change for them.
