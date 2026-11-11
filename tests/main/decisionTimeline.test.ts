import { describe, expect, it, vi } from 'vitest';

// T004: purchase decisions with only the augments known at that point, through the services build.
// Seven items, so a projection reaches the purchases at 12, 15, 17 and 18; item 3 (AP) is worth something only with the AP-on-attacks card.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const dv = (stats: Record<string, number>) => ({ DataValues: Object.entries(stats).map(([name, v]) => ({ name, values: [v] })) });
  return {
    shop: { 1: dv({ FlatPhysicalDamageMod: 100 }), 2: dv({ FlatHPPoolMod: 500 }), 3: dv({ FlatMagicDamageMod: 200 }), 4: dv({ FlatPhysicalDamageMod: 60 }), 5: dv({ FlatPhysicalDamageMod: 40 }), 6: dv({ FlatArmorMod: 60 }), 7: dv({ FlatSpellBlockMod: 60 }) },
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) } },
  };
});
vi.mock('../../src/texts/cdragon.js', () => ({ loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 103, alias: 'Ahri', name: 'Ahri' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => fixture.shop, loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, enName: String(id), html: 'fixture item', group: 'legendary', gold: 3000 })) }));
vi.mock('../../src/ai/cardMath.js', async (original) => {
  const actual = await original<typeof import('../../src/ai/cardMath.js')>();
  return { ...actual, fight: vi.fn(actual.fight) };
});
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 103, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, ITEM_NUMBERS: [], PASSIVE_NUMBERS: [], CARD_NUMBERS: [
  { id: 90010, name: 'AP on attacks', status: 'computed', ops: [{ op: 'proc', trigger: 'on_hit', damage: { ap: 2 }, type: 'magic' }] },
  { id: 90011, name: 'Flat AD', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 10 }] },
] }));
vi.mock('../../src/texts/augmentsLoader.js', () => ({ loadAugments: async () => ({ version: 'test', stale: false, augments: [90010, 90011].map((id) => ({ id, ids: [id], enName: String(id), rarity: 'gold', modes: ['mayhem'] })) }) }));

import { createServices } from '../../src/main/services.js';
import { fight } from '../../src/ai/cardMath.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const AP = 90010, AD = 90011;
const items = (t: { steps: { item: { id: number } }[] }) => t.steps.map((x) => x.item.id);

describe('purchase decisions by what is known then', () => {
  it('leaves a pick with no level out and says the decision is not settled', async () => {
    const d = await services().decisionAt(103, [{ id: AP }], { level: 12, owned: [] });
    expect(d.settled).toBe(false);
    expect(d.unsure).toEqual([AP]);
    expect(d.known).toEqual([]);
    expect(d.notes[0]).toContain('مجهول');
  });

  it('keeps purchases before a pick the same whatever comes later, and uses the pick after it', async () => {
    const s = services();
    const from = { level: 5, owned: [] };
    const none = await s.projectBuild(103, [], from), at11 = await s.projectBuild(103, [{ id: AP, level: 11 }], from), at15 = await s.projectBuild(103, [{ id: AP, level: 15 }], from);
    expect(none.steps.length).toBe(5); // five non-boot slots: the fixture sells no boots
    expect(at11.steps.filter((x) => x.level < 11).map((x) => x.item.id)).toEqual(none.steps.filter((x) => x.level < 11).map((x) => x.item.id));
    expect(at15.steps.filter((x) => x.level < 11).map((x) => x.item.id)).toEqual(at11.steps.filter((x) => x.level < 11).map((x) => x.item.id));
    expect(items(none)).not.toContain(3); // AP is worth nothing to him without the card
    const after = at11.steps.find((x) => x.item.id === 3);
    expect(after).toBeDefined(); // with it, the AP item comes after level 11
    expect(after!.level).toBeGreaterThan(11);
    expect(after!.known).toEqual([AP]);
    expect(at11.steps.filter((x) => x.level < 11).every((x) => x.known.length === 0)).toBe(true);
  });

  it('starts at the level he is at with what he owns, the augment he took at 11 known, and never goes back to an earlier level', async () => {
    const t = await services().projectBuild(103, [{ id: AP, level: 11 }], { level: 15, owned: [1] });
    expect(t.steps[0]).toMatchObject({ level: 15, estimated: false, known: [AP] });
    expect(t.steps.every((x, i) => i === 0 || (x.estimated && x.level >= t.steps[i - 1]!.level))).toBe(true);
    expect(items(t)).not.toContain(1);
    expect(t.notes[0]).toContain('تقديري');
  });

  it('takes a pick at the purchase level only when the order of the two is known', async () => {
    const s = services();
    const unknownOrder = await s.decisionAt(103, [{ id: AP, level: 12 }], { level: 12, owned: [1] });
    expect(unknownOrder).toMatchObject({ settled: false, unsure: [AP], known: [] });
    const pickedFirst = await s.decisionAt(103, [{ id: AP, level: 12 }], { level: 12, owned: [1], pickedBefore: [AP] });
    expect(pickedFirst).toMatchObject({ settled: true, unsure: [], known: [AP] });
    expect(pickedFirst.next?.item.id).toBe(3);
    expect(unknownOrder.next?.item.id).not.toBe(3);
  });

  // T005: what was settled at the start stays settled for the purchases after it at the same level (T004-review P1).
  it('keeps a pick confirmed before the start known for every later purchase at that level', async () => {
    const t = await services().projectBuild(103, [{ id: AP, level: 15 }], { level: 15, owned: [1], pickedBefore: [AP] });
    const at15 = t.steps.filter((x) => x.level === 15);
    expect(at15.length).toBeGreaterThanOrEqual(2);
    expect(at15.every((x) => x.known.includes(AP) && x.settled)).toBe(true);
  });

  it('leaves the same pick unsettled at that level when its order was never confirmed, and known only once the level passes it', async () => {
    const t = await services().projectBuild(103, [{ id: AP, level: 15 }], { level: 15, owned: [1] });
    const at15 = t.steps.filter((x) => x.level === 15), later = t.steps.filter((x) => x.level > 15);
    expect(at15.length).toBeGreaterThanOrEqual(2);
    expect(at15.every((x) => !x.known.includes(AP) && !x.settled)).toBe(true);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((x) => x.known.includes(AP))).toBe(true);
  });

  it('never lets a confirmation reveal a pick from a later level early', async () => {
    const t = await services().projectBuild(103, [{ id: AP, level: 17 }], { level: 15, owned: [1], pickedBefore: [AP] });
    expect(t.steps.filter((x) => x.level < 17).every((x) => !x.known.includes(AP))).toBe(true);
  });

  it('keeps what he holds in the decision itself, first and marked owned', async () => {
    const d = await services().decisionAt(103, [{ id: AD, level: 3 }], { level: 9, owned: [4] });
    expect(d.build[0]?.item.id).toBe(4);
    expect(d.build[0]?.why[0]).toBe('owned');
    expect(d.next?.item.id).not.toBe(4);
  });

  it('never values a decision now at a level below his own (the live build path)', async () => {
    vi.mocked(fight).mockClear();
    await services().mathBuild(103, [AP], [1], undefined, undefined, undefined, { level: 15, acquiredLevels: { [AP]: 11 } });
    const levels = vi.mocked(fight).mock.calls.map((c) => c[0].level);
    expect(levels.length).toBeGreaterThan(0);
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(15);
  });
});
