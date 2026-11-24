import { describe, expect, it } from 'vitest';
import { parseAugmentProgress } from '../../src/ai/augmentProgress.js';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fightValue, mathBuild, searchSet } from '../../src/ai/itemMath.js';
import { destinyOptions } from '../../src/renderer/destinyOptions.js';

// T193 prototype: Weapon of Destiny (3081) grows the named weapon's own AD and omnivamp, 0.2 unit a kill (provisional) from the later of the pick and the weapon's completion (T196e)
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
  6694: { DataValues: [dv('FlatPhysicalDamageMod', 55), dv('PhysicalLethality', 18), dv('AbilityHasteMod', 10)] }, // Hubris-like (T196e)
  3153: { DataValues: [dv('FlatPhysicalDamageMod', 40), dv('PercentAttackSpeedMod', 0.25), dv('PercentLifeStealMod', 0.1)] }, // BotRK-like (T196e)
} as never;
const wod = CARD_NUMBERS.find((c) => c.id === 3081)!;
const run = (items: number[], card?: Partial<CardNumbers>) => fight({ bin: { rec }, shop, kit: { damage: 'physical', attacks: true }, items, cards: card ? [{ ...wod, acquiredLevel: 3, ...card }] : [], level: 18 });
const kills = 0.67 * (18 - 9); // KILLS_PER_LEVEL from the later of the pick (level 3) and the weapon's estimated completion (level 9, T196e)

