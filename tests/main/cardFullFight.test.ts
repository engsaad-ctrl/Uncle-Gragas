import { describe, expect, it, vi } from 'vitest';

// T052 through the services: one held card's partners from four fight readings of one state. G must be the offer's own value at this level,
// the level and history are settled once, the kit is rebuilt from his own (attacks A opened don't stay when A is off), a card with no live
// effect gets no made-up list, range-only cards are counted outside the fight value, and held or retired cards are never partners.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    planWindows: [] as (number | undefined)[],
    kit: { id: 99, damage: 'physical', relies: ['attacks'], traits: ['burst'], scales: ['ad'] } as { id: number; damage: string; relies: string[]; traits: string[]; scales: string[] },
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
  };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Hero', name: 'Hero' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [{name:'FlatPhysicalDamageMod',values:[30]}] } }), loadChampionBin: async () => fixture.bin,
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
    card(3003, 'Late AD', [{ op: 'proc', trigger: 'periodic', internal_cooldown: 15, damage: { ad: 1 }, type: 'physical', needs: 'after 4 seconds of champion combat' }]),
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


vi.mock('../../src/ai/augmentChoice.js', async (original) => { const actual = await original<typeof import('../../src/ai/augmentChoice.js')>(); return { ...actual, compareAugmentPlan: (args: Parameters<typeof actual.compareAugmentPlan>[0]) => { fixture.planWindows.push(args.place.window); return actual.compareAugmentPlan(args); } }; });

it('a burst champion values a card landing after three seconds over the full fight', async () => { const rows=await services().cardValues(99,[3000],[],undefined,prog([3000],9)); expect(rows.find(r=>r.id===3003)!.currentValue).toBeGreaterThan(0); });
it('partners and offers agree on the same full-fight G, including a late card', async () => { const s=services();const p=await s.cardPartners(99,[3000],[],3000,undefined,prog([3000],9));const rows=await s.cardValues(99,[3000],[],undefined,prog([3000],9));expect(all(p).find(r=>r.id===3003)).toBeDefined();for(const r of all(p))expect(r.gain).toBeCloseTo(rows.find(v=>v.id===r.id)!.currentValue,12); });
it('a card build plan keeps the item burst window', async () => { fixture.planWindows.length=0;await services().cardValues(99,[3000],[],undefined,prog([3000],9),[3001]);expect(fixture.planWindows.length).toBeGreaterThan(0);expect(fixture.planWindows.every(w=>w===3)).toBe(true); });
