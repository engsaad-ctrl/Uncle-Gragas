import { describe, expect, it } from 'vitest';
import { parseAugmentProgress } from '../../src/ai/augmentProgress.js';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { destinyOptions } from '../../src/renderer/destinyOptions.js';

// T193 prototype: Weapon of Destiny (3081) grows the named weapon's own AD and omnivamp, 0.2 unit a kill since the pick
// (UpgradeAD 30, UpgradeOmnivamp 0.25 a unit). Two creator games fit 0.19-0.21 a kill (knowledge/codex-claude/T180-weapon-of-destiny).
const num = (baseValue: number) => ({ baseValue });
const rec = {
  __type: 'CharacterRecord', spells: [],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(500), attackSpeedModifiable: num(1), attackSpeedRatioModifiable: num(1), attackSpeedPerLevelModifiable: num(0),
};
const dv = (name: string, value: number) => ({ name, values: [value, value] });
const shop = {
  2517: { DataValues: [dv('FlatPhysicalDamageMod', 65), dv('PercentOmnivampMod', 0.05)] }, // Endless Hunger-like: AD and omnivamp
  3031: { DataValues: [dv('FlatPhysicalDamageMod', 75), dv('FlatCritChanceMod', 0.25)] }, // Infinity Edge-like: AD, no omnivamp
} as never;
const wod = CARD_NUMBERS.find((c) => c.id === 3081)!;
const run = (items: number[], card?: Partial<CardNumbers>) => fight({ bin: { rec }, shop, kit: { damage: 'physical', attacks: true }, items, cards: card ? [{ ...wod, acquiredLevel: 3, ...card }] : [], level: 18 });
const kills = 0.67 * (18 - 3); // KILLS_PER_LEVEL since the pick at level 3

describe('Weapon of Destiny (T193 prototype)', () => {
  it('has a row: per kill, 0.2 unit, AD 30 and omnivamp 0.25 a unit', () => {
    expect(wod.status).toBe('partial');
    expect(wod.ops).toEqual([{ op: 'destiny', per: 'kill', unit: 0.2, upgrades: { ad: 30, omnivamp: 0.25 } }]);
    expect(wod.not_modelled).toMatch(/not counted: unproven/);
  });

  it('takes the weapon from the player (progress.destinyItem) and refuses a bad one', () => {
    expect(parseAugmentProgress({ level: 11, destinyItem: 2517 })?.destinyItem).toBe(2517);
    expect(parseAugmentProgress({ level: 11 })?.destinyItem).toBeUndefined();
    for (const bad of [0, -1, 1.5, '2517']) expect(() => parseAugmentProgress({ level: 11, destinyItem: bad })).toThrow('bad destiny item');
  });

  it('grows the named weapon\'s AD and omnivamp per kill since the pick', () => {
    const base = run([2517]), grown = run([2517], { destinyItem: 2517 });
    expect(grown.stats.ad - base.stats.ad).toBeCloseTo(0.2 * 30 * kills, 6);
    // Omnivamp grows too (0.2 x 0.25 a kill): the vamp healing rises (Codex T194).
    expect(grown.healParts!.omnivamp).toBeGreaterThan(base.healParts!.omnivamp);
  });

  it('grows only the families the weapon has: an AD item without omnivamp gets AD only', () => {
    const base = run([3031]), grown = run([3031], { destinyItem: 3031 });
    expect(grown.stats.ad - base.stats.ad).toBeCloseTo(0.2 * 30 * kills, 6);
    expect(base.healParts!.omnivamp).toBe(0);
    expect(grown.healParts!.omnivamp).toBe(0); // no omnivamp on the weapon: none grows
  });

  it('counts nothing and says so when no weapon is named, or the named one is not held', () => {
    const base = run([2517]);
    const none = run([2517], {});
    expect(none.stats.ad).toBe(base.stats.ad);
    expect(none.notModelled.some((n) => /سلاح المصير غير محدد/.test(n))).toBe(true);
    const away = run([2517], { destinyItem: 3031 });
    expect(away.stats.ad).toBe(base.stats.ad);
    expect(away.notModelled.some((n) => /ليس بين أغراضه/.test(n))).toBe(true);
  });
});

describe('the weapon choices in F7 (T193, Codex T194)', () => {
  const items = [
    { id: 2517, name: 'Endless Hunger', group: 'legendary' as const },
    { id: 6697, name: 'Hubris', group: 'legendary' as const },
    { id: 3047, name: 'Plated Steelcaps', group: 'boots' as const },
    { id: 1036, name: 'Long Sword', group: 'basic' as const },
  ];
  it('offers only finished legendaries he holds: no boots, no components', () => {
    expect(destinyOptions([3047, 1036, 222517, 6697], items).map((o) => o.value)).toEqual(['', '2517', '6697']);
  });
  it('keeps a named weapon he no longer holds visible and selected', () => {
    const o = destinyOptions([6697], items, 2517);
    expect(o.find((x) => x.selected)).toEqual({ value: '2517', text: 'Endless Hunger (لم يعد معك)', selected: true });
    expect(o.filter((x) => x.selected)).toHaveLength(1);
  });
  it('selects the held weapon, or "unknown" when none is named', () => {
    expect(destinyOptions([2517], items, 2517).find((x) => x.selected)?.value).toBe('2517');
    expect(destinyOptions([2517], items).find((x) => x.selected)?.value).toBe('');
  });
});
