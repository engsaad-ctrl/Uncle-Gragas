import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fx from '../fixtures/augments/sample.json' with { type: 'json' };
import apex from '../fixtures/game/apex-inventor-16.22.json' with { type: 'json' };
import { AUGMENT_URLS, loadAugments } from '../../src/texts/augmentsLoader.js';
import { cardFromFiles } from '../../src/ai/augmentFiles.js';
import { CARD_NUMBERS } from '../../src/ai/cardMathData.js';

const version = '16.22.8348910+branch.releases-16-22.content.release';
const entry = { id: 1002, augmentNameId: 'ARAM_ApexInventor', nameTRA: 'Apex Inventor', augmentSmallIconPath: '', rarity: 'kGold' };
const old = { fetchedAt: 123, key: `16:${version}`, data: { version, augments: [
  { id: 1002, ids: [1002], name: 'Apex Inventor', enName: 'Apex Inventor', html: 'old text', described: true, rarity: 'gold', modes: ['mayhem'], iconUrl: '' },
  { id: 3086, ids: [3086], name: 'Existing card', enName: 'Existing card', html: 'kept', described: true, rarity: 'gold', modes: ['mayhem'], iconUrl: '' },
] } };
const seed = async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 't047-real-cache-'));
  const path = join(cacheDir, 'augments.json');
  const bytes = JSON.stringify(old);
  await writeFile(path, bytes);
  return { cacheDir, path, bytes };
};
const online = (calls: string[], failBin = false) => (async (url: string | URL | Request) => {
  const key = String(url); calls.push(key);
  const bodies = new Map<string, unknown>([
    [AUGMENT_URLS.version, { version }], [AUGMENT_URLS.listAr, [entry]], [AUGMENT_URLS.listEn, [entry]],
    [AUGMENT_URLS.strings, { entries: fx.strings }],
    // T050: kiwi with its Mayhem pool, as the real file has it (the fixture cuts only Apex's records).
    ...AUGMENT_URLS.bins.map((u, i): [string, unknown] => [u, i === 1 ? { ...apex.bin, '{51c6c2b4}': { __type: '{eb5adb26}', AugmentList: ['Maps/ModeSpecificData/Augments/ARAM_ApexInventor'] } } : {}]),
  ]);
  if (failBin && key === AUGMENT_URLS.bins[1]) throw new Error('bin unavailable');
  if (!bodies.has(key)) throw new Error('unexpected URL');
  return new Response(JSON.stringify(bodies.get(key)));
}) as typeof fetch;
const stored = CARD_NUMBERS.find(c => c.id === 1002)!;

describe('the augment cache from before the Apex reader (schema 16), through the real loader and diskCache (T047 v2, test by Codex)', () => {
  it('refreshes the same-version old cache online and reads Apex file values', async () => {
    const seeded = await seed(), calls: string[] = [];
    const result = await loadAugments({ cacheDir: seeded.cacheDir, fetchImpl: online(calls) });
    const game = result.augments.find(a => a.id === 1002)?.game;
    expect(cardFromFiles(stored, game).ops).toEqual([{ op: 'add', stat: 'item_haste', value: 100 }]);
    expect(calls).toContain(AUGMENT_URLS.bins[1]);
    expect(result.stale).toBe(false);
    expect(JSON.parse(await readFile(seeded.path, 'utf8')).key).not.toBe(old.key);
  });
  it('uses the old cache offline, marks it stale, and leaves its bytes untouched', async () => {
    const seeded = await seed();
    const result = await loadAugments({ cacheDir: seeded.cacheDir, fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch });
    expect(result).toEqual({ ...old.data, stale: true, membership: { from: 'old-cache' } }); // T050: an old copy's modes are its old labels
    expect(await readFile(seeded.path, 'utf8')).toBe(seeded.bytes);
    expect(cardFromFiles(stored, result.augments[0]!.game).ops).toEqual([]);
  });
  it('uses the old cache when metadata succeeds but a bin fails, without a partial write', async () => {
    const seeded = await seed(), calls: string[] = [];
    const result = await loadAugments({ cacheDir: seeded.cacheDir, fetchImpl: online(calls, true) });
    expect(result).toEqual({ ...old.data, stale: true, membership: { from: 'old-cache' } }); // T050: an old copy's modes are its old labels
    expect(calls).toContain(AUGMENT_URLS.bins[1]);
    expect(await readFile(seeded.path, 'utf8')).toBe(seeded.bytes);
  });
  it('after a successful migration, reuses the new cache at the same game version', async () => {
    const seeded = await seed(), calls: string[] = [];
    await loadAugments({ cacheDir: seeded.cacheDir, fetchImpl: online(calls) });
    calls.length = 0;
    const result = await loadAugments({ cacheDir: seeded.cacheDir, fetchImpl: online(calls) });
    expect(calls).toEqual([AUGMENT_URLS.version]);
    expect(result.augments[0]!.game).toBeDefined();
  });
});
