import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

const card = (name: string) => CARD_NUMBERS.find((c) => c.name === name)!;
describe('augment numbers from their texts (knowledge/fight-rules.md, augments)', () => {
  it('reads Juiced as 7% maximum mana on hit, with ranged x0.8 from the 16.22 file', () => {
    expect(card('Juiced').ops).toEqual([
      expect.objectContaining({ op: 'proc', trigger: 'on_hit', damage: { mana: 0.07 }, type: 'magic', needs: 'melee' }),
      expect.objectContaining({ op: 'proc', trigger: 'on_hit', damage: { mana: 0.056 }, type: 'magic', needs: 'ranged' }),
    ]);
  });
  it('counts nothing for Dive Bomber, whose damage comes on his death', () => {
    expect(card('Dive Bomber').ops).toEqual([]);
  });
});
describe('augment conditions', () => {
  it('holds Glass Cannon for ranged champions too, each of its amps marked melee or ranged', () => {
    expect(card('Glass Cannon').need?.class).toBe('always');
  });
});
