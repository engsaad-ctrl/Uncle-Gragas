import { composeChampionPage, type ChampionPage, type PageMode } from '../app/championPage.js';
import { composeItemList, type ItemEntry } from '../app/itemList.js';
import { composeProfile, type ProfilePage } from '../app/profilePage.js';
import { counterPicks, metaPicks, type Suggestion } from '../app/suggestions.js';
import type { RawProfile } from '../lcu/profile.js';
import { composeAllLanes, composeTierList, type TierRow } from '../app/tierList.js';
import { mcpCaller, OpggStats, type CallTool, type Counter, type ItemMap, type LanePosition, type Position } from '../stats/opgg.js';
import { buildAbilityDetails } from '../texts/abilityDetails.js';
import type { AugmentText } from '../texts/augments.js';
import { loadAugments, type AugmentsResult } from '../texts/augmentsLoader.js';
import { loadCdragonJson, type Locale } from '../texts/cdragon.js';
import {
  buildChampionDetail, buildChampionList, buildSpellTexts, buildStyleTrees,
  type ChampionListEntry, type RawChampion, type RawChampionSummary,
} from '../texts/champions.js';
import { loadChampionBin, loadGameItems, loadGameVersion, loadStringTable, loadTooltipStrings } from '../texts/gameData.js';
import { buildItemDetails, buildItemTexts, itemClasses, type ItemText, type RawItem } from '../texts/items.js';
import { buildRuneTexts, type RawPerk } from '../texts/runes.js';

const MODES: PageMode[] = ['ranked', 'flex', 'aram', 'mayhem', 'arena', 'urf', 'nexus'];
const NO_BUILD: PageMode[] = ['arena', 'urf', 'nexus']; // see BuildMode in stats/opgg.ts
const POSITIONS: Position[] = ['top', 'jungle', 'mid', 'adc', 'support'];

export interface OverlayData {
  champion: ChampionListEntry | null;
  mode: AppMode | null;
  /** True when the first augments carry a performance rating for this champion. */
  rated: boolean;
  /** The picked champion's build page (runes, spells, skills, items) for the game's mode; null in Arena or with no pick. */
  build: ChampionPage | null;
  augments: (AugmentText & { performance?: number; popularity?: number })[];
}

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

