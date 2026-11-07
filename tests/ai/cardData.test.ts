import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

const card = (name: string) => CARD_NUMBERS.find((c) => c.name === name)!;
describe('augment numbers from their texts (knowledge/fight-rules.md, augments)', () => {
  it('reads Juiced as 7% of maximum mana on hit, from the wiki text the game hides', () => {
    expect(card('Juiced').ops).toEqual([expect.objectContaining({ op: 'proc', trigger: 'on_hit', damage: { mana: 0.07 }, type: 'magic' })]);
  });
  it('counts nothing for Dive Bomber, whose damage comes on his death', () => {
    expect(card('Dive Bomber').ops).toEqual([]);
  });
});
