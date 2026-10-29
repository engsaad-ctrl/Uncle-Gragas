import type { ChampionBuild, Counter, Fetched, MayhemAugmentStat, Pick, Position } from '../stats/opgg.js';
import { assetUrl } from '../texts/assets.js';
import type { AugmentText } from '../texts/augments.js';
import type { ChampionDetail, ChampionListEntry, NamedText, StyleSlot, StyleTree } from '../texts/champions.js';
import type { ItemText } from '../texts/items.js';
import type { RuneText } from '../texts/runes.js';

export type PageMode = 'ranked' | 'flex' | 'aram' | 'mayhem' | 'arena' | 'urf' | 'nexus';

export interface ItemChoice {
  items: NamedText[];
  games: number;
  winRate: number;
}

export interface RuneOption extends NamedText {
  selected: boolean;
}

export interface RuneRow {
  label: string;
  keystone: boolean;
  options: RuneOption[];
}

/** One rune tree as the client shows it, with the build's choices marked. */
export interface RuneTree {
  style: NamedText;
  rows: RuneRow[];
}

/** A lane opponent, with the page champion's win rate against it. */
export interface Matchup {
  champion: ChampionListEntry;
  winRate: number;
  games: number;
}

export interface RatedAugment extends AugmentText {
  /** Place in the stats site's own recommendation for this champion (1 = best): its tier, then its order. */
  rank: number;
  /** The site's score. Its direction is unclear (the most picked augments score lowest), so it does not rank. */
  performance: number;
  /** Share of this champion's games that took it (0.18 = 18%). */
  popularity: number;
  /** "S+" to "C" when the ranking comes from arammayhem.com. */
  tierLabel?: string;
}

export interface ChampionPage {
  champion: ChampionDetail;
  mode: PageMode;
  position: Position | null;
  buildError: string | null;
  stats: { games: number; winRate: number; pickRate: number; banRate: number | null } | null;
  skillOrder: string[];
  skillPriority: string[];
  spells: NamedText[];
  starter: ItemChoice | null;
  core: ItemChoice | null;
  boots: ItemChoice | null;
  fourth: ItemChoice[];
  fifth: ItemChoice[];
  sixth: ItemChoice[];
  runes: { primary: RuneTree | null; sub: RuneTree | null; shards: RuneRow[]; games: number; winRate: number } | null;
  augments: RatedAugment[];
  /** Opponents it beats most, and those that beat it most. */
  matchups: { strong: Matchup[]; weak: Matchup[] };
  fetchedAt: number | null;
  stale: boolean;
}

export interface PageSources {
  champion: ChampionDetail;
  mode: PageMode;
  position: Position | null;
  /** null: no build for this mode (Arena, URF, Nexus Blitz). */
  build: Fetched<ChampionBuild> | Error | null;
  mayhem: Fetched<MayhemAugmentStat[]> | null;
  augments: AugmentText[];
  items: Map<number, ItemText>;
  runes: Map<number, RuneText>;
  styles: Map<number, StyleTree>;
  spells: Map<number, NamedText>;
  championList: ChampionListEntry[];
}

const fromItem = (t: ItemText): NamedText => ({ id: t.id, name: t.name, enName: t.enName, html: t.html, iconUrl: assetUrl(t.iconPath) });
const fromRune = (t: RuneText): NamedText => ({ id: t.id, name: t.name, enName: t.enName, html: t.html, iconUrl: assetUrl(t.iconPath) });

/** Ids that the text data does not know are skipped (spec 5.2: unknown ids are not shown). */
function resolve<T>(ids: number[], map: Map<number, T>, to: (t: T) => NamedText): NamedText[] {
  return ids.flatMap((id) => {
    const t = map.get(id);
    return t ? [to(t)] : [];
  });
}

function runeRow(slot: StyleSlot, runes: Map<number, RuneText>, isSelected: (id: number) => boolean): RuneRow {
  return {
    label: slot.label,
    keystone: slot.type === 'kKeyStone',
    options: slot.perks.flatMap((id) => {
      const t = runes.get(id);
      return t ? [{ ...fromRune(t), selected: isSelected(id) }] : [];
    }),
  };
}

