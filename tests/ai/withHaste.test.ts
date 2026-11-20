import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T173 (Codex T140 defect): With Haste (1098) turns 70% of his ability haste into move speed. The same +100 haste gave 395 peak move speed
// when held from the start but 325 when it came from a timed effect during the fight; the conversion now reads the live haste.
const num = (baseValue: number) => ({ baseValue });
const bin = { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) } };
const withHaste = CARD_NUMBERS.find((c) => c.id === 1098)!;
const card = (ops: CardNumbers['ops']): CardNumbers => ({ id: 0, name: 'Test', status: 'computed', ops });
const flat = card([{ op: 'add', stat: 'haste', value: 100 }]);
const timed = (trigger: string) => card([{ op: 'timed', trigger, stat: 'haste', value: 100, mode: 'add', duration: null, decays: false, stacks_max: 1, refresh: true, internal_cooldown: null } as never]);
const peak = (cards: CardNumbers[]) => fight({ bin, shop: {}, kit: { damage: 'physical', attacks: true }, items: [], cards, level: 1 }).peakMoveSpeed;

describe('With Haste (1098) reads live haste (T173)', () => {
  it('held haste: 325 + 70 = 395, as before', () => {
    expect(peak([withHaste, flat])).toBe(395);
  });
  it('the same haste from a timed effect during the fight gives the same 395 (was 325)', () => {
    expect(peak([withHaste, timed('always')])).toBe(395);
    expect(peak([withHaste, timed('attack')])).toBe(395);
  });
  it('without With Haste the timed haste moves nothing', () => {
    expect(peak([timed('always')])).toBe(325);
  });
});
