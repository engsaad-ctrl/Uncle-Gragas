import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIGHT, cardGain, fight, needHolds, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';
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

it('limits Ethereal Weapon on-hit damage to one trigger per second on the same target', () => {
  const ethereal = CARD_NUMBERS.find((c) => c.id === 1029)!;
  const onHit = card('On-hit', [{ op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'true' }]);
  const spell = (native = false) => ({ mSpell: {
    cooldownTime: [30, 30], mApplyAttackEffect: native,
    mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } },
  } });
  const cast = (native = false) => fight({
    bin: { rec: { ...bin.rec, spells: ['q', 'w', 'e'] }, q: spell(), w: spell(native), e: spell() },
    shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: [ethereal, onHit], level: 3,
  }).fromCards;
  expect(cast()).toBe(20); // first and third casts, 1.5 seconds apart
  expect(cast(true)).toBe(30); // the middle cast applies its own on-hit independently
  const killTimes = FIGHT.killTimes;
  try {
    FIGHT.killTimes = [1];
    expect(cast()).toBe(20); // second is still blocked, third hits the next target
    FIGHT.killTimes = [0.5, 1];
    expect(cast()).toBe(30); // each cast hits a different target
  } finally { FIGHT.killTimes = killTimes; }
});

describe('the fight', () => {
  it('refunds only the long-range basic ability that hit with Skilled Sniper', () => {
    const sniper = CARD_NUMBERS.find((c) => c.id === 1113)!;
    const spell = (range: number, name = 'Damage') => ({ mSpell: {
      cooldownTime: [30, 30], castRange: [range, range],
      mSpellCalculations: { [name]: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } },
    } });
    const cast = (range: number, name?: string) => fight({
      bin: { rec: { ...bin.rec, spells: ['q', 'w', 'e', 'r'] }, q: spell(range, name), w: spell(400), r: spell(1000) },
      shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: [sniper], level: 6,
      knownRanks: { level: 6, ranks: { Q: 1, W: 1, E: 0, R: 1 } },
    }).casts;
    expect(cast(700)).toMatchObject({ Q: 3, W: 1, R: 1 });
    expect(cast(700, 'DamagePerSecond')).toMatchObject({ Q: 2, W: 1, R: 1 });
    expect(cast(600)).toMatchObject({ Q: 1, W: 1, R: 1 });
  });

  it('counts Guinsoo phantom hits only on every third attack while already at four stacks', () => {
    const guinsoo = ITEM_NUMBERS.find((i) => i.id === 3124)!;
    const cards = [card('On-hit', [{ op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'true' }])];
    const at = (speed: number) => fight({
      bin: { rec: { ...bin.rec, attackSpeedModifiable: num(speed) } },
      shop: { 3124: {} } as never, kit, items: [3124], itemOps: { 3124: guinsoo.ops }, cards, level: 1,
      enemy: { armor: 0, mr: 0, physicalShare: 0.5 },
    });
    const slow = at(0.22), fast = at(0.6);
    expect(slow).toMatchObject({ attacks: 4, fromCards: 160 }); // every gap exceeds the four-second stack duration
    expect(fast.attacks).toBeGreaterThanOrEqual(7);
    expect(fast.fromCards).toBe(40 * (fast.attacks + Math.floor((fast.attacks - 4) / 3)));
  });

  it('keeps the Dusk and Dawn on-hit repeat on its Spellblade cooldown', () => {
    const dusk = ITEM_NUMBERS.find((i) => i.id === 2510)!;
    const spell = { mSpell: { cooldownTime: [30, 30] } };
    const cards = [card('On-hit', [{ op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'true' }])];
    const at = (delay: number, ops: CardOp[]) => fight({
      bin: { rec: { ...bin.rec, spells: ['q', 'w'], attackSpeedModifiable: num(2) }, q: spell, w: spell },
      shop: { 2510: {} } as never, kit, items: [2510], itemOps: { 2510: ops },
      cards, level: 2, cooldowns: { W: delay },
    }).fromCards;
    const extra = (delay: number) => at(delay, dusk.ops) - at(delay, dusk.ops.filter((x) => x.op !== 'on_hit_repeat'));
    expect(extra(0)).toBeCloseTo(10);
    expect(extra(3)).toBeCloseTo(20);
  });

  it('does not let other on-hit repeats trigger Double Tap before a critical attack', () => {
    const doubleTap = CARD_NUMBERS.find((c) => c.id === 2010)!;
    const cards = [
      doubleTap,
      card('Other repeats', [{ op: 'on_hit_repeat', extra_hits: 0.5, trigger: 'attack' }]),
      card('On-hit', [{ op: 'proc', trigger: 'on_hit', damage: { flat: 10 }, type: 'true' }]),
    ];
    const at = (speed: number) => fight({
      bin: { rec: { ...bin.rec, attackSpeedModifiable: num(speed) } },
      shop: {}, kit, items: [], cards, level: 1,
    });
    expect(at(0.2)).toMatchObject({ attacks: 3, fromCards: 40 }); // three attacks, one repeat, no crit
    expect(at(0.25)).toMatchObject({ attacks: 4, fromCards: 70 }); // four attacks, two other repeats, one Double Tap
  });

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

it('gates The Boom and the Bass on a cast and consumes its six-second charge once', () => {
  const boom = CARD_NUMBERS.find((c) => c.id === 3078)!;
  expect(run([boom]).fromCards).toBe(0);

  const withCast = (range: number, speed: number) => fight({
    bin: {
      rec: { ...bin.rec, spells: ['x/q'], attackRangeModifiable: num(range), attackSpeedModifiable: num(speed) },
      'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [20, 20, 20, 20, 20] } },
    },
    shop: {}, kit, items: [], cards: [boom], level: 1,
  });
  expect(withCast(500, 0.6).fromCards).toBeCloseTo(25 / 1.6);
  expect(withCast(175, 0.6).fromCards).toBeCloseTo(50 / 1.6);
  expect(withCast(500, 0.1).fromCards).toBe(0);
});

describe('immobilize events (T002)', () => {
  const MORGANA_Q = 'Characters/Morgana/Spells/MorganaQAbility/MorganaQ';
  const cruelty = CARD_NUMBERS.find((c) => c.id === 1323)!;
  const courage = CARD_NUMBERS.find((c) => c.id === 1018)!;
  const spell = (o: { damage?: number; root?: number; cooldown?: number; tagged?: boolean } = {}) => ({ mSpell: {
    cooldownTime: [o.cooldown ?? 4, o.cooldown ?? 4],
    mSpellTags: o.tagged ? ['Trait_ImmobilizingCCSpell'] : [],
    DataValues: o.root === undefined ? [] : [{ name: 'RootDuration', values: [o.root, o.root] }],
    mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: o.damage ?? 100 }] } },
  } });
  const run = (q: ReturnType<typeof spell>, cards: CardNumbers[], qPath = MORGANA_Q) => fight({
    bin: { rec: { ...bin.rec, spells: [qPath, 'w', 'e'] }, [qPath]: q, w: spell({ cooldown: 4 }) },
    shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards, level: 3,
    knownRanks: { level: 3, ranks: { Q: 1, W: 1, E: 0, R: 0 } },
  });

  it('raises one root event per landed hit of a checked ability, with its file duration', () => {
    const r = run(spell({ root: 2, tagged: true }), []);
    expect(r.casts.Q).toBeGreaterThan(1);
    expect(r.ccEvents).toHaveLength(r.casts.Q!);
    expect(r.ccEvents.every((e) => e.key === 'Q' && e.kind === 'root' && e.duration === 2 && e.target === 'main')).toBe(true);
  });

  it('raises none from a tagged ability nobody checked, and says so when a card waits on it', () => {
    const r = run(spell({ root: 2, tagged: true }), [courage], 'q');
    expect(r.ccEvents).toHaveLength(0);
    expect(r.healParts?.shields ?? 0).toBe(0);
    expect(r.notModelled.some((n) => n.includes('شل الحركة') && n.includes('Q'))).toBe(true);
  });

  it('raises none from a cast that deals nothing or a hit with no root at this rank', () => {
    expect(run(spell({ damage: 0, root: 2 }), [courage]).ccEvents).toHaveLength(0);
    expect(run(spell({ root: 0 }), [courage]).ccEvents).toHaveLength(0);
    expect(run(spell({}), [courage]).ccEvents).toHaveLength(0); // no duration field: the condition isn't shown, no event
  });

  it("fires the card only on the root, not on the other ability's hits", () => {
    const withRoot = run(spell({ root: 2 }), [courage]);
    const noRoot = run(spell({ root: 0 }), [courage]);
    expect(noRoot.casts.W).toBeGreaterThan(0); // W lands hits, none of them immobilizes
    expect(noRoot.healParts?.shields ?? 0).toBe(0);
    expect(withRoot.healParts?.shields ?? 0).toBeGreaterThan(0); // its amount is checked from the card's own numbers (T005 block below)
  });

  it("keeps Cruelty's 6 s cooldown between roots", () => {
    const fast = run(spell({ root: 2, cooldown: 2 }), [cruelty]);
    const alone = run(spell({ root: 2, cooldown: 2 }), []);
    const one = run(spell({ root: 2, cooldown: 60 }), [cruelty]).fromCards;
    expect(fast.ccEvents.length).toBeGreaterThan(3);
    expect(one).toBeGreaterThan(0);
    expect(fast.fromCards - alone.fromCards).toBeCloseTo(one * Math.ceil(15 / 6), 0); // at 0, 6 and 12 s of a 15 s fight
  });

  it('adds nothing when no event happens', () => {
    expect(run(spell({ root: 0 }), [cruelty]).damage).toBeCloseTo(run(spell({ root: 0 }), []).damage);
  });
});

