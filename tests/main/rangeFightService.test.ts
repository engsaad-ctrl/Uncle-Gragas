import { describe, expect, it, vi } from 'vitest';

// T120b: the service passes an explicit approach scenario to every fight of cardValues and mathBuild; values under it are conditional, and the
// build cache never mixes the default with a scenario or two scenarios. Fixture: the T053 rangeTerm services fixture (melee Yi, range 175).
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const rec = (range: number) => ({ rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(range), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(355), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } });
  return { range: 175, rec };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 11, alias: 'Yi', name: 'Yi' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [] } }), loadChampionBin: async () => fixture.rec(fixture.range),
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Sword', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 11, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => {
  const card = (id: number, name: string, ops: unknown[]) => ({ id, name, status: 'computed', ops, need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [
    card(1115, 'Scopiest Weapons', [{ op: 'add', stat: 'range', value: 250 }]), card(1071, 'Scopier Weapons', [{ op: 'add', stat: 'range', value: 150 }]),
    card(2900, 'Power', [{ op: 'add', stat: 'ad', value: 20 }]), card(2901, 'Sword Form', [{ op: 'melee' }]),
    card(2902, 'Ghost Reach', [{ op: 'add', stat: 'range', value: 100, eligibility: 'death' }, { op: 'add', stat: 'ad', value: 5 }]),
  ] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 4, unresolved: 0 } } },
    augments: [e(1115, 'Scopiest Weapons'), e(1071, 'Scopier Weapons'), e(2900, 'Power'), e(2901, 'Sword Form'), e(2902, 'Ghost Reach')] }) };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const NOTE = 'سيناريو وصول صريح';
const A = { distance: 600, moveSpeed: 355 }, B = { distance: 3000, moveSpeed: 355 };

describe('explicit access scenario through the service (T120b)', () => {
  it('default, A, B, default on one instance: no cache contamination', async () => {
    const s = services();
    const d1 = await s.mathBuild(11, [], [], undefined, undefined, undefined, undefined);
    const a = await s.mathBuild(11, [], [], undefined, undefined, undefined, undefined, A);
    const b = await s.mathBuild(11, [], [], undefined, undefined, undefined, undefined, B);
    const d2 = await s.mathBuild(11, [], [], undefined, undefined, undefined, undefined);
    expect(d1.every((r) => !r.missing.some((m) => m.includes(NOTE)))).toBe(true);
    expect(a.every((r) => r.missing.some((m) => m.includes(NOTE)))).toBe(true);
    expect(b).not.toBe(a);
    expect(d2).toBe(d1);
  });
  it('card values under a scenario are conditional, never certain, and the default rows are unchanged after it', async () => {
    const s = services();
    const progress = { level: 9, acquiredLevels: {} };
    const before = await s.cardValues(11, [], [], undefined, progress);
    const scen = await s.cardValues(11, [], [], undefined, progress, [], undefined, undefined, B);
    const after = await s.cardValues(11, [], [], undefined, progress);
    expect(scen.every((r) => !r.certain && (r.missing ?? '').includes(NOTE))).toBe(true);
    expect(after.map((r) => [r.id, r.value, r.certain])).toEqual(before.map((r) => [r.id, r.value, r.certain]));
    expect(before.some((r) => (r.missing ?? '').includes(NOTE))).toBe(false);
  });
  it('a range card gains under a scenario where its range crosses an attack boundary (contact 2.86 s, about 7.9 gaps of 1/0.65 s left), and the offer path runs with it', async () => {
    const s = services();
    const progress = { level: 9, acquiredLevels: {} };
    const scen = await s.cardValues(11, [], [], undefined, progress, [1115], undefined, undefined, { distance: 1190, moveSpeed: 355 });
    const r = scen.find((x) => x.id === 1115)!;
    expect(r.value).toBeGreaterThan(0);
    // the fixture's one-item shop gives no plan either way; the scenario must not add a plan failure of its own
    const plain = (await s.cardValues(11, [], [], undefined, progress, [1115])).find((x) => x.id === 1115)!;
    expect(r.planError).toBe(plain.planError);
    expect(plain.value).toBe(0);
  });
  it('rejects a bad scenario before any cache lookup', async () => {
    const s = services();
    expect(() => s.mathBuild(11, [], [], undefined, undefined, undefined, undefined, { distance: -1, moveSpeed: 300 })).toThrow(RangeError);
    await expect(s.cardValues(11, [], [], undefined, undefined, [], undefined, undefined, { distance: 100, moveSpeed: Number.NaN })).rejects.toThrow(RangeError);
  });
});
