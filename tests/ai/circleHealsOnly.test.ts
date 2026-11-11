import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';

// T034: Circle of Death turns healing into damage, not shields. Fight scope.
const record = {
  __type: 'CharacterRecord', spells: [], baseHPModifiable: { baseValue: 1000 },
  baseMoveSpeedModifiable: { baseValue: 325 }, attackRangeModifiable: { baseValue: 500 },
};
const circle = CARD_NUMBERS.find((c) => c.id === 1015)!;
const effect = (op: 'heal' | 'shield', kit = false, id = 99999): CardNumbers => ({
  id, name: `Test ${op}`, status: 'computed',
  ops: [{ op, kit, trigger: 'periodic', amount: { flat: 300 }, internal_cooldown: 5 }],
});
const run = (cards: CardNumbers[]) => fight({ bin: { rec: record }, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 11 });
const gain = (source: CardNumbers[]) => run([...source, circle]).fromCards - run(source).fromCards;

describe('Circle of Death: healing only (T034)', () => {
  it('no heal and no shield: nothing', () => expect(gain([])).toBe(0));
  it('a shield alone: nothing', () => expect(gain([effect('shield')])).toBe(0));
  it('a heal alone: 70% of it as magic damage', () => {
    expect(run([effect('heal')]).healParts!.ops).toBe(900); // three 300 heals in the 15 s fight
    expect(gain([effect('heal')])).toBeCloseTo(900 * 0.7 * 0.625); // 393.75 after the target's magic resist
  });
  it('heal and shield together: the heal part only', () => {
    expect(gain([effect('heal'), effect('shield', false, 99998)])).toBeCloseTo(gain([effect('heal')]));
  });
  it('a heal listed for his kit still counts', () => expect(gain([effect('heal', true)])).toBeCloseTo(393.75));
  it('leaves the shield\'s own defense as it was', () => {
    const shield = run([effect('shield')]), withCircle = run([effect('shield'), circle]);
    expect(withCircle.healParts!.shields).toBe(shield.healParts!.shields);
    expect(withCircle.healedHp).toBe(shield.healedHp);
    expect(withCircle.effectiveHp).toBe(shield.effectiveHp);
  });
  it('its note says shields are left out', () => expect(circle.not_modelled).toMatch(/shields are left out/));
});
