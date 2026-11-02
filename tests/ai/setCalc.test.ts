import { describe, expect, it } from 'vitest';
import { HEALTH_PER_LEVEL as H, linkBetween, setOutput, sniperRates, type SetSituation } from '../../src/ai/setCalc.js';
import type { GameItem } from '../../src/texts/gameData.js';

const flat = (values: Record<string, number>) => ({ DataValues: Object.entries(values).map(([name, v]) => ({ name, values: [v] })) }) as unknown as GameItem;
const shop: Record<number, GameItem> = {
  3084: flat({ FlatHPPoolMod: 900 }),
  2501: flat({ FlatHPPoolMod: 550, FlatPhysicalDamageMod: 30, HPToADPercentage: 0.025 }),
  228002: flat({ FlatMagicDamageMod: 300, APAmp: 0.5 }),
  3089: flat({ FlatMagicDamageMod: 130, APAmp: 0.3 }),
  3157: flat({ FlatMagicDamageMod: 105 }),
  3083: flat({ FlatHPPoolMod: 1000, HPAmp: 0.12 }),
};
// Base health 1000 and base AD 100 at this level, with nothing per level.
const record = { __type: 'CharacterRecord', baseHPModifiable: { baseValue: 1000 }, baseDamageModifiable: { baseValue: 100 } } as never;
const at: SetSituation = { level: 1, items: [], abilityHits: 700, engineStacks: 20, heartsteelStacks: 1000 };

describe('setOutput', () => {
  it('multiplies what is stacked, and the shield follows AP', () => {
    expect(setOutput(record, shop, [1390, 1180], at).shield).toBeCloseTo(3 * 700);
    expect(setOutput(record, shop, [1390, 1180, 228002], at).shield).toBeCloseTo(3 * (700 + 300) * 1.5);
  });
  it('builds the health chain: stacks, the x3 quest, percent health, then damage from health', () => {
    expect(setOutput(record, shop, [3084], at).hp).toBeCloseTo(1000 + H + 900 + 1000);
    expect(setOutput(record, shop, [3084, 1152], at).hp).toBeCloseTo(1000 + H + 900 + 3000);
    expect(setOutput(record, shop, [3084, 1152, 1353], at).hp).toBeCloseTo((1000 + H + 900 + 3000) * 2);
    const all = setOutput(record, shop, [3084, 1152, 1353, 1181, 2501], at);
    expect(all.hp).toBeCloseTo((1000 + H + 900 + 550 + 3000) * 2);
    expect(all.damagePerHit).toBeCloseTo(0.035 * all.hp);
    expect(all.ad).toBeCloseTo(130 + 0.025 * (all.hp - 1000));
  });
  it('leaves the x3 quest out below 100 stacks, which it triples to the 300 it asks for', () => {
    expect(setOutput(record, shop, [3084, 1152], { ...at, heartsteelStacks: 99 }).hp).toBeCloseTo(1000 + H + 900 + 99);
  });
  it("drops the quest's items when its reward is owned", () => {
    const quest = { ...at, items: [3089, 3157] };
    expect(setOutput(record, shop, [1390], quest).ap).toBeCloseTo((130 + 105 + 700) * 1.3);
    expect(setOutput(record, shop, [1390, 228002], quest).ap).toBeCloseTo((300 + 700) * 1.5);
  });
  it("amps item health only with Warmog's", () => {
    expect(setOutput(record, shop, [3083, 3084], at).hp).toBeCloseTo(1000 + H + (1000 + 900) * 1.12 + 1000);
  });
  it('counts Tank Engine by its stacks', () => {
    const alive = setOutput(record, shop, [1353], at).hp;
    expect(setOutput(record, shop, [1353], { ...at, engineStacks: 7 }).hp).toBeLessThan(alive);
  });
});

describe('linkBetween', () => {
  it('finds the multiplier the old table missed', () => {
    expect(linkBetween(record, shop, 3084, 1353, at).hp).toBeCloseTo((900 + 1000) * 1);
    expect(linkBetween(record, shop, 1390, 228002, at).ap).toBeCloseTo(700 * 0.5);
  });
  it('gives a strong link and a weak one different sizes, and none for unrelated parts', () => {
    const late = linkBetween(record, shop, 1353, 1181, at).damagePerHit;
    const early = linkBetween(record, shop, 1353, 1181, { ...at, engineStacks: 2 }).damagePerHit;
    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(0);
    expect(linkBetween(record, shop, 1180, 1353, at)).toEqual({ hp: 0, ad: 0, ap: 0, shield: 0, damagePerHit: 0 });
  });
});

describe('sniperRates', () => {
  const smolder = [{ key: 'Q', cooldown: 3.5, range: 550, mana: 25 }, { key: 'W', cooldown: 10, range: 1500, mana: 75 }];
  it('speeds up only what reaches beyond 600', () => {
    const r = sniperRates(smolder, { haste: 0, landed: 1, manaPool: 1e6, manaPerSecond: 0 });
    expect(r.with.byAbility[0].casts).toBeCloseTo(r.without.byAbility[0].casts);
    expect(r.with.byAbility[1].casts).toBeCloseTo(r.without.byAbility[1].casts * 5);
  });
  it('lets mana cap the casts', () => {
    const r = sniperRates(smolder, { haste: 0, landed: 1, manaPool: 300, manaPerSecond: 2 });
    expect(r.with.manaWanted).toBeGreaterThan(r.with.manaBudget);
    expect(r.with.byAbility[1].usable).toBeLessThan(r.with.byAbility[1].casts);
  });
});
