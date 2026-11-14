import { describe, expect, it, vi } from 'vitest';

// T053: cardValues sends each range card's term beside its value: the basic attack range +N, before and after (held cards first), and the
// example scenario's in-range window (a stationary target at 600, his base move speed, 15 s). Melee only today; a ranged champion gets no number.
// The fight's numbers do not change.
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
const rows = async (held: number[] = []) => services().cardValues(11, held, [], undefined, { level: 9, acquiredLevels: Object.fromEntries(held.map((id) => [id, 3])) });
const row = (r: Awaited<ReturnType<typeof rows>>, id: number) => r.find((x) => x.id === id)!;

describe('the range term beside the value', () => {
  it('Scopiest on a melee champion (range 175, speed 355): +250, from 175 to 425; at 600 the window gains 250/355 s', async () => {
    const r = row(await rows(), 1115).range!;
    expect(r).toMatchObject({ supported: true, before: 175, after: 425, delta: 250, moveSpeed: 355 });
    expect(r.access!.recoveredSeconds).toBeCloseTo(250 / 355, 10);
    expect(r.access!.distance).toBe(600);
  });
  it('Scopiest held, Scopier offered: it adds to 425 (to 575), the held one is not counted again; the held range is the state summary', async () => {
    const r = await rows([1115]);
    expect(row(r, 1071).range).toMatchObject({ before: 425, after: 575, delta: 150 });
    expect(row(r, 1071).range!.access!.recoveredSeconds).toBeCloseTo(150 / 355, 10);
    expect(row(r, 2900).heldRange).toEqual({ base: 175, total: 425, names: ['Scopiest Weapons'] });
    expect(row(r, 2900).range).toBeUndefined(); // a card that adds no range gets no range line
  });
  it('a ranged champion (550): no number, said to be out of today\'s scope', async () => {
    fixture.range = 550;
    try {
      const r = row(await rows(), 1115).range!;
      expect(r.supported).toBe(false);
      expect([r.before, r.after, r.delta, r.access]).toEqual([undefined, undefined, undefined, undefined]);
    } finally { fixture.range = 175; }
  });
  it('a held card that makes him melee: his range is the engine\'s 200, and range adds to it', async () => {
    fixture.range = 550;
    try { expect(row(await rows([2901]), 1115).range).toMatchObject({ supported: true, before: 200, after: 450, delta: 250 }); } finally { fixture.range = 175; }
  });
  it('a range op left out by T051 (death) gives no range term, offered or held', async () => {
    expect(row(await rows(), 2902).range).toBeUndefined();
    expect(row(await rows([2902]), 1115).range).toMatchObject({ before: 175, after: 425 });
  });
  it('only fields are added: the row with a range term has the same other fields as one without', async () => {
    const r = await rows();
    const { range: _r, ...rest } = row(r, 1115);
    expect(Object.keys(rest).sort()).toEqual(Object.keys(row(r, 2900)).sort());
  });
});
