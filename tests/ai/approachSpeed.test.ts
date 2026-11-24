import { describe, expect, it } from 'vitest';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T213 (owner: «السرعه تقرب للخصم»): with an approach scenario, a melee champion walks to the target at his live speed, and again after
// each kill-time target switch; card values credit the waited share of the next attack, so an earlier start is never worth exactly zero.
const num = (baseValue: number) => ({ baseValue });
const recOf = (range: number) => ({
  rec: {
    __type: 'CharacterRecord', spells: [],
    baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
    baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
    attackRangeModifiable: num(range), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  },
});
const melee = recOf(175), ranged = recOf(550);
const kit = { damage: 'physical' as const, attacks: true };
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const at = (distance: number, moveSpeed = 325) => ({ distance, moveSpeed, strings: {} });
const legDay = CARD_NUMBERS.find((x) => x.id === 1305)!;
const run = (o: { bin?: Record<string, unknown>; cards?: CardNumbers[]; access?: ReturnType<typeof at>; partial?: boolean } = {}) =>
  fight({ bin: o.bin ?? melee, shop: {}, kit, items: [], cards: o.cards ?? [], level: 1, partialLastCast: o.partial ?? true, ...(o.access ? { attackAccess: o.access } : {}) });
const withKills = <T>(times: number[], f: () => T) => { const was = [...FIGHT.killTimes]; FIGHT.killTimes.splice(0, was.length, ...times); try { return f(); } finally { FIGHT.killTimes.splice(0, FIGHT.killTimes.length, ...was); } };

describe('approach at live move speed (T213)', () => {
  it('Leg Day (+50 speed) raises a melee value in the approach scenario', () => {
    for (const d of [600, 1000]) expect(run({ cards: [legDay], access: at(d) }).damage, `at ${d}`).toBeGreaterThan(run({ access: at(d) }).damage);
  });
  it('Leg Day does nothing where speed has no use: no scenario, a ranged champion, or already in range', () => {
    expect(run({ cards: [legDay] }).damage).toBeCloseTo(run().damage, 9);
    expect(run({ bin: ranged, cards: [legDay], access: at(1000) }).damage).toBeCloseTo(run({ bin: ranged, access: at(1000) }).damage, 9);
    expect(run({ cards: [legDay], access: at(150) }).damage).toBeCloseTo(run({ access: at(150) }).damage, 9);
  });
  it('with no speed gain the walk keeps the constant-speed contact (T120b)', () => {
    const r = withKills([], () => run({ access: at(1000, 300) })); // travel 825 at 300: contact 2.75 s
    expect(r.damageBySecond[1]).toBe(0);
    expect(r.damageBySecond[2]).toBeGreaterThan(0);
  });
  it('each kill-time switch walks again: fewer attacks than with no switch, and none in the second after it', () => {
    const switching = run({ access: at(1000) }), still = withKills([], () => run({ access: at(1000) }));
    expect(switching.attacks).toBeLessThan(still.attacks);
    expect(switching.damageBySecond[5]! - switching.damageBySecond[4]!).toBeLessThan(still.damageBySecond[5]! - still.damageBySecond[4]!);
  });
  it('speed is read at the moment: a speed buff held during the walk shortens it', () => {
    const now = card('now', [{ op: 'timed', trigger: 'always', stat: 'move_speed', value: 100, mode: 'add', duration: 30 } as CardOp]);
    expect(run({ cards: [now], access: at(1000) }).damage).toBeGreaterThan(run({ access: at(1000) }).damage);
  });
  it('the waited share of the next attack counts in card values only, and only adds', () => {
    const off = run({ partial: false }), on = run();
    expect(on.attacks).toBe(off.attacks);
    expect(on.damage).toBeGreaterThan(off.damage);
    expect(on.fromAttacks - off.fromAttacks).toBeLessThan(off.fromAttacks / Math.max(1, off.attacks) + 1e-9); // less than one whole attack
  });
  it('Codex T213: more attack speed never lowers attack damage across the end of the fight, including an attack due after the last step', () => {
    const as = (v: number) => card('as', [{ op: 'add', stat: 'attack_speed', value: v }]);
    let last = run({ cards: [as(0)] }).fromAttacks;
    for (let v = 0.001; v <= 0.6; v += 0.001) {
      const now = run({ cards: [as(v)] }).fromAttacks;
      expect(now, `bonus attack speed ${v.toFixed(3)}`).toBeGreaterThanOrEqual(last - 1e-9);
      last = now;
    }
  });
  it('an attack held by a walk at the end gets no share', () => {
    const on = withKills([14.9], () => run({ access: at(1000) })), off = withKills([14.9], () => run({ access: at(1000), partial: false }));
    expect(on.fromAttacks).toBeCloseTo(off.fromAttacks, 9);
  });
});
