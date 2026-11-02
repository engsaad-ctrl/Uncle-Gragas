import { describe, expect, it } from 'vitest';
import { cardFit, itemPart, LINES, openLines } from '../../src/ai/lines.js';
import { AUGMENT_MECHANICS } from '../../src/ai/mechanicsData.js';

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
