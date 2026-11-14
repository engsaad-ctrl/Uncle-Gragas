import { describe, expect, it, vi } from 'vitest';

// T065 through the services: an owned Void Immolation (223069, a map-list "starter" with no recipe) keeps its exact id and one final slot in
// mathBuild and in cardValues' plans, with or without Icathia's Fall (1361) held; never more than six final items; never bought when not owned;
// no Bami grant and no merge. Items and their stats are the real 16.22 rows (tests/fixtures/game/owned-void-16.22.json). Checked by ids.
const fixture = vi.hoisted(() => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const fx = JSON.parse(readFileSync('tests/fixtures/game/owned-void-16.22.json', 'utf8'));
  const num = (baseValue: number) => ({ baseValue });
  const bin = { rec: { __type: 'CharacterRecord', mCharacterName: 'Tank', spells: [], attackRangeModifiable: num(175), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(335), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } };
  return { fx, bin };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Tank', name: 'Tank' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => fixture.fx.shop, loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => fixture.fx.entries }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 99, damage: 'physical', relies: ['attacks'], traits: ['frontline'], scales: ['ad', 'hp'] }] }));
vi.mock('../../src/ai/cardMathData.js', async (original) => {
  const real = await original<typeof import('../../src/ai/cardMathData.js')>();
  const card = (id: number, name: string, status: string, ops: unknown[]) => ({ id, name, status, ops, need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: real.ITEM_NUMBERS, CARD_NUMBERS: [card(1361, "Icathia's Fall", 'unreadable', []), card(2900, 'Plate', 'computed', [{ op: 'add', stat: 'hp', value: 300 }])] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 2, unresolved: 0 } } }, augments: [e(1361, "Icathia's Fall"), e(2900, 'Plate')] }) };
});

import { createServices } from '../../src/main/services.js';
const VOID = 223069, BAMI = 6660, FOUR = [3075, 3065, 3143, 3110], BOOTS = 3047;
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const prog = (held: number[]) => ({ level: 11, acquiredLevels: Object.fromEntries(held.map((h) => [h, 7])) });
const build = async (owned: number[], held: number[] = []) => {
  const rows = await services().mathBuild(99, held, owned, undefined, undefined, undefined, prog(held));
  return { ids: rows.map((r) => r.item.id), owned: rows.filter((r) => r.why.includes('owned')).map((r) => r.item.id), missing: rows[0]?.missing ?? [] };
};
const count = (ids: number[], id: number) => ids.filter((x) => x === id).length;

describe('an owned Void Immolation in mathBuild', () => {
  for (const held of [[], [1361]]) {
    const tag = held.length ? 'with 1361 held' : 'without 1361';
    it(`nothing owned (${tag}): Void is never bought, no Bami appears`, async () => {
      const b = await build([], held);
      expect(b.ids).not.toContain(VOID); expect(b.ids).not.toContain(BAMI); expect(b.ids.length).toBeLessThanOrEqual(6);
    });
    it(`Void alone (${tag}): kept once by its exact id, owned, first; at most six final items`, async () => {
      const b = await build([VOID], held);
      expect(count(b.ids, VOID)).toBe(1); expect(b.owned).toEqual([VOID]); expect(b.ids[0]).toBe(VOID);
      expect(b.ids.length).toBeLessThanOrEqual(6); expect(b.ids).not.toContain(3069); expect(b.ids).not.toContain(BAMI);
    });
    it(`Void + four finished (${tag}): all five owned once, one slot left`, async () => {
      const b = await build([VOID, ...FOUR], held);
      expect(b.owned.sort()).toEqual([VOID, ...FOUR].sort()); expect(count(b.ids, VOID)).toBe(1); expect(b.ids.length).toBe(6);
    });
    it(`six owned with Void (${tag}): no purchase, the build is the inventory`, async () => {
      const b = await build([VOID, ...FOUR, BOOTS], held);
      expect(b.ids.sort()).toEqual([VOID, ...FOUR, BOOTS].sort()); expect(b.owned.sort()).toEqual(b.ids.sort());
    });
  }
  it('a repeated read gives the same build (no grant, no merge)', async () => {
    const s = services();
    const a = await s.mathBuild(99, [1361], [VOID], undefined, undefined, undefined, prog([1361]));
    const b = await s.mathBuild(99, [1361], [VOID], undefined, undefined, undefined, prog([1361]));
    expect(b.map((r) => r.item.id)).toEqual(a.map((r) => r.item.id));
  });
  it('the build says Void\'s combat effects are not counted; a build without Void does not', async () => {
    expect((await build([VOID])).missing.some((m) => m.includes('إحراق الفويد'))).toBe(true);
    expect((await build([3075])).missing.some((m) => m.includes('إحراق الفويد'))).toBe(false);
  });
});

describe('existing owned rules stay (safety)', () => {
  it('a plain owned item is kept; an owned Bami (a component) takes no slot, as before', async () => {
    expect((await build([3075])).owned).toEqual([3075]);
    const b = await build([BAMI]);
    expect(b.ids).not.toContain(BAMI); expect(b.owned).toEqual([]);
  });
  it('an owned mode copy of a sold item (223084) is held as its base (3084), as before', async () => {
    const b = await build([223084]);
    expect(b.owned).toEqual([3084]); expect(b.ids).not.toContain(223084);
  });
});

describe('cardValues plans with an owned Void', () => {
  const plans = async (owned: number[]) => (await services().cardValues(99, [], owned, undefined, prog([]), [2900])).find((r) => r.id === 2900)!;
  it('both plans and their owned lists keep Void once; the row says Void\'s effects are not counted', async () => {
    const r = await plans([VOID]);
    expect(r.plan!.baselineOwned).toEqual([VOID]); expect(r.plan!.itemsOwned).toEqual([VOID]);
    expect(count(r.plan!.baselineItems, VOID)).toBe(1); expect(count(r.plan!.items, VOID)).toBe(1);
    expect(r.plan!.items.length).toBeLessThanOrEqual(6); expect(r.plan!.baselineItems.length).toBeLessThanOrEqual(6);
    expect(r.missing ?? '').toContain('إحراق الفويد');
  });
  it('without Void nothing of it appears', async () => {
    const r = await plans([]);
    expect(r.plan!.baselineOwned).toEqual([]); expect(r.plan!.items).not.toContain(VOID); expect(r.plan!.baselineItems).not.toContain(VOID);
  });
});

// Independent Codex evidence: an owned-only final item participates in existing style limits.

describe('owned Void counts towards the existing tank-item allowance',()=>{
  const isPlainDefense=(id:number)=>!fixture.fx.shop[id]?.DataValues?.some((d:{name:string;values?:number[]})=>['FlatMagicDamageMod','FlatPhysicalDamageMod'].includes(d.name) && (d.values?.[0]??0)>0);
  it('aphp: after owned Void, no second non-AP non-boot item is purchased',async()=>{
    const b=await services().mathBuild(99,[],[VOID],undefined,'aphp',undefined,prog([]));
    expect(b.filter(r=>!r.why.includes('owned') && r.item.group!=='boots' && isPlainDefense(r.item.id)).map(r=>r.item.id)).toEqual([]);
  });
  it('fighter: after owned Void, no second pure-tank non-boot item is purchased',async()=>{
    const b=await services().mathBuild(99,[],[VOID],undefined,undefined,undefined,prog([]));
    expect(b.filter(r=>!r.why.includes('owned') && r.item.group!=='boots' && isPlainDefense(r.item.id)).map(r=>r.item.id)).toEqual([]);
  });
});
