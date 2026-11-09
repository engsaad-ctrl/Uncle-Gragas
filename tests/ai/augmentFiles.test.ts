import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardFromFiles } from '../../src/ai/augmentFiles.js';
import { fight, type CardNumbers, type CardOp, type Kit } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { buildAugmentTexts, type AugmentGameData } from '../../src/texts/augments.js';
import { augmentDataOnly } from '../../src/texts/augmentsLoader.js';
import { binHash } from '../../src/texts/spellValues.js';

// BEES!!! cut from the public Kiwi files of 16.21 and 16.22 (URLs and SHA256 in the fixture). These tests measure the formula on made-up fights, not a match.
const fixture = JSON.parse(readFileSync('tests/fixtures/game/bees-16.21-16.22.json', 'utf8')) as { patches: Record<string, { bin: Record<string, unknown> }> };
const entry = { id: 3086, augmentNameId: 'BEES', nameTRA: 'BEES!!!', augmentSmallIconPath: 'x.png', rarity: 'kGold' };
const gameOf = async (patch: string): Promise<AugmentGameData | undefined> =>
  (await buildAugmentTexts({ listAr: [entry], listEn: [entry], bins: [augmentDataOnly(fixture.patches[patch]!.bin)], strings: {} }))[0]?.game;
const stored = CARD_NUMBERS.find((c) => c.id === 3086)!;
const beesOf = (card: CardNumbers) => card.ops.find((x): x is Extract<CardOp, { op: 'delayed_dot' }> => x.op === 'delayed_dot')!;

describe('BEES!!! read from the patch file', () => {
  it('finds the hashed names it reads', () => {
    expect(binHash('Calc_Cooldown')).toBe('{4b11fb1c}');
    expect(binHash('Calc_OnHit_Efficacy')).toBe('{a21a0bfc}');
  });
  it('keeps no fixed copy of its numbers in the generated data', () => {
    expect(stored.ops).toEqual([]);
  });
  it('reads 16.21 and 16.22 each with its own damage and hive travel time', async () => {
    const old = beesOf(cardFromFiles(stored, await gameOf('16.21'))), now = beesOf(cardFromFiles(stored, await gameOf('16.22')));
    expect(old.damage.flat).toEqual({ min: 75, max: 200 });
    expect(now.damage.flat).toEqual({ min: 75, max: 140 });
    for (const b of [old, now]) {
      expect(b.damage.bonus_ad).toBeCloseTo(1.5);
      expect(b.damage.ap).toBeCloseTo(0.7);
      expect(b.cooldown).toEqual({ min: 15, max: 10 });
      expect([b.duration, b.ticksPerSecond, b.type, b.trigger]).toEqual([2, 2, 'magic', 'ability_hit']);
      expect(b.onHitEfficacy).toBeCloseTo(0.4);
    }
    expect(old.delay).toBeCloseTo(0.75);
    expect(now.delay).toBeCloseTo(1.1);
  });
  it('shows missing file data as missing, with no numbers', async () => {
    const none = cardFromFiles(stored, undefined);
    expect(none.ops).toEqual([]);
    expect(none.not_modelled).toMatch(/غير محمّلة/);
    const game = (await gameOf('16.22'))!;
    const { Calc_Damage: _, ...rest } = game.spell.mSpellCalculations!;
    const cut = cardFromFiles(stored, { ...game, spell: { ...game.spell, mSpellCalculations: rest } });
    expect(cut.ops).toEqual([]);
    expect(cut.not_modelled).toMatch(/Calc_Damage/);
    expect(cardFromFiles(stored, { ...game, missiles: [] }).not_modelled).toMatch(/mTravelTime/);
  });
  it('leaves cards without a reader as they are', () => {
    const other = CARD_NUMBERS.find((c) => c.id !== 3086)!;
    expect(cardFromFiles(other, undefined)).toBe(other);
  });
});

