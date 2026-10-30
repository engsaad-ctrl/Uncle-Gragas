import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byWinRate, parseBestAugments, parseBuild, siteSlug } from '../../src/stats/arammayhem.js';

describe('arammayhem.com', () => {
  it("reads a champion's best augments, best first, with tier and appearance rate", () => {
    const list = parseBestAugments(readFileSync(new URL('../fixtures/arammayhem/varus.html', import.meta.url), 'utf8'));
    expect(list).toHaveLength(18);
    expect(list[0]).toMatchObject({ name: 'BEES!!!', tier: 'S+', rank: 1 });
    expect(list[0].appearance).toBeCloseTo(0.1646);
    const blunt = list.find((a) => a.name === 'Blunt Force')!;
    expect(blunt.tier).toBe('S+');
    expect(blunt.appearance).toBeCloseTo(0.0811);
    expect(list.map((a) => a.rank)).toEqual([...list.map((a) => a.rank)].sort((a, b) => a - b));
  });

  it('finds nothing on a page without the section', () => {
    expect(parseBestAugments('<html></html>')).toEqual([]);
  });

  it("reads the champion's Mayhem build: skills, starting items, boots, core and other items", () => {
    const b = parseBuild(readFileSync(new URL('../fixtures/arammayhem/varus-build.html', import.meta.url), 'utf8'))!;
    expect(b.skillPriority).toEqual(['Q', 'E', 'W']);
    expect(b.skillOrder.join(' ')).toBe('Q W E Q Q R Q E Q E R E E W W');
    expect(b.starter[0]).toMatchObject({ names: ['Long Sword', "Guardian's Blade"] });
    expect(b.boots.map((x) => x.names[0])).toEqual(["Berserker's Greaves", 'Boots of Swiftness', 'Ionian Boots of Lucidity']);
    expect(b.core[0].names).toEqual(['Hubris', 'The Collector', 'Manamune']);
    expect(b.core[0].pickRate).toBeCloseTo(0.07);
    expect(b.core[0].winRate).toBeCloseTo(0.448);
    expect(b.others[0]).toMatchObject({ names: ['The Collector'] });
    expect(b.others).toHaveLength(5);
  });

  it('puts the most winning choice first, but not one picked too rarely to trust', () => {
    const x = (name: string, pickRate: number, winRate: number) => ({ names: [name], pickRate, winRate });
    const order = byWinRate([x('popular', 0.3, 0.48), x('rare', 0.01, 0.7), x('winning', 0.05, 0.55)]).map((i) => i.names[0]);
    expect(order).toEqual(['winning', 'popular', 'rare']);
  });

  it('has no build on a page without one', () => {
    expect(parseBuild('<html></html>')).toBeNull();
  });

  it('builds the address from the game alias', () => {
    expect(siteSlug('MonkeyKing')).toBe('monkeyking');
    expect(siteSlug('KSante')).toBe('ksante');
  });
});
