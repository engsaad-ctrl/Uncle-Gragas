import { describe, expect, it } from 'vitest';
import { needsAbilityTarget, type TargetAbility } from '../../src/ai/abilityTarget.js';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { AUGMENT_TAGS } from '../../src/ai/augmentTags.js';
import { tagWeight } from '../../src/ai/tagWeight.js';

const spell = { __type: 'SpellObject', mSpell: {
  cooldownTime: [12, 12, 12, 12, 12, 12, 12],
  mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } },
} };
const bin = {
  rec: { __type: 'CharacterRecord', spells: ['q', 'w', '', 'r'], baseHPModifiable: { baseValue: 1000 } },
  q: spell, w: spell, r: spell,
};
const targeted = (id: number, abilityKey?: TargetAbility): CardNumbers => ({ ...CARD_NUMBERS.find((c) => c.id === id)!, abilityKey });
const at = (cards: CardNumbers[], level = 9, b: Record<string, unknown> = bin) => fight({ bin: b, shop: {}, items: [], cards, level, kit: { damage: 'magic', attacks: false } });

describe('targeted ability haste', () => {
  it('generates all three Bread effects as 100 selected-skill haste, without a fixed slot', () => {
    for (const id of [1103, 1150, 1151]) { // the Bread effects; Echo Cast (also targeted) is tested in augmentFiles.test.ts
      expect(targeted(id).ops).toEqual([{ op: 'add', stat: 'haste', value: 100, scope: 'chosen_ability' }]);
      expect(needsAbilityTarget([id])).toBe(true);
      expect(tagWeight(AUGMENT_TAGS[id], targeted(id).ops)).toEqual({ weight: 1, unread: false, open: [] });
    }
    expect(needsAbilityTarget([99999])).toBe(false);
    expect(tagWeight({ tags: ['condition:target is immobilized'] }, targeted(1103).ops)).toEqual({ weight: 1, unread: true, open: ['target is immobilized'] });
  });

  it('adds casts only to the selected slot, with no global stat leakage', () => {
    const plain = at([]), changed = at([targeted(1103, 'Q')]);
    expect(changed.casts).toEqual({ R: 2, Q: 3, W: 2 });
    expect(plain.casts).toEqual({ R: 2, Q: 2, W: 2 });
    expect(changed.stats.haste).toBe(0);
    expect(changed.notModelled).toEqual([]);
  });

  it('keeps independent targets, and adds same-slot haste before cooldown conversion', () => {
    expect(at([targeted(1103, 'W'), targeted(1150, 'Q')]).casts).toEqual({ R: 2, Q: 3, W: 3 });
    expect(at([targeted(1103, 'Q'), targeted(1151, 'Q')]).casts).toEqual({ R: 2, Q: 4, W: 2 });
  });

  it('adds slot haste to general haste without changing other slots twice', () => {
    const general: CardNumbers = { id: 99999, name: 'General haste', status: 'computed', ops: [{ op: 'add', stat: 'haste', value: 100 }] };
    const result = at([general, targeted(1103, 'Q')]);
    expect(result.casts).toEqual({ R: 3, Q: 4, W: 3 });
    expect(result.stats.haste).toBe(100);
  });

  it('omits an unknown target and reports it rather than giving every basic skill one third', () => {
    const result = at([targeted(1103)]);
    expect(result.casts).toEqual(at([]).casts);
    expect(result.damage).toBe(at([]).damage);
    expect(result.notModelled).toHaveLength(1);
    expect(result.notModelled[0]).toContain('غير محددة');
  });

  it('reports a selected skill missing from the character file', () => {
    const result = at([targeted(1103, 'E')]);
    expect(result.damage).toBe(at([]).damage);
    expect(result.notModelled[0]).toContain('E');
    expect(result.notModelled[0]).toContain('غير موجودة');
  });

  it('cannot enable an R before its level unlock or through a lock', () => {
    expect(at([targeted(1103, 'R')], 5).casts).toEqual(at([], 5).casts);
    expect(at([targeted(1103, 'R')], 6).casts.R).toBe(3);
    const lock: CardNumbers = { id: 99999, name: 'Lock R', status: 'computed', ops: [{ op: 'lock', key: 'R' }] };
    const result = at([lock, targeted(1103, 'R')]);
    expect(result.casts.R).toBeUndefined();
    expect(result.stats.haste).toBe(0);
  });
});