// A champion who casts Q (100 damage, 2 s cooldown) and makes no attacks; target magic resist 60, so magic damage is taken at 100 / 160.
const num = (baseValue: number) => ({ baseValue });
const rec = {
  __type: 'CharacterRecord', spells: ['x/q'],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(500), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
};
const qSpell = { __type: 'SpellObject', mSpell: { cooldownTime: [2, 2, 2, 2, 2, 2], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
const bin = { rec, 'x/q': qSpell };
const mage: Kit = { damage: 'magic', attacks: false };
const MAGIC = 100 / 160;
const card = (name: string, ops: CardOp[]): CardNumbers => ({ id: 1, name, status: 'computed', ops });
const run = (cards: CardNumbers[], level = 1) => fight({ bin, shop: {}, kit: mage, items: [], cards, level });
const bees = (b: Partial<Extract<CardOp, { op: 'delayed_dot' }>> = {}) => card('bees', [{ op: 'delayed_dot', trigger: 'ability_hit', cooldown: { min: 15, max: 10 }, delay: 0.75, duration: 2, ticksPerSecond: 2, damage: { flat: { min: 75, max: 200 }, bonus_ad: 1.5, ap: 0.7 }, type: 'magic', onHitEfficacy: 0.4, ...b }]);

describe('BEES!!! in the fight', () => {
  it('fires once per cooldown by level: 15 s at level 1, 10 s at level 18', () => {
    expect(run([bees()]).fromCards).toBeCloseTo(75 * MAGIC); // one hive in 15 s
    expect(run([bees()], 18).fromCards).toBeCloseTo(2 * 200 * MAGIC); // launches at 0 and 10 s
  });
  it('deals nothing before the hive lands, then its ticks over 2 s', () => {
    const plain = run([]).damageBySecond, withBees = run([bees()]).damageBySecond;
    const gain = withBees.map((d, i) => d - plain[i]!);
    expect(gain[0]).toBeCloseTo(0); // lands at 0.75 s, first tick at 1.25 s
    expect(gain[1]).toBeCloseTo((2 * 75 * MAGIC) / 4); // ticks at 1.25 and 1.75
    expect(gain[2]).toBeCloseTo(75 * MAGIC); // all four by 2.75
  });
  it('loses the ticks past the fight end', () => {
    // Lands at 13.6 s: ticks at 14.1 and 14.6 count, 15.1 and 15.6 are past the 15 s fight.
    expect(run([bees({ delay: 13.6 })]).fromCards).toBeCloseTo(75 * MAGIC / 2);
  });
  it('grows with bonus AD and AP by the file ratios', () => {
    const base = run([bees()]).fromCards;
    expect(run([bees(), card('ad', [{ op: 'add', stat: 'bonus_ad', value: 100 }])]).fromCards - base).toBeCloseTo(150 * MAGIC);
    expect(run([bees(), card('ap', [{ op: 'add', stat: 'ap', value: 100 }])]).fromCards - base).toBeCloseTo(70 * MAGIC);
  });
  it('applies on-hit damage at 40% once per hive, and sets off nothing else', () => {
    const onHit = card('onhit', [{ op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { flat: 100 }, type: 'true' }]);
    const spellblade = card('spellblade', [{ op: 'proc', trigger: 'next_attack', internal_cooldown: null, damage: { flat: 1000 }, type: 'true' }]);
    const heal = card('heal', [{ op: 'heal', amount: { flat: 50 }, trigger: 'on_hit', internal_cooldown: null }]);
    expect(run([onHit]).fromCards).toBeCloseTo(0); // no attacks, nothing applies on-hit
    expect(run([bees(), onHit, spellblade, heal]).fromCards).toBeCloseTo(75 * MAGIC + 40);
    expect(run([bees(), onHit, spellblade, heal]).healedHp).toBeCloseTo(0);
    expect(run([bees(), onHit], 18).fromCards).toBeCloseTo(2 * (200 * MAGIC + 40));
  });
  it('does not loop with abilities that apply on-hit (Ethereal Weapon)', () => {
    const onHit = card('onhit', [{ op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { flat: 100 }, type: 'true' }]);
    const ethereal = card('ethereal', [{ op: 'abilities_on_hit' }]);
    const r = run([bees(), onHit, ethereal]);
    // Each Q cast applies on-hit once at full; the one hive adds 40% once.
    expect(r.fromCards).toBeCloseTo(r.casts.Q! * 100 + 40 + 75 * MAGIC);
  });
  it('heals nothing through life steal', () => {
    const r = run([bees(), card('ls', [{ op: 'add', stat: 'life_steal', value: 0.5 }])]);
    expect(r.healParts?.lifeSteal).toBeCloseTo(0);
  });
});

// Echo Cast (2062), cut from the same two Kiwi files (tests/fixtures/game/echo-16.21-16.22.json).
const echoFixture = JSON.parse(readFileSync('tests/fixtures/game/echo-16.21-16.22.json', 'utf8')) as { patches: Record<string, { bin: Record<string, unknown> }> };
const echoEntry = { id: 2062, augmentNameId: 'Ability_SelfAOE_DoubleCast', nameTRA: 'Echo Cast', augmentSmallIconPath: 'x.png', rarity: 'kPrismatic' };
const echoGame = async (patch: string) => (await buildAugmentTexts({ listAr: [echoEntry], listEn: [echoEntry], bins: [augmentDataOnly(echoFixture.patches[patch]!.bin)], strings: {} }))[0]?.game;
const echoStored = CARD_NUMBERS.find((c) => c.id === 2062)!;
const echoCard = (abilityKey?: 'Q' | 'W' | 'E' | 'R', x: Partial<Extract<CardOp, { op: 'echo' }>> = {}): CardNumbers => ({ id: 2062, name: 'Echo Cast', status: 'partial', ops: [{ op: 'echo', delay: 0.25, ratio: 1, ...x }], abilityKey });

describe('Echo Cast read from the patch file', () => {
  it('keeps no fixed copy and reads the delay and damage ratio of both patches', async () => {
    expect(echoStored.ops).toEqual([]);
    for (const patch of ['16.21', '16.22']) expect(cardFromFiles(echoStored, await echoGame(patch)).ops).toEqual([{ op: 'echo', delay: 0.25, ratio: 1 }]);
  });
  it('shows missing file data as missing', async () => {
    expect(cardFromFiles(echoStored, undefined).ops).toEqual([]);
    const game = (await echoGame('16.22'))!;
    const cut = cardFromFiles(echoStored, { ...game, spell: { ...game.spell, DataValues: game.spell.DataValues!.filter((d) => d.name !== 'DelayTime') } });
    expect(cut.ops).toEqual([]);
    expect(cut.not_modelled).toMatch(/DelayTime/);
  });
});

describe('Echo Cast in the fight', () => {
  // Q every 2 s from 0 to 14 s: 8 casts of 100 magic damage, taken at 100 / 160.
  const q = run([]).fromAbilities;
  it('casts the chosen ability again, once per cast, and nothing else', () => {
    const r = run([echoCard('Q')]);
    expect(r.casts.Q).toBe(8);
    expect(r.fromAbilities).toBeCloseTo(2 * q); // the echo of the 14 s cast lands at 14.25 s
    expect(r.fromCards).toBeCloseTo(0);
  });
  it('loses an echo past the fight end', () => {
    expect(run([echoCard('Q', { delay: 1.5 })]).fromAbilities).toBeCloseTo((15 / 8) * q); // the 14 s cast echoes at 15.5 s
  });
  it('does nothing without a target skill, or with one he lacks, and says so', () => {
    for (const r of [run([echoCard()]), run([echoCard('W')])]) {
      expect(r.fromAbilities).toBeCloseTo(q);
      expect(r.notModelled.join(' ')).toMatch(/أثر النسخة غير محسوب/);
    }
  });
  it('sets off ability-hit effects only when asked to (the unproven variant)', () => {
    const proc = card('proc', [{ op: 'proc', trigger: 'ability_hit', internal_cooldown: null, damage: { flat: 10 }, type: 'true' }]);
    expect(run([echoCard('Q'), proc]).fromCards).toBeCloseTo(80); // the 8 casts only
    expect(run([echoCard('Q', { events: true }), proc]).fromCards).toBeCloseTo(160);
  });
});

it('echoes only the chosen skill when he has two', () => {
  const w = { __type: 'SpellObject', mSpell: { cooldownTime: [5, 5, 5, 5, 5, 5], DataValues: [{ name: 'BaseDamage', values: [40, 40, 40, 40, 40, 40] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
  const two = { rec: { ...rec, spells: ['x/q', 'x/w'] }, 'x/q': qSpell, 'x/w': w };
  const at = (cards: CardNumbers[]) => fight({ bin: two, shop: {}, kit: mage, items: [], cards, level: 9 });
  const plain = at([]), echoed = at([echoCard('W')]);
  expect(echoed.casts).toEqual(plain.casts);
  expect(echoed.fromAbilities - plain.fromAbilities).toBeCloseTo(plain.casts.W! * plain.perCast.W! * MAGIC);
});

// Dashing (1019): 175 haste on each skill the champion's file tags as moving him.
const dashFixture = JSON.parse(readFileSync('tests/fixtures/game/dashing-16.21-16.22.json', 'utf8')) as { patches: Record<string, { bin: Record<string, unknown> }> };
const dashEntry = { id: 1019, augmentNameId: 'ARAM_Dashing', nameTRA: 'Dashing', augmentSmallIconPath: 'x.png', rarity: 'kPrismatic' };
const dashGame = async (patch: string) => (await buildAugmentTexts({ listAr: [dashEntry], listEn: [dashEntry], bins: [augmentDataOnly(dashFixture.patches[patch]!.bin)], strings: {} }))[0]?.game;
const dashStored = CARD_NUMBERS.find((c) => c.id === 1019)!;

describe('Dashing', () => {
  it('reads 175 haste from both patches, with no fixed copy', async () => {
    expect(dashStored.ops).toEqual([]);
    for (const patch of ['16.21', '16.22']) expect(cardFromFiles(dashStored, await dashGame(patch)).ops).toEqual([{ op: 'add', stat: 'haste', value: 175, scope: 'movement_abilities' }]);
    expect(cardFromFiles(dashStored, undefined).ops).toEqual([]);
  });
  it('gives the haste to tagged skills only, each of them', async () => {
    const dash = cardFromFiles(dashStored, await dashGame('16.22'));
    const tagged = (tags: string[]) => ({ ...qSpell, mSpell: { ...qSpell.mSpell, mSpellTags: tags } });
    const at = (q: object, w: object, cards: CardNumbers[]) => fight({ bin: { rec: { ...rec, spells: ['x/q', 'x/w'] }, 'x/q': q, 'x/w': w }, shop: {}, kit: mage, items: [], cards, level: 9 });
    // Q and W both every 2 s; 175 haste makes it 2 x 100 / 275 = 0.73 s, cast as the 0.75 s casting time and the other skill allow.
    const plain = at(qSpell, qSpell, []);
    const one = at(tagged(['PositiveEffect_MoveBlock']), tagged(['Trait_DamageAbility']), [dash]);
    const onlyW = at(tagged(['Trait_DamageAbility']), tagged(['Trait_PlayerSelectedDashDirection']), [dash]);
    const teleport = at(tagged(['PositiveEffect_Teleport']), qSpell, [dash]);
    const n = (r: { casts: Record<string, number> }, k: string) => r.casts[k] ?? 0;
    expect(n(one, "Q")).toBeGreaterThan(n(plain, "Q"));
    expect(n(one, "W")).toBeLessThanOrEqual(n(plain, "W"));
    expect(n(onlyW, "W")).toBeGreaterThan(n(plain, "W"));
    expect(n(teleport, "Q")).toBe(n(one, "Q"));
    expect(one.stats.haste).toBe(0);
    const none = at(tagged(['Trait_DamageAbility']), qSpell, [dash]);
    expect(none.casts).toEqual(plain.casts);
    expect(none.notModelled.join(' ')).toMatch(/لا مهارة عليها وسم حركة/);
  });
  it('is not halved by its "has a dash" condition, which the fight now checks', async () => {
    const { tagWeight } = await import('../../src/ai/tagWeight.js');
    const { AUGMENT_TAGS } = await import('../../src/ai/augmentTags.js');
    expect(tagWeight(AUGMENT_TAGS[1019], cardFromFiles(dashStored, await dashGame('16.22')).ops).weight).toBe(1);
  });
});

describe('movement tags against the skills that move (35 champions, 16.22)', () => {
  const ev = JSON.parse(readFileSync('tests/fixtures/game/movement-tags-16.22.json', 'utf8')) as { movesByDescription: Record<string, string[]>; champions: Record<string, { spells: { key: string; tags: string[] }[] }> };
  it('marks every moving skill but the four known misses, and no other skill', async () => {
    const { MOVEMENT_TAGS } = await import('../../src/ai/cardMath.js');
    const wrong: string[] = [];
    for (const [champ, c] of Object.entries(ev.champions)) for (const s of c.spells) {
      const tagged = s.tags.some((t) => MOVEMENT_TAGS.has(t)), moves = ev.movesByDescription[champ]!.includes(s.key);
      if (tagged !== moves) wrong.push(`${champ} ${s.key} ${tagged ? 'tagged' : 'missed'}`);
    }
    expect(wrong.sort()).toEqual(['leesin Q missed', 'nocturne R missed', 'sion R missed', 'twistedfate R missed']);
  });
});

it("reads a dash and an immobilizing skill from a champion's own skill tags (16.22 files)", async () => {
  const { spellTraits } = await import('../../src/ai/cardMath.js');
  const raw = (alias: string) => JSON.parse(readFileSync(`tests/fixtures/sim/16.22/champions/${alias}.bin.json`, 'utf8')) as Record<string, unknown>;
  expect(spellTraits(raw('gragas'))).toEqual(['dash', 'immobilize']); // E Body Slam; E and R
  expect(spellTraits(raw('ahri'))).toEqual(['dash', 'immobilize']); // R Spirit Rush; E Charm
  expect(spellTraits(raw('nasus'))).toEqual([]); // W slows, no skill moves him
});
