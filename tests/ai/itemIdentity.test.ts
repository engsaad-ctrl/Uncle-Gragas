import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight, type CardOp } from '../../src/ai/cardMath.js';
import { ITEM_NUMBERS } from '../../src/ai/cardMathData.js';
import { DISTINCT_ITEM_IDS, itemOpsOf, OWNED_FINAL_ONLY, VOID_IMMOLATION } from '../../src/ai/itemIdentity.js';

// T065: Void Immolation 223069 is its own item, not a copy of 3069, in the ops the fight reads; every other mode copy keeps its base's ops.
// Stats are read from the real 16.22 item rows (tests/fixtures/game/owned-void-16.22.json); the expected +1000 HP, +100 armor, +80 MR and +25 haste
// are the file's own FlatHPPoolMod, FlatArmorMod, FlatSpellBlockMod and AbilityHasteMod for 223069, written here by hand.
const fx = JSON.parse(readFileSync('tests/fixtures/game/owned-void-16.22.json', 'utf8'));
const ITEM_OPS = Object.fromEntries(ITEM_NUMBERS.map((i) => [i.id, i.ops])) as Record<number, CardOp[]>;
const num = (baseValue: number) => ({ baseValue });
const bin = { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(175), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(335), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } };
const kit = { damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] } as never;
const run = (items: number[], itemOps: Record<number, CardOp[]> = ITEM_OPS) => fight({ bin, shop: fx.shop, kit, items, cards: [], level: 11, itemOps });

describe('item identity', () => {
  it('Void is distinct and owned-only; nothing else is', () => {
    expect([...DISTINCT_ITEM_IDS]).toEqual([VOID_IMMOLATION]);
    expect([...OWNED_FINAL_ONLY]).toEqual([VOID_IMMOLATION]);
  });
  it('the real rows: 223069 has none of its own and does not take 3069\'s; 3069 keeps its own; a mode copy (223084) keeps its base\'s (3084)', () => {
    expect(ITEM_OPS[3069]).toBeDefined();
    expect(itemOpsOf(ITEM_OPS, VOID_IMMOLATION)).toBeUndefined();
    expect(itemOpsOf(ITEM_OPS, 3069)).toBe(ITEM_OPS[3069]);
    expect(itemOpsOf(ITEM_OPS, 223084)).toBe(ITEM_OPS[3084]);
  });
});

describe('Void in the fight path', () => {
  it('held Void adds its file stats: +1000 HP, +100 armor, +80 MR, +25 haste (hand values from the 16.22 row)', () => {
    const without = run([]).stats, withVoid = run([VOID_IMMOLATION]).stats;
    expect(withVoid.hp - without.hp).toBeCloseTo(1000, 6);
    expect(withVoid.armor - without.armor).toBeCloseTo(100, 6);
    expect(withVoid.mr - without.mr).toBeCloseTo(80, 6);
    expect(withVoid.haste - without.haste).toBeCloseTo(25, 6);
  });
  it('a 3069 op that does act in the fight reaches 3069 only, never Void (the real path, not only the lookup)', () => {
    // 3069's real row is an item active the fight leaves out, so a probe op that acts is used: +500 health.
    const probe = { ...ITEM_OPS, 3069: [{ op: 'add', stat: 'hp', value: 500 } as CardOp] };
    expect(run([3069], probe).stats.hp - run([], probe).stats.hp).toBeCloseTo(500, 6);
    expect(run([VOID_IMMOLATION], probe).stats.hp - run([VOID_IMMOLATION]).stats.hp).toBeCloseTo(0, 6);
  });
  it('held Void says what it leaves out (burn, explosion, health effects); without it the note is absent', () => {
    expect(run([VOID_IMMOLATION]).notModelled.some((n) => n.includes('إحراق الفويد'))).toBe(true);
    expect(run([3075]).notModelled.some((n) => n.includes('إحراق الفويد'))).toBe(false);
  });
});
