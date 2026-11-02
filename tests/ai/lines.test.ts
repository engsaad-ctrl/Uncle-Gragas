import { describe, expect, it } from 'vitest';
import { blockedItems, cardFit, compatibility, conflictsWith, CONFLICTS, itemPart, lineItems, LINES, openLines, pathShare, placesOf } from '../../src/ai/lines.js';
import { AUGMENT_MECHANICS } from '../../src/ai/mechanicsData.js';

describe('placesOf', () => {
  it('runs from 0 for the lowest to 1 for the highest', () => {
    expect([...placesOf(new Map([[1, -3], [2, 0], [3, 5]])).values()]).toEqual([0, 0.5, 1]);
  });
  it('gives ties one place, and a lone augment the top', () => {
    expect([...placesOf(new Map([[1, 2], [2, 2], [3, 9]])).values()]).toEqual([0, 0, 1]);
    expect(placesOf(new Map([[1, -4]])).get(1)).toBe(1);
  });
});

describe('compatibility', () => {
  it('is the champion place alone in the first round or off any line', () => {
    expect(compatibility(0.75, undefined)).toBe(75);
  });
  it('joins the champion place and the held share', () => {
    expect(compatibility(0.5, 1)).toBe(75);
    expect(compatibility(1, 0)).toBe(50);
  });
  it('stays unknown with no champion data', () => {
    expect(compatibility(undefined, 1)).toBeUndefined();
  });
});

describe('cardFit', () => {
  it('says a card can start a line when nothing is held', () => {
    const f = cardFit([], 1353);
    expect(f?.line.id).toBe('health');
    expect(f?.share).toBeUndefined();
  });
  it('gives the share of held parts on the same line', () => {
    expect(cardFit([1353, 1181], 1152)?.share).toBe(1);
    expect(cardFit([1353, 1390], 1152)?.share).toBe(0.5);
    expect(cardFit([1390], 1152)?.share).toBe(0);
  });
  it('counts items held on the line', () => {
    expect(cardFit([itemPart(3084)], 1353)?.share).toBe(1);
  });
  it('keeps an item apart from an augment with the same id', () => {
    expect(cardFit([3036], 1048)?.share).toBeUndefined(); // the augment Double Time is on no line; Lord Dominik's item is
    expect(cardFit([itemPart(3036)], 1048)?.share).toBe(1);
  });
  it('picks the line that fits the held parts when a card is on two', () => {
    expect(cardFit([1390], 1129)?.line.id).toBe('ap'); // Marksmage
    expect(cardFit([2010], 1129)?.line.id).toBe('onhit');
  });
  it('leaves held parts on no line out of the count', () => {
    expect(cardFit([1353, 999999], 1152)?.share).toBe(1);
  });
  it('calls a card on no line unknown, not a bad fit', () => {
    expect(cardFit([1353], 999999)).toBeUndefined();
    expect(cardFit([1353], undefined)).toBeUndefined();
  });
  it('keeps the AP line off a physical champion, but not the health line', () => {
    expect(cardFit([], 1390, 'ad')).toBeUndefined();
    expect(cardFit([], 1390, 'ap')?.line.id).toBe('ap');
    expect(cardFit([], 1353, 'ad')?.line.id).toBe('health');
  });
  it('does not count the card itself as held', () => {
    expect(cardFit([1353], 1353)?.share).toBeUndefined();
  });
});

describe('openLines', () => {
  it('lists lines with held parts, fullest first, and the core still missing', () => {
    const [first, second] = openLines([1390, 1353, itemPart(3084)]);
    expect(first?.line.id).toBe('health');
    expect(first?.missing).toEqual([1152, itemPart(3083)]);
    expect(second?.line.id).toBe('ap');
  });
  it('is empty with nothing held', () => {
    expect(openLines([])).toEqual([]);
  });
});

describe('pathShare', () => {
  it('is unknown at the start of the path, and for a card the tables lack', () => {
    expect(pathShare([], 1353)).toBeUndefined();
    expect(pathShare([1353], undefined)).toBeUndefined();
    expect(pathShare([1353], 999999)).toBeUndefined();
  });
  it('counts a line or a text link, and leaves unknown parts out', () => {
    expect(pathShare([1353], 1152)).toBe(1); // a line: Tank Engine and Steel Your Heart
    expect(pathShare([1353, 999999], 1152)).toBe(1);
    expect(pathShare([1353, 1390], 1152)).toBe(0.5);
  });
  it('counts items on the path', () => {
    expect(pathShare([itemPart(3084)], 1353)).toBe(1);
  });
  it('reaches cards on no line through text links', () => {
    const offLine = AUGMENT_MECHANICS.map((m) => m.id).filter((id) => !LINES.some((l) => [...l.core, ...l.branches].includes(id)));
    expect(offLine.filter((id) => (pathShare([1353], id) ?? 0) > 0).length).toBeGreaterThan(0);
  });
  it('gives a known card with no link 0, not a free pass', () => {
    expect(pathShare([1353], 1180)).toBe(0); // Big Brain has nothing to do with Tank Engine
  });
});

