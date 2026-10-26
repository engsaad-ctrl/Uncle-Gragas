import { composeChampionPage, type ChampionPage, type PageMode } from '../app/championPage.js';
import { composeItemList, type ItemEntry } from '../app/itemList.js';
import { composeTierList, type TierRow } from '../app/tierList.js';
import { mcpCaller, OpggStats, type CallTool, type ItemMap, type LanePosition, type Position } from '../stats/opgg.js';
import { buildAbilityDetails } from '../texts/abilityDetails.js';
import { loadAugments, type AugmentsResult } from '../texts/augmentsLoader.js';
import { loadCdragonJson, type Locale } from '../texts/cdragon.js';
import {
  buildChampionDetail, buildChampionList, buildSpellTexts, buildStyleTrees,
  type ChampionListEntry, type RawChampion, type RawChampionSummary,
} from '../texts/champions.js';
import { loadChampionBin, loadGameItems, loadGameVersion, loadStringTable, loadTooltipStrings } from '../texts/gameData.js';
import { buildItemDetails, buildItemTexts, type ItemText, type RawItem } from '../texts/items.js';
import { buildRuneTexts, type RawPerk } from '../texts/runes.js';

const MODES: PageMode[] = ['ranked', 'flex', 'aram', 'mayhem', 'arena', 'urf', 'nexus'];
const NO_BUILD: PageMode[] = ['arena', 'urf', 'nexus']; // see BuildMode in stats/opgg.ts
const POSITIONS: Position[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/** The app-wide mode chosen in the side menu. */
export type AppMode = 'normal' | 'aram' | 'mayhem' | 'arena';
const APP_MODES: AppMode[] = ['normal', 'aram', 'mayhem', 'arena'];
const ITEM_MAP: Record<AppMode, ItemMap> = { normal: 'SUMMONERS_RIFT', aram: 'HOWLING_ABYSS', mayhem: 'HOWLING_ABYSS', arena: 'ARENA_MAP_1' };

export interface Listed<T> {
  list: T[];
  fetchedAt: number;
  stale: boolean;
}

export function parseAppMode(mode: unknown): AppMode {
  if (!APP_MODES.includes(mode as AppMode)) throw new Error('bad mode');
  return mode as AppMode;
}

export function parseLane(position: unknown): LanePosition {
  if (!POSITIONS.includes(position as Position)) throw new Error('bad position');
  return position as LanePosition;
}

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

  const game = { cacheDir, fetchImpl };
  // null when it cannot be fetched: the game-file caches then use whatever copy they have (once() retries next call).
  const version = once(() => loadGameVersion(game));
  const gameVersion = () => version().catch(() => null);
  const augments = once<AugmentsResult>(async () =>
    loadAugments({ cacheDir, fetchImpl, strings: async () => loadStringTable(game, await gameVersion()) }),
  );
  const champions = once<ChampionListEntry[]>(async () => buildChampionList(...(await both<RawChampionSummary[]>('champion-summary.json'))));
  const tooltipStrings = once(async () => loadTooltipStrings(game, await gameVersion()));

  const baseTexts = once(async () => {
    const [items, perks, styles, spells] = await Promise.all([
      both<RawItem[]>('items.json'),
      both<RawPerk[]>('perks.json'),
      both<{ styles: { id: number; name: string; iconPath: string; slots: { type: string; slotLabel: string; perks: number[] }[] }[] }>('perkstyles.json'),
      both<{ id: number; name: string; description: string; iconPath: string; cooldown?: number }[]>('summoner-spells.json'),
    ]);
    return {
      rawItems: items,
      items: buildItemTexts(...items),
      runes: buildRuneTexts(...perks),
      styles: buildStyleTrees(styles[0].styles, styles[1].styles),
      spells: buildSpellTexts(...spells),
    };
  });
  /** Items with the game-file tooltips. Fails (and is retried next time) when those files cannot be had. */
  let detailedReady: Map<number, ItemText> | undefined;
  const detailedItems = once(async () => {
    const [t, v] = await Promise.all([baseTexts(), gameVersion()]);
    const [items, strings] = await Promise.all([loadGameItems(game, v), tooltipStrings()]);
    return (detailedReady = buildItemTexts(...t.rawItems, buildItemDetails(items, (k) => strings[k.toLowerCase()])));
  });
  /** Texts for a page right now: detailed items when already built, else CommunityDragon's (the detailed ones load meanwhile). */
  const texts = async () => {
    const t = await baseTexts();
    if (!detailedReady) void detailedItems().catch(() => undefined);
    return { items: detailedReady ?? t.items, runes: t.runes, styles: t.styles, spells: t.spells };
  };

  /** In-game tooltips need two extra game files; without them the page keeps the short descriptions. */
  async function abilityDetails(alias: string, spells: RawChampion['spells']) {
    try {
      const v = await gameVersion();
      const [bin, strings] = await Promise.all([loadChampionBin(game, v, alias), tooltipStrings()]);
      return buildAbilityDetails(spells, bin, (k) => strings[k.toLowerCase()]);
    } catch {
      return undefined;
    }
  }

  async function championPage(id: number, mode: PageMode, position: Position): Promise<ChampionPage> {
    const entry = (await champions()).find((c) => c.id === id);
    if (!entry) throw new Error(`unknown champion ${id}`);
    const laned = mode === 'ranked' || mode === 'flex';
    const loadBuild = () =>
      stats
        // OP.GG requires a position even for ARAM, where it is ignored
        .build(entry.alias, laned ? mode : 'aram', laned ? position : 'mid')
        .catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    // Everything at once: the build, the champion's texts and its game file do not depend on each other.
    const champion = both<RawChampion>(`champions/${id}.json`);
    const [[ar, en], details, t, build, mayhem, augs] = await Promise.all([
      champion,
      champion.then(([ar]) => abilityDetails(entry.alias, ar.spells)),
      texts(),
      NO_BUILD.includes(mode) ? Promise.resolve(null) : loadBuild(),
      mode === 'mayhem' ? stats.mayhemAugments(id).catch(() => null) : Promise.resolve(null),
      mode === 'mayhem' ? augments().then((r) => r.augments, () => []) : Promise.resolve([]),
    ]);
    return composeChampionPage({
      champion: buildChampionDetail(ar, en, details), mode, position: laned ? position : null,
      build, mayhem, augments: augs, ...t,
    });
  }

  async function items(mode: AppMode): Promise<Listed<ItemEntry>> {
    // The items page is where the detailed tooltips matter most: wait for them, or fall back to CommunityDragon's.
    const [m, list] = await Promise.all([stats.mapItems(ITEM_MAP[mode]), detailedItems().catch(async () => (await baseTexts()).items)]);
    return { list: composeItemList(m.data, list), fetchedAt: m.fetchedAt, stale: m.stale };
  }

  async function tierList(position: LanePosition): Promise<Listed<TierRow>> {
    const [meta, list] = await Promise.all([stats.laneMeta(), champions()]);
    return { list: composeTierList(meta.data[position], list), fetchedAt: meta.fetchedAt, stale: meta.stale };
  }

  return { augments, champions, championPage, items, tierList };
}
