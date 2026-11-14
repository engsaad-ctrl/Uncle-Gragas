import { describe, expect, it, vi } from 'vitest';

// T050: the offers' candidates (cardValues) are the augments in the Mayhem pool (modes, from the pools), whatever the id's size; a pool member
// that the policy retires (RETIRED_AUGMENTS) stays out. A held augment is read by its id, so a pick from an older match still counts.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(550), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(330), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
  };
});
const always = { class: 'always', items: null, ability_kind: null };
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Fighter', name: 'Fighter' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [{ name: 'FlatMagicDamageMod', values: [80] }] } }), loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Rod', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [],
  CARD_NUMBERS: [
    { id: 1200, name: 'c1200', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 40 }], need: { class: 'always', items: null, ability_kind: null } },
    { id: 1300, name: 'c1300', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 60 }], need: { class: 'always', items: null, ability_kind: null } },
    { id: 900, name: 'c900', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 30 }], need: { class: 'always', items: null, ability_kind: null } },
    { id: 2104, name: 'c2104', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 50 }], need: { class: 'always', items: null, ability_kind: null } },
  ],
}));
// 1200: in the Mayhem pool; 1300: >= 1000 but in no pool (unknown); 900: < 1000 but in the Mayhem pool; 2104: in the pool, retired by the policy.
vi.mock('../../src/texts/augmentsLoader.js', () => ({
  loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 3, unresolved: 0 } } }, augments: [
    { id: 1200, ids: [1200], name: 'c1200', enName: 'c1200', html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { 1200: ['kiwi'] }, iconUrl: '' },
    { id: 1300, ids: [1300], name: 'c1300', enName: 'c1300', html: 'x', described: true, rarity: 'gold', modes: [], pools: {}, iconUrl: '' },
    { id: 900, ids: [900], name: 'c900', enName: 'c900', html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { 900: ['kiwi'] }, iconUrl: '' },
    { id: 2104, ids: [2104], name: 'c2104', enName: 'c2104', html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { 2104: ['kiwi'] }, iconUrl: '' },
  ] }),
}));

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });

describe('Mayhem pool membership in the offers', () => {
  it('candidates are the pool members, whatever the id size; a member retired by the policy stays out', async () => {
    const ids = (await services().cardValues(99, [], [], undefined, { level: 9 })).map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([900, 1200]);
  });
  it('a held augment in no pool (a pick from an older match) is still read by its id and counts in the other values', async () => {
    const plain = (await services().cardValues(99, [], [], undefined, { level: 9 })).find((r) => r.id === 1200)!;
    const withHeld = await services().cardValues(99, [1300], [], undefined, { level: 9, acquiredLevels: { 1300: 3 } });
    expect(withHeld.map((r) => r.id)).not.toContain(1300);
    expect(withHeld.find((r) => r.id === 1200)!.value).not.toBeCloseTo(plain.value, 6);
  });
});
