import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import detailAr from '../fixtures/cdragon/champion-103.ar_ae.json' with { type: 'json' };
import detailEn from '../fixtures/cdragon/champion-103.default.json' with { type: 'json' };
import itemsAr from '../fixtures/cdragon/items.ar_ae.sample.json' with { type: 'json' };
import perksAr from '../fixtures/cdragon/perks.ar_ae.sample.json' with { type: 'json' };
import spellsAr from '../fixtures/cdragon/summoner-spells.ar_ae.sample.json' with { type: 'json' };
import spellsEn from '../fixtures/cdragon/summoner-spells.default.sample.json' with { type: 'json' };
import stylesAr from '../fixtures/cdragon/perkstyles.ar_ae.json' with { type: 'json' };
import stylesEn from '../fixtures/cdragon/perkstyles.default.json' with { type: 'json' };
import { composeChampionPage } from '../../src/app/championPage.js';
import { parseOpgg } from '../../src/stats/opggFormat.js';
import { toBuild, toMayhemAugments } from '../../src/stats/opgg.js';
import type { AugmentText } from '../../src/texts/augments.js';
import { buildChampionDetail, buildSpellTexts, buildStyleTexts } from '../../src/texts/champions.js';
import { buildItemTexts, type RawItem } from '../../src/texts/items.js';
import { buildRuneTexts, type RawPerk } from '../../src/texts/runes.js';

const opgg = (f: string) => parseOpgg(readFileSync(new URL(`../fixtures/opgg/${f}`, import.meta.url), 'utf8'));
const texts = {
  items: buildItemTexts(itemsAr as RawItem[], []),
  runes: buildRuneTexts(perksAr as RawPerk[], []),
  styles: buildStyleTexts(stylesAr.styles, stylesEn.styles),
  spells: buildSpellTexts(spellsAr, spellsEn),
};
const champion = buildChampionDetail(detailAr, detailEn);
const aug = (id: number, ids: number[], rarity: AugmentText['rarity']): AugmentText => ({
  id, ids, name: `a${id}`, enName: `A${id}`, html: 'x', described: true, rarity, modes: ['mayhem'], iconUrl: '',
});

describe('composeChampionPage', () => {
  const page = composeChampionPage({
    champion, mode: 'ranked', position: 'mid', ...texts,
    build: { data: toBuild(opgg('ahri-ranked-mid.txt')), fetchedAt: 5, stale: false },
    augments: [], mayhem: null,
  });

  it('carries the champion and the headline stats', () => {
    expect(page.champion.enName).toBe('Ahri');
    expect(page.stats).toMatchObject({ games: 104125, winRate: 0.51 });
    expect(page.buildError).toBeNull();
  });

  it('resolves item ids to texts and skips ids missing from the item data', () => {
    // The fixture holds only 7 items; Zhonya (3157) is one of them, Malignance (3118) is not.
    expect(page.core!.items.map((i) => i.id)).toEqual([3157]);
    expect(page.core!.items[0]).toMatchObject({ name: 'ساعة زونيا الرملية' });
    expect(page.core!.items[0].iconUrl).toMatch(/^https:\/\/raw\.communitydragon\.org\//);
  });

  it('resolves spells, rune trees and runes', () => {
    expect(page.spells.map((s) => s.enName)).toEqual(['Flash', 'Ignite']);
    expect(page.runes!.primary).toMatchObject({ id: 8100, enName: 'Domination' });
    expect(page.runes!.sub).toMatchObject({ id: 8200, enName: 'Sorcery' });
    expect(page.runes!.perks.map((p) => p.id)).toEqual([8112]); // only Electrocute is in the perk fixture
  });

  it('keeps skill order and priority', () => {
    expect(page.skillOrder).toHaveLength(15);
    expect(page.skillPriority).toEqual(['Q', 'W', 'E']);
  });

  it('joins Mayhem stats to augments through any of their merged ids, best performance first', () => {
    const p = composeChampionPage({
      champion, mode: 'mayhem', position: null, ...texts,
      build: { data: toBuild(opgg('ahri-aram.txt')), fetchedAt: 5, stale: false },
      augments: [aug(2127, [127, 2127], 'gold'), aug(1323, [1323], 'silver'), aug(9, [9], 'gold')],
      mayhem: { data: toMayhemAugments(opgg('ahri-mayhem-augments.txt')), fetchedAt: 5, stale: true },
    });
    expect(p.augments.map((a) => a.id)).toEqual([2127, 1323]); // 2127: 88.9 > 1323: 82.46; id 9 has no stats
    expect(p.augments[0]).toMatchObject({ performance: 88.9, popularity: 0.2 });
    expect(p.stale).toBe(true);
  });

  it('still shows the champion when the build failed', () => {
    const p = composeChampionPage({ champion, mode: 'aram', position: null, ...texts, build: new Error('OP.GG down'), augments: [], mayhem: null });
    expect(p.buildError).toBe('OP.GG down');
    expect(p.core).toBeNull();
    expect(p.champion.abilities).toHaveLength(5);
  });
});
