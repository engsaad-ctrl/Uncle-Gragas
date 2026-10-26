import { describe, expect, it } from 'vitest';
import { counterPicks, metaPicks } from '../../src/app/suggestions.js';
import type { TierRow } from '../../src/app/tierList.js';
import type { ChampionListEntry } from '../../src/texts/champions.js';

const c = (id: number, enName: string): ChampionListEntry => ({ id, name: enName, enName, alias: enName, portraitUrl: '' });
const list = [c(238, 'Zed'), c(103, 'Ahri'), c(38, 'Kassadin'), c(54, 'Malphite'), c(887, 'Gwen'), c(99, 'Lux')];

describe('counterPicks', () => {
  // weakAgainst lists: the enemy's own win rate against each opponent that beats it (real numbers, 2026-10 mid).
  const beatenBy = new Map([
    [238, [{ id: 887, games: 141, winRate: 0.41 }, { id: 54, games: 957, winRate: 0.44 }]], // Zed loses to Gwen, Malphite
    [103, [{ id: 887, games: 216, winRate: 0.45 }, { id: 99, games: 1749, winRate: 0.47 }]], // Ahri loses to Gwen, Lux
  ]);

  it('ranks answers by how far above 50% they win, summed over the enemies they answer', () => {
    const s = counterPicks(beatenBy, list, new Set());
    expect(s.map((x) => x.champion.enName)).toEqual(['Gwen', 'Malphite', 'Lux']); // Gwen answers both
    expect(s[0].vs.map((v) => [v.enemy.enName, Number(v.winRate.toFixed(2))])).toEqual([['Zed', 0.59], ['Ahri', 0.55]]);
  });

  it('leaves out champions already taken', () => {
    expect(counterPicks(beatenBy, list, new Set([887])).map((x) => x.champion.enName)).toEqual(['Malphite', 'Lux']);
  });
});

describe('metaPicks', () => {
  const row = (id: number | null, rank: number, tier: number): TierRow =>
    ({ id, rank, tier, winRate: 0.52, name: '', enName: '', portraitUrl: '', change: 0, champion: '', rankPrev: 0, pickRate: 0, banRate: 0, games: 0 });

  it('lists the lane\'s best ranks first, skipping taken and unknown champions', () => {
    const s = metaPicks([row(54, 3, 1), row(238, 1, 1), row(null, 2, 1), row(103, 4, 2)], list, new Set([103]));
    expect(s.map((x) => [x.champion.enName, x.tier])).toEqual([['Zed', 1], ['Malphite', 1]]);
  });
});
