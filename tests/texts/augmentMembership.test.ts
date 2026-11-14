import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAugmentTexts, markableInMayhem, type AugmentListEntry, type AugmentText } from '../../src/texts/augments.js';
import { AUGMENT_URLS, augmentDataOnly, loadAugments } from '../../src/texts/augmentsLoader.js';

// T050: an augment's modes come from the mode files' own pools (an object with an AugmentList of links to AugmentData; in the real kiwi.bin of
// 16.22 its key is {51c6c2b4}, its type {eb5adb26}, 242 links), kept by the loader before it trims the files. Never from the id's size.
const entry = (id: number, nameTRA = `ت${id}`): AugmentListEntry => ({ id, augmentNameId: `A${id}`, nameTRA, augmentSmallIconPath: '', rarity: 'kGold' });
const record = (id: number) => ({ __type: 'AugmentData', AugmentPlatformId: id, DescriptionTra: `d${id}` });
const key = (id: number) => `Maps/ModeSpecificData/Augments/A${id}`;
/** A raw mode file: its records, and a pool linking some of them (the links in another case, as the game's files sometimes are). */
const file = (records: number[], pool?: (number | string)[]) => ({
  ...Object.fromEntries(records.map((id) => [key(id), record(id)])),
  ...(pool ? { '{51c6c2b4}': { __type: '{eb5adb26}', AugmentList: pool.map((x) => (typeof x === 'number' ? key(x).toLowerCase() : x)) } } : {}),
});
const strings = Object.fromEntries([500, 1500, 1600, 1700, 1800, 1900, 3176].map((id) => [`d${id}`, `نص ${id}`]));
const build = (ids: number[], bins: object[], list = ids.map((id) => entry(id))) => buildAugmentTexts({ listAr: list, listEn: list, bins, strings });

describe('modes from the pools', () => {
  it('an id < 1000 in the Mayhem pool is Mayhem; an id >= 1000 only recorded in a file, in no pool, has no mode (unknown)', async () => {
    const r = await build([500, 1500], [augmentDataOnly(file([1500]), 'cherry'), augmentDataOnly(file([500], [500]), 'kiwi')]);
    const by = new Map(r.map((a) => [a.id, a]));
    expect(by.get(500)).toMatchObject({ modes: ['mayhem'], pools: { 500: ['kiwi'] } });
    expect(by.get(1500)).toMatchObject({ modes: [], pools: {} });
  });
  it('one id in two pools has both modes', async () => {
    const [a] = await build([1600], [augmentDataOnly(file([1600], [1600]), 'cherry'), augmentDataOnly(file([1600], [1600]), 'kiwi')]);
    expect(a).toMatchObject({ modes: ['arena', 'mayhem'], pools: { 1600: ['cherry', 'kiwi'] } });
  });
  it('the kiwi_jade pool is kept but gives no mode (its mode is not proven)', async () => {
    const [a] = await build([1700], [augmentDataOnly(file([1700], [1700]), 'kiwi_jade')]);
    expect(a).toMatchObject({ modes: [], pools: { 1700: ['kiwi_jade'] } });
  });
  it('twins with different ids: each id keeps its own pool, so the Arena id does not borrow the Mayhem one', async () => {
    const list = [entry(54, 'توأم'), entry(1054, 'توأم')];
    const twin = { 'Maps/ModeSpecificData/Augments/A54': { ...record(54), DescriptionTra: 'same' }, 'Maps/ModeSpecificData/Augments/A1054': { ...record(1054), DescriptionTra: 'same' } };
    const [a] = await buildAugmentTexts({ listAr: list, listEn: list, strings: { same: 'نص' },
      bins: [augmentDataOnly({ ...twin, p: { AugmentList: [key(54)] } }, 'cherry'), augmentDataOnly({ ...twin, p: { AugmentList: [key(1054)] } }, 'kiwi')] });
    expect(a).toMatchObject({ id: 1054, ids: [1054, 54], modes: ['arena', 'mayhem'], pools: { 54: ['cherry'], 1054: ['kiwi'] } }); // the Mayhem id leads (T050 v4)
  });
  it("the Mayhem id leads a merged twin with its own file data; the Arena twin's data is not carried over (T050 v4)", async () => {
    // BEES is read from the files (FILE_READ_AUGMENTS): its record keeps its root spell. Here only the Arena twin (54) has that name.
    const spell = { mSpell: { DataValues: [{ name: 'X', values: [1] }] } };
    const bee = (id: number, nameId: string) => ({ __type: 'AugmentData', AugmentPlatformId: id, AugmentNameId: nameId, DescriptionTra: 'same', RootSpell: `S${id}`, AdditionalSpells: [] });
    const raw = { 'Aug/54': bee(54, 'BEES'), S54: spell, 'Aug/1054': bee(1054, 'ARAM_NotFileRead'), S1054: spell };
    const list = [entry(54, 'نحل'), entry(1054, 'نحل')];
    const [a] = await buildAugmentTexts({ listAr: list, listEn: list, strings: { same: 'نص' },
      bins: [augmentDataOnly({ ...raw, p: { AugmentList: ['Aug/54'] } }, 'cherry'), augmentDataOnly({ ...raw, p: { AugmentList: ['Aug/1054'] } }, 'kiwi')] });
    expect([a!.id, a!.ids, a!.game]).toEqual([1054, [1054, 54], undefined]);
  });
  it('a pool link that resolves to no AugmentData is counted as unresolved, not guessed', () => {
    const [pool] = augmentDataOnly(file([1800], [1800, 'Maps/ModeSpecificData/Augments/Gone']), 'kiwi');
    expect(pool).toEqual({ __type: 'AugmentPool', source: 'kiwi', ids: [1800], unresolved: 1 });
  });
  it('3176 (the blank-named placeholder) in the pool makes no shown augment', async () => {
    const list = [entry(1900), entry(3176, 'GoH_PentakillAug_Generic_BlankName')];
    const r = await buildAugmentTexts({ listAr: list, listEn: [entry(1900, 'x'), entry(3176, '  ')], strings, bins: [augmentDataOnly(file([1900, 3176], [1900, 3176]), 'kiwi')] });
    expect(r.map((a) => a.id)).toEqual([1900]);
  });
});

