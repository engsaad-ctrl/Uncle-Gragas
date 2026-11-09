import { describe, expect, it, vi } from 'vitest';

// BEES!!! (3086) takes its numbers from the loaded patch file in every path: the offer, the full plan, the build search and its explanation.
// The stored card has no ops, so a path that skipped the file reader would show it as having no equations.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const q = { __type: 'SpellObject', mSpell: { cooldownTime: [2, 2, 2, 2, 2, 2], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
  return {
    withGame: true,
    shop: { 1: { DataValues: [{ name: 'FlatPhysicalDamageMod', values: [100] }] }, 2: { DataValues: [{ name: 'FlatHPPoolMod', values: [500] }] } },
    bin: { rec: { __type: 'CharacterRecord', spells: ['x/q'], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(50), armorPerLevelModifiable: num(0), baseMR: num(50), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) }, 'x/q': q },
  };
});
vi.mock('../../src/texts/cdragon.js', async (original) => ({ ...await original<typeof import('../../src/texts/cdragon.js')>(), loadCdragonJson: async (_locale: string, file: string) => ({ data: file === 'perkstyles.json' ? { styles: [] } : [] }) }));
vi.mock('../../src/texts/champions.js', async (original) => ({ ...await original<typeof import('../../src/texts/champions.js')>(), buildChampionList: () => [{ id: 103, alias: 'Ahri', name: 'Ahri' }] }));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: async () => 'test', loadGameItems: async () => fixture.shop, loadChampionBin: async () => fixture.bin,
  loadTooltipStrings: async () => ({}), loadStringTable: async () => ({}),
}));
vi.mock('../../src/stats/opgg.js', async (original) => ({ ...await original<typeof import('../../src/stats/opgg.js')>(), OpggStats: class { mapItems() { return { data: {}, fetchedAt: 0, stale: false }; } } }));
vi.mock('../../src/app/itemList.js', () => ({ composeItemList: () => [1, 2].map((id) => ({ id, enName: String(id), html: 'fixture item', group: 'legendary', gold: 3000 })) }));
vi.mock('../../src/ai/championKits.js', () => ({ CHAMPION_KITS: [{ id: 103, damage: 'physical', relies: ['attacks'], traits: [], scales: ['ad'] }] }));
vi.mock('../../src/ai/cardMathData.js', () => ({ SPELL_HITS: {}, ITEM_NUMBERS: [], PASSIVE_NUMBERS: [], CARD_NUMBERS: [
  { id: 3086, name: 'BEES!!!', status: 'partial', ops: [], need: { class: 'always', items: null, ability_kind: null }, needs: 'the ability must hit an enemy champion' },
] }));
vi.mock('../../src/texts/augmentsLoader.js', async () => {
  const { readFileSync } = await import('node:fs');
  const { augmentDataOnly } = await vi.importActual<typeof import('../../src/texts/augmentsLoader.js')>('../../src/texts/augmentsLoader.js');
  const { buildAugmentTexts } = await import('../../src/texts/augments.js');
  const bin = JSON.parse(readFileSync('tests/fixtures/game/bees-16.21-16.22.json', 'utf8')).patches['16.22'].bin;
  const entry = { id: 3086, augmentNameId: 'BEES', nameTRA: 'BEES!!!', augmentSmallIconPath: 'x.png', rarity: 'kGold' };
  return {
    loadAugments: async () => {
      const [text] = await buildAugmentTexts({ listAr: [entry], listEn: [entry], bins: [augmentDataOnly(bin)], strings: {} });
      return { version: 'test', stale: false, augments: [{ ...text!, game: fixture.withGame ? text!.game : undefined }] };
    },
  };
});

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const NO_EQUATIONS = 'التعزيز 3086: لا يملك معادلات';

describe('BEES!!! numbers from the patch file in every path', () => {
  it('reaches the offer, the plan, the build search and its explanation', async () => {
    fixture.withGame = true;
    const s = services();
    const rows = await s.cardValues(103, [], [], undefined, { level: 9 }, [3086]);
    const bees = rows.find((r) => r.id === 3086)!;
    expect(bees.damage).toBeGreaterThan(0);
    expect(bees.missing).toContain('الهدف الرئيسي وحده');
    expect(bees.planError).toBeUndefined();
    expect(bees.plan).toBeDefined();
    const build = await s.mathBuild(103, [3086], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 3086: 7 } });
    const missing = 'missing' in build[0]! ? build[0].missing : [];
    expect(missing.join(' ')).not.toContain(NO_EQUATIONS);
    expect(missing.join(' ')).toContain('الهدف الرئيسي وحده');
  });
  it('shows no numbers, and says so, when the file data is missing', async () => {
    fixture.withGame = false;
    const s = services();
    expect((await s.cardValues(103, [], [], undefined, { level: 9 })).find((r) => r.id === 3086)).toBeUndefined();
    const build = await s.mathBuild(103, [3086], [], undefined, undefined, undefined, { level: 11, acquiredLevels: { 3086: 7 } });
    expect(('missing' in build[0]! ? build[0].missing : []).join(' ')).toContain(NO_EQUATIONS);
    fixture.withGame = true;
  });
});
