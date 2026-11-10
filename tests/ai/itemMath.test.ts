import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FightResult } from '../../src/ai/cardMath.js';
import { FIGHTS, enemyDpsAt, fightValue, mathBuild, searchSet, type PoolItem } from '../../src/ai/itemMath.js';
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
  beforeAll(() => { FIGHTS.inARow = 2; }); afterAll(() => { FIGHTS.inARow = 3; });
  const result = (damage: number, effectiveHp: number, damageBySecond = Array.from({ length: 15 }, (_, i) => (damage * (i + 1)) / 15)) => ({ damage, effectiveHp, damageBySecond }) as FightResult;
  const place = { share: 0.2, rise: 0, health0: 1000, enemyDps: 1000, absorbedWorth: 1, carriesHealth: true }; // lasts the fight at 3000 health
  it('gives nothing from the second fight to a champion who falls in the first', () => {
    expect(fightValue(result(6000, 1500), place)).toBe(3000 + 1500);
    expect(fightValue(result(6000, 3000), place)).toBe(6000 + 3000); // lasts the first exactly, nothing left
  });
  it('counts health past what lasts one fight in the next, and no further', () => {
    expect(fightValue(result(6000, 4500), place)).toBe(6000 + 3000 + 3000 + 1500); // 1500 left: half the second fight
    expect(fightValue(result(6000, 6000), place)).toBe(2 * (6000 + 3000));
    expect(fightValue(result(6000, 9000), place)).toBe(2 * (6000 + 3000));
  });
  it('starts everyone but the frontline at full health in the second fight', () => {
    const back = { ...place, carriesHealth: false };
    expect(fightValue(result(6000, 1500), back)).toBe(2 * (3000 + 1500));
    expect(fightValue(result(6000, 9000), back)).toBe(2 * (6000 + 3000));
  });
  it('starts the second fight with what the first left', () => {
    const tired = { ...result(6000, 6000), again: () => result(3000, 6000) }; // out of mana in the second
    expect(fightValue(tired, place)).toBe(6000 + 3000 + 3000 + 3000);
  });
  it('counts a third fight, where a champion with no mana item has run dry', () => {
    FIGHTS.inARow = 3;
    const dry = result(1000, 6000), tired = { ...result(6000, 6000), again: () => ({ ...result(3000, 6000), again: () => dry }) };
    expect(fightValue(tired, { ...place, carriesHealth: false })).toBe(6000 + 3000 + 3000 + 3000 + 1000 + 3000);
    FIGHTS.inARow = 2;
  });
  it('counts a burst champion\'s damage only inside his window', () => {
    const burst = { ...place, window: 3 };
    const late = Array.from({ length: 15 }, (_, i) => (i < 3 ? 1000 : 6000)); // 1000 by 3 s, the rest after
    expect(fightValue(result(6000, 9000, late), burst)).toBe(2 * (1000 + 600)); // and he absorbs 3 s of his share, twice
    expect(fightValue(result(6000, 9000, late), place)).toBe(2 * (6000 + 3000));
  });
  it('starts a mage with a mana item when asked, even one the build would leave out', () => {
    const withMana = { ...shop, 5: item({ FlatMPPoolMod: 600, FlatMagicDamageMod: 1 }) };
    const steps = mathBuild({ ...base, shop: withMana, pool: [...pool, { id: 5, gold: 3000, boots: false }], manaFirst: true });
    expect(steps[0]).toMatchObject({ id: 5, reason: 'mana' });
    expect(mathBuild({ ...base, shop: withMana, pool: [...pool, { id: 5, gold: 3000, boots: false }] }).map((x) => x.id)).not.toContain(5);
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
    // Three times the health at rise 1: odds of 1 to 4 become 3 to 4, a share of 3/7, lasting at 45000/7; what is past it goes to the second fight.
    expect(fightValue(result(0, 3000), rising)).toBeCloseTo(3000);
    expect(fightValue(result(0, 9000), rising)).toBeCloseTo(9000);
    expect(fightValue(result(0, 90000), rising)).toBeCloseTo(2 * (3 / 7) * 15000);
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
  it('crosses a flat intermediate stage to find items that only work together', () => {
    const value = (ids: number[]) => ids.includes(2) && ids.includes(3) ? 30 : 10;
    const args = { start: [], candidates: [1, 2, 3], slots: 2, value, fits: (id: number, held: number[]) => !held.includes(id), width: 3, swaps: false };
    expect(searchSet(args).sort()).toEqual([2, 3]);
  });
  it('keeps the best feasible partial set when deeper combinations are worse', () => {
    const value = (ids: number[]) => ids.length === 1 ? 20 : ids.length ? 5 : 10;
    expect(searchSet({ start: [], candidates: [1, 2], slots: 2, value, fits: (id, held) => !held.includes(id), width: 2, swaps: false })).toHaveLength(1);
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
  it('buys an item that grows with stacks first, though it adds less now, a marksman too (rule 35)', () => {
    const itemOps = { 2: [{ op: 'per_stack' as const, stat: 'ad', value: 1, mode: 'add' as const, per: 'takedown', cap: 20, lost_on_death: null }] };
    const b = mathBuild({ ...base, kit: { damage: 'physical' as const, attacks: false }, itemOps });
    expect(b[0]).toMatchObject({ id: 2, reason: 'stacks' });
    expect(b[1]).toMatchObject({ reason: 'boots' });
    expect(mathBuild({ ...base, itemOps })[0]).toMatchObject({ id: 2, reason: 'stacks' });
  });
  it('puts Heartsteel first, before a mage\'s mana item', () => {
    const grown = { ...shop, 2: item({ FlatPhysicalDamageMod: 20, DamageToMaxHealthRatio: 0.1 }), 5: item({ FlatMPPoolMod: 600, FlatMagicDamageMod: 1 }) };
    const b = mathBuild({ ...base, shop: grown, pool: [...pool, { id: 5, gold: 3000, boots: false }], manaFirst: true });
    expect(b.slice(0, 2)).toMatchObject([{ id: 2, reason: 'stacks' }, { id: 5, reason: 'mana' }]);
  });
  it('gives no boots to a champion who cannot buy them (Cassiopeia), and a full slot instead', () => {
    const b = mathBuild({ ...base, noBoots: true });
    expect(b.some((x) => x.id === 4 || x.reason === 'boots')).toBe(false);
    expect(b.length).toBeGreaterThan(mathBuild(base).filter((x) => x.reason !== 'boots').length - 1);
  });
  it('brings one item of a group a held card needs (Upgrade Sheen: any Spellblade item), the one the build values most', () => {
    const b = mathBuild({ ...base, requiredAnyOf: [[1, 3]] });
    const got = b.filter((x) => x.reason === 'required').map((x) => x.id);
    expect(got).toHaveLength(1);
    expect([1, 3]).toContain(got[0]);
  });
  it('brings an item a held card needs', () => {
    expect(mathBuild({ ...base, required: [2] })[0]).toMatchObject({ id: 2, reason: 'required' });
  });
  it('reserves a planned upgrade without ordering it as a required first purchase', () => {
    const steps = mathBuild({ ...base, plannedItem: 2, offKind: (i) => i.id === 2 });
    expect(steps[0]!.id).toBe(1);
    expect(steps).toContainEqual(expect.objectContaining({ id: 2, reason: 'math' }));
  });
  it('lets a card bring items the shop holds one at a time (Ultra Hydra\'s three Hydras)', () => {
    const hydra = (ad: number) => ({ ...item({ FlatPhysicalDamageMod: ad }), limits: ['hydra'] }) as unknown as GameItem;
    const hydras = { ...shop, 1: hydra(100), 2: hydra(20) };
    expect(mathBuild({ ...base, shop: hydras, required: [1, 2] }).filter((s) => s.reason === 'required').map((s) => s.id)).toEqual([1, 2]);
    expect(mathBuild({ ...base, shop: hydras }).filter((s) => s.id === 1 || s.id === 2)).toHaveLength(1); // without the card, one Hydra
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
