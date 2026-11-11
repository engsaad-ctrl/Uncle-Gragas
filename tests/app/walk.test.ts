import { describe, expect, it } from 'vitest';
import { offerPlanIds, pathChange, pathChangeLine, planReason, rankOffer, walkItems } from '../../src/app/walk.js';

describe('offerPlanIds', () => {
  it('waits for all three cards unless the player asks to compare a partial offer', () => {
    expect(offerPlanIds(new Set([10]), false)).toEqual([]);
    expect(offerPlanIds(new Set([10, 20]), false)).toEqual([]);
    expect(offerPlanIds(new Set([10, 20, 30]), false)).toEqual([10, 20, 30]);
    expect(offerPlanIds(new Set([10, 20]), true)).toEqual([10, 20]);
    expect(offerPlanIds(new Set(), true)).toEqual([]);
  });
});

describe('rankOffer', () => {
  it('puts the highest percent first and unknown last', () => {
    const p: Record<string, number | undefined> = { a: 40, b: undefined, c: 90 };
    expect(rankOffer(['a', 'b', 'c'], (x) => p[x])).toEqual(['c', 'a', 'b']);
  });
  it('leaves the list it was given alone', () => {
    const cards = ['a', 'b'];
    rankOffer(cards, () => 1);
    expect(cards).toEqual(['a', 'b']);
  });
});

describe('walkItems', () => {
  it('leaves out what he owns, and names what the list no longer holds', () => {
    expect(walkItems([1, 2, 3], [1, 9])).toEqual({ next: [2, 3], offPath: [9] });
  });
  it('fits the six slots', () => {
    expect(walkItems([1, 2, 3, 4, 5, 6, 7], [1, 8, 9, 10, 11]).next).toEqual([2]);
    expect(walkItems([1, 2], [3, 4, 5, 6, 7, 8]).next).toEqual([]);
  });
  it('gives the whole list with nothing bought', () => {
    expect(walkItems([1, 2], [])).toEqual({ next: [1, 2], offPath: [] });
  });
});

describe('rankOffer with open conditions', () => {
  it('puts settled cards first, then open-condition ones, then unknown, each by percent', () => {
    const p: Record<string, number | undefined> = { a: 40, b: undefined, c: 90, d: 95, e: 10 };
    const open = new Set(['d', 'e']);
    expect(rankOffer(['a', 'b', 'c', 'd', 'e'], (x) => p[x], (x) => open.has(x))).toEqual(['c', 'a', 'd', 'e', 'b']);
  });
});

// T014, T015: what a card changes in the items still to buy, between the full plan with it and the plan without it (same state, same style).
// The held prefix is the one each search sent with its plan (baselineOwned, itemsOwned), never the page's own list.
describe('pathChange', () => {
  const A = 3071, B = 3153, C = 6672, D = 3031, E = 3036;
  it('says nothing changes when both plans are the same', () => {
    expect(pathChange([A, B, C], [A, B, C], [A], [A])).toEqual({ kind: 'same' });
  });
  it('finds the first upcoming step that differs, past the held items', () => {
    expect(pathChange([A, B, C], [A, D, C], [A], [A])).toEqual({ kind: 'changed', step: 1, was: B, now: D });
    expect(pathChange([A, B, C, E], [A, B, D, E], [A], [A])).toEqual({ kind: 'changed', step: 2, was: C, now: D });
  });
  it('tells a change of order only', () => {
    expect(pathChange([A, B, C], [A, C, B], [A], [A])).toEqual({ kind: 'reordered', step: 1, was: B, now: C });
  });
  it('tells an added or a missing item at the end', () => {
    expect(pathChange([A, B], [A, B, C], [A], [A])).toEqual({ kind: 'changed', step: 2, now: C });
    expect(pathChange([A, B, C], [A, B], [A], [A])).toEqual({ kind: 'changed', step: 2, was: C });
  });
  it('the T015 regression: main searched with newer held items than the page knows, the step counts from what main held', () => {
    // The page still knows [] (then [A]); main used [A] (then [A, E]). Before T015 the page's list made A (E) an upcoming item: step 2.
    expect(pathChange([A, B, C], [A, D, C], [A], [A])).toEqual({ kind: 'changed', step: 1, was: B, now: D });
    expect(pathChange([A, E, B, C], [A, E, D, C], [A, E], [A, E])).toEqual({ kind: 'changed', step: 1, was: B, now: D });
    // Ezreal: main mapped a held Muramana to Manamune at the head of both plans; the page, still on Tear, has no say in it.
    expect(pathChange([3004, B, C], [3004, D, C], [3004], [3004])).toEqual({ kind: 'changed', step: 1, was: B, now: D });
  });
  it('no items past the held ones is not «every slot held»', () => {
    expect(pathChange([A], [A], [A], [A])).toEqual({ kind: 'none' });
    expect(pathChange([A, B, C, D, E, 3089], [A, B, C, D, E, 3089], [A, B, C, D, E, 3089], [A, B, C, D, E, 3089])).toEqual({ kind: 'none' });
    expect(pathChange([], [], [], [])).toEqual({ kind: 'none' });
  });
  it('gives no verdict without the proof, with two different prefixes, a prefix not at the head, or a held item past it', () => {
    expect(pathChange([A, B, C], [A, D, C], undefined, undefined)).toBeUndefined();
    expect(pathChange([A, B, C], [A, D, C], [A], undefined)).toBeUndefined();
    expect(pathChange([A, B, C], [E, D, C], [A], [E])).toBeUndefined();
    expect(pathChange([B, A, C], [B, A, C], [A], [A])).toBeUndefined();
    expect(pathChange([A, B, A], [A, B, C], [A], [A])).toBeUndefined();
  });
});

