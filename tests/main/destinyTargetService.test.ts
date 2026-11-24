import { describe, expect, it, vi } from 'vitest';

// T212: Weapon of Destiny's target when the player named none (the owner, 2026-11-21: the target is the first legendary of the game). Holding
// exactly one legendary, that one; two or more with no purchase order, unknown; in the offer's plan with none held, the plan's first legendary.
// Fixture: the T122c service fixture (one melee champion) with two AD legendaries in the shop.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const rec = () => ({ rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(125), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(0), armorPerLevelModifiable: num(0), baseMR: num(0), mrPerLevel: num(0), attackSpeedModifiable: num(1), attackSpeedRatioModifiable: num(1), baseMoveSpeedModifiable: num(345) } });
  const sword = (ad: number) => ({ DataValues: [{ name: 'FlatPhysicalDamageMod', values: [ad] }] });
  return { rec, items: { 1: sword(40), 2: sword(50) } };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 12, alias: 'MeleeOne', name: 'MeleeOne' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => fixture.items, loadChampionBin: async () => fixture.rec(),
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Sword', html: 'fixture item', group: 'legendary', gold: 3000 }, { id: 2, enName: 'Blade', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 12, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', async (original) => {
  const real = await original<typeof import('../../src/ai/cardMathData.js')>();
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [real.CARD_NUMBERS.find((c) => c.id === 3081)!] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 1, unresolved: 0 } } }, augments: [e(3081, 'Weapon of Destiny')] }) };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const progress = { level: 11, acquiredLevels: {} };
const UNSET = /سلاح المصير غير محدد/;
const row = async (items: number[]) => (await services().cardValues(12, [], items, undefined, progress)).find((r) => r.id === 3081)!;

describe('Weapon of Destiny target with none named (T212)', () => {
  it('holding one legendary, it grows that one', async () => {
    const r = await row([1]);
    expect(r.value).toBeGreaterThan(0);
    expect(String(r.missing ?? '')).not.toMatch(UNSET);
  });

  it('holding none or two (order unknown), the current value has no target and says so', async () => {
    for (const items of [[], [1, 2]]) {
      const r = await row(items);
      expect(r.value).toBe(0);
      expect(String(r.missing ?? '')).toMatch(UNSET);
    }
  });

  it('named in progress, the named one wins over the held one', async () => {
    const named = (await services().cardValues(12, [], [1, 2], undefined, { ...progress, destinyItem: 2 })).find((r) => r.id === 3081)!;
    expect(named.value).toBeGreaterThan(0);
  });

  // Codex T212 answer 3: the item search read only progress.destinyItem, so the default target was set after the search, never in it.
  it('the item search resolves the target in its own fights: none or one held, its build reads a weapon; two held, unknown and said', async () => {
    const notes = async (owned: number[]) => (await services().mathBuild(12, [3081], owned, undefined, undefined, undefined, { level: 11, acquiredLevels: { 3081: 7 } })).flatMap((r) => r.missing ?? []).join(' ');
    // The completion note is written only when a weapon was resolved and grows (T196e). The explanation's own fights without an item still say
    // the weapon is missing there (as they did for a named one), so the unset note alone does not tell.
    for (const owned of [[], [1]]) expect(await notes(owned)).toMatch(/وقت اكتمال السلاح غير معروف/);
    const two = await notes([1, 2]);
    expect(two).not.toMatch(/وقت اكتمال السلاح غير معروف/);
    expect(two).toMatch(UNSET);
  });

  it('offer plan with none held (T212 over T196e): no current target, and the plan grows its first legendary', async () => {
    const r = (await services().cardValues(12, [], [], undefined, progress, [3081])).find((x) => x.id === 3081)!;
    expect(r.value).toBe(0);
    expect(String(r.missing ?? '')).toMatch(UNSET);
    expect(r.planError).toBeUndefined();
    expect(r.plan!.value).toBeGreaterThan(0);
  });

  // T212 v3 (Codex T212 v2, fix 2): the search with no progress at all dropped the target; both branches now read it.
  it('the item search with no progress resolves the target too (none held: the build reads a weapon)', async () => {
    const notes = (await services().mathBuild(12, [3081], [])).flatMap((r) => r.missing ?? []).join(' ');
    expect(notes).toMatch(/وقت اكتمال السلاح غير معروف/);
  });

  // T212 v3 (Codex T212 v2, fix 3): none held at level 13, the planned weapon counts no kill from before 13 (not from the fixed 9).
  it('none held at his level now: the planned weapon is completed no earlier than that level', async () => {
    const notes = (await services().mathBuild(12, [3081], [], undefined, undefined, undefined, { level: 13, acquiredLevels: { 3081: 7 } })).flatMap((r) => r.missing ?? []).join(' ');
    expect(notes).toMatch(/المقدّر بالمستوى 13/);
    expect(notes).not.toMatch(/المقدّر بالمستوى 9/);
  });
});
