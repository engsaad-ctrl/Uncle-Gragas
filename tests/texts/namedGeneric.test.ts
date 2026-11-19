import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { buildAugmentTexts, type AugmentListEntry } from '../../src/texts/augments.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';
import { loadAugments } from '../../src/texts/augmentsLoader.js';
import { createServices } from '../../src/main/services.js';
import { OpggStats } from '../../src/stats/opgg.js';

vi.mock('../../src/texts/augmentsLoader.js', async (original) => ({
  ...await original<typeof import('../../src/texts/augmentsLoader.js')>(),
  loadAugments: vi.fn(),
}));
vi.mock('../../src/texts/cdragon.js', async (original) => ({
  ...await original<typeof import('../../src/texts/cdragon.js')>(),
  loadCdragonJson: vi.fn(async (_locale: string, file: string) => {
    if (file === 'champion-summary.json') return { data: [], fetchedAt: 0, stale: false };
    throw new Error('unrelated catalogue data intentionally absent');
  }),
}));
vi.mock('../../src/texts/gameData.js', async (original) => ({
  ...await original<typeof import('../../src/texts/gameData.js')>(),
  loadGameVersion: vi.fn(async () => null),
}));

// Loader regressions for the narrow named-but-unrated candidate (ruling c962fc15, candidate review 70fd1af4).
// 3176 GoH_PentakillAug_Generic carries no readable name of its own, so the loader dropped it, and match history
// records a family entry under that id. The candidate names THAT entry from its own title string and nothing else.
// The real fetched entry is used, not an idealised one: its nameTRA is three spaces, which is truthy.
const fixture = JSON.parse(readFileSync('tests/fixtures/augments/pentakill-3176.json', 'utf8')) as {
  entry: AugmentListEntry & { nameTRA: string };
  strings: Record<string, string>;
};
const REAL = fixture.entry;
const TITLE = fixture.strings['kiwi_goh_pentakill_title']!;

const entry = (id: number, augmentNameId: string, nameTRA: string, rarity = 'kGold'): AugmentListEntry =>
  ({ id, augmentNameId, nameTRA, augmentSmallIconPath: 'x.png', rarity });

const build = (listAr: AugmentListEntry[], listEn: AugmentListEntry[], strings: Record<string, string> = fixture.strings) =>
  buildAugmentTexts({ listAr, listEn, bins: [], strings });

it('names the real fetched entry, whose nameTRA is three spaces', async () => {
  const out = await build([REAL], [REAL]);
  expect(out.map((a) => a.id)).toEqual([3176]);
  expect(out[0]!.name).toBe(TITLE);
  expect(out[0]!.enName).toBe(TITLE);
});

it('shows a readable name in BOTH name languages', async () => {
  // dom.ts registers document listeners at import time, so give it the minimum it needs and import it here.
  const g = globalThis as unknown as { document?: unknown; localStorage?: unknown };
  g.document ??= { addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }) };
  g.localStorage ??= { getItem: () => null, setItem() {} };
  (g as { addEventListener?: unknown }).addEventListener ??= () => {};
  const { setNameLang, shownName } = await import('../../src/renderer/dom.js');
  const [card] = await build([REAL], [REAL]);
  for (const lang of ['en', 'ar'] as const) {
    setNameLang(lang);
    expect(shownName(card!), lang).toBe(TITLE);
    expect(shownName(card!).trim(), lang).not.toBe('');
  }
  setNameLang('en');
});

it('does not display the localized placeholder token', async () => {
  const token = entry(3176, 'GoH_PentakillAug_Generic', 'GoH_PentakillAug_Generic_BlankName');
  const [card] = await build([token], [entry(3176, 'GoH_PentakillAug_Generic', '')]);
  expect(card!.name).toBe(TITLE);
  expect(card!.enName).toBe(TITLE);
});

