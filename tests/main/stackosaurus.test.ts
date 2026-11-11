import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return { shop: { 1: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [100] }] }, 2: { DataValues: [{ name: 'FlatHPPoolMod', values: [500] }] } }, bin: { rec: { __type: 'CharacterRecord', mCharacterName: 'Veigar', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(100), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) } } };
});
vi.mock('../../src/texts/cdragon.js', () => ({ loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 103, alias: 'Ahri', name: 'Ahri' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => fixture.shop, loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [...[1, 2].map((id) => ({ id, enName: String(id), html: 'fixture item', group: 'legendary', gold: 3000 })), ...extraList] }));
const extraList = vi.hoisted((): { id: number; enName: string; html: string; group: string; gold: number }[] => []);
vi.mock('../../src/ai/itemMath.js', async (original) => {
  const actual = await original<typeof import('../../src/ai/itemMath.js')>();
  return { ...actual, enemyTeam: vi.fn(actual.enemyTeam) };
});
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 103, damage: 'magic', relies: ['abilities'], traits: [], scales: ['ap'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, ITEM_NUMBERS: [], PASSIVE_NUMBERS: [{ id: 103, ops: [{ op: 'per_stack', stat: 'hp', value: 1, mode: 'add', per: 'ability_hit' }] }], CARD_NUMBERS: [
  { id: 90001, name: 'Flat health', status: 'computed', ops: [{ op: 'add', stat: 'hp', value: 100 }] },
  { id: 90002, name: 'Growing health', status: 'conditional', ops: [{ op: 'per_stack', stat: 'hp', value: 10, mode: 'add', per: 'takedown' }] },
  { id: 90003, name: 'Unreadable', status: 'unreadable', ops: [] },
  { id: 90004, name: 'Stack bonus', status: 'partial', ops: [{ op: 'stack_bonus', ratio: 1 }] },
  { id: 3086, name: 'BEES!!!', status: 'computed', ops: [] },
  { id: 1103, name: 'Bread And Butter', status: 'computed', ops: [{ op: 'add', stat: 'haste', value: 100, scope: 'chosen_ability' }] },
] }));
vi.mock('../../src/texts/augmentsLoader.js', () => ({ loadAugments: async () => ({ version: 'test', stale: false, augments: [90001, 90002, 90003, 90004, 1103, 3086].map((id) => ({ id, ids: [id], enName: String(id), rarity: 'gold', modes: ['mayhem'] })) }) }));

import { createServices } from '../../src/main/services.js';
import { enemyTeam } from '../../src/ai/itemMath.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });

describe('Stackosaurus Rex through the offer service (T027)', () => {
  it('gives the offered card nothing now and only the stacks gained after it in the levels before the next offer', async () => {
    const rows = await services().cardValues(103, [], [], undefined, { level: 7 });
    const rex = rows.find((r) => r.id === 90004)!;
    expect(rex).toBeDefined();
    expect(rex.currentValue).toBe(0); // taken now: no past stacks doubled
    expect(rex.value).toBeGreaterThan(0); // the levels before the next offer gain stacks after the pick
    expect(rex).toMatchObject({ level: 7, untilLevel: 10, certain: false });
  });
});
