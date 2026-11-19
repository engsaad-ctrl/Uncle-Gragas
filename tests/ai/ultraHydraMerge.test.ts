import { describe, expect, it } from 'vitest';
import { fight } from '../../src/ai/cardMath.js';
import { inventoryOf, LEVEL_BY_ITEMS, mathBuild, SLOTS, type PoolItem } from '../../src/ai/itemMath.js';
import type { GameItem } from '../../src/texts/gameData.js';

// T166 (Codex T165): a quest that merges its three ingredients into one item (Ultra Hydra: the three Hydras -> 226668). The path buys the
// missing ingredients, the last one goes straight to the merged inventory, a merge row follows (no gold, never a purchase), and the freed slots
// are filled. Synthetic items: A, B, C the ingredients (AD 20 each), M the merged item (AD 200), and plenty of others worth buying.
const num = (baseValue: number) => ({ baseValue });
const bin = { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) } };
const item = (stats: Record<string, number>) => ({ DataValues: Object.entries(stats).map(([name, v]) => ({ name, values: [v] })) }) as unknown as GameItem;
const A = 101, B = 102, C = 103, M = 109;
const OTHERS = [201, 202, 203, 204, 205, 206];
const HS = 301; // a Heartsteel-like stacking item (DamageToMaxHealthRatio), bought first by the owner's rule
const shop: Record<number, GameItem> = { [HS]: item({ DamageToMaxHealthRatio: 0.1, BaseDamage: 70, HPRatio: 0.06, FlatHPPoolMod: 500 }), [A]: item({ FlatPhysicalDamageMod: 20 }), [B]: item({ FlatPhysicalDamageMod: 20 }), [C]: item({ FlatPhysicalDamageMod: 20 }), [M]: item({ FlatPhysicalDamageMod: 200 }), 4: item({ FlatMovementSpeedMod: 45 }), ...Object.fromEntries(OTHERS.map((id, i) => [id, item({ FlatPhysicalDamageMod: 60 + i })])) };
const pool: PoolItem[] = [...[A, B, C, HS, ...OTHERS].map((id) => ({ id, gold: 3000, boots: false })), { id: 4, gold: 1000, boots: true }];
const base = { bin, shop, kit: { damage: 'physical' as const, attacks: true }, cards: [], pool, owned: [] as number[], required: [A, B, C], place: { share: 0.2, rise: 0, health0: 1000, enemyDps: 3000, absorbedWorth: 1 }, merges: [{ from: [A, B, C], into: M }] };
const run = (o: Partial<Parameters<typeof mathBuild>[0]>) => mathBuild({ ...base, ...o });

