import { adviseBuild, namedItems, type Advice, type GeminiPost } from '../ai/advisor.js';
import { compareBuilds } from '../ai/calculator.js';
import { composeChampionPage, type ChampionPage, type PageMode } from '../app/championPage.js';
import { diskCache } from '../diskCache.js';
import { composeItemList, type ItemEntry } from '../app/itemList.js';
import { composeProfile, type ProfilePage } from '../app/profilePage.js';
import { counterPicks, metaPicks, type Suggestion } from '../app/suggestions.js';
import type { RawProfile } from '../lcu/profile.js';
import { readMayhemGames, type MayhemGame } from '../lcu/mayhemGames.js';
import { augmentItemSynergy, augmentPairs, latestPatch, mayhemStats, patchOf, rankByWins } from '../app/mayhemStats.js';
import { composeAllLanes, composeTierList, mainLane, type TierRow } from '../app/tierList.js';
import { byWinRate, sitePage, type SiteItems } from '../stats/arammayhem.js';
import { mcpCaller, OpggStats, type CallTool, type ChampionBuild, type Counter, type Fetched, type Pick, type MayhemAugmentStat, type ItemMap, type LanePosition, type Position } from '../stats/opgg.js';
import { join } from 'node:path';
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
/** English names compared without case or punctuation. The site writes "Quest: Steel Your Heart"; the game's Mayhem copy is just "Steel Your Heart". */
const nameKey = (s: string) => s.toLowerCase().replace(/^quest:/, '').replace(/[^a-z0-9]/g, '');
/** The stats part of a build when OP.GG's could not be had. */
const NO_ARAM_BUILD: ChampionBuild = {
  games: 0, winRate: 0, pickRate: 0, banRate: null, runes: null, spells: null, starter: null, core: null, boots: null,
  fourth: [], fifth: [], sixth: [], skillOrder: [], skillPriority: [], strongAgainst: [], weakAgainst: [],
};
const POSITIONS: Position[] = ['top', 'jungle', 'mid', 'adc', 'support'];

export interface OverlayData {
  champion: ChampionListEntry | null;
  mode: AppMode | null;
  /** True when the first augments carry a performance rating for this champion. */
  rated: boolean;
  /** The picked champion's build page (runes, spells, skills, items) for the game's mode; null in Arena or with no pick. */
  build: ChampionPage | null;
  /** Finished items on the map, for re-ranking the build after the player's chosen Mayhem augments. */
  items: ItemEntry[];
  /** Boots on the map: the AI build can pick other boots than the usual ones. */
  boots: ItemEntry[];
  augments: (AugmentText & { rank?: number; popularity?: number; tierLabel?: string })[];
}

/** The app-wide mode chosen in the side menu. */
export type AppMode = 'normal' | 'aram' | 'mayhem' | 'arena';
const APP_MODES: AppMode[] = ['normal', 'aram', 'mayhem', 'arena'];
const ITEM_MAP: Record<AppMode, ItemMap> = { normal: 'SUMMONERS_RIFT', aram: 'HOWLING_ABYSS', mayhem: 'HOWLING_ABYSS', arena: 'ARENA_MAP_1' };

/** One champion in the Mayhem games collected from the client (see lcu/mayhemGames.ts). */
export interface MayhemPicks {
  /** The newest patch in the stored games ("16.21"); only its games are counted. */
  patch: string;
  games: number;
  championGames: number;
  championWins: number;
  /** Best first: win rate against the champion's own, see rankByWins. */
  augments: { augment: AugmentText; games: number; wins: number }[];
  items: { item: ItemEntry; games: number; wins: number }[];
}

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
/** A lane, or 'auto': the champion's main lane (pages opened from the champion list, blind pick). */
export type PageLane = Position | 'auto';

