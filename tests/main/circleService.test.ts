import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return { shop: { 1: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [100] }] }, 2: { DataValues: [{ name: 'FlatHPPoolMod', values: [500] }] } }, bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(100), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) } } };
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
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 103, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, ITEM_NUMBERS: [], PASSIVE_NUMBERS: [], CARD_NUMBERS: [
  { id: 90010, name: 'Test heal', status: 'computed', ops: [{ op: 'heal', amount: { flat: 300 }, trigger: 'periodic', internal_cooldown: 5 }] },
  { id: 90011, name: 'Test shield', status: 'computed', ops: [{ op: 'shield', amount: { flat: 300 }, trigger: 'periodic', internal_cooldown: 5 }] },
  { id: 1015, name: 'Circle of Death', status: 'computed', ops: [{ op: 'heal_damage', ratio: 0.7 }] },
] }));
vi.mock('../../src/texts/augmentsLoader.js', () => ({ loadAugments: async () => ({ version: 'test', stale: false, augments: [90010, 90011, 1015].map((id) => ({ id, ids: [id], enName: String(id), rarity: 'gold', modes: ['mayhem'] })) }) }));

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });

// T035: Circle of Death's damage, now on the timeline, reaches the offer's value through the service (its tags and certainty unchanged).
describe('Circle of Death through the offer service (T035)', () => {
  it('is worth something with a held heal card, and nothing with a held shield card', async () => {
    const s = services();
    const withHeal = (await s.cardValues(103, [90010], [], undefined, { level: 7, acquiredLevels: { 90010: 3 } }, [1015])).find((r) => r.id === 1015)!;
    expect(withHeal.damage).toBeGreaterThan(0);
    expect(withHeal.value).toBeGreaterThan(0);
    const withShield = (await s.cardValues(103, [90011], [], undefined, { level: 7, acquiredLevels: { 90011: 3 } }, [1015])).find((r) => r.id === 1015)!;
    expect(withShield.damage).toBe(0);
    expect(withShield.value).toBe(0);
  });
});