describe('immobilize events, limits and amounts (T005)', () => {
  const MORGANA_Q = 'Characters/Morgana/Spells/MorganaQAbility/MorganaQ';
  const LUX_Q = 'Characters/Lux/Spells/LuxLightBindingAbility/LuxLightBinding';
  const courage = CARD_NUMBERS.find((c) => c.id === 1018)!;
  const spell = (root?: unknown[], damage = 100) => ({ mSpell: {
    cooldownTime: [4, 4, 4],
    DataValues: root === undefined ? [] : [{ name: 'RootDuration', values: root }],
    mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: damage }] } },
  } });
  const run = (o: { path?: string; root?: unknown[]; qRank?: number; wDamage?: number; cards?: CardNumbers[] }) => {
    const path = o.path ?? MORGANA_Q;
    return fight({
      bin: { rec: { ...bin.rec, spells: [path, 'w', 'e'] }, [path]: spell(o.root), w: spell(undefined, o.wDamage ?? 100) },
      shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: o.cards ?? [courage], level: 3,
      knownRanks: { level: 3, ranks: { Q: o.qRank ?? 1, W: 1, E: 0, R: 0 } },
    });
  };
  // Courage of the Colossus at level 3, from its own numbers: 150 to 450 over levels 1 to 18, plus 4% of his health.
  const courageAt3 = (hp: number) => 150 + ((450 - 150) * (3 - 1)) / 17 + 0.04 * hp;

  it('says the duration is unread, and raises nothing, when a checked ability has no duration field or none at its rank', () => {
    for (const root of [undefined, [0, 2]]) {
      const r = run({ root, qRank: root ? 2 : 1 }); // no field; a field without rank 2
      expect(r.casts.Q).toBeGreaterThan(0);
      expect(r.ccEvents).toHaveLength(0);
      expect(r.healParts?.shields ?? 0).toBe(0);
      expect(r.notModelled.some((n) => n.includes('مدة التثبيت') && n.includes('Q'))).toBe(true);
    }
    const bad = run({ root: [0, 'x'] });
    expect(bad.ccEvents).toHaveLength(0);
    expect(bad.notModelled.some((n) => n.includes('مدة التثبيت'))).toBe(true);
  });

  it('reads a known 0 as no root at that rank, with no unread-duration limit', () => {
    const r = run({ root: [0, 0] });
    expect(r.ccEvents).toHaveLength(0);
    expect(r.healParts?.shields ?? 0).toBe(0);
    expect(r.notModelled.some((n) => n.includes('مدة التثبيت'))).toBe(false);
  });

  it('says nothing about unread durations when no card waits on a root', () => {
    expect(run({ cards: [] }).notModelled.some((n) => n.includes('مدة التثبيت'))).toBe(false);
  });

  it("gives Courage's shield from its own numbers, once per root, on Morgana Q at two ranks and on Lux Q", () => {
    for (const [path, qRank] of [[MORGANA_Q, 1], [MORGANA_Q, 2], [LUX_Q, 1]] as const) {
      const r = run({ path, root: [0, 1.75, 2], qRank });
      expect(r.ccEvents.length).toBeGreaterThan(0);
      expect(r.ccEvents.every((e) => e.duration === [0, 1.75, 2][qRank])).toBe(true);
      expect(r.healParts?.shields).toBeCloseTo(r.ccEvents.length * courageAt3(r.stats.hp), 6);
    }
  });

  it("adds no shield for W's hits while Q's roots stay the same", () => {
    const hitting = run({ root: [0, 2], wDamage: 100 }), silent = run({ root: [0, 2], wDamage: 0 });
    expect(hitting.casts.W).toBeGreaterThan(0);
    expect(hitting.ccEvents.length).toBe(silent.ccEvents.length);
    expect(hitting.healParts?.shields).toBeCloseTo(silent.healParts?.shields ?? -1, 9);
    expect(hitting.healParts?.shields).toBeCloseTo(hitting.ccEvents.length * courageAt3(hitting.stats.hp), 6);
  });
});

