import { describe, expect, it, vi } from 'vitest';

// T064 follow-up (Codex's T064 review): the unread reason for a focused card is told apart in four paths. No row, or a row with no ops at all
// (1361 Icathia's Fall), has no equations; a row whose ops are all unknown (T051) keeps the 'do not act' reason; a range-only card keeps the T053
// range reason. None of them runs a fight.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return { bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } } };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Hero', name: 'Hero' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [] } }), loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Sword', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/retiredAugments.js', () => ({ RETIRED_AUGMENTS: new Set() }));
vi.mock('../../src/ai/augmentTags.js', () => ({ AUGMENT_TAGS: { 4003: { tags: ['condition:attack the target from behind'], sure: true } } }));vi.mock('../../src/ai/cardMathData.js', () => {
  const card = (id: number, name: string, ops: unknown[], status = 'computed') => ({ id, name, status, ops, need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [
    card(5001, 'EmptyOps', [], 'unreadable'),
    card(5002, 'UnknownOnly', [{ op: 'add', stat: 'hp', value: 10, eligibility: 'unknown', eligibilityWhy: 'state not read' }]),
    card(5003, 'Reach', [{ op: 'add', stat: 'range', value: 250 }]),
    card(5010, 'Edge', [{ op: 'add', stat: 'ad', value: 30 }]),
  ] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 5, unresolved: 0 } } },
    augments: [e(5001, 'EmptyOps'), e(5002, 'UnknownOnly'), e(5003, 'Reach'), e(5004, 'NoRow'), e(5010, 'Edge')] }) };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const focus = (id: number) => services().cardPartners(99, [id], [], id, undefined, { level: 9, acquiredLevels: { [id]: 3 } });
const NO_EQUATIONS = 'لا معادلات لهذه البطاقة';
const DO_NOT_ACT = 'أجزاؤها المحسوبة لا تعمل في القتال (عند الموت أو حالتها غير معروفة)';

describe('the unread reason of a focused card, four paths', () => {
  it('no row at all: no equations, no fight', async () => {
    const p = await focus(5004);
    expect([p.unread, p.fights]).toEqual([NO_EQUATIONS, 0]);
  });
  it('a row with ops = [] (as 1361): no equations, not the death/unknown reason', async () => {
    const p = await focus(5001);
    expect([p.unread, p.fights]).toEqual([NO_EQUATIONS, 0]);
  });
  it('a row whose ops are all unknown (T051): the do-not-act reason stays', async () => {
    const p = await focus(5002);
    expect([p.unread, p.fights]).toEqual([DO_NOT_ACT, 0]);
  });
  it('a range-only row (T053): the range reason stays', async () => {
    const p = await focus(5003);
    expect(p.unread).toContain('مدى هجوم فقط');
    expect(p.fights).toBe(0);
  });
  it('a card with a live op is read (no unread, fights run)', async () => {
    const p = await focus(5010);
    expect(p.unread).toBeUndefined();
    expect(p.fights).toBeGreaterThan(0);
  });
});
