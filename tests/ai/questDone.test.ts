import { describe, expect, it } from 'vitest';
import { HIT_QUEST_AUGMENTS } from '../../src/ai/augmentProgress.js';
import { fight, questItems, type CardNumbers } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

const spell = { __type: 'SpellObject', mSpell: {
  cooldownTime: [12, 12, 12, 12, 12, 12, 12],
  mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NumberCalculationPart', mNumber: 100 }] } },
} };
const bin = { rec: { __type: 'CharacterRecord', spells: ['q', 'w', '', 'r'], baseHPModifiable: { baseValue: 1000 } }, q: spell, w: spell, r: spell };
const card = (id: number, questDone?: boolean): CardNumbers => ({ ...CARD_NUMBERS.find((c) => c.id === id)!, ...(questDone === undefined ? {} : { questDone }) });
const at = (cards: CardNumbers[]) => fight({ bin, shop: {}, items: [], cards, level: 11, kit: { damage: 'magic', attacks: false } });

describe('hit and takedown quests finish only when the player says so (T134)', () => {
  it('lists exactly the quest cards with a reward and no quest items', () => {
    const hitQuests = CARD_NUMBERS.filter((c) => c.ops.some((x) => x.after_quest) && questItems(c.id).length === 0).map((c) => c.id).sort();
    expect([...HIT_QUEST_AUGMENTS].sort()).toEqual(hitQuests);
  });

  it("adds Urf's Champion's reward once marked finished, and nothing before", () => {
    expect(at([card(1154)]).stats.hp).toBe(at([]).stats.hp);
    expect(at([card(1154, false)]).stats.hp).toBe(at([]).stats.hp);
    expect(at([card(1154, true)]).stats.hp).toBe(at([]).stats.hp + 200);
  });

  it("Urf's Champion: when his items already hold its reward item (the Golden Spatula 994403), the marked reward is not added again (T159)", () => {
    const spatula = { 994403: { DataValues: [{ name: 'FlatHPPoolMod', values: [200] }, { name: 'FlatPhysicalDamageMod', values: [90] }] } } as never;
    const withItem = (cards: CardNumbers[]) => fight({ bin, shop: spatula, items: [994403], cards, level: 11, kit: { damage: 'magic', attacks: false } });
    expect(withItem([card(1154, true)]).stats).toEqual(withItem([]).stats);
    expect(at([card(1154, true)]).stats.hp).toBe(at([]).stats.hp + 200); // without the item, the marked reward still counts
  });
  it('Ultra Hydra: when his items hold its merged item (226668), the reward is not added on top of it (T163)', () => {
    const shop = { 226668: { DataValues: [{ name: 'FlatHPPoolMod', values: [1000] }, { name: 'FlatPhysicalDamageMod', values: [200] }] } } as never;
    // the three Hydras listed too, so the item quest reads as done: the held merged item still keeps the reward from being added again
    const withItem = (cards: CardNumbers[]) => fight({ bin, shop, items: [226668, ...questItems(2141)], cards, level: 11, kit: { damage: 'magic', attacks: false } });
    expect(withItem([card(2141, true)]).stats).toEqual(withItem([]).stats);
  });
  it('raises ability damage once Pursuit of Power is marked finished', () => {
    expect(at([card(2116)]).damage).toBe(at([]).damage);
    // T142: its 30% is on the chosen ability, so a key is given here (without one it is unrated: tests/ai/pursuit.test.ts).
    expect(at([{ ...card(2116, true), abilityKey: 'Q' }]).damage).toBeGreaterThan(at([]).damage);
  });

  it('leaves an item quest to its items: the mark does not replace the three Hydras', () => {
    // Ultra Hydra completes only from the items held; a mark on it is ignored.
    expect(questItems(2141).length).toBe(3);
    expect(at([card(2141)]).stats.hp).toBe(at([]).stats.hp);
    // Marked finished without its three Hydras, the reward stays off (Codex T135).
    expect(at([card(2141, true)]).stats).toEqual(at([]).stats);
    expect(at([card(2141, true)]).damage).toBe(at([]).damage);
  });
});
