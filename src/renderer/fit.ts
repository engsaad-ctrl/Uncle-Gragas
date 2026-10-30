// How well an augment suits the champion's kit, in Arabic, for the champion page and F7. A small score: the strict test
// found it points the right way (low-fit players won 33-48%, high-fit 51%) but adds too little to the team model, so it
// only explains and breaks near ties (FIT_POINTS), never orders on its own.

import { championFit } from '../ai/mechanics.js';
import { CHAMPION_KITS } from '../ai/championKits.js';
import { AUGMENT_MECHANICS } from '../ai/mechanicsData.js';

/** What one point of fit is worth next to an augment's effect (win-chance points): enough to settle a near tie. */
export const FIT_POINTS = 0.3;

const RELIES_AR: Record<string, string> = {
  attacks: 'الضربات', abilities: 'القدرات', ult: 'القدرة الخارقة', crit: 'الضربات الحرجة', on_hit: 'تأثيرات الضربة',
  healing: 'العلاج', shielding: 'الدروع', damage_over_time: 'الضرر المستمر', crowd_control: 'التحكم', takedowns: 'الإطاحات',
  low_health: 'الصحة المنخفضة', movement: 'الحركة', dashes: 'الاندفاع', allies: 'الحلفاء', summoner_spells: 'تعاويذ المستدعي',
  gold: 'الذهب', level: 'المستوى',
};
const STAT_AR: Record<string, string> = {
  ap: 'قوة القدرة', ad: 'ضرر الهجوم', bonus_ad: 'ضرر الهجوم الإضافي', health: 'الصحة', bonus_health: 'الصحة الإضافية',
  attack_speed: 'سرعة الهجوم', crit: 'الضربة الحرجة', armor: 'الدرع', mr: 'مقاومة السحر', mana: 'المانا',
  ability_haste: 'تسارع القدرات', move_speed: 'سرعة الحركة',
};

/** Fit of one augment (any of its ids) to a champion, with one Arabic line per reason; null without data for either. */
export function fitOf(championId: number | undefined, augmentIds: number[]): { score: number; reasons: string[] } | null {
  const kit = CHAMPION_KITS.find((k) => k.id === championId);
  const aug = AUGMENT_MECHANICS.find((m) => augmentIds.includes(m.id));
  if (!kit || !aug) return null;
  const { score, reasons } = championFit(kit, aug);
  return {
    score,
    reasons: reasons.map((r) => {
      if (r === '-damage side') return 'من نوع ضرر مخالف لضرر البطل';
      const word = r.slice(1);
      if (r.startsWith('-')) return `يعتمد على ${RELIES_AR[word] ?? word}، والبطل لا يعتمد عليها`;
      if (RELIES_AR[word]) return `يعتمد على ${RELIES_AR[word]} مثل البطل`;
      return `يزيد مع ${word.split('/').map((s) => STAT_AR[s] ?? s).join(' و')} مثل البطل`;
    }),
  };
}

// The site's tier joins our effect at 70/30 on one scale: each divided by its spread over the training players (0.068
// log-odds, 0.93 tier steps), which comes to this many win-chance points per step. Tested on 1,057 held-out games: ranking
// AUC 0.647, against 0.633 for our model alone and 0.610 for the site's tiers alone. The gain over the site is proven
// (95% range 0.016 to 0.056 for the same blend at 50/50); the gain over our model alone is within the noise.
const SITE_POINTS = 0.78;
const SITE_TIER: Record<string, number> = { 'S+': 3, S: 2.5, 'S-': 2, 'A+': 1.5, A: 1, 'A-': 0.5, 'B+': 0, B: -0.5, 'B-': -1, C: -1.5, D: -2 };
/** What the site's tier for this champion adds to an augment's score; nothing for an augment the site doesn't list. */
export const siteBonus = (tier: string | undefined) => SITE_POINTS * (SITE_TIER[tier ?? ''] ?? 0);

/** A letter from a place in the ranking (0 = best): the top tenth S, the next quarter A, the next 40% B, the rest C. */
export function gradeOf(place: number, count: number): 'S' | 'A' | 'B' | 'C' {
  const at = (place + 0.5) / count;
  return at <= 0.1 ? 'S' : at <= 0.35 ? 'A' : at <= 0.75 ? 'B' : 'C';
}

/** Letters for a list, each augment against the others of its rarity: the choice the game offers. Same in F7 and on the champion page. */
export function gradesFor<T extends { id: number; rarity: string }>(augments: T[], score: (a: T) => number): Map<number, string> {
  const out = new Map<number, string>();
  for (const rarity of new Set(augments.map((a) => a.rarity))) {
    const ranked = augments.filter((a) => a.rarity === rarity).sort((x, y) => score(y) - score(x));
    ranked.forEach((a, i) => out.set(a.id, gradeOf(i, ranked.length)));
  }
  return out;
}

// shortcut: right after a new patch few games are stored and most augments have no effect yet, so nothing is hidden
// below this many; a better rule needs the number of games on the patch.
const ENOUGH_EFFECTS = 150;

/** Without the augments no stored game of this patch took: the game's files still list many that aren't in the mode. */
export function playedOnly<T extends { id: number }>(augments: T[], effects: Map<number, unknown>, keep: Set<number> = new Set()): T[] {
  return effects.size < ENOUGH_EFFECTS ? augments : augments.filter((a) => effects.has(a.id) || keep.has(a.id));
}
