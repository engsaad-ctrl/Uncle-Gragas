import { describe, expect, it, vi } from 'vitest';

// T007: Soul Eater through the services build. Morgana Q (a checked root) on a magic champion; 90011 is a plain second augment.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const dv = (stats: Record<string, number>) => ({ DataValues: Object.entries(stats).map(([name, v]) => ({ name, values: [v] })) });
  const Q = 'Characters/Morgana/Spells/MorganaQAbility/MorganaQ';
  return {
    shop: { 1: dv({ FlatMagicDamageMod: 100 }), 2: dv({ FlatHPPoolMod: 500 }), 3: dv({ FlatArmorMod: 60 }), 4: dv({ FlatMagicDamageMod: 60 }), 5: dv({ FlatSpellBlockMod: 60 }), 6: dv({ FlatHPPoolMod: 300 }) },
    bin: {
      rec: { __type: 'CharacterRecord', spells: [Q, 'w', 'e'], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) },
      [Q]: { mSpell: { cooldownTime: [4, 4, 4, 4, 4, 4], DataValues: [{ name: 'RootDuration', values: [2, 2, 2, 2, 2, 2] }], mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } } } },
    },
  };
});
vi.mock('../../src/texts/cdragon.js', () => ({ loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 25, alias: 'Morgana', name: 'Morgana' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => fixture.shop, loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [1, 2, 3, 4, 5, 6].map((id) => ({ id, enName: String(id), html: 'fixture item', group: 'legendary', gold: 3000 })) }));
vi.mock('../../src/ai/cardMath.js', async (original) => {
  const actual = await original<typeof import('../../src/ai/cardMath.js')>();
  return { ...actual, fight: vi.fn(actual.fight) };
});
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 25, damage: 'magic', relies: [], traits: [], scales: ['ap'] }] }));
vi.mock('../../src/ai/cardMathData.js', async (original) => {
  const actual = await original<typeof import('../../src/ai/cardMathData.js')>();
  return { SPELL_HITS: {}, ITEM_NUMBERS: [], PASSIVE_NUMBERS: [], CARD_NUMBERS: [actual.CARD_NUMBERS.find((c) => c.id === 1375)!, { id: 90011, name: 'Flat AP', status: 'computed', ops: [{ op: 'add', stat: 'ap', value: 10 }] }] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => ({ loadAugments: async () => ({ version: 'test', stale: false, augments: [1375, 90011].map((id) => ({ id, ids: [id], enName: id === 1375 ? 'Soul Eater' : String(id), rarity: 'gold', modes: ['mayhem'] })) }) }));

import { createServices } from '../../src/main/services.js';
import { fight } from '../../src/ai/cardMath.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const SOUL = 1375, OTHER = 90011, MORGANA = 25;
// The Soul Eater card every fight of one build got: its proven place, or none.
const placesSeen = async (run: () => Promise<unknown>) => {
  vi.mocked(fight).mockClear();
  await run();
  const soul = vi.mocked(fight).mock.calls.flatMap((c) => c[0].cards.filter((x) => x.id === SOUL));
  return { seen: soul.length, places: [...new Set(soul.map((x) => x.pickPlace))] };
};

describe('Soul Eater by when it was taken (T007)', () => {
  it('is the second augment only from a complete history whose levels are recorded and differ (T008)', async () => {
    const s = services();
    expect(await placesSeen(() => s.decisionAt(MORGANA, [{ id: OTHER, level: 3 }, { id: SOUL, level: 7 }], { level: 9, owned: [] }, undefined, undefined, { complete: true }))).toEqual({ seen: expect.any(Number), places: [2] });
    expect(await placesSeen(() => s.decisionAt(MORGANA, [{ id: SOUL, level: 3 }, { id: OTHER, level: 7 }], { level: 9, owned: [] }, undefined, undefined, { complete: true }))).toEqual({ seen: expect.any(Number), places: [1] });
  });

  it('has no proven place with a tie, a missing level, a final list alone, or a pick of unknown level', async () => {
    const s = services();
    const none = { seen: expect.any(Number), places: [undefined] };
    expect(await placesSeen(() => s.mathBuild(MORGANA, [OTHER, SOUL], [], undefined, undefined, undefined, { level: 9, acquiredLevels: { [OTHER]: 7, [SOUL]: 7 } }))).toEqual(none);
    expect(await placesSeen(() => s.mathBuild(MORGANA, [OTHER, SOUL], [], undefined, undefined, undefined, { level: 9, acquiredLevels: { [SOUL]: 7 } }))).toEqual(none);
    expect(await placesSeen(() => s.mathBuild(MORGANA, [OTHER, SOUL]))).toEqual(none); // the array's order is not a record of when
    expect(await placesSeen(() => s.decisionAt(MORGANA, [{ id: OTHER }, { id: SOUL, level: 7 }], { level: 9, owned: [] }))).toEqual(none);
  });

  it('gives a decision before the pick nothing from it, and leaves past decisions alone when the pick moves later', async () => {
    const s = services();
    const before = await placesSeen(() => s.decisionAt(MORGANA, [{ id: SOUL, level: 11 }], { level: 9, owned: [1] }));
    expect(before.seen).toBe(0);
    const a = await s.decisionAt(MORGANA, [{ id: SOUL, level: 11 }], { level: 9, owned: [1] });
    const b = await s.decisionAt(MORGANA, [{ id: SOUL, level: 15 }], { level: 9, owned: [1] });
    const none = await s.decisionAt(MORGANA, [], { level: 9, owned: [1] });
    expect(a.next?.item.id).toBe(none.next?.item.id);
    expect(b.next?.item.id).toBe(none.next?.item.id);
    expect(a.known).toEqual([]);
  });

  it('uses it once taken, keeps what he owns, and passes the proven place into the decision', async () => {
    const s = services();
    const after = await placesSeen(() => s.decisionAt(MORGANA, [{ id: OTHER, level: 3 }, { id: SOUL, level: 7 }], { level: 9, owned: [1] }, undefined, undefined, { complete: true }));
    expect(after.seen).toBeGreaterThan(0);
    expect(after.places).toEqual([2]);
    const d = await s.decisionAt(MORGANA, [{ id: OTHER, level: 3 }, { id: SOUL, level: 7 }], { level: 9, owned: [1] }, undefined, undefined, { complete: true });
    expect(d.known).toEqual([OTHER, SOUL]);
    expect(d.build[0]?.item.id).toBe(1);
    expect(d.build[0]?.why[0]).toBe('owned');
  });
});

describe('Soul Eater second place needs a complete history (T008)', () => {
  const placeOf = async (run: () => Promise<unknown>) => (await placesSeen(run)).places;
  it('gives no place from a partial record even with every given level known', async () => {
    expect(await placeOf(() => services().mathBuild(MORGANA, [OTHER, SOUL], [], undefined, undefined, undefined, { level: 9, acquiredLevels: { [OTHER]: 3, [SOUL]: 7 } }))).toEqual([undefined]);
  });

  it('keeps the place open when another pick shares its level, even with Soul Eater confirmed before the purchase', async () => {
    const B = 90012;
    expect(await placeOf(() => services().decisionAt(MORGANA, [{ id: OTHER, level: 3 }, { id: B, level: 7 }, { id: SOUL, level: 7 }], { level: 7, owned: [], pickedBefore: [SOUL] }, undefined, undefined, { complete: true }))).toEqual([undefined]);
  });

  it('gives the place from a complete record, and an explicit full order settles a tie', async () => {
    const B = 90012;
    expect(await placeOf(() => services().decisionAt(MORGANA, [{ id: OTHER, level: 3 }, { id: SOUL, level: 7 }], { level: 9, owned: [] }, undefined, undefined, { complete: true }))).toEqual([2]);
    const tie = [{ id: OTHER, level: 3 }, { id: B, level: 7 }, { id: SOUL, level: 7 }];
    expect(await placeOf(() => services().decisionAt(MORGANA, tie, { level: 9, owned: [] }, undefined, undefined, { complete: true, order: [OTHER, SOUL, B] }))).toEqual([2]);
    expect(await placeOf(() => services().decisionAt(MORGANA, tie, { level: 9, owned: [] }, undefined, undefined, { complete: true, order: [OTHER, B, SOUL] }))).toEqual([3]);
  });

  it('never reveals a later pick through a complete history', async () => {
    const seen = await placesSeen(() => services().decisionAt(MORGANA, [{ id: OTHER, level: 3 }, { id: SOUL, level: 11 }], { level: 9, owned: [] }, undefined, undefined, { complete: true }));
    expect(seen.seen).toBe(0);
  });
});

// T010: the same, through main's pick log and the build request main makes from it (withPickLog), not through flags set by hand.
import { createPickDesk, withPickLog } from '../../src/main/pickLog.js';
describe('Soul Eater through the F7 pick log (T010)', () => {
  const logged = async (o: { start: number | 'early'; marks: [number, number, boolean][]; declare: boolean }) => {
    let level = o.start === 'early' ? undefined : o.start;
    const desk = createPickDesk({ game: () => 1, champion: () => MORGANA, active: () => true, readLive: async () => ({ level }), knownAugment: async () => true });
    desk.observe(o.start === 'early' ? { belowThree: true } : { level: o.start }, { game: 1, championId: MORGANA });
    for (const [id, at, on] of o.marks) { level = at; await desk.mark(1, MORGANA, id, on); }
    if (o.declare) desk.declare(1, MORGANA);
    return desk;
  };
  const build = (desk: ReturnType<typeof createPickDesk>, ids: number[], owned: number[] = []) =>
    services().mathBuild(MORGANA, ids, owned, undefined, undefined, undefined, withPickLog(desk, MORGANA, ids, { level: 9 }));

  it('gives Soul Eater its second place, and so its 300, from a log the player confirmed', async () => {
    const desk = await logged({ start: 'early', marks: [[OTHER, 3, true], [SOUL, 7, true]], declare: true });
    expect((await placesSeen(() => build(desk, [OTHER, SOUL]))).places).toEqual([2]);
  });

  it('gives no place from a log that is not confirmed, started late, or was edited', async () => {
    for (const o of [
      { start: 'early' as const, marks: [[OTHER, 3, true], [SOUL, 7, true]] as [number, number, boolean][], declare: false },
      { start: 5, marks: [[OTHER, 5, true], [SOUL, 7, true]] as [number, number, boolean][], declare: true },
      { start: 'early' as const, marks: [[OTHER, 3, true], [SOUL, 7, true], [OTHER, 7, false], [OTHER, 8, true]] as [number, number, boolean][], declare: true },
    ]) expect((await placesSeen(async () => build(await logged(o), [OTHER, SOUL]))).places).toEqual([undefined]);
  });

  it('has no Soul Eater effect before it is marked, and keeps what he owns', async () => {
    const desk = await logged({ start: 'early', marks: [[OTHER, 3, true]], declare: true });
    expect((await placesSeen(() => build(desk, [OTHER], [1]))).seen).toBe(0);
    expect((await build(desk, [OTHER], [1]))[0]?.item.id).toBe(1);
  });

  it('compares an offered Soul Eater as a possibility without writing it into the log', async () => {
    const desk = await logged({ start: 'early', marks: [[OTHER, 3, true]], declare: true });
    const before = desk.get(1, MORGANA);
    await services().cardValues(MORGANA, [OTHER], [], undefined, withPickLog(desk, MORGANA, [OTHER], { level: 9 }), [SOUL]);
    expect(desk.get(1, MORGANA)).toEqual(before);
    expect(desk.progressFor(MORGANA, [OTHER, SOUL])).toEqual({}); // the offer is not a logged pick
  });
});