describe('Soul Eater from immobilize events (T007)', () => {
  const MORGANA_Q = 'Characters/Morgana/Spells/MorganaQAbility/MorganaQ';
  const soul = CARD_NUMBERS.find((c) => c.id === 1375)!;
  const spell = (root?: number[], damage = 100) => ({ mSpell: {
    cooldownTime: [4, 4, 4],
    DataValues: root === undefined ? [] : [{ name: 'RootDuration', values: root }],
    mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: damage }] } },
  } });
  const run = (o: { qPath?: string; root?: number[]; cards?: CardNumbers[] }) => {
    const path = o.qPath ?? MORGANA_Q;
    return fight({
      bin: { rec: { ...bin.rec, spells: [path, 'w', 'e'] }, [path]: spell(o.root), w: spell(undefined, 100) },
      shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: o.cards ?? [], level: 3,
      knownRanks: { level: 3, ranks: { Q: 1, W: 1, E: 0, R: 0 } },
    });
  };
  // Its own numbers (kiwi.bin 16.22): 30 health per immobilize, from that root to the end of the 15 s fight; 300 if it was the second augment.
  const fromRoots = (r: { ccEvents: { at: number }[] }) => r.ccEvents.reduce((m, e) => m + (30 * (15 - e.at)) / 15, 0);

  // A proc that scales with his health reads his health in the fight at each hit, so it shows health gained mid-fight, not only the average.
  const byHealth: CardNumbers = { id: 9, name: 'Health proc', status: 'computed', ops: [{ op: 'proc', trigger: 'ability_hit', damage: { hp: 0.1 }, type: 'true' }] };
  it('gives no health for ability hits that do not immobilize', () => {
    const plain = run({ root: [0, 0], cards: [byHealth] }), withCard = run({ root: [0, 0], cards: [byHealth, { ...soul, pickPlace: 1 }] });
    expect(withCard.fromCards).toBeCloseTo(plain.fromCards, 9); // no health in the fight either
    expect(withCard.casts.Q).toBeGreaterThan(0);
    expect(withCard.casts.W).toBeGreaterThan(0);
    expect(withCard.ccEvents).toHaveLength(0);
    expect(withCard.stats.hp).toBeCloseTo(plain.stats.hp, 9);
    expect(withCard.effectiveHp).toBeCloseTo(plain.effectiveHp, 6);
  });

  it('gives 30 health per checked root for the part of the fight after it, and more effective health for it', () => {
    const plain = run({ root: [0, 2] }), withCard = run({ root: [0, 2], cards: [{ ...soul, pickPlace: 1 }] });
    expect(withCard.ccEvents.length).toBeGreaterThan(1);
    expect(withCard.stats.hp).toBeCloseTo(plain.stats.hp + fromRoots(withCard), 6);
    expect(withCard.effectiveHp).toBeGreaterThan(plain.effectiveHp);
    const procPlain = run({ root: [0, 2], cards: [byHealth] }), procSoul = run({ root: [0, 2], cards: [byHealth, { ...soul, pickPlace: 1 }] });
    expect(procSoul.fromCards).toBeGreaterThan(procPlain.fromCards); // the health is there in the fight after a root
  });

  it('gives nothing from a tagged ability nobody checked', () => {
    const plain = run({ qPath: 'q', root: [0, 2] }), withCard = run({ qPath: 'q', root: [0, 2], cards: [{ ...soul, pickPlace: 1 }] });
    expect(withCard.stats.hp).toBeCloseTo(plain.stats.hp, 9);
  });

  it('adds the 300 only when it was proven the second augment, once, and says so when the order is unknown', () => {
    const at = (pickPlace?: number) => run({ root: [0, 0], cards: [{ ...soul, pickPlace }] });
    const base = run({ root: [0, 0] }).stats.hp;
    expect(at(2).stats.hp).toBeCloseTo(base + 300, 9);
    expect(at(1).stats.hp).toBeCloseTo(base, 9);
    expect(at(3).stats.hp).toBeCloseTo(base, 9);
    const unknown = at(undefined);
    expect(unknown.stats.hp).toBeCloseTo(base, 9);
    expect(unknown.notModelled.some((n) => n.includes('Soul Eater') && n.includes('ترتيب اختياره غير مثبت'))).toBe(true);
    expect(at(2).notModelled.some((n) => n.includes('ترتيب اختياره غير مثبت'))).toBe(false);
  });

  // The chain of fights (health kept, 300 once) is tested in 'Soul Eater health kept through the chain of fights (T008)'.
  it('gives the 300 once in a fight on top of its roots', () => {
    const second = run({ root: [0, 2], cards: [{ ...soul, pickPlace: 2 }] }), plain = run({ root: [0, 2] });
    expect(second.stats.hp).toBeCloseTo(plain.stats.hp + 300 + fromRoots(second), 6);
  });

  it('says the past stacks are unknown rather than counting them', () => {
    expect(run({ root: [0, 2], cards: [{ ...soul, pickPlace: 1, acquiredLevel: 3 }] }).notModelled.some((n) => n.includes('Soul Eater') && n.includes('مجهول'))).toBe(true);
  });
});

