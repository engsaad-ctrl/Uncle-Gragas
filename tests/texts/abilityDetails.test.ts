import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bin from '../fixtures/game/ahri.bin.json' with { type: 'json' };
import spells from '../fixtures/game/ahri.spells.json' with { type: 'json' };
import strings from '../fixtures/game/ahri.strings.json' with { type: 'json' };
import { buildAbilityDetails } from '../../src/texts/abilityDetails.js';
import { buildChampionDetail, type RawChampion } from '../../src/texts/champions.js';
import { GAME_URLS, isTooltipKey, loadChampionBin, loadGameItems, loadTooltipStrings } from '../../src/texts/gameData.js';

const lookup = (k: string) => (strings as Record<string, string>)[k.toLowerCase()];

describe('buildAbilityDetails (real Ahri files, 2026-10)', () => {
  const d = buildAbilityDetails(spells, bin, lookup);

  it('fills every rank and the AP ratio, like the in-game tooltip', () => {
    expect(d.get('Q')!.body).toContain('<magicDamage>35/60/85/110/135 <scaleAP><nowrap>(+50% من قوة القدرة)</nowrap></scaleAP> ضرر السحر</magicDamage>');
    expect(d.get('R')!.body).toContain('75/125/175 <scaleAP><nowrap>(+35% من قوة القدرة)</nowrap></scaleAP>');
  });

  it('adds cooldown and cost per rank, R with its 3 ranks', () => {
    expect(d.get('Q')!.head).toBe('<stats>التبريد: 7ث · التكلفة: 55/65/75/85/95 المانا</stats>');
    expect(d.get('W')!.head).toBe('<stats>التبريد: 9/8/7/6/5ث · التكلفة: 30 المانا</stats>');
    expect(d.get('R')!.head).toBe('<stats>التبريد: 140/120/100ث · التكلفة: 100 المانا</stats>');
  });

  it('builds the passive from the string table, with level-based values', () => {
    expect(d.get('P')!.body).toContain('35–95 <scaleAP><nowrap>(+20% من قوة القدرة)</nowrap></scaleAP>');
  });

  it('feeds the champion page; without game files the short description stays', () => {
    const raw = { id: 103, name: 'آري', alias: 'Ahri', title: '', squarePortraitPath: '', passive: { name: 'p', description: 'قصير', abilityIconPath: '' }, spells } as unknown as RawChampion;
    const q = (x: ReturnType<typeof buildChampionDetail>) => x.abilities.find((a) => a.key === 'Q')!.html;
    expect(q(buildChampionDetail(raw, undefined, d))).toMatch(/^<span class="t-stats">التبريد: 7ث.*<br><br>.*35\/60\/85\/110\/135 <span class="t-ap">/);
    expect(q(buildChampionDetail(raw, undefined))).not.toContain('35/60');
  });
});

describe('game files cache', () => {
  it('keeps only tooltip keys of the string table, and reuses the cache for the same version', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'lolh-game-'));
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      if (url === GAME_URLS.strings) return new Response(JSON.stringify({ entries: { buff_ahrip_tooltip: 'x', item_1001_name: 'y', '{0a1b2c3d4e}': 'z' } }));
      if (url === GAME_URLS.championBin('ahri')) return new Response(JSON.stringify(bin));
      return new Response('', { status: 404 });
    }) as typeof fetch;
    expect(await loadTooltipStrings({ cacheDir, fetchImpl }, '16.21')).toEqual({ buff_ahrip_tooltip: 'x' });
    await loadTooltipStrings({ cacheDir, fetchImpl }, '16.21');
    expect(calls).toBe(1);
    const b = await loadChampionBin({ cacheDir, fetchImpl }, '16.21', 'Ahri');
    expect(Object.keys(b)).toHaveLength(Object.keys(bin).length);
    const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await loadTooltipStrings({ cacheDir, fetchImpl: offline }, '16.22')).toEqual({ buff_ahrip_tooltip: 'x' }); // stale copy beats nothing
  });

  it('trims the items bin to values, quoted stats and the active spell cooldown', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'lolh-items-'));
    const itemsBin = {
      'Items/3146': {
        __type: 'ItemData', itemID: 3146, spellName: 'HextechGunbladeSpell', mFlatMagicDamageMod: 80,
        mDataValues: [{ mName: 'SlowAmount', mValue: 0.25 }], mItemDataClient: { mDescription: 'GeneratedTip_Item_3146_Description' },
      },
      'Items/Spells/HextechGunblade': { __type: 'SpellObject', mSpell: { cooldownTime: [60, 60, 60, 60, 60, 60, 60] } },
      'Items/ItemGroups/Default': { __type: 'ItemGroup' },
    };
    const fetchImpl = (async () => new Response(JSON.stringify(itemsBin))) as unknown as typeof fetch;
    const items = await loadGameItems({ cacheDir, fetchImpl }, '16.21');
    expect(Object.keys(items)).toEqual(['3146']);
    expect(items[3146].tooltipKey).toBe('GeneratedTip_Item_3146_Description');
    expect(items[3146].DataValues).toEqual([
      { name: 'SlowAmount', values: [0.25] },
      { name: 'FlatMagicDamageMod', values: [80] },
      { name: 'Cooldown', values: [60, 60, 60, 60, 60, 60, 60] },
    ]);
  });

  it('recognises the passive key shapes found in all 173 champions', () => {
    for (const k of ['buff_ahrip_tooltip', 'spell_zedpassive_tooltip', 'game_character_passivetooltip_jax', 'game_buff_tooltip_zyrap', 'spell_ahriseduce_name', 'generatedtip_item_3146_description', 'item_cooldown'])
      expect(isTooltipKey(k)).toBe(true);
    expect(isTooltipKey('item_1001_name')).toBe(false);
  });
});