function composeRunes(r: NonNullable<ChampionBuild['runes']>, styles: Map<number, StyleTree>, runes: Map<number, RuneText>) {
  const chosen = new Set(r.perks);
  const tree = (styleId: number, withKeystone: boolean): RuneTree | null => {
    const s = styles.get(styleId);
    if (!s) return null;
    const { slots, ...style } = s;
    return {
      style,
      rows: slots
        .filter((sl) => sl.type !== 'kStatMod' && (withKeystone || sl.type !== 'kKeyStone'))
        .map((sl) => runeRow(sl, runes, (id) => chosen.has(id))),
    };
  };
  // Shard rows can repeat an id (adaptive force sits in two rows), so match by row index.
  const shardSlots = styles.get(r.primaryStyle)?.slots.filter((sl) => sl.type === 'kStatMod') ?? [];
  return {
    primary: tree(r.primaryStyle, true),
    sub: tree(r.subStyle, false),
    shards: shardSlots.map((sl, i) => runeRow(sl, runes, (id) => r.statMods[i] === id)),
    games: r.games,
    winRate: r.winRate,
  };
}

// Builds cached before counters were read have none (undefined): show nothing for them.
const matchups = (list: Counter[] | undefined, champions: ChampionListEntry[]): Matchup[] =>
  (list ?? []).flatMap((c) => {
    const champion = champions.find((x) => x.id === c.id);
    return champion ? [{ champion, winRate: c.winRate, games: c.games }] : [];
  });

export function composeChampionPage(src: PageSources): ChampionPage {
  const build = src.build && !(src.build instanceof Error) ? src.build.data : null;
  const choice = (p: Pick | null): ItemChoice | null =>
    p ? { items: resolve(p.ids, src.items, fromItem), games: p.games, winRate: p.winRate } : null;
  const choices = (ps: Pick[]) => ps.map(choice).filter((c): c is ItemChoice => c !== null && c.items.length > 0);

  // Popularity 0 means no real sample: OP.GG then reports placeholder performance (0 or 170), so leave those out.
  // OP.GG lists a champion's augments in its own recommended order (tier, then pick rate): keep that order.
  const stats = new Map((src.mayhem?.data ?? []).filter((s) => s.popularity > 0).map((s, i) => [s.id, { ...s, rank: i + 1 }]));
  const augments = src.augments
    .flatMap((a) => {
      const s = a.ids.map((id) => stats.get(id)).find((x) => x !== undefined);
      return s ? [{ ...a, rank: s.rank, performance: s.performance, popularity: s.popularity, ...(s.tierLabel ? { tierLabel: s.tierLabel } : {}) }] : [];
    })
    .sort((x, y) => x.rank - y.rank)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const fetched: { fetchedAt: number; stale: boolean }[] = [];
  if (src.build && !(src.build instanceof Error)) fetched.push(src.build);
  if (src.mayhem) fetched.push(src.mayhem);
  return {
    champion: src.champion,
    mode: src.mode,
    position: src.position,
    buildError: src.build instanceof Error ? src.build.message : null,
    stats: build ? { games: build.games, winRate: build.winRate, pickRate: build.pickRate, banRate: build.banRate } : null,
    skillOrder: build?.skillOrder ?? [],
    skillPriority: build?.skillPriority ?? [],
    spells: build?.spells ? resolve(build.spells.ids, src.spells, (s) => s) : [],
    starter: choice(build?.starter ?? null),
    core: choice(build?.core ?? null),
    boots: choice(build?.boots ?? null),
    fourth: choices(build?.fourth ?? []),
    fifth: choices(build?.fifth ?? []),
    sixth: choices(build?.sixth ?? []),
    runes: build?.runes ? composeRunes(build.runes, src.styles, src.runes) : null,
    augments,
    matchups: { strong: matchups(build?.strongAgainst, src.championList), weak: matchups(build?.weakAgainst, src.championList) },
    fetchedAt: fetched.length ? Math.min(...fetched.map((f) => f.fetchedAt)) : null,
    stale: fetched.some((f) => f.stale),
  };
}
