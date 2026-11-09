import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIGHT, cardGain, fight, needHolds, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
// These tests count attacks exactly; the uptime has its own test.
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const num = (baseValue: number) => ({ baseValue });
const bin = {
  rec: {
    __type: 'CharacterRecord', spells: [],
    baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
    baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
    attackRangeModifiable: num(500), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  },
};
const kit = { damage: 'physical' as const, attacks: true };
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const run = (cards: CardNumbers[] = [], passive?: CardOp[]) => fight({ bin, shop: {}, kit, items: [], cards, level: 1, passive });

describe('the fight', () => {
  it('counts attacks from attack speed', () => {
    expect(run().attacks).toBe(9); // 0.6 a second over 15 seconds, the first at once
  });
  it('raises damage by a flat stat', () => {
    expect(run([card('ad', [{ op: 'add', stat: 'ad', value: 100 }])]).fromAttacks / run().fromAttacks).toBeCloseTo(2);
  });
  it('leaves health and attacks apart', () => {
    const g = cardGain({ bin, shop: {}, kit, items: [], cards: [], level: 1 }, card('hp', [{ op: 'mult', stat: 'hp', factor: 2 }]));
    expect(g.effectiveHp).toBeCloseTo(1);
    expect(g.damage).toBeCloseTo(0);
  });
});

it('starts an amp that needs seconds in combat only then', () => {
  const amp = card('amp', [{ op: 'damage_amp', scope: 'all', factor: 2, needs: '4 seconds in champion combat' } as CardOp]);
  // Attacks at 0, 1.67 and 3.33 s come before it, the other six after.
  // The data holds the amp averaged over the fight (make-card-data.cjs); once its 4 s have passed the fight applies the full amp, 1 + 1 x 15 / 11.
  expect(run([amp]).fromAttacks / run().fromAttacks).toBeCloseTo((3 + 6 * (1 + 15 / 11)) / 9);
});