describe("the owner's walk: the path outweighs the card he didn't take", () => {
  // Champion place: D is the best card and fits A, which he passed over; Ain is lower but fits C, which he took.
  const [C, Ain, D, A] = [1353, 1152, 1180, 1390]; // Tank Engine, Steel Your Heart, Big Brain, Phenomenal Evil
  const percent = (place: number, card: number, path: number[]) => compatibility(place, pathShare(path, card))!;
  it('puts Ain above D after C', () => {
    expect(percent(0.7, Ain, [C])).toBeGreaterThan(percent(1, D, [C]));
  });
  it('gives the card he passed over no weight', () => {
    expect(percent(1, D, [C])).toBe(50);
    expect(percent(1, D, [A])).toBeGreaterThan(percent(1, D, [C])); // D would fit if he had taken A
  });
  it('at the third round prefers what fits both cards taken over the best card that fits neither', () => {
    const [N, T] = [1181, 1390]; // Heavy Hitter on the health line; Phenomenal Evil, which fits A and D, never taken
    expect(percent(0.5, N, [C, Ain])).toBeGreaterThan(percent(1, T, [C, Ain]));
  });
  it('counts a stray card like any other for now, which lowers the share of what follows', () => {
    expect(pathShare([C, D], Ain)).toBe(0.5); // whether a stray card should weigh less is the owner's to say
  });
});

describe('conflicts', () => {
  const [gauntlet, liandry, vulnerability, butter, punch] = [1048, itemPart(6653), 1092, 1103, 1058];
  it('names a clash with what is held, either way round', () => {
    expect(conflictsWith([butter], punch)).toHaveLength(1);
    expect(conflictsWith([punch], butter)).toHaveLength(1);
    expect(conflictsWith([liandry], gauntlet)).toHaveLength(1);
  });
  it('lifts it when the card that answers it is held', () => {
    expect(conflictsWith([liandry, vulnerability], gauntlet)).toEqual([]);
  });
  it('finds none without the other part', () => {
    expect(conflictsWith([1353], punch)).toEqual([]);
    expect(conflictsWith([], punch)).toEqual([]);
    expect(conflictsWith([butter], undefined)).toEqual([]);
  });
  it('counts a clashing part as not working with the card', () => {
    expect(pathShare([liandry], gauntlet)).toBe(0);
  });
  it('warns on what Back To Basics locks, and blocks only the items', () => {
    const [basics, malignance, recursion] = [1004, 3118, 3055];
    expect(conflictsWith([basics], itemPart(malignance))).toHaveLength(1);
    expect(conflictsWith([basics], recursion)).toHaveLength(1);
    expect(conflictsWith([recursion], basics)).toHaveLength(1);
    expect(blockedItems([basics])).toEqual([3118, 2512, 3073, 6696]);
    expect(blockedItems([recursion])).toEqual([]);
  });
  it('names only real augments', () => {
    const augments = new Set(AUGMENT_MECHANICS.map((m) => m.id));
    for (const c of CONFLICTS) for (const id of [c.a, c.b]) if (id > 0) expect(augments.has(id), String(id)).toBe(true);
  });
});

describe('lineItems', () => {
  it('asks for a line\'s items, core above branch, in full from two held parts', () => {
    const one = lineItems([1353]);
    expect(one.get(3084)).toBe(0.5);
    expect(one.get(2501)).toBe(0.25);
    const two = lineItems([1353, 1152]);
    expect(two.get(3084)).toBe(1);
    expect(two.get(2501)).toBe(0.5);
  });
  it('follows the fullest line only, and both when tied', () => {
    const health = lineItems([1353, 1152, 1390]);
    expect(health.has(3084)).toBe(true);
    expect(health.has(3089)).toBe(false);
    const tied = lineItems([1353, 1390]);
    expect(tied.has(3084)).toBe(true);
    expect(tied.has(3089)).toBe(true);
  });
  it('asks nothing with no part on a line', () => {
    expect(lineItems([]).size).toBe(0);
    expect(lineItems([999999]).size).toBe(0);
  });
  it('lists items, not augments', () => {
    expect(lineItems([1353]).has(1152)).toBe(false);
  });
});

describe('LINES', () => {
  it('names only real augments', () => {
    const augments = new Set(AUGMENT_MECHANICS.map((m) => m.id));
    for (const l of LINES) for (const id of [...l.core, ...l.branches]) if (id > 0) expect(augments.has(id), `${l.id} ${id}`).toBe(true);
  });
  it('gives every line a core and a way to fail', () => {
    for (const l of LINES) {
      expect(l.core.length, l.id).toBeGreaterThan(0);
      expect(l.breaks.length, l.id).toBeGreaterThan(0);
    }
  });
});
