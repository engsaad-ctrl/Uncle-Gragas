import { describe, expect, it, vi } from 'vitest';

// T047: Apex Inventor (1002) takes its ItemHaste from the loaded patch file (tests/fixtures/game/apex-inventor-16.22.json) on every path: the offer's
// value now, the full plan and the build search. The stored card has no ops, so a path that skipped the file reader would show it as having no
// equations. Extra data here, not in the 840-file snapshot: the Apex fixture and Ravenous Hydra's own DataValues (item-cooldowns-16.22.json).
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  return {
    withGame: true,
    bin: { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(150), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(345), attackSpeedModifiable: num(0.65), attackSpeedRatioModifiable: num(0.65), attackSpeedPerLevelModifiable: num(0) } },
  };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 122, alias: 'Darius', name: 'Darius' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => {
  const { readFileSync } = await import('node:fs');
  const items = JSON.parse(readFileSync('tests/fixtures/game/item-cooldowns-16.22.json', 'utf8')).items;
  return {
    ...await original<typeof import('../../src/texts/gameData.js')>(),
    loadGameVersion: async () => 'test', loadGameItems: async () => ({ 3074: items['3074'] }), loadChampionBin: async () => fixture.bin,
    loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
  };
});
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [{ id: 3074, enName: 'Ravenous Hydra', html: 'fixture item', group: 'legendary', gold: 3300 }] }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 122, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, PASSIVE_NUMBERS: [],
  ITEM_NUMBERS: [{ id: 3074, ops: [{ op: 'proc', trigger: 'periodic', internal_cooldown: 10, damage: { ad: 1 }, type: 'physical', needs: 'active item, used when ready' }] }],
  CARD_NUMBERS: [{ id: 1002, name: 'Apex Inventor', status: 'unreadable', ops: [], need: { class: 'always', items: null, ability_kind: null } }],
}));
vi.mock('../../src/texts/augmentsLoader.js', async () => {
  const { readFileSync } = await import('node:fs');
  const { augmentDataOnly } = await vi.importActual<typeof import('../../src/texts/augmentsLoader.js')>('../../src/texts/augmentsLoader.js');
  const { buildAugmentTexts } = await import('../../src/texts/augments.js');
  const bin = JSON.parse(readFileSync('tests/fixtures/game/apex-inventor-16.22.json', 'utf8')).bin;
  const entry = { id: 1002, augmentNameId: 'ARAM_ApexInventor', nameTRA: 'Apex Inventor', augmentSmallIconPath: 'x.png', rarity: 'kGold' };
  return {
    loadAugments: async () => {
      // The fixture cuts Apex's records, not the file's pool; its Mayhem membership (kiwi pool, T050) is given as the loader keeps it.
      const pool = { __type: 'AugmentPool' as const, source: 'kiwi' as const, ids: [1002], unresolved: 0 };
      const [text] = await buildAugmentTexts({ listAr: [entry], listEn: [entry], bins: [augmentDataOnly(bin), [pool]], strings: {} });
      return { version: 'test', stale: false, augments: [{ ...text!, game: fixture.withGame ? text!.game : undefined }] };
    },
  };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const NO_EQUATIONS = 'التعزيز 1002: لا يملك معادلات';

describe('Apex Inventor numbers from the patch file in every path', () => {
  it('with Ravenous Hydra held: a value now, a full plan, and the build search reads it', async () => {
    fixture.withGame = true;
    const s = services();
    const rows = await s.cardValues(122, [], [3074], undefined, { level: 11 }, [1002]);
    const apex = rows.find((r) => r.id === 1002)!;
    expect(apex.currentValue).toBeGreaterThan(0);
    expect(apex.missing).toContain('Spellblade');
    expect(apex.planError).toBeUndefined();
    expect(apex.plan).toBeDefined();
    const build = await s.mathBuild(122, [1002], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 1002: 7 } });
    expect(('missing' in build[0]! ? build[0].missing : []).join(' ')).not.toContain(NO_EQUATIONS);
  });
  it('with no eligible item held, its value now is a computed zero', async () => {
    fixture.withGame = true;
    const apex = (await services().cardValues(122, [], [], undefined, { level: 11 }, [1002])).find((r) => r.id === 1002)!;
    expect(apex.currentValue).toBe(0);
  });
  it('shows no numbers, and says so, when the file data is missing', async () => {
    fixture.withGame = false;
    const s = services();
    expect((await s.cardValues(122, [], [3074], undefined, { level: 11 })).find((r) => r.id === 1002)).toBeUndefined();
    const build = await s.mathBuild(122, [1002], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 1002: 7 } });
    expect(('missing' in build[0]! ? build[0].missing : []).join(' ')).toContain(NO_EQUATIONS);
    fixture.withGame = true;
  });
});

// A services test only: loadAugments is replaced by a made-up list, so this proves how the services use an augment list without Apex's file data,
// not the cache migration or the offline path (those are tests/texts/augmentsCache.test.ts, through the real loader and diskCache).
describe('the services, given an augment list without Apex file data', () => {
  it('keep every other augment and leave Apex Inventor without numbers', async () => {
    fixture.withGame = false; // what a list read before the Apex reader holds for Apex: its text, no game data
    const s = services();
    const all = (await s.augments()).augments;
    expect(all.map((a) => a.id)).toContain(1002);
    expect(all.find((a) => a.id === 1002)?.game).toBeUndefined();
    expect((await s.cardValues(122, [], [3074], undefined, { level: 11 })).find((r) => r.id === 1002)).toBeUndefined();
    fixture.withGame = true;
  });
});