it('applies an all-damage amp once to an ability, not once for abilities and again for its slot (knowledge/fight-rules.md)', () => {
  const q = { rec: { ...bin.rec, spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [20, 20, 20, 20, 20], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } } };
  const cast = (cards: CardNumbers[]) => fight({ bin: q, shop: {}, kit, items: [], cards, level: 1 }).perCast.Q!;
  expect(cast([card('all', [{ op: 'damage_amp', scope: 'all', factor: 1.2 }])])).toBe(120);
  expect(cast([card('basic', [{ op: 'damage_amp', scope: 'basic', factor: 1.2 }]), card('abilities', [{ op: 'damage_amp', scope: 'abilities', factor: 1.5 }])])).toBe(180); // different scopes still multiply
});
it('starts a burn again at one stack once it has ended (knowledge/fight-rules.md)', () => {
  // Kills at 5 s and 10 s; a 2 s burn of 100 true damage a second: it ends at 7 s, so the second kill starts it at one stack, not two.
  const burn = card('burn', [{ op: 'dot', per_second: { flat: 100 }, duration: 2, type: 'true', stacks_max: 99, trigger: 'kill' }]);
  expect(run([burn]).fromCards).toBeCloseTo(400, -2); // within 50 (steps of 0.05 s); with two stacks it was about 600
});
it('waits the seconds near an enemy a proc names before it fires (Heartsteel, knowledge/fight-rules.md)', () => {
  const proc = (needs?: string) => card('proc', [{ op: 'proc', trigger: 'attack', damage: { flat: 100 }, type: 'true', needs } as CardOp]);
  // Nine attacks in 15 s (every 1.67 s); the first two come before 3 s.
  expect(run([proc()]).fromCards).toBeCloseTo(900);
  expect(run([proc('enemy champion nearby for 3 seconds (6 ticks of 0.5)')]).fromCards).toBeCloseTo(700);
});
it('ends the burns on a target when it dies, so their stacks build again on the next (knowledge/fight-rules.md)', () => {
  // A stack of 10 a second on each attack (every 5/3 s), lasting the fight: 750 on one target; kills at 5 and 10 s start it again: 3 x 100.
  const brand = card('brand', [{ op: 'dot', per_second: { flat: 10 }, duration: 99, type: 'true', stacks_max: 99, trigger: 'attack' }]);
  expect(run([brand]).fromCards).toBeCloseTo(300, -2);
});
it('counts a magic-only shield for the magic share of the enemy damage (Kaenic Rookern, knowledge/fight-rules.md)', () => {
  const shield = card('shield', [{ op: 'shield', amount: { flat: 300 }, trigger: 'kill', needs: 'blocks magic damage only' } as CardOp]);
  const against = (physicalShare: number) => fight({ bin, shop: {}, kit, items: [], cards: [shield], level: 1, enemy: { armor: 50, mr: 50, physicalShare } }).healParts!.ops;
  expect(against(1)).toBe(0); // all physical: it blocks nothing
  expect(against(0)).toBeCloseTo(600); // all magic: two kills, 300 each
});
it('raises bonus resists only, by the factor the data averaged over the fight (Jak Sho, knowledge/fight-rules.md)', () => {
  const plus = card('resists', [{ op: 'add', stat: 'armor', value: 100 }, { op: 'add', stat: 'mr', value: 100 }]);
  const jak = (needs?: string) => card('jak', [{ op: 'mult', stat: 'armor', factor: 1.2, scope: 'bonus', needs }, { op: 'mult', stat: 'mr', factor: 1.2, scope: 'bonus', needs }] as unknown as CardOp[]);
  const base = run([plus]).stats;
  expect(run([plus, jak()]).stats.armor - base.armor).toBeCloseTo(0.2 * (base.armor - run().stats.armor)); // the bonus part, not base armor
  expect(run([plus, jak('5 seconds of champion combat')]).stats.mr - base.mr).toBeCloseTo(0.2 * (base.mr - run().stats.mr)); // the data's 1.2 is already the 30% averaged over the fight
});
it('turns bonus health into a stat after the health multipliers, reading bonus health when the text says bonus (knowledge/fight-rules.md, convert)', () => {
  const health = card('hp', [{ op: 'add', stat: 'hp', value: 2000 }]);
  const rift = card('rift', [{ op: 'convert', from: 'hp', to: 'ap', ratio: 0.02, scope: 'bonus' }]);
  expect(run([health, rift]).stats.ap - run([health]).stats.ap).toBeCloseTo(40); // 2% of 2,000 bonus health, not of 3,000 total
  const engine = card('engine', [{ op: 'mult', stat: 'hp', factor: 2 }]), mail = card('mail', [{ op: 'convert', from: 'bonus_hp', to: 'ad', ratio: 0.1 }]);
  const withEngine = run([health, engine]).stats;
  expect(run([health, engine, mail]).stats.ad - withEngine.ad).toBeCloseTo(0.1 * (withEngine.hp - run().stats.hp)); // the doubled health counts
});
it('converts bonus AD into AP before a zero multiplier gives the AD up (ADAPt)', () => {
  const ad = card('ad', [{ op: 'add', stat: 'ad', value: 60 }]);
  const adapt = card('adapt', [{ op: 'convert', from: 'bonus_ad', to: 'ap', ratio: 1.67 }, { op: 'mult', stat: 'bonus_ad', factor: 0 }, { op: 'mult', stat: 'ap', factor: 1.15 }]);
  const st = run([ad, adapt]).stats;
  expect(st.ap).toBeCloseTo(60 * 1.67 * 1.15);
  expect(st.ad).toBeCloseTo(run().stats.ad); // no bonus AD left
});
it('gives nothing for a card that works after an ultimate cast once the ultimate is locked (Back To Basics with Ultimate Awakening)', () => {
  const lock = card('lock', [{ op: 'lock', key: 'R' }]);
  const awake: CardNumbers = { ...card('awake', [{ op: 'add', stat: 'haste', value: 225 }]), needs: 'The 300 basic haste only for 15s after an ultimate cast, 20s cooldown.' };
  const ult = { ...bin, rec: { ...bin.rec, spells: ['', '', '', 'r'] }, r: { __type: 'SpellObject', mSpell: { cooldownTime: [90, 90, 90, 90] } } };
  const at = (cards: CardNumbers[], level = 6) => fight({ bin: ult, shop: {}, kit, items: [], cards, level });
  expect(at([lock, awake]).stats.haste).toBe(at([lock]).stats.haste);
  expect(at([awake]).stats.haste).toBe(at([]).stats.haste + 225);
  expect(at([awake], 5).stats.haste).toBe(at([], 5).stats.haste);
  expect(run([awake]).stats.haste).toBe(run().stats.haste); // no R spell in this fixture
});
it('reads range in a condition: beyond N by his abilities, within N by his attack range (knowledge/fight-rules.md)', () => {
  const proc = (needs: string) => card('proc', [{ op: 'proc', trigger: 'attack', damage: { flat: 100 }, type: 'true', needs } as CardOp]);
  const q = { rec: { ...bin.rec, spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { castRange: [700, 700, 700, 700, 700, 700] } } };
  const at = (b: Record<string, unknown>, needs: string) => fight({ bin: b, shop: {}, kit, items: [], cards: [proc(needs)], level: 1 }).fromCards;
  expect(at(bin, 'ranged; beyond 600 range')).toBe(0); // no ability reaches past 600
  expect(at(q, 'ranged; beyond 600 range')).toBeGreaterThan(0); // his Q reaches 700
  expect(at(bin, 'target within 300 range')).toBe(0); // he attacks from 500
  expect(at(bin, 'magic damage only, target within 700')).toBeGreaterThan(0);
  expect(at(bin, 'next Attack after an Ability, within 10 seconds')).toBe(at(bin, '')); // seconds, not range
});
it('converts attack speed into crit damage before giving most of it up (Big Shot)', () => {
  const as = card('as', [{ op: 'add', stat: 'attack_speed', value: 1 }]);
  const shot = card('shot', [{ op: 'convert', from: 'attack_speed', to: 'crit_damage', ratio: 0.5 }, { op: 'mult', stat: 'attack_speed', factor: 0.25 }]);
  const before = fight({ bin, shop: {}, kit, items: [], cards: [as], level: 1 }), after = fight({ bin, shop: {}, kit, items: [], cards: [as, shot], level: 1 });
  expect(after.stats.attackSpeed).toBeLessThan(before.stats.attackSpeed); // a quarter of the bonus kept
  const crit = card('crit', [{ op: 'add', stat: 'crit', value: 1 }]);
  const hit = (cards: CardNumbers[]) => fight({ bin, shop: {}, kit, items: [], cards: [crit, ...cards], level: 1 }).fromAttacks / fight({ bin, shop: {}, kit, items: [], cards: [crit, ...cards], level: 1 }).attacks;
  expect(hit([as, shot]) / hit([as])).toBeCloseTo((1.75 + 0.5) / 1.75); // all of the bonus turned into crit damage, not a quarter of it
});
it('keeps a card whose item is not held yet, as unknown, not no (Upgrade Infinity Edge)', () => {
  const need = { class: 'item', items: ['Infinity Edge'] };
  expect(needHolds(need, { owned: [], ranged: true, traits: [] })).toBe('unknown');
  expect(needHolds(need, { owned: ['Infinity Edge'], ranged: true, traits: [] })).toBe('yes');
});
it('fights melee once a card makes him melee (Draw Your Sword)', () => {
  const sword = card('sword', [{ op: 'melee' }]);
  const ranged = run(), melee = run([sword]);
  expect(melee.stats.armor - ranged.stats.armor).toBe(15); // the mode's melee resists
});
it('reads a share of the target bonus health on the bonus part of the target (Sett R)', async () => {
  const { SPELL_HITS } = await import('../../src/ai/cardMathData.js');
  expect(SPELL_HITS['Characters/Sett/Spells/SettRAbility/SettR']?.targetBonusHealth).toBe(true);
  const path = 'Characters/Sett/Spells/SettRAbility/SettR';
  const r = { rec: { ...bin.rec, spells: ['', '', '', path] }, [path]: { __type: 'SpellObject', mSpell: { cooldownTime: [99, 99, 99, 99], DataValues: [{ name: 'MaxHealthDamage', values: [0.5, 0.5, 0.5, 0.5] }], mSpellCalculations: { MaxHealthDamageCalc: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'MaxHealthDamage' }] } } } } };
  const cast = fight({ bin: r, shop: {}, kit, items: [], cards: [], level: 6 }).perCast.R!;
  expect(cast).toBeCloseTo(0.5 * FIGHT.target.hp * (1 - 2415 / 3500), 0);
});
it('lets a mage whose passive works on attacks attack between casts (Diana, Tahm Kench)', () => {
  const mage = { damage: 'magic' as const, attacks: false };
  const onHit: CardOp[] = [{ op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'magic' }];
  expect(fight({ bin, shop: {}, kit: mage, items: [], cards: [], level: 1 }).attacks).toBe(0);
  expect(fight({ bin, shop: {}, kit: mage, items: [], cards: [], level: 1, passive: onHit }).attacks).toBe(3); // a quarter as often, like a physical non-attacker
});
it('casts a short-cooldown spell with a rising cost as often as it can, not once as a toggle (Kog Maw R)', () => {
  const path = 'x/r';
  const r = { rec: { ...bin.rec, spells: ['', '', '', path] }, [path]: { __type: 'SpellObject', mSpell: { cooldownTime: [1, 1, 1, 1], mana: [40, 40, 40], DataValues: [{ name: 'Damage', values: [100, 100, 100, 100] }, { name: 'BaseCost', values: [40, 40, 40, 40] }, { name: 'ManaCostDuration', values: [8, 8, 8, 8] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'Damage' }] } } } } };
  expect(fight({ bin: r, shop: {}, kit, items: [], cards: [], level: 16 }).casts.R).toBeGreaterThan(5);
});
it('raises the heals and shields cards give by heal and shield power', () => {
  const shield = card('shield', [{ op: 'shield', amount: { flat: 300 }, trigger: 'kill' }]);
  const power = card('power', [{ op: 'add', stat: 'heal_shield_power', value: 0.2 }]);
  expect(run([shield, power]).healParts!.ops).toBeCloseTo(1.2 * run([shield]).healParts!.ops);
});
it('gives a mage who does not attack no attacks between casts', () => {
  expect(fight({ bin, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: [], level: 1 }).attacks).toBe(0);
  expect(fight({ bin, shop: {}, kit: { ...kit, attacks: false }, items: [], cards: [], level: 1 }).attacks).toBe(3); // physical: a quarter as often
});

