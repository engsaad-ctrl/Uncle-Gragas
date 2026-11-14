import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cardFromFiles } from '../../src/ai/augmentFiles.js';
import { FIGHT, fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';
import { buildAugmentTexts, type AugmentGameData } from '../../src/texts/augments.js';
import { augmentDataOnly } from '../../src/texts/augmentsLoader.js';
import type { GameItem } from '../../src/texts/gameData.js';

// T047: Apex Inventor (Mayhem 1002) from the 16.22 kiwi file (tests/fixtures/game/apex-inventor-16.22.json, its source and SHA256 inside):
// ItemHaste 100 ("equal to 50% item cooldown reduction"; its text: item haste shortens every item ability's cooldown). Riot's 10.23 notes:
// item haste "affects ALL item cooldowns, not just actives". The fight shortens only the item cooldowns proven from the item's own file:
// Spellblade (an effect on the attack after an ability whose cooldown equals SpellbladeCooldown) and Ravenous/Profane Hydra's active (Cooldown).
beforeAll(() => { FIGHT.attackUptime.melee = 1; FIGHT.attackUptime.ranged = 1; });
afterAll(() => { FIGHT.attackUptime.melee = 0.8; FIGHT.attackUptime.ranged = 0.7; });

const apexFixture = JSON.parse(readFileSync('tests/fixtures/game/apex-inventor-16.22.json', 'utf8')) as { bin: Record<string, unknown> };
const itemFiles = JSON.parse(readFileSync('tests/fixtures/game/item-cooldowns-16.22.json', 'utf8')) as { items: Record<string, GameItem> };
const entry = { id: 1002, augmentNameId: 'ARAM_ApexInventor', nameTRA: 'Apex Inventor', augmentSmallIconPath: 'x.png', rarity: 'kGold' };
const gameOf = async (bin: Record<string, unknown>): Promise<AugmentGameData | undefined> =>
  (await buildAugmentTexts({ listAr: [entry], listEn: [entry], bins: [augmentDataOnly(bin)], strings: {} }))[0]?.game;
const stored = CARD_NUMBERS.find((c) => c.id === 1002)!;
const ITEM_HASTE = 100, haste = (cd: number) => (cd * 100) / (100 + ITEM_HASTE);

const num = (baseValue: number) => ({ baseValue });
const rec = { __type: 'CharacterRecord', spells: [] as string[], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) };
const shopOf = (...ids: number[]) => Object.fromEntries(ids.map((id) => [id, itemFiles.items[String(id)]!]));
const itemOps = Object.fromEntries(ITEM_NUMBERS.map((i) => [i.id, i.ops]));
const run = (items: number[], cards: CardNumbers[], bin: Record<string, unknown> = { rec }, kit = { damage: 'physical' as const, attacks: true }) =>
  fight({ bin, shop: shopOf(...items), kit, items, cards, level: 1, itemOps });
const PHYSICAL_TAKEN = 100 / (100 + FIGHT.target.armor);

describe('Apex Inventor read from the patch file', () => {
  it('reads ItemHaste 100 through the loader, the text builder and the file reader', async () => {
    const game = await gameOf(apexFixture.bin);
    expect(game?.spell.DataValues?.find((d) => d.name === 'ItemHaste')?.values?.[1]).toBe(100);
    const card = cardFromFiles(stored, game);
    expect(card.ops).toEqual([{ op: 'add', stat: 'item_haste', value: 100 }]);
    expect(card.status).toBe('partial');
  });
  it('with no file data, or the value missing, it says so and holds no number (no 100 put in)', async () => {
    expect(cardFromFiles(stored, undefined).ops).toEqual([]);
    expect(cardFromFiles(stored, undefined).not_modelled).toContain('غير محمّلة');
    const cut = structuredClone(apexFixture.bin) as Record<string, { mSpell?: { DataValues?: { name: string }[] } }>;
    const root = cut['Maps/ModeSpecificData/Augments/ARAM_ApexInventor/Augment_ARAM_ApexInventor']!;
    root.mSpell!.DataValues = root.mSpell!.DataValues!.filter((d) => d.name !== 'ItemHaste');
    const card = cardFromFiles(stored, await gameOf(cut));
    expect(card.ops).toEqual([]);
    expect(card.not_modelled).toContain('ItemHaste');
  });
});

