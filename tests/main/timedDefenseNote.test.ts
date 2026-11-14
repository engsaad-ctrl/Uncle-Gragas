import { describe, expect, it, vi } from 'vitest';

// T049, Codex's decision (a): a timed armor/MR gain the engine leaves out (not marked self) stays in each value's missing and turns certain off
// while the item that has it is held. It is a disclosure, not a value change: the numbers are the same with the note. Without that item, the
// value is certain again. (The item here is a stand-in for Terminus 3302: on attack, +armor for 5 s, up to 3.)
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
  };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Fighter', name: 'Fighter' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 3302: { DataValues: [] } }), loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 3302, enName: 'Terminus', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, PASSIVE_NUMBERS: [],
  ITEM_NUMBERS: [{ id: 3302, ops: [{ op: 'timed', trigger: 'attack', stat: 'armor', value: 6, mode: 'add', duration: 5, stacks_max: 3, refresh: true, decays: false, internal_cooldown: null }] }],
  CARD_NUMBERS: [{ id: 2900, name: 'Power', status: 'computed', ops: [{ op: 'add', stat: 'ad', value: 20 }], need: { class: 'always', items: null, ability_kind: null } }],
}));
vi.mock('../../src/texts/augmentsLoader.js', () => ({
  loadAugments: async () => ({ version: 'test', stale: false, augments: [{ id: 2900, ids: [2900], name: 'Power', enName: 'Power', html: 'x', described: true, rarity: 'silver', modes: ['mayhem'], iconUrl: '' }] }),
}));

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const NOTE = 'بعض زيادات الدرع أو مقاومة السحر المؤقتة غير ممثلة';

describe('the timed armor/MR limit, said where it applies', () => {
  it('with the item held: the note is in missing and the value is not certain', async () => {
    const row = (await services().cardValues(99, [], [3302], undefined, { level: 9 })).find((r) => r.id === 2900)!;
    expect(row.missing).toContain(NOTE);
    expect(row.certain).toBe(false);
  });
  it('without it: no note, and the same card is certain', async () => {
    const row = (await services().cardValues(99, [], [], undefined, { level: 9 })).find((r) => r.id === 2900)!;
    expect(row.missing ?? '').not.toContain(NOTE);
    expect(row.certain).toBe(true);
  });
});
