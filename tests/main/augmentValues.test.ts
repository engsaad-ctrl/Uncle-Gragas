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
  { id: 90001, name: 'Flat health', status: 'computed', ops: [{ op: 'add', stat: 'hp', value: 100 }] },
  { id: 90002, name: 'Growing health', status: 'conditional', ops: [{ op: 'per_stack', stat: 'hp', value: 10, mode: 'add', per: 'takedown' }] },
  { id: 90003, name: 'Unreadable', status: 'unreadable', ops: [] },
  { id: 3086, name: 'BEES!!!', status: 'computed', ops: [] },
  { id: 1103, name: 'Bread And Butter', status: 'computed', ops: [{ op: 'add', stat: 'haste', value: 100, scope: 'chosen_ability' }] },
] }));
vi.mock('../../src/texts/augmentsLoader.js', () => ({ loadAugments: async () => ({ version: 'test', stale: false, augments: [90001, 90002, 90003, 1103, 3086].map((id) => ({ id, ids: [id], enName: String(id), rarity: 'gold', modes: ['mayhem'] })) }) }));

import { createServices } from '../../src/main/services.js';
import { enemyTeam } from '../../src/ai/itemMath.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });

describe('augment values across separate offers', () => {
  it('shows why an unreadable offer is unmeasured when the patch data is missing', async () => {
    const s = services();
    const overlay = await s.overlayData({ championId: 103, mode: 'mayhem' });
    expect(overlay.augments.find((a) => a.id === 3086)?.unmeasuredReason).toContain('بيانات BEES من ملف الإصدار غير محمّلة');
    expect(overlay.augments.find((a) => a.id === 90003)?.unmeasuredReason).toContain('لا توجد معادلات');
    expect(overlay.augments.find((a) => a.id === 90001)?.unmeasuredReason).toBeUndefined();
    expect(await s.cardValues(103, [], [], undefined, { level: 7 }, [3086])).not.toContainEqual(expect.objectContaining({ id: 3086 }));
  });
  it('evaluates the actual delayed level through the levels before the next offer', async () => {
    const rows = await services().cardValues(103, [90003], [], undefined, { level: 9, acquiredLevels: { 90003: 3 } });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ level: 9, untilLevel: 10, estimatedLevel: false, certain: false });
    expect(rows[0]!.missing).toContain('لا يملك معادلات');
  });
  it('values cards past level 18 (Superfans 21) instead of failing, marked partial, at its real level (T026)', async () => {
    const s = services();
    const note = 'فوق المستوى 18';
    for (const level of [19, 21]) {
      const rows = await s.cardValues(103, [], [], undefined, { level });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => Number.isFinite(r.value) && Number.isFinite(r.currentValue))).toBe(true);
      expect(rows[0]).toMatchObject({ level, untilLevel: level, certain: false });
      expect(rows.every((r) => r.missing?.includes(note))).toBe(true);
    }
    const at18 = await s.cardValues(103, [], [], undefined, { level: 18 });
    expect(at18.some((r) => r.missing?.includes(note))).toBe(false);
  });
  it('keeps a card taken at 19 at its own level when deciding at 21 (T026)', async () => {
    const rows = await services().cardValues(103, [90003], [], undefined, { level: 21, acquiredLevels: { 90003: 19 } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ level: 21, untilLevel: 21 });
  });
  it('counts an unreadable chosen card when estimating the next choice level', async () => {
    const rows = await services().cardValues(103, [90003], []);
    expect(rows[0]).toMatchObject({ level: 7, untilLevel: 10, estimatedLevel: true, estimatedHistory: true });
  });
  it('gives a new growth card no past stacks but gives it projected value before the following offer', async () => {
    const rows = await services().cardValues(103, [], [], undefined, { level: 7 });
    const growth = rows.find((r) => r.id === 90002)!;
    expect(growth.health).toBe(0);
    expect(growth.currentValue).toBe(0);
    expect(growth.value).toBeGreaterThan(0);
    expect(growth.missing).toContain('التكديس مقدّر');
  });
  it('searches a complete plan only for the actual offered card, preserving purchased items', async () => {
    const rows = await services().cardValues(103, [], [1], undefined, { level: 7 }, [90001]);
    const planned = rows.find((r) => r.id === 90001)!;
    expect(planned.planError).toBeUndefined();
    expect(planned.plan).toMatchObject({ level: 15 });
    expect(planned.plan!.items).toContain(1);
    expect(planned.plan!.baselineItems).toContain(1);
    expect(rows.find((r) => r.id === 90002)!.plan).toBeUndefined();
  });
  it('sends with each plan the held items its own search kept, as mathBuild mapped them (T015)', async () => {
    // A Mayhem copy id (22xxxx) of item 1: the search holds item 1, and both plans say so at their head, whatever the page had sent.
    const s = services();
    const rows = await s.cardValues(103, [], [220001], undefined, { level: 7 }, [90001]);
    const plan = rows.find((r) => r.id === 90001)!.plan!;
    expect(plan.baselineOwned).toEqual([1]);
    expect(plan.itemsOwned).toEqual([1]);
    expect(plan.baselineItems.slice(0, 1)).toEqual([1]);
    expect(plan.items.slice(0, 1)).toEqual([1]);
    const none = (await s.cardValues(103, [], [], undefined, { level: 7 }, [90001])).find((r) => r.id === 90001)!.plan!;
    expect(none).toMatchObject({ baselineOwned: [], itemsOwned: [] });
  });
  it("sends with each plan the card plan's own reasons for its items to buy, in its order, none for held items (T017)", async () => {
    const plan = (await services().cardValues(103, [], [1], undefined, { level: 7 }, [90001])).find((r) => r.id === 90001)!.plan!;
    expect(plan.itemsWhy.map((x) => x.id)).toEqual(plan.items.slice(plan.itemsOwned.length));
    expect(plan.itemsWhy.some((x) => x.id === 1)).toBe(false);
    expect(plan.itemsWhy.every((x) => x.why.length > 0 && !x.why.includes('owned'))).toBe(true);
    // Nothing held: two items to buy, so the reasons must follow the card plan's own order.
    const free = (await services().cardValues(103, [], [], undefined, { level: 7 }, [90001])).find((r) => r.id === 90001)!.plan!;
    expect(free.itemsWhy.length).toBeGreaterThanOrEqual(2);
    expect(free.itemsWhy.map((x) => x.id)).toEqual(free.items);
  });
  describe('held items under another id (T016)', () => {
    // The real case (T015): the shop holds the Mayhem copy (223089) and the base item (3089), the composed list only the base.
    const shop = fixture.shop as Record<number, unknown>;
    const proof = async (held: number[]) => {
      const plan = (await services().cardValues(103, [], held, undefined, { level: 7 }, [90001])).find((r) => r.id === 90001)!.plan!;
      return { owned: plan.baselineOwned, withCard: plan.itemsOwned, base: plan.baselineItems, items: plan.items };
    };
    const withShop = async (extra: Record<number, unknown>, run: () => Promise<void>) => {
      Object.assign(shop, extra);
      try { await run(); } finally { for (const id of Object.keys(extra)) delete shop[Number(id)]; extraList.length = 0; }
    };
    it('keeps a held Mayhem copy the shop knows, as its catalog item, and never buys it again', () => withShop({ 220001: shop[1] }, async () => {
      const p = await proof([220001]);
      expect(p.owned).toEqual([1]);
      expect(p.withCard).toEqual([1]);
      expect(p.base[0]).toBe(1);
      expect(p.base.filter((id) => id === 1)).toHaveLength(1);
      expect(p.items.filter((id) => id === 1)).toHaveLength(1);
    }));
    it('the base id alone, and the base with its copy, hold it once', () => withShop({ 220001: shop[1] }, async () => {
      expect((await proof([1])).owned).toEqual([1]);
      expect((await proof([1, 220001])).owned).toEqual([1]);
    }));
    it('an unknown id and a component take no finished slot; a finished pair of boots does', () => withShop({ 3070: { DataValues: [{ name: 'FlatMPPoolMod', values: [240] }] }, 3006: { DataValues: [{ name: 'PercentAttackSpeedMod', values: [0.25] }] } }, async () => {
      extraList.push({ id: 3006, enName: "Berserker's Greaves", html: 'fixture boots', group: 'boots', gold: 1100 });
      expect((await proof([999999])).owned).toEqual([]);
      expect((await proof([3070])).owned).toEqual([]);
      expect((await proof([3006])).owned).toEqual([3006]);
    }));
  });
  it('does not treat another offered card as already chosen', async () => {
    const s = services();
    const alone = await s.cardValues(103, [], [], undefined, { level: 11 }, [90001]);
    const alongside = await s.cardValues(103, [], [], undefined, { level: 11 }, [90001, 90002]);
    expect(alongside.find((r) => r.id === 90001)).toEqual(alone.find((r) => r.id === 90001));
  });
  it('refuses an unbounded offer search', async () => {
    await expect(services().cardValues(103, [], [], undefined, { level: 7 }, [1, 2, 3, 4])).rejects.toThrow('bad augment offer');
  });
  it('fixes a live mode copy as its finished shop item and leaves components out of full-build slots', async () => {
    const rows = await services().mathBuild(103, [], [10001, 1, 999], undefined, undefined, undefined, { level: 11 });
    expect(rows.filter((r) => r.why.includes('owned')).map((r) => r.item.id)).toEqual([1]);
    expect(rows.map((r) => r.item.id)).toEqual([1, 2]);
  });
  it('returns whole-build arithmetic reasons and retains an unreadable held card as a visible limitation', async () => {
    const rows = await services().mathBuild(103, [90003], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 90003: 3 } });
    expect(rows[0]!.why.join(' ')).toContain('أثره داخل البناء في مستوى 15 خلال 15ث');
    expect(rows[0]!.missing.join(' ')).toContain('90003');
    expect(rows[0]!.missing.join(' ')).toContain('لا يملك معادلات');
  });
  it('preserves a known empty enemy inventory instead of inventing a completed build', async () => {
    vi.mocked(enemyTeam).mockClear();
    await services().cardValues(103, [], [], { allies: [], enemies: [103], enemyItems: { 103: [] } }, { level: 7 });
    expect(vi.mocked(enemyTeam).mock.calls.at(-1)![0][0]).toMatchObject({ live: true, items: [] });
    await services().cardValues(103, [], [], { allies: [], enemies: [103] }, { level: 7 });
    const unknown = vi.mocked(enemyTeam).mock.calls.at(-1)![0][0]!;
    expect(unknown.live).toBe(false);
    expect([...(unknown.items ?? [])].sort()).toEqual([1, 2]);
  });
  it('uses the same entered champion stacks in current offer values and complete plans', async () => {
    const b = fixture.bin as Record<string, unknown>, previous = b.rec;
    b.rec = { ...(previous as object), mCharacterName: 'Nasus', spells: ['q'] };
    b.q = { __type: 'SpellObject', mSpell: { cooldownTime: [5, 5, 5, 5, 5, 5], mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }, { __type: 'BuffCounterByCoefficientCalculationPart', mCoefficient: 1 }] } } } };
    try {
      const s = services();
      const at = async (stacks: number) => (await s.cardValues(103, [], [], undefined, { level: 11 }, [90001], undefined, stacks)).find((r) => r.id === 90001)!;
      const low = await at(0), high = await at(500);
      expect(high.currentValue).not.toBeCloseTo(low.currentValue);
      expect(high.planError).toBeUndefined();
      expect(high.plan!.value).not.toBeCloseTo(low.plan!.value);
    } finally { b.rec = previous; delete b.q; }
  });
  it('evaluates offer values using the selected build role as the item search does', async () => {
    const s = services();
    const at = async (style: 'ap' | 'tank') => (await s.cardValues(103, [], [], undefined, { level: 11 }, [90001], style)).find((r) => r.id === 90001)!;
    const damage = await at('ap'), tank = await at('tank');
    expect(tank.currentValue).not.toBeCloseTo(damage.currentValue);
    expect(tank.plan!.value).not.toBeCloseTo(damage.plan!.value);
  });
  it('uses the selected ability in offer values, complete plans and held-card build explanations', async () => {
    const b = fixture.bin as Record<string, unknown>, previous = b.rec;
    b.rec = { ...(previous as object), spells: ['q'] };
    b.q = { __type: 'SpellObject', mSpell: { cooldownTime: [12, 12, 12, 12, 12, 12], mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } } } };
    try {
      const s = services();
      const unknown = (await s.cardValues(103, [], [], undefined, { level: 11 }, [1103])).find((r) => r.id === 1103)!;
      const selected = (await s.cardValues(103, [], [], undefined, { level: 11, abilityTargets: { 1103: 'Q' } }, [1103])).find((r) => r.id === 1103)!;
      expect(unknown).toMatchObject({ certain: false, currentValue: 0 });
      expect(unknown.missing).toContain('غير محددة');
      expect(unknown.plan!.missing.join(' ')).toContain('غير محددة');
      expect(selected.missing).toBeNull();
      expect(selected.certain).toBe(true);
      expect(selected.currentValue).toBeGreaterThan(unknown.currentValue);
      expect(selected.plan!.value).toBeGreaterThan(unknown.plan!.value);
      expect(selected.plan!.missing).toEqual([]);
      const unknownBuild = await s.mathBuild(103, [1103], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 1103: 7 } });
      const selectedBuild = await s.mathBuild(103, [1103], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 1103: 7 }, abilityTargets: { 1103: 'Q' } });
      expect(unknownBuild[0]!.missing.join(' ')).toContain('غير محددة');
      expect(selectedBuild[0]!.missing).toEqual(['رتب المهارات توزيع قانوني متساوٍ للنقاط، لا قراءة من المباراة']);
      // Ranks read from the live game (set by the main process) replace the even allocation and its note.
      const readBuild = await s.mathBuild(103, [1103], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 1103: 7 }, abilityTargets: { 1103: 'Q' }, abilityRanks: { Q: 5, W: 1, E: 1, R: 2 } });
      expect('missing' in readBuild[0]! ? readBuild[0].missing : null).toEqual([]);
    } finally { b.rec = previous; delete b.q; }
  });
  it('re-evaluates available build roles when targeted haste changes AP scaling', async () => {
    const b = fixture.bin as Record<string, unknown>, previous = b.rec;
    b.rec = { ...(previous as object), spells: ['q'] };
    b.q = { __type: 'SpellObject', mSpell: { cooldownTime: [12, 12, 12, 12, 12, 12], mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'StatByCoefficientCalculationPart', mStat: 0, mCoefficient: 1.4 }] } } } };
    try {
      const s = services();
      expect(await s.buildStyles(103, [1103])).not.toContain('ap');
      expect(await s.buildStyles(103, [1103], { abilityTargets: { 1103: 'Q' } })).toContain('ap');
    } finally { b.rec = previous; delete b.q; }
  });
});
