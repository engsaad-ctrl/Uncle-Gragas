import { describe, expect, it, vi } from 'vitest';

// T048: a card on attacks or on-hit makes a champion whose kit doesn't attack in the fight attack (kitWithCards). The value then counts attacks
// the engine assumes; cardValues says so (attacksAssumed) with the attacks at the stage's first level from the two fights it already ran.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    kit: { id: 99, damage: 'magic', relies: [] as string[], traits: [], scales: ['ap'] },
    passive: [] as { id: number; ops: unknown[] }[],
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(550), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(330), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
  };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Mage', name: 'Mage' }, { id: 41, alias: 'Paced', name: 'Paced' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [{ name: 'FlatMagicDamageMod', values: [80] }] } }), loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Rod', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ get CHAMPION_KITS() { return [fixture.kit]; } }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, get PASSIVE_NUMBERS() { return fixture.passive; }, ITEM_NUMBERS: [],
  CARD_NUMBERS: [
    { id: 1181, name: 'Hitter', status: 'computed', ops: [{ op: 'proc', trigger: 'attack', internal_cooldown: null, damage: { hp: 0.035 }, type: 'physical' }], need: { class: 'always', items: null, ability_kind: null } },
    { id: 2000, name: 'Power', status: 'computed', ops: [{ op: 'add', stat: 'ap', value: 50 }], need: { class: 'always', items: null, ability_kind: null } },
    { id: 2900, name: 'Speed', status: 'computed', ops: [{ op: 'add', stat: 'attack_speed', value: 1 }], need: { class: 'always', items: null, ability_kind: null } }, // 2001 is a retired id (Heads Up Cupcake!), dropped from the rows
  ],
}));
vi.mock('../../src/texts/augmentsLoader.js', () => ({
  loadAugments: async () => ({ version: 'test', stale: false, augments: [
    { id: 1181, ids: [1181], name: 'Hitter', enName: 'Hitter', html: 'x', described: true, rarity: 'silver', modes: ['mayhem'], iconUrl: '' },
    { id: 2000, ids: [2000], name: 'Power', enName: 'Power', html: 'x', described: true, rarity: 'silver', modes: ['mayhem'], iconUrl: '' },
    { id: 2900, ids: [2900], name: 'Speed', enName: 'Speed', html: 'x', described: true, rarity: 'silver', modes: ['mayhem'], iconUrl: '' },
  ] }),
}));

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });

describe('the attack assumption, sent with the value', () => {
  it('a mage who does not attack: an on-attack card says it adds assumed attacks, with the two counts at the stage level', async () => {
    fixture.kit = { id: 99, damage: 'magic', relies: [], traits: [], scales: ['ap'] };
    const rows = await services().cardValues(99, [], [], undefined, { level: 9 });
    const hitter = rows.find((r) => r.id === 1181)!;
    expect(hitter.attacksAssumed).toMatchObject({ by: 'offered', names: ['Hitter'], level: 9, seconds: 15, before: 0 });
    expect(hitter.attacksAssumed!.after).toBeGreaterThan(0);
    expect(rows.find((r) => r.id === 2000)!.attacksAssumed).toBeUndefined(); // a card that does not change the pattern
  });
  it('a champion who attacks already (as Ezreal): no assumption, the attacks are his own', async () => {
    fixture.kit = { id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] };
    const rows = await services().cardValues(99, [], [], undefined, { level: 9 });
    expect(rows.find((r) => r.id === 1181)!.attacksAssumed).toBeUndefined();
    fixture.kit = { id: 99, damage: 'magic', relies: [], traits: [], scales: ['ap'] };
  });
  it('the on-attack card held, an offer that does not change attack speed: before and after this card are the same count, and the held card is named', async () => {
    const rows = await services().cardValues(99, [1181], [], undefined, { level: 9, acquiredLevels: { 1181: 3 } });
    const power = rows.find((r) => r.id === 2000)!.attacksAssumed!;
    expect(power).toMatchObject({ by: 'held', names: ['Hitter'], level: 9 });
    expect(power.before).toBeGreaterThan(0);
    expect(power.after).toBe(power.before);
  });
  it('the on-attack card held, an offer of +100% attack speed: after counts the attacks with it, more than before (T048 v2)', async () => {
    const rows = await services().cardValues(99, [1181], [], undefined, { level: 9, acquiredLevels: { 1181: 3 } });
    const speed = rows.find((r) => r.id === 2900)!.attacksAssumed!;
    expect(speed).toMatchObject({ by: 'held', names: ['Hitter'] });
    expect(speed.after).toBeGreaterThan(speed.before!);
  });
  it('the note goes when the state changes: the held card gone, no value says it', async () => {
    const held = await services().cardValues(99, [1181], [], undefined, { level: 9, acquiredLevels: { 1181: 3 } });
    expect(held.find((r) => r.id === 2000)!.attacksAssumed).toBeDefined();
    const none = await services().cardValues(99, [], [], undefined, { level: 9 });
    expect(none.find((r) => r.id === 2000)!.attacksAssumed).toBeUndefined();
    expect(none.find((r) => r.id === 2900)!.attacksAssumed).toBeUndefined();
  });
  it('a mage whose passive already attacks (as Lux): the note counts his own passive attacks before, more after', async () => {
    fixture.passive = [{ id: 99, ops: [{ op: 'proc', trigger: 'attack', internal_cooldown: null, damage: { ap: 0.1 }, type: 'magic' }] }];
    try {
      const hitter = (await services().cardValues(99, [], [], undefined, { level: 9 })).find((r) => r.id === 1181)!.attacksAssumed!;
      expect(hitter.by).toBe('offered');
      expect(hitter.before).toBeGreaterThan(0);
      expect(hitter.after).toBeGreaterThan(hitter.before!);
    } finally { fixture.passive = []; }
  });
  it('a kit with its own attack pace (ATTACK_PACE, id 41): no note, even with an on-attack card offered or held', async () => {
    fixture.kit = { id: 41, damage: 'magic', relies: [], traits: [], scales: ['ap'] };
    try {
      expect((await services().cardValues(41, [], [], undefined, { level: 9 })).find((r) => r.id === 1181)!.attacksAssumed).toBeUndefined();
      expect((await services().cardValues(41, [1181], [], undefined, { level: 9, acquiredLevels: { 1181: 3 } })).find((r) => r.id === 2000)!.attacksAssumed).toBeUndefined();
    } finally { fixture.kit = { id: 99, damage: 'magic', relies: [], traits: [], scales: ['ap'] }; }
  });
  it('a shape check only: a row with the note has the same other fields as one without (the numbers are compared on real data, T048/t048-same-numbers.mjs)', async () => {
    const rows = await services().cardValues(99, [], [], undefined, { level: 9 });
    const { attacksAssumed: _note, ...rest } = rows.find((r) => r.id === 1181)!;
    expect(Object.keys(rest).sort()).toEqual(Object.keys(rows.find((r) => r.id === 2000)!).sort());
  });
});
