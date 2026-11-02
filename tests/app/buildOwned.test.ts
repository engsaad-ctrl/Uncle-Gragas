import { describe, expect, it } from 'vitest';
import { buildFor, type EngineInput } from '../../src/app/buildEngine.js';

describe('what the player bought', () => {
  const shop = [
    { id: 1, boots: true, damage: 'none' as const },
    { id: 2, boots: true, damage: 'none' as const },
    { id: 10, boots: false, damage: 'ad' as const },
    { id: 11, boots: false, damage: 'ad' as const },
    { id: 20, boots: false, damage: 'ap' as const },
    { id: 21, boots: false, damage: 'ap' as const },
    { id: 30, boots: false, damage: 'none' as const },
  ];
  const mayhem = [{ id: 1, games: 80, wins: 40 }, { id: 10, games: 60, wins: 30 }, { id: 11, games: 50, wins: 25 }, { id: 21, games: 40, wins: 20 }];
  const base: EngineInput = { championDamage: 'ad', pool: shop, base: [], mayhem, mayhemGames: 100, required: [], links: new Map(), synergy: new Map() };

  it('holds his items first, whatever they score', () => {
    const r = buildFor({ ...base, owned: [30] });
    expect(r.items[0]).toBe(30);
    expect(r.why.get(30)).toEqual(['owned']);
  });
  it('flags what the build would have left out, and keeps it', () => {
    const r = buildFor({ ...base, owned: [30] });
    expect(r.offPath).toEqual([30]);
    expect(r.items).toContain(30);
    expect(buildFor({ ...base, owned: [10] }).offPath).toEqual([]);
  });
  it('never takes a second pair of boots or repeats an item', () => {
    const r = buildFor({ ...base, owned: [2, 2, 10] }).items;
    expect(r.filter((id) => id === 2)).toHaveLength(1);
    expect(r).not.toContain(1);
  });
  it('opens the other damage kind once he has bought into it', () => {
    expect(buildFor(base).items).not.toContain(21);
    expect(buildFor({ ...base, owned: [20] }).items).toContain(21);
  });
  it('ignores an id the shop lacks', () => {
    expect(buildFor({ ...base, owned: [99999] }).items).not.toContain(99999);
  });
  it('changes nothing with nothing bought', () => {
    expect(buildFor({ ...base, owned: [] }).items).toEqual(buildFor(base).items);
    expect(buildFor(base).offPath).toEqual([]);
  });
});
