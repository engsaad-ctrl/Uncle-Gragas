import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fight, type CardOp, type FightResult } from '../../src/ai/cardMath.js';
import { ITEM_NUMBERS } from '../../src/ai/cardMathData.js';
import { fightValue } from '../../src/ai/itemMath.js';

// T074 (T072-fight-item-snapshot-contract.md): a fight's result stands for the items it was given when it was made. A later change to the caller's
// array (push, splice, replacing an element) must not rewrite the next two fights through again(), nor a stored result read again later.
// Every expectation is a fight made from a separate fixed array of the same ids, never from the array under test.
const num = (baseValue: number) => ({ baseValue });
const rec = { __type: 'CharacterRecord', spells: [] as string[], attackRangeModifiable: num(175), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(60), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(335), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) };
const kit = { damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] } as never;
// 100 mana, no regeneration, an ultimate at 80 (the ultimate is not paced) and abilities he cannot afford: the first fight leaves 20, short of
// the 80 it spent, so again() runs a new fight (the re-fight branch); the second spends nothing, so its again() is itself (the stable branch).
const sp = (cost: number, cd: number) => ({ __type: 'SpellObject', mSpell: { cooldownTime: Array(6).fill(cd), mana: Array(6).fill(cost) } });
const caster = { rec: { ...rec, spells: ['x/q', 'x/w', 'x/e', 'x/r'], primaryAbilityResource: { arType: 0, '{726ee5cd}': num(100), '{6216bf7b}': num(0) } }, 'x/q': sp(999, 2), 'x/w': sp(999, 2), 'x/e': sp(999, 2), 'x/r': sp(80, 100) };
const plain = { rec };
const stat = (name: string, value: number) => ({ DataValues: [{ name, values: [value] }] });
// 3003 Archangel's (a Tear item) and its finished 3040 are given different stats, so a held id that changed would show.
const shop = { 1: stat('FlatPhysicalDamageMod', 100), 2: stat('FlatPhysicalDamageMod', 300), 3: stat('FlatHPPoolMod', 800), 3003: stat('FlatPhysicalDamageMod', 40), 3040: stat('FlatPhysicalDamageMod', 400) } as never;
const brief = (r: FightResult) => ({ damage: r.damage, effectiveHp: r.effectiveHp, healedHp: r.healedHp, stats: r.stats, casts: r.casts, attacks: r.attacks });
const chain = (r: FightResult) => { const second = r.again!(), third = second.again!(); return [brief(r), brief(second), brief(third)]; };
const edits: [string, (a: number[]) => void][] = [
  ['push', (a) => a.push(2)],
  ['splice', (a) => a.splice(0, 1)],
  ['replace', (a) => { a[0] = 2; }],
];

describe('the next fights keep the items given (real fight, again)', () => {
  for (const [how, edit] of edits) {
    it(`re-fight branch (mana short), caller ${how} after the result: fights 1 to 3 are the original items'`, () => {
      const items = [1, 3], expected = chain(fight({ bin: caster, shop, kit, items: [1, 3], cards: [], level: 9 }));
      const r = fight({ bin: caster, shop, kit, items, cards: [], level: 9 });
      expect(r.again!()).not.toBe(r); // this is the branch that runs a new fight
      edit(items);
      expect(chain(r)).toEqual(expected);
    });
    it(`stable branch (no mana), caller ${how}: the reused result is the original items'`, () => {
      const items = [1, 3], expected = chain(fight({ bin: plain, shop, kit, items: [1, 3], cards: [], level: 9 }));
      const r = fight({ bin: plain, shop, kit, items, cards: [], level: 9 });
      expect(r.again!()).toBe(r); // nothing carries: the same fight
      edit(items);
      expect(chain(r)).toEqual(expected);
    });
  }
  it('a new fight with the changed array does see the change, and the caller\'s array stays his to change (not frozen)', () => {
    const items = [1, 3];
    const r = fight({ bin: caster, shop, kit, items, cards: [], level: 9 });
    items.push(2);
    expect(Object.isFrozen(items)).toBe(false);
    expect(items).toEqual([1, 3, 2]);
    const changed = fight({ bin: caster, shop, kit, items, cards: [], level: 9 });
    expect(changed.stats.ad - r.stats.ad).toBeCloseTo(300, 6);
    expect(chain(changed)).toEqual(chain(fight({ bin: caster, shop, kit, items: [1, 3, 2], cards: [], level: 9 })));
  });
  it('a Tear item keeps its id across levels 11 and 18 (the fight\'s own upgrade rule decides, not the copy)', () => {
    for (const level of [11, 18]) {
      const items = [3003], expected = chain(fight({ bin: caster, shop, kit, items: [3003], cards: [], level }));
      const r = fight({ bin: caster, shop, kit, items, cards: [], level });
      items[0] = 3040;
      expect(chain(r)).toEqual(expected);
    }
  });
});

describe('mode copies and Void Immolation keep their identity (real 16.22 rows, ITEM_OPS)', () => {
  const fx = JSON.parse(readFileSync('tests/fixtures/game/owned-void-16.22.json', 'utf8'));
  const itemOps = Object.fromEntries(ITEM_NUMBERS.map((i) => [i.id, i.ops])) as Record<number, CardOp[]>;
  const bin = { ...caster, rec: { ...caster.rec } };
  for (const id of [223069, 223084]) {
    it(`${id}: the next fights after the caller replaces it with its base are still ${id}'s`, () => {
      const items = [id, 3075], expected = chain(fight({ bin, shop: fx.shop, kit, items: [id, 3075], cards: [], level: 11, itemOps }));
      const r = fight({ bin, shop: fx.shop, kit, items, cards: [], level: 11, itemOps });
      items[0] = id % 10000;
      expect(chain(r)).toEqual(expected);
      // and the base is really different here, so the check can fail
      expect(chain(fight({ bin, shop: fx.shop, kit, items: [id % 10000, 3075], cards: [], level: 11, itemOps }))).not.toEqual(expected);
    });
  }
});

describe('a stored result read again (the path mathBuild\'s run() takes: a map by key, then fightValue)', () => {
  const place = { share: 0.2, enemyDps: 2530, health0: 1000, rise: 1, draw: 1, absorbedWorth: 0.2 } as never;
  it('the value under an old key stays the original items\', read twice, with another list valued between the reads', () => {
    const stored = new Map<string, FightResult>();
    const runFor = (list: number[]) => { const key = list.join(); let r = stored.get(key); if (!r) { r = fight({ bin: caster, shop, kit, items: list, cards: [], level: 9 }); stored.set(key, r); } return r; };
    const held = [1];
    const old = runFor(held), oldKey = held.join();
    held.push(2); // the build loop's held.push
    const fresh = fightValue(fight({ bin: caster, shop, kit, items: [1], cards: [], level: 9 }), place);
    expect(fightValue(stored.get(oldKey)!, place)).toBeCloseTo(fresh, 9);
    const other = fightValue(runFor([3]), place); // another list between the reads
    expect(fightValue(stored.get(oldKey)!, place)).toBeCloseTo(fresh, 9);
    expect(fightValue(old, place)).toBeCloseTo(fresh, 9);
    // a later decision is not touched: the new list and the other list are their own
    expect(fightValue(runFor(held), place)).toBeCloseTo(fightValue(fight({ bin: caster, shop, kit, items: [1, 2], cards: [], level: 9 }), place), 9);
    expect(other).toBeCloseTo(fightValue(fight({ bin: caster, shop, kit, items: [3], cards: [], level: 9 }), place), 9);
  });
});