it('lets an ability crit when its calculation reads crit damage', () => {
  const q = (stat: number) => ({ rec: { ...bin.rec, spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [20, 20, 20, 20, 20], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] }, Shown: { mFormulaParts: [{ __type: 'StatByCoefficientCalculationPart', mStat: stat, mCoefficient: 1 }] } } } } });
  const crit = [card('crit', [{ op: 'add', stat: 'crit', value: 0.5 }])];
  const cast = (stat: number) => fight({ bin: q(stat), shop: {}, kit, items: [], cards: crit, level: 1 }).perCast.Q!;
  expect(cast(9) / cast(2)).toBeCloseTo(1 + 0.5 * 0.75, 2); // half the casts crit, for 175%
});

it('raises a stat by a level share plus a share of other stats, after all items (Jhin\'s passive)', () => {
  const byLevel = Array<number>(18).fill(0.1);
  const ad = (crit: number) => run([card('crit', [{ op: 'add', stat: 'crit', value: crit }])], [{ op: 'mult_from', stat: 'ad', byLevel, per: [{ stat: 'crit', ratio: 0.35 }] }]).stats.ad;
  const plain = run().stats.ad;
  expect(ad(0) / plain).toBeCloseTo(1.1); // the level share alone
  expect(ad(1) / plain).toBeCloseTo(1.45); // + 0.35 x 100% crit
});

