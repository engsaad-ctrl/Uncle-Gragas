// Augments whose numbers come from the loaded patch's mode file (kiwi.bin), not from a copy in knowledge/: one reading that the offer, the plan,
// the build search, the build styles and the explanation all take through services' cardsOf. Patch 16.22 changed BEES!!! (damage 75-200 to 75-140,
// hive travel 0.75 s to 1.1 s); a copied number would have stayed on 16.21. When the file lacks a number the card gets no ops and says so.

import type { AugmentGameData } from '../texts/augments.js';
import { binHash, type SpellCalculation } from '../texts/spellValues.js';
import type { CardNumbers, DamageFormula } from './cardMath.js';

type Amount = number | { min: number; max: number };

const calcOf = (g: AugmentGameData, name: string): SpellCalculation | undefined => {
  const all = g.spell.mSpellCalculations ?? {};
  return all[name] ?? all[binHash(name)]; // some names are kept only as their hash (Calc_Cooldown is {4b11fb1c})
};
const valueOf = (g: AugmentGameData, name: string) => g.spell.DataValues?.find((d) => d.name === name)?.values?.[1];

/** One number or a line from level 1 to 18 (ByCharLevelInterpolation); anything else is not read. */
function amountOf(c: SpellCalculation | undefined): Amount | undefined {
  const parts = c?.mFormulaParts ?? [];
  if (parts.length !== 1 || c?.mMultiplier) return undefined;
  const p = parts[0]!;
  if (p.__type === 'NumberCalculationPart') return Number(p.mNumber ?? 0);
  if (p.__type === 'ByCharLevelInterpolationCalculationPart') return { min: Number(p.mStartValue ?? 0), max: Number(p.mEndValue ?? 0) };
  return undefined;
}

// mStat ids as spellValues' STAT_LABEL has them (0 AP, 2 AD, 12 health); mStatFormula 2 is the bonus part. Others are not read.
const STAT: Record<string, keyof DamageFormula> = { '0:0': 'ap', '2:0': 'ad', '2:2': 'bonus_ad', '12:0': 'hp', '12:2': 'bonus_hp' };

/** A damage calculation as a DamageFormula; undefined when it has a part this doesn't read, so nothing is half counted. */
export function damageOf(c: SpellCalculation | undefined): DamageFormula | undefined {
  if (!c?.mFormulaParts?.length || c.mMultiplier) return undefined;
  const f: DamageFormula = {};
  for (const p of c.mFormulaParts) {
    if ((p.__type === 'ByCharLevelInterpolationCalculationPart' || p.__type === 'NumberCalculationPart') && f.flat === undefined) f.flat = amountOf({ mFormulaParts: [p] });
    else if (p.__type === 'StatByCoefficientCalculationPart') {
      const key = STAT[`${p.mStat ?? 0}:${p.mStatFormula ?? 0}`];
      if (!key || f[key] !== undefined) return undefined;
      (f as Record<string, number>)[key] = Number(p.mCoefficient ?? 0);
    } else return undefined;
  }
  return f;
}

const BEES_LIMITS = [
  'يُحسب الهدف الرئيسي وحده؛ الأعداء الآخرون ضمن نصف قطر 425 غير محسوبين، كما في بقية القتال',
  'رحلة النحل من الخلية إلى الهدف تُعد صفرًا (أبعد هدف ضمن 425 بسرعة 1800: نحو 0.24ث)',
  'كل نبضة في نهاية نصف ثانية بعد الوصول (توقيت أول نبضة غير مثبت)، والضرر بقيم لحظة الإطلاق',
  'تأثيرات on-hit: ضررها وحده بنسبة الملف ومرة واحدة لكل خلية، وعدد مرات تطبيقها في اللعبة غير مثبت؛ التكديس والشفاء والمانا وspellblade وlife steal غير مطبقة',
  'الإبطاء 20% غير محسوب',
].join('؛ ');

