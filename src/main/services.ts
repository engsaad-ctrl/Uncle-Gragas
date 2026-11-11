import { adviseBuild, namedItems, type Advice, type GeminiPost } from '../ai/advisor.js';
import { blockedItems, itemPart, lineItems, NEEDS_ONE_OF } from '../ai/lines.js';
import { explainLink, linksWith } from '../ai/mechanics.js';
import { AUGMENT_MECHANICS, ITEM_MECHANICS } from '../ai/mechanicsData.js';
import { CHAMPION_KITS } from '../ai/championKits.js';
import { championRecord, compareBuilds } from '../ai/calculator.js';
import { ATTACK_PACE, fight, needHolds, questItems, spellTraits, STACKS_AT_15 } from '../ai/cardMath.js';
import { RETIRED_AUGMENTS } from '../ai/retiredAugments.js';
import { AUGMENT_TAGS } from '../ai/augmentTags.js';
import { tagWeight } from '../ai/tagWeight.js';
import { CARD_NUMBERS, ITEM_NUMBERS, PASSIVE_NUMBERS } from '../ai/cardMathData.js';
import { cardFromFiles } from '../ai/augmentFiles.js';
import { augmentStage, FIGHT_READ_LEVEL, type AugmentProgress } from '../ai/augmentProgress.js';
import { skillPlanOf, type KnownRanks, type SkillPlan } from '../ai/abilityRank.js';
import { compareAugmentPlan, kitWithCards, type AugmentPlan } from '../ai/augmentChoice.js';
import { explainBuild } from '../ai/buildExplanation.js';
import { itemExplanationWords } from '../app/buildExplanation.js';
import { enemyDpsAt, enemyTeam, fightValue, LEVEL_BY_ITEMS, mathBuild as itemsByMath, SLOTS, teamPlace, type BuildStyle } from '../ai/itemMath.js';
import { composeChampionPage, type ChampionPage, type PageMode } from '../app/championPage.js';
import { diskCache } from '../diskCache.js';
import { EZREAL, MANAMUNE, MURAMANA } from '../app/ezrealPurchases.js';
import { composeItemList, type ItemEntry } from '../app/itemList.js';
import { composeProfile, type ProfilePage } from '../app/profilePage.js';
import { counterPicks, metaPicks, type Suggestion } from '../app/suggestions.js';
import type { RawProfile } from '../lcu/profile.js';
import { uniqueGames } from '../lcu/gameShape.js';
import { readMayhemGames, type MayhemGame } from '../lcu/mayhemGames.js';
import { augmentItemSynergy, augmentPairs, latestPatch, mayhemStats } from '../app/mayhemStats.js';
import { augmentEffects, bootstrapWeights, fitTeamModel, fullGames, strength, type TeamModel } from '../app/teamModel.js';
import { boughtAs, buildFor, synergyAcrossChampions } from '../app/buildEngine.js';
import { RECIPES_PATCH } from '../app/creatorRecipes.js';
import { recipeFor, shiftedBuild, worthShowing } from '../app/experimentalBuild.js';
import { composeAllLanes, composeTierList, mainLane, type TierRow } from '../app/tierList.js';
import { byWinRate, sitePage, type SiteItems } from '../stats/arammayhem.js';
import { kitStats, type KitStats } from '../stats/aramKit.js';
import { augmentLift, augmentLink, heroEdge, liftPoints, openStats } from '../stats/openStats.js';
import { mcpCaller, OpggStats, type CallTool, type ChampionBuild, type Counter, type Fetched, type Pick, type MayhemAugmentStat, type ItemMap, type LanePosition, type Position } from '../stats/opgg.js';
import { join } from 'node:path';
import { buildAbilityDetails } from '../texts/abilityDetails.js';
import type { AugmentGameData, AugmentText } from '../texts/augments.js';
import { loadAugments, type AugmentsResult } from '../texts/augmentsLoader.js';
import { withDamageTypes } from '../texts/damageTypes.js';
import { loadCdragonJson, type Locale } from '../texts/cdragon.js';
import {
  buildChampionDetail, buildChampionList, buildSpellTexts, buildStyleTrees,
  type ChampionListEntry, type RawChampion, type RawChampionSummary,
} from '../texts/champions.js';
import { loadChampionBin, loadGameItems, loadGameVersion, loadStringTable, loadTooltipStrings, type GameItem } from '../texts/gameData.js';
import { buildItemDetails, buildItemTexts, itemClasses, type ItemText, type RawItem } from '../texts/items.js';
import { buildRuneTexts, type RawPerk } from '../texts/runes.js';

const MODES: PageMode[] = ['ranked', 'flex', 'aram', 'mayhem', 'arena', 'urf', 'nexus'];
const NO_BUILD: PageMode[] = ['arena', 'urf', 'nexus']; // see BuildMode in stats/opgg.ts
/** Cassiopeia can't buy boots (her passive): the engine gave her Sorcerer's Shoes (Codex round 16, 2026-11-09). */
const CASSIOPEIA = 69;
/** English names compared without case or punctuation. The site writes "Quest: Steel Your Heart"; the game's Mayhem copy is just "Steel Your Heart". */
const nameKey = (s: string) => s.toLowerCase().replace(/^quest:/, '').replace(/[^a-z0-9]/g, '');
/** The stats part of a build when OP.GG's could not be had. */
const NO_ARAM_BUILD: ChampionBuild = {
  games: 0, winRate: 0, pickRate: 0, banRate: null, runes: null, spells: null, starter: null, core: null, boots: null,
  fourth: [], fifth: [], sixth: [], skillOrder: [], skillPriority: [], strongAgainst: [], weakAgainst: [],
};
const POSITIONS: Position[] = ['top', 'jungle', 'mid', 'adc', 'support'];

export interface OverlayData {
  game?: number;
  /** Only level and inventory, read from the live client. No player identity is exposed. */
  live?: { level: number; items: number[]; game: number };
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
  augments: (AugmentText & { rank?: number; popularity?: number; tierLabel?: string; unmeasuredReason?: string })[];
}

export interface AugmentValue {
  id: number; damage: number; health: number; value: number; currentValue: number;
  certain: boolean; missing: string | null;
  /** Conditions the fight doesn't settle: its value is what it gives if they hold; ranked apart from settled cards (the owner, 2026-11-09). */
  open: string[];
  level: number; untilLevel: number; estimatedLevel: boolean; estimatedHistory: boolean;
  plan?: AugmentPlan & PlanOwned & PlanReasons;
  planError?: string;
}
/** The held items each of a card's two searches kept, in its order: mathBuild's 'owned' rows, which open its result (T015). It describes the
 *  search's input as main used it (the live items, mapped by mathBuild), so the page compares the upcoming items past it, not past its own list.
 *  No certificate of where the items came from. */
export interface PlanOwned { baselineOwned: number[]; itemsOwned: number[] }
/** Why the card's own search put each item to buy in its plan, in its order: mathBuild's why for its rows past the held ones (T017). The words
 *  the search wrote, no new explanation; they don't say the card alone caused a change. */
export interface PlanReasons { itemsWhy: { id: number; why: string[] }[] }
const ownedRows = (rows: { item: { id: number }; why: string[] }[]) => rows.filter((r) => r.why.includes('owned')).map((r) => r.item.id);

/** The app-wide mode chosen in the side menu. */
export type AppMode = 'normal' | 'aram' | 'mayhem' | 'arena';
const APP_MODES: AppMode[] = ['normal', 'aram', 'mayhem', 'arena'];
const ITEM_MAP: Record<AppMode, ItemMap> = { normal: 'SUMMONERS_RIFT', aram: 'HOWLING_ABYSS', mayhem: 'HOWLING_ABYSS', arena: 'ARENA_MAP_1' };

/**
 * An augment's effect on its team's win chance in percentage points, from the team model over every champion's games;
 * low/high: the 5th-95th percentile over bootstrap refits, once they are done (a range across 0 means not sure).
 */
/** A second build shown with a label: a creator's, or what the champion's players turn to with the augment. */
export interface ExperimentalBuild {
  items: ItemEntry[];
  source: 'creator' | 'players';
  channel?: string;
  patch?: string;
}

export interface AugmentEffect {
  id: number;
  points: number;
  low?: number;
  high?: number;
  /** Player appearances with it in the current patch's games. */
  games: number;
}

