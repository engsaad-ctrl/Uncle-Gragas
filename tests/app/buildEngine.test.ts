import { describe, expect, it } from 'vitest';
import { buildFor, type EngineInput } from '../../src/app/buildEngine.js';

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
    const b = buildFor({ ...input, required: [30], links: new Map([[16, 3]]) }).items;
    expect(b).toContain(30);
    expect(b).toContain(16);
  });
  it('allows the other damage kind when an augment switches it, and never two boots', () => {
    const b = buildFor({ ...input, switchesDamage: true, base: [...input.base, { ids: [2], pickRate: 0.8, winRate: 0.6 }] }).items;
    expect(b).toContain(20);
    expect(b.filter((id) => id === 1 || id === 2)).toHaveLength(1);
  });
});

describe('enemy team', () => {
  it('moves magic resist up against a magic-heavy team and down against a physical one', () => {
    const withMr = { ...input, pool: [...pool, { id: 40, boots: false, damage: 'none' as const, mr: true }], base: [...input.base, { ids: [40], pickRate: 0.35, winRate: 0.5 }] };
    expect(buildFor({ ...withMr, enemyMagic: 4 }).items).toContain(40);
    expect(buildFor({ ...withMr, enemyMagic: 1 }).items).not.toContain(40);
  });
});