describe('Soul Eater health kept through the chain of fights (T008)', () => {
  const MORGANA_Q = 'Characters/Morgana/Spells/MorganaQAbility/MorganaQ';
  const soul = CARD_NUMBERS.find((c) => c.id === 1375)!;
  const q = (mana?: number) => ({ mSpell: {
    cooldownTime: [4, 4, 4], ...(mana === undefined ? {} : { mana: [mana, mana, mana] }),
    DataValues: [{ name: 'RootDuration', values: [0, 2, 2] }],
    mSpellCalculations: { Damage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } },
  } });
  // A champion with 100 mana, no regeneration and Q at 100: one root in the first fight, none after. With no mana pool: roots in every fight.
  const chain = (o: { manaPool: boolean; cards: CardNumbers[] }) => {
    const rec = { ...bin.rec, spells: [MORGANA_Q], ...(o.manaPool ? { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(100), '{6216bf7b}': num(0) } } : {}) };
    const first = fight({ bin: { rec, [MORGANA_Q]: q(o.manaPool ? 100 : undefined) }, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: o.cards, level: 3, knownRanks: { level: 3, ranks: { Q: 1, W: 0, E: 0, R: 0 } } });
    const second = first.again!(), third = second.again!();
    return [first, second, third];
  };
  const own = (r: { ccEvents: { at: number }[] }) => r.ccEvents.reduce((m, e) => m + (30 * (15 - e.at)) / 15, 0);

  it('keeps the health from a root in the first fight through the next two, with no new roots and nothing doubled', () => {
    const plain = chain({ manaPool: true, cards: [] }), soulChain = chain({ manaPool: true, cards: [{ ...soul, pickPlace: 2 }] });
    expect(soulChain.map((r) => r.ccEvents.length)).toEqual([1, 0, 0]);
    const gained = 30 * soulChain[0]!.ccEvents.length;
    expect(soulChain[0]!.stats.hp).toBeCloseTo(plain[0]!.stats.hp + 300 + own(soulChain[0]!), 6);
    expect(soulChain[1]!.stats.hp).toBeCloseTo(plain[1]!.stats.hp + 300 + gained, 6);
    expect(soulChain[2]!.stats.hp).toBeCloseTo(plain[2]!.stats.hp + 300 + gained, 6);
  });

  it('adds each fight\'s roots on top of what earlier fights gave, even when mana and cooldowns would make the same fight again', () => {
    const plain = chain({ manaPool: false, cards: [] }), soulChain = chain({ manaPool: false, cards: [{ ...soul, pickPlace: 1 }] });
    expect(plain[0]!.again!()).toBe(plain[0]); // nothing carries: the same fight
    const n = soulChain.map((r) => r.ccEvents.length);
    expect(n[0]).toBeGreaterThan(0);
    expect(soulChain[1]).not.toBe(soulChain[0]);
    expect(soulChain[1]!.stats.hp).toBeCloseTo(plain[1]!.stats.hp + 30 * n[0]! + own(soulChain[1]!), 6);
    expect(soulChain[2]!.stats.hp).toBeCloseTo(plain[2]!.stats.hp + 30 * (n[0]! + n[1]!) + own(soulChain[2]!), 6);
  });

  it('carries nothing without the card', () => {
    const plain = chain({ manaPool: false, cards: [] });
    expect(plain[2]!.stats.hp).toBeCloseTo(plain[0]!.stats.hp, 9);
  });
});