describe('Ultra Hydra merge in the item search (T166)', () => {
  it('fresh: the three are bought, the merge row follows, the final inventory holds M and none of them, and the freed slots are filled', () => {
    const steps = run({});
    const ids = steps.map((s) => s.id);
    const merge = steps.find((s) => s.reason === 'merge')!;
    expect(merge).toEqual({ id: M, damage: 0, health: 0, reason: 'merge', consumes: [A, B, C] });
    expect(ids.indexOf(M)).toBeGreaterThan(Math.max(ids.indexOf(A), ids.indexOf(B), ids.indexOf(C)));
    const inv = inventoryOf(steps);
    expect(inv).toContain(M);
    for (const x of [A, B, C]) expect(inv).not.toContain(x);
    expect(inv.length).toBe(SLOTS); // M plus five more: two slots more than the three ingredients would have left
    expect(new Set(inv).size).toBe(inv.length);
  });
  it('no merge given: the three ingredients stay in the build, as before', () => {
    const inv = inventoryOf(run({ merges: [] }));
    for (const x of [A, B, C]) expect(inv).toContain(x);
    expect(inv).not.toContain(M);
  });
  it('one or two ingredients owned: only the missing ones are bought, then the merge', () => {
    for (const owned of [[A], [A, B]]) {
      const steps = run({ owned });
      const bought = steps.filter((s) => s.reason === 'required').map((s) => s.id);
      expect(bought.sort()).toEqual([A, B, C].filter((x) => !owned.includes(x)).sort());
      expect(steps.filter((s) => s.reason === 'merge')).toHaveLength(1);
      expect(inventoryOf(steps)).not.toContain(A);
    }
  });
  it('all three owned: merged at once, right after the owned rows', () => {
    const steps = run({ owned: [A, B, C] });
    expect(steps.slice(0, 4).map((s) => s.reason)).toEqual(['owned', 'owned', 'owned', 'merge']);
    expect(inventoryOf(steps).filter((x) => [A, B, C].includes(x))).toEqual([]);
  });
  it('the reward owned already: no ingredient is bought and nothing merges', () => {
    const steps = run({ owned: [M] });
    expect(steps.some((s) => [A, B, C].includes(s.id))).toBe(false);
    expect(steps.some((s) => s.reason === 'merge')).toBe(false);
  });
  it('no room to hold the three at once (four others owned): no merge, the build as before', () => {
    const steps = run({ owned: OTHERS.slice(0, 4) });
    expect(steps.some((s) => s.reason === 'merge')).toBe(false);
    expect(inventoryOf(steps).length).toBeLessThanOrEqual(SLOTS);
  });
  it('the third purchase is measured from the inventory before it straight to the merged one, and the merged fight counts M once', () => {
    const steps = run({});
    const third = steps[steps.findIndex((s) => s.reason === 'merge') - 1]!;
    expect([A, B, C]).toContain(third.id);
    expect(third.damage).toBeGreaterThan(0); // two ingredients of 20 AD out, M's 200 in
    const inv = inventoryOf(steps);
    const direct = fight({ bin, shop, kit: base.kit, cards: [], items: inv, level: 18 });
    expect(direct.stats.ad).toBeCloseTo(fight({ bin, shop, kit: base.kit, cards: [], items: inv.filter((x) => x !== M), level: 18 }).stats.ad + 200, 6);
  });
  // Codex T167 regressions.
  it('two ingredients and three others owned, a stacking item worth buying: every inventory on the path stays within six, and the merge happens', () => {
    const steps = run({ owned: [A, B, ...OTHERS.slice(0, 3)] });
    for (let i = 1; i <= steps.length; i++) expect(inventoryOf(steps.slice(0, i)).length).toBeLessThanOrEqual(SLOTS);
    expect(steps.some((s) => s.reason === 'merge')).toBe(true);
  });
  it('the third purchase delta is exactly the fight from the inventory before it to the merged one, at one level', () => {
    const steps = run({});
    const k = steps.findIndex((s) => s.reason === 'merge'), third = steps[k - 1]!;
    const before = inventoryOf(steps.slice(0, k - 1)), after = inventoryOf(steps.slice(0, k + 1));
    const level = Math.max(...[0, 1, 2, 3].slice(0, before.length + 1).map((n) => LEVEL_BY_ITEMS[Math.min(n, 6)]!));
    const f = (items: number[]) => fight({ bin, shop, kit: base.kit, cards: [], items, level, incomingDps: base.place.share * base.place.enemyDps });
    expect(third.damage).toBeCloseTo(f(after).damage / f(before).damage - 1, 9);
    expect(third.health).toBeCloseTo(f(after).effectiveHp / f(before).effectiveHp - 1, 9);
  });
  it('the level never drops when the owned three merge into one: the next buy is measured at the three-item level, not the one-item one', () => {
    const steps = run({ owned: [A, B, C], noBoots: true });
    const next = steps.find((s) => s.reason !== 'owned' && s.reason !== 'merge')!;
    const f = (items: number[], level: number) => fight({ bin, shop, kit: base.kit, cards: [], items, level, incomingDps: base.place.share * base.place.enemyDps });
    const at = (level: number) => [f([M, next.id], level).damage / f([M], level).damage - 1, f([M, next.id], level).effectiveHp / f([M], level).effectiveHp - 1];
    const [d3, h3] = at(LEVEL_BY_ITEMS[3]!), [d1, h1] = at(LEVEL_BY_ITEMS[1]!);
    expect(next.damage).toBeCloseTo(d3, 9); expect(next.health).toBeCloseTo(h3, 9);
    expect(Math.abs(next.damage - d1) + Math.abs(next.health - h1)).toBeGreaterThan(1e-6); // the one-item level would give another number
  });
});

