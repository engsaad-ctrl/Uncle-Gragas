import { describe, expect, it, vi } from 'vitest';

// T153: Steel Your Heart (1152) held with Heartsteel (item 1 here), through the service: the stacks typed in F7 reach the fight.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const rec = (mana: boolean) => ({ rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(mana ? 550 : 125), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(355), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0), primaryAbilityResource: { arType: 0, '{726ee5cd}': num(1000), '{6216bf7b}': num(0) } } });
  return { rec };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 11, alias: 'ManaOne', name: 'ManaOne' }, { id: 12, alias: 'NoMana', name: 'NoMana' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [{ name: 'DamageToMaxHealthRatio', values: [0.1] }, { name: 'BaseDamage', values: [70] }, { name: 'HPRatio', values: [0.06] }] } }), loadChampionBin: async (_o: unknown, _v: unknown, alias: string) => fixture.rec(alias === 'ManaOne'),
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Heartsteel', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [11, 12].map((id) => ({ id, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] })) }));
vi.mock('../../src/ai/cardMathData.js', async (original) => {
  const real = await original<typeof import('../../src/ai/cardMathData.js')>();
  const power = { id: 2900, name: 'Power', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 20 }], need: { class: 'always', items: null, ability_kind: null } };
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [real.CARD_NUMBERS.find((c) => c.id === 1152)!, power] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 2, unresolved: 0 } } }, augments: [e(1152, 'Steel Your Heart'), e(2900, 'Power')] }) };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const power = async (heartsteelStacks?: number, heartsteelRewarded?: boolean) => (await services().cardValues(12, [1152], [1], undefined, { level: 9, acquiredLevels: { 1152: 3 }, ...(heartsteelStacks === undefined ? {} : { heartsteelStacks }), ...(heartsteelRewarded ? { heartsteelRewarded } : {}) }, [2900])).find((r) => r.id === 2900)!;
const offered = async (heartsteelStacks: number) => (await services().cardValues(12, [], [1], undefined, { level: 9, acquiredLevels: {}, heartsteelStacks }, [1152])).find((r) => r.id === 1152)!;

describe('Steel Your Heart through the service (T153)', () => {
  it('the stacks typed in F7 change the fight the offered card is measured in; unset says so', async () => {
    const unset = await power(), low = await power(100), done = await power(400);
    expect(low.currentValue).not.toBe(done.currentValue);
    expect(unset.missing).toContain('Steel Your Heart: تكدسات Heartsteel غير مكتوبة في F7؛ أثره غير محسوب');
    expect(done.missing ?? '').not.toContain('غير مكتوبة في F7');
    // marked as holding the tripling, 900 is counted once: the held card's tripling is not applied again
    expect((await power(900, true)).currentValue).not.toBe((await power(900)).currentValue);
  });
  it('offered at 400 stacks it is worth its tripling; at 200 it is worth nothing yet', async () => {
    expect((await offered(400)).currentValue).toBeGreaterThan(0);
    expect((await offered(200)).currentValue).toBeCloseTo(0, 12);
  });
  it('partners of Steel Your Heart on a reading that already holds its tripling: the answer says its share cannot be split, even with no partner row (T156)', async () => {
    const a = await services().cardPartners(12, [1152], [1], 1152, undefined, { level: 9, acquiredLevels: { 1152: 3 }, heartsteelStacks: 900, heartsteelRewarded: true });
    expect(a.stateLimits).toContain('Steel Your Heart: الرقم المكتوب يشمل مضاعفتها، وما قبلها غير مقروء؛ حصتها من صحة Heartsteel غير قابلة للفصل');
    const plain = await services().cardPartners(12, [1152], [1], 1152, undefined, { level: 9, acquiredLevels: { 1152: 3 }, heartsteelStacks: 200 });
    expect(plain.stateLimits.join(' ')).not.toContain('غير قابلة للفصل');
  });
});