describe('Stackosaurus Rex: his own permanent stacks gained after it is taken are larger (T027)', () => {
  const rex = (acquiredLevel?: number): CardNumbers => ({ id: 1204, name: 'Stackosaurus Rex', status: 'partial', ops: [{ op: 'stack_bonus', ratio: 1 } as CardOp], ...(acquiredLevel === undefined ? {} : { acquiredLevel }) });
  const named = (name: string) => ({ ...bin, rec: { ...bin.rec, mCharacterName: name } });
  // Veigar's AP passive reads his count (STACKS_AT_15 300, 20 a level); a second AP op of his passive adds nothing more.
  const veigarPassive: CardOp[] = [{ op: 'per_stack', stat: 'ap', value: 1, mode: 'add', per: 'ability_hit' }, { op: 'per_stack', stat: 'ap', value: 1, mode: 'add', per: 'takedown' }];
  const veigar = (cards: CardNumbers[], stacks?: number) => fight({ bin: named('Veigar'), shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 15, passive: veigarPassive, ...(stacks === undefined ? {} : { stacks }) }).stats.ap;
  it('adds only what he gains after it is taken, once', () => {
    expect(veigar([])).toBeCloseTo(300, 6);
    expect(veigar([rex(15)])).toBeCloseTo(300, 6); // taken now: nothing gained since
    expect(veigar([rex(7)])).toBeCloseTo(300 + 300 * (8 / 15), 6); // 160 more, not 300
    expect(veigar([rex(3)])).toBeCloseTo(300 + 300 * (12 / 15), 6); // taken earlier, more gained after it
  });
  it('keeps a count the player typed as it is, and an unknown pick level gives nothing', () => {
    expect(veigar([rex(3)], 500)).toBeCloseTo(500, 6);
    expect(veigar([rex()])).toBeCloseTo(300, 6);
  });
  it('raises a champion passive counted by the generic curve the same way, and nothing of another card or a champion with no stacks', () => {
    const own: CardOp[] = [{ op: 'per_stack', stat: 'ap', value: 1, mode: 'add', per: 'takedown' }];
    const plain = (cards: CardNumbers[], passive?: CardOp[]) => fight({ bin: named('Nobody'), shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 15, passive }).stats.ap;
    expect(plain([rex(7)], own) - plain([], own)).toBeCloseTo(2.2 * 15 - 2.2 * 7, 6);
    const otherCard: CardNumbers = { id: 9, name: 'stacking card', status: 'computed', ops: [{ op: 'per_stack', stat: 'ap', value: 1, mode: 'add', per: 'takedown' }], acquiredLevel: 3 };
    expect(plain([otherCard, rex(3)])).toBeCloseTo(plain([otherCard]), 6); // an augment's own stacks are not his abilities' stacks
    expect(plain([rex(3)])).toBeCloseTo(plain([]), 6);
  });
  it('reaches his ability damage that reads his count (a buff-counter part, as Nasus\'s Q)', () => {
    const q = { rec: { ...bin.rec, mCharacterName: 'Nasus', spells: ['x/q'] }, 'x/q': { __type: 'SpellObject', mSpell: { cooldownTime: [20, 20, 20, 20, 20], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: {
      TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }, { __type: 'BuffCounterByCoefficientCalculationPart', mCoefficient: 1 }] },
    } } } };
    const cast = (cards: CardNumbers[]) => fight({ bin: q, shop: {}, kit, items: [], cards, level: 15 }).perCast.Q!;
    expect(cast([rex(7)]) - cast([])).toBeCloseTo(700 * (8 / 15), -1); // STACKS_AT_15 Nasus 700; perCast is rounded
  });
});

