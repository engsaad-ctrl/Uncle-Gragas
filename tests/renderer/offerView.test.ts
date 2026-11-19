import { describe, expect, it } from 'vitest';
import { gameLiftLine, offerTradeoff, type OfferCard } from '../../src/renderer/offerView.js';

// T037 b: the stage and the finished plan disagreeing is shown as a trade-off between settled cards only.
describe('offerTradeoff', () => {
  it('Kayle: the stage puts Firebrand higher, the finished plan Phenomenal Evil', () => {
    const cards: OfferCard[] = [{ id: 1, group: 'settled', stage: 0.415, plan: 0.05 }, { id: 2, group: 'settled', stage: 0.188, plan: 1.088 }, { id: 3, group: 'settled', stage: 0.099, plan: 0.037 }];
    expect(offerTradeoff(cards)).toEqual({ stage: 1, plan: 2 });
  });
  it('no trade-off when one card leads both, or the plan is missing on all but one', () => {
    expect(offerTradeoff([{ id: 1, group: 'settled', stage: 0.4, plan: 0.6 }, { id: 2, group: 'settled', stage: 0.1, plan: 0.2 }])).toBeUndefined();
    expect(offerTradeoff([{ id: 1, group: 'settled', stage: 0.4, plan: 0.6 }, { id: 2, group: 'settled', stage: 0.1 }])).toBeUndefined();
  });
  it('conditional and not computed cards never enter it, so their numbers are not set against settled ones', () => {
    const cards: OfferCard[] = [{ id: 1, group: 'settled', stage: 0.4, plan: 0.05 }, { id: 2, group: 'open', stage: 0.1, plan: 2 }, { id: 3, group: 'unmeasured' }];
    expect(offerTradeoff(cards)).toBeUndefined();
  });
  it('a real zero and a negative are numbers like any other', () => {
    expect(offerTradeoff([{ id: 1, group: 'settled', stage: 0, plan: 0.3 }, { id: 2, group: 'settled', stage: 0.2, plan: -0.36 }])).toEqual({ stage: 2, plan: 1 });
  });
});

// T137: the games' number (signed number isolated LTR so the sign stays in front in Arabic) for a card the fight cannot value: its own line, signed, with the players behind it; nothing when there is none.
describe('gameLiftLine', () => {
  it('signs the points, names the players and says when the halves disagree', () => {
    expect(gameLiftLine({ points: 2.6, players: 19967, stable: true })).toBe('من المباريات، مجمّع عبر الأبطال: ⁦+2.6⁩ نقطة مئوية في الفوز (19,967 مشاركة). فرق معدّل حسب البطل ومقلّص نحو الصفر؛ ارتباط لا سبب، وخارج نسبة القتال.');
    expect(gameLiftLine({ points: -1.3, players: 1500, stable: false })).toContain('⁦-1.3⁩ نقطة مئوية في الفوز');
    expect(gameLiftLine({ points: -1.3, players: 1500, stable: false })).toContain('اتجاه الفرق يختلف بين نصفي المباريات.');
    expect(gameLiftLine(undefined)).toBeUndefined();
  });
});