/** Both teams on the loading screen: each player's champion and solo rank, and how the teams compare. */
export interface GameTeams {
  mine: { championId: number; name: string; rank: { tier: string; division: string } | null }[];
  enemy: { championId: number; name: string; rank: { tier: string; division: string } | null }[];
  summary: TeamSummary;
}

/** The teams by the team model's champion strengths (no augments yet), and their magic damage (magic 1, mixed 0.5). */
export interface TeamSummary {
  side: 'stronger' | 'even' | 'weaker';
  magic: { mine: number; enemy: number };
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
const RUNAANS = 3085;
const DUSK_AND_DAWN = 2510, ARDENT_CENSER = 3504;

export function parseIds(v: unknown, max = 10): number[] {
  if (!Array.isArray(v) || v.length > max || !v.every((x) => Number.isInteger(x) && x > 0)) throw new Error('bad ids');
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

const PLAIN_BOOTS_GOLD = 300; // the first pair, on the way to a real one
/** enemyItems: what each enemy holds now in the running match (src/lcu/liveGame.ts), by champion id. */
interface Teams { allies: number[]; enemies: number[]; enemyItems?: Record<number, number[]> }
const MAGE_SUPPORTS = new Set([99, 1, 61, 147, 25, 43, 26]);
// aoe: not for an enchanter, whose damage isn't what he's for (the owner, 2026-11-06: Sona and Rakan don't start Liandry's Torment).
/** Ranks read from the live game, at the level they were read. */
const knownRanksOf = (p?: AugmentProgress): KnownRanks | undefined => (p?.abilityRanks && p.level !== undefined ? { level: p.level, ranks: p.abilityRanks } : undefined);
export const fightKitOf = (id: number) => { const k = CHAMPION_KITS.find((x) => x.id === id); return { damage: k?.damage ?? ('mixed' as const), aoe: !!k?.traits.includes('aoe') && !(k.relies.includes('allies') && (k.relies.includes('healing') || k.relies.includes('shielding')) && !MAGE_SUPPORTS.has(id)), attacks: k?.relies.includes('attacks') ?? false, buffsAllies: !!k && k.relies.includes('allies') && (k.relies.includes('healing') || k.relies.includes('shielding')), attackPace: ATTACK_PACE[id] }; };

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
  /** The champion bin for the fight, each spell with the damage types its tooltip marks (src/texts/damageTypes.ts); without the tooltips, the bin as it is. */
  const fightBin = async (v: string | null, alias: string) => { const [bin, strings] = await Promise.all([loadChampionBin(game, v, alias), tooltipStrings().catch(() => ({}))]); return withDamageTypes(bin, strings); };

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

  /** OP.GG's augment ranking. arammayhem.com serves items only: its augments match AramHex, so they aren't used (the owner's rule 50, 2026-11-05; applied 2026-11-09). */
  async function mayhemRanking(id: number, _alias: string): Promise<Fetched<MayhemAugmentStat[]> | null> {
    return stats.mayhemAugments(id).catch(() => null);
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
    // Without the augment texts the history still shows, only without their icons.
    const [list, t, augs] = await Promise.all([champions(), texts(), augments().then((r) => r.augments, () => [])]);
    const byId = new Map(augs.flatMap((a) => a.ids.map((id) => [id, a] as const)));
    return composeProfile(raw, list, t.items, t.spells, me, byId);
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
      const offered = [...rated, ...all.filter((a) => a.modes.includes('mayhem') && !ratedIds.has(a.id))];
      const augmentsWithNotes = offered.map((a) => {
        const card = cardsOf(all, [a.id])[0];
        return card?.ops.length ? a : { ...a, unmeasuredReason: card?.not_modelled ?? 'لا توجد معادلات لهذا التعزيز' };
      });
      return { champion, mode: 'mayhem', rated: rated.length > 0, build, items: pool, boots, augments: augmentsWithNotes };
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
    // The current patch's stored games (a damaged file only means the advice goes without them).
    const stored = await storedGames();
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
            champion: { name: entry.name, enName: entry.enName, abilities: page.champion.abilities.map((a) => ({ key: a.key, enName: a.enName, text: a.html })), kit: kitLine(championId) },
            augments: chosen.map((a) => ({
              id: a.id,
              name: a.name,
              enName: a.enName,
              text: a.html,
              tier: page.augments.find((r) => r.id === a.id)?.tierLabel,
              // The augment texts are Arabic and the model's item list English: point it to the items an augment is about.
              items: namedItems({ enName: a.enName, text: a.html }, shop),
            })),
            pool: shop.map((i) => ({ id: i.id, enName: i.enName, gold: i.gold, boots: i.group === 'boots', text: english.get(i.id) || i.html, damage: itemDamage(i.id) })),
            switchesDamage: chosen.some((a) => switchesDamage(a.ids)),
            usual: usual.filter((id) => gameItems[id]),
            played: { games: champ.championGames, items: bought(champ), withAugments: withThem.championGames, itemsWithAugments: bought(withThem) },
            links: mechanicLinks(chosen.map((a) => a.ids), shopIds),
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

  /** How the champion fights, for the model: its kit note and what it relies on and scales with. */
  const kitLine = (id: number) => {
    const k = CHAMPION_KITS.find((x) => x.id === id);
    return k && `${k.note}. Relies on ${k.relies.join(', ')}; scales with ${k.scales.join(', ')}.`;
  };

  const AD_STATS = new Set(['ad', 'bonus_ad', 'lethality']);
  /** An item's damage kind from what it gives: AP only, AD only (lethality counts), or neither / both. */
  function itemDamage(id: number): 'ap' | 'ad' | 'none' {
    const gives = new Set(ITEM_MECHANICS.find((m) => m.id === id)?.gives.map((g) => g.stat) ?? []);
    const ad = [...gives].some((s) => AD_STATS.has(s));
    return gives.has('ap') && !ad ? 'ap' : ad && !gives.has('ap') ? 'ad' : 'none';
  }
  /** An item with both AD and AP (Hextech Gunblade, Guinsoo's): itemDamage calls it 'none', but it isn't a tank item (the owner's rule 16, full tank; 2026-11-09). */
  const hybrid = (id: number) => { const gives = new Set(ITEM_MECHANICS.find((m) => m.id === id)?.gives.map((g) => g.stat) ?? []); return gives.has('ap') && [...gives].some((x) => AD_STATS.has(x)); };
  /** An augment that turns AD into AP or the reverse (ADAPt), or AP into attack stats (Zealot: AP gives crit and attack speed, so AP on-hit items fit an attacker; the owner's Varus case). */
  // Jeweled Gauntlet's AP-to-crit is for abilities: it rewards AP, so it keeps a mage on magic (the owner's Akali case, 2026-11-05).
  const switchesDamage = (ids: number[]) =>
    AUGMENT_MECHANICS.some((m) => ids.includes(m.id) && !m.relies.includes('abilities') && m.converts.some((c) => (AD_STATS.has(c.from) && c.to === 'ap') || (c.from === 'ap' && (AD_STATS.has(c.to) || c.to === 'crit' || c.to === 'attack_speed'))));

  /** The chosen augments' links to shop items and to each other, read from the texts (src/ai/mechanics.ts). */
  function mechanicLinks(chosenIds: number[][], shopIds: Set<number>, max = 12): string[] {
    const chosen = chosenIds.flatMap((ids) => AUGMENT_MECHANICS.filter((m) => ids.includes(m.id)).slice(0, 1));
    const names = new Map([...AUGMENT_MECHANICS, ...ITEM_MECHANICS].map((m) => [m.id, m.name]));
    const name = (id: number) => names.get(id) ?? String(id);
    const toItems = ITEM_MECHANICS.filter((i) => shopIds.has(i.id)).flatMap((i) => linksWith(chosen, i));
    const among = chosen.flatMap((a, i) => chosen.slice(i + 1).flatMap((b) => linksWith([a], b)));
    return [...among, ...toItems].sort((x, y) => y.strength - x.strength).slice(0, max).map((l) => explainLink(l, name));
  }

  // The current patch's stored games, for every statistic: an older patch's numbers say little about this one.
  // Read at most once a minute: F7 asks on every mark.
  let gamesRead: { at: number; games: Promise<MayhemGame[]> } | undefined;
  const storedGames = () => {
    if (!gamesRead || Date.now() - gamesRead.at > 60_000) gamesRead = { at: Date.now(), games: readMayhemGames(mayhemFile).then((g) => latestPatch(uniqueGames(g)), () => []) };
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

  // The team model on the current patch's games (src/app/teamModel.ts), refitted when they change (about 0.1 s); then 50
  // bootstrap refits in the background, one per tick, say how sure each augment's effect is.
  let model: { count: number; fit: TeamModel; boot: TeamModel[] } | undefined;
  async function teamModel() {
    const games = fullGames(await storedGames());
    if (model?.count !== games.length) {
      const m = { count: games.length, fit: fitTeamModel(games), boot: [] as TeamModel[] };
      model = m;
      void (async () => {
        let seed = 7;
        const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 50 && model === m; i++) {
          await new Promise((done) => setTimeout(done, 0));
          m.boot.push(fitTeamModel(games, bootstrapWeights(games.length, rand)));
        }
      })();
    }
    return model;
  }

  /** Every augment's effect on its team's win chance in points, from the team model, by the app's augment id. */
  async function augmentEffect(): Promise<AugmentEffect[]> {
    const [m, all, games] = await Promise.all([teamModel(), augments(), storedGames()]);
    const effects = augmentEffects(m.fit, m.boot);
    const taken = new Map<number, number>();
    for (const g of games) for (const p of g.players) for (const a of new Set(p.augments)) taken.set(a, (taken.get(a) ?? 0) + 1);
    return all.augments.flatMap((a) => {
      // An augment's copies (Arena's id) are separate features: take the one with the most games.
      const id = [...a.ids].sort((x, y) => (taken.get(y) ?? 0) - (taken.get(x) ?? 0))[0];
      const e = effects.get(id);
      return e ? [{ id: a.id, ...e, games: taken.get(id) ?? 0 }] : [];
    });
  }

  /**
   * The build without AI (src/app/buildEngine.ts) for a champion and the augments taken: ARAMKit's Mayhem items as the
   * base and what the augments did to items across champions on top, with the augments' required items. If ARAMKit can't
   * be had: OP.GG's normal-ARAM build, our Mayhem games, text links and our measured pairings.
   */
  async function engineBuild(championId: number, augmentIds: number[], enemies: number[] = [], followLines = false, owned: number[] = []): Promise<{ item: ItemEntry; why: string[]; offPath?: boolean }[]> {
    const entry = (await champions()).find((c) => c.id === championId);
    if (!entry) throw new Error(`unknown champion ${championId}`);
    const [all, list, games] = await Promise.all([augments(), items('mayhem'), storedGames()]);
    const shop = list.list.filter((i) => i.group === 'legendary' || i.group === 'boots');
    const shopIds = new Set(shop.map((i) => i.id));
    const ids = augmentIds.map((id) => all.augments.find((a) => a.id === id)?.ids ?? [id]);
    const kitData = await champKit(championId);
    const toShop = (id: number) => [boughtAs(id), boughtAs(id % 10000)].find((x) => shopIds.has(x));
    const kitItems = kitData?.items.flatMap((i) => { const id = toShop(i.id); return id ? [{ id, games: i.games, wins: i.games * i.winRate }] : []; });
    const am = ids.flatMap((x) => AUGMENT_MECHANICS.filter((m) => x.includes(m.id)).slice(0, 1));
    const fallback = async () => {
      const b = await stats.build(entry.alias, 'aram', 'mid').then((r) => r.data, () => null);
      const ms = mayhemStats(games, championId);
      const synergy = new Map<number, number>();
      for (const s of augmentItemSynergy(games, ids.flat(), (id) => shopIds.has(id))) synergy.set(s.item, Math.max(synergy.get(s.item) ?? 0, s.lift));
      return {
        base: b ? [...(b.core ? [{ ...b.core, core: true }] : []), ...(b.boots ? [b.boots] : []), ...b.fourth, ...b.fifth, ...b.sixth] : [],
        mayhem: ms.items,
        mayhemGames: ms.championGames,
        links: new Map(ITEM_MECHANICS.filter((i) => shopIds.has(i.id)).map((i) => [i.id, linksWith(am, i).reduce((s, l) => s + l.strength, 0)] as const).filter(([, s]) => s > 0)),
        synergy,
      };
    };
    const sources = kitItems?.length
      ? { base: [], mayhem: kitItems, mayhemGames: kitData!.games, links: new Map<number, number>(), synergy: synergyAcrossChampions(ids, shopIds) }
      : await fallback();
    const kit = CHAMPION_KITS.find((k) => k.id === championId);
    // What he bought holds its slot, limits the rest and can open the other damage kind, but pulls nothing in. On 26,151 stored builds a pull
    // by text links and lines named the rest worse than the plain list (first item 43.8% against 55.4%; 58.6% without the pull).
    const r = buildFor({
      owned,
      championDamage: kit?.damage === 'magic' ? 'ap' : kit?.damage === 'physical' ? 'ad' : 'mixed',
      switchesDamage: ids.some((x) => switchesDamage(x)),
      pool: shop.map((i) => ({ id: i.id, boots: i.group === 'boots', damage: itemDamage(i.id), mr: ITEM_MECHANICS.some((m) => m.id === i.id && m.gives.some((g) => g.stat === 'mr' || g.stat === 'resists')) })),
      ...sources,
      // Only with the whole enemy team known (the game loaded): magic 1, mixed 0.5.
      enemyMagic: enemies.length === 5 ? enemies.reduce((s, id) => { const d = CHAMPION_KITS.find((k) => k.id === id)?.damage; return s + (d === 'magic' ? 1 : d === 'mixed' ? 0.5 : 0); }, 0) : undefined,
      required: [...new Set(am.flatMap((m) => m.needs.filter((n): n is number => typeof n === 'number')))],
      requiredAny: am.flatMap((m) => (NEEDS_ONE_OF[m.id] ? [NEEDS_ONE_OF[m.id]!] : [])),
      avoid: blockedItems(am.map((m) => m.id)),
      ...(followLines ? { lineItems: lineItems([...am.map((m) => m.id), ...owned.map(itemPart)]) } : {}),
    });
    return r.items.flatMap((id) => {
      const item = shop.find((i) => i.id === id);
      return item ? [{ item, why: [...new Set(r.why.get(id) ?? [])], ...(r.offPath.includes(id) ? { offPath: true } : {}) }] : []; // an item in several base options says "base" once
    });
  }

  /**
   * What each card adds in one fight for this champion, given the cards held and the items owned: arithmetic only (src/ai/cardMath.ts), no pick, buy
   * or win rates. A card with no numbers or whose condition fails isn't listed, so the screen says it can't be computed.
   */
  /** The real teams when a game is loaded. */
  async function teamFacts(teams: Teams | undefined, shop: Record<number, GameItem>) {
    if (!teams) return { enemy: undefined, allies: undefined };
    const v = await gameVersion();
    const list = await champions();
    const binOf = async (id: number) => { const c = list.find((x) => x.id === id); return c ? { bin: await fightBin(v, c.alias), kit: fightKitOf(id), passive: PASSIVE_NUMBERS.find((p) => p.id === id)?.ops ?? [] } : []; }; // his passive holds his kit's own healing (Aatrox, Mundo, Warwick)
    // Each enemy with the items he holds in the running match, else the build the engine gives him with no teams (cached), for his healing; a failed build leaves him item-free.
    // The live API may name an ARAM copy of an item: fall back to its base id when the shop lacks it.
    const known = (ids: number[]) => ids.flatMap((x) => (shop[x] ? [x] : shop[x % 10000] ? [x % 10000] : []));
    const enemyOf = async (id: number) => { const e = await binOf(id); if (Array.isArray(e)) return e; const live = Object.hasOwn(teams.enemyItems ?? {}, id); const held = known(teams.enemyItems?.[id] ?? []); const items = live ? held : await mathBuild(id, []).then((b) => b.map((x) => x.item.id), () => []); return { ...e, items, live }; };
    const [enemies, allies] = await Promise.all([Promise.all(teams.enemies.map(enemyOf)), Promise.all(teams.allies.map(binOf))]);
    return { enemy: enemyTeam(enemies.flat(), shop, ITEM_OPS), allies: allies.flat().map((a) => a.bin) };
  }

  // How he levels his skills when the match gives no ranks: the Mayhem site's most picked order, else OP.GG's ARAM build (the owner, 2026-11-09). None: an even spread.
  const skillPlans = new Map<number, Promise<SkillPlan | undefined>>();
  const skillPlanFor = (championId: number): Promise<SkillPlan | undefined> => {
    let plan = skillPlans.get(championId);
    if (!plan) {
      plan = (async () => {
        try {
          const alias = (await champions()).find((c) => c.id === championId)?.alias;
          if (!alias) return undefined;
          const site = await sitePage(alias, { cacheDir, fetchImpl }).catch(() => null);
          const fromSite = skillPlanOf(site?.data.build?.skillOrder, site?.data.build?.skillPriority);
          if (fromSite) return fromSite;
          const aram = await stats.build(alias, 'aram', 'mid');
          return skillPlanOf(aram.data.skillOrder, aram.data.skillPriority);
        } catch { return undefined; }
      })();
      skillPlans.set(championId, plan);
      void plan.then((p) => { if (!p) skillPlans.delete(championId); }); // unread (offline, no page): ask again next time
    }
    return plan;
  };
  /** Which augment `id` was in the order taken (1 = first), only when that is proven. The caller must vouch the history is complete
   * (historyComplete); then an explicit order of every pick (pickOrder) gives it, or else recorded levels do when every pick, held or not
   * (otherPicks), has one and none shares this one's level. Otherwise undefined: nothing that depends on the order is given. */
  const pickPlaceOf = (id: number, augmentIds: number[], progress?: AugmentProgress) => {
    if (!progress?.historyComplete) return undefined;
    const all = [...new Set([...augmentIds, ...Object.keys(progress.otherPicks ?? {}).map(Number)])];
    if (progress.pickOrder) return all.every((a) => progress.pickOrder!.includes(a)) ? progress.pickOrder.indexOf(id) + 1 : undefined;
    const levelOf = (a: number) => (augmentIds.includes(a) ? progress.acquiredLevels?.[a] : progress.otherPicks?.[a]) ?? undefined;
    if (progress.unknownPicks || all.some((a) => levelOf(a) === undefined)) return undefined;
    const mine = levelOf(id)!;
    if (all.some((a) => a !== id && levelOf(a) === mine)) return undefined;
    return 1 + all.filter((a) => levelOf(a)! < mine).length;
  };
  const rankNote = (progress: AugmentProgress | undefined, plan: SkillPlan | undefined) => knownRanksOf(progress) ? [] : [plan ? 'رتب المهارات حسب ترتيب صفحة البناء الأشهر، لا قراءة من المباراة' : 'رتب المهارات توزيع قانوني متساوٍ للنقاط، لا قراءة من المباراة'];

  async function cardValues(championId: number, augmentIds: number[], itemIds: number[], teams?: Teams, progress?: AugmentProgress, offeredIds: number[] = [], style?: BuildStyle, stacks?: number): Promise<AugmentValue[]> {
    if (offeredIds.length > 3) throw new Error('bad augment offer');
    const entry = (await champions()).find((c) => c.id === championId);
    if (!entry) throw new Error(`unknown champion ${championId}`);
    const v = await gameVersion();
    const [all, bin, shop, shopNames] = await Promise.all([augments(), fightBin(v, entry.alias), loadGameItems(game, v), items('mayhem')]);
    const kit = CHAMPION_KITS.find((k) => k.id === championId);
    const record = championRecord(bin) as { attackRangeModifiable?: { baseValue?: number } } | undefined;
    const numbersOf = (id: number) => { const card = cardsOf(all.augments, [id])[0]; return card ? { ...card, abilityKey: progress?.abilityTargets?.[id] } : undefined; };
    const stage = augmentStage(augmentIds, progress);
    const held = augmentIds.flatMap((id) => { const card = numbersOf(id); return card ? [{ ...card, acquiredLevel: stage.acquiredLevels[id], pickPlace: pickPlaceOf(id, augmentIds, progress) }] : []; });
    const knownItems = itemIds.flatMap((id) => shop[id] ? [id] : shop[id % 10000] ? [id % 10000] : []);
    const base = {
      bin, shop, level: stage.level, items: knownItems, cards: held, itemOps: ITEM_OPS, stacks, knownRanks: knownRanksOf(progress), skillPlan: await skillPlanFor(championId),
      kit: kitWithCards(fightKitOf(championId), held),
      passive: PASSIVE_NUMBERS.find((p) => p.id === championId)?.ops ?? [],
    };
    // His kit's traits, and what his own files and kit say: a moving skill (dash), an immobilizing one, heals or shields on allies (needHolds ability_kind).
    const facts = { owned: knownItems.flatMap((id) => shopNames.list.find((i) => i.id === id)?.enName ?? []), ranged: (record?.attackRangeModifiable?.baseValue ?? 0) >= 300, traits: [...(kit?.traits ?? []), ...spellTraits(bin), ...(base.kit.buffsAllies ? ['heal_ally', 'shield_ally'] : [])] };
    const facts2 = await teamFacts(teams, shop);
    const place = { ...teamPlace({ championId, bin, shop, kit: base.kit, passive: base.passive, enemy: facts2.enemy, allies: facts2.allies, style }), enemyDps: enemyDpsAt(base.level) };
    // Keep inventory fixed until the player actually buys. No future augment is assumed to arrive.
    const before = stage.levels.map((level) => {
      const at = { ...place, enemyDps: enemyDpsAt(level) };
      const input = { ...base, level, enemy: facts2.enemy, incomingDps: at.share * at.enemyDps * (at.draw ?? 1) };
      const result = fight(input);
      return { input, result, place: at, value: fightValue(result, at) };
    });
    const rows: AugmentValue[] = all.augments.flatMap((a) => {
      const card = numbersOf(a.id);
      if (!card?.ops.length || augmentIds.includes(a.id) || a.ids.some((id) => RETIRED_AUGMENTS.has(id))) return []; // out of Mayhem: nobody picks it (src/ai/retiredAugments.ts)
      const holds = needHolds(card.need, facts);
      if (holds === 'no') return [];
      // The offered card as a possibility: taken now, it would come after every logged pick. Nothing of this goes into the log.
      const candidate = { ...card, acquiredLevel: stage.level, pickPlace: pickPlaceOf(a.id, [...augmentIds, a.id], progress && { ...progress, acquiredLevels: { ...progress.acquiredLevels, [a.id]: stage.level }, ...(progress.pickOrder ? { pickOrder: [...progress.pickOrder, a.id] } : {}) }) };
      const after = before.map((b) => fight({ ...b.input, kit: kitWithCards(base.kit, [candidate]), cards: [...held, candidate] }));
      // Its tags (src/ai/augmentTags.ts) weigh its value (src/ai/tagWeight.ts); a card with a condition the fight doesn't check is never certain.
      const tags = a.ids.map((id) => AUGMENT_TAGS[id]).find(Boolean);
      const { weight, unread, open } = tagWeight(tags, card.ops, card.need?.class === 'ability_kind' ? holds : undefined);
      const gains = after.map((r, i) => weight * (fightValue(r, before[i]!.place) / Math.max(before[i]!.value, 1e-9) - 1));
      const first = before[0]!.result, now = after[0]!;
      // The fight already lists each card's own note (cardMath notModelled, prefixed with its name); adding card.not_modelled again showed it twice.
      const missing = [...new Set([...first.notModelled, ...now.notModelled]), ...open.map((c) => `شرط لا يفحصه القتال: ${c}؛ القيمة إن تحقق، واحتمال تحققه غير مقاس`), ...augmentIds.flatMap((id) => {
        const heldCard = numbersOf(id);
        if (!heldCard?.ops.length) return ['تعزيز مختار لا يملك معادلات؛ أثره وروابطه غير محسوبة'];
        return heldCard.not_modelled ? [`${heldCard.name}: ${heldCard.not_modelled}`] : heldCard.status !== 'computed' ? [`${heldCard.name}: أثره المختار جزئي أو مشروط`] : [];
      }), ...(card.ops.some((x) => x.op === 'per_stack') || held.some((c) => c.ops.some((x) => x.op === 'per_stack')) ? ['التكديس مقدّر حسب المستويات منذ الاختيار، وليس عددًا مقروءًا من اللعبة؛ زيادته أثناء القتال الحالي غير محسوبة'] : []), ...(stage.level > FIGHT_READ_LEVEL ? ['فوق المستوى 18 (حد Superfans 21): نمو البطل وأرقام القتال بعد 18 غير مقروءة؛ الحساب تقديري وناقص'] : [])].filter(Boolean).join(' · ') || null;
      return [{ id: a.id, damage: first.damage ? now.damage / first.damage - 1 : 0, health: first.effectiveHp ? now.effectiveHp / first.effectiveHp - 1 : 0, currentValue: gains[0]!, value: gains.reduce((sum, n) => sum + n, 0) / gains.length, open, certain: !stage.estimatedLevel && !stage.estimatedHistory && !missing && !unread && tags?.sure !== false && holds === 'yes' && card.status === 'computed' && card.ops.every((x) => x.op === 'add' || x.op === 'mult'), missing, level: stage.level, untilLevel: stage.untilLevel, estimatedLevel: stage.estimatedLevel, estimatedHistory: stage.estimatedHistory }];
    });
    if (!offeredIds.length) return rows;
    // Full searches only for the actual offer (at most three), never for the entire augment catalogue.
    // Finished items keep their slots. Components are retained in the current fight but their future upgrade cost is unknown.
    const finished = new Set(shopNames.list.filter((i) => i.group === 'legendary' || i.group === 'boots').map((i) => i.id));
    // A held Mayhem copy (22xxxx) is kept when the catalog knows it or its base item; mathBuild then holds it as the catalog's own id (the copy
    // when sold, else its base), so the plans don't buy it again (T016). The fight above keeps the shop's own copy stats (knownItems).
    const owned = [...knownItems.filter((id) => finished.has(id) || finished.has(id % 10000)), ...(championId === EZREAL ? itemIds.filter((id) => id % 10000 === MURAMANA && !finished.has(id) && !finished.has(id % 10000)) : [])];
    // Estimated levels fill the gaps here, so the order among his augments is proven only when none was estimated.
    const timing = { ...progress, level: stage.level, acquiredLevels: stage.acquiredLevels, unknownPicks: progress?.unknownPicks || stage.estimatedHistory };
    let baselineItems: number[], baselineOwned: number[];
    try { const rows = await mathBuild(championId, augmentIds, owned, teams, style, stacks, timing); baselineItems = rows.map((r) => r.item.id); baselineOwned = ownedRows(rows); }
    catch { for (const row of rows) if (offeredIds.includes(row.id)) row.planError = 'تعذّر حساب خطة البناء الأساسية'; return rows; }
    for (const row of rows.filter((r) => offeredIds.includes(r.id))) {
      try {
        const card = numbersOf(row.id)!;
        const candidate = { ...card, acquiredLevel: stage.level, pickPlace: pickPlaceOf(row.id, [...augmentIds, row.id], progress && { ...progress, acquiredLevels: { ...progress.acquiredLevels, [row.id]: stage.level }, ...(progress.pickOrder ? { pickOrder: [...progress.pickOrder, row.id] } : {}) }) };
        const nextTiming = { ...timing, acquiredLevels: { ...timing.acquiredLevels, [row.id]: stage.level }, ...(timing.pickOrder ? { pickOrder: [...timing.pickOrder, row.id] } : {}) };
        const rows = await mathBuild(championId, [...augmentIds, row.id], owned, teams, style, stacks, nextTiming);
        const items = rows.map((r) => r.item.id);
        if (!baselineItems.length || !items.length) { row.planError = 'لا تتوفر أيتمات كافية لحساب خطة البناء'; continue; }
        const level = Math.max(15, stage.level);
        const at = { ...place, enemyDps: enemyDpsAt(level) };
        row.plan = { ...compareAugmentPlan({ base: { ...base, level, enemy: facts2.enemy, incomingDps: at.share * at.enemyDps * (at.draw ?? 1) }, candidate, baselineItems, items, place: at }), baselineOwned, itemsOwned: ownedRows(rows), itemsWhy: rows.filter((r) => !r.why.includes('owned')).map((r) => ({ id: r.item.id, why: r.why })) };
        const a = all.augments.find((a) => a.id === row.id)!;
        row.plan.value *= tagWeight(a.ids.map((id) => AUGMENT_TAGS[id]).find(Boolean), card.ops, card.need?.class === 'ability_kind' ? needHolds(card.need, facts) : undefined).weight;
      } catch { row.planError = 'تعذّر حساب خطة هذا التعزيز؛ التقييم الحالي وحده متاح'; }
    }
    return rows;
  }

  const ITEM_OPS = Object.fromEntries(ITEM_NUMBERS.map((i) => [i.id, i.ops]));
  const builds = new Map<string, Promise<{ item: ItemEntry; why: string[]; missing: string[] }[]>>();
  /** The next items by arithmetic (src/ai/itemMath.ts). No pick, buy or win rates. */
  // The one lookup every path takes (offer, plan, build, styles, explanation), so an augment read from the patch's file (src/ai/augmentFiles.ts) has one set of numbers.
  const cardsOf = (list: { id: number; ids?: number[]; game?: AugmentGameData }[], augmentIds: number[]) => augmentIds.flatMap((id) => { const entry = list.find((a) => a.id === id); const ids = entry?.ids ?? [id]; const card = CARD_NUMBERS.find((c) => ids.includes(c.id)); return card ? [cardFromFiles(card, entry?.game)] : []; });
  /** The ways his kit can be built besides its own: magic or physical when his damage grows with that stat at least half as much as with the other (100 of each, no items), and tank for everyone (the owner: Katarina has all three). */
  /** Magic also when a held card works on AP or on damage over time (the owner: Miss Fortune with Vulnerability builds AP and burns). */
  async function buildStyles(championId: number, augmentIds: number[] = [], progress?: AugmentProgress): Promise<BuildStyle[]> {
    const entry = (await champions()).find((c) => c.id === championId);
    if (!entry) throw new Error(`unknown champion ${championId}`);
    const v = await gameVersion();
    const [bin, shop] = await Promise.all([fightBin(v, entry.alias), loadGameItems(game, v)]);
    const kit = CHAMPION_KITS.find((k) => k.id === championId);
    const fightKit = fightKitOf(championId);
    const passive = PASSIVE_NUMBERS.find((p) => p.id === championId)?.ops ?? [];
    const all = augmentIds.length ? await augments() : undefined;
    // With the held cards: a card that adds magic damage to his casts or attacks (Infernal Conduit, Marksmage) makes AP grow his damage (BodyThoseFools' AP Nasus, 2026-11-07).
    const held = augmentIds.flatMap((id) => cardsOf(all?.augments ?? [], [id]).map((c) => ({ ...c, abilityKey: progress?.abilityTargets?.[id] })));
    const skillPlan = await skillPlanFor(championId);
    const damage = (stat?: string) => fight({ bin, shop, kit: fightKit, passive, items: [], level: 13, skillPlan, cards: [...held, ...(stat ? [{ id: 0, name: stat, status: 'computed', ops: [{ op: 'add' as const, stat, value: 100 }] }] : [])] }).damage;
    const base = damage(), ap = damage('ap') - base, ad = damage('ad') - base;
    const magicCard = held.some((c) => c.ops.some((x) => x.op === 'crit_dot' || (x.op === 'convert' && (x.from === 'ap' || x.to === 'ap')) || ((x.op === 'add' || x.op === 'mult' || x.op === 'per_stack') && x.stat === 'ap')));
    const magic = (ap >= 0.5 * Math.max(ap, ad) && ap > 0) || magicCard;
    // A magic frontline champion also builds magic with health (the owner: Galio has three builds).
    return [...(magic ? ['ap' as const] : []), ...(magic && kit?.traits.includes('frontline') ? ['aphp' as const] : []), ...(ad >= 0.5 * Math.max(ap, ad) && ad > 0 ? ['ad' as const] : []), 'tank'];
  }

  /** His stacks by level 15 when his abilities grow with stacks (the engine's estimate), or null. */
  async function stackBase(championId: number): Promise<number | null> {
    const alias = (await champions()).find((c) => c.id === championId)?.alias;
    return alias ? STACKS_AT_15[alias] ?? null : null;
  }
  function mathBuild(championId: number, augmentIds: number[], owned: number[] = [], teams?: Teams, style?: BuildStyle, stacks?: number, progress?: AugmentProgress) {
    const key = `${JSON.stringify(progress ?? {})}|${stacks ?? ''}|${style ?? ''}|${championId}|${augmentIds.join()}|${owned.join()}|${teams?.allies.join() ?? ''}|${teams?.enemies.join() ?? ''}|${JSON.stringify(teams?.enemyItems ?? {})}`;
    const known = builds.get(key);
    if (known) return known;
    const work = (async () => {
      const entry = (await champions()).find((c) => c.id === championId);
      if (!entry) throw new Error(`unknown champion ${championId}`);
      const v = await gameVersion();
      const [all, bin, shop, list] = await Promise.all([augments(), fightBin(v, entry.alias), loadGameItems(game, v), items('mayhem')]);
      // An item with no text isn't in the shop: Viktor's core is one champion's, given and never bought.
      // Ids 77xxxx are old items the map list carries (Deathfire Grasp, Zephyr): 0 to 6 buyers each in 63,810 Mayhem players, so not in the shop.
      const sold = list.list.filter((i) => (i.group === 'legendary' || (i.group === 'boots' && i.gold > PLAIN_BOOTS_GOLD)) && i.html && Math.floor(i.id / 10000) !== 77);
      // Live inventory may contain mode copies and components; only finished shop items occupy fixed build slots.
      const soldIds = new Set(sold.map((i) => i.id));
      const manamune = championId === EZREAL ? sold.find((i) => i.id % 10000 === MANAMUNE && shop[i.id])?.id : undefined;
      const ownedItems = [...new Set(owned.map((id) => {
        const base = id % 10000;
        if (soldIds.has(id)) return id;
        if (soldIds.has(base)) return base;
        if (base === MURAMANA && manamune !== undefined) return manamune;
        return base;
      }).filter((id) => soldIds.has(id)))];
      const kit = CHAMPION_KITS.find((k) => k.id === championId);
      const stage = augmentStage(augmentIds, progress);
      const cards = progress ? augmentIds.flatMap((id) => cardsOf(all.augments, [id]).map((c) => ({ ...c, acquiredLevel: stage.acquiredLevels[id], abilityKey: progress.abilityTargets?.[id], pickPlace: pickPlaceOf(id, augmentIds, progress) }))) : cardsOf(all.augments, augmentIds);
      // A frontline mage holding a card that makes his AP pay in crits (Jeweled Gauntlet: abilities crit, AP into crit chance) builds as a damage dealer, all magic:
      // the owner's Swain (2026-11-08, «نعم صحيح»: Zwag's Zhonya's, Blackfire, Rite of Ruin, Rabadon's, Liandry's, Void).
      if (!style && kit?.damage === 'magic' && kit.traits.includes('frontline') && cards.some((c) => c.ops.some((x) => x.op === 'crit_abilities' || (x.op === 'convert' && x.from === 'ap')))) style = 'ap';
      // An augment named "Upgrade X" works only through item X (Upgrade Collector, Hubris, Ravenous Hydra, Sundered Sky, Zhonya's): it asks for that item, whether or not its card names it.
      const upgraded = all.augments.filter((a) => augmentIds.some((x) => a.ids.includes(x))).flatMap((a) => { const name = /^Upgrade (.+)$/.exec(a.enName)?.[1]; const item = name ? sold.find((i) => i.enName === name || i.enName === `The ${name}` || i.enName.startsWith(`${name} `)) : undefined; return item ? [item.id] : []; });
      // Upgrade Sheen upgrades every Spellblade item, and Sheen itself isn't sold: it asks for one Spellblade item (an item whose effect fires on the next attack after an ability), which one by the build (the owner's Nasus tree, 2026-11-09).
      const spellblade = sold.filter((i) => (ITEM_NUMBERS.find((x) => x.id === i.id % 10000)?.ops ?? []).some((x) => 'trigger' in x && x.trigger === 'next_attack')).map((i) => i.id);
      const requiredAnyOf = all.augments.some((a) => augmentIds.some((x) => a.ids.includes(x)) && a.enName === 'Upgrade Sheen') && spellblade.length ? [spellblade] : [];
      // A quest card that asks for items (Ultra Hydra, Wooglet's Witchcap) gets them, since its reward counts only once they're all held.
      const quests = cards.filter((c) => c.ops.some((x) => x.after_quest)).flatMap((c) => questItems(c.id)).flatMap((id) => sold.find((i) => i.id % 10000 === id)?.id ?? []);
      // The owner's Tear-then-Manamune path is for his normal and AD builds; tank, AP and AP-health buttons stay free of it (strict rules).
      const plannedItem = ownedItems.some((id) => id % 10000 === MURAMANA) || (style !== undefined && style !== 'ad') ? undefined : manamune;
      const required = [...new Set([...cards.flatMap((c) => (c.need?.class === 'item' ? (c.need.items ?? []).slice(0, 1) : [])).flatMap((n) => sold.find((i) => i.enName === n)?.id ?? []), ...upgraded, ...quests])];
      const damageKind = kit?.damage === 'magic' ? 'ap' : kit?.damage === 'physical' ? 'ad' : 'mixed';
      const switched = cards.some((c) => switchesDamage([c.id]));
      // A held card that repeats on-hit effects (Dual Wield) opens on-hit items of the other damage kind: the owner's Teemo with Dual Wield builds BotRK and Terminus (2026-11-08).
      const onHitCard = cards.some((c) => c.ops.some((x) => x.op === 'on_hit_repeat'));
      const onHitItem = (id: number) => (ITEM_NUMBERS.find((x) => x.id === id % 10000)?.ops ?? []).some((x) => 'trigger' in x && x.trigger === 'on_hit');
      // A held card that adds damage to his attacks (Marksmage) makes a non-attacker fight with attacks too: the owner's Gragas with Marksmage, Lich Bane and Dusk and Dawn (2026-11-05).
      const fightKit = kitWithCards(fightKitOf(championId), cards);
      const passive = PASSIVE_NUMBERS.find((p) => p.id === championId)?.ops ?? [];
      const facts = await teamFacts(teams, shop);
      const place = teamPlace({ championId, bin, shop, kit: fightKit, passive, enemy: facts.enemy, allies: facts.allies, style });
      // Katarina and Garen carry no arType, read as mana, but a mana pool of 0.
      const resource = (championRecord(bin) as unknown as { primaryAbilityResource?: { arType?: number; arIsShown?: boolean; '{726ee5cd}'?: { baseValue?: number } } })?.primaryAbilityResource;
      const noMana = (resource?.arType ?? 0) !== 0 || !(resource?.['{726ee5cd}']?.baseValue ?? 0) || resource?.arIsShown === false; // Viego: a hidden pool of 10,000, not mana
      // The owner: a mana item first for mages only; tanks, enchanters and attackers (Kayle, Gwen, Teemo) keep their own first item.
      // Mages who also shield or heal allies count as mages, by the owner's word: Lux, Annie, Orianna, Seraphine, Morgana, Karma, Zilean.
      // A card that makes him attack (Marksmage) doesn't make a mage stop being one: he still starts with a mana item (rule 34, «بلا شرط»; 2026-11-09).
      const mage = !noMana && !fightKitOf(championId).attacks && (!fightKit.buffsAllies || MAGE_SUPPORTS.has(championId)) && !kit?.traits.includes('frontline');
      // Magic with health holds one item with neither AP nor attack damage besides boots; the rest is magic (two give Jak'Sho and Steelcaps, three Heartsteel and full tank).
      const pureTank = (i?: { id: number; group?: string; boots?: boolean }) => !!i && !i.boots && i.group !== 'boots' && itemDamage(i.id) !== 'ap';
      // The owner (2026-11-05, Gragas full tank): a frontline champion who doesn't guard allies and whose kit scales with no armor or magic resist
      // builds damage with health by his kit, one item with no damage besides boots at most; full tank is his tank button.
      // A held card that multiplies health (Tank Engine, Goliath, Growth Spurt) lifts that limit: Jayell's Renekton with Tank Engine built Heartsteel, Unending Despair, Bloodmail.
      const healthCard = cards.some((c) => c.ops.some((x) => (x.op === 'mult' || (x.op === 'per_stack' && x.mode === 'mult')) && x.stat === 'hp'));
      const fighter = !style && !healthCard && !!kit?.traits.includes('frontline') && !kit.traits.includes('peel') && !kit.scales.some((x) => x === 'armor' || x === 'mr');
      // Runaan's Hurricane is sold to ranged champions only: none of 75,278 melee players held it but Kayle and Gnar, who fight at range (2026-11-05).
      // A held card that makes him melee (Draw Your Sword) rules out ranged-only items too.
      const melee = cards.some((c) => c.ops.some((x) => x.op === 'melee')) || ((championRecord(bin) as { attackRangeModifiable?: { baseValue?: number } } | undefined)?.attackRangeModifiable?.baseValue ?? 0) < 300;
      // A magic champion who doesn't fight with attacks gets no attack-speed or on-hit item, nor Dusk and Dawn, unless a card makes his abilities apply on-hit
      // (the owner's no-attack-items rule, checked in scripts/checks/strict.mjs; Ethereal Weapon is the exception, 2026-11-06). Ardent Censer serves the ally he heals.
      const noAttacks = kit?.damage === 'magic' && !fightKit.attacks && style !== 'tank' && !cards.some((c) => c.ops.some((x) => x.op === 'abilities_on_hit'));
      const attackItem = (id: number) => id % 10000 === DUSK_AND_DAWN || (id % 10000 !== ARDENT_CENSER && (ITEM_MECHANICS.find((m) => m.id === id) ?? ITEM_MECHANICS.find((m) => m.id === id % 10000))?.gives.some((g) => g.stat === 'attack_speed') === true) || (ITEM_NUMBERS.find((x) => x.id === id % 10000)?.ops ?? []).some((x) => 'trigger' in x && x.trigger === 'on_hit'); // not 'attack': Heartsteel's proc is one
      // Heartsteel charges only standing near enemy champions: not for a ranged champion who doesn't stand in front (the owner, 2026-11-06: Sona doesn't start it; 0 of 993 of her players hold it).
      // Nor for one who can't keep bonus health (Pyke turns it into AD: the owner, 2026-11-06, «لا، خطأ»; 1% of his players hold it).
      const keepsNoHealth = (PASSIVE_NUMBERS.find((p) => p.id === championId)?.ops ?? []).some((x) => x.op === 'convert' && x.from === 'bonus_hp' && x.replace);
      const rangedOnly = (id: number) => id % 10000 === RUNAANS; // Statikk Shiv also carries a bolts op now, and melee champions build it
      const tankOnly = (i?: { id: number; group?: string; boots?: boolean }) => !!i && !i.boots && i.group !== 'boots' && itemDamage(i.id) === 'none';
      const skillPlan = await skillPlanFor(championId);
      const steps = itemsByMath({ bin, shop, level: progress?.level, knownRanks: knownRanksOf(progress), skillPlan, enemy: facts.enemy, place, offKind: (i, held) => (style === 'aphp' ? i.damage === 'ad' || (pureTank(i) && held.some((h) => pureTank(sold.find((x) => x.id === h)))) : style === 'tank' ? i.damage !== 'none' || hybrid(i.id) : style === 'ap' || style === 'ad' ? i.damage !== 'none' && i.damage !== style && !switched : (!switched && damageKind !== 'mixed' && i.damage !== 'none' && i.damage !== damageKind && !(onHitCard && onHitItem(i.id))) || (fighter && tankOnly(i) && held.some((h) => tankOnly(sold.find((x) => x.id === h))))) || (noMana && shop[i.id]?.DataValues?.some((d) => d.name === 'FlatMPPoolMod') === true) || (melee && rangedOnly(i.id)) || ((!melee && !kit?.traits.includes('frontline') || keepsNoHealth) && (shop[i.id]?.DataValues?.find((d) => d.name === 'DamageToMaxHealthRatio')?.values?.[0] ?? 0) > 0) || (noAttacks && attackItem(i.id)), kit: fightKit, cards, passive: PASSIVE_NUMBERS.find((p) => p.id === championId)?.ops ?? [], itemOps: ITEM_OPS, pool: sold.filter((i) => championId !== EZREAL || i.id % 10000 !== MURAMANA).map((i) => ({ id: i.id, gold: i.gold, boots: i.group === 'boots', damage: itemDamage(i.id) })), owned: ownedItems, required, plannedItem, noBoots: championId === CASSIOPEIA, requiredAnyOf, manaFirst: mage && (style === 'ap' || (!style && damageKind === 'ap')) /* a card that switches damage (ADAPt) keeps the rule: the owner, 2026-11-08, Brand «لازم ايتم مانا في البدايه» */, stacks,
        // "Without this augment" is a whole context: his kit and team place made again from the other cards, as for the build itself.
        contextFor: (others) => { const k = kitWithCards(fightKitOf(championId), others); return { kit: k, place: teamPlace({ championId, bin, shop, kit: k, passive, enemy: facts.enemy, allies: facts.allies, style }) }; } });
      const explanation = explainBuild({ bin, shop, kit: fightKitOf(championId), cards, passive, itemOps: ITEM_OPS, items: steps.map((s) => s.id), level: Math.max(15, stage.level), enemy: facts.enemy, stacks, knownRanks: knownRanksOf(progress), skillPlan, incomingDps: place.share * place.enemyDps * (place.draw ?? 1) });
      const missing = [...new Set([
        ...explanation.missing,
        ...augmentIds.flatMap((id) => {
          const read = cardsOf(all.augments, [id])[0];
          return !read?.ops.length ? [`التعزيز ${id}: لا يملك معادلات؛ أثره وروابطه غير محسوبة`] : read.status !== 'computed' ? [`${read.name}: التمثيل جزئي أو مشروط`] : [];
        }),
        ...rankNote(progress, skillPlan),
        ...(stage.estimatedHistory && augmentIds.length ? ['مستويات اقتناء التعزيزات غير المسجلة مقدّرة'] : []),
        ...(progress?.historySource === 'player-confirmed' ? ['ترتيب الاختيارات ومستوياتها حسب تأكيدك أن سجلك كامل، لا من اللعبة'] : progress?.historySource === 'recorded-at-mark' && augmentIds.length ? ['مستويات الاختيارات هي مستواك عند الضغط على «اخترته»؛ ترتيبها غير مؤكد'] : []),
        ...(cards.some((c) => c.ops.some((x) => x.op === 'per_stack')) ? ['تكديس التعزيزات مقدّر منذ الاختيار، وزيادته خلال القتال الحالي غير محسوبة'] : []),
        ...(explanation.total.healingDenied > 0 ? ['وصول مضاد العلاج إلى مصادر الشفاء ومدة تطبيقه مقدّران'] : []),
        ...(stage.level > FIGHT_READ_LEVEL ? ['فوق المستوى 18 (حد Superfans 21): نمو البطل وأرقام القتال بعد 18 غير مقروءة؛ الحساب تقديري وناقص'] : []),
      ])];
      const partName = (kind: 'item' | 'augment', id: number) => kind === 'item' ? sold.find((i) => i.id === id)?.enName ?? String(id) : cards.find((c) => c.id === id)?.name ?? String(id);
      const signed = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(100 * x)}%`;
      return steps.flatMap((s) => { const item = sold.find((i) => i.id === s.id); return item ? [{ item, missing, why: [...(s.reason === 'owned' ? ['owned'] : [s.id === manamune ? 'أكمل Manamune بعد اكتمال تراكمات Tear of the Goddess' : s.reason === 'required' ? 'تطلبه بطاقتك' : s.reason === 'mana' ? 'غرض مانا أولاً: المانا تنفد بسرعة بدونه' : s.reason === 'stacks' ? 'يكبر بالتراكمات: يُشترى أولاً ليجمعها طوال اللعبة' : s.reason === 'augment' ? 'تعزيز مكتسب يجعله الأفضل الآن: يُشترى قبل أغراض التراكمات' : s.reason === 'boots' ? 'حذاء: سرعة الحركة لا تدخل في حساب القتال' : '', `ضرر ${signed(s.damage)}، تحمّل ${signed(s.health)}`].filter(Boolean)), ...itemExplanationWords(explanation, s.id, partName)] }] : []; });
    })();
    builds.set(key, work);
    work.catch(() => builds.delete(key));
    return work;
  }

  /** One purchase decision at an explicit point: his level and the items he holds then, and the augments known before it.
   * Known: picked at a lower level, or at the same level and listed in `pickedBefore` (an explicit order of events). A pick with no level, or one at
   * the same level with no order, isn't known either way: it is left out, listed in `unsure`, and the decision isn't settled (`settled` false).
   * The items held stay first in the build (mathBuild's owned). Nothing about later picks reaches it. */
  async function decisionAt(championId: number, picks: { id: number; level?: number }[], point: { level: number; owned: number[]; pickedBefore?: number[] }, teams?: Teams, style?: BuildStyle, history?: { complete: boolean; order?: number[] }) {
    const known = picks.filter((p) => p.level !== undefined && (p.level < point.level || (p.level === point.level && !!point.pickedBefore?.includes(p.id))));
    const unsure = picks.filter((p) => p.level === undefined || (p.level === point.level && !point.pickedBefore?.includes(p.id))).map((p) => p.id);
    const notes = [
      ...(picks.some((p) => p.level === undefined) ? ['مستوى اكتساب بعض التعزيزات مجهول: لم تُحسب في هذا القرار، فالقرار غير محسوم'] : []),
      ...(picks.some((p) => p.level === point.level && !point.pickedBefore?.includes(p.id)) ? [`المستوى ${point.level}: لا ترتيب معلوم بين اختيار التعزيز والشراء، فلم يُحسب التعزيز`] : []),
    ];
    // The picks left out of this decision still count for the order: one taken at this level with no order of events might be before Soul Eater.
    const others = Object.fromEntries(picks.filter((p) => !known.includes(p)).map((p) => [p.id, p.level ?? null]));
    const progress = { level: point.level, acquiredLevels: Object.fromEntries(known.map((p) => [p.id, p.level!])), unknownPicks: picks.some((p) => p.level === undefined), otherPicks: others, ...(history?.complete ? { historyComplete: true } : {}), ...(history?.order ? { pickOrder: history.order } : {}) };
    const build = await mathBuild(championId, known.map((p) => p.id), point.owned, teams, style, undefined, progress);
    return { settled: unsure.length === 0, known: known.map((p) => p.id), unsure, notes, build, next: build.find((r) => !point.owned.includes(r.item.id)) };
  }

  /** An estimate, not a match record: the purchases after `from`, one decision each (decisionAt), at levels guessed from the item count
   * (itemMath LEVEL_BY_ITEMS) and never below the level he is at. The first step is at his own level; the later ones are marked estimated.
   * For the owner's question "Skilled Sniper first or last": a scenario of pick levels, written as such by whoever calls it. */
  async function projectBuild(championId: number, picks: { id: number; level?: number }[], from: { level: number; owned: number[]; pickedBefore?: number[] }, teams?: Teams, style?: BuildStyle, history?: { complete: boolean; order?: number[] }) {
    const held = [...from.owned];
    const steps: { level: number; estimated: boolean; settled: boolean; known: number[]; item: Awaited<ReturnType<typeof mathBuild>>[number]['item']; why: string[] }[] = [];
    const notes = new Set<string>(['إسقاط تقديري: مستويات الشراء بعد الأولى مقدّرة من عدد الأغراض، لا من سجل مباراة']);
    let level = from.level;
    // What was settled before the start stays settled after it: picks confirmed then, at levels up to his own. A pick from a later level never
    // counts as confirmed, and one never confirmed stays unsettled while the level is the same.
    const confirmed = (from.pickedBefore ?? []).filter((id) => picks.some((p) => p.id === id && p.level !== undefined && p.level <= from.level));
    while (held.length < SLOTS) {
      const first = steps.length === 0;
      if (!first) level = Math.max(level, LEVEL_BY_ITEMS[Math.min(held.length, 6)]!);
      const d = await decisionAt(championId, picks, { level, owned: held, pickedBefore: confirmed }, teams, style, history);
      for (const n of d.notes) notes.add(n);
      if (!d.next) break;
      steps.push({ level, estimated: !first, settled: d.settled, known: d.known, item: d.next.item, why: d.next.why });
      held.push(d.next.item.id);
    }
    return { estimate: true as const, notes: [...notes], steps };
  }

  /** A second build the tests can't vouch for (src/app/experimentalBuild.ts); null when there's none worth showing. */
  async function experimentalBuild(championId: number, augmentIds: number[]): Promise<ExperimentalBuild | null> {
    const entry = (await champions()).find((c) => c.id === championId);
    if (!entry || !augmentIds.length) return null;
    const [all, list, games, main] = await Promise.all([augments(), items('mayhem'), storedGames(), engineBuild(championId, augmentIds)]);
    const shop = list.list.filter((i) => i.group === 'legendary' || i.group === 'boots');
    const ids = augmentIds.map((id) => all.augments.find((a) => a.id === id)?.ids ?? [id]);
    const mainIds = main.map((b) => b.item.id);
    const recipe = recipeFor(entry.enName, ids);
    const fromRecipe = recipe?.items.flatMap((n) => shop.find((i) => i.enName === n) ?? []) ?? [];
    if (recipe && worthShowing(fromRecipe.map((i) => i.id), mainIds)) return { items: fromRecipe, source: 'creator', channel: recipe.channel, patch: RECIPES_PATCH };
    const shifted = shiftedBuild(games.flatMap((g) => g.players), championId, ids.flat(), new Map(shop.map((i) => [i.id, { boots: i.group === 'boots' }])));
    if (!worthShowing(shifted, mainIds)) return null;
    return { items: shifted.flatMap((id) => shop.find((i) => i.id === id) ?? []), source: 'players' };
  }

  /** ARAMKit's numbers for a champion; null when they can't be had, and the app goes on without them. */
  const champKit = (id: number): Promise<KitStats | null> => kitStats(id, { cacheDir, fetchImpl }).then((r) => r.data, () => null);

  /** Each champion's distance from an even win rate in the outside data, averaged over the sources; our model where they have none. */
  async function championStrengths(ids: number[]): Promise<{ id: number; points: number }[]> {
    // On held-out games the two rates together rank winners at AUC 0.713, against 0.708 and 0.712 apart.
    const [open, m, kits] = await Promise.all([openStats({ cacheDir, fetchImpl }).catch(() => null), teamModel(), Promise.all(ids.map(champKit))]);
    return ids.map((id, i) => {
      const kit = kits[i];
      const known = [open && heroEdge(open.data, id), kit && 100 * kit.winRate - 50].filter((x): x is number => typeof x === 'number');
      return { id, points: known.length ? known.reduce((t, x) => t + x, 0) / known.length : 25 * strength(m.fit, id, []) };
    });
  }

  /** What each Mayhem augment adds to this champion in the outside data, averaged over the sources; empty when none can be had. */
  async function openAugments(championId: number): Promise<{ id: number; points: number; link?: number; win?: number; games?: number }[]> {
    const [open, kit] = await Promise.all([openStats({ cacheDir, fetchImpl }).catch(() => null), champKit(championId)]);
    if (!open && !kit) return [];
    const kitById = new Map(kit?.augments.map((a) => [a.id, a]));
    return (await augments()).augments.flatMap((a) => {
      // An augment's copies (Arena's id) are listed apart: take the one with the most games.
      const hex = open ? a.ids.flatMap((id) => augmentLift(open.data, championId, id) ?? []).sort((x, y) => y.games - x.games)[0] : undefined;
      const row = kit ? a.ids.flatMap((id) => kitById.get(id) ?? []).sort((x, y) => y.games - x.games)[0] : undefined;
      const known = [hex?.points, row && kit && liftPoints(row.games * row.winRate, row.games, kit.winRate)].filter((x): x is number => x !== undefined);
      // The copy with the most games, as above: a share taken across copies would count one augment twice.
      const link = open ? a.ids.flatMap((id) => { const l = augmentLink(open.data, championId, id); return l === null ? [] : [{ l, games: open.data.augments[String(championId)]?.[String(id)]?.games ?? 0 }]; }).sort((x, y) => y.games - x.games)[0]?.l : undefined;
      // The Chinese server's own win rate for this champion with it, shown beside the letter (the owner, 2026-11-05: the best augment by percent for each champion).
      const raw = open ? a.ids.flatMap((id) => open.data.augments[String(championId)]?.[String(id)] ?? []).sort((x, y) => y.games - x.games)[0] : undefined;
      return known.length ? [{ id: a.id, points: known.reduce((t, x) => t + x, 0) / known.length, ...(link === undefined ? {} : { link }), ...(raw ? { win: raw.wins / raw.games, games: raw.games } : {}) }] : [];
    });
  }

  async function teamSummary(mine: number[], enemy: number[]): Promise<TeamSummary> {
    const m = await teamModel();
    const sum = (ids: number[]) => ids.reduce((t, id) => t + strength(m.fit, id, []), 0);
    const magic = (ids: number[]) => ids.reduce((t, id) => { const d = CHAMPION_KITS.find((k) => k.id === id)?.damage; return t + (d === 'magic' ? 1 : d === 'mixed' ? 0.5 : 0); }, 0);
    // 0.15 on the team log-odds is about 4 points of win chance: under that the champions alone do not split the teams.
    const diff = sum(mine) - sum(enemy);
    return { side: diff > 0.15 ? 'stronger' : diff < -0.15 ? 'weaker' : 'even', magic: { mine: magic(mine), enemy: magic(enemy) } };
  }

  return { augments, champions, championPage, items, tierList, suggestions, profilePage, overlayData, aiBuild, mayhemFile, augmentFit, augmentEffect, engineBuild, mathBuild, decisionAt, projectBuild, stackBase, buildStyles, cardValues, experimentalBuild, championStrengths, openAugments, teamSummary, warm };
}
