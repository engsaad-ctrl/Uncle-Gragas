import { describe, expect, it } from 'vitest';
import { compatibility, itemPart, lineItems, pathShare } from '../../src/ai/lines.js';
import { buildFor, type EngineInput } from '../../src/app/buildEngine.js';
import { followPath, itemsHeld, walkedPath } from '../../src/app/buildPath.js';

// The owner's own walk, kept as fixed checks. Round 1: A, B, C; A is best for the champion; he takes C. He buys the first item suggested.
// Round 2: D, E, Ain; D is best overall and fits A; Ain fits champion + C; he wants Ain above D and takes it. Round 3: T fits A and D,
// never taken; N fits Ain and C; M fits nothing; he takes M. Items follow every card taken. Real ids, so the tables are tested too.
const A = 1390; // Phenomenal Evil
const C = 1353; // Tank Engine
const D = 1180; // Big Brain, on A's line, nothing to do with C
const Ain = 1152; // Steel Your Heart, on C's line
const T = 1030; // Eureka, on A's line
const N = 1181; // Heavy Hitter, on C's line
const M = 1301; // Divine Intervention, on no line and with no stat link
const HEARTSTEEL = 3084;
const WARMOGS = 3083;
const RABADONS = 3089;

const percent = (place: number, card: number, held: number[]) => compatibility(place, pathShare(held, card))!;

// A champion whose players buy attack items. Health items are rare on him, so only the path can bring them in.
const shop = [
  { id: 3009, boots: true, damage: 'none' as const },
  { id: 3047, boots: true, damage: 'none' as const },
  { id: 6672, boots: false, damage: 'ad' as const },
  { id: 3031, boots: false, damage: 'ad' as const },
  { id: 3036, boots: false, damage: 'ad' as const },
  { id: 6676, boots: false, damage: 'ad' as const },
  { id: 3153, boots: false, damage: 'ad' as const },
  { id: HEARTSTEEL, boots: false, damage: 'none' as const },
  { id: WARMOGS, boots: false, damage: 'none' as const },
  { id: RABADONS, boots: false, damage: 'ap' as const },
];
const engine = (augments: number[], owned: number[] = [], required: number[] = []) => {
  const input: EngineInput = {
    championDamage: 'ad',
    pool: shop,
    base: [],
    mayhem: [{ id: 3009, games: 90, wins: 45 }, { id: 6672, games: 80, wins: 40 }, { id: 3031, games: 70, wins: 35 }, { id: 3036, games: 60, wins: 30 }, { id: 6676, games: 50, wins: 25 }, { id: 3153, games: 40, wins: 20 }],
    mayhemGames: 100,
    required,
    links: new Map(),
    synergy: new Map(),
    lineItems: lineItems([...augments, ...owned.map(itemPart)]),
    owned,
  };
  return buildFor(input);
};

describe("round 2: the path, not the card he passed over", () => {
  it('puts Ain above D, though D is the best card for the champion', () => {
    expect(percent(0.7, Ain, [C])).toBeGreaterThan(percent(1, D, [C]));
  });
  it('gives A no weight once he has passed it over', () => {
    expect(percent(1, D, [C])).toBeLessThan(percent(1, D, [A]));
    expect(pathShare([C], D)).toBe(0);
    expect(pathShare([A], D)).toBe(1);
  });
  it('counts the item he bought as part of the path', () => {
    expect(pathShare([C, itemPart(HEARTSTEEL)], Ain)).toBe(1);
    expect(pathShare([C, itemPart(HEARTSTEEL)], D)).toBe(0);
  });
});

describe('round 3: after C and Ain', () => {
  it('puts N, which fits both, above T, which fits only cards he never took', () => {
    expect(percent(0.5, N, [C, Ain])).toBeGreaterThan(percent(1, T, [C, Ain]));
    expect(pathShare([C, Ain], T)).toBe(0);
  });
  it('still reads M as fitting nothing', () => {
    expect(pathShare([C, Ain], M)).toBe(0);
  });
});

