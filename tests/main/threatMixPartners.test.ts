import { afterEach, describe, expect, it, vi } from 'vitest';

// T211 (Codex T211 answer 1): card values and partners over a mix of threat levels (THREAT_MIX). The partners keep both scenarios' results,
// explain a row from the same mixture, and read limits from both. Fixture: Codex's reproduction, a held low-health shield (A) that only fires
// under heavier focus, and an offered shield power card (B) that only grows A's shield.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    kit: { id: 99, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] },
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(30), armorPerLevelModifiable: num(0), baseMR: num(30), mrPerLevel: num(0), baseMoveSpeedModifiable: num(340), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
    // T211 v3: a limit the fight reports only above this incoming damage (a stand-in for a heavy-only limit); unset, the fight is the real one.
    seen: [] as number[], above: undefined as number | undefined,
  };
});
vi.mock('../../src/ai/cardMath.js', async (original) => {
  const real = await original<typeof import('../../src/ai/cardMath.js')>();
  return { ...real, fight: (o: Parameters<typeof real.fight>[0]) => {
    const r = real.fight(o);
    fixture.seen.push(o.incomingDps ?? 0);
    return fixture.above !== undefined && (o.incomingDps ?? 0) > fixture.above ? { ...r, notModelled: [...r.notModelled, 'HEAVY-ONLY LIMIT'] } : r;
  } };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 99, alias: 'Hero', name: 'Hero' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => ({ 1: { DataValues: [] } }), loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/stats/arammayhem.js', async (original) => ({ ...await original<typeof import('../../src/stats/arammayhem.js')>(), sitePage: async () => null }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 1, enName: 'Sword', html: 'fixture item', group: 'legendary', gold: 3000 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ get CHAMPION_KITS() { return [fixture.kit]; } }));
vi.mock('../../src/ai/retiredAugments.js', () => ({ RETIRED_AUGMENTS: new Set() }));
vi.mock('../../src/ai/cardMathData.js', () => {
  const card = (id: number, name: string, ops: unknown[]) => ({ id, name, status: 'computed', ops, need: { class: 'always', items: null, ability_kind: null } });
  return { SPELL_HITS: {}, PASSIVE_NUMBERS: [], ITEM_NUMBERS: [], CARD_NUMBERS: [
    card(90001, 'Low health shield', [{ op: 'shield', amount: { flat: 500 }, trigger: 'periodic', internal_cooldown: 90, needs: 'on falling below 35% Health' }]),
    card(90002, 'Shield power', [{ op: 'add', stat: 'heal_shield_power', value: 0.5 }]),
    card(90003, 'Plate', [{ op: 'add', stat: 'hp', value: 300 }]),
  ] };
});
vi.mock('../../src/texts/augmentsLoader.js', () => {
  const e = (id: number, name: string) => ({ id, ids: [id], name, enName: name, html: 'x', described: true, rarity: 'gold', modes: ['mayhem'], pools: { [id]: ['kiwi'] }, iconUrl: '' });
  return { loadAugments: async () => ({ version: 'test', stale: false, augments: [e(90001, 'Low health shield'), e(90002, 'Shield power'), e(90003, 'Plate')] }) };
});

import { createServices, type PartnersAnswer } from '../../src/main/services.js';
import { THREAT_MIX } from '../../src/ai/itemMath.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const A = 90001, B = 90002, PLATE = 90003;
const prog = (held: number[]) => ({ level: 11, acquiredLevels: Object.fromEntries(held.map((id) => [id, 3])) });
const all = (p: PartnersAnswer) => [...p.settled, ...p.open, ...p.limited];
const offer = async (held: number[], id: number) => (await services().cardValues(99, held, [], undefined, prog(held))).find((r) => r.id === id)!.currentValue;
const mixed = async <T>(mix: { heavyFactor: number; heavyWeight: number }, f: () => Promise<T>) => { Object.assign(THREAT_MIX, mix); return f(); };
const DEFAULT = { ...THREAT_MIX };
afterEach(() => { Object.assign(THREAT_MIX, DEFAULT); });

describe('T211 threat mix', () => {
  it('regression (Codex T211): a held low-health shield with offered shield power is a partner, explained and recommended', async () => {
    const p = await services().cardPartners(99, [A], [], A, undefined, prog([A]));
    const row = all(p).find((r) => r.id === B);
    expect(row).toBeDefined();
    expect(row!.gain).toBeGreaterThan(0);
    expect(row!.interaction).toBeGreaterThan(0);
    expect(row!.explained).toBe(true);
    expect(row!.parts.healedHp).toBeGreaterThan(0); // the shield grew, only in the heavy scenario, and the mixture shows it
    expect(p.coverage.unexplained).toBe(0);
    expect(row!.gain).toBeCloseTo(await offer([A], B), 12); // G stays the offer's own value
  });

  it('pressure-dependent activation: the low-health shield is worth nothing at the usual damage and something under the mix', async () => {
    expect(await mixed({ heavyFactor: 3, heavyWeight: 0 }, () => offer([], A))).toBe(0);
    expect(await mixed({ heavyFactor: 3, heavyWeight: 0.3 }, () => offer([], A))).toBeGreaterThan(0);
  });

  it('zero heavy weight: the single-threat values, whatever the factor; no partner from heavy focus alone', async () => {
    const at3 = await mixed({ heavyFactor: 3, heavyWeight: 0 }, () => offer([], PLATE));
    const at10 = await mixed({ heavyFactor: 10, heavyWeight: 0 }, () => offer([], PLATE));
    expect(at10).toBe(at3);
    const p = await mixed({ heavyFactor: 3, heavyWeight: 0 }, () => services().cardPartners(99, [A], [], A, undefined, prog([A])));
    expect(all(p).some((r) => r.id === B)).toBe(false);
    expect(p.coverage.unexplained).toBe(0);
  });

  it('factor one: the mix is the single threat again (values and partners)', async () => {
    const single = await mixed({ heavyFactor: 3, heavyWeight: 0 }, () => offer([], PLATE));
    const one = await mixed({ heavyFactor: 1, heavyWeight: 0.3 }, () => offer([], PLATE));
    expect(one).toBeCloseTo(single, 12);
    const p0 = await mixed({ heavyFactor: 3, heavyWeight: 0 }, () => services().cardPartners(99, [A], [], A, undefined, prog([A])));
    const p1 = await mixed({ heavyFactor: 1, heavyWeight: 0.3 }, () => services().cardPartners(99, [A], [], A, undefined, prog([A])));
    expect(all(p1).map((r) => r.id)).toEqual(all(p0).map((r) => r.id));
    for (const r of all(p1)) expect(r.gain).toBeCloseTo(all(p0).find((x) => x.id === r.id)!.gain, 12);
  });

  it('mixing on absolute values: G = mix(with) / mix(without) - 1, not a mix of the two ratios', async () => {
    // With G0 (weight 0), G1 (weight 1) and k = heavy value / usual value without the card, absolute mixing gives
    // G(w) = ((1 - w) G0 + w k G1) / ((1 - w) + w k). Mixing the ratios is the case k = 1. Read k back at two weights: it must agree, and not be 1.
    const g = (heavyWeight: number) => mixed({ heavyFactor: 3, heavyWeight }, () => offer([], PLATE));
    const [g0, g1, g3, g6] = [await g(0), await g(1), await g(0.3), await g(0.6)];
    expect(Math.abs(g1 - g0)).toBeGreaterThan(1e-4);
    const k = (w: number, gw: number) => ((1 - w) / w) * (g0 - gw) / (gw - g1);
    expect(k(0.3, g3)).toBeCloseTo(k(0.6, g6), 6);
    expect(Math.abs(k(0.3, g3) - 1)).toBeGreaterThan(0.01);
  });

  // T211 v3 (Codex T211 v2 answer 2): the offer rows read limits from both scenarios, the heavy one only while its weight is above 0.
  describe('a limit only the heavy scenario reports', () => {
    const rowOf = async (held: number[], id: number) => (await services().cardValues(99, held, [], undefined, prog(held))).find((r) => r.id === id)!;
    const armed = async () => { // the usual scenario's highest incoming damage, read at weight 0; heavy focus at 10x is far above 1.5x it
      fixture.seen.length = 0;
      await mixed({ heavyFactor: 10, heavyWeight: 0 }, () => rowOf([], PLATE));
      fixture.above = 1.5 * Math.max(...fixture.seen);
    };
    afterEach(() => { fixture.above = undefined; });
    it('is on the offer row and the partner row with the heavy weight above 0', async () => {
      await armed();
      expect(String(await mixed({ heavyFactor: 10, heavyWeight: 0.3 }, () => rowOf([], PLATE)).then((r) => r.missing))).toContain('HEAVY-ONLY LIMIT');
      const p = await services().cardPartners(99, [A], [], A, undefined, prog([A]));
      expect(all(p).length).toBeGreaterThan(0);
      expect(all(p).every((r) => r.limits.includes('HEAVY-ONLY LIMIT'))).toBe(true);
    });
    it('is absent at heavy weight 0 (no heavy fight runs, none is read)', async () => {
      await armed();
      const n = fixture.seen.length;
      const r = await mixed({ heavyFactor: 10, heavyWeight: 0 }, () => rowOf([], PLATE));
      expect(String(r.missing)).not.toContain('HEAVY-ONLY LIMIT');
      expect(fixture.seen.slice(n).every((d) => d <= fixture.above!)).toBe(true);
    });
  });
});
