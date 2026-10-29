import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBestAugments, siteSlug } from '../../src/stats/arammayhem.js';

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

  it('builds the address from the game alias', () => {
    expect(siteSlug('MonkeyKing')).toBe('monkeyking');
    expect(siteSlug('KSante')).toBe('ksante');
  });
});
