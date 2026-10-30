import { describe, expect, it } from 'vitest';
import { championFit, linksBetween, linksWith, type ChampionKit, type Mechanic } from '../../src/ai/mechanics.js';
import { AUGMENT_MECHANICS, ITEM_MECHANICS } from '../../src/ai/mechanicsData.js';
import { CHAMPION_KITS } from '../../src/ai/championKits.js';

const m = (id: number, over: Partial<Mechanic>): Mechanic => ({ id, name: String(id), gives: [], scales: [], converts: [], relies: [], needs: [], note: '', ...over });
const steelYourHeart = m(1152, { gives: [{ stat: 'health', unbounded: true }], needs: [3084] });
const heartsteel = m(3084, { gives: [{ stat: 'health', unbounded: true }], scales: [{ stat: 'health', effect: 'damage' }] });
const riftmaker = m(4633, { gives: [{ stat: 'health', unbounded: false }, { stat: 'ap', unbounded: false }], converts: [{ from: 'bonus_health', to: 'ap' }] });
const phenomenalEvil = m(1390, { gives: [{ stat: 'ap', unbounded: true }] });
const bigBrain = m(1180, { scales: [{ stat: 'ap', effect: 'shield' }] });
const rabadon = m(3089, { gives: [{ stat: 'ap', unbounded: false }], scales: [{ stat: 'ap', effect: 'stat' }] });

describe('mechanics links', () => {
  it('links a stat that grows without limit to what turns it into something', () => {
    expect(linksBetween(steelYourHeart, riftmaker)).toContainEqual({ from: 1152, to: 4633, stat: 'bonus_health', kind: 'feeds', strength: 2 });
    expect(linksBetween(phenomenalEvil, bigBrain)[0]).toMatchObject({ kind: 'feeds', stat: 'ap' });
  });
  it('follows a conversion to what uses its result', () => {
    expect(linksBetween(riftmaker, bigBrain)).toEqual([{ from: 4633, to: 1180, stat: 'ap', kind: 'chain', strength: 1.5 }]);
  });
  it('links an augment to the item it is built around, strongest first', () => {
    expect(linksBetween(steelYourHeart, heartsteel)[0]).toMatchObject({ kind: 'needs', strength: 3 });
  });
  it('does not link plain base stats', () => {
    expect(linksBetween(rabadon, bigBrain)).toEqual([]); // AP on an item, AP on a shield: true of every AP item
    expect(linksWith([bigBrain], riftmaker).map((l) => l.kind)).toEqual(['chain']);
  });
});

describe('mechanics data read from the texts', () => {
  const STATS = new Set('health bonus_health max_health_damage ap ad bonus_ad attack_speed crit crit_damage armor mr resists mana ability_haste move_speed lethality armor_pen magic_pen life_steal omnivamp heal_shield_power tenacity size gold damage_amp damage_reduction cooldown_refund true_damage'.split(' '));
  const all = [...AUGMENT_MECHANICS, ...ITEM_MECHANICS];
  const byName = (list: Mechanic[], n: string) => list.find((m) => m.name === n)!;

  it('uses only the agreed stat names, and every needed item is in the shop', () => {
    const stats = all.flatMap((m) => [...m.gives.map((g) => g.stat), ...m.scales.map((s) => s.stat), ...m.converts.flatMap((c) => [c.from, c.to])]);
    expect(stats.filter((s) => !STATS.has(s))).toEqual([]);
    const shop = new Set(ITEM_MECHANICS.map((i) => i.id));
    expect(AUGMENT_MECHANICS.flatMap((a) => a.needs).filter((n) => typeof n !== 'number' || !shop.has(n))).toEqual([]);
  });

  it('knows the links that started this', () => {
    const heartsteel = byName(ITEM_MECHANICS, 'Heartsteel');
    expect(byName(AUGMENT_MECHANICS, 'Steel Your Heart').needs).toContain(heartsteel.id);
    expect(byName(ITEM_MECHANICS, 'Riftmaker').converts).toContainEqual({ from: 'bonus_health', to: 'ap' });
    expect(linksBetween(byName(AUGMENT_MECHANICS, 'Phenomenal Evil'), byName(AUGMENT_MECHANICS, 'Big Brain')).length).toBeGreaterThan(0);
    expect(linksBetween(byName(AUGMENT_MECHANICS, 'Steel Your Heart'), byName(ITEM_MECHANICS, 'Riftmaker')).length).toBeGreaterThan(0);
  });
});

describe('championFit', () => {
  const diana: ChampionKit = { id: 131, name: 'Diana', damage: 'magic', scales: ['ap'], relies: ['abilities', 'dashes', 'shielding'], traits: ['burst'], note: '' };
  it('rewards an augment built on what the kit uses, and penalises attack-based or off-side ones', () => {
    expect(championFit(diana, m(1, { relies: ['abilities'], scales: [{ stat: 'ap', effect: 'damage' }] })).score).toBe(2);
    expect(championFit(diana, m(2, { relies: ['attacks'], gives: [{ stat: 'attack_speed', unbounded: false }] })).score).toBe(-2);
    expect(championFit(diana, m(3, {})).score).toBe(0);
  });
});

describe('champion kits read from the texts', () => {
  const RELIES = new Set('attacks abilities ult crit on_hit healing shielding damage_over_time crowd_control takedowns low_health movement dashes allies summoner_spells gold level'.split(' '));
  it('covers the champions with the agreed words, marksmen relying on attacks and mages on abilities', () => {
    expect(CHAMPION_KITS.length).toBeGreaterThan(160);
    expect(CHAMPION_KITS.flatMap((k) => k.relies).filter((r) => !RELIES.has(r))).toEqual([]);
    const kit = (n: string) => CHAMPION_KITS.find((k) => k.name === n)!;
    expect(kit('Jinx').relies).toContain('attacks');
    expect(kit('Ahri').relies).not.toContain('attacks');
    expect(kit('Jayce').relies).toEqual(expect.arrayContaining(['attacks', 'abilities']));
  });
});

describe('particular stats', () => {
  it('links a plain crit item to an augment that relies on crit, but not plain AP to an AP user', () => {
    const essence = ITEM_MECHANICS.find((m) => m.name === 'Essence Reaver')!;
    const jeweled = AUGMENT_MECHANICS.find((m) => m.name === 'Jeweled Gauntlet')!;
    expect(linksBetween(essence, jeweled)).toContainEqual({ from: essence.id, to: jeweled.id, stat: 'crit', kind: 'boosts', strength: 0.5 });
    expect(linksBetween(rabadon, bigBrain)).toEqual([]);
  });
});
