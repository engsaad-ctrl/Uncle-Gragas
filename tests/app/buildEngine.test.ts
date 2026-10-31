import { describe, expect, it } from 'vitest';
import { AUGMENT_ITEM_WEIGHT, buildFor, synergyAcrossChampions, type EngineInput } from '../../src/app/buildEngine.js';
import { AUGMENT_ITEMS } from '../../src/app/augmentItemsData.js';

describe('synergy across champions', () => {
  const [a, b] = Object.keys(AUGMENT_ITEMS).map(Number);
  const item = Number(Object.keys(AUGMENT_ITEMS[a]).find((i) => AUGMENT_ITEMS[b][+i] !== undefined));
  const lift = (points: number) => (AUGMENT_ITEM_WEIGHT * points) / 3;
  it('adds up the chosen augments, and counts an augment with copies once', () => {
    expect(synergyAcrossChampions([[a]], [item]).get(item)).toBeCloseTo(lift(AUGMENT_ITEMS[a][item]));
    expect(synergyAcrossChampions([[a], [b]], [item]).get(item)).toBeCloseTo(lift(AUGMENT_ITEMS[a][item] + AUGMENT_ITEMS[b][item]));
    expect(synergyAcrossChampions([[a, b]], [item]).get(item)).toBeCloseTo(lift(AUGMENT_ITEMS[a][item]));
  });
  it("finds an item by the shop's own id, and leaves out what it doesn't know", () => {
    expect(synergyAcrossChampions([[a]], [770000 + item]).has(770000 + item)).toBe(true);
    expect(synergyAcrossChampions([[-1]], [item]).size).toBe(0);
    expect(synergyAcrossChampions([], [item]).size).toBe(0);
  });
  it('moves an item up or down in the build', () => {
    const mayhem = [{ id: 10, games: 30, wins: 15 }, { id: 11, games: 28, wins: 14 }];
    const pool = [10, 11].map((id) => ({ id, boots: false, damage: 'ap' as const }));
    const order = (synergy: Map<number, number>) => buildFor({ championDamage: 'ap', pool, base: [], mayhem, mayhemGames: 100, required: [], links: new Map(), synergy }).items;
    expect(order(new Map())).toEqual([10, 11]);
    expect(order(new Map([[11, lift(2)]]))).toEqual([11, 10]);
  });
});

const pool = [
  { id: 1, boots: true, damage: 'none' as const },
  { id: 2, boots: true, damage: 'none' as const },
  ...[10, 11, 12, 13, 14, 15, 16].map((id) => ({ id, boots: false, damage: 'ap' as const })),
  { id: 20, boots: false, damage: 'ad' as const },
  { id: 30, boots: false, damage: 'none' as const },
];
const input: EngineInput = {
  championDamage: 'ap', pool,
  base: [{ ids: [10, 11, 12], pickRate: 0.2, winRate: 0.51, core: true }, { ids: [1], pickRate: 0.9, winRate: 0.51 }, { ids: [13], pickRate: 0.3, winRate: 0.5 }, { ids: [20], pickRate: 0.5, winRate: 0.55 }],
  mayhem: [{ id: 14, games: 40, wins: 26 }], mayhemGames: 100, required: [], links: new Map(), synergy: new Map(),
};

describe('build engine', () => {
  it('builds boots first, then the base and Mayhem items, without the other damage kind', () => {
    const b = buildFor(input).items;
    expect(b[0]).toBe(1);
    expect(b).toEqual(expect.arrayContaining([10, 11, 12, 13, 14]));
    expect(b).not.toContain(20); // an AD item on an AP champion
    expect(b).toHaveLength(6);
  });
  it('puts an augment-required item in, and lets links and synergy move items up', () => {
    const b = buildFor({ ...input, mayhem: [...input.mayhem, { id: 16, games: 5, wins: 3 }], required: [30], links: new Map([[16, 3]]) }).items;
    expect(b).toContain(30);
    expect(b).toContain(16);
  });
  it("lets links and synergy move only items the champion's players buy", () => {
    const rare = { ...input, mayhem: [...input.mayhem, { id: 16, games: 2, wins: 2 }] }; // 2% of the players: below the gate
    expect(buildFor({ ...rare, links: new Map([[16, 9]]), synergy: new Map([[15, 9]]) }).items).not.toEqual(expect.arrayContaining([16]));
    expect(buildFor({ ...rare, synergy: new Map([[15, 9]]) }).items).not.toContain(15);
  });
  it('still follows the links for a champion with no data', () => {
    expect(buildFor({ ...input, base: [], mayhem: [], mayhemGames: 0, links: new Map([[16, 3]]) }).items).toEqual([16]);
  });
  it('allows the other damage kind when an augment switches it, and never two boots', () => {
    const b = buildFor({ ...input, switchesDamage: true, base: [...input.base, { ids: [2], pickRate: 0.8, winRate: 0.6 }] }).items;
    expect(b).toContain(20);
    expect(b.filter((id) => id === 1 || id === 2)).toHaveLength(1);
  });
});

describe('buying order', () => {
  it('puts what stacks before boots and the rest, on any map copy of the item, and says why', () => {
    const r = buildFor({ ...input, pool: [...pool, { id: 223084, boots: false, damage: 'none' }], base: [...input.base, { ids: [223084], pickRate: 0.95, winRate: 0.5 }] });
    expect(r.items.slice(0, 2)).toEqual([223084, 1]);
    expect(r.why.get(223084)?.[0]).toBe('stacks');
  });
});

describe('enemy team', () => {
  it('moves magic resist up against a magic-heavy team and down against a physical one', () => {
    const withMr = { ...input, pool: [...pool, { id: 40, boots: false, damage: 'none' as const, mr: true }], base: [...input.base, { ids: [40], pickRate: 0.35, winRate: 0.5 }] };
    expect(buildFor({ ...withMr, enemyMagic: 4 }).items).toContain(40);
    expect(buildFor({ ...withMr, enemyMagic: 1 }).items).not.toContain(40);
  });
});
