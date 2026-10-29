// Mayhem: the build after the player's chosen augments. No stats site has "build given augment", so this is a
// rule from the game texts, not a statistic: the champion's real build is the base, and items whose stats match
// what the augments scale with move up ("Upgrade X" augments put X first). Every move carries its reason.

import type { NamedText } from '../texts/champions.js';
import type { ChampionPage } from './championPage.js';

export type Focus = 'ap' | 'ad' | 'as' | 'crit' | 'tank' | 'haste' | 'heal' | 'mana';

export const FOCUS_LABEL: Record<Focus, string> = {
  ap: 'قوة القدرة', ad: 'ضرر الهجوم', as: 'سرعة الهجوم', crit: 'الضربة الحرجة', tank: 'الصلابة', haste: 'تسارع القدرة', heal: 'العلاج والدروع', mana: 'المانا',
};

// The game's stat icons and colour tags, as cleanText writes them (s-scaleap class, …/statsicon/scaleap.png).
const ICON_FOCUS: Record<string, Focus> = {
  scaleap: 'ap', scalempen: 'ap', scalead: 'ad', scaleapen: 'ad', scaleas: 'as', scalecrit: 'crit', scalecritmult: 'crit',
  scalehealth: 'tank', scalearmor: 'tank', scalemr: 'tank', scaleah: 'haste', scalemana: 'mana', scalemanaregen: 'mana',
  scalehealshield: 'heal', scalels: 'heal', scalesv: 'heal',
};

/** How strongly a text points at each stat: one count per stat icon or colour tag in it. */
export function focusOf(html: string): Map<Focus, number> {
  const out = new Map<Focus, number>();
  for (const m of html.matchAll(/(?:s-|statsicon\/)(scale\w+?)(?:\.png|["\s])/gi)) {
    const f = ICON_FOCUS[m[1].toLowerCase()];
    if (f) out.set(f, (out.get(f) ?? 0) + 1);
  }
  return out;
}

export interface AdaptedItem {
  item: NamedText;
  /** Why it is here: from the base build, or which augment moved it up. */
  reasons: string[];
}

export interface AdaptedBuild {
  /** Boots first when the build has them, then five items, best first. */
  items: AdaptedItem[];
  /** What the chosen augments push towards, strongest first. */
  focus: Focus[];
}

/**
 * The page's build, re-ranked for the chosen augments. `pool` is every finished item on the map; `picked` the
 * augments the player marked (name for the reasons, html for their stats).
 */
export function adaptBuild(page: ChampionPage, picked: { name: string; enName: string; html: string }[], pool: NamedText[]): AdaptedBuild {
  const score = new Map<number, { item: NamedText; score: number; reasons: string[] }>();
  const add = (item: NamedText, points: number, reason?: string) => {
    const e = score.get(item.id) ?? { item, score: 0, reasons: [] };
    e.score += points;
    if (reason && !e.reasons.includes(reason)) e.reasons.push(reason);
    score.set(item.id, e);
  };

  // The champion's own build is the base: core in order, then the 4th–6th item choices by their listed order.
  page.core?.items.forEach((it, i) => add(it, 6 - i, 'من البناء الأساسي'));
  [page.fourth, page.fifth, page.sixth].forEach((choices, slot) =>
    choices.forEach((c, i) => c.items.forEach((it) => add(it, Math.max(0.5, 2.5 - slot * 0.5 - i * 0.4), 'من خيارات البناء'))),
  );

  // What the augments scale with, summed over all of them.
  const focus = new Map<Focus, number>();
  for (const a of picked) for (const [f, n] of focusOf(a.html)) focus.set(f, (focus.get(f) ?? 0) + n);
  const top = [...focus.entries()].sort((x, y) => y[1] - x[1]).map(([f]) => f);

  for (const item of pool) {
    const itemFocus = focusOf(item.html);
    let points = 0;
    let because: string | undefined;
    for (const [f, n] of focus) {
      if (!itemFocus.has(f)) continue;
      points += Math.min(n, 3) * 1.2; // capped: a wordy augment should not outweigh the champion's build
      because ??= picked.find((a) => focusOf(a.html).has(f))?.name;
    }
    if (points > 0) add(item, points, because && `يناسب ${because}`);
  }

  // "Upgrade X": the augment improves item X, so X comes first.
  for (const a of picked) {
    const target = /^Upgrade\s+(.+)$/i.exec(a.enName)?.[1]?.toLowerCase(); // the English name: "Upgrade Thornmail"
    const item = target && pool.find((it) => it.enName.toLowerCase() === target);
    if (item) add(item, 50, `${a.name} يطوّره`);
  }

  const ranked = [...score.values()].sort((x, y) => y.score - x.score);
  const boots = page.boots?.items[0];
  const items = ranked.filter((e) => e.item.id !== boots?.id).slice(0, 5).map((e) => ({ item: e.item, reasons: e.reasons }));
  return { items: boots ? [{ item: boots, reasons: ['حذاء البناء'] }, ...items] : items, focus: top };
}
