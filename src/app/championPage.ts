import type { ChampionBuild, Fetched, MayhemAugmentStat, Pick, Position } from '../stats/opgg.js';
import { assetUrl } from '../texts/assets.js';
import type { AugmentText } from '../texts/augments.js';
import type { ChampionDetail, NamedText } from '../texts/champions.js';
import type { ItemText } from '../texts/items.js';
import type { RuneText } from '../texts/runes.js';

export type PageMode = 'ranked' | 'aram' | 'mayhem';

export interface ItemChoice {
  items: NamedText[];
  games: number;
  winRate: number;
}

export interface RatedAugment extends AugmentText {
  performance: number;
  popularity: number;
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
  runes: { primary: NamedText | null; sub: NamedText | null; perks: NamedText[]; statMods: NamedText[]; games: number; winRate: number } | null;
  augments: RatedAugment[];
  fetchedAt: number | null;
  stale: boolean;
}

export interface PageSources {
  champion: ChampionDetail;
  mode: PageMode;
  position: Position | null;
  build: Fetched<ChampionBuild> | Error;
  mayhem: Fetched<MayhemAugmentStat[]> | null;
  augments: AugmentText[];
  items: Map<number, ItemText>;
  runes: Map<number, RuneText>;
  styles: Map<number, NamedText>;
  spells: Map<number, NamedText>;
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

export function composeChampionPage(src: PageSources): ChampionPage {
  const build = src.build instanceof Error ? null : src.build.data;
  const choice = (p: Pick | null): ItemChoice | null =>
    p ? { items: resolve(p.ids, src.items, fromItem), games: p.games, winRate: p.winRate } : null;
  const choices = (ps: Pick[]) => ps.map(choice).filter((c): c is ItemChoice => c !== null && c.items.length > 0);

  // Popularity 0 means no real sample: OP.GG then reports placeholder performance (0 or 170), so leave those out.
  const stats = new Map((src.mayhem?.data ?? []).filter((s) => s.popularity > 0).map((s) => [s.id, s]));
  const augments = src.augments
    .flatMap((a) => {
      const s = a.ids.map((id) => stats.get(id)).find((x) => x !== undefined);
      return s ? [{ ...a, performance: s.performance, popularity: s.popularity }] : [];
    })
    .sort((x, y) => y.performance - x.performance);

  const fetched: { fetchedAt: number; stale: boolean }[] = [];
  if (!(src.build instanceof Error)) fetched.push(src.build);
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
    runes: build?.runes
      ? {
          primary: src.styles.get(build.runes.primaryStyle) ?? null,
          sub: src.styles.get(build.runes.subStyle) ?? null,
          perks: resolve(build.runes.perks, src.runes, fromRune),
          statMods: resolve(build.runes.statMods, src.runes, fromRune),
          games: build.runes.games,
          winRate: build.runes.winRate,
        }
      : null,
    augments,
    fetchedAt: fetched.length ? Math.min(...fetched.map((f) => f.fetchedAt)) : null,
    stale: fetched.some((f) => f.stale),
  };
}
