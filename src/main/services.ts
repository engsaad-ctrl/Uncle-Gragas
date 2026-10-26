import { composeChampionPage, type ChampionPage, type PageMode } from '../app/championPage.js';
import { mcpCaller, OpggStats, type CallTool, type Position } from '../stats/opgg.js';
import { loadAugments, type AugmentsResult } from '../texts/augmentsLoader.js';
import { loadCdragonJson, type Locale } from '../texts/cdragon.js';
import {
  buildChampionDetail, buildChampionList, buildSpellTexts, buildStyleTexts,
  type ChampionListEntry, type RawChampion, type RawChampionSummary,
} from '../texts/champions.js';
import { buildItemTexts, type RawItem } from '../texts/items.js';
import { buildRuneTexts, type RawPerk } from '../texts/runes.js';

const MODES: PageMode[] = ['ranked', 'aram', 'mayhem'];
const POSITIONS: Position[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/** IPC input is untrusted: accept only known values. */
export function parsePageRequest(id: unknown, mode: unknown, position: unknown): { id: number; mode: PageMode; position: Position } {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new Error('bad champion id');
  if (!MODES.includes(mode as PageMode)) throw new Error('bad mode');
  if (!POSITIONS.includes(position as Position)) throw new Error('bad position');
  return { id, mode: mode as PageMode, position: position as Position };
}

/** Cache a promise; forget it on failure so the next call retries. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () =>
    (p ??= load().catch((err) => {
      p = undefined;
      throw err;
    }));
}

export function createServices(opts: { cacheDir: string; fetchImpl: typeof fetch; call?: CallTool }) {
  const { cacheDir, fetchImpl } = opts;
  const cd = <T>(locale: Locale, file: string) => loadCdragonJson<T>(locale, file, { cacheDir, fetchImpl }).then((r) => r.data);
  const both = <T>(file: string) => Promise.all([cd<T>('ar_ae', file), cd<T>('default', file)]);
  const stats = new OpggStats(opts.call ?? mcpCaller(fetchImpl), cacheDir);

  const augments = once<AugmentsResult>(() => loadAugments({ cacheDir, fetchImpl }));
  const champions = once<ChampionListEntry[]>(async () => buildChampionList(...(await both<RawChampionSummary[]>('champion-summary.json'))));
  const texts = once(async () => {
    const [items, perks, styles, spells] = await Promise.all([
      both<RawItem[]>('items.json'),
      both<RawPerk[]>('perks.json'),
      both<{ styles: { id: number; name: string; iconPath: string }[] }>('perkstyles.json'),
      both<{ id: number; name: string; description: string; iconPath: string }[]>('summoner-spells.json'),
    ]);
    return {
      items: buildItemTexts(...items),
      runes: buildRuneTexts(...perks),
      styles: buildStyleTexts(styles[0].styles, styles[1].styles),
      spells: buildSpellTexts(...spells),
    };
  });

  async function championPage(id: number, mode: PageMode, position: Position): Promise<ChampionPage> {
    const entry = (await champions()).find((c) => c.id === id);
    if (!entry) throw new Error(`unknown champion ${id}`);
    const [[ar, en], t] = await Promise.all([both<RawChampion>(`champions/${id}.json`), texts()]);
    const buildPosition = mode === 'ranked' ? position : 'mid'; // OP.GG requires a position even for ARAM
    const [build, mayhem, augs] = await Promise.all([
      stats.build(entry.alias, mode === 'ranked' ? 'ranked' : 'aram', buildPosition).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
      mode === 'mayhem' ? stats.mayhemAugments(id).catch(() => null) : Promise.resolve(null),
      mode === 'mayhem' ? augments().then((r) => r.augments, () => []) : Promise.resolve([]),
    ]);
    return composeChampionPage({
      champion: buildChampionDetail(ar, en), mode, position: mode === 'ranked' ? position : null,
      build, mayhem, augments: augs, ...t,
    });
  }

  return { augments, champions, championPage };
}