it('turns bonus move speed into AD by a share that grows with level (Hecarim)', () => {
  const ms = card('ms', [{ op: 'add', stat: 'move_speed', value: 100 }]);
  const passive: CardOp[] = [{ op: 'convert', from: 'bonus_move_speed', to: 'bonus_ad', ratio: { min: 0.12, max: 0.24 } }];
  // The AD comes moment by moment in the fight (move speed changes there), so it shows in damage, not in the item stats.
  const dealt = (cards: CardNumbers[], withPassive: boolean) => fight({ bin, shop: {}, kit, items: [], cards, level: 18, passive: withPassive ? passive : [] }).damage;
  expect(dealt([ms], true)).toBeGreaterThan(dealt([ms], false)); // 24 AD from 100 bonus move speed
  expect(dealt([], true)).toBeCloseTo(dealt([], false)); // no bonus move speed, nothing
});

it('counts an anti-heal item as the share of the enemies\' healing it takes away', () => {
  const shop = { 1: { DataValues: [{ name: 'GrievousAmount', values: [0.4] }] } } as never;
  const enemy = { armor: 0, mr: 0, physicalShare: 1, healPerSecond: 100 };
  const prevented = (items: number[], e = enemy) => fight({ bin, shop, kit, items, cards: [], level: 1, enemy: e }).healingDenied;
  expect(prevented([1]) - prevented([])).toBeCloseTo(0.4 * 100 * FIGHT.seconds); // 40% of 100 a second over the fight
  expect(prevented([1], { ...enemy, healPerSecond: 0 })).toBe(0); // nothing to cut against enemies who don't heal
});

