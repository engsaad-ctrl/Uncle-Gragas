import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';

// T033: ten hand-fix records carry their own limits; the text reading's notes that the fix made false no longer show.
const card = (id: number) => CARD_NUMBERS.find((c) => c.id === id)!;
const fixes = ['', '-2', '-3', '-4'].flatMap((n) => readFileSync(`knowledge/card-fixes${n}.jsonl`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as { name: string; not_modelled?: string }));
const IDS = [3049, 2139, 1015, 1053, 3051, 3132, 1079, 3016, 1401, 1311];

describe('hand-fix records show their own limits (T033)', () => {
  it('the generated note is the fix record\'s note for all ten', () => {
    for (const id of IDS) {
      const c = card(id);
      expect(c.not_modelled, c.name).toBe(fixes.find((f) => f.name === c.name)!.not_modelled);
    }
  });
  it('drops the claims the fix made false and keeps the limits still true', () => {
    expect(card(1311).not_modelled).not.toMatch(/no mana in the forms/); // Overflow: mana is a fight stat now
    expect(card(3051).not_modelled).not.toMatch(/no mana in the forms/); // Blue Barrier: the shield is counted
    expect(card(3016).not_modelled).not.toMatch(/gives no numbers/); // Third Times: 6% from the game file
    expect(card(3016).not_modelled).toMatch(/growth has no number/);
    expect(card(3132).not_modelled).not.toMatch(/ops compound/); // per_stack mult adds 1 + 0.05 n
    expect(card(1015).not_modelled).not.toMatch(/no heal-to-damage form/);
    expect(card(3049).not_modelled).not.toMatch(/overstate/);
    expect(card(1053).not_modelled).toMatch(/shrink/);
    expect(card(1401).not_modelled).toMatch(/knock-up/);
  });
  it('reaches the fight once, so the offer shows it once and never as certain', () => {
    const bin = JSON.parse(readFileSync(new URL('../fixtures/sim/16.22/champions/nasus.bin.json', import.meta.url), 'utf8'));
    const r = fight({ bin, shop: {}, kit: { damage: 'physical', attacks: true }, items: [], cards: [card(1311) as CardNumbers], level: 11 });
    const mine = r.notModelled.filter((m) => m.startsWith('Overflow: '));
    expect(mine).toEqual([`Overflow: ${card(1311).not_modelled}`]);
  });
});