describe('Weapon of Destiny (T193 prototype)', () => {
  it('has a row: per kill, 0.2 unit, AD 30 and omnivamp 0.25 a unit', () => {
    expect(wod.status).toBe('partial');
    // T196e: every family the file names that the fight has a stat for.
    expect(wod.ops).toEqual([{ op: 'destiny', per: 'kill', unit: 0.2, upgrades: { ad: 30, ap: 50, crit: 0.25, crit_damage: 0.06, attack_speed: 0.4, haste: 20, armor: 50, mr: 50, lethality: 20, armor_pen: 0.15, magic_pen: 0.09, life_steal: 0.25, omnivamp: 0.25, mana: 1000, hp: 375 } }]);
    expect(wod.not_modelled).toMatch(/Not counted: UpgradeHSPower/);
  });

  it('takes the weapon from the player (progress.destinyItem) and refuses a bad one', () => {
    expect(parseAugmentProgress({ level: 11, destinyItem: 2517 })?.destinyItem).toBe(2517);
    expect(parseAugmentProgress({ level: 11 })?.destinyItem).toBeUndefined();
    for (const bad of [0, -1, 1.5, '2517']) expect(() => parseAugmentProgress({ level: 11, destinyItem: bad })).toThrow('bad destiny item');
  });

  it('grows the named weapon\'s AD and omnivamp per kill since its counting starts', () => {
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

  // T196e (Codex T196e answer 2): kills before the weapon exists cannot grow it. The completion is not read: estimated at level 9, and said so.
  it('counts kills from the later of the pick and the weapon\'s completion, the completion estimated and said so (T196e)', () => {
    const base = run([2517]);
    const early = run([2517], { destinyItem: 2517, acquiredLevel: 3 }), late = run([2517], { destinyItem: 2517, acquiredLevel: 12 });
    expect(early.stats.ad - base.stats.ad).toBeCloseTo(0.2 * 30 * 0.67 * (18 - 9), 6); // picked before the weapon: from its completion
    expect(late.stats.ad - base.stats.ad).toBeCloseTo(0.2 * 30 * 0.67 * (18 - 12), 6); // picked after it: from the pick
    const note = early.notModelled.find((n) => n.includes('وقت اكتمال السلاح غير معروف'));
    expect(note).toMatch(/المقدّر بالمستوى 9/);
    expect(note).toMatch(/0\.2 وحدة لكل قتل تقديرية/);
    expect(wod.not_modelled).toMatch(/0\.2 unit a kill is provisional/);
    // At level 7 the weapon he holds was completed by now at the latest: the estimate never passes his level, so nothing has grown yet.
    const at7 = (card?: Partial<CardNumbers>) => fight({ bin: { rec }, shop, kit: { damage: 'physical', attacks: true }, items: [2517], cards: card ? [{ ...wod, acquiredLevel: 3, ...card }] : [], level: 7 });
    expect(at7({ destinyItem: 2517 }).stats.ad).toBeCloseTo(at7().stats.ad, 9);
    expect(at7({ destinyItem: 2517 }).notModelled.some((n) => /المقدّر بالمستوى 7/.test(n))).toBe(true);
  });

  // T212 with T196e: none named and none held, the weapon is the first legendary in his items' order, counted from the same start as a named one.
  it('with none named (destinyFrom), grows the first legendary in his items\' order, from the T196e start (T212)', () => {
    const from = { destinyFrom: [2517, 3031] };
    const hungerFirst = run([2517, 3031], from), edgeFirst = run([3031, 2517], from), named = run([3031, 2517], { destinyItem: 3031 });
    expect(hungerFirst.stats.ad - run([2517, 3031]).stats.ad).toBeCloseTo(0.2 * 30 * kills, 6);
    expect(hungerFirst.healParts!.omnivamp).toBeGreaterThan(run([2517, 3031]).healParts!.omnivamp); // Endless Hunger first: its omnivamp grows
    expect(edgeFirst.stats.ad).toBeCloseTo(named.stats.ad, 9); // Infinity Edge first: the same as naming it
    expect(edgeFirst.healParts!.omnivamp).toBeCloseTo(named.healParts!.omnivamp, 9); // Hunger's omnivamp is not grown (it heals more only from the added AD)
    const none = run([6694], { destinyFrom: [2517, 3031] }); // no legendary of the list held yet: unknown, said as before
    expect(none.stats.ad).toBe(run([6694]).stats.ad);
    expect(none.notModelled.some((n) => /سلاح المصير غير محدد/.test(n))).toBe(true);
  });

  // T212 v3 (Codex T212 v2, fix 1): the search's sorted keys made [Hunger, Edge] and [Edge, Hunger] one state; Edge first is worth more here.
  it('the item search keeps the weapon in its states and buys it first: the reverse-order build is chosen (T212 v3)', () => {
    const card = { ...wod, acquiredLevel: 3, destinyFrom: [2517, 3031] };
    const place = { share: 0.2, rise: 0, health0: 1000, enemyDps: 500, absorbedWorth: 1 } as never;
    const kit = { damage: 'physical', attacks: true } as never;
    const value = (items: number[]) => fightValue(fight({ bin: { rec }, shop, kit, items, cards: [card], level: 18 }), place);
    expect(value([3031, 2517])).toBeGreaterThan(value([2517, 3031])); // Codex's probe: 11,657.61 against 10,512.67
    const args = { start: [], candidates: [2517, 3031], slots: 2, width: 3, swaps: true, fits: (id: number, held: number[]) => !held.includes(id), value };
    expect(searchSet({ ...args, orderKey: (ids) => String(ids.find((id) => [2517, 3031].includes(id)) ?? '') })).toEqual([3031, 2517]);
    expect(searchSet(args)).toEqual([2517, 3031]); // the old sorted key alone: one state, the first order seen
    const pool = [{ id: 2517, gold: 3000, boots: false }, { id: 3031, gold: 3000, boots: false }];
    const steps = mathBuild({ bin: { rec }, shop, kit, cards: [card], pool, owned: [], required: [], place, noBoots: true });
    expect(steps.map((s) => s.id)).toEqual([3031, 2517]); // the set and its purchase order are the ones the search valued
    // Named, the order no longer matters to the weapon: no weapon key, the build is the same set.
    expect(new Set(mathBuild({ bin: { rec }, shop, kit, cards: [{ ...wod, acquiredLevel: 3, destinyItem: 3031 }], pool, owned: [], required: [], place, noBoots: true }).map((s) => s.id))).toEqual(new Set([2517, 3031]));
  });

  // T212 v3 (Codex T212 v2, fix 3): no legendary held at his level now, the planned weapon is completed no earlier than that level.
  it('counts no kill before the level he held no legendary at (destinyAfter, T212 v3)', () => {
    const from = { destinyFrom: [2517, 3031] };
    const at12 = run([2517], { ...from, destinyAfter: 12 }), base = run([2517]);
    expect(at12.stats.ad - base.stats.ad).toBeCloseTo(0.2 * 30 * 0.67 * (18 - 12), 6); // not from 9
    expect(at12.notModelled.some((n) => /المقدّر بالمستوى 12/.test(n))).toBe(true);
    expect(run([2517], { ...from, destinyAfter: 5 }).stats.ad - base.stats.ad).toBeCloseTo(0.2 * 30 * kills, 6); // below 9: the estimate stands
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

  // T196e: the screen tooltips grow every family by one unit count: Hubris 55/18/10 -> 73 AD, 30 lethality, 22 haste (0.6 unit);
  // BotRK 40 AD / 25% AS / 10% life steal -> 92 / 94.33% / 53.33% (1.733 units). Here: the same unit count across the weapon's families.
  it('grows each family the weapon has by its own upgrade, one unit count for all (T196e)', () => {
    const u = 0.2 * kills;
    const hb = run([6694]), hg = run([6694], { destinyItem: 6694 });
    expect(hg.stats.ad - hb.stats.ad).toBeCloseTo(30 * u, 6);
    expect(hg.stats.haste - hb.stats.haste).toBeCloseTo(20 * u, 6);
    expect(hg.healParts!.lifeSteal).toBe(0); // Hubris has no life steal: none grows (lethality is not in the returned stats)
    const bb = run([3153]), bg = run([3153], { destinyItem: 3153 });
    expect(bg.stats.ad - bb.stats.ad).toBeCloseTo(30 * u, 6);
    expect(bg.stats.attackSpeed - bb.stats.attackSpeed).toBeCloseTo(0.4 * u, 6); // record ratio 1, under the 2.5 cap
    expect(bg.healParts!.lifeSteal).toBeGreaterThan(bb.healParts!.lifeSteal);
    expect(bg.stats.haste).toBe(bb.stats.haste); // BotRK has no haste: none grows
  });
});
