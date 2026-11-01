import { describe, expect, it } from 'vitest';
import { AUGMENT_MECHANICS, ITEM_MECHANICS } from '../../src/ai/mechanicsData.js';
import { CREATOR_RECIPES } from '../../src/app/creatorRecipes.js';
import { recipeFor, shapeOf, shiftedBuild, worthShowing } from '../../src/app/experimentalBuild.js';

const name = (n: string) => ITEM_MECHANICS.find((m) => m.name === n)!.id;
const AP = ["Rabadon's Deathcap", 'Void Staff', 'Shadowflame', "Liandry's Torment"].map(name);
const TANK = ['Heartsteel', 'Thornmail', 'Sunfire Aegis', 'Kaenic Rookern'].map(name);
const BOOTS = [1001];
const shop = new Map<number, { boots: boolean }>([...[...AP, ...TANK].map((id) => [id, { boots: false }] as const), ...BOOTS.map((id) => [id, { boots: true }] as const)]);
const augmentId = AUGMENT_MECHANICS[0].id;
const usual = (n: number) => Array.from({ length: n }, () => ({ champion: 75, augments: [-1], items: TANK }));
const moved = (n: number) => Array.from({ length: n }, () => ({ champion: 75, augments: [augmentId], items: [...AP, 1001] }));

describe('creator recipes', () => {
  it('name only items and augments the game has', () => {
    for (const r of CREATOR_RECIPES) {
      for (const a of r.augments) expect(AUGMENT_MECHANICS.some((m) => m.name.toLowerCase() === a.toLowerCase()), a).toBe(true);
      for (const i of r.items) expect(ITEM_MECHANICS.some((m) => m.name === i), i).toBe(true);
    }
  });
  it('are found by champion and a chosen augment, whatever its spelling or copies', () => {
    const overloaded = AUGMENT_MECHANICS.find((m) => m.name === 'Overloaded')!.id;
    expect(recipeFor('Nasus', [[overloaded]])?.channel).toBe('BodyThoseFools');
    expect(recipeFor('nasus', [[-1, overloaded]])).toBeDefined();
    expect(recipeFor('Nasus', [[-1]])).toBeUndefined();
    expect(recipeFor('Garen', [[overloaded]])).toBeUndefined();
  });
});

describe('shape', () => {
  it('needs three items of a kind', () => {
    expect(shapeOf(AP)).toBe('ap');
    expect(shapeOf(TANK)).toBe('tank');
    expect(shapeOf(AP.slice(0, 2))).toBe('mixed');
  });
});

describe('shifted build', () => {
  it("gives what players build when the augment moves them off the champion's usual shape", () => {
    const b = shiftedBuild([...usual(20), ...moved(5)], 75, [augmentId], shop);
    expect(b.slice().sort()).toEqual([...AP, 1001].sort());
  });
  it('stays out with too few players, or when they stay on the usual shape', () => {
    expect(shiftedBuild([...usual(20), ...moved(4)], 75, [augmentId], shop)).toEqual([]);
    expect(shiftedBuild([...usual(19), ...moved(5)], 75, [augmentId], shop)).toEqual([]);
    const stayed = Array.from({ length: 6 }, () => ({ champion: 75, augments: [augmentId], items: TANK }));
    expect(shiftedBuild([...usual(20), ...stayed], 75, [augmentId], shop)).toEqual([]);
  });
  it('stays out for a champion played both ways, when the augment only tips it over half', () => {
    const apWithout = Array.from({ length: 19 }, () => ({ champion: 75, augments: [-1], items: AP }));
    const stayed = Array.from({ length: 2 }, () => ({ champion: 75, augments: [augmentId], items: TANK }));
    expect(shiftedBuild([...usual(21), ...apWithout, ...moved(3), ...stayed], 75, [augmentId], shop)).toEqual([]);
  });
  it("leaves out one player's item and a second boots", () => {
    const one = { champion: 75, augments: [augmentId], items: [...AP, 3006] };
    const shop2 = new Map(shop).set(3006, { boots: true });
    const b = shiftedBuild([...usual(20), ...moved(5), one], 75, [augmentId], shop2);
    expect(b).not.toContain(3006);
    expect(b.filter((id) => shop2.get(id)!.boots)).toEqual([1001]);
  });
});

describe('worth showing', () => {
  it('needs enough items and at least two the main build lacks', () => {
    expect(worthShowing([1, 2, 3], [1, 8, 9])).toBe(true);
    expect(worthShowing([1, 2, 3], [1, 2, 9])).toBe(false);
    expect(worthShowing([1, 2], [8, 9])).toBe(false);
  });
});
