import { describe, expect, it, vi } from 'vitest';

// T051 through the services, on the real card data and tags: Clown College's live Backstab counts (open: from behind), its Deceive attack does not;
// Mad Scientist's unknown state gives 0 and stays open, held or offered; Shark Bait's death op gives 0 and says why; Dive Bomber has no op.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return { bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } } };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Fighter', name: 'Fighter' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [] } }), loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Sword', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 4, unresolved: 0 } } },
    augments: [e(1310, 'Clown College'), e(1053, 'Mad Scientist'), e(2032, 'Shark Bait'), e(1025, 'Dive Bomber')] }) };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const rows = async (held: number[] = []) => services().cardValues(99, held, [], undefined, { level: 9, acquiredLevels: Object.fromEntries(held.map((id) => [id, 3])) });

describe('death and unknown parts in the offers', () => {
  it("Clown College: its live Backstab gives a value, open on 'from behind', never certain", async () => {
    const r = (await rows()).find((x) => x.id === 1310)!;
    expect(r.value).toBeGreaterThan(0);
    expect(r.certain).toBe(false);
    expect(r.open.join(' ')).toContain('behind');
    expect(r.open.join(' ')).toContain('Deceive');
  });
  it('Mad Scientist: with no state set in F7 (T150) nothing runs, so 0, and the row says the state is unset, not a settled 0', async () => {
    const r = (await rows()).find((x) => x.id === 1053)!;
    expect(r.value).toBeCloseTo(0, 12);
    expect(r.missing).toContain('غير محددة في F7');
  });
  it('Shark Bait: its death op does not run, so 0, and the note says it is on his death', async () => {
    const r = (await rows()).find((x) => x.id === 2032)!;
    expect(r.value).toBeCloseTo(0, 12);
    expect(r.missing).toContain('عند موته');
  });
  it('Dive Bomber has no op, so it is not a candidate', async () => {
    expect((await rows()).some((x) => x.id === 1025)).toBe(false);
  });
  it('Mad Scientist held: its unknown state is not chosen in secret, so Clown College is valued as with nothing held', async () => {
    const plain = (await rows()).find((x) => x.id === 1310)!;
    const held = (await rows([1053])).find((x) => x.id === 1310)!;
    expect(held.value).toBeCloseTo(plain.value, 12);
  });
});
