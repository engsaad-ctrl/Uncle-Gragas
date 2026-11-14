import { describe, expect, it, vi } from 'vitest';

// T052 through the services: one held card's partners from four fight readings of one state. G must be the offer's own value at this level,
// the level and history are settled once, the kit is rebuilt from his own (attacks A opened don't stay when A is off), a card with no live
// effect gets no made-up list, range-only cards are counted outside the fight value, and held or retired cards are never partners.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    kit: { id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] } as { id: number; damage: string; relies: string[]; traits: string[]; scales: string[] },
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
  };
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
vi.mock('../../src/ai/championKits.js', () => ({ get CHAMPION_KITS() { return [fixture.kit]; } }));
vi.mock('../../src/ai/retiredAugments.js', () => ({ RETIRED_AUGMENTS: new Set([3009]) }));
vi.mock('../../src/ai/cardMathData.js', () => {
  const card = (id: number, name: string, ops: unknown[]) => ({ id, name, status: 'computed', ops, need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [
    card(3000, 'Big', [{ op: 'mult', stat: 'ad', factor: 1.5 }]),
    card(3001, 'Edge', [{ op: 'add', stat: 'ad', value: 30 }]),
    card(3002, 'Plate', [{ op: 'add', stat: 'hp', value: 300 }]),
    card(3003, 'Hitter', [{ op: 'proc', trigger: 'attack', internal_cooldown: null, damage: { flat: 40 }, type: 'physical' }]),
    card(3004, 'Haste', [{ op: 'add', stat: 'attack_speed', value: 0.5 }]),
    card(3005, 'Reach', [{ op: 'add', stat: 'range', value: 250 }]),
    card(3006, 'Ghost', [{ op: 'proc', trigger: 'periodic', internal_cooldown: 15, damage: { flat: 500 }, type: 'magic', eligibility: 'death' }]),
    card(3009, 'Old', [{ op: 'add', stat: 'ad', value: 90 }]),
  ] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 9, unresolved: 0 } } },
    augments: [e(3000, 'Big'), e(3001, 'Edge'), e(3002, 'Plate'), e(3003, 'Hitter'), e(3004, 'Haste'), e(3005, 'Reach'), e(3006, 'Ghost'), e(3009, 'Old')] }) };
});

import { createServices, type PartnersAnswer } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const prog = (held: number[], level?: number) => ({ ...(level ? { level } : {}), acquiredLevels: Object.fromEntries(held.map((id) => [id, 3])) });
const all = (p: PartnersAnswer) => [...p.settled, ...p.open, ...p.limited];

describe('card partners from four readings', () => {
  it("G is the offer's own value at this level (cardValues' value now), for every partner listed", async () => {
    const s = services();
    const p = await s.cardPartners(99, [3000], [], 3000, undefined, prog([3000], 9));
    const rows = await s.cardValues(99, [3000], [], undefined, prog([3000], 9));
    expect(all(p).length).toBeGreaterThan(0);
    for (const r of all(p)) expect(r.gain).toBeCloseTo(rows.find((x) => x.id === r.id)!.currentValue, 12);
  });
  it('Edge (+30 AD) with Big (×1.5 AD) held: a partner (G > 0 and I > 0, the damage part above 0)', async () => {
    const p = await services().cardPartners(99, [3000], [], 3000, undefined, prog([3000], 9));
    const edge = all(p).find((r) => r.id === 3001)!;
    expect(edge.gain).toBeGreaterThan(0); expect(edge.interaction).toBeGreaterThan(0); expect(edge.parts.damage).toBeGreaterThan(0);
  });
  it('no level read: the level is settled once and said to be estimated, the same as the card values', async () => {
    const s = services();
    const p = await s.cardPartners(99, [3000], [], 3000, undefined, prog([3000]));
    const rows = await s.cardValues(99, [3000], [], undefined, prog([3000]));
    expect(p.estimatedLevel).toBe(true);
    expect(p.level).toBe(rows[0]!.level);
  });
  it('a mage held Hitter (it makes him attack): with Hitter off his kit is his own again, so Haste\'s attacks come only from Hitter', async () => {
    fixture.kit = { id: 99, damage: 'magic', relies: [], traits: [], scales: ['ap'] };
    try {
      const p = await services().cardPartners(99, [3003], [], 3003, undefined, prog([3003], 9));
      const haste = all(p).find((r) => r.id === 3004);
      expect(haste?.attacksFromFocus).toBe(true);
      // Edge's AD reaches his attacks only while Hitter makes him attack: with Hitter off and his own kit back, Edge adds nothing, so it is a partner.
      // Were the kit kept from the full state, he would still attack with Hitter off and Edge's extra effect would vanish.
      expect(all(p).find((r) => r.id === 3001)?.interaction ?? 0).toBeGreaterThan(0);
    } finally { fixture.kit = { id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }; }
  });
  it('a held card with no live effect (a death op only, T051): no list is made up, and the reason is said', async () => {
    const p = await services().cardPartners(99, [3006], [], 3006, undefined, prog([3006], 9));
    expect(p.unread).toBeDefined();
    expect(all(p)).toEqual([]);
  });
  it('a range-only card is counted outside the fight value, not listed; held and retired cards are never partners', async () => {
    const p = await services().cardPartners(99, [3000, 3001], [], 3000, undefined, prog([3000, 3001], 9));
    expect(p.coverage.rangeOnly).toBe(1);
    expect(p.coverage.noLiveEffect).toBe(1); // Ghost: a death op only
    expect(all(p).map((r) => r.id)).not.toContain(3005);
    expect(all(p).map((r) => r.id)).not.toContain(3001);
    expect(all(p).map((r) => r.id)).not.toContain(3009);
    expect(p.fights).toBe(2 + 2 * p.coverage.compared + 2 * p.coverage.notComparable);
  });
  it('the focused card must be held', async () => {
    await expect(services().cardPartners(99, [3000], [], 3001, undefined, prog([3000], 9))).rejects.toThrow('not held');
  });
});
