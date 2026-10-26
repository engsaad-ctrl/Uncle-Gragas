import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOpgg } from '../../src/stats/opggFormat.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/opgg/${name}`, import.meta.url), 'utf8');

describe('parseOpgg', () => {
  it('turns class headers + constructor calls into plain objects (real ranked answer)', () => {
    const r = parseOpgg(fixture('ahri-ranked-mid.txt')) as any;
    expect(r.data.summary.average_stats.play).toBe(104125);
    expect(r.data.core_items.ids).toEqual([3118, 4645, 3157]);
    expect(r.data.fourth_items).toHaveLength(3);
    expect(r.data.summoner_spells.ids).toEqual([4, 14]);
    expect(r.data.runes.primary_rune_ids).toEqual([8112, 8139, 8140, 8106]);
    expect(r.data.skills.order).toHaveLength(15);
    expect(r.data.skill_masteries.ids).toEqual(['Q', 'W', 'E']);
  });

  it('reads Arabic strings with HTML inside (real Mayhem augment answer)', () => {
    const r = parseOpgg(fixture('ahri-mayhem-augments.txt')) as any;
    expect(r.data.augments.length).toBeGreaterThan(100);
    expect(r.data.augments[0]).toMatchObject({ id: 2127, tier: 3, performance: 88.9 });
    expect(r.data.augments[0].desc).toContain('<attention>45%</attention>');
  });

  it('handles escapes, negatives, exponents, keywords and empty lists', () => {
    const text = 'class A: s,n,e,t,f,z,l\n\nA("say \\"hi\\"",-2.5,1e3,true,False,None,[])';
    expect(parseOpgg(text)).toEqual({ s: 'say "hi"', n: -2.5, e: 1000, t: true, f: false, z: null, l: [] });
  });

  it('accepts Windows line endings', () => {
    expect(parseOpgg('class A: x,y\r\nclass B: z\r\n\r\nA(1,B(2))\r\n')).toEqual({ x: 1, y: { z: 2 } });
  });

  it('fills fields missing from the call with null', () => {
    expect(parseOpgg('class A: x,y\n\nA(1)')).toEqual({ x: 1, y: null });
  });

  it('passes plain JSON answers through', () => {
    expect(parseOpgg('{"lang":"en_US","data":{"items":[]}}')).toEqual({ lang: 'en_US', data: { items: [] } });
  });

  it('rejects unknown classes and broken input', () => {
    expect(() => parseOpgg('class A: x\n\nB(1)')).toThrow(/unknown class B/);
    expect(() => parseOpgg('class A: x\n\nA(1')).toThrow(/OP.GG format/);
    expect(() => parseOpgg('class A: x\n\nA(1) junk')).toThrow(/trailing/);
  });
});
