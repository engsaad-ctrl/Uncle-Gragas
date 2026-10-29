// arammayhem.com: a champion's best Mayhem augments, with a tier per augment and how often players take it, and its
// Mayhem build (skills, starting items, boots, core). Its lists agree with real Mayhem games better than OP.GG's, whose
// build is ARAM's. The page is plain server-rendered HTML (robots.txt allows all); augments and items are matched to
// the game's by English name.

import { join } from 'node:path';
import { diskCache, type Cached } from '../diskCache.js';

export interface SiteAugment {
  /** English name as the site writes it ("Weapon Of Destiny"). */
  name: string;
  /** Tier among this champion's augments, "S+" to "C". */
  tier: string;
  /** The site's place for it across every rarity (1 = best). */
  rank: number;
  /** Share of this champion's games that took it (0.1068 = 10.68%). */
  appearance: number;
}

const BASE = 'https://arammayhem.com/build';
const TWELVE_HOURS = 12 * 3600_000;

/** The site's address for a champion: its game alias in lower case (MonkeyKing, not Wukong; KSante, Nunu). */
export const siteSlug = (alias: string) => alias.toLowerCase().replace(/[^a-z0-9]/g, '');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// One card: name, "S- · #6" among its rarity, "Overall S- · #15", "Appearance rate: 10.68%".
const CARD =
  /title="([^"]+)"[\s\S]*?data-recommendation-rank="rarity"[^>]*>([^<]*)<[\s\S]*?data-recommendation-rank="overall"[^>]*>([^<]*)<[\s\S]*?Appearance rate:\s*<span[^>]*>([\d.]+)%/g;

/** The "Best Augments" section of a build page, best first (the site's overall place). */
export function parseBestAugments(html: string): SiteAugment[] {
  const start = html.indexOf('id="best-augments"');
  if (start < 0) return [];
  const section = html.slice(start, html.indexOf('</section>', start));
  const out: SiteAugment[] = [];
  for (const [, name, inRarity, overall, rate] of section.matchAll(CARD)) {
    const rank = Number(/#(\d+)/.exec(overall)?.[1]);
    if (!rank) continue;
    out.push({ name: decode(name).trim(), tier: inRarity.trim().split(/\s/)[0], rank, appearance: Number(rate) / 100 });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Items bought together (in order), with the share of the champion's games that did and how often they won. */
export interface SiteItems {
  names: string[];
  pickRate: number;
  winRate: number;
}

/** The champion's Mayhem build: what players of it buy and level, most picked first in each list. */
export interface SiteBuild {
  /** "Q>E>W" as ["Q", "E", "W"]. */
  skillPriority: string[];
  /** Level by level, 15 levels. */
  skillOrder: string[];
  starter: SiteItems[];
  boots: SiteItems[];
  core: SiteItems[];
  /** Single finished items bought besides the core. */
  others: SiteItems[];
}

const BLOCKS = { 'Starting Items': 'starter', Boots: 'boots', 'Core Builds': 'core', 'Other completed items': 'others' } as const;
// The page's text in order: block titles, item names, rates, skill paths.
const TOKEN =
  />\s*(Starting Items|Boots|Core Builds|Other completed items)\s*</g.source +
  /|title="([^"]+)"|Pick Rate\s*<span[^>]*>([\d.]+)%|Win Rate\s*<span[^>]*>([\d.]+)%|Skill Sequence:\s*([QWER](?: [QWER])+)|>([QWER](?:&gt;[QWER]){2,3})</
    .source;

/** The "Build" part of a page; null when it is not there. */
export function parseBuild(html: string): SiteBuild | null {
  const start = html.indexOf('id="mayhem-build"');
  if (start < 0) return null;
  const last = html.indexOf('Other completed items', start);
  const end = last < 0 ? html.length : (html.indexOf('<section', last) + 1 || html.length);
  const build: SiteBuild = { skillPriority: [], skillOrder: [], starter: [], boots: [], core: [], others: [] };
  let block: keyof typeof BLOCKS | null = null;
  let names: string[] = [];
  let pick: number | null = null;
  for (const [, title, name, pickRate, winRate, sequence, priority] of html.slice(start, end).matchAll(new RegExp(TOKEN, 'g'))) {
    if (title) (block = title as keyof typeof BLOCKS), (names = []);
    else if (priority && !build.skillPriority.length) build.skillPriority = priority.split('&gt;');
    else if (sequence && !build.skillOrder.length) build.skillOrder = sequence.split(' '); // the first path of the first priority: most picked
    else if (name && block) names.push(decode(name));
    else if (pickRate) pick = Number(pickRate) / 100;
    else if (winRate && block && names.length && pick !== null) {
      build[BLOCKS[block]].push({ names, pickRate: pick, winRate: Number(winRate) / 100 });
      names = [];
      pick = null;
    }
  }
  return build.core.length || build.boots.length ? build : null;
}

export interface SitePage {
  augments: SiteAugment[];
  build: SiteBuild | null;
}

export function sitePage(alias: string, opts: { cacheDir: string; fetchImpl: typeof fetch; now?: () => number }): Promise<Cached<SitePage>> {
  const now = opts.now ?? Date.now;
  const slug = siteSlug(alias);
  return diskCache(
    join(opts.cacheDir, 'arammayhem', `${slug}.page.json`),
    (e) => now() - e.fetchedAt < TWELVE_HOURS, // the site updates its numbers about once a day
    async () => {
      const res = await opts.fetchImpl(`${BASE}/${slug}/`);
      if (!res.ok) throw new Error(`arammayhem.com ${slug}: HTTP ${res.status}`);
      const html = await res.text();
      const augments = parseBestAugments(html);
      if (!augments.length) throw new Error(`arammayhem.com ${slug}: no augments on the page`); // the page changed: keep the old copy
      return { augments, build: parseBuild(html) };
    },
    { now },
  );
}
