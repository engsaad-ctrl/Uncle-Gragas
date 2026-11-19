import { describe, expect, it, vi } from 'vitest';

// T150: Mad Scientist (1053) held, through the service: the F7 state reaches the fight. Fixture: the Salvation service fixture.
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
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [real.CARD_NUMBERS.find((c) => c.id === 1053)!, power] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 2, unresolved: 0 } } }, augments: [e(1053, 'Mad Scientist'), e(2900, 'Power')] }) };
});

import { createServices } from '../../src/main/services.js';
import { parseAugmentProgress } from '../../src/ai/augmentProgress.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const power = async (state?: 'grow' | 'shrink') => (await services().cardValues(12, [1053], [], undefined, { level: 9, acquiredLevels: { 1053: 3 }, ...(state ? { madScientist: state } : {}) }, [2900])).find((r) => r.id === 2900)!;

describe('Mad Scientist through the service (T150)', () => {
  it('the F7 state changes the fight the offered card is measured in; unset is the same as without the card, and says so', async () => {
    const unset = await power(), grow = await power('grow'), shrink = await power('shrink');
    expect(grow.currentValue).not.toBe(unset.currentValue); // grown: +20% health under the offered +20 AD
    expect(shrink.currentValue).toBe(unset.currentValue); // shrunk: haste and move speed only, and this champion has no ability
    expect(unset.missing).toContain('Mad Scientist: حالته الآن (كبير أو صغير) غير محددة في F7؛ أثره غير محسوب');
    expect(grow.missing ?? '').not.toContain('غير محددة في F7');
  });
  it('the page may send only grow or shrink', () => {
    expect(parseAugmentProgress({ level: 9, madScientist: 'grow' })).toEqual({ level: 9, acquiredLevels: {}, madScientist: 'grow' });
    expect(parseAugmentProgress({ level: 9 })).not.toHaveProperty('madScientist');
    for (const madScientist of [null, 'big', 1, {}, ['grow']]) expect(() => parseAugmentProgress({ madScientist })).toThrow('bad augment state');
  });
});