// T017: the reason the card's own plan gives (mathBuild's why, from the same search) for the item the verdict names.
describe('planReason', () => {
  const A = 3071, B = 3153, C = 6672, D = 3031;
  const why = [{ id: D, why: ['يكبر بالتراكمات: يُشترى أولاً ليجمعها طوال اللعبة', 'ضرر +12%، تحمّل +0%'] }, { id: B, why: ['ضرر +8%، تحمّل +2%'] }, { id: C, why: [] }];
  it('a changed plan: the reason for the new item, from the card plan', () => {
    expect(planReason({ kind: 'changed', step: 1, was: B, now: D }, [A, D, C], [A], why)).toEqual({ id: D, why: why[0]!.why });
    expect(planReason({ kind: 'reordered', step: 1, was: D, now: B }, [A, B, D], [A], why)).toEqual({ id: B, why: why[1]!.why });
  });
  it('the same plan: the reason for the next item to buy, never a held one', () => {
    expect(planReason({ kind: 'same' }, [A, B, C], [A], why)).toEqual({ id: B, why: why[1]!.why });
  });
  it('no reason when there is none to show: a removed item, nothing past the held, no verdict, an empty or missing why', () => {
    expect(planReason({ kind: 'changed', step: 2, was: C }, [A, B], [A], why)).toBeUndefined();
    expect(planReason({ kind: 'none' }, [A], [A], why)).toBeUndefined();
    expect(planReason(undefined, [A, B], [A], why)).toBeUndefined();
    expect(planReason({ kind: 'changed', step: 2, now: C }, [A, B, C], [A], why)).toBeUndefined();
    expect(planReason({ kind: 'same' }, [A, B, C], [A], undefined)).toBeUndefined();
  });
  it('drops the internal owned tag and empty words', () => {
    expect(planReason({ kind: 'same' }, [A, B], [A], [{ id: B, why: ['owned', '', 'ضرر +1%، تحمّل +0%'] }])).toEqual({ id: B, why: ['ضرر +1%، تحمّل +0%'] });
  });
});

describe('pathChangeLine', () => {
  const name = (id: number) => ({ 1: 'Rabadon\'s Deathcap', 2: 'Void Staff' } as Record<number, string>)[id];
  it('words every verdict, and nothing when a name is unknown', () => {
    expect(pathChangeLine({ kind: 'same' }, name)).toBe('الخطة المكتملة مع هذا التعزيز: لا يتغير ترتيب الأغراض القادمة.');
    expect(pathChangeLine({ kind: 'changed', step: 2, was: 1, now: 2 }, name)).toBe('الخطة المكتملة مع هذا التعزيز: Void Staff بدل Rabadon\'s Deathcap عند الخطوة القادمة رقم 2.');
    expect(pathChangeLine({ kind: 'reordered', step: 1, was: 1, now: 2 }, name)).toContain('الأغراض القادمة نفسها بترتيب آخر');
    expect(pathChangeLine({ kind: 'changed', step: 3, now: 2 }, name)).toBe('الخطة المكتملة مع هذا التعزيز: تضيف Void Staff عند الخطوة القادمة رقم 3.');
    expect(pathChangeLine({ kind: 'changed', step: 3, was: 1 }, name)).toBe('الخطة المكتملة مع هذا التعزيز: تخلو من Rabadon\'s Deathcap، وهو الخطوة القادمة رقم 3 بدونه.');
    expect(pathChangeLine({ kind: 'none' }, name)).toBe('الخطتان، مع هذا التعزيز وبدونه، لا تقترحان أغراضاً بعد ما تملكه.');
    expect(pathChangeLine({ kind: 'changed', step: 1, was: 1, now: 99 }, name)).toBeUndefined();
    expect(pathChangeLine(undefined, name)).toBeUndefined();
  });
});
