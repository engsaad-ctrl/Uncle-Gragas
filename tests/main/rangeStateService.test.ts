import { describe, expect, it, vi } from 'vitest';

// T061 through cardValues: the level the answer settles reaches the range reader (Kayle crossing 5 → 6 and 15 → 16), a held live melee card
// comes first, a melee op marked death does not, an unread form gives no number, the held range and the offer read the same state, and the
// fight's numbers (value, plan, certain) do not move with the display. The passive and its tooltip are Kayle's real 16.22 records.
const fixture = vi.hoisted(() => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const real = JSON.parse(readFileSync('tests/fixtures/game/range-state-16.22.json', 'utf8'));
  const num = (baseValue: number) => ({ baseValue });
  const kaylePassive = real.kayle.bin['Characters/Kayle/Spells/KaylePassiveAbility/KaylePassive'];
  const bin = (name: string) => ({
    rec: { __type: 'CharacterRecord', mCharacterName: name, mCharacterPassiveSpell: 'P', spells: [], attackRangeModifiable: num(175), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(335), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) },
    P: kaylePassive,
  });
  return { name: 'Kayle', bin, strings: real.kayle.strings as Record<string, string>, stringsMode: 'ok' as 'ok' | 'reject' | 'empty' };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 10, alias: 'Kayle', name: 'Kayle' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [] } }), loadChampionBin: async () => fixture.bin(fixture.name),
  loadTooltipStrings: async () => { if (fixture.stringsMode === 'reject') throw new Error('strings refused'); return fixture.stringsMode === 'empty' ? {} : fixture.strings; }, loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Sword', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 10, damage: 'magic', relies: ['attacks'], traits: [], scales: ['ap'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => {
  const card = (id: number, name: string, ops: unknown[]) => ({ id, name, status: 'computed', ops, need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [
    card(1115, 'Scopiest Weapons', [{ op: 'add', stat: 'range', value: 250 }]), card(1071, 'Scopier Weapons', [{ op: 'add', stat: 'range', value: 150 }]),
    card(2900, 'Power', [{ op: 'add', stat: 'ad', value: 20 }]), card(2901, 'Sword Form', [{ op: 'melee' }]),
    card(2903, 'Ghost Blade', [{ op: 'melee', eligibility: 'death' }, { op: 'add', stat: 'ad', value: 5 }]),
  ] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 5, unresolved: 0 } } },
    augments: [e(1115, 'Scopiest Weapons'), e(1071, 'Scopier Weapons'), e(2900, 'Power'), e(2901, 'Sword Form'), e(2903, 'Ghost Blade')] }) };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const rows = async (level: number, held: number[] = []) => services().cardValues(10, held, [], undefined, { level, acquiredLevels: Object.fromEntries(held.map((id) => [id, 3])) });
const row = (r: Awaited<ReturnType<typeof rows>>, id: number) => r.find((x) => x.id === id)!;

