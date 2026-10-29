// arammayhem.com: a champion's best Mayhem augments, with a tier per augment and how often players take it.
// Its lists agree with real Mayhem games better than OP.GG's. The page is plain server-rendered HTML (robots.txt
// allows all); the augments are matched to the game's by English name.

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

export function siteAugments(alias: string, opts: { cacheDir: string; fetchImpl: typeof fetch; now?: () => number }): Promise<Cached<SiteAugment[]>> {
  const now = opts.now ?? Date.now;
  const slug = siteSlug(alias);
  return diskCache(
    join(opts.cacheDir, 'arammayhem', `${slug}.json`),
    (e) => now() - e.fetchedAt < TWELVE_HOURS, // the site updates its numbers about once a day
    async () => {
      const res = await opts.fetchImpl(`${BASE}/${slug}/`);
      if (!res.ok) throw new Error(`arammayhem.com ${slug}: HTTP ${res.status}`);
      const list = parseBestAugments(await res.text());
      if (!list.length) throw new Error(`arammayhem.com ${slug}: no augments on the page`); // the page changed: keep the old copy
      return list;
    },
    { now },
  );
}