describe('item haste in the fight', () => {
  const apex: CardNumbers = { id: 1002, name: 'Apex Inventor', status: 'partial', ops: [{ op: 'add', stat: 'item_haste', value: ITEM_HASTE }] };
  it("Ravenous Hydra's active: its Cooldown 10 becomes 5, so 3 actives in 15 s, not 2 (an oracle from the item's own numbers)", () => {
    const file = itemFiles.items['3074']!.DataValues!;
    const cd = file.find((d) => d.name === 'Cooldown')!.values![0]!, ratio = file.find((d) => d.name === 'ActiveADRatio')!.values![0]!, ad = 100 + file.find((d) => d.name === 'FlatPhysicalDamageMod')!.values![0]!;
    const times = (c: number) => Math.ceil(FIGHT.seconds / c - 1e-9); // at 0, c, 2c, ... before the end
    const one = ratio * ad * PHYSICAL_TAKEN;
    expect(run([3074], []).fromCards).toBeCloseTo(times(cd) * one, 6); // 2
    expect(run([3074], [apex]).fromCards).toBeCloseTo(times(haste(cd)) * one, 6); // 3
    // An 11 s fight tells the amount apart: 5 s gives 0, 5 and 10 (3); a smaller haste (6.7 s) would give 0 and 6.7 (2).
    const seconds = FIGHT.seconds;
    try { FIGHT.seconds = 11; expect(run([3074], [apex]).fromCards).toBeCloseTo(times(haste(cd)) * one, 6); expect(times(haste(cd))).toBe(3); } finally { FIGHT.seconds = seconds; }
  });
  it("Trinity Force's Spellblade: its 1.5 s lock becomes 0.75 s; more procs, never faster than the shortened lock", () => {
    const spell = { __type: 'SpellObject', mSpell: { mClientData: {}, cooldownTime: [0, 0, 0, 0, 0, 0, 0], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ mNumber: 10, __type: 'NumberCalculationPart' }], __type: 'GameCalculation' } } } };
    const bin = { rec: { ...rec, spells: ['q'] }, q: spell };
    const per = 2 * 100 * PHYSICAL_TAKEN; // ad 2 - bonus_ad 2: twice his base AD of 100, from the item's ops
    const plain = run([3078], [], bin).fromCards / per, hasted = run([3078], [apex], bin).fromCards / per;
    expect(Number.isInteger(Math.round(plain * 1e6) / 1e6)).toBe(true);
    expect(hasted).toBeGreaterThan(plain);
    expect(plain).toBeLessThanOrEqual(Math.ceil(FIGHT.seconds / 1.5));
    expect(hasted).toBeLessThanOrEqual(Math.ceil(FIGHT.seconds / haste(1.5)));
  });
  it("leaves alone what is not a proven item cooldown: the champion's ability, another card's lock, Heartsteel's and Sterak's", () => {
    const spell = { __type: 'SpellObject', mSpell: { mClientData: {}, cooldownTime: [3, 3, 3, 3, 3, 3, 3], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ mNumber: 10, __type: 'NumberCalculationPart' }], __type: 'GameCalculation' } } } };
    const bin = { rec: { ...rec, spells: ['q'] }, q: spell };
    expect(run([], [apex], bin).casts.Q).toBe(run([], [], bin).casts.Q);
    const lock: CardNumbers = { id: 2, name: 'lock', status: 'computed', ops: [{ op: 'proc', trigger: 'periodic', internal_cooldown: 10, damage: { flat: 100 }, type: 'true' }] };
    expect(run([], [lock, apex]).fromCards).toBeCloseTo(run([], [lock]).fromCards, 9);
    expect(run([3084], [apex]).fromCards).toBeCloseTo(run([3084], []).fromCards, 9); // Heartsteel's 30 s lock: per target, no item Cooldown matches
    expect(run([3053], [apex]).effectiveHp).toBeCloseTo(run([3053], []).effectiveHp, 9); // Sterak's 90 s lock against its Cooldown 60: not proven
    expect(run([3742], [apex]).fromCards).toBeCloseTo(run([3742], []).fromCards, 9); // Dead Man's Plate's 4 s on-hit lock: its file names no Cooldown
  });
  it('with no eligible item it adds nothing: a computed zero, not a missing value', () => {
    expect(run([], [apex]).damage).toBeCloseTo(run([], []).damage, 9);
  });
  it('never changes the shared item tables, over two runs', () => {
    const before = JSON.stringify([itemOps[3074], itemOps[3078]]);
    run([3074, 3078], [apex]); run([3074, 3078], [apex]);
    expect(JSON.stringify([itemOps[3074], itemOps[3078]])).toBe(before);
  });
});