describe('the range reader through cardValues', () => {
  it('Kayle 5: melee 175 → 425 with Scopiest, read at level 5 from her base', async () => {
    expect(row(await rows(5), 1115).range).toMatchObject({ supported: true, before: 175, after: 425, delta: 250, source: 'base', level: 5 });
  });
  it('Kayle 6 and 15: ranged from her passive (525), so no number and no scenario seconds; 16 too (625)', async () => {
    for (const level of [6, 15, 16]) {
      const r = row(await rows(level), 1115).range!;
      expect(r).toMatchObject({ supported: false, reasonKind: 'ranged-at-level', source: 'passive-rank', level });
      expect([r.before, r.after, r.delta, r.access]).toEqual([undefined, undefined, undefined, undefined]);
    }
  });
  it('a held live melee card comes first at 16: 200 → 450', async () => {
    expect(row(await rows(16, [2901]), 1115).range).toMatchObject({ supported: true, before: 200, after: 450, source: 'held-melee', level: 16 });
  });
  it('a melee op marked death (T051) does not make her melee: still ranged at 16', async () => {
    expect(row(await rows(16, [2903]), 1115).range).toMatchObject({ supported: false, reasonKind: 'ranged-at-level' });
  });
  it('held Scopiest at 5: the offer adds to 425 and the held summary reads the same state; at 6 neither shows a melee number', async () => {
    const r5 = await rows(5, [1115]);
    expect(row(r5, 1071).range).toMatchObject({ before: 425, after: 575 });
    expect(row(r5, 2900).heldRange).toEqual({ base: 175, total: 425, names: ['Scopiest Weapons'] });
    const r6 = await rows(6, [1115]);
    expect(row(r6, 1071).range).toMatchObject({ supported: false, reasonKind: 'ranged-at-level' });
    expect(row(r6, 2900).heldRange).toBeUndefined();
  });
  it('a form changer (the record\'s name Jayce): no number, reason form-unread', async () => {
    fixture.name = 'Jayce';
    try { expect(row(await rows(9), 1115).range).toMatchObject({ supported: false, reasonKind: 'form-unread', level: 9 }); } finally { fixture.name = 'Kayle'; }
  });
  it('display only: value, current value, plan and certain are the same at 5 and 6 as the fight reads her base range either way', async () => {
    const strip = (r: Awaited<ReturnType<typeof rows>>) => r.map(({ range: _r, heldRange: _h, level: _l, untilLevel: _u, ...rest }) => rest);
    const five = await rows(5), six = await rows(6);
    // The level moves the fight itself (stats by level), so compare each level against the same level with the reader's input taken away.
    fixture.strings = {};
    try {
      const fiveBase = await rows(5), sixBase = await rows(6);
      expect(strip(five)).toEqual(strip(fiveBase));
      expect(strip(six)).toEqual(strip(sixBase));
    } finally { fixture.strings = JSON.parse((await import('node:fs')).readFileSync('tests/fixtures/game/range-state-16.22.json', 'utf8')).kayle.strings; }
  });
});

describe("v2 (Codex's T061 review): her passive text missing through the service", () => {
  const withStrings = async <T>(mode: 'reject' | 'empty', run: () => Promise<T>) => { fixture.stringsMode = mode; try { return await run(); } finally { fixture.stringsMode = 'ok'; } };
  it('strings refused (the service catches it as {}), Scopiest held at 6: no number, no access, no melee held summary', async () => {
    const r6 = await withStrings('reject', () => rows(6, [1115]));
    const t = row(r6, 1071).range!;
    expect(t).toMatchObject({ supported: false, reasonKind: 'range-unread', level: 6 });
    expect([t.before, t.after, t.delta, t.access]).toEqual([undefined, undefined, undefined, undefined]);
    expect(row(r6, 2900).heldRange).toBeUndefined();
  });
  it('the tooltip key missing (an empty table) at 5 and 16: unknown, not 175 → 425', async () => {
    for (const level of [5, 16]) expect(row(await withStrings('empty', () => rows(level)), 1115).range).toMatchObject({ supported: false, reasonKind: 'range-unread', level });
  });
  it('a held live melee card still makes her melee at 200 with the text missing; a death melee op does not', async () => {
    expect(row(await withStrings('reject', () => rows(16, [2901])), 1115).range).toMatchObject({ supported: true, before: 200, after: 450, source: 'held-melee' });
    expect(row(await withStrings('reject', () => rows(16, [2903])), 1115).range).toMatchObject({ supported: false, reasonKind: 'range-unread' });
  });
  it('the fight numbers do not move with the missing text (value, plan, certain of Power at 6)', async () => {
    const pick = (r: Awaited<ReturnType<typeof rows>>) => { const x = row(r, 2900); return [x.value, x.currentValue, x.certain, x.plan?.value ?? null]; };
    expect(pick(await withStrings('reject', () => rows(6)))).toEqual(pick(await rows(6)));
  });
});

it('Codex: a partial passive text cannot revive the held melee-range summary or offer numbers', async () => {
  const old = fixture.strings;
  const key = 'spell_kaylepassive_tooltip';
  fixture.strings = { [key]: old[key]!.replace(/<li\b[^>]*>[\s\S]*?<\/li\s*>/gi, (item) => item.includes('@LevelForPassiveRank1@') ? '' : item) };
  try {
    for (const level of [6, 16]) {
      const r = await rows(level, [1115]);
      const t = row(r, 1071).range!;
      expect(t).toMatchObject({ supported: false, reasonKind: 'range-unread', level });
      expect([t.before, t.after, t.delta, t.access]).toEqual([undefined, undefined, undefined, undefined]);
      expect(row(r, 2900).heldRange).toBeUndefined();
    }
  } finally { fixture.strings = old; }
});