export function parsePageRequest(id: unknown, mode: unknown, position: unknown): { id: number; mode: PageMode; position: PageLane } {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new Error('bad champion id');
  if (!MODES.includes(mode as PageMode)) throw new Error('bad mode');
  if (position !== 'auto' && !POSITIONS.includes(position as Position)) throw new Error('bad position');
  return { id, mode: mode as PageMode, position: position as PageLane };
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

  /** arammayhem.com's ranking matched to the game's augments; OP.GG's when the site fails or none of its names match. */
  async function mayhemRanking(id: number, alias: string): Promise<Fetched<MayhemAugmentStat[]> | null> {
    const fromSite = await sitePage(alias, { cacheDir, fetchImpl }).then(
      async (r) => {
        const byName = new Map((await augments()).augments.filter((a) => a.modes.includes('mayhem')).map((a) => [nameKey(a.enName), a]));
        const data = r.data.augments.flatMap((s) => {
          const a = byName.get(nameKey(s.name));
          return a ? [{ id: a.id, tier: 0, tierLabel: s.tier, performance: 0, popularity: s.appearance }] : [];
        });
        return data.length ? { ...r, data } : null;
      },
      () => null,
    );
    return fromSite ?? stats.mayhemAugments(id).catch(() => null);
  }

  /**
   * The site's Mayhem items and skills over OP.GG's ARAM build (runes and spells stay ARAM's: the site has none).
   * null when the site has no build for the champion; OP.GG's build is then shown as it is.
   */
  async function mayhemBuild(alias: string, aram: Fetched<ChampionBuild> | Error | null): Promise<Fetched<ChampionBuild> | null> {
    const site = await sitePage(alias, { cacheDir, fetchImpl }).catch(() => null);
    const b = site?.data.build;
    if (!site || !b) return null;
    const byName = new Map((await items('mayhem')).list.map((i) => [nameKey(i.enName), i.id]));
    const toPick = (x: SiteItems): Pick | null => {
      const ids = x.names.map((n) => byName.get(nameKey(n)));
      return ids.every((id) => id !== undefined) ? { ids: ids as number[], games: 0, winRate: x.winRate, pickRate: x.pickRate } : null;
    };
    const picks = (list: SiteItems[]) => byWinRate(list).map(toPick).filter((p): p is Pick => p !== null);
    const base = aram && !(aram instanceof Error) ? aram.data : NO_ARAM_BUILD;
    const core = picks(b.core)[0] ?? null;
    return {
      data: {
        ...base,
        starter: picks(b.starter)[0] ?? null,
        boots: picks(b.boots)[0] ?? null,
        core,
        // The site lists other finished items one by one, not per slot.
        fourth: picks(b.others).filter((p) => !core?.ids.includes(p.ids[0])).slice(0, 5),
        fifth: [],
        sixth: [],
        skillOrder: b.skillOrder,
        skillPriority: b.skillPriority,
      },
      fetchedAt: site.fetchedAt,
      stale: site.stale,
    };
  }

  async function championPage(id: number, mode: PageMode, lane: PageLane): Promise<ChampionPage> {
    const entry = (await champions()).find((c) => c.id === id);
    if (!entry) throw new Error(`unknown champion ${id}`);
    const laned = mode === 'ranked' || mode === 'flex';
    const position: Position = lane !== 'auto' ? lane : laned ? mainLane((await stats.laneMeta().catch(() => null))?.data, entry.enName) : 'mid';
    const loadBuild = () =>
      stats
        // OP.GG requires a position even for ARAM, where it is ignored
        .build(entry.alias, laned ? mode : 'aram', laned ? position : 'mid')
        .catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    // Everything at once: the build, the champion's texts and its game file do not depend on each other.
    const champion = both<RawChampion>(`champions/${id}.json`);
    const [[ar, en], details, t, aramBuild, mayhem, augs, championList] = await Promise.all([
      champion,
      champion.then(([ar]) => abilityDetails(entry.alias, ar.spells)),
      texts(),
      NO_BUILD.includes(mode) ? Promise.resolve(null) : loadBuild(),
      mode === 'mayhem' ? mayhemRanking(id, entry.alias) : Promise.resolve(null),
      mode === 'mayhem' ? augments().then((r) => r.augments, () => []) : Promise.resolve([]),
      champions(),
    ]);
    const site = mode === 'mayhem' ? await mayhemBuild(entry.alias, aramBuild) : null;
    return composeChampionPage({
      championList,
      champion: buildChampionDetail(ar, en, details), mode, position: laned ? position : null,
      build: site ?? aramBuild, mayhem, augments: augs, siteBuild: site !== null, ...t,
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
    const build = pick && pageMode ? await championPage(pick.championId, pageMode, pick.position ?? 'auto').catch(() => null) : null;
    // ARAM too: plain ARAM has no augments, so an ARAM reading means Mayhem misnamed by the client; better the
    // champion's own order than the generic list, which looks the same for every champion.
    if (pick?.mode === 'mayhem' || pick?.mode === 'aram') {
      const rated = (pick.mode === 'mayhem' ? build : await championPage(pick.championId, 'mayhem', 'auto').catch(() => null))?.augments ?? [];
      const ratedIds = new Set(rated.map((a) => a.id));
      const list = (await items('mayhem').catch(() => null))?.list ?? [];
      const pool = list.filter((i) => i.group === 'legendary');
      const boots = list.filter((i) => i.group === 'boots');
      return { champion, mode: 'mayhem', rated: rated.length > 0, build, items: pool, boots, augments: [...rated, ...all.filter((a) => a.modes.includes('mayhem') && !ratedIds.has(a.id))] };
    }
    if (pick?.mode === 'arena') return { champion, mode: 'arena', rated: false, build: null, items: [], boots: [], augments: all.filter((a) => a.modes.includes('arena')) };
    return { champion, mode: pick?.mode ?? null, rated: false, build, items: [], boots: [], augments: all };
  }

  /**
   * Mayhem: Gemini's build for the champion and the augments the player marked. Kept per patch, so asking again for
   * the same champion and augments costs no request.
   */
  async function aiBuild(championId: number, augmentIds: number[], post: GeminiPost): Promise<Advice> {
    const entry = (await champions()).find((c) => c.id === championId);
    if (!entry) throw new Error(`unknown champion ${championId}`);
    const all = (await augments()).augments;
    const chosen = augmentIds.map((id) => all.find((a) => a.ids.includes(id))).filter((a) => a !== undefined);
    if (!chosen.length) throw new Error('اختر تعزيزاً واحداً على الأقل.');
    const v = await gameVersion();
    const key = [...new Set(chosen.map((a) => a.id))].sort((a, b) => a - b).join('-');
    // The stored games: a damaged file only means the advice goes without them.
    const stored = await readMayhemGames(mayhemFile).catch(() => []);
    const ids = new Set(chosen.flatMap((a) => a.ids));
    const champ = mayhemStats(stored, championId);
    const withThem = mayhemStats(stored.map((g) => ({ ...g, players: g.players.filter((p) => p.augments.some((id) => ids.has(id))) })), championId);
    // Asked again only for a new patch or a new game of this champion with these augments.
    const cacheKey = `${v}|${withThem.championGames}`;
    const r = await diskCache(
      join(cacheDir, 'ai', `${championId}-${key}.json`),
      (e) => v === null || e.key === cacheKey,
      async () => {
        const [page, pool, bin, gameItems, base] = await Promise.all([
          championPage(championId, 'mayhem', 'auto'),
          items('mayhem'),
          loadChampionBin(game, v, entry.alias),
          loadGameItems(game, v),
          baseTexts(),
        ]);
        // The model gets CommunityDragon's English item texts: about half the tokens of the Arabic game tooltips (no
        // lore lines), which matters for speed and the free quota, and English reads better to it.
        const english = new Map(base.rawItems[1].map((i) => [i.id, i.description]));
        // The site's other items are one list, not per slot: take them in order after the core.
        const later = page.siteBuild ? page.fourth : [page.fourth[0], page.fifth[0], page.sixth[0]];
        const usual = [...new Set([page.boots, page.core, ...later].flatMap((c) => c?.items.map((i) => i.id) ?? []))].slice(0, 6);
        const shop = pool.list.filter((i) => (i.group === 'legendary' || i.group === 'boots') && gameItems[i.id]);
        const shopIds = new Set(shop.map((i) => i.id));
        const bought = (s: typeof champ) => s.items.filter((i) => shopIds.has(i.id)).slice(0, 10);
        return adviseBuild(
          post,
          {
            champion: { name: entry.name, enName: entry.enName, abilities: page.champion.abilities.map((a) => ({ key: a.key, enName: a.enName, text: a.html })) },
            augments: chosen.map((a) => ({
              id: a.id,
              name: a.name,
              enName: a.enName,
              text: a.html,
              tier: page.augments.find((r) => r.id === a.id)?.tierLabel,
              // The augment texts are Arabic and the model's item list English: point it to the items an augment is about.
              items: namedItems({ enName: a.enName, text: a.html }, shop),
            })),
            pool: shop.map((i) => ({ id: i.id, enName: i.enName, gold: i.gold, boots: i.group === 'boots', text: english.get(i.id) || i.html })),
            usual: usual.filter((id) => gameItems[id]),
            played: { games: champ.championGames, items: bought(champ), withAugments: withThem.championGames, itemsWithAugments: bought(withThem) },
            // Under each chosen augment's own id: an augment's other ids (Arena's copy) count toward it.
            synergy: chosen.flatMap((a) => augmentItemSynergy(stored, a.ids, (id) => shopIds.has(id)).map((s) => ({ ...s, augment: a.id }))),
          },
          (builds, effects) => compareBuilds({ bin, items: gameItems, builds, effects }),
        );
      },
      { key: cacheKey },
    );
    return r.data;
  }

  /**
   * At launch, in the background: the big game files (38MB string table, 16MB items bin) download once per patch and
   * otherwise make the first champion or items page wait for them. Same promises the pages use, so nothing loads twice.
   */
  function warm() {
    for (const load of [champions, augments, tooltipStrings, detailedItems]) void load().catch(() => undefined);
  }

  /** Where the Mayhem games read from the client are kept. */
  const mayhemFile = join(cacheDir, 'mayhem-games.json');

  async function mayhemPicks(championId: number): Promise<MayhemPicks> {
    const games = latestPatch(await readMayhemGames(mayhemFile));
    const s = mayhemStats(games, championId);
    const all = (await augments()).augments;
    const shop = (await items('mayhem')).list.filter((i) => i.group === 'legendary' || i.group === 'boots');
    // An augment can have more than one id (see texts/augments.ts): count it once.
    const byAugment = new Map<number, MayhemPicks['augments'][number]>();
    for (const p of s.augments) {
      const a = all.find((x) => x.ids.includes(p.id));
      if (!a) continue;
      const t = byAugment.get(a.id) ?? { augment: a, games: 0, wins: 0 };
      t.games += p.games;
      t.wins += p.wins;
      byAugment.set(a.id, t);
    }
    return {
      patch: games.length ? patchOf(games[0]) : '',
      games: s.games,
      championGames: s.championGames,
      championWins: s.championWins,
      augments: rankByWins([...byAugment.values()], { games: s.championGames, wins: s.championWins }),
      items: s.items.flatMap((p) => {
        const item = shop.find((i) => i.id === p.id);
        return item ? [{ item, games: p.games, wins: p.wins }] : [];
      }),
    };
  }

  // F7 asks on every mark: read the stored games at most once a minute.
  let gamesRead: { at: number; games: Promise<MayhemGame[]> } | undefined;
  const storedGames = () => {
    if (!gamesRead || Date.now() - gamesRead.at > 60_000) gamesRead = { at: Date.now(), games: readMayhemGames(mayhemFile).catch(() => []) };
    return gamesRead.games;
  };

  /** How well every other augment went with the ones marked, in real games of every champion (see augmentPairs). */
  async function augmentFit(augmentIds: number[]): Promise<{ id: number; games: number; lift: number }[]> {
    const all = (await augments()).augments;
    const chosen = augmentIds.flatMap((id) => all.find((a) => a.id === id)?.ids ?? [id]);
    const pairs = augmentPairs(await storedGames(), chosen);
    return all.flatMap((a) => {
      // An augment's copies (Arena's id) are separate in the games: keep the one with the most games.
      const best = a.ids.map((id) => pairs.get(id)).filter((p) => p !== undefined).sort((x, y) => y.games - x.games)[0];
      return best ? [{ id: a.id, ...best }] : [];
    });
  }

  return { augments, champions, championPage, items, tierList, suggestions, profilePage, overlayData, aiBuild, mayhemFile, mayhemPicks, augmentFit, warm };
}
