import { describe, expect, it } from 'vitest';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fightValue } from '../../src/ai/itemMath.js';

// T120b: an explicit approach scenario (attackAccess) moves basic-attack events: none before he reaches the target, then attacks without the
// aggregate attackUptime. Omitted, every result is the default one. Melee only, decided before range bonuses; unknown states get nothing.
const num = (baseValue: number) => ({ baseValue });
const recOf = (range: number, extra: Record<string, unknown> = {}) => ({
  rec: {
    __type: 'CharacterRecord', spells: [], ...extra,
    baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
    baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
    attackRangeModifiable: num(range), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  },
});
const melee = recOf(175);
const kit = { damage: 'physical' as const, attacks: true };
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const range = (n: number) => card(`range ${n}`, [{ op: 'add', stat: 'range', value: n }]);
const at = (distance: number, moveSpeed = 300) => ({ distance, moveSpeed, strings: {} });
const run = (o: { bin?: Record<string, unknown>; cards?: CardNumbers[]; access?: ReturnType<typeof at>; k?: typeof kit | { damage: 'magic'; attacks: false } } = {}) =>
  fight({ bin: o.bin ?? melee, shop: {}, kit: o.k ?? kit, items: [], cards: o.cards ?? [], level: 1, ...(o.access ? { attackAccess: o.access } : {}) });
const withUptime = <T>(v: number, f: () => T) => { const was = { ...FIGHT.attackUptime }; FIGHT.attackUptime.melee = v; FIGHT.attackUptime.ranged = v; try { return f(); } finally { Object.assign(FIGHT.attackUptime, was); } };

describe('explicit attack access (T120b)', () => {
  it('omitted, the fight is the default one', () => {
    const a = run(), b = fight({ bin: melee, shop: {}, kit, items: [], cards: [], level: 1, attackAccess: undefined });
    expect(b.damage).toBe(a.damage); expect(b.attacks).toBe(a.attacks); expect(b.access).toBeUndefined();
  });
  it('already in range (or at distance 0) equals unrestricted attacks when the default uptime is 1', () => withUptime(1, () => {
    expect(run({ access: at(0) }).attacks).toBe(run().attacks);
    expect(run({ access: at(150) }).attacks).toBe(run().attacks);
    expect(run({ access: at(150) }).damage).toBeCloseTo(run().damage, 9);
  }));
  it('no basic-attack damage before contact; the first attack lands within one step after it', () => {
    const r = run({ access: at(1000) }); // travel 825 at 300: contact 2.75 s
    expect(r.access!.after.contactSeconds).toBeCloseTo(2.75, 9);
    expect(r.damageBySecond[1]).toBe(0); // by the end of second 2
    expect(r.damageBySecond[2]).toBeGreaterThan(0); // by the end of second 3
  });
  it('unreachable, or out of range at no speed: no basic attacks; at no speed in range they run', () => {
    expect(run({ access: at(100000) }).attacks).toBe(0);
    expect(run({ access: at(1000, 0) }).attacks).toBe(0);
    expect(run({ access: at(100, 0) }).attacks).toBeGreaterThan(0);
  });
  it('more range never delays contact: attacks and damage do not fall', () => {
    const by = (n: number) => run({ cards: n ? [range(n)] : [], access: at(1000) });
    let last = by(0);
    for (const n of [25, 75, 150, 250, 400]) { const r = by(n); expect(r.attacks).toBeGreaterThanOrEqual(last.attacks); expect(r.damage).toBeGreaterThanOrEqual(last.damage); last = r; }
  });
  it('equal range gives equal events and value', () => {
    const a = run({ cards: [range(150)], access: at(1000) }), b = run({ cards: [range(100), range(50)], access: at(1000) });
    expect(b.attacks).toBe(a.attacks); expect(b.damage).toBeCloseTo(a.damage, 9);
  });
  it('the three real range cards each raise the value, whether or not one more whole attack fits (T213)', () => {
    // T213: the walk is repeated after each kill-time switch, so the whole-attack boundaries moved; with the waited share of the next attack
    // credited (card values), any earlier contact is worth more, at a boundary or not.
    for (const d of [600, 1000, 1600]) {
      const base = fight({ bin: melee, shop: {}, kit, items: [], cards: [], level: 1, attackAccess: at(d), partialLastCast: true });
      for (const id of [1170, 1071, 1115]) {
        const c = CARD_NUMBERS.find((x) => x.id === id)!;
        const r = fight({ bin: melee, shop: {}, kit, items: [], cards: [c], level: 1, attackAccess: at(d), partialLastCast: true });
        expect(r.damage, `${c.name} at ${d}`).toBeGreaterThan(base.damage);
        expect(r.attacks, `${c.name} at ${d}`).toBeGreaterThanOrEqual(base.attacks);
      }
    }
  });
  it('stacked bonuses each count once; crossing 300 keeps him melee (mode stats unchanged)', () => {
    const r = run({ cards: [range(100), range(150)], access: at(1000) });
    expect(r.access).toMatchObject({ beforeRange: 175, afterRange: 425 });
    expect(r.stats.hp).toBeCloseTo(run({ access: at(1000) }).stats.hp, 9);
  });
  it('a held live melee card starts at 200, even on a ranged record; a death-only melee op does not', () => {
    const sword = card('sword', [{ op: 'melee' } as CardOp]);
    expect(run({ bin: recOf(550), cards: [sword], access: at(1000) }).access).toMatchObject({ beforeRange: 200 });
    const ghost = card('ghost', [{ op: 'melee', eligibility: 'death' } as CardOp]);
    const r = run({ bin: recOf(550), cards: [ghost], access: at(1000) });
    expect(r.access).toBeUndefined(); expect(r.notModelled.join(' ')).toContain('سيناريو الوصول');
  });
  it('ranged, unread forms and unread range get no access and say so', () => {
    for (const bin of [recOf(550), recOf(175, { mCharacterName: 'Jayce' }), { rec: { ...melee.rec, attackRangeModifiable: undefined } }]) {
      const r = run({ bin, access: at(1000) });
      expect(r.access).toBeUndefined(); expect(r.notModelled.join(' ')).toContain('سيناريو الوصول');
    }
  });
  it('a magic kit that does not attack stays without attacks', () => {
    expect(run({ k: { damage: 'magic', attacks: false }, access: at(0) }).attacks).toBe(0);
  });
  it('replaces attackUptime instead of multiplying it: the scenario result does not move with the uptime', () => {
    expect(withUptime(0.5, () => run({ access: at(1000) }).attacks)).toBe(withUptime(0.8, () => run({ access: at(1000) }).attacks));
  });
  it('on-hit damage and heals follow the eligible attacks only', () => {
    const onHit = card('on-hit', [{ op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'true' } as CardOp]);
    const far = run({ cards: [onHit], access: at(1000) }), near = run({ cards: [onHit], access: at(0) });
    expect(far.fromCards).toBeCloseTo(10 * far.attacks, 6); expect(near.fromCards).toBeCloseTo(10 * near.attacks, 6);
    expect(far.attacks).toBeLessThan(near.attacks);
    const vamp = card('vamp', [{ op: 'add', stat: 'life_steal', value: 0.5 } as CardOp]);
    expect(run({ cards: [vamp], access: at(1000) }).healParts!.lifeSteal).toBeLessThan(run({ cards: [vamp], access: at(0) }).healParts!.lifeSteal);
  });
  it('ability casts are not gated by attack range', () => {
    const spell = { __type: 'SpellObject', mSpell: { cooldownTime: [4, 4, 4, 4, 4], mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 50 }] } } } };
    const bin = { rec: { ...melee.rec, spells: ['x/q', '', '', ''] }, 'x/q': spell };
    expect(run({ bin, access: at(100000) }).casts).toEqual(run({ bin }).casts);
  });
  it('totals agree with the events, and fightValue reads the same timeline; the next fight keeps the scenario', () => {
    const r = run({ access: at(1000) });
    expect(r.damageBySecond[r.damageBySecond.length - 1]).toBeCloseTo(r.damage, 6);
    const place = { share: 0.2, enemyDps: 1000, health0: 1000, rise: 1, absorbedWorth: 0.8 } as Parameters<typeof fightValue>[1];
    expect(fightValue(r, place)).toBeLessThan(fightValue(run({ access: at(0) }), place));
    expect(r.again!().access).toBeDefined();
  });
  it('rejects a bad scenario', () => {
    expect(() => run({ access: at(-1) })).toThrow(RangeError);
    expect(() => run({ access: at(100, Number.NaN) })).toThrow(RangeError);
  });
});

