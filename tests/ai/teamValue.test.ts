import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { enemyTeam, fightValue, mathBuild, teamPlace } from '../../src/ai/itemMath.js';
import type { GameItem } from '../../src/texts/gameData.js';

beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const num = (baseValue: number) => ({ baseValue });
const binOf = (range = 500, armor = 50, mr = 50) => ({
  rec: {
    __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(range),
    baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
    baseArmorModifiable: num(armor), armorPerLevelModifiable: num(0), baseMR: num(mr), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
    attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  },
});
const bin = binOf();
const kit = { damage: 'physical' as const, attacks: true };
const card = (ops: CardOp[]): CardNumbers => ({ id: 1, name: 'x', status: 'computed', ops });
const item = (stats: Record<string, number>, limits?: string[]) => ({ limits, DataValues: Object.entries(stats).map(([name, v]) => ({ name, values: [v] })) }) as unknown as GameItem;
const run = (ops: CardOp[], o: Partial<Parameters<typeof fight>[0]> = {}) => fight({ bin, shop: {}, kit, items: [], cards: [card(ops)], level: 1, ...o });

describe('the fight, as games showed it', () => {
  it('fires an attack after an ability no faster than attacks come', () => {
    expect(run([{ op: 'proc', trigger: 'next_attack', damage: { flat: 100 }, type: 'true' }]).fromCards).toBe(0); // no ability, no such attack
  });
  it('fires a summoner spell card once in a fight, not on every hit', () => {
    const spell = { __type: 'SpellObject', mSpell: { mClientData: {}, cooldownTime: [0, 1, 1, 1, 1, 1, 1], mSpellCalculations: { Damage: { mFormulaParts: [{ mNumber: 10, __type: 'NumberCalculationPart' }], __type: 'GameCalculation' } } } };
    const caster = { ...binOf(), rec: { ...binOf().rec, spells: ['s'] }, s: spell };
    const once = run([{ op: 'proc', trigger: 'spell_hit', damage: { flat: 100 }, type: 'true' }], { bin: caster }).fromCards;
    expect(once).toBe(100);
  });
  it('turns a share of attacks into second hits', () => {
    const with3rd = run([{ op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'true' }, { op: 'on_hit_repeat', extra_hits: 0.5, trigger: 'attack' }]);
    expect(with3rd.fromCards).toBeCloseTo(10 * (with3rd.attacks + Math.floor(with3rd.attacks / 2)));
  });
  it("adds Runaan's bolts at other enemies: two for a ranged champion, one for melee, each a share of an attack, with their on-hits", () => {
    const bolts: CardOp = { op: 'bolts', ranged: 2, melee: 1, ad: 0.6 };
    const share = FIGHT.boltHitShare;
    expect(run([bolts]).fromAttacks / run([]).fromAttacks).toBeCloseTo(1 + 2 * share * 0.6);
    expect(run([bolts], { bin: binOf(125) }).fromAttacks / run([], { bin: binOf(125) }).fromAttacks).toBeCloseTo(1 + share * 0.6);
    const onHit: CardOp = { op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'true' };
    const r = run([onHit, bolts]);
    expect(r.fromCards).toBeCloseTo(10 * (r.attacks + Math.floor(r.attacks * 2 * share)));
  });
  it('reads a ratio on AP that grows with bonus health (Tahm Kench: 1.25% AP per 100 bonus health)', () => {
    const r = run([{ op: 'add', stat: 'ap', value: 300 }, { op: 'add', stat: 'hp', value: 10000 }, { op: 'proc', trigger: 'attack', internal_cooldown: 100, damage: { ap_per_bonus_hp: 0.000125 }, type: 'true' }]);
    expect(r.fromCards).toBeCloseTo(300 * 10000 * 0.000125); // 1.25 x AP = 375
  });
  it('sets off spellblade on ability hits when abilities apply on-hit (Ethereal Weapon), its cooldown kept', () => {
    const spell = { __type: 'SpellObject', mSpell: { mClientData: {}, cooldownTime: [1, 1, 1, 1, 1, 1, 1], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ mNumber: 10, __type: 'NumberCalculationPart' }], __type: 'GameCalculation' } } } };
    const caster = { ...binOf(), rec: { ...binOf().rec, spells: ['q'] }, q: spell };
    const blade: CardOp = { op: 'proc', trigger: 'next_attack', internal_cooldown: 1.5, damage: { flat: 100 }, type: 'true' };
    const mage = { damage: 'magic' as const, attacks: false };
    expect(run([blade], { bin: caster, kit: mage }).fromCards).toBe(0); // no attacks, no spellblade
    const r = run([blade, { op: 'abilities_on_hit' }], { bin: caster, kit: mage });
    expect(r.fromCards).toBeGreaterThan(0);
    expect(r.fromCards).toBeLessThanOrEqual(100 * Math.ceil(FIGHT.seconds / 1.5)); // no faster than its cooldown
  });
  it('paces mana over the fights in a row, so haste never lowers what three fights deal', () => {
    const spell = { __type: 'SpellObject', mSpell: { mClientData: {}, mana: [50, 50, 50, 50, 50], cooldownTime: [3, 3, 3, 3, 3, 3, 3], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ mNumber: 100, __type: 'NumberCalculationPart' }], __type: 'GameCalculation' } } } };
    const caster = { ...binOf(), rec: { ...binOf().rec, spells: ['q'], primaryAbilityResource: { arType: 0, '{726ee5cd}': num(600) } }, q: spell };
    const mage = { damage: 'magic' as const, attacks: false };
    const three = (haste: number) => { let x = run([{ op: 'add', stat: 'haste', value: haste }], { bin: caster, kit: mage }); let total = 0; for (let n = 0; n < 3; n++) { total += x.damage; x = x.again?.() ?? x; } return total; };
    expect(three(200)).toBeGreaterThanOrEqual(three(0)); // greedy, 200 haste emptied 600 mana in the first fight and dealt less over three
  });
  it('reads a ratio on bonus armor apart from total armor', () => {
    const r = run([{ op: 'add', stat: 'armor', value: 100 }, { op: 'proc', trigger: 'attack', internal_cooldown: 100, damage: { bonus_armor: 1 }, type: 'true' }]);
    expect(r.fromCards).toBeCloseTo(100);
  });
  it('takes flat magic penetration off the target', () => {
    const pen = { 1: item({ FlatMagicPenetrationMod: 60 }) };
    const r = fight({ bin, shop: pen, kit, items: [1], cards: [card([{ op: 'proc', trigger: 'attack', internal_cooldown: 100, damage: { flat: 100 }, type: 'magic' }])], level: 1 });
    expect(r.fromCards).toBeCloseTo(100);
  });
  it('counts life steal on attacks as his own healing', () => {
    const r = run([{ op: 'add', stat: 'life_steal', value: 0.5 }]);
    expect(r.healedHp).toBeCloseTo(0.5 * r.fromAttacks * (r.effectiveHp / r.stats.hp));
  });
  it('turns healing into damage when a card says so', () => {
    const heal: CardOp = { op: 'heal', amount: { flat: 100 }, trigger: 'attack', internal_cooldown: 100 };
    expect(run([heal, { op: 'heal_damage', ratio: 0.7 }]).fromCards).toBeCloseTo(70 * (100 / 160));
  });
});