describe('marking a pick in a Mayhem match (the pick log)', () => {
  const list: Pick<AugmentText, 'ids' | 'modes' | 'pools'>[] = [
    { ids: [1200], modes: ['mayhem'], pools: { 1200: ['kiwi'] } },
    { ids: [1300], modes: [], pools: {} },
    { ids: [54, 1054], modes: ['arena', 'mayhem'], pools: { 54: ['cherry'], 1054: ['kiwi'] } },
    { ids: [1700], modes: [], pools: { 1700: ['kiwi_jade'] } },
    { ids: [1800], modes: ['mayhem'] }, // an old copy: no pools, its old label
    { ids: [60], modes: ['arena'] },
  ];
  it('a Mayhem member, an id in no pool (unknown), and a kiwi_jade member may be marked; an id only in an Arena pool may not', () => {
    expect([1200, 1300, 1054, 1700, 54, 9999].map((id) => markableInMayhem(list, id))).toEqual([true, true, true, true, false, false]);
  });
  it('an old copy without pools keeps its old label', () => {
    expect([1800, 60].map((id) => markableInMayhem(list, id))).toEqual([true, false]);
  });
});

// The loader, through the real diskCache and a temporary cache file; the fake fetch stands only at the network edge.
const version = '16.22.1';
const online = (kiwi: object, ver = version) => (async (url: string | URL | Request) => {
  const u = String(url);
  const bodies = new Map<string, unknown>([[AUGMENT_URLS.version, { version: ver }], [AUGMENT_URLS.listAr, [entry(1900)]], [AUGMENT_URLS.listEn, [entry(1900, 'x')]],
    [AUGMENT_URLS.strings, { entries: strings }], [AUGMENT_URLS.bins[0], {}], [AUGMENT_URLS.bins[1], kiwi], [AUGMENT_URLS.bins[2], {}], [AUGMENT_URLS.bins[3], {}]]);
  if (!bodies.has(u)) throw new Error(`unexpected ${u}`);
  return new Response(JSON.stringify(bodies.get(u)));
}) as typeof fetch;
const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
const dir = () => mkdtemp(join(tmpdir(), 't050-membership-'));

describe('the loader and the pools', () => {
  it('online: modes from the pool, and the result says the pools it read (no Arena pool here)', async () => {
    const r = await loadAugments({ cacheDir: await dir(), fetchImpl: online(file([1900], [1900])) });
    expect(r.augments[0]).toMatchObject({ id: 1900, modes: ['mayhem'] });
    expect(r.membership).toEqual({ from: 'pools', pools: { kiwi: { ids: 1, unresolved: 0 } } });
  });
  it('no Mayhem pool in kiwi, no copy: an error, not a list that labels nothing Mayhem', async () => {
    await expect(loadAugments({ cacheDir: await dir(), fetchImpl: online(file([1900])) })).rejects.toThrow('Mayhem pool missing or invalid');
  });
  it('a pool with a broken link, with an earlier copy: the earlier copy, stale, its file untouched', async () => {
    const cacheDir = await dir();
    await loadAugments({ cacheDir, fetchImpl: online(file([1900], [1900]), '16.21.1') });
    const bytes = await readFile(join(cacheDir, 'augments.json'), 'utf8');
    const r = await loadAugments({ cacheDir, fetchImpl: online(file([1900], [1900, 'Maps/Gone'])) });
    expect(r).toMatchObject({ version: '16.21.1', stale: true, membership: { from: 'pools' } });
    expect(await readFile(join(cacheDir, 'augments.json'), 'utf8')).toBe(bytes);
  });
  it('a copy written before the pools were kept (schema 16), offline: used, stale, and marked as an old copy, its labels unproven', async () => {
    const cacheDir = await dir();
    const old = { fetchedAt: 1, key: `16:${version}`, data: { version, augments: [{ id: 1900, ids: [1900], name: 'ت1900', enName: 'x', html: '', described: false, rarity: 'gold', modes: ['mayhem'], iconUrl: '' }] } };
    await writeFile(join(cacheDir, 'augments.json'), JSON.stringify(old));
    const r = await loadAugments({ cacheDir, fetchImpl: offline });
    expect(r).toMatchObject({ stale: true, membership: { from: 'old-cache' } });
    expect(r.augments[0]!.modes).toEqual(['mayhem']);
  });
  it('the same old copy, online: rebuilt with the pools', async () => {
    const cacheDir = await dir();
    await writeFile(join(cacheDir, 'augments.json'), JSON.stringify({ fetchedAt: 1, key: `16:${version}`, data: { version, augments: [] } }));
    const r = await loadAugments({ cacheDir, fetchImpl: online(file([1900], [1900])) });
    expect(r).toMatchObject({ stale: false, membership: { from: 'pools' } });
    expect(r.augments.map((a) => a.id)).toEqual([1900]);
  });
});
