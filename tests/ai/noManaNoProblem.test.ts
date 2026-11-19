import { describe, expect, it } from 'vitest';
import { fight, type CardNumbers, type CardOp } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

// T144 (Codex T140 A list): No Mana, No Problem (3059), kiwi 16.23: the mana his items give becomes AP, 10 mana to 1 AP ({8e5ab46a}=10,
// {f717dc88}=1; 16.22 had 0.8), and his total AP rises 15% (APAmp 0.15). His own mana stays. Juiced (7% of maximum mana on hit) reads his pool.
const num = (baseValue: number) => ({ baseValue });
const rec = (manaBase?: number) => ({
  __type: 'CharacterRecord', spells: [],
  baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0),
  baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325),
  attackRangeModifiable: num(125), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0),
  ...(manaBase === undefined ? {} : { primaryAbilityResource: { arType: 0, '{726ee5cd}': num(manaBase), '{6216bf7b}': num(0) } }),
});
const MANA_ITEM = 7777;
const shop = { [MANA_ITEM]: { DataValues: [{ name: 'FlatMPPoolMod', values: [400] }] } } as never;
const noMana = CARD_NUMBERS.find((c) => c.id === 3059)!;
const juiced = CARD_NUMBERS.find((c) => c.id === 2016)!;
const ap100: CardNumbers = { id: 0, name: 'Test AP', status: 'computed', ops: [{ op: 'add', stat: 'ap', value: 100 }] };
const run = (cards: CardNumbers[], manaBase?: number) => fight({ bin: { rec: rec(manaBase) }, shop, kit: { damage: 'physical', attacks: true }, items: [MANA_ITEM], cards, level: 1, enemy: { armor: 0, mr: 0, physicalShare: 0.5 } });

describe('No Mana, No Problem (3059)', () => {
  it('has the generated row', () => {
    expect(noMana.ops).toEqual([{ op: 'convert', from: 'item_mana', to: 'ap', ratio: 0.1, replace: true }, { op: 'mult', stat: 'ap', factor: 1.15 }] as CardOp[]);
  });
  it('turns 400 item mana into 40 AP and raises AP 15%: 100 AP becomes 161 (Codex oracle)', () => {
    expect(run([ap100], 500).stats.ap).toBeCloseTo(100, 6);
    expect(run([ap100, noMana], 500).stats.ap).toBeCloseTo((100 + 40) * 1.15, 6);
  });
  it('takes the item mana out of his pool and keeps his own: 7% Juiced reads 500, not 900', () => {
    const perHit = (cards: CardNumbers[]) => { const r = run([...cards, juiced], 500); return r.fromCards / r.attacks; };
    expect(perHit([])).toBeCloseTo(0.07 * 900, 6);
    expect(perHit([noMana])).toBeCloseTo(0.07 * 500, 6);
  });
  it('a champion with no mana bar still turns his items\' mana into AP', () => {
    expect(run([ap100, noMana]).stats.ap).toBeCloseTo((100 + 40) * 1.15, 6);
  });
  // Codex T145: his items' own mana conversions read the pool that is left (500), never the original 900, by explicit itemOps and by file
  // DataValues alike, in either item order; the 1.15 comes after every conversion. Synthetic rates: 2% AP (Seraph-style), 2.5% bonus AD (Manamune-style).
  describe('with item mana conversions (T145)', () => {
    const CONV = 8888;
    const fileShop = (dv: string, v: number) => ({ [MANA_ITEM]: { DataValues: [{ name: 'FlatMPPoolMod', values: [400] }] }, [CONV]: { DataValues: [{ name: dv, values: [v] }] } }) as never;
    const go = (o: { cards: CardNumbers[]; items: number[]; shop?: never; itemOps?: Record<number, CardOp[]>; manaBase?: number }) =>
      fight({ bin: { rec: rec(o.manaBase) }, shop: o.shop ?? shop, ...(o.itemOps ? { itemOps: o.itemOps } : {}), kit: { damage: 'physical', attacks: true }, items: o.items, cards: o.cards, level: 1, enemy: { armor: 0, mr: 0, physicalShare: 0.5 } }).stats;
    const seraphOps = { [CONV]: [{ op: 'convert', from: 'mana', to: 'ap', ratio: 0.02 } as CardOp] };
    const manamuneOps = { [CONV]: [{ op: 'convert', from: 'mana', to: 'bonus_ad', ratio: 0.025 } as CardOp] };
    for (const items of [[MANA_ITEM, CONV], [CONV, MANA_ITEM]]) {
      it(`Seraph-style AP reads 500 left: (100 + 40 + 500 x 0.02) x 1.15 = 172.5, items ${items.join(',')}`, () => {
        expect(go({ cards: [ap100, noMana], items, itemOps: seraphOps, manaBase: 500 }).ap).toBeCloseTo(172.5, 6);
        expect(go({ cards: [ap100, noMana], items, shop: fileShop('APFromMana', 0.02), manaBase: 500 }).ap).toBeCloseTo(172.5, 6);
        expect(go({ cards: [ap100], items, itemOps: seraphOps, manaBase: 500 }).ap).toBeCloseTo(100 + 900 * 0.02, 6); // control without 3059
      });
      it(`Manamune-style bonus AD reads 500 left: +12.5, items ${items.join(',')}`, () => {
        const base = go({ cards: [noMana], items: [MANA_ITEM], manaBase: 500 }).ad;
        expect(go({ cards: [noMana], items, itemOps: manamuneOps, manaBase: 500 }).ad - base).toBeCloseTo(12.5, 6);
        expect(go({ cards: [noMana], items, shop: fileShop('BonusADManaRatioTOOLTIPONLY', 0.025), manaBase: 500 }).ad - base).toBeCloseTo(12.5, 6);
        expect(go({ cards: [], items, itemOps: manamuneOps, manaBase: 500 }).ad - go({ cards: [], items: [MANA_ITEM], manaBase: 500 }).ad).toBeCloseTo(22.5, 6); // control: 900
      });
    }
    it('a champion with no mana bar: the AP from his items\' mana still comes, and no conversion reads a missing pool as a number', () => {
      const s = go({ cards: [ap100, noMana], items: [MANA_ITEM, CONV], itemOps: seraphOps });
      expect(Number.isFinite(s.ap)).toBe(true);
      expect(s.ap).toBeCloseTo((100 + 40) * 1.15, 6);
    });
  });
});