/** Champion ids from the window (enemy picks, taken picks): at most 10 positive integers. */
export function parseIds(v: unknown): number[] {
  if (!Array.isArray(v) || v.length > 10 || !v.every((x) => Number.isInteger(x) && x > 0)) throw new Error('bad ids');
  return v as number[];
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
    return (detailedReady = buildItemTexts(...t.rawItems, buildItemDetails(items, (k) => strings[k.toLowerCase()]), itemClasses(items)));
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
    const [[ar, en], details, t, build, mayhem, augs, championList] = await Promise.all([
      champion,
      champion.then(([ar]) => abilityDetails(entry.alias, ar.spells)),
      texts(),
      NO_BUILD.includes(mode) ? Promise.resolve(null) : loadBuild(),
      mode === 'mayhem' ? stats.mayhemAugments(id).catch(() => null) : Promise.resolve(null),
      mode === 'mayhem' ? augments().then((r) => r.augments, () => []) : Promise.resolve([]),
      champions(),
    ]);
    return composeChampionPage({
      championList,
      champion: buildChampionDetail(ar, en, details), mode, position: laned ? position : null,
      build, mayhem, augments: augs, ...t,
    });
  }

  async function items(mode: AppMode): Promise<Listed<ItemEntry>> {
    // The items page is where the detailed tooltips matter most: wait for them, or fall back to CommunityDragon's.
    const [m, list] = await Promise.all([stats.mapItems(ITEM_MAP[mode]), detailedItems().catch(async () => (await baseTexts()).items)]);
    return { list: composeItemList(m.data, list), fetchedAt: m.fetchedAt, stale: m.stale };
  }

  /** Summoner's Rift: one lane's tiers. ARAM and Mayhem (same games, no lanes): one list for every champion. */
  async function tierList(position: LanePosition | 'all', mode: AppMode = 'normal'): Promise<Listed<TierRow>> {
    const list = await champions();
    if (mode === 'aram' || mode === 'mayhem') {
      const aram = await stats.aramTiers(list);
      return { list: composeTierList(aram.data, list), fetchedAt: aram.fetchedAt, stale: aram.stale };
    }
    const meta = await stats.laneMeta();
    const rows = position === 'all' ? composeAllLanes(meta.data, list) : composeTierList(meta.data[position], list);
    return { list: rows, fetchedAt: meta.fetchedAt, stale: meta.stale };
  }

  /** Champ select: answers to the enemy picks shown so far in this lane, else the lane's best tiers. */
  async function suggestions(position: LanePosition, enemies: number[], taken: number[]): Promise<Suggestion[]> {
    const list = await champions();
    const takenSet = new Set([...taken, ...enemies]);
    const meta = async () => metaPicks(composeTierList((await stats.laneMeta()).data[position], list), list, takenSet);
    if (!enemies.length) return meta();
    const beatenBy = new Map<number, Counter[]>();
    await Promise.all(
      enemies.map(async (id) => {
        const enemy = list.find((c) => c.id === id);
        const b = enemy ? await stats.build(enemy.alias, 'ranked', position).catch(() => null) : null;
        if (b) beatenBy.set(id, b.data.weakAgainst ?? []); // builds cached before counters were read have none
      }),
    );
    // OP.GG names only 3 answers per enemy: fill the rest of the list with the lane's best tiers.
    const picks = counterPicks(beatenBy, list, takenSet);
    const fill = (await meta().catch(() => [])).filter((m) => !picks.some((p) => p.champion.id === m.champion.id));
    return [...picks, ...fill].slice(0, 8);
  }

  /** The client's profile answer with champion, item and spell names and icons. */
  async function profilePage(raw: RawProfile, me: boolean): Promise<ProfilePage> {
    const [list, t] = await Promise.all([champions(), texts()]);
    return composeProfile(raw, list, t.items, t.spells, me);
  }

  /**
   * The overlay's list: for Mayhem the champion's rated augments first (best first), then the rest of Mayhem's;
   * for Arena (no per-champion data) every Arena augment; with no pick yet, every augment. Plus the champion's build.
   */
  async function overlayData(pick: { championId: number; mode: AppMode; position?: Position | null } | null): Promise<OverlayData> {
    const all = (await augments()).augments;
    const champion = pick ? ((await champions()).find((c) => c.id === pick.championId) ?? null) : null;
    const pageMode = ({ normal: 'ranked', aram: 'aram', mayhem: 'mayhem', arena: null } as const)[pick?.mode ?? 'arena'];
    // A failed build still leaves the augments to show.
    const build = pick && pageMode ? await championPage(pick.championId, pageMode, pick.position ?? 'mid').catch(() => null) : null;
    if (pick?.mode === 'mayhem') {
      const rated = build?.augments ?? [];
      const ratedIds = new Set(rated.map((a) => a.id));
      return { champion, mode: 'mayhem', rated: rated.length > 0, build, augments: [...rated, ...all.filter((a) => a.modes.includes('mayhem') && !ratedIds.has(a.id))] };
    }
    if (pick?.mode === 'arena') return { champion, mode: 'arena', rated: false, build: null, augments: all.filter((a) => a.modes.includes('arena')) };
    return { champion, mode: pick?.mode ?? null, rated: false, build, augments: all };
  }

  /**
   * At launch, in the background: the big game files (38MB string table, 16MB items bin) download once per patch and
   * otherwise make the first champion or items page wait for them. Same promises the pages use, so nothing loads twice.
   */
  function warm() {
    for (const load of [champions, augments, tooltipStrings, detailedItems]) void load().catch(() => undefined);
  }

  return { augments, champions, championPage, items, tierList, suggestions, profilePage, overlayData, warm };
}
