import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';

// T049: a timed armor/MR gain on himself counts in effective health for the time it is held, averaged as the stats average (sAvg): an
// approximation of the stats, not of the damage taken. Oracle by hand: H health (the fixture's 1000 + the mode's 20 at level 1), 0 armor and MR;
// effective health = H × (1 + armor / 100) for physical damage and the same with MR for magic, blended by the enemy's physical share (even here).
// The events are the fight's kills at times set here (FIGHT.killTimes), so the oracle needs no attack timing. A trigger 'always' lasts the
// whole fight whatever its duration (the engine's rule for always), so it is used only for the whole-fight case.
// The clock (0.05 s steps, the same as current(t)): a kill at k is seen at the first step at or after k; the stats of a step are read before its
// events, so the gain counts from the next step, to its end or the fight's (15 s). The kill times sit mid-step so no rounding decides the step.
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const num = (baseValue: number) => ({ baseValue });
const bin = { rec: {
  __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(0), armorPerLevelModifiable: num(0), baseMR: num(0), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
} };
const kills = FIGHT.killTimes;
const card = (ops: CardOp[]): CardNumbers => ({ id: 1, name: 'x', status: 'computed', ops });
const run = (ops: CardOp[], o: Partial<Parameters<typeof fight>[0]> = {}) => fight({ bin, shop: {}, kit: { damage: 'physical', attacks: true }, items: [], cards: [card(ops)], level: 1, ...o });
const defence = (o: Partial<Extract<CardOp, { op: 'timed' }>> = {}): CardOp[] => (['armor', 'mr'] as const).map((stat) => ({ op: 'timed', trigger: 'always', stat, value: 100, mode: 'add', duration: 15, self: true, ...o }));
const H = run([]).effectiveHp;
// The even blend with no enemy: (physical + magic) / 2.
const ehp = (armor: number, mr: number) => (H * (1 + armor / 100) + H * (1 + mr / 100)) / 2;
const withKills = <T>(times: number[], f: () => T) => { FIGHT.killTimes = times; try { return f(); } finally { FIGHT.killTimes = kills; } };

describe('timed armor and MR in effective health', () => {
  it('held the whole fight: as the same armor and MR held for good (2 × H)', () => {
    expect(H).toBeCloseTo(1020, 6);
    expect(run(defence()).effectiveHp).toBeCloseTo(2 * H, 6);
    expect(run([{ op: 'add', stat: 'armor', value: 100 }, { op: 'add', stat: 'mr', value: 100 }]).effectiveHp).toBeCloseTo(2 * H, 6);
  });
  it('held half the fight, [7.5, 15): the stats average, 1.5 × H (not the 1.333 × H of averaging the damage taken)', () => {
    // kill 7.425, seen at the 7.45 step, counted from 7.5; 7.55 s long, so it ends with the fight
    expect(withKills([7.425], () => run(defence({ trigger: 'kill', duration: 7.55 })).effectiveHp)).toBeCloseTo(1.5 * H, 6);
  });
  it('started late and ended early: kill 4.975, seen at 5.00, 5 s long: counted [5.05, 10.00), 4.95 of 15 s', () => {
    expect(withKills([4.975], () => run(defence({ trigger: 'kill', duration: 5 })).effectiveHp)).toBeCloseTo(ehp(100 * 4.95 / 15, 100 * 4.95 / 15), 6);
  });
  it('stacks on kills to its cap, refreshed (kills seen at 2, 4 and 6 s, cap 2): 10 over [2.05, 4.05), 20 over [4.05, 15); the third only refreshes', () => {
    const stack: CardOp[] = [{ op: 'timed', trigger: 'kill', stat: 'armor', value: 10, mode: 'add', duration: 15, stacks_max: 2, refresh: true, self: true }];
    expect(withKills([1.975, 3.975, 5.975], () => run(stack).effectiveHp)).toBeCloseTo(ehp((10 * 2 + 20 * 10.95) / 15, 0), 6);
  });
  it('set to start after the fight (a below-50% health gain, its state put in before the loop): nothing (case by Codex, T049 review)', () => {
    // lowHealthAt = half of H / incomingDps = 15.5 s, after the 15 s fight; the start guard keeps it out.
    const ops = defence({ duration: 5 }).map((x) => ({ ...x, needs: 'on falling below 50% Health' }));
    expect(run(ops, { incomingDps: H * 0.5 / 15.5 }).effectiveHp).toBeCloseTo(H, 9);
  });
  it('never set off (no immobilize in this fight): nothing', () => {
    expect(run(defence({ trigger: 'immobilize_hit' })).effectiveHp).toBeCloseTo(H, 9);
  });
  it('a mixed enemy: 70% physical, armor only, read through the same blend', () => {
    const enemy = { physicalShare: 0.7, armor: 80, mr: 60, hp: 3500 } as Parameters<typeof fight>[0]['enemy'];
    const r = run(defence().filter((x) => 'stat' in x && x.stat === 'armor'), { enemy });
    expect(r.effectiveHp).toBeCloseTo(1 / (0.7 / (2 * H) + 0.3 / H), 6);
  });
  it('a gain not marked as his own (its holder or event not proven) is left out and said to be', () => {
    const r = run(defence({ self: undefined }));
    expect(r.effectiveHp).toBeCloseTo(H, 9);
    expect(r.notModelled.join(' ')).toContain('مؤقتة');
  });
  it('changes effective health only: the damage and raw healing are the same with or without it', () => {
    const plain = run([]), held = run(defence());
    expect(held.damage).toBeCloseTo(plain.damage, 9);
    expect(held.abilityHealing).toBeCloseTo(plain.abilityHealing, 9);
  });
});
