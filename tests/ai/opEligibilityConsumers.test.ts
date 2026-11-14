import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kitWithCards } from '../../src/ai/augmentChoice.js';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';

// T051 v2 (Codex's T051 review, his six cases): an op left out (death or unknown) must not change any behavioural read either: it does not open
// attacks (kitWithCards), make him melee (health, resists, attack uptime), or lock his ultimate away from a live card that needs it. The same op
// live, or with no eligibility, still does each of these (the controls).
const num = (baseValue: number) => ({ baseValue });
const bin = { rec: {
  __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(550), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340),
  attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0),
} };
const card = (ops: CardOp[], needs?: string): CardNumbers => ({ id: 1, name: 'x', status: 'computed', ops, ...(needs ? { needs } : {}) });
const hit: CardOp = { op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { flat: 30 }, type: 'physical' };
const ranged = { bin, shop: {}, kit: { damage: 'physical' as const, attacks: true }, items: [], level: 9 };
// A real kit with an ultimate (the sim fixture's Ahri casts R once in 15 s at level 9).
const ahri = { bin: JSON.parse(readFileSync('tests/fixtures/sim/16.22/champions/ahri.bin.json', 'utf8')), shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], level: 9 };
const afterUlt = card([{ op: 'add', stat: 'ap', value: 100 }], 'after an ultimate cast');

describe('a left-out op changes no behavioural read', () => {
  for (const eligibility of ['death', 'unknown'] as const) {
    it(`${eligibility} on-hit does not open attacks (kitWithCards)`, () => {
      expect(kitWithCards({ damage: 'magic', attacks: false }, [card([{ ...hit, eligibility }])]).attacks).toBe(false);
    });
    it(`${eligibility} melee does not change health, resists or attack uptime`, () => {
      const plain = fight({ ...ranged, cards: [] }), out = fight({ ...ranged, cards: [card([{ op: 'melee', eligibility }])] });
      expect(out.effectiveHp).toBeCloseTo(plain.effectiveHp, 9);
      expect(out.damage).toBeCloseTo(plain.damage, 9);
    });
    it(`${eligibility} lock R does not take the ultimate from a live card that needs it`, () => {
      const plain = fight({ ...ahri, cards: [afterUlt] }), out = fight({ ...ahri, cards: [afterUlt, card([{ op: 'lock', key: 'R', eligibility }])] });
      expect(plain.casts.R).toBeGreaterThan(0);
      expect(out.casts.R).toBe(plain.casts.R);
      expect(out.damage).toBeCloseTo(plain.damage, 9);
    });
  }
});

describe('the controls: live, and no eligibility, still act', () => {
  for (const eligibility of ['live', undefined] as const) {
    const tag = eligibility ?? 'no eligibility';
    it(`${tag} on-hit opens attacks`, () => {
      expect(kitWithCards({ damage: 'magic', attacks: false }, [card([{ ...hit, eligibility }])]).attacks).toBe(true);
    });
    it(`${tag} melee changes the fight`, () => {
      expect(fight({ ...ranged, cards: [card([{ op: 'melee', eligibility }])] }).effectiveHp).not.toBeCloseTo(fight({ ...ranged, cards: [] }).effectiveHp, 3);
    });
    it(`${tag} lock R takes the ultimate`, () => {
      expect(fight({ ...ahri, cards: [afterUlt, card([{ op: 'lock', key: 'R', eligibility }])] }).casts.R ?? 0).toBe(0);
    });
  }
});