it('reads a spell\'s crit version as what a crit adds, not as its damage (Nasus Q: stacks uncritted)', () => {
  // TotalDamage = 100 + 300 stacks; CritDamage = 1.75 x 100 + 300 stacks, as Nasus's Q file reads.
  const q = { rec: { ...bin.rec, spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [20, 20, 20, 20, 20], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }, { name: 'Stacks', values: [300, 300, 300, 300, 300, 300] }], mSpellCalculations: {
    TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }, { __type: 'NamedDataValueCalculationPart', mDataValue: 'Stacks' }] },
    CritDamage: { mFormulaParts: [{ __type: 'ProductOfSubPartsCalculationPart', mPart1: { __type: 'StatByCoefficientCalculationPart', mStat: 9, mCoefficient: 1 }, mPart2: { __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' } }, { __type: 'NamedDataValueCalculationPart', mDataValue: 'Stacks' }] },
  } } } };
  const cast = (crit: number) => fight({ bin: q, shop: {}, kit, items: [], cards: [card('crit', [{ op: 'add', stat: 'crit', value: crit }])], level: 1 }).perCast.Q!;
  expect(cast(0)).toBeCloseTo(400, 0); // no crit: the base, not the crit version
  expect(Math.abs(cast(0.5) - (400 + 0.5 * 75))).toBeLessThanOrEqual(0.5); // perCast is rounded; a crit adds 75 (175% of the 100), the 300 stacks stay
});

it('grows an item that keeps health from each proc, by level', () => {
  const shop = { 1: { DataValues: [{ name: 'DamageToMaxHealthRatio', values: [0.05] }, { name: 'BaseDamage', values: [100] }, { name: 'HPRatio', values: [0] }] } } as never;
  const hp = (level: number, items: number[]) => fight({ bin, shop, kit, items, cards: [], level }).stats.hp;
  expect(hp(5, [1]) - hp(5, [])).toBeCloseTo(10 * 5); // two procs a level, 5 health each
});

it('starts the next fight with the mana this one left', () => {
  const plain = run();
  expect(plain.again!()).toBe(plain); // no mana: the same fight
  // 100 mana and one ability at 40, no regeneration: greedy, two casts left 20 and the next fight had none; paced over three fights,
  // the first cast goes and the second would cut into the next fights' share, so 60 is kept.
  const caster = { rec: { ...bin.rec, spells: ['x/q'], primaryAbilityResource: { arType: 0, '{726ee5cd}': num(100), '{6216bf7b}': num(0) } }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [2, 2, 2, 2, 2, 2], mana: [40, 40, 40, 40, 40] } } };
  const first = fight({ bin: caster, shop: {}, kit, items: [], cards: [], level: 1 });
  expect(first.casts.Q).toBe(1);
});

