import { describe, expect, it, vi } from 'vitest';

// T166: Ultra Hydra (2141) held, through the services: the plans read the final inventory (226668, not the three Hydras), the next purchase is
// never the merge, and the projection frees the two slots. Fixture: the Salvation one, with three Hydras sold and 226668 listed as a starter.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const rec = (mana: boolean) => ({ rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(mana ? 550 : 125), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(355), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0), primaryAbilityResource: { arType: 0, '{726ee5cd}': num(1000), '{6216bf7b}': num(0) } } });
  return { rec };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 11, alias: 'ManaOne', name: 'ManaOne' }, { id: 12, alias: 'NoMana', name: 'NoMana' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [55] }] }, 2: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [50] }] }, 5: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [45] }] }, 7: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [40] }] }, 3074: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [20] }] }, 6698: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [20] }] }, 3748: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [20] }] }, 226668: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [200] }, { name: 'FlatHPPoolMod', values: [1000] }] } }), loadChampionBin: async (_o: unknown, _v: unknown, alias: string) => fixture.rec(alias === 'ManaOne'),
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [...[[1, 'Sword'], [2, 'Axe'], [5, 'Bow'], [7, 'Lance'], [3074, 'Ravenous Hydra'], [6698, 'Profane Hydra'], [3748, 'Titanic Hydra']].map(([id, enName]) => ({ id, enName, html: 'fixture item', group: 'legendary', gold: 3000 })), { id: 226668, enName: 'Ultra Hydra', html: 'fixture item', group: 'starter', gold: 6000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [11, 12].map((id) => ({ id, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] })) }));
vi.mock('../../src/ai/cardMathData.js', async (original) => {
  const real = await original<typeof import('../../src/ai/cardMathData.js')>();
  const power = { id: 2900, name: 'Power', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 20 }], need: { class: 'always', items: null, ability_kind: null } };
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [real.CARD_NUMBERS.find((c) => c.id === 2141)!, power] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 2, unresolved: 0 } } }, augments: [e(2141, 'Ultra Hydra'), e(2900, 'Power')] }) };
});

import { createServices } from '../../src/main/services.js';
import { inventoryOf } from '../../src/ai/itemMath.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const HYDRAS = [3074, 6698, 3748], ULTRA = 226668;
const prog = { level: 11, acquiredLevels: { 2141: 7 } };
const inv = (rows: { item: { id: number }; consumes?: number[] }[]) => inventoryOf(rows.map((r) => ({ id: r.item.id, consumes: r.consumes })));

describe('Ultra Hydra merge through the services (T166)', () => {
  it('mathBuild: the three Hydras, then a merge row into 226668 (its reason says so); the final inventory holds 226668 and none of them', async () => {
    const rows = await services().mathBuild(12, [2141], [], undefined, undefined, undefined, prog);
    const merge = rows.find((r) => r.consumes)!;
    expect(merge.item.id).toBe(ULTRA);
    expect(merge.consumes!.sort()).toEqual([...HYDRAS].sort());
    expect(merge.why.join(' ')).toContain('تندمج');
    const final = inv(rows);
    expect(final).toContain(ULTRA);
    for (const h of HYDRAS) expect(final).not.toContain(h);
    expect(final.length).toBeLessThanOrEqual(6);
  });
  it('cardValues: the offered card plans compare final inventories (226668 once, no Hydras)', async () => {
    const row = (await services().cardValues(12, [2141], [], undefined, prog, [2900])).find((r) => r.id === 2900)!;
    expect(row.plan!.baselineItems.filter((x) => x === ULTRA)).toHaveLength(1);
    for (const h of HYDRAS) expect(row.plan!.baselineItems).not.toContain(h);
  });
  it('decisionAt never names the merge as the next purchase, with all three Hydras owned', async () => {
    const d = await services().decisionAt(12, [{ id: 2141, level: 7 }], { level: 11, owned: HYDRAS });
    expect(d.next?.item.id).not.toBe(ULTRA);
  });
  it('projectBuild: after the third Hydra he holds 226668 instead, and the projection goes on into the freed slots', async () => {
    const p = await services().projectBuild(12, [{ id: 2141, level: 7 }], { level: 11, owned: [3074, 6698] });
    expect(p.steps[0]!.item.id).toBe(3748);
    expect(p.steps.length).toBeGreaterThan(1); // without the merge the third Hydra would leave three slots, with it five
    expect(p.steps.map((s) => s.item.id)).not.toContain(ULTRA);
  });
  // Codex T167 regressions.
  it('projectBuild from all three Hydras owned: none stays in what he holds, and the projection buys into the freed slots', async () => {
    const p = await services().projectBuild(12, [{ id: 2141, level: 7 }], { level: 11, owned: HYDRAS });
    expect(p.steps.length).toBeGreaterThan(0);
    expect(p.steps.map((x) => x.item.id).some((id) => HYDRAS.includes(id) || id === ULTRA)).toBe(false);
  });
  it('projectBuild from six held including the three Hydras: the merge frees two slots, so it still buys (it bought nothing before)', async () => {
    const p = await services().projectBuild(12, [{ id: 2141, level: 7 }], { level: 11, owned: [...HYDRAS, 1, 2, 5] });
    expect(p.steps.length).toBeGreaterThan(0);
  });
  it('the plans carry a purchase order apart from the final inventory: the buys hold the Hydras and never 226668', async () => {
    const row = (await services().cardValues(12, [2141], [], undefined, prog, [2900])).find((r) => r.id === 2900)!;
    expect(row.plan!.baselineBuys).not.toContain(ULTRA);
    for (const h of HYDRAS) expect(row.plan!.baselineBuys).toContain(h);
    expect(row.plan!.buys).not.toContain(ULTRA);
  });
});

