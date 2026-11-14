import { describe, expect, it, vi } from 'vitest';

// T050 v4 (Codex's T050 v2 and v3 reviews): twins with the same name and text merge into one entry. The Mayhem id leads it whatever the list's
// order, and every consumer reads that id: the offers shown, the values, the plan, the pick log. Numbers, tags and file data are each id's own;
// nothing is borrowed from the Arena twin. Built through the real reader (augmentDataOnly, buildAugmentTexts) from two raw mode files: cherry
// (Arena pool: 54, 58, 62, 66) and kiwi (Mayhem pool: 1054, 1058, 1062, 1066). 1058 is retired (its Arena twin 58 is not); 62 is retired (its
// Mayhem twin 1062 is not); 1066 has no numbers of its own (its Arena twin 66 has some). Both list orders are run.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    only: undefined as number[] | undefined,
    mayhemFirst: false,
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
  };
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
// The Arena ids carry other numbers, so a borrowed equation would show.
vi.mock('../../src/ai/cardMathData.js', () => {
  const ad = (id: number, value: number) => ({ id, name: `c${id}`, status: 'computed', ops: [{ op: 'add', stat: 'ad', value }], need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [ad(54, 90), ad(1054, 20), ad(58, 40), ad(1058, 30), ad(62, 70), ad(1062, 10), ad(66, 50)] };
});
vi.mock('../../src/ai/retiredAugments.js', () => ({ RETIRED_AUGMENTS: new Set([1058, 62]) }));
vi.mock('../../src/texts/augmentsLoader.js', async () => {
  const { augmentDataOnly } = await vi.importActual<typeof import('../../src/texts/augmentsLoader.js')>('../../src/texts/augmentsLoader.js');
  const { buildAugmentTexts } = await import('../../src/texts/augments.js');
  const entry = (id: number, nameTRA: string) => ({ id, augmentNameId: `A${id}`, nameTRA, augmentSmallIconPath: '', rarity: 'kGold' });
  const rec = (id: number, text: string) => ({ __type: 'AugmentData', AugmentPlatformId: id, DescriptionTra: text });
  const pairs: [number, string, string][] = [[54, 'توأم', 'one'], [58, 'ثانٍ', 'two'], [62, 'ثالث', 'three'], [66, 'رابع', 'four']];
  const records = Object.fromEntries(pairs.flatMap(([id, , text]) => [[`Aug/A${id}`, rec(id, text)], [`Aug/A${id + 1000}`, rec(id + 1000, text)]]));
  const file = (pool: number[]) => ({ ...records, '{51c6c2b4}': { __type: '{eb5adb26}', AugmentList: pool.map((id) => `Aug/A${id}`) } });
  return {
    loadAugments: async () => {
      // Arena first is the real catalogue's order for these pairs; Mayhem first is the other one. The merged entry must not depend on it.
      const all = pairs.flatMap(([id, name]) => (fixture.mayhemFirst ? [entry(id + 1000, name), entry(id, name)] : [entry(id, name), entry(id + 1000, name)]));
      const list = fixture.only ? all.filter((e) => fixture.only!.includes(e.id)) : all;
      const augments = await buildAugmentTexts({ listAr: list, listEn: list, strings: { one: 'نص', two: 'نص آخر', three: 'نص ثالث', four: 'نص رابع' },
        bins: [augmentDataOnly(file(pairs.map(([id]) => id)), 'cherry'), augmentDataOnly(file(pairs.map(([id]) => id + 1000)), 'kiwi')] });
      return { version: 'test', stale: false, membership: { from: 'pools', pools: { cherry: { ids: 4, unresolved: 0 }, kiwi: { ids: 4, unresolved: 0 } } }, augments };
    },
  };
});

import { createServices } from '../../src/main/services.js';
import { markableInMayhem, mayhemIdOf } from '../../src/texts/augments.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const ids = async (held: number[] = []) => (await services().cardValues(99, held, [], undefined, { level: 9, acquiredLevels: Object.fromEntries(held.map((id) => [id, 3])) })).map((r) => r.id).sort((x, y) => x - y);

for (const mayhemFirst of [false, true]) {
  describe(`merged twins, ${mayhemFirst ? 'Mayhem' : 'Arena'} id first in the list`, () => {
    const run = async <T>(f: () => Promise<T>) => { fixture.mayhemFirst = mayhemFirst; try { return await f(); } finally { fixture.mayhemFirst = false; } };
    it('the entry is led by the Mayhem id (1054, then 54); the pick log accepts 1054 and refuses 54', () => run(async () => {
      const all = (await services().augments()).augments;
      const twin = all.find((a) => a.ids.includes(1054))!;
      expect([twin.id, twin.ids, twin.modes, mayhemIdOf(twin)]).toEqual([1054, [1054, 54], ['arena', 'mayhem'], 1054]);
      expect([markableInMayhem(all, 1054), markableInMayhem(all, 54)]).toEqual([true, false]);
    }));
    it("the candidates are 1054 and 1062: 1058 out by its own policy, 1062 kept though 62 is retired, 1066 out (no numbers of its own; 66's not borrowed)", () => run(async () => {
      expect(await ids()).toEqual([1054, 1062]);
    }));
    it("1054's value is its own: the same as when 1054 is listed alone", () => run(async () => {
      const merged = (await services().cardValues(99, [], [], undefined, { level: 9 })).find((r) => r.id === 1054)!;
      fixture.only = [1054];
      try {
        const alone = (await services().cardValues(99, [], [], undefined, { level: 9 })).find((r) => r.id === 1054)!;
        expect(merged.value).toBeCloseTo(alone.value, 12);
        expect(merged.currentValue).toBeCloseTo(alone.currentValue, 12);
      } finally { fixture.only = undefined; }
    }));
    it('held: with 1054 held, or its Arena twin id 54, the merged entry is not offered again', () => run(async () => {
      expect(await ids([1054])).toEqual([1062]);
      expect(await ids([54])).toEqual([1062]);
    }));
    it('the offer shown is keyed by the id its value carries; the one with no numbers of its own says so', () => run(async () => {
      const s = services();
      const view = await s.overlayData({ championId: 99, mode: 'mayhem' });
      const rows = await s.cardValues(99, [], [], undefined, { level: 9 });
      const shown = view.augments.find((a) => a.ids.includes(1054))!;
      expect(shown.id).toBe(1054);
      expect(rows.some((r) => r.id === shown.id)).toBe(true);
      const noNumbers = view.augments.find((a) => a.ids.includes(1066)) as { id: number; unmeasuredReason?: string };
      expect([noNumbers.id, noNumbers.unmeasuredReason]).toEqual([1066, 'لا توجد معادلات لهذا التعزيز']);
    }));
    it('an offer on the screen gets its full plan, with no lookup error', () => run(async () => {
      const row = (await services().cardValues(99, [], [1], undefined, { level: 9 }, [1054])).find((r) => r.id === 1054)!;
      expect(row.plan).toBeDefined();
      expect(row.planError).toBeUndefined();
    }));
  });
}