it('rejects a "???" title instead of admitting the entry', async () => {
  const out = await build([REAL], [REAL], { kiwi_goh_pentakill_title: '???' });
  expect(out).toEqual([]);
});

it('rejects an unresolved GeneratedTip title', async () => {
  const out = await build([REAL], [REAL], { kiwi_goh_pentakill_title: 'GeneratedTip_Augment_3176_Name' });
  expect(out).toEqual([]);
});

it('drops the generic when its title string is missing: no invented name', async () => {
  const out = await build([REAL], [REAL], {});
  expect(out).toEqual([]);
});

it('still drops a "???" entry, so 1424 is unaffected', async () => {
  const miss = entry(1424, 'ARAM_MissingPingAugment', '???', 'kPrismatic');
  expect(await build([miss], [miss])).toEqual([]);
});

it('still drops any OTHER blank-name entry: this is not a general admission', async () => {
  const other = entry(9001, 'GoH_SomeOther_Generic', '');
  expect(await build([other], [other])).toEqual([]);
});

it('leaves a normally named entry exactly as before', async () => {
  const out = await build([entry(1327, 'ARAM_Adamant', 'شديد الإصرار')], [entry(1327, 'ARAM_Adamant', 'Adamant')]);
  expect(out.map((a) => [a.id, a.name, a.enName])).toEqual([[1327, 'شديد الإصرار', 'Adamant']]);
});

// The parent and its slot sibling must stay two distinct entries: naming the parent must not merge or alias them.
it('keeps the parent and its slot sibling distinct', async () => {
  const heavy = entry(3170, 'GoH_PentakillAug_1', 'HEAVY');
  const out = await build([REAL, heavy], [REAL, { ...heavy, nameTRA: 'HEAVY' }]);
  expect(out.map((a) => a.id).sort()).toEqual([3170, 3176]);
  const byId = new Map(out.map((a) => [a.id, a]));
  expect(byId.get(3176)!.name).toBe(TITLE);
  expect(byId.get(3170)!.name).toBe('HEAVY');
  expect(byId.get(3176)!.ids).toEqual([3176]);
  expect(byId.get(3170)!.ids).toEqual([3170]);
});

it('the actual overlay consumer exposes the loaded name and unmeasured reason without a numeric zero', async () => {
  // Synthetic explicit pool membership exercises the Mayhem consumer. This is
  // NOT evidence that the fetched entry appears in a particular live mode pool.
  const loaded = await buildAugmentTexts({
    listAr: [fixture.entry], listEn: [fixture.entry], strings: fixture.strings,
    bins: [{ pool: { __type: 'AugmentPool', source: 'kiwi', ids: [3176], unresolved: 0 } }],
  });
  vi.mocked(loadAugments).mockResolvedValue({
    augments: loaded, version: 'review-fixture', stale: false,
    membership: { from: 'pools', pools: { kiwi: { ids: 1, unresolved: 0 } } },
  });
  const items = vi.spyOn(OpggStats.prototype, 'mapItems').mockRejectedValue(new Error('no item catalogue in naming test'));
  const network = vi.fn<typeof fetch>(async () => { throw new Error('network forbidden'); });
  try {
    expect(CARD_NUMBERS.some((r) => r.ops.length > 0)).toBe(true);
    // No known champion: the build path fails early and is caught by overlayData,
    // leaving the real catalogue-note path. No fights or searches are performed.
    const result = await createServices({ cacheDir: '__unused_review_cache__', fetchImpl: network }).overlayData({ championId: 0, mode: 'mayhem' });
    const card = result.augments.find((a) => a.id === 3176);
    expect(card?.name).toBe(fixture.strings.kiwi_goh_pentakill_title);
    expect(card?.unmeasuredReason).toBeTruthy();
    expect(card).not.toHaveProperty('value');
    expect(network).not.toHaveBeenCalled();
  } finally {
    items.mockRestore();
    vi.mocked(loadAugments).mockReset();
  }
});
