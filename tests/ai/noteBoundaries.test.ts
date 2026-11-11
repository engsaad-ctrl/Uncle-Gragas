import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';

// T034 (from Codex's review of T033): what the fight counts for Circle of Death and Overflow, so their notes say no more and no less. Fight scope only, not the offer service.
const record = {
  __type: 'CharacterRecord', spells: [], baseHPModifiable: { baseValue: 1000 },
  baseMoveSpeedModifiable: { baseValue: 325 }, attackRangeModifiable: { baseValue: 500 },
  primaryAbilityResource: { arType: 0, '{726ee5cd}': { baseValue: 1000 }, '{6216bf7b}': { baseValue: 0 } },
};
const card = (id: number) => CARD_NUMBERS.find((c) => c.id === id)!;
const effect = (op: 'heal' | 'shield', kit = false): CardNumbers => ({
  id: 99999, name: 'Test source', status: 'computed',
  ops: [{ op, kit, trigger: 'periodic', amount: { flat: 300 }, internal_cooldown: 5 }],
});
const run = (cards: CardNumbers[]) => fight({ bin: { rec: record }, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 11 });
const circleGain = (source: CardNumbers[]) => run([...source, card(1015)]).fromCards - run(source).fromCards;

describe('fight: what Circle of Death and Overflow count, behind their notes (T034)', () => {
  it('Circle of Death turns a heal listed for his kit into damage, and its note says so', () => {
    expect(run([effect('heal', true)]).healParts!.ops).toBe(900);
    expect(circleGain([effect('heal', true)])).toBeCloseTo(393.75);
    expect(circleGain([])).toBe(0);
    expect(card(1015).not_modelled).toMatch(/heal effects listed for his kit/);
  });
  it('Overflow raises a shield of his own ability by mana, and only the flat 10% on a listed shield', () => {
    const spell = { __type: 'SpellObject', mSpell: {
      cooldownTime: [30, 30, 30, 30, 30, 30],
      mSpellCalculations: { Shield: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } },
    } };
    const at = (cards: CardNumbers[]) => fight({ bin: { rec: { ...record, spells: ['q'] }, q: spell }, shop: {}, items: [], cards, level: 11, kit: { damage: 'magic', attacks: false } });
    expect(at([]).abilityHealing).toBe(100);
    expect(at([card(1311)]).abilityHealing).toBeCloseTo(115); // +10% flat and +5% from 1000 mana
    expect(run([effect('shield', true), card(1311)]).healParts!.shields).toBeCloseTo(990); // 900 listed, flat 10% only
    expect(card(1311).not_modelled).toMatch(/heals and shields of his abilities' own spells/);
    expect(card(1311).not_modelled).not.toMatch(/^.*shields and the heals of items/); // the T033 note that left out all shields
  });
  it('Heavy Is The Crown stays above its 50% floor with the stack estimate up to level 21', () => {
    const at = (cards: CardNumbers[], level: number) => fight({ bin: { rec: record }, shop: {}, items: [], cards, level, kit: { damage: 'magic', attacks: false } });
    for (const level of [1, 18, 21]) {
      const plain = at([], level), crown = at([card(3132)], level);
      expect(crown.peakMoveSpeed).toBe(Math.round(325 * 0.95 * (1 - 0.025 * Math.min(20, 0.6 * level))));
      expect(crown.peakMoveSpeed).toBeGreaterThan(plain.peakMoveSpeed * 0.5);
    }
  });
});
