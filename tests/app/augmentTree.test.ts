import { describe, expect, it } from 'vitest';
import { adaptItems, neededItems, buildLine, enemyCounts, ENEMY_STEP, STAT_STEP, CRIT_CAP_STEP, critHeld, abilityFits, abilityShift, ABILITY_STEP, fitOffer, fitPercent, heldLine, treeFor, LINE_STEP, OFF_LINE, type CompactTree } from '../../src/app/augmentTree.js';
import { AUGMENT_TREES } from '../../src/ai/augmentTreesData.js';

const tree: CompactTree = {
  lines: [['Burn', 'burns tick', ['Liandry']], ['Crit', 'abilities crit', ['IE']]],
  a: { 1: [50, 'a', [0]], 2: [50, 'b', [0]], 3: [50, 'c', [1]], 4: [50, 'd', [0]], 5: [60, 'e', []] },
  after: [[5, 3, 20, 'combo']],
};

describe('augment tree fit', () => {
  it('equal cards share the offer equally before any pick', () => {
    const r = fitOffer(tree, [2, 3]);
    expect(r[0].fit).toBe(r[1].fit);
    expect(r[0].pct + r[1].pct).toBe(100);
  });
  it('a held card raises the other cards of its line', () => {
    const r = fitOffer(tree, [2, 3], [1]);
    expect(r[0].id).toBe(2);
    expect(r[0].fit).toBe(50 + LINE_STEP);
    expect(r[0].lines).toEqual(['Burn']);
  });
  it('a committed line lowers a card from another line', () => {
    expect(fitOffer(tree, [3], [1, 4])[0].fit).toBe(50 - OFF_LINE);
  });
  it('an after rule applies only when its card is held, and says why', () => {
    expect(fitOffer(tree, [3])[0].fit).toBe(50);
    const r = fitOffer(tree, [3], [5]);
    expect(r[0].fit).toBe(50 + 1.25 * 20); // AFTER_WEIGHT 1.25 (T269)
    expect(r[0].because).toEqual(['combo']);
  });
  it('an unknown card reads 50 and the shares still add up', () => {
    const r = fitOffer(tree, [999, 5]);
    expect(r.find((x) => x.id === 999)?.base).toBe(50);
    const total = r.reduce((s, x) => s + x.pct, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });
  it('a card in no line is exempt from the off-line drop', () => {
    expect(fitOffer(tree, [5], [1, 4])[0].fit).toBe(60);
  });
  it('line following stops at three held cards', () => {
    const big: CompactTree = { ...tree, a: { ...tree.a, 6: [50, 'f', [0]], 7: [50, 'g', [0]] } };
    expect(fitOffer(big, [2], [1, 4, 6, 7])[0].fit).toBe(50 + 3 * LINE_STEP);
  });
  it('an empty offer and held cards outside the tree change nothing', () => {
    expect(fitOffer(tree, [])).toEqual([]);
    expect(fitOffer(tree, [2, 3], [999])[0].fit).toBe(50);
    expect(heldLine(tree, [999])).toBeUndefined();
  });
  it('heldLine names the line most held cards point to', () => {
    expect(heldLine(tree, [])).toBeUndefined();
    expect(heldLine(tree, [1, 4, 3])?.name).toBe('Burn');
  });
});

describe('bundled trees', () => {
  it('every tree is well formed', () => {
    const ids = Object.keys(AUGMENT_TREES);
    expect(ids.length).toBeGreaterThan(100);
    for (const id of ids) {
      const t = AUGMENT_TREES[id];
      expect(t.lines.length).toBeGreaterThan(0);
      for (const [score, , lines] of Object.values(t.a)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        for (const l of lines) expect(l).toBeLessThan(t.lines.length);
      }
    }
  });
  it('Karthus: Eureka first, then Wooglet\'s rises over Forged By The Master', () => {
    const k = AUGMENT_TREES['30'];
    const before = fitOffer(k, [1156, 2127, 3118]);
    const after = fitOffer(k, [1156, 2127, 3118], [1030]);
    expect(after.find((r) => r.id === 1156)!.pct).toBeGreaterThan(before.find((r) => r.id === 1156)!.pct);
  });
});

describe('fit bar value', () => {
  it('moves with the picks and stays within 0-100', () => {
    expect(fitPercent(tree, 3)).toBe(50);
    expect(fitPercent(tree, 3, [5])).toBe(75); // AFTER_WEIGHT 1.25 (T269)
    expect(fitPercent(tree, 2, [1])).toBe(50 + LINE_STEP);
    expect(fitPercent({ ...tree, after: [[5, 3, 90, 'big']] }, 3, [5])).toBe(100);
    expect(fitPercent({ ...tree, after: [[5, 3, -90, 'trap']] }, 3, [5])).toBe(0);
  });
});

describe('tree only in Mayhem', () => {
  it('Arena and other modes get no tree', () => {
    const trees = { 1: tree };
    expect(treeFor(trees, 'mayhem', 1)).toBe(tree);
    expect(treeFor(trees, 'arena', 1)).toBeUndefined();
    expect(treeFor(trees, 'aram', 1)).toBeUndefined();
    expect(treeFor(trees, 'mayhem', undefined)).toBeUndefined();
  });
});

describe('build line', () => {
  it('follows the picks, else the first line', () => {
    expect(buildLine(tree, [])?.name).toBe('Burn');
    expect(buildLine(tree, [3])?.name).toBe('Crit');
    expect(buildLine(tree, [3])?.items).toEqual(['IE']);
    expect(buildLine({ ...tree, lines: [] }, [])).toBeUndefined();
  });
});

describe('enemy rules', () => {
  const kits = [1, 2, 3, 4, 5].map((id) => ({ id, traits: id <= 3 ? ['frontline'] : [], relies: id >= 4 ? ['crowd_control'] : [] }));
  const t: CompactTree = { lines: [], a: { 3150: [50, 'storm', []], 1001: [50, 'titan', []], 9: [50, 'plain', []] }, after: [] };
  it('counts tanks and crowd control from the enemy kits', () => {
    expect(enemyCounts(kits, [1, 2, 3, 4, 5])).toEqual({ tanks: 3, cc: 2, magic: 0, healers: 0 });
    expect(enemyCounts(kits, [1, 99])).toEqual({ tanks: 1, cc: 0, magic: 0, healers: 0 });
  });
  it('raises a tank-buster only against 3+ tanks, and says why', () => {
    expect(fitPercent(t, 3150, [], { tanks: 3, cc: 0 })).toBe(50 + ENEMY_STEP);
    expect(fitPercent(t, 3150, [], { tanks: 2, cc: 0 })).toBe(50);
    expect(fitPercent(t, 9, [], { tanks: 5, cc: 5 })).toBe(50);
    expect(fitOffer(t, [1001], [], { tanks: 0, cc: 3 })[0].because).toHaveLength(1);
    expect(fitPercent(t, 3150)).toBe(50);
  });
});

describe('item swaps for the enemy team', () => {
  const line = ['Luden\'s Echo', 'Sorcerer\'s Shoes', 'Shadowflame', 'Rabadon\'s Deathcap', 'Zhonya\'s Hourglass', 'Liandry\'s Torment'];
  it('changes nothing without an enemy team or need', () => {
    expect(adaptItems(line, { damage: 'magic', frontline: false }).swaps).toEqual([]);
    expect(adaptItems(line, { damage: 'magic', frontline: false }, { tanks: 1, cc: 0, magic: 1, healers: 0 }).items).toEqual(line);
  });
  it('swaps from the end, keeps boots and the first two, once per need', () => {
    const r = adaptItems(line, { damage: 'magic', frontline: false }, { tanks: 3, cc: 0, magic: 3, healers: 2 });
    expect(r.swaps.map((s) => s.in)).toEqual(['Morellonomicon', 'Void Staff', "Banshee's Veil"]);
    expect(r.items.slice(0, 2)).toEqual(line.slice(0, 2));
    expect(r.items).toContain("Sorcerer's Shoes");
  });
  it('picks by his damage and skips an item already held', () => {
    expect(adaptItems(['Infinity Edge', 'Berserker\'s Greaves', 'Lord Dominik\'s Regards', 'X'], { damage: 'physical', frontline: false }, { tanks: 4, cc: 0 }).swaps).toEqual([]);
    expect(adaptItems(['A', 'B', 'C', 'D'], { damage: 'physical', frontline: true }, { tanks: 0, cc: 0, healers: 3 }).items[3]).toBe('Thornmail');
  });
});

describe('stat stacking (T270)', () => {
  // 1097 gives AP, 1030 gives AP and haste, 1098 gives haste (src/ai/augmentTags.ts).
  const t: CompactTree = { lines: [], a: { 1097: [50, 'ap', []], 1030: [50, 'ap haste', []], 1098: [50, 'haste', []], 9: [50, 'none', []] }, after: [] };
  it('adds a step per stat shared with held cards, and says so', () => {
    expect(fitPercent(t, 1030, [1097])).toBe(50 + STAT_STEP);
    expect(fitPercent(t, 1030, [1097, 1098])).toBe(50 + 2 * STAT_STEP);
    expect(fitPercent(t, 9, [1097])).toBe(50);
    expect(fitOffer(t, [1030], [1097])[0].because.at(-1)).toContain('AP');
  });
});

describe('items a held card asks for', () => {
  it('reads needs_item and quest tags and puts the item in, before enemy swaps', () => {
    const need = neededItems([{ ids: [1320], name: 'Upgrade Collector' }, { ids: [9], name: 'Plain' }]);
    expect(need).toEqual([{ card: 'Upgrade Collector', items: ['The Collector'] }]);
    const r = adaptItems(['A', 'B', 'C', 'D', 'E', 'F'], { damage: 'physical', frontline: false }, { tanks: 3, cc: 0 }, need);
    expect(r.items[5]).toBe('The Collector');
    expect(r.swaps[0].why).toContain('Upgrade Collector');
    expect(adaptItems(['The Collector', 'B'], { damage: 'physical', frontline: false }, undefined, need).swaps).toEqual([]);
  });
});

describe('one item per unique group', () => {
  it('an anti-heal swap replaces the Last Whisper item in place, and a line duplicate becomes a filler', () => {
    const line = ['Infinity Edge', "Berserker's Greaves", "Lord Dominik's Regards", 'Bloodthirster', 'X', 'Y'];
    const r = adaptItems(line, { damage: 'physical', frontline: false }, { tanks: 0, cc: 0, healers: 3 });
    expect(r.items.filter((i) => ["Lord Dominik's Regards", 'Mortal Reminder'].includes(i))).toEqual(['Mortal Reminder']);
    const d = adaptItems(['A', 'B', "Sterak's Gage", 'Maw of Malmortius'], { damage: 'physical', frontline: false });
    expect(d.items).toEqual(['A', 'B', "Sterak's Gage", 'Guardian Angel']);
  });
});

describe('crit chance cap (owner 2026-11-27)', () => {
  // 1047 It's Critical gives 50% crit, 1077 Soul Siphon 25% (card texts); the line builds Infinity Edge and The Collector (25% each).
  const t: CompactTree = { lines: [['crit', '', ['Infinity Edge', 'The Collector', 'X']]], a: { 1047: [60, '', [0]], 1077: [60, '', [0]] }, after: [] };
  it('counts line items and held cards, and takes off the crit above 100%', () => {
    expect(critHeld(t, [1077])).toBe(75);
    expect(fitPercent(t, 1047, [])).toBe(60);
    const f = fitOffer(t, [1047], [1077])[0];
    expect(f.fit).toBe(60 + 10 - (CRIT_CAP_STEP * 25) / 25);
    expect(f.because.at(-1)).toContain('25%');
  });
});

describe('quest cards need every item', () => {
  it("Wooglet's Witchcap puts in both Rabadon's and Zhonya's, and a held one stays", () => {
    const need = neededItems([{ ids: [1156], name: "Wooglet's Witchcap" }]);
    expect(need[0].all).toBe(true);
    const r = adaptItems(['A', 'B', "Rabadon's Deathcap", 'D', 'E'], { damage: 'magic', frontline: false }, undefined, need);
    expect(r.items).toContain("Zhonya's Hourglass");
    expect(r.items).toContain("Rabadon's Deathcap");
  });
});

describe('item facts from the game files', () => {
  it('reads crit from item text: Statikk Shiv gives none, Essence Reaver 25%', () => {
    const t: CompactTree = { lines: [['l', '', ['Statikk Shiv', 'Essence Reaver', 'Bloodthirster']]], a: {}, after: [] };
    expect(critHeld(t, [])).toBe(25);
  });
  it("Black Cleaver shares the Last Whisper group with Lord Dominik's", () => {
    const d = adaptItems(['A', 'B', "Lord Dominik's Regards", 'Black Cleaver'], { damage: 'physical', frontline: false });
    expect(d.items.filter((i) => ["Lord Dominik's Regards", 'Black Cleaver'].includes(i))).toEqual(["Lord Dominik's Regards"]);
  });
});

describe('chosen-ability cards (owner 2026-11-27)', () => {
  it('Bread And Jam on Ryze: W (long cooldown) is best, Q and E fall below it; a plain card does not move', () => {
    expect(abilityShift(13, 1150, 'W')).toBe(0);
    expect(abilityShift(13, 1150, 'E')).toBeLessThan(0);
    expect(abilityShift(13, 1150, 'E')).toBeGreaterThanOrEqual(-ABILITY_STEP);
    expect(abilityShift(13, 1097, 'Q')).toBe(0);
    const t: CompactTree = { lines: [], a: { 1150: [60, '', []] }, after: [] };
    const f = abilityFits(t, 13, 1150);
    expect(f.find((x) => x.key === 'W')!.pct).toBe(60);
    expect(f.find((x) => x.key === 'E')!.pct).toBeLessThan(60);
  });
});

describe('line choice from the data table (owner 2026-11-27)', () => {
  it('shows the line the holders of his cards built, and falls back to the lines a card serves without data', () => {
    const t: CompactTree = { lines: [['A', '', ['x']], ['B', '', ['y']]], a: { 1: [50, '', [0]], 2: [50, '', [0]] }, after: [], lt: { 1: [10, 90], 2: [20, 80] } };
    expect(heldLine(t, [1])!.name).toBe('B');
    expect(heldLine(t, [1, 2])!.name).toBe('B');
    expect(heldLine({ ...t, lt: undefined }, [1])!.name).toBe('A');
    expect(heldLine(t, [])).toBeUndefined();
  });
});
