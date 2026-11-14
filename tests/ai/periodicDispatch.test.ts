import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight, FIGHT, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

// T073 (T073-periodic-dispatch-contract.md): every periodic op runs by its own readiness, condition and lock. An op still waiting on its own
// condition must not keep the group due and re-fire ops that have already run, and it must not spend a lock it never used. Every expectation is a
// number the op gives alone; nothing here asserts a champion's build or a card's value.
const num = (baseValue: number) => ({ baseValue });
const rec = { __type: 'CharacterRecord', spells: [] as string[], attackRangeModifiable: num(175), baseHPModifiable: num(2000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(335), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) };
const bin = { rec };
const kit = { damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] } as never;
const shop = {} as never;
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 900000 + name.length, name, status: 'computed', ops } as CardNumbers);
const run = (cards: CardNumbers[], extra: Record<string, unknown> = {}) => fight({ bin, shop, kit, items: [], cards, level: 9, ...extra });

// the op that pays: a flat 100, periodic, with no lock at all
const shield100 = (): CardOp => ({ op: 'shield', trigger: 'periodic', internal_cooldown: null, amount: { flat: 100 } } as CardOp);
const heal100 = (): CardOp => ({ op: 'heal', trigger: 'periodic', internal_cooldown: null, amount: { flat: 100 } } as CardOp);
const proc100 = (): CardOp => ({ op: 'proc', trigger: 'periodic', internal_cooldown: null, damage: { flat: 100 }, type: 'magic' } as CardOp);
// the op that waits: amount 0, a 75 s lock, and a condition on his own health it never reaches in this fight
const waiting = (): CardOp => ({ op: 'shield', trigger: 'periodic', internal_cooldown: 75, amount: { flat: 0 }, needs: 'falling below 1% health' } as CardOp);

describe('a waiting periodic op does not re-fire the others (the oracle)', () => {
  for (const [kind, op, read] of [
    ['shield', shield100, (r: ReturnType<typeof run>) => (r.healParts?.shields ?? 0)],
    ['heal', heal100, (r: ReturnType<typeof run>) => r.healedHp],
    ['proc', proc100, (r: ReturnType<typeof run>) => r.damage],
  ] as const) {
    it(`${kind}: alone, and in either order beside a waiting op, it pays once`, () => {
      const alone = read(run([card('alone', [op()])]));
      expect(alone).toBeGreaterThan(0);
      const after = read(run([card('pair', [op(), waiting()])]));
      const before = read(run([card('pair', [waiting(), op()])]));
      expect(after).toBeCloseTo(alone, 6);
      expect(before).toBeCloseTo(alone, 6);
    });
  }
  it('a shield of 100 with no lock is 100 for the fight, not 100 a step', () => {
    expect(run([card('one', [shield100()])]).healParts!.shields!).toBeCloseTo(100, 6);
    expect(run([card('two', [shield100(), waiting()])]).healParts!.shields!).toBeCloseTo(100, 6);
  });
  it('the waiting op in separate cards is the same as in one card', () => {
    const one = run([card('both', [shield100(), waiting()])]).healParts!.shields!;
    const two = run([card('pays', [shield100()]), card('waits', [waiting()])]).healParts!.shields!;
    expect(two).toBeCloseTo(one, 6);
  });
});

describe('each lock is its own', () => {
  it('an empty lock, a 0 lock and a positive lock each pay at their own rate', () => {
    const empty = run([card('empty', [shield100()])]).healParts!.shields!;
    const zero = run([card('zero', [{ ...shield100(), internal_cooldown: 0 } as CardOp])]).healParts!.shields!;
    const every5 = run([card('five', [{ ...shield100(), internal_cooldown: 5 } as CardOp])]).healParts!.shields!;
    expect(empty).toBeCloseTo(100, 6); // once in a 15 s fight
    expect(zero).toBeCloseTo(100, 6); // an empty lock and a 0 lock mean the same thing to the scheduler
    expect(every5).toBeCloseTo(300, 6); // 0 s, 5 s, 10 s
  });
  it('two ops with different locks keep their own counts, together as apart', () => {
    // read the ops' own total (healParts), not healedHp: the fight scales what a heal is worth before reporting it
    const a = run([card('a', [{ ...shield100(), internal_cooldown: 5 } as CardOp])]).healParts!.shields!;
    const b = run([card('b', [{ ...shield100(), internal_cooldown: 7 } as CardOp])]).healParts!.shields!;
    const both = run([card('both', [{ ...shield100(), internal_cooldown: 5 } as CardOp, { ...shield100(), internal_cooldown: 7 } as CardOp])]);
    expect(a).toBeCloseTo(300, 6); // 0 s, 5 s, 10 s
    expect(b).toBeCloseTo(300, 6); // 0 s, 7 s, 14 s
    expect(both.healParts!.shields!).toBeCloseTo(a + b, 6); // exactly additive: neither re-fires the other
  });
  it('an op held by a condition fires when its time comes, and only then', () => {
    // 50% of his health at this incoming damage arrives inside the fight, so it fires once
    const late = { op: 'shield', trigger: 'periodic', internal_cooldown: 75, amount: { flat: 100 }, needs: 'falling below 50% health' } as CardOp;
    const r = run([card('late', [late])], { incomingDps: 400 });
    expect(r.healParts!.shields!).toBeCloseTo(100, 6);
    // and it does not rob, nor multiply, the op beside it
    const plain = run([card('plain', [shield100()])], { incomingDps: 400 }).healParts!.shields!;
    const pair = run([card('pair', [shield100(), late])], { incomingDps: 400 }).healParts!.shields!;
    expect(plain).toBeCloseTo(100, 6);
    expect(pair).toBeCloseTo(200, 6);
  });
  it('a waiting op does not spend its own lock: it still pays when its time comes', () => {
    const late = { op: 'shield', trigger: 'periodic', internal_cooldown: 5, amount: { flat: 100 }, needs: 'falling below 50% health' } as CardOp;
    const alone = run([card('late', [late])], { incomingDps: 400 }).healParts!.shields!;
    const beside = run([card('pair', [shield100(), late])], { incomingDps: 400 }).healParts!.shields!;
    expect(alone).toBeGreaterThan(0);
    expect(beside).toBeCloseTo(alone + 100, 6);
  });
});

