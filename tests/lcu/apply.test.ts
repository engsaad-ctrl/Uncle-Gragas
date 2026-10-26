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
import { applyAll, applyItemSet, applyRunePage, arrangeSpells, TAG, toPayloads } from '../../src/lcu/apply.js';
import type { LcuCall } from '../../src/lcu/client.js';
import { parseOpgg } from '../../src/stats/opggFormat.js';
import { toBuild } from '../../src/stats/opgg.js';
import { buildChampionDetail, buildSpellTexts, buildStyleTrees } from '../../src/texts/champions.js';
import { buildItemTexts, type RawItem } from '../../src/texts/items.js';
import { buildRuneTexts, type RawPerk } from '../../src/texts/runes.js';

const page = composeChampionPage({
  champion: buildChampionDetail(detailAr, detailEn), mode: 'ranked', position: 'mid',
  items: buildItemTexts(itemsAr as RawItem[], []), runes: buildRuneTexts(perksAr as RawPerk[], []),
  styles: buildStyleTrees(stylesAr.styles, stylesEn.styles), spells: buildSpellTexts(spellsAr, spellsEn),
  build: { data: toBuild(parseOpgg(readFileSync(new URL('../fixtures/opgg/ahri-ranked-mid.txt', import.meta.url), 'utf8'))), fetchedAt: 5, stale: false },
  augments: [], mayhem: null,
});

/** A fake client that records requests and answers from a table (method + path). */
function fakeClient(answers: Record<string, unknown>, fail: string[] = []) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const call: LcuCall = async (method, path, body) => {
    calls.push({ method, path, body });
    if (fail.includes(`${method} ${path}`)) throw new Error('LCU: HTTP 400 max pages');
    return answers[`${method} ${path}`] ?? null;
  };
  return { calls, call };
}

describe('toPayloads (real Ahri mid build)', () => {
  const p = toPayloads(page);

  it('builds a complete rune page: 4 primary, 2 secondary, 3 shards', () => {
    expect(p.runePage).toMatchObject({ name: `${TAG} Ahri`, primaryStyleId: page.runes!.primary!.style.id, subStyleId: page.runes!.sub!.style.id });
    expect(p.runePage!.selectedPerkIds).toHaveLength(9);
  });

  it('builds an item set for Summoner\'s Rift with the page\'s blocks, and the two spells', () => {
    expect(p.itemSet).toMatchObject({ title: `${TAG} Ahri mid`, championId: 103, mapId: 11 });
    expect(p.itemSet!.blocks.map((b) => b.type)).toContain('الأيتمات الأساسية'); // the sample item list lacks the starters, which are then skipped
    expect(p.itemSet!.blocks.every((b) => b.items.length > 0)).toBe(true);
    expect(p.spells).toEqual([page.spells[0].id, page.spells[1].id]);
  });

  it('writes nothing for a page without a build', () => {
    expect(toPayloads({ ...page, runes: null, starter: null, core: null, boots: null, fourth: [], fifth: [], sixth: [], spells: [] })).toEqual({ runePage: null, itemSet: null, spells: null });
  });
});

describe('writing into the client', () => {
  const runePage = { name: `${TAG} Ahri`, primaryStyleId: 8100, subStyleId: 8300, selectedPerkIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] };

  it('replaces only its own rune page, then creates the new one as current', async () => {
    const c = fakeClient({ 'GET /lol-perks/v1/pages': [{ id: 1, name: 'صفحتي', isDeletable: true }, { id: 2, name: `${TAG} Zed`, isDeletable: true }] });
    await applyRunePage(c.call, runePage);
    expect(c.calls.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /lol-perks/v1/pages', 'DELETE /lol-perks/v1/pages/2', 'POST /lol-perks/v1/pages']);
    expect(c.calls[2].body).toEqual({ ...runePage, current: true });
  });

  it('explains a refused page in Arabic', async () => {
    const c = fakeClient({}, ['POST /lol-perks/v1/pages']);
    await expect(applyRunePage(c.call, runePage)).rejects.toThrow(/لا توجد خانة فارغة/);
  });

  it('keeps the player\'s item sets and replaces its own set for the same champion', async () => {
    const theirs = { title: 'My Ahri', associatedChampions: [103], uid: 'a' };
    const oldMine = { title: `${TAG} Ahri top`, associatedChampions: [103], uid: 'b' };
    const otherChamp = { title: `${TAG} Zed mid`, associatedChampions: [238], uid: 'c' };
    const c = fakeClient({
      'GET /lol-summoner/v1/current-summoner': { summonerId: 42 },
      'GET /lol-item-sets/v1/item-sets/42/sets': { accountId: 7, timestamp: 1, itemSets: [theirs, oldMine, otherChamp] },
    });
    await applyItemSet(c.call, { title: `${TAG} Ahri mid`, championId: 103, mapId: 11, blocks: [{ type: 'الحذاء', items: [3020] }] }, 'uid-1');
    const put = c.calls.at(-1)!;
    expect(put.method).toBe('PUT');
    const body = put.body as { accountId: number; itemSets: { uid: string; blocks?: unknown }[] };
    expect(body.accountId).toBe(7);
    expect(body.itemSets.map((s) => s.uid)).toEqual(['a', 'c', 'uid-1']);
    expect(body.itemSets[2].blocks).toEqual([{ type: 'الحذاء', items: [{ id: '3020', count: 1 }] }]);
  });

  it('never writes item sets when the current list cannot be read (the PUT would wipe them)', async () => {
    const c = fakeClient({ 'GET /lol-summoner/v1/current-summoner': { summonerId: 42 } }); // sets answer: 404 → null
    await expect(applyItemSet(c.call, { title: `${TAG} Ahri mid`, championId: 103, mapId: 11, blocks: [] }, 'u')).rejects.toThrow(/لم يُكتب شيء/);
    expect(c.calls.some((x) => x.method === 'PUT')).toBe(false);
  });

  it('keeps each spell the player already has on its key', () => {
    expect(arrangeSpells([4, 14], [14, 4])).toEqual([14, 4]); // Flash stays on F
    expect(arrangeSpells([4, 14], [7, 4])).toEqual([14, 4]); // Heal swapped for Ignite, Flash untouched
    expect(arrangeSpells([4, 14], [7, 3])).toEqual([4, 14]); // nothing shared: build order
    expect(arrangeSpells([4, 14], null)).toEqual([4, 14]);
  });

  it('sets summoner spells only during champ select, and reports each part', async () => {
    const c = fakeClient({
      'GET /lol-summoner/v1/current-summoner': { summonerId: 42 },
      'GET /lol-champ-select/v1/session': { localPlayerCellId: 2, myTeam: [{ cellId: 2, spell1Id: 14, spell2Id: 4 }] },
    });
    const p = { runePage, itemSet: null, spells: [4, 14] as [number, number] };
    expect(await applyAll(c.call, p, { inChampSelect: false, uid: 'u' })).toEqual({ runes: 'ok', items: 'none', spells: 'none' });
    expect(await applyAll(c.call, p, { inChampSelect: true, uid: 'u' })).toEqual({ runes: 'ok', items: 'none', spells: 'ok' });
    expect(c.calls.at(-1)).toEqual({ method: 'PATCH', path: '/lol-champ-select/v1/session/my-selection', body: { spell1Id: 14, spell2Id: 4 } });
  });
});
