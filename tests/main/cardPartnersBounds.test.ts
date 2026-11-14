import { describe, expect, it, vi } from 'vitest';

// T052 v2 (Codex's T052 review): a pair is classed from the whole state, not from B alone. A partial or partly unknown focus, a condition on the
// focus, another held card with an unknown part, or a partial B puts the pair outside 'settled'. Only rows a fight part explains are listed; the
// five parts come back; one pool is counted once (a card with no numbers stays in it); and turning A off keeps every pick place (if_pick).
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
vi.mock('../../src/ai/augmentTags.js', () => ({ AUGMENT_TAGS: { 4003: { tags: ['condition:attack the target from behind'], sure: true } } }));
vi.mock('../../src/ai/cardMathData.js', () => {
  const card = (id: number, name: string, ops: unknown[], status = 'computed') => ({ id, name, status, ops, need: { class: 'always', items: null, ability_kind: null } });
  const big = { op: 'mult', stat: 'ad', factor: 1.5 };
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [
    card(4000, 'Big', [big]), card(4001, 'BigPartial', [big], 'partial'),
    card(4002, 'BigMixed', [big, { op: 'mult', stat: 'hp', factor: 1.2, eligibility: 'unknown', eligibilityWhy: 'state not read' }]),
    card(4003, 'BigBehind', [big]),
    card(4004, 'Mystery', [{ op: 'add', stat: 'hp', value: 10 }, { op: 'add', stat: 'armor', value: 10, eligibility: 'unknown' }]),
    card(4010, 'Edge', [{ op: 'add', stat: 'ad', value: 30 }]), card(4011, 'EdgePartial', [{ op: 'add', stat: 'ad', value: 30 }], 'partial'),
    card(4014, 'Second', [{ op: 'add', stat: 'ad', value: 50, if_pick: 2 }]), card(4015, 'Plain', [{ op: 'add', stat: 'ad', value: 50 }]),
  ] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, membership: { from: 'pools', pools: { kiwi: { ids: 10, unresolved: 0 } } },
    augments: [e(4000, 'Big'), e(4001, 'BigPartial'), e(4002, 'BigMixed'), e(4003, 'BigBehind'), e(4004, 'Mystery'), e(4010, 'Edge'), e(4011, 'EdgePartial'), e(4014, 'Second'), e(4015, 'Plain'), e(4020, 'NoRow')] }) };
});

import { createServices, type PartnersAnswer } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const at9 = (held: number[]) => ({ level: 9, acquiredLevels: Object.fromEntries(held.map((id) => [id, 3])) });
const partners = (held: number[], focus: number, prog: Parameters<ReturnType<typeof services>['cardPartners']>[5] = at9(held)) => services().cardPartners(99, held, [], focus, undefined, prog);
const rowOf = (p: PartnersAnswer, id: number) => [...p.settled, ...p.open, ...p.limited].find((r) => r.id === id);
// Every listed row is limited, none settled or open (the strongest partners vary; what matters is that no pair of this state is settled).
const onlyLimited = (p: PartnersAnswer, reason: string) => {
  expect([p.settled.length, p.open.length]).toEqual([0, 0]);
  expect(p.limited.length).toBeGreaterThan(0);
  for (const r of p.limited) expect(r.limits.join(' ')).toContain(reason);
};

describe('the class of a pair, from the whole state', () => {
  it('a clean state: Edge is settled', async () => {
    expect(rowOf(await partners([4000], 4000), 4010)?.group).toBe('settled');
  });
  it('a partial focus: every pair limited, and the reason says so', async () => {
    onlyLimited(await partners([4001], 4001), 'BigPartial');
  });
  it('a focus with an unknown part next to a live one: every pair limited', async () => {
    onlyLimited(await partners([4002], 4002), 'BigMixed');
  });
  it('a condition on the focus (from behind): open, with the condition', async () => {
    const r = rowOf(await partners([4003], 4003), 4010)!;
    expect(r.group).toBe('open'); expect(r.conditions.join(' ')).toContain('behind');
  });
  it('another held card with an unknown part: every pair limited, though the focus is clean', async () => {
    onlyLimited(await partners([4000, 4004], 4000), 'Mystery');
  });
  it('a partial B: limited', async () => {
    expect(rowOf(await partners([4000], 4000), 4011)?.group).toBe('limited');
  });
  it('no level read: the estimate is a state limit, so nothing is settled', async () => {
    const p = await partners([4000], 4000, { acquiredLevels: { 4000: 3 } });
    expect(p.stateLimits.join(' ')).toContain('المستوى مقدّر');
    expect(p.settled).toEqual([]);
  });
});

describe('reasons, parts and coverage', () => {
  it('every listed row has a fight part that explains it; the five parts come back', async () => {
    const p = await partners([4000], 4000);
    const listed = [...p.settled, ...p.open, ...p.limited];
    expect(listed.length).toBeGreaterThan(0);
    for (const r of listed) {
      expect(Object.keys(r.parts).sort()).toEqual(['abilityHealing', 'damage', 'effectiveHp', 'healedHp', 'healingDenied']);
      expect(r.explained).toBe(true);
      expect(Object.values(r.parts).some((x) => x > 1e-6)).toBe(true);
    }
  });
  it('one pool, counted once: pool = no numbers + not applicable + no live effect + range only + not comparable + compared; compared = the three classes', async () => {
    const c = (await partners([4000], 4000)).coverage;
    expect(c.pool).toBe(9); // ten listed, one held
    expect(c.noNumbers).toBe(1); // NoRow stays in the pool
    expect(c.pool).toBe(c.noNumbers + c.notApplicable + c.noLiveEffect + c.rangeOnly + c.notComparable + c.compared);
    expect(c.compared).toBe(c.settled + c.open + c.limited);
  });
  it('turning A off keeps every pick place: a card worth +50 AD only as the second pick behaves as a plain +50 AD card in second place', async () => {
    const order = (second: number) => ({ level: 9, historyComplete: true, pickOrder: [4000, second], acquiredLevels: { 4000: 3, [second]: 5 } });
    const withIfPick = rowOf(await partners([4000, 4014], 4000, order(4014)), 4010)!;
    const withPlain = rowOf(await partners([4000, 4015], 4000, order(4015)), 4010)!;
    expect(withIfPick.interaction).toBeCloseTo(withPlain.interaction, 9);
    expect(withIfPick.gain).toBeCloseTo(withPlain.gain, 12);
  });
});