it('counts what an item gives the ally he heals, only for a kit that heals allies', () => {
  const healer = { rec: { ...bin.rec, spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [20, 20, 20, 20, 20, 20], DataValues: [{ name: 'BaseHeal', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { HealAmount: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseHeal' }] } } } } };
  const censer = { 1: { DataValues: [{ name: 'AttackSpeedMin', values: [0.25] }, { name: 'OnHitMin', values: [20] }, { name: 'Duration', values: [6] }] } } as never;
  const allies = (buffsAllies: boolean) => fight({ bin: healer, shop: censer, kit: { ...kit, buffsAllies }, items: [1], cards: [], level: 1 }).fromAllies;
  expect(allies(true)).toBeCloseTo((600 * 0.5 * 0.25 + 20 * 1.2) * 6, -1); // one heal at 0, the ally raised for 6 s, give or take one 0.05 s step
  expect(allies(false)).toBe(0);
});

it('crits a cast that deals damage over time with a card that crits damage over time', () => {
  const burn = { rec: { ...bin.rec, spells: ['', '', 'x/e'] }, 'x/e': { __type: 'SpellObject', mSpell: { cooldownTime: [99, 99, 99, 99, 99, 99], DataValues: [{ name: 'BaseDamagePerSecond', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamagePerSecond: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamagePerSecond' }] } } } } };
  const e = (cards: CardNumbers[]) => fight({ bin: burn, shop: {}, kit, items: [], cards, level: 3 }).perCast.E; // level 3: one point in each of Q, W, E (legal ranks)
  expect(e([card('vulnerability', [{ op: 'crit_dot', extra: 0.45 }, { op: 'add', stat: 'crit', value: 0.25 }])])! / e([])!).toBeCloseTo(1 + 0.25 * 0.45);
});

it('gives Jinx\'s minigun its attack speed stacks instead of casting Q', () => {
  const jinx = { rec: { ...bin.rec, spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9], DataValues: [{ name: 'MinigunAttackSpeedMax', values: [5, 30, 55, 80, 105, 130] }, { name: 'MinigunAttackSpeedStacks', values: [3, 3, 3, 3, 3, 3] }, { name: 'MinigunAttackSpeedDuration', values: [2.5, 2.5, 2.5, 2.5, 2.5, 2.5] }] } } };
  const r = fight({ bin: jinx, shop: {}, kit, items: [], cards: [], level: 1 });
  expect(r.attacks).toBe(11); // 9 without; 0.6 + 0.6 x 30% = 0.78 a second once three attacks stacked it
  expect(r.perCast.Q).toBeUndefined();
});
it('leaves out a stat that comes only at low health', () => {
  const nearDeath = card('bloodmail', [{ op: 'mult', stat: 'ad', factor: 1.12, needs: 'full value only at or below 30% remaining Health' } as CardOp]);
  expect(run([nearDeath]).fromAttacks).toBeCloseTo(run().fromAttacks);
});
it('counts a quest reward only once all its quest items are held', () => {
  const ultra: CardNumbers = { id: 2141, name: 'Ultra Hydra', status: 'partial', ops: [{ op: 'add', stat: 'ad', value: 100, after_quest: true }] };
  const at = (items: number[]) => fight({ bin, shop: {}, kit, items, cards: [ultra], level: 1 }).fromAttacks;
  expect(at([3074, 6698])).toBeCloseTo(run().fromAttacks); // two of the three Hydras: no reward
  expect(at([3074, 6698, 3748]) / run().fromAttacks).toBeCloseTo(2);
});
it('starts the next fight with the cooldowns this one left', () => {
  const ult = { rec: { ...bin.rec, spells: ['', '', '', 'x/r'] }, 'x/r': { __type: 'SpellObject', mSpell: { cooldownTime: [90, 90, 90, 90] } } };
  const next = (cards: CardNumbers[]) => { FIGHT.carryCooldowns = true; try { return fight({ bin: ult, shop: {}, kit, items: [], cards, level: 6 }).again!().casts.R; } finally { FIGHT.carryCooldowns = false; } };
  expect(next([])).toBeUndefined(); // cast at 0, back at 90: 35 s into the next fight, which starts at 55
  expect(next([card('haste', [{ op: 'add', stat: 'haste', value: 100 }])])).toBe(1); // back at 45, before it starts
});

it('adds the mode\'s health and resists by attack range, as screens show', () => {
  const at = (range: number) => fight({ bin: { rec: { ...bin.rec, attackRangeModifiable: num(range) } }, shop: {}, kit, items: [], cards: [], level: 10 }).stats;
  expect(at(500).hp).toBeCloseTo(1000 + 20 + (380 * 9) / 17);
  expect(at(500).armor).toBeCloseTo(50);
  expect(at(125).hp).toBeCloseTo(1000 + 20 + (580 * 9) / 17);
  expect(at(125).armor).toBeCloseTo(65);
  expect(at(125).mr).toBeCloseTo(65);
});

describe('what happens over time', () => {
  const excited: CardOp = { op: 'timed', trigger: 'takedown', stat: 'move_speed', value: 1, mode: 'percent', duration: 4 };
  const passive: CardOp[] = [{ op: 'timed', trigger: 'takedown', stat: 'move_speed', value: 1.75, mode: 'percent', duration: 6, decays: true }, { op: 'timed', trigger: 'takedown', stat: 'attack_speed', value: 0.25, mode: 'percent', duration: 6 }];
  const tap = card('tap', [{ op: 'timed', trigger: 'attack', stat: 'move_speed', value: 10, mode: 'add', duration: 5, stacks_max: null, refresh: true }, { op: 'convert', from: 'move_speed', to: 'attack_speed', ratio: 0.001 }]);
  it('gives a buff only for its time', () => {
    expect(run([], passive).attacks).toBeGreaterThan(run().attacks);
    expect(run([], passive).peakMoveSpeed).toBeGreaterThan(run().peakMoveSpeed);
  });
  it('stacks a card on the passive', () => {
    expect(run([card('e', [excited])], passive).peakMoveSpeed).toBeGreaterThan(run([], passive).peakMoveSpeed);
  });
  it('lets speed feed attacks and attacks feed speed', () => {
    const plain = run([], passive), fed = run([tap], passive);
    expect(fed.attacks).toBeGreaterThan(plain.attacks);
    expect(fed.peakMoveSpeed).toBeGreaterThan(plain.peakMoveSpeed);
  });
  it('slows very high speed', () => {
    expect(run([card('e', [{ ...excited, value: 10 }])], [{ op: 'timed', trigger: 'always', stat: 'move_speed', value: 0, mode: 'add', duration: 1 }]).peakMoveSpeed).toBeLessThan(325 * 11);
  });
  it('respects a proc internal cooldown', () => {
    const proc = (internal_cooldown: number | null): CardNumbers => card('p', [{ op: 'proc', trigger: 'attack', internal_cooldown, damage: { flat: 100 }, type: 'true' }]);
    expect(run([proc(null)]).fromCards).toBeCloseTo(900);
    expect(run([proc(5)]).fromCards).toBeLessThan(500);
  });
  it('never fires a takedown card without its trigger', () => {
    expect(run([card('p', [{ op: 'proc', trigger: 'ult_cast', damage: { flat: 100 }, type: 'true' }])]).fromCards).toBe(0);
  });
});

it('reads a bonus that grows with crit chance and crit damage without critting (Caitlyn\'s headshot)', () => {
  const crit = (chance: number, dmg = 0) => card('crit', [{ op: 'add', stat: 'crit', value: chance }, { op: 'add', stat: 'crit_damage', value: dmg }]);
  const passive: CardOp[] = [{ op: 'proc', trigger: 'attack', internal_cooldown: null, damage: { ad_crit: 0.16 }, type: 'true' }];
  const procs = (c: CardNumbers) => fight({ bin, shop: {}, kit, items: [], cards: [c], level: 1, passive }).fromCards;
  expect(procs(crit(0))).toBeCloseTo(0); // no crit chance, nothing
  expect(procs(crit(1, 0.4))).toBeCloseTo(procs(crit(1)) * (1.15 / 0.75), 1); // crit damage 215% against 175%
});

it("cuts incoming attacks only for the enemy's physical share (Plated Steelcaps), and holds it on Steelcaps's id", async () => {
  const { ITEM_NUMBERS } = await import('../../src/ai/cardMathData.js');
  const itemOps = Object.fromEntries(ITEM_NUMBERS.map((x) => [x.id, x.ops]));
  expect(itemOps[3047]?.some((x) => x.op === 'add' && x.stat === 'damage_reduction')).toBe(true);
  expect(itemOps[3174]).toBeUndefined(); // Shushei's Mana Jug held it by mistake
  const hp = (items: number[], physicalShare: number) => fight({ bin, shop: { 3047: {} } as never, kit, items, cards: [], level: 1, itemOps, enemy: { armor: 50, mr: 50, physicalShare } }).effectiveHp;
  for (const p of [0, 0.5, 1]) expect(hp([3047], p) / hp([], p)).toBeCloseTo(1 / (1 - 0.1 * p));
});

it('raises the heals, shields and vamp he receives by Spirit Visage, not what he gives', () => {
  const shop = { 3065: { DataValues: [{ name: 'HealingIncrease', values: [0.25] }, { name: 'ShieldIncrease', values: [0.25] }] } } as never;
  const cards = [card('self', [
    { op: 'heal', amount: { flat: 100 }, trigger: 'kill' } as CardOp,
    { op: 'shield', amount: { flat: 200 }, trigger: 'kill' } as CardOp,
    { op: 'add', stat: 'omnivamp', value: 0.1 },
    { op: 'add', stat: 'life_steal', value: 0.1 },
  ])];
  const at = (items: number[]) => fight({ bin, shop, kit, items, cards, level: 1 });
  const a = at([]), v = at([3065]);
  for (const k of ['ops', 'shields', 'omnivamp', 'lifeSteal'] as const) expect(v.healParts![k]).toBeCloseTo(1.25 * a.healParts![k]!);
  expect(v.healedHp).toBeCloseTo(1.25 * a.healedHp);
  expect(v.abilityHealing).toBe(a.abilityHealing);
});

it("attacks at a kit's own pace when it names one (a melee fighter busy with his abilities)", () => {
  expect(fight({ bin, shop: {}, kit: { ...kit, attackPace: 0.25 }, items: [], cards: [], level: 1 }).attacks).toBe(3); // every 6.67 s instead of every 1.67 s
  expect(run().attacks).toBe(9);
});

it("takes a share of the cast ability's cooldown off the others (Archmage: 30%, another ability at random)", () => {
  const spell = (n: number) => ({ __type: 'SpellObject', mSpell: { cooldownTime: [10, 10, 10, 10, 10, 10], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: n }] } } } });
  const b = { ...bin, rec: { ...bin.rec, spells: ['x/q', 'x/w'] }, 'x/q': spell(100), 'x/w': spell(100) };
  const archmage = card('Archmage', [{ op: 'refund', scope: 'other_ability', amount: 0.3, unit: 'cast_share', trigger: 'ability_cast' }]);
  const casts = (cards: CardNumbers[]) => Object.values(fight({ bin: b, shop: {}, kit, items: [], cards, level: 3 }).casts).reduce((n, x) => n + x, 0);
  expect(casts([archmage])).toBeGreaterThan(casts([]));
});

it("waits for the enemies' damage to take his health below an effect's mark (Sterak's: on falling below 30% Health)", () => {
  const shield = card('low', [{ op: 'shield', amount: { flat: 500 }, trigger: 'periodic', internal_cooldown: 90, needs: 'on falling below 30% Health' } as CardOp]);
  const at = (incomingDps: number) => fight({ bin, shop: {}, kit, items: [], cards: [shield], level: 1, incomingDps }).healParts!.ops;
  expect(at(10)).toBe(0); // 1,500 effective health lasts far past the 15 s fight at 10 a second
  expect(at(1000)).toBeGreaterThan(0); // falls below 30% in about a second
});

describe('effects that wait seconds of champion combat (timing)', () => {
  // A Q of 1 x his armor every 4 s, at 0, 4, 8 and 12 s; 100 bonus armor; magic kit, no attacks.
  const armorQ = { rec: { ...bin.rec, spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [4, 4, 4, 4, 4, 4], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'StatByCoefficientCalculationPart', mStat: 1, mCoefficient: 1 }] } } } } };
  const armor = card('armor', [{ op: 'add', stat: 'armor', value: 100 }]);
  const jakSho = (needs?: string) => card('jak', [{ op: 'mult', stat: 'armor', factor: 1.2, scope: 'bonus', ...(needs ? { needs } : {}) } as CardOp]); // the stored average of +30% after 5 s
  const at = (cards: CardNumbers[]) => fight({ bin: armorQ, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 1 });
  it("gives Jak'Sho's full bonus only after its 5 s, and keeps its average in effective health", () => {
    const plain = at([armor]), timed = at([armor, jakSho('5 seconds of champion combat')]), flat = at([armor, jakSho()]);
    expect(timed.fromAbilities / plain.fromAbilities).toBeCloseTo((150 + 150 + 180 + 180) / 600); // bonus 100 before 5 s, 130 after
    expect(flat.fromAbilities / plain.fromAbilities).toBeCloseTo(170 / 150); // the old reading: 120 bonus all fight
    expect(timed.effectiveHp).toBeCloseTo(flat.effectiveHp);
    expect(timed.stats.armor).toBeCloseTo(flat.stats.armor);
  });
  it("heals Riftmaker's omnivamp only from the damage dealt after its 4 s", () => {
    const vamp = card('rift', [{ op: 'add', stat: 'omnivamp', value: 0.1 * 11 / 15, needs: '4 seconds in champion combat' } as CardOp]);
    const r = fight({ bin, shop: {}, kit, items: [], cards: [vamp], level: 1 });
    const own = r.fromAbilities + r.fromAttacks + r.fromCards;
    expect(r.healParts!.omnivamp).toBeCloseTo(0.1 * (own - r.damageBySecond[3]!));
  });
});
