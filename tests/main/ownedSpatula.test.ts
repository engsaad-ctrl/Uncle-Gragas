import { describe, expect, it, vi } from 'vitest';

// T161 through the services: an owned Golden Spatula (994403, Urf's Champion's reward, a map-list "starter") keeps its exact id, its stats and
// one final slot in mathBuild and cardValues' plans; never more than six final items; never bought. Fixture: owned-void-16.22 plus its record.
const fixture = vi.hoisted(() => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const fx = JSON.parse(readFileSync('tests/fixtures/game/owned-void-16.22.json', 'utf8'));
  // The cached 16.22 record of 994403 (game/items-v5.json) and its map-list entry as a starter.
  fx.shop[994403] = { DataValues: [{ name: 'AbilityHasteMod', values: [20] }, { name: 'FlatHPPoolMod', values: [200] }, { name: 'FlatArmorMod', values: [20] }, { name: 'FlatSpellBlockMod', values: [20] }, { name: 'FlatCritChanceMod', values: [0.15] }, { name: 'FlatPhysicalDamageMod', values: [90] }, { name: 'FlatMagicDamageMod', values: [110] }, { name: 'PercentAttackSpeedMod', values: [0.4] }, { name: 'PercentLifeStealMod', values: [0.1] }] };
  fx.entries.push({ id: 994403, enName: 'The Golden Spatula', html: 'fixture item', group: 'starter', gold: 0 });
  // T163: the cached 16.22 record of 226668 (Ultra Hydra's merged item) and its starter entry.
  fx.shop[226668] = { DataValues: [{ name: 'AbilityHasteMod', values: [25] }, { name: 'FlatHPPoolMod', values: [1000] }, { name: 'FlatPhysicalDamageMod', values: [200] }, { name: 'PercentOmnivampMod', values: [0.15] }, { name: 'PhysicalLethality', values: [25] }] };
  fx.entries.push({ id: 226668, enName: 'Ultra Hydra', html: 'fixture item', group: 'starter', gold: 6000 });
  const num = (baseValue: number) => ({ baseValue });
  const bin = { rec: { __type: 'CharacterRecord', mCharacterName: 'Tank', spells: [], attackRangeModifiable: num(175), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(335), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } };
  return { fx, bin };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Tank', name: 'Tank' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => fixture.fx.shop, loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => fixture.fx.entries }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 99, damage: 'physical', relies: ['attacks'], traits: ['frontline'], scales: ['ad', 'hp'] }] }));
vi.mock('../../src/ai/cardMathData.js', async (original) => {
  const real = await original<typeof import('../../src/ai/cardMathData.js')>();
  const card = (id: number, name: string, status: string, ops: unknown[]) => ({ id, name, status, ops, need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: real.ITEM_NUMBERS, CARD_NUMBERS: [card(1361, "Icathia's Fall", 'unreadable', []), card(2900, 'Plate', 'computed', [{ op: 'add', stat: 'hp', value: 300 }])] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 2, unresolved: 0 } } }, augments: [e(1361, "Icathia's Fall"), e(2900, 'Plate')] }) };
});

import { createServices } from '../../src/main/services.js';
const SPATULA = 994403, FOUR = [3075, 3065, 3143, 3110], BOOTS = 3047;
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const prog = { level: 11, acquiredLevels: {} };
const build = async (owned: number[]) => {
  const rows = await services().mathBuild(99, [], owned, undefined, undefined, undefined, prog);
  return { ids: rows.map((r) => r.item.id), owned: rows.filter((r) => r.why.includes('owned')).map((r) => r.item.id) };
};
const count = (ids: number[], id: number) => ids.filter((x) => x === id).length;

describe('an owned Golden Spatula (994403) in the plans (T161)', () => {
  it('nothing owned: it is never bought', async () => {
    expect((await build([])).ids).not.toContain(SPATULA);
  });
  it('owned alone: kept once by its exact id, owned; at most six final items', async () => {
    const b = await build([SPATULA]);
    expect(count(b.ids, SPATULA)).toBe(1); expect(b.owned).toEqual([SPATULA]); expect(b.ids.length).toBeLessThanOrEqual(6);
    expect(b.ids).not.toContain(4403); expect(b.ids).not.toContain(224403);
  });
  it('owned with four finished and boots: it takes the sixth slot, no purchase', async () => {
    const b = await build([SPATULA, ...FOUR, BOOTS]);
    expect(b.ids.sort()).toEqual([SPATULA, ...FOUR, BOOTS].sort());
  });
  it('cardValues: its stats are in the fight (the offered card is measured with them) and the plans keep it once', async () => {
    const row = async (owned: number[]) => (await services().cardValues(99, [], owned, undefined, prog, [2900])).find((r) => r.id === 2900)!;
    const withIt = await row([SPATULA]), without = await row([]);
    expect(withIt.currentValue).not.toBe(without.currentValue);
    expect(withIt.plan!.baselineOwned).toEqual([SPATULA]); expect(count(withIt.plan!.items, SPATULA)).toBe(1); expect(withIt.plan!.items.length).toBeLessThanOrEqual(6);
  });
});

describe('an owned Ultra Hydra item (226668) in the plans (T163)', () => {
  const ULTRA = 226668;
  it('never bought; owned, kept once by its exact id with its stats in the fight', async () => {
    expect((await build([])).ids).not.toContain(ULTRA);
    const b = await build([ULTRA]);
    expect(count(b.ids, ULTRA)).toBe(1); expect(b.owned).toEqual([ULTRA]); expect(b.ids.length).toBeLessThanOrEqual(6);
    const row = async (owned: number[]) => (await services().cardValues(99, [], owned, undefined, prog, [2900])).find((r) => r.id === 2900)!;
    expect((await row([ULTRA])).currentValue).not.toBe((await row([])).currentValue);
  });
});