describe('the scenario reaches the item search and the plan comparison (T120b)', () => {
  const item = (stats: Record<string, number>) => ({ DataValues: Object.entries(stats).map(([name, v]) => ({ name, values: [v] })) }) as unknown as import('../../src/texts/gameData.js').GameItem;
  const shop = { 1: item({ FlatPhysicalDamageMod: 100 }), 2: item({ FlatPhysicalDamageMod: 20 }), 3: item({ FlatMagicDamageMod: 200 }), 4: item({ FlatMovementSpeedMod: 45 }) };
  const pool = [{ id: 1, gold: 3000, boots: false }, { id: 2, gold: 3000, boots: false }, { id: 3, gold: 3000, boots: false }, { id: 4, gold: 1000, boots: true }];
  const place = { share: 0.2, rise: 0, health0: 1000, enemyDps: 1000, absorbedWorth: 1 };
  it('mathBuild: no attack can land, so no item adds damage; by default they do', async () => {
    const { mathBuild } = await import('../../src/ai/itemMath.js');
    const o = { bin: melee, shop, kit, cards: [], pool, owned: [], required: [], place };
    const plain = mathBuild(o), far = mathBuild({ ...o, attackAccess: at(100000) });
    expect(plain.some((s) => s.damage > 0)).toBe(true);
    expect(far.every((s) => s.damage === 0)).toBe(true);
  });
  it('compareAugmentPlan: the same scenario on both sides of the comparison', async () => {
    const { compareAugmentPlan } = await import('../../src/ai/augmentChoice.js');
    const candidate: CardNumbers = { id: 90001, name: 'on-hit', status: 'computed', acquiredLevel: 3, ops: [{ op: 'proc', trigger: 'on_hit', damage: { flat: 50 }, type: 'true' } as CardOp] };
    const base = { bin: melee, shop, cards: [], items: [], level: 15, kit };
    expect(compareAugmentPlan({ base, candidate, place, baselineItems: [1], items: [1] }).damage).toBeGreaterThan(0);
    expect(compareAugmentPlan({ base: { ...base, attackAccess: at(100000) }, candidate, place, baselineItems: [1], items: [1] }).damage).toBe(0);
  });
});
