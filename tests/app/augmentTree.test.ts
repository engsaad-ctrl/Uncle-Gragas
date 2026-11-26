import { describe, expect, it } from 'vitest';
import { fitOffer, heldLine, LINE_STEP, OFF_LINE, type CompactTree } from '../../src/app/augmentTree.js';
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
    expect(r[0].fit).toBe(70);
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