describe('a real team', () => {
  const physical = { bin: binOf(500, 100, 20), kit: { damage: 'physical' as const, attacks: true } };
  const magic = { bin: binOf(500, 20, 100), kit: { damage: 'magic' as const, attacks: false } };
  it('takes the enemies\' mean resists and the kind of their damage', () => {
    const e = enemyTeam([physical, magic], {})!;
    expect(e.physicalShare).toBe(0.5);
    expect(e.armor).toBeCloseTo(60);
    expect(enemyTeam([], {})).toBeUndefined();
  });
  it('counts an enemy\'s items for his resists only when he holds them in the running match', () => {
    const shop = { 1: { DataValues: [{ name: 'FlatArmorMod', values: [100] }] } } as never;
    const armor = (live: boolean) => enemyTeam([{ ...physical, items: [1], live }], shop)!.armor;
    expect(armor(true) - armor(false)).toBeCloseTo(100); // guessed builds keep resists item-free (the owner, 2026-11-04)
  });
  it('takes a share of health from the real enemies\' health', () => {
    const share: CardOp = { op: 'proc', trigger: 'attack', internal_cooldown: 100, damage: { target_max_hp: 0.1 }, type: 'true' };
    expect(run([share]).fromCards).toBeCloseTo(0.1 * FIGHT.target.hp);
    expect(run([share], { enemy: { armor: 0, mr: 0, physicalShare: 0.5, hp: 7000 } }).fromCards).toBeCloseTo(700);
    expect(enemyTeam([physical, magic], {})!.hp).toBeGreaterThan(0);
  });
  it('weighs his resists by the kind of their damage', () => {
    const r = (physicalShare: number) => fight({ bin: binOf(500, 100, 0), shop: {}, kit, items: [], cards: [], level: 1, enemy: { armor: 0, mr: 0, physicalShare } });
    expect(r(1).effectiveHp / r(1).stats.hp).toBeCloseTo(2);
    expect(r(0).effectiveHp / r(0).stats.hp).toBeCloseTo(1);
  });
  it('lowers his share beside allies who draw more fire', () => {
    const base = { championId: 999999, bin, shop: {}, kit };
    const big = { rec: { ...binOf(125, 200, 200).rec, baseHPModifiable: num(5000) } };
    expect(teamPlace({ ...base, allies: [big, big, big, big] }).share).toBeLessThan(teamPlace(base).share);
  });
  it('lets a champion hold only one item of a group the game limits', () => {
    const shop = { 1: item({ FlatPhysicalDamageMod: 100 }, ['pen']), 2: item({ FlatPhysicalDamageMod: 90 }, ['pen']), 3: item({ FlatPhysicalDamageMod: 10 }) };
    const pool = [1, 2, 3].map((id) => ({ id, gold: 3000, boots: false }));
    const ids = mathBuild({ bin, shop, kit, cards: [], pool, owned: [], required: [], place: teamPlace({ championId: 999999, bin, shop, kit }) }).map((s) => s.id);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2);
  });
  it('stops counting healing on allies once he has fallen', () => {
    const place = { share: 0.2, rise: 0, health0: 1000, enemyDps: 1000, absorbedWorth: 1, healWorth: 1, carriesHealth: true };
    const result = (effectiveHp: number) => ({ damage: 0, damageBySecond: [], effectiveHp, abilityHealing: 300 }) as never;
    expect(fightValue(result(1500), place)).toBeCloseTo(1500 + 0.8 * 150); // lasts half the fight; healing others keeps the team's 0.8
    expect(fightValue(result(3000), place)).toBeCloseTo(3000 + 0.8 * 300);
  });
});