describe('other triggers keep their own policy', () => {
  it('an on_hit op with no lock still fires on every hit, not once a fight', () => {
    const open = { op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { flat: 10 }, type: 'physical' } as CardOp;
    const once = { ...open, internal_cooldown: FIGHT.seconds } as CardOp; // the same op, locked to one fire
    const bare = run([]).damage;
    const r = run([card('open', [open])]);
    const locked = run([card('once', [once])]).damage - bare;
    expect(r.attacks).toBeGreaterThan(1);
    // its own contribution is one hit's worth per attack: the champion's resists apply to both, so the ratio is the count
    expect((r.damage - bare) / locked).toBeCloseTo(r.attacks, 6);
  });
  it('a periodic op beside an on_hit op leaves it alone', () => {
    const onHit = { op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { flat: 10 }, type: 'physical' } as CardOp;
    const alone = run([card('onhit', [onHit])]).damage;
    const beside = run([card('both', [onHit, shield100(), waiting()])]).damage;
    expect(beside).toBeCloseTo(alone, 6);
  });
});

describe('with the real item rows (ITEM_OPS)', () => {
  const itemOps = Object.fromEntries(ITEM_NUMBERS.map((i) => [i.id, i.ops])) as Record<number, CardOp[]>;
  const fx = JSON.parse(readFileSync('tests/fixtures/game/owned-void-16.22.json', 'utf8'));
  it('a waiting item op does not re-fire a card op (item 3053 waits on low health)', () => {
    const base = { bin, shop: fx.shop, kit, cards: [card('pays', [shield100()])], level: 11, itemOps };
    const alone = fight({ ...base, items: [] }).healParts!.shields!;
    const withItem = fight({ ...base, items: [3053] }).healParts!.shields!;
    expect(alone).toBeCloseTo(100, 6);
    expect(withItem - alone).toBeLessThan(alone); // the item may add its own shield once; it must not multiply the card's
  });
});

describe('the fight constants are untouched', () => {
  it('FIGHT.seconds is still 15 and the kill times still 5 and 10', () => {
    expect(FIGHT.seconds).toBe(15);
    expect(FIGHT.killTimes).toEqual([5, 10]);
  });
});

describe('the condition holds the op until its own time, and the event needs a driver', () => {
  it('a proc waiting on his health lands late in the fight, not at the start', () => {
    const late = { op: 'proc', trigger: 'periodic', internal_cooldown: 75, damage: { flat: 300 }, type: 'magic', needs: 'falling below 50% health' } as CardOp;
    const bare = run([], { incomingDps: 400 });
    const r = run([card('late', [late])], { incomingDps: 400 });
    expect(r.damage).toBeGreaterThan(bare.damage); // it does land
    const first = (r.damageBySecond[0] ?? 0) - (bare.damageBySecond[0] ?? 0);
    expect(first).toBeCloseTo(0, 6); // but nothing of it in the first second
    const later = r.damage - bare.damage;
    expect(later).toBeGreaterThan(100);
  });
  it('a card whose only periodic op is timed gets no event of its own', () => {
    // the fight raises the periodic event for a proc, heal or shield driver; a timed op alone was never a driver and still is not
    const timedOnly = { op: 'timed', trigger: 'periodic', stat: 'move_speed', value: 0.25, mode: 'percent', duration: 2, decays: false, stacks_max: 1, refresh: false, internal_cooldown: 7 } as unknown as CardOp;
    const bare = run([]);
    const alone = run([card('timedonly', [timedOnly])]);
    expect(alone.peakMoveSpeed).toBeCloseTo(bare.peakMoveSpeed, 6);
    // beside a real driver it does get the event, exactly as before
    const withDriver = run([card('timed+driver', [timedOnly, shield100()])]);
    expect(withDriver.peakMoveSpeed).toBeGreaterThan(bare.peakMoveSpeed);
  });
});
