import { describe, expect, it, vi } from 'vitest';

// T122a: the generated Juiced card (2016) through the service: offered, held, and in the offer's plan. Fixture: the T120b service
// fixture with a ranged 1,000-mana champion (id 11) and a melee one (id 12), the same otherwise.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const rec = (mana: boolean) => ({ rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(mana ? 550 : 125), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(355), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0), primaryAbilityResource: { arType: 0, '{726ee5cd}': num(1000), '{6216bf7b}': num(0) } } });
  return { rec };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 11, alias: 'ManaOne', name: 'ManaOne' }, { id: 12, alias: 'NoMana', name: 'NoMana' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [] } }), loadChampionBin: async (_o: unknown, _v: unknown, alias: string) => fixture.rec(alias === 'ManaOne'),
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Sword', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [11, 12].map((id) => ({ id, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] })) }));
vi.mock('../../src/ai/cardMathData.js', async (original) => {
  const real = await original<typeof import('../../src/ai/cardMathData.js')>();
  const power = { id: 2900, name: 'Power', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 20 }], need: { class: 'always', items: null, ability_kind: null } };
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [real.CARD_NUMBERS.find((c) => c.id === 2016)!, power] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 2, unresolved: 0 } } }, augments: [e(2016, 'Juiced'), e(2900, 'Power')] }) };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const progress = { level: 9, acquiredLevels: {} };
const LIMIT = 'Juiced: 16.22 kiwi Augment_ARAM_Juiced';

describe('Juiced through the service (T122a)', () => {
  it('offered, it is valued on both champions, partial and never certain, its limitation said', async () => {
    const s = services();
    for (const champ of [11, 12]) {
      const row = (await s.cardValues(champ, [], [], undefined, progress, [2016])).find((r) => r.id === 2016)!;
      expect(row.damage).toBeGreaterThan(0);
      expect(row.certain).toBe(false);
      expect(row.missing).toContain(LIMIT);
      expect(row.plan !== undefined || row.planError !== undefined).toBe(true);
    }
  });

  it('held, it reaches the other cards\' fights and says its limitation there', async () => {
    const s = services();
    const without = (await s.cardValues(11, [], [], undefined, progress)).find((r) => r.id === 2900)!;
    const held = (await s.cardValues(11, [2016], [], undefined, progress)).find((r) => r.id === 2900)!;
    expect(held.missing).toContain(LIMIT);
    expect(without.missing ?? '').not.toContain(LIMIT);
  });
});