function bees<C extends CardNumbers>(card: C, g: AugmentGameData | undefined): C {
  const missing: string[] = [];
  const need = <T>(name: string, v: T | undefined) => { if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) missing.push(name); return v; };
  const damage = need('Calc_Damage', g && damageOf(calcOf(g, 'Calc_Damage')));
  const cooldown = need('Calc_Cooldown', g && amountOf(calcOf(g, 'Calc_Cooldown')));
  const efficacy = need('Calc_OnHit_Efficacy', g && amountOf(calcOf(g, 'Calc_OnHit_Efficacy')));
  const duration = need('Damage_Duration', g && valueOf(g, 'Damage_Duration'));
  const ticksPerSecond = need('TicksPerSecond', g && valueOf(g, 'TicksPerSecond'));
  const delay = need('Hive_Missile mTravelTime', g?.missiles.find((m) => /_Hive_Missile$/i.test(m.script))?.travelTime);
  if (typeof efficacy === 'object') missing.push('Calc_OnHit_Efficacy رقم واحد');
  if (!g || missing.length || !damage || !cooldown || typeof efficacy !== 'number' || !duration || !ticksPerSecond || delay === undefined) {
    return { ...card, status: 'partial', ops: [], not_modelled: g ? `ملف الإصدار لا يحمل ${missing.join('، ')} بصيغة مقروءة؛ أثر BEES غير محسوب` : 'بيانات BEES من ملف الإصدار غير محمّلة؛ أثره غير محسوب' };
  }
  return { ...card, status: 'partial', ops: [{ op: 'delayed_dot', trigger: 'ability_hit', cooldown, delay, duration, ticksPerSecond, damage, type: 'magic', onHitEfficacy: efficacy }], not_modelled: BEES_LIMITS };
}

const ECHO_LIMITS = [
  'النسخة ضربة ثانية على الهدف نفسه بعد DelayTime وبنسبة CloneDamageRatio؛ النسخة تتحرك حتى 500 نحو المؤشر، فإصابتها الهدف تتوقف على توجيه اللاعب وغير مثبتة',
  'الضرر بقيم لحظة الإلقاء الأصلي؛ بلا مانا ولا تبريد إضافي (غير مثبت)',
  'النسخة لا تفعّل تأثيرات إصابة المهارة (BEES، أيتمات الإصابة، on-hit، spellblade) ولا شفاء المهارة: حد أدنى، وتفعيلها في اللعبة غير مثبت',
  'المهارات المتواصلة (toggle) لا تُنسخ، ولا الأعداء الآخرون في منطقة النسخة',
].join('؛ ');

/** Echo Cast (Ability_SelfAOE_DoubleCast): the chosen ability recast by a clone after DelayTime, at CloneDamageRatio. The target is the player's input, as for Bread. */
function echo<C extends CardNumbers>(card: C, g: AugmentGameData | undefined): C {
  const delay = g && valueOf(g, 'DelayTime'), ratio = g && valueOf(g, 'CloneDamageRatio');
  const missing = [...(delay === undefined ? ['DelayTime'] : []), ...(ratio === undefined ? ['CloneDamageRatio'] : [])];
  if (!g || delay === undefined || ratio === undefined) {
    return { ...card, status: 'partial', ops: [], not_modelled: g ? `ملف الإصدار لا يحمل ${missing.join('، ')}؛ أثر Echo Cast غير محسوب` : 'بيانات Echo Cast من ملف الإصدار غير محمّلة؛ أثره غير محسوب' };
  }
  return { ...card, status: 'partial', ops: [{ op: 'echo', delay, ratio }], not_modelled: ECHO_LIMITS };
}

/** Dashing (ARAM_Dashing): its Haste on each skill the champion's file tags as moving him (cardMath MOVEMENT_TAGS), not spread over all basic skills. */
function dashing<C extends CardNumbers>(card: C, g: AugmentGameData | undefined): C {
  const haste = g && valueOf(g, 'Haste');
  if (!g || haste === undefined) return { ...card, status: 'partial', ops: [], not_modelled: g ? 'ملف الإصدار لا يحمل Haste؛ أثر Dashing غير محسوب' : 'بيانات Dashing من ملف الإصدار غير محمّلة؛ أثره غير محسوب' };
  return {
    ...card, status: 'partial', ops: [{ op: 'add', stat: 'haste', value: haste, scope: 'movement_abilities' }],
    not_modelled: 'المهارات المتحركة تُعرف من وسوم ملف الشخصية (MoveBlock وTeleport وDashDirection)، وكون Dashing يقرأ هذه الوسوم نفسها غير مثبت؛ تفوتها Twisted Fate R وSion R وNocturne R وQ الثانية لـLee Sin، ومهارات الشكل الآخر للمتحولين',
  };
}

/** Readers by card id (BEES!!! is 3086 in the Mayhem list; the item 3086 is Zeal, another table). */
const READERS: Record<number, <C extends CardNumbers>(card: C, g: AugmentGameData | undefined) => C> = { 3086: bees, 2062: echo, 1019: dashing };

/** The card with the numbers of the loaded patch's file when it has a reader; other cards as they are. */
export function cardFromFiles<C extends CardNumbers>(card: C, game: AugmentGameData | undefined): C {
  return READERS[card.id]?.(card, game) ?? card;
}
