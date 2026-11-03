import { describe, expect, it } from 'vitest';
import type { FightResult } from '../../src/ai/cardMath.js';
import { enemyDpsAt, fightValue, mathBuild, searchSet, type PoolItem } from '../../src/ai/itemMath.js';
import type { GameItem } from '../../src/texts/gameData.js';

const num = (baseValue: number) => ({ baseValue });
const bin = {
  rec: {
    __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500),
    baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
    baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
    attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  },
};
const item = (stats: Record<string, number>) => ({ DataValues: Object.entries(stats).map(([name, v]) => ({ name, values: [v] })) }) as unknown as GameItem;
const shop: Record<number, GameItem> = {
  1: item({ FlatPhysicalDamageMod: 100 }), 2: item({ FlatPhysicalDamageMod: 20 }), 3: item({ FlatMagicDamageMod: 200 }), 4: item({ FlatMovementSpeedMod: 45 }),
  3033: item({ FlatPhysicalDamageMod: 90 }), 3036: item({ FlatPhysicalDamageMod: 95 }),
};
const pool: PoolItem[] = [{ id: 1, gold: 3000, boots: false }, { id: 2, gold: 3000, boots: false }, { id: 3, gold: 3000, boots: false }, { id: 4, gold: 1000, boots: true }, { id: 3033, gold: 3000, boots: false }, { id: 3036, gold: 3000, boots: false }];
const base = { bin, shop, kit: { damage: 'physical' as const, attacks: true }, cards: [], pool, owned: [], required: [], place: { share: 0.2, rise: 0, health0: 1000, enemyDps: 3000, absorbedWorth: 1 } };

describe('next items by arithmetic', () => {
  const result = (damage: number, effectiveHp: number, damageBySecond = Array.from({ length: 15 }, (_, i) => (damage * (i + 1)) / 15)) => ({ damage, effectiveHp, damageBySecond }) as FightResult;
  const place = { share: 0.2, rise: 0, health0: 1000, enemyDps: 1000, absorbedWorth: 1 }; // lasts the fight at 3000 health
  it('counts health up to what lasts the fight, and no further', () => {
    expect(fightValue(result(6000, 1500), place)).toBe(3000 + 1500);
    expect(fightValue(result(6000, 3000), place)).toBe(6000 + 3000);
    expect(fightValue(result(6000, 9000), place)).toBe(6000 + 3000);
  });
  it('counts a burst champion\'s damage only inside his window', () => {
    const burst = { ...place, window: 3 };
    const late = Array.from({ length: 15 }, (_, i) => (i < 3 ? 1000 : 6000)); // 1000 by 3 s, the rest after
    expect(fightValue(result(6000, 9000, late), burst)).toBe(1000 + 600); // and he absorbs 3 s of his share
    expect(fightValue(result(6000, 9000, late), place)).toBe(6000 + 3000);
  });
  it('reads the enemy damage for a level, between the measured ones', () => {
    expect(enemyDpsAt(3)).toBe(176);
    expect(enemyDpsAt(4)).toBeCloseTo((176 + 223) / 2);
    expect(enemyDpsAt(18)).toBe(2702);
    expect(enemyDpsAt(30)).toBe(2702);
  });
  it('counts a burst dealt before he falls', () => {
    const burst = Array.from({ length: 15 }, () => 6000);
    expect(fightValue(result(6000, 1500, burst), place)).toBe(6000 + 1500);
    expect(fightValue(result(6000, 1500), place)).toBeCloseTo(3000 + 1500);
  });
  it('lets the share grow with health bought, up to what stored games show', () => {
    const rising = { ...place, rise: 1 };
    // Three times the health at rise 1: odds of 1 to 4 become 3 to 4, a share of 3/7, lasting at 45000/7.
    expect(fightValue(result(0, 3000), rising)).toBeCloseTo(3000);
    expect(fightValue(result(0, 9000), rising)).toBeCloseTo((3 / 7) * 15000);
    expect(fightValue(result(0, 90000), rising)).toBeCloseTo((3 / 7) * 15000);
  });
  it('picks the resist the enemy team\'s damage answers', () => {
    const resists = { 1: item({ FlatArmorMod: 100 }), 2: item({ FlatSpellBlockMod: 100 }) };
    const set = { bin, shop: resists, kit: base.kit, cards: [], owned: [], required: [], place: base.place, pool: [{ id: 1, gold: 3000, boots: false }, { id: 2, gold: 3000, boots: false }] };
    const first = (physicalShare: number) => mathBuild({ ...set, enemy: { armor: 80, mr: 60, physicalShare } })[0]!.id;
    expect(first(1)).toBe(1);
    expect(first(0)).toBe(2);
  });
  it('finds a pair that one at a time misses, when asked to keep several', () => {
    // 1 is the best single, but 2 and 3 multiply each other.
    const value = (ids: number[]) => (ids.includes(2) && ids.includes(3) ? 10 : ids.includes(1) ? 5 : ids.length ? 2 : 1);
    const args = { start: [], candidates: [1, 2, 3], slots: 2, value, fits: (id: number, held: number[]) => !held.includes(id) };
    expect(searchSet({ ...args, width: 1, swaps: false })).toContain(1);
    expect([...searchSet({ ...args, width: 3, swaps: false })].sort()).toEqual([2, 3]);
  });
  it('takes what adds most first, with no regard to how often it is bought', () => {
    expect(mathBuild(base)[0]!.id).toBe(1);
  });
  it('gives one pair of boots second', () => {
    const b = mathBuild(base);
    expect(b[1]).toMatchObject({ id: 4, reason: 'boots' });
    expect(b.filter((x) => x.id === 4)).toHaveLength(1);
  });
  it('never pairs items the game limits to one', () => {
    const ids = mathBuild(base).map((x) => x.id);
    expect(ids.filter((id) => id === 3033 || id === 3036)).toHaveLength(1);
  });
  it('keeps what he owns and puts it first', () => {
    const b = mathBuild({ ...base, owned: [3] });
    expect(b[0]).toMatchObject({ id: 3, reason: 'owned' });
  });
  it('brings an item a held card needs', () => {
    expect(mathBuild({ ...base, required: [2] })[0]).toMatchObject({ id: 2, reason: 'required' });
  });
  it('counts gold in the order, not the choice: slots are the limit', () => {
    const cheap = [...pool, { id: 5, gold: 1000, boots: false }];
    const b = mathBuild({ ...base, pool: cheap, shop: { ...shop, 5: item({ FlatPhysicalDamageMod: 100 }) } });
    expect(b[0]!.id).toBe(5);
    expect(b.map((x) => x.id)).toContain(1);
  });
  it('leaves out what the kind of damage rules out', () => {
    const b = mathBuild({ ...base, offKind: (i) => i.id === 3 });
    expect(b.map((x) => x.id)).not.toContain(3);
  });
});
