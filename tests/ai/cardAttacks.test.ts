import { afterAll, beforeAll, expect, it } from 'vitest';
import { kitWithCards } from '../../src/ai/augmentChoice.js';
import { FIGHT, fight, type CardNumbers, type CardOp, type Kit } from '../../src/ai/cardMath.js';

// T196c (Codex T206): a kit that attacks only because a card turned attacks on (Marksmage on Zoe) attacks in cast downtime only: a whole attack
// interval must end before his next possible cast; casts come first and skipped attacks are not made up. Timelines set by the fixture's cooldowns.
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const num = (baseValue: number) => ({ baseValue });
const recOf = (spells: string[], range = 500, as = 1, extra: object = {}) => ({
  __type: 'CharacterRecord', spells,
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(range), attackSpeedModifiable: num(as), attackSpeedRatioModifiable: num(as), attackSpeedPerLevelModifiable: num(0), ...extra,
});
const spell = (cd: number, cost = 0) => ({ mSpell: { cooldownTime: Array(7).fill(cd), ...(cost ? { mana: Array(6).fill(cost) } : {}), mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 50 }] } } } });
const onAttack: CardNumbers = { id: 1, name: 'on attack', status: 'computed', ops: [{ op: 'proc', trigger: 'attack', damage: { flat: 1 }, type: 'true' } as CardOp] };
const mage: Kit = { damage: 'magic', attacks: false };
const run = (bin: Parameters<typeof fight>[0]["bin"], kit: Kit, extra: Partial<Parameters<typeof fight>[0]> = {}) => fight({ bin, shop: {}, kit, items: [], cards: [onAttack], level: 9, ...extra });

it('kitWithCards marks card-made attacks, keeps the mark, and leaves his own attacks and paces alone', () => {
  expect(kitWithCards(mage, [onAttack])).toEqual({ ...mage, attacks: true, cardAttacks: true });
  expect(kitWithCards(kitWithCards(mage, [onAttack]), [onAttack])).toEqual({ ...mage, attacks: true, cardAttacks: true });
  expect(kitWithCards({ damage: 'physical', attacks: true }, [onAttack])).toEqual({ damage: 'physical', attacks: true });
  expect(kitWithCards({ ...mage, attackPace: 0.5 }, [onAttack])).toEqual({ ...mage, attackPace: 0.5, attacks: true });
});

it('crowded casts leave no attack: two abilities with 1.5 s cooldowns (a second or less reads as a toggle), one always ready at the cast lock (0.75 s) and a 1 s attack interval', () => {
  const r = run({ rec: recOf(['q', 'w']), q: spell(1.5), w: spell(1.5) }, kitWithCards(mage, [onAttack]));
  expect(r.casts.Q + r.casts.W).toBeGreaterThan(15);
  expect(r.attacks).toBe(0);
});

it('long gaps allow several attacks, one interval apart at least, fewer than full pace', () => {
  const bin = { rec: recOf(['q']), q: spell(10) };
  const gated = run(bin, kitWithCards(mage, [onAttack]));
  const full = run(bin, { ...mage, attacks: true });
  expect(gated.attacks).toBeGreaterThan(5);
  expect(gated.attacks).toBeLessThanOrEqual(Math.floor(FIGHT.seconds * 1) + 1);
  expect(gated.attacks).toBeLessThan(full.attacks);
  expect(gated.fromCards).toBeCloseTo(gated.attacks, 6);
});

it('no contact gives no attack', () => {
  const r = run({ rec: recOf(['q'], 175), q: spell(10) }, kitWithCards(mage, [onAttack]), { attackAccess: { distance: 1000, moveSpeed: 0, strings: {} } });
  expect(r.attacks).toBe(0);
});

// Codex T196c review, required 1: a fast attack (0.5 s) that would fit inside the 0.75 s cast lock is not made there.
it('no attack inside the cast lock, even when a fast attack would fit in it', () => {
  const r = run({ rec: recOf(['q', 'w'], 500, 2), q: spell(1.5), w: spell(1.5) }, kitWithCards(mage, [onAttack]));
  expect(r.casts.Q + r.casts.W).toBeGreaterThan(15);
  expect(r.attacks).toBe(0);
});

// Codex T196c review, required 2: a spell his mana cannot pay now still comes when regeneration pays it. Two 1.5 s spells at 60 mana each, 100 mana,
// 70 mana a second: every wait is under the 1 s attack interval, so no attack fits; counting only today's mana left gaps with no coming cast.
it('a spell regeneration pays within the attack interval still counts as the next cast', () => {
  const resource = { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(100), '{6216bf7b}': num(0), '{c4ab3550}': num(70), '{3a509002}': num(0) } };
  const r = run({ rec: recOf(['q', 'w'], 500, 1, resource), q: spell(1.5, 60), w: spell(1.5, 60) }, kitWithCards(mage, [onAttack]));
  expect(r.casts.Q + r.casts.W).toBeGreaterThan(10);
  expect(r.attacks).toBe(0);
});

// Codex T196c v2 review: a rising cost falls when its casts leave the window. A 40-mana R (+40 a cast, 1.5 s window and cooldown), 100 mana, no
// regeneration: after the first R he cannot pay 80, but at 1.5 s the cost is back to 40 and R casts, inside the 1 s interval an attack at 0.75 s needs.
it('a rising cost that falls back counts as the next cast', () => {
  const resource = { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(100), '{6216bf7b}': num(0), '{c4ab3550}': num(0), '{3a509002}': num(0) } };
  const r6 = { mSpell: { ...spell(1.5, 40).mSpell, DataValues: [{ name: 'BaseCost', values: Array(7).fill(40) }, { name: 'ManaCostDuration', values: Array(7).fill(1.5) }] } };
  const was = FIGHT.seconds;
  FIGHT.seconds = 1.5 + 0.01;
  try {
    const r = run({ rec: recOf(['', '', '', 'r'], 500, 1, resource), r: r6 }, kitWithCards(mage, [onAttack]));
    expect(r.casts.R).toBe(2);
    expect(r.attacks).toBe(0);
  } finally { FIGHT.seconds = was; }
});

// Codex T196c v3 review: the same R first ready at 1 s (window exit at 2.5 s lands between float steps). Only the attack at 0 s fits (it ends as R comes
// at 1 s); at 1.75 s the next R comes at the 2.5 s step, inside that attack's interval, so none.
it('a rising cost falls on the step the cast loop sees it fall', () => {
  const resource = { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(100), '{6216bf7b}': num(0), '{c4ab3550}': num(0), '{3a509002}': num(0) } };
  const r6 = { mSpell: { ...spell(1.5, 40).mSpell, DataValues: [{ name: 'BaseCost', values: Array(7).fill(40) }, { name: 'ManaCostDuration', values: Array(7).fill(1.5) }] } };
  const was = FIGHT.seconds;
  FIGHT.seconds = 2.61;
  try {
    const r = run({ rec: recOf(['', '', '', 'r'], 500, 1, resource), r: r6 }, kitWithCards(mage, [onAttack]), { cooldowns: { R: 1 } });
    expect(r.casts.R).toBe(2);
    expect(r.attacks).toBe(1);
  } finally { FIGHT.seconds = was; }
});