describe('items follow every card taken', () => {
  it('brings the line in once he takes C, though the champion rarely buys it', () => {
    expect(engine([]).items).not.toContain(HEARTSTEEL);
    expect(engine([C]).items).toContain(HEARTSTEEL);
  });
  it('keeps what he bought through the next cards, M included', () => {
    for (const cards of [[C], [C, Ain], [C, Ain, M]]) expect(engine(cards, [HEARTSTEEL]).items[0]).toBe(HEARTSTEEL);
  });
  it('lets what he bought change what comes next, once two parts of a line are held', () => {
    const next = (owned: number[]) => engine([C], owned).items.filter((id) => !owned.includes(id));
    expect(next([HEARTSTEEL]).indexOf(WARMOGS)).toBeGreaterThanOrEqual(0);
    expect(next([HEARTSTEEL]).indexOf(WARMOGS)).toBeLessThan(next([]).indexOf(WARMOGS) === -1 ? 99 : next([]).indexOf(WARMOGS));
  });
  it('moves little on one bought item alone, as things stand', () => {
    expect(engine([], [HEARTSTEEL]).items).not.toContain(WARMOGS); // a limit, and these sizes are a first guess
  });
  it('opens no line on a bought item alone, but counts it once a card has opened the line', () => {
    expect(lineItems([itemPart(HEARTSTEEL)]).size).toBe(0);
    expect(lineItems([C, itemPart(HEARTSTEEL)]).get(WARMOGS)).toBeGreaterThan(lineItems([C]).get(WARMOGS)!);
  });
  it("doesn't let a card he didn't take pull items in", () => {
    expect(engine([C]).items).not.toContain(RABADONS);
    expect(engine([A]).items).toContain(RABADONS);
  });
  it('makes room for an item a new card requires, without losing what he bought', () => {
    const items = engine([C, Ain, M], [HEARTSTEEL, 6672], [WARMOGS]).items;
    expect(items.slice(0, 2)).toEqual([HEARTSTEEL, 6672]);
    expect(items).toContain(WARMOGS);
    expect(items.length).toBeLessThanOrEqual(6);
  });
});

describe('the path as a record', () => {
  it('keeps the first item through the next card, when he has said nothing', () => {
    const first = followPath(undefined, [C], [10, 20, 30]);
    const second = walkedPath(first, [C, Ain], [], [20, 10, 30]);
    expect(second.items.slice(0, 1)).toEqual([10]);
    expect(second.bought).toBe(1);
  });
  it('takes what he says he bought as fact over anything inferred', () => {
    const inferred = followPath(followPath(undefined, [C], [10, 20, 30]), [C, Ain], [10, 20, 30]);
    const said = walkedPath(inferred, [C, Ain], [99], [99, 20, 30]);
    expect(said.bought).toBe(1);
    expect(itemsHeld(said, [99])).toEqual([99]);
  });
  it('holds the first suggestion as bought only until he says otherwise', () => {
    const first = followPath(undefined, [C], [10, 20]);
    expect(itemsHeld(first, [])).toEqual([10]);
    expect(itemsHeld(first, [20])).toEqual([20]);
  });
  it('leaves no trace of a card he removes', () => {
    const three = followPath(followPath(followPath(undefined, [C], [10, 20]), [C, Ain], [10, 20]), [C, Ain, M], [10, 20]);
    const back = walkedPath(three, [C, Ain], [], [30, 40]);
    expect(back.marks).toEqual([C, Ain]);
    expect(back.items).toEqual([30, 40]);
  });
  it('never advises an item twice or a second pair of boots', () => {
    const items = engine([C], [3009]).items;
    expect(new Set(items).size).toBe(items.length);
    expect(items).not.toContain(3047);
  });
});

describe('a stray card, as the owner set it: one against two in favour of the line', () => {
  it('counts, but two line cards outweigh one stray', () => {
    expect(pathShare([C, Ain], N)).toBe(1);
    expect(pathShare([C, Ain, M], N)).toBeCloseTo(2 / 3);
  });
  it('turns the other way with two stray cards: a health card reads low', () => {
    const M2 = 1420; // Sonata
    expect(pathShare([M, M2], Ain)).toBe(0);
    expect(pathShare([M, M2, C], Ain)).toBeCloseTo(1 / 3);
    expect(percent(0.7, Ain, [M, M2])).toBeLessThan(percent(0.7, Ain, [C, N, M]));
  });
});
