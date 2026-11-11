import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';

// T032 (Codex review of T028): Nasus R's storm is built apart from the cast's hit, so One Hit Wonder's gain must reach it there too, once.
const bin = JSON.parse(readFileSync(new URL('../fixtures/sim/16.22/champions/nasus.bin.json', import.meta.url), 'utf8'));
const haste: CardNumbers = { id: 99999, name: 'Test haste', status: 'computed', ops: [{ op: 'add', stat: 'haste', value: 100 }] };
const ohw = (abilityKey: 'Q' | 'W' | 'R'): CardNumbers => ({ ...CARD_NUMBERS.find((c) => c.id === 3060)!, abilityKey });
const cast = (cards: CardNumbers[], ranks = { Q: 0, W: 0, E: 0, R: 1 }) => fight({
  bin, shop: {}, kit: { damage: 'physical', attacks: false }, items: [], cards, level: 6,
  knownRanks: { level: 6, ranks },
  enemy: { armor: 0, mr: 100, physicalShare: 0.5, hp: 2000 },
});

describe('One Hit Wonder on Nasus R, whose storm is built apart from the hit (T032)', () => {
  it('raises the storm by 75% with 100 general haste when R is the chosen ability', () => {
    const before = cast([haste]), after = cast([haste, ohw('R')]);
    expect(before.casts.R).toBe(1);
    expect(after.casts.R).toBe(1);
    expect(before.fromAbilities).toBeCloseTo(450); // 10 s storm on 2000 health, 100 MR: pinned 16.22 data
    expect(after.fromAbilities).toBeCloseTo(before.fromAbilities * 1.75); // once, not 1.75 squared
    expect(after.perCast.R!).toBeCloseTo(before.perCast.R! * 1.75, -1);
  });
  it('leaves the storm as it is when another ability is the chosen one', () => {
    const ranks = { Q: 0, W: 1, E: 0, R: 1 };
    const before = cast([haste], ranks), after = cast([haste, ohw('W')], ranks);
    expect(after.casts.R).toBe(1);
    expect(after.perCast.R!).toBe(before.perCast.R!);
  });
});
