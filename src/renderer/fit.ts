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

/** A letter from a place in the ranking (0 = best): the top tenth S, the next quarter A, the next 40% B, the rest C. */
export function gradeOf(place: number, count: number): 'S' | 'A' | 'B' | 'C' {
  const at = (place + 0.5) / count;
  return at <= 0.1 ? 'S' : at <= 0.35 ? 'A' : at <= 0.75 ? 'B' : 'C';
}
