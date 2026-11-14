import { describe, expect, it } from 'vitest';
import type { CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { lowHealthTermOf, ownLowHealthMark } from '../../src/ai/conditionalEffect.js';
import { lowHealthText } from '../../src/renderer/lowHealthView.js';

// T072: a shield on the player's own low health (Escape Plan) is read from the card's live ops by their fields, never by a name, and said as a
// declared condition; an op that cannot be read that way gives a reason and no number.
const shield = (extra: Record<string, unknown> = {}) => ({ op: 'shield', amount: { hp: 0.65 }, trigger: 'periodic', internal_cooldown: 75, needs: 'on falling below 35% Health', ...extra }) as unknown as CardOp;

describe('the real card rows', () => {
  it('Escape Plan (1333): below 35%, a shield of 65% of his maximum health; its shield op does not say it decays', () => {
    const card = CARD_NUMBERS.find((c) => c.id === 1333)!;
    expect(lowHealthTermOf(card)).toEqual({ kind: 'shield', below: 0.35, maxHealthShare: 0.65, decays: false });
  });
  it('no other card row gives a low-health term', () => {
    expect(CARD_NUMBERS.filter((c) => lowHealthTermOf(c)).map((c) => c.id)).toEqual([1333]);
  });
});

describe('reading by fields', () => {
  it('a renamed card with the same op reads the same (no name list)', () => {
    expect(lowHealthTermOf({ ops: [shield()] })).toEqual({ kind: 'shield', below: 0.35, maxHealthShare: 0.65, decays: false });
  });
  it('the mark is the op\'s own number, and a target\'s health is not his own', () => {
    expect(ownLowHealthMark(shield({ needs: 'on falling below 20% Health' }))).toBe(0.2);
    expect(lowHealthTermOf({ ops: [shield({ needs: 'on hitting a target below 35% health' })] })).toBeUndefined();
    expect(lowHealthTermOf({ ops: [shield({ needs: undefined })] })).toBeUndefined();
  });
  it('a shield op that says it decays says so', () => {
    expect(lowHealthTermOf({ ops: [shield({ decays: true })] })).toMatchObject({ kind: 'shield', decays: true });
  });
  it('an amount that is not exactly a share of his health is unread: no number', () => {
    expect(lowHealthTermOf({ ops: [shield({ amount: { hp: 0.3, flat: [100] } })] })).toEqual({ kind: 'unread', below: 0.35, reason: 'amount-unread' });
    expect(lowHealthTermOf({ ops: [shield({ amount: { ap: 0.5 } })] })).toEqual({ kind: 'unread', below: 0.35, reason: 'amount-unread' });
  });
  it('an op that is not live (death or unknown) is never shown as computed', () => {
    expect(lowHealthTermOf({ ops: [shield({ eligibility: 'death' })] })).toEqual({ kind: 'unread', below: 0.35, reason: 'not-live' });
  });
  it('a waiting op that is not a shield is named as such', () => {
    expect(lowHealthTermOf({ ops: [{ op: 'heal', amount: { hp: 0.2 }, trigger: 'periodic', needs: 'on falling below 30% Health' } as unknown as CardOp] })).toEqual({ kind: 'unread', below: 0.3, reason: 'not-a-shield' });
  });
});

describe('the words', () => {
  it('the shield line: condition, amount, and that its chance and use are not estimated', () => {
    expect(lowHealthText({ kind: 'shield', below: 0.35, maxHealthShare: 0.65, decays: false })).toBe('عند هبوط صحتك إلى 35%: درع 65% من صحتك القصوى. احتمال تفعيله واستهلاكه غير مقدرين هنا، وهذا وصف شرطي، لا مكسب إضافي يُجمع مع النسبة أعلاه.');
    expect(lowHealthText({ kind: 'shield', below: 0.35, maxHealthShare: 0.65, decays: true })).toContain('من صحتك القصوى، يتلاشى.');
  });
  it('an unread term has no number beyond its mark', () => {
    const t = lowHealthText({ kind: 'unread', below: 0.35, reason: 'amount-unread' });
    expect(t).toContain('مقداره غير مقروء'); expect(t).not.toMatch(/درع \d/);
  });
});
