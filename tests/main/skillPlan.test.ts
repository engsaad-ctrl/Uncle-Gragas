import { describe, expect, it, vi } from 'vitest';

// The build page's skill order reaches the item search, and its note says so; with no page the note says even spread.
const fixture = vi.hoisted(() => {
  const num = (baseValue: number) => ({ baseValue });
  const q = { __type: 'SpellObject', mSpell: { cooldownTime: [2, 2, 2, 2, 2, 2], DataValues: [{ name: 'BaseDamage', values: [100, 100, 100, 100, 100, 100] }], mSpellCalculations: { TotalDamage: { mFormulaParts: [{ __type: 'NamedDataValueCalculationPart', mDataValue: 'BaseDamage' }] } } } };
  return {
    withGame: true,
    site: true,
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

vi.mock('../../src/stats/arammayhem.js', async (original) => ({ ...await original<typeof import('../../src/stats/arammayhem.js')>(), sitePage: async () => (fixture.site ? { data: { build: { skillOrder: [], skillPriority: ['Q', 'E', 'W'], starter: [], boots: [], core: [], others: [] } }, fetchedAt: 0, stale: false } : null) }));

import { createServices } from '../../src/main/services.js';
const services = () => createServices({ cacheDir: 'unused-in-memory-fixture', fetchImpl: vi.fn(() => { throw new Error('network forbidden in this test'); }) });
const notes = async () => { const b = await services().mathBuild(103, [], [], undefined, undefined, undefined, { level: 11 }); return ('missing' in b[0]! ? b[0].missing : []).join(' '); };

describe('skill order from the build page', () => {
  it('uses the page order when there are no live ranks, and says so', async () => {
    fixture.site = true;
    expect(await notes()).toContain('ترتيب صفحة البناء');
    fixture.site = false;
    expect(await notes()).toContain('توزيع قانوني متساوٍ');
    fixture.site = true;
  });
});

it('asks the page again later when it could not be read, instead of keeping the even spread for the whole session', async () => {
  const s = services();
  const note = async (level: number) => { const b = await s.mathBuild(103, [], [], undefined, undefined, undefined, { level }); return ('missing' in b[0]! ? b[0].missing : []).join(' '); };
  fixture.site = false;
  expect(await note(11)).toContain('توزيع قانوني متساوٍ');
  fixture.site = true;
  expect(await note(12)).toContain('ترتيب صفحة البناء'); // another level, so not the cached build
});
