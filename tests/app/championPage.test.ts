import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import detailAr from '../fixtures/cdragon/champion-103.ar_ae.json' with { type: 'json' };
import detailEn from '../fixtures/cdragon/champion-103.default.json' with { type: 'json' };
import itemsAr from '../fixtures/cdragon/items.ar_ae.sample.json' with { type: 'json' };
import perksAr from '../fixtures/cdragon/perks.ar_ae.page.json' with { type: 'json' };
import spellsAr from '../fixtures/cdragon/summoner-spells.ar_ae.sample.json' with { type: 'json' };
import spellsEn from '../fixtures/cdragon/summoner-spells.default.sample.json' with { type: 'json' };
import stylesAr from '../fixtures/cdragon/perkstyles.ar_ae.json' with { type: 'json' };
import stylesEn from '../fixtures/cdragon/perkstyles.default.json' with { type: 'json' };
import { composeChampionPage } from '../../src/app/championPage.js';
import { parseOpgg } from '../../src/stats/opggFormat.js';
import { toBuild, toMayhemAugments } from '../../src/stats/opgg.js';
import type { AugmentText } from '../../src/texts/augments.js';
import { buildChampionDetail, buildSpellTexts, buildStyleTrees, type ChampionListEntry } from '../../src/texts/champions.js';
import { buildItemTexts, type RawItem } from '../../src/texts/items.js';
import { buildRuneTexts, type RawPerk } from '../../src/texts/runes.js';

const opgg = (f: string) => parseOpgg(readFileSync(new URL(`../fixtures/opgg/${f}`, import.meta.url), 'utf8'));
const texts = {
  items: buildItemTexts(itemsAr as RawItem[], []),
  runes: buildRuneTexts(perksAr as RawPerk[], []),
  styles: buildStyleTrees(stylesAr.styles, stylesEn.styles),
  spells: buildSpellTexts(spellsAr, spellsEn),
  championList: [] as ChampionListEntry[],
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

  it('resolves summoner spells', () => {
    expect(page.spells.map((s) => s.enName)).toEqual(['Flash', 'Ignite']);
  });

  it('lays out the full primary tree with the chosen runes marked', () => {
    const t = page.runes!.primary!;
    expect(t.style).toMatchObject({ id: 8100, enName: 'Domination' });
    expect(t.rows.map((r) => r.keystone)).toEqual([true, false, false, false]);
    expect(t.rows[0].options.map((o) => [o.id, o.selected])).toEqual([[8112, true], [8128, false], [9923, false]]);
    expect(t.rows.map((r) => r.options.filter((o) => o.selected).map((o) => o.id))).toEqual([[8112], [8139], [8140], [8106]]);
  });

  it('lays out the secondary tree without its keystone row', () => {
    const t = page.runes!.sub!;
    expect(t.style.id).toBe(8200);
    expect(t.rows).toHaveLength(3);
    expect(t.rows.flatMap((r) => r.options.filter((o) => o.selected).map((o) => o.id))).toEqual([8226, 8210]); // Manaflow row comes before Transcendence
  });

  it('marks stat shards per row (the same shard can sit in two rows)', () => {
    const s = page.runes!.shards;
    expect(s).toHaveLength(3);
    expect(s.map((r) => r.options.filter((o) => o.selected).map((o) => o.id))).toEqual([[5005], [5008], [5001]]);
  });

  it('keeps skill order and priority', () => {
    expect(page.skillOrder).toHaveLength(15);
    expect(page.skillPriority).toEqual(['Q', 'W', 'E']);
  });

  it('joins Mayhem stats to augments through any of their merged ids, in the stats order', () => {
    const p = composeChampionPage({
      champion, mode: 'mayhem', position: null, ...texts,
      build: { data: toBuild(opgg('ahri-aram.txt')), fetchedAt: 5, stale: false },
      augments: [aug(2127, [127, 2127], 'gold'), aug(1323, [1323], 'silver'), aug(9, [9], 'gold'), aug(1035, [1035], 'gold')],
      mayhem: { data: toMayhemAugments(opgg('ahri-mayhem-augments.txt')), fetchedAt: 5, stale: true },
    });
    // 2127: 88.9 > 1323: 82.46; id 9 has no stats; 1035 has popularity 0 and a placeholder performance of 170
    expect(p.augments.map((a) => a.id)).toEqual([2127, 1323]);
    expect(p.augments[0]).toMatchObject({ performance: 88.9, popularity: 0.2 });
    expect(p.stale).toBe(true);
  });

  it("keeps the stats site's own order for the champion (its recommendation), not the score", () => {
    const mayhem = [
      { id: 1, tier: 3, performance: 76, popularity: 0.22 }, // the most picked has the lowest score: score does not rank
      { id: 2, tier: 3, performance: 88, popularity: 0.17 },
      { id: 3, tier: 4, performance: 94, popularity: 0.11 },
      { id: 4, tier: 5, performance: 170, popularity: 0 }, // no sample: left out
    ];
    const p = composeChampionPage({
      champion, mode: 'mayhem', position: null, ...texts, build: null,
      augments: [aug(3, [3], 'gold'), aug(1, [1], 'gold'), aug(4, [4], 'gold'), aug(2, [2], 'gold')],
      mayhem: { data: mayhem, fetchedAt: 5, stale: false },
    });
    expect(p.augments.map((a) => [a.id, a.rank])).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it('shows no build and no error for Arena (OP.GG has none)', () => {
    const p = composeChampionPage({ champion, mode: 'arena', position: null, ...texts, build: null, augments: [], mayhem: null });
    expect(p.buildError).toBeNull();
    expect(p.runes).toBeNull();
    expect(p.fetchedAt).toBeNull();
  });

  it('still shows the champion when the build failed', () => {
    const p = composeChampionPage({ champion, mode: 'aram', position: null, ...texts, build: new Error('OP.GG down'), augments: [], mayhem: null });
    expect(p.buildError).toBe('OP.GG down');
    expect(p.core).toBeNull();
    expect(p.champion.abilities).toHaveLength(5);
  });
});

describe('matchups', () => {
  const entry = (id: number, enName: string): ChampionListEntry => ({ id, name: enName, enName, alias: enName, portraitUrl: '' });
  const base = toBuild(opgg('ahri-ranked-mid.txt'));
  const page = (b: object) =>
    composeChampionPage({
      champion, mode: 'ranked', position: 'mid', ...texts, championList: [entry(901, 'Smolder'), entry(887, 'Gwen')],
      build: { data: { ...base, ...b }, fetchedAt: 5, stale: false }, augments: [], mayhem: null,
    });

  it('names the opponents it beats and those that beat it, skipping unknown ids', () => {
    const m = page({ strongAgainst: [{ id: 901, games: 134, winRate: 0.63 }, { id: 1, games: 5, winRate: 0.9 }], weakAgainst: [{ id: 887, games: 216, winRate: 0.45 }] }).matchups;
    expect(m.strong.map((x) => [x.champion.enName, x.winRate])).toEqual([['Smolder', 0.63]]);
    expect(m.weak.map((x) => [x.champion.enName, x.winRate])).toEqual([['Gwen', 0.45]]);
  });

  it('copes with builds cached before counters were read', () => {
    expect(page({ strongAgainst: undefined, weakAgainst: undefined }).matchups).toEqual({ strong: [], weak: [] });
  });
});