describe('One Hit Wonder: the chosen ability turns ability haste into its damage and loses the haste (T028)', () => {
  // Two damage spells, 100 each, 10 s cooldown; no mana costs. Q and W at slots 0 and 1, R at slot 3.
  const spell = { __type: 'SpellObject', mSpell: { cooldownTime: [10, 10, 10, 10, 10], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
  const two = { rec: { ...bin.rec, spells: ['x/q', 'x/w', 'x/e', 'x/r'] }, 'x/q': spell, 'x/w': spell, 'x/r': spell };
  const ohw = (abilityKey?: 'Q' | 'W' | 'E' | 'R'): CardNumbers => ({ id: 3060, name: 'One Hit Wonder', status: 'partial', ops: [{ op: 'haste_to_damage', per100: 0.75, scope: 'chosen_ability' } as CardOp], ...(abilityKey ? { abilityKey } : {}) });
  const haste = (n: number) => card('haste', [{ op: 'add', stat: 'haste', value: n }]);
  const run2 = (cards: CardNumbers[]) => fight({ bin: two, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 11 });
  it('raises only the chosen ability\'s hit by 75% per 100 haste', () => {
    const before = run2([haste(100)]), after = run2([haste(100), ohw('Q')]);
    expect(after.perCast.Q!).toBeCloseTo(before.perCast.Q! * 1.75, -1);
    expect(after.perCast.W!).toBeCloseTo(before.perCast.W!, -1);
  });
  it('takes the haste off that ability\'s cooldown only (its casts fall to the no-haste count), the other keeps it', () => {
    const none = run2([]), withHaste = run2([haste(100)]), after = run2([haste(100), ohw('Q')]);
    expect(withHaste.casts.Q!).toBeGreaterThan(none.casts.Q!);
    expect(after.casts.Q!).toBe(none.casts.Q!);
    expect(after.casts.W!).toBe(withHaste.casts.W!);
  });
  it('works on the ultimate when it is the chosen one', () => {
    const before = run2([haste(100)]), after = run2([haste(100), ohw('R')]);
    expect(before.casts.R).toBeGreaterThan(0); // the case needs R open and cast, else the check below proves nothing
    expect(after.casts.R).toBeGreaterThan(0);
    expect(after.perCast.R!).toBeCloseTo(before.perCast.R! * 1.75, -1);
    expect(after.casts.R!).toBe(run2([]).casts.R!); // its cost: R falls to the no-haste count
    expect(after.perCast.Q!).toBeCloseTo(before.perCast.Q!, -1);
  });
  it('keeps the next fight from getting back the haste on the chosen ability\'s carried cooldown', () => {
    const longQ = { rec: { ...bin.rec, spells: ['x/q', '', '', ''] }, 'x/q': { __type: 'SpellObject', mSpell: { ...spell.mSpell, cooldownTime: [90, 90, 90, 90, 90] } } };
    const next = (cards: CardNumbers[]) => { FIGHT.carryCooldowns = true; try { return fight({ bin: longQ, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 11 }).again!().casts.Q; } finally { FIGHT.carryCooldowns = false; } };
    expect(next([])).toBeUndefined(); // back at 90: still waiting when the next fight starts at 55
    expect(next([haste(100)])).toBe(1); // back at 45 with haste
    expect(next([haste(100), ohw('Q')])).toBeUndefined(); // One Hit Wonder takes that haste off Q in the next fight too
  });
  it('does not raise a proc the ability sets off, only the ability\'s own hit', () => {
    const proc = card('proc', [{ op: 'proc', trigger: 'ability_hit', damage: { flat: 50 }, type: 'true' } as CardOp]);
    const perCast = (r: ReturnType<typeof run2>) => r.fromCards / ((r.casts.Q ?? 0) + (r.casts.W ?? 0) + (r.casts.R ?? 0));
    const before = run2([haste(100), proc]), after = run2([haste(100), proc, ohw('Q')]);
    expect(after.fromCards).toBeGreaterThan(0);
    expect(perCast(after)).toBeCloseTo(perCast(before), 6);
    expect(after.perCast.Q!).toBeCloseTo(before.perCast.Q! * 1.75, -1);
  });
  it('a copy of the chosen ability (echo) copies its raised hit', () => {
    const echo = { ...card('echo', [{ op: 'echo', delay: 0.5, ratio: 0.5 } as CardOp]), abilityKey: 'Q' as const };
    const copyPerCast = (cards: CardNumbers[]) => { const withCopy = run2([...cards, echo]), plain = run2(cards); expect(withCopy.casts.Q).toBe(plain.casts.Q); return (withCopy.fromAbilities - plain.fromAbilities) / plain.casts.Q!; };
    const before = copyPerCast([haste(100)]);
    expect(before).toBeGreaterThan(0);
    expect(copyPerCast([haste(100), ohw('Q')])).toBeCloseTo(before * 1.75, -1);
  });
  it('raises a damage-per-second toggle\'s ticks when it is the chosen ability', () => {
    const toggle = { __type: 'SpellObject', mSpell: { cooldownTime: [1, 1, 1, 1, 1], DataValues: [{ name: 'BaseDamage', values: [20, 20, 20, 20, 20, 20] }], mSpellCalculations: { TotalDPS: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
    const onlyE = { rec: { ...bin.rec, spells: ['', '', 'x/e', ''] }, 'x/e': toggle };
    const runE = (cards: CardNumbers[]) => fight({ bin: onlyE, shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 11 });
    const before = runE([haste(100)]), after = runE([haste(100), ohw('E')]);
    expect(before.fromAbilities).toBeGreaterThan(0);
    expect(after.perCast.E!).toBeCloseTo(before.perCast.E! * 1.75, -1);
    expect(after.fromAbilities).toBeCloseTo(before.fromAbilities * 1.75, -1); // the ticks carry the raised hit
  });
  it('gives nothing and says why with no chosen ability, and nothing with no haste', () => {
    const before = run2([haste(100)]), unset = run2([haste(100), ohw()]);
    expect(unset.perCast.Q!).toBeCloseTo(before.perCast.Q!, -1);
    expect(unset.notModelled.some((m) => m.includes('One Hit Wonder'))).toBe(true);
    expect(run2([ohw('Q')]).perCast.Q!).toBeCloseTo(run2([]).perCast.Q!, -1);
  });
  it('flags haste given to that ability alone (Bread) as an unsettled estimate, and not without it', () => {
    // The card text does not settle whether Bread's haste is dropped too: the numbers are an estimate, the note says so.
    const bread = card('bread', [{ op: 'add', stat: 'haste', value: 100, scope: 'chosen_ability' }]);
    const breadQ = { ...bread, abilityKey: 'Q' as const };
    const unsettled = (r: ReturnType<typeof run2>) => r.notModelled.some((m) => m.includes('غير محسوم'));
    expect(unsettled(run2([breadQ, ohw('Q')]))).toBe(true);
    expect(unsettled(run2([breadQ, ohw('W')]))).toBe(false); // Bread on Q, the card on W: no shared ability
    expect(unsettled(run2([haste(100), ohw('Q')]))).toBe(false);
    expect(unsettled(run2([card('ult', [{ op: 'add', stat: 'ult_haste', value: 50 }]), ohw('R')]))).toBe(true);
  });
});
