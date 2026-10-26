// Fills tooltip placeholders (@Name@, @Name*100@) with the numbers stored in the game's spell data:
// DataValues (plain values) and mSpellCalculations (GameCalculation formulas). Seen in the 2026-10 game files.

import { REAL_ZERO } from './clean.js';

type Part = { __type?: string; [field: string]: unknown };

export interface SpellCalculation {
  __type?: string;
  mFormulaParts?: Part[];
  mDisplayAsPercent?: boolean;
  mPrecision?: number;
  mMultiplier?: Part;
  /** GameCalculationModified: another calculation of the same spell, times mMultiplier. */
  mModifiedGameCalculation?: string;
  /** Melee/ranged split (items): the value for ranged champions is the melee value times this. */
  mRangedMultiplier?: Part;
  /** GameCalculationConditional: the value without the in-game buff, which is what the tooltip shows at rest. */
  mDefaultGameCalculation?: string;
}

export interface SpellData {
  DataValues?: { name: string; values?: number[] }[];
  mSpellCalculations?: Record<string, SpellCalculation>;
  /** Older spells keep numbered values here, read by @Effect1Amount@ and EffectValueCalculationPart. */
  mEffectAmount?: { value?: number[] }[];
  // Spell fields the text can quote (@Cooldown@, @Cost@, @MaxAmmo@, @AmmoRechargeTime@). Index 0 is rank 0, except mana.
  cooldownTime?: number[];
  mana?: number[];
  mMaxAmmo?: number[];
  mAmmoRechargeTime?: number[];
}

/** Name hash used for unnamed bin fields and entries: FNV-1a 32-bit of the lowercased name. */
export function binHash(name: string): string {
  let h = 0x811c9dc5;
  for (const ch of name.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `{${h.toString(16).padStart(8, '0')}}`;
}

const sameName = (key: string, name: string) => key.toLowerCase() === name.toLowerCase() || key === binHash(name);

// mStat ids calibrated against the DataValue names of all 173 champion bins (2026-10); mStatFormula 0 total, 1 base, 2 bonus.
// Ids not listed here are shown with a generic label rather than a guessed one.
const STAT_LABEL: Record<number, [total: string, bonus: string]> = {
  0: ['قوة القدرة', 'قوة القدرة الإضافية'],
  1: ['الدروع', 'الدروع الإضافية'],
  2: ['ضرر الهجوم', 'ضرر الهجوم الإضافي'],
  4: ['سرعة الهجوم', 'سرعة الهجوم الإضافية'],
  6: ['مقاومة السحر', 'مقاومة السحر الإضافية'],
  7: ['سرعة الحركة', 'سرعة الحركة الإضافية'],
  8: ['الضربة الحرجة', 'الضربة الحرجة'],
  9: ['الضربة الحرجة', 'الضربة الحرجة'],
  12: ['الصحة القصوى', 'الصحة الإضافية'],
  29: ['الفتك', 'الفتك'],
  31: ['المدى', 'المدى الإضافي'],
};
const BASE_LABEL: Record<number, string> = { 2: 'ضرر الهجوم الأساسي', 12: 'الصحة الأساسية' };
// Riot's own colour tags and text icons (%i:scaleAP% …), so a ratio looks like the game's: icon instead of the stat's name.
const STAT_TAG: Record<number, string> = {
  0: 'scaleAP', 1: 'scaleArmor', 2: 'scaleAD', 4: 'scaleAS', 6: 'scaleMR', 7: 'scaleMS', 8: 'scaleCrit', 9: 'scaleCrit', 12: 'scaleHealth', 29: 'scaleAPen', 31: 'scaleRange',
};
/** What the icon alone cannot say: bonus or base stat (total needs no word). */
const FORMULA_WORD: Record<number, string> = { 1: ' أساسي', 2: ' إضافي' };

function statLabel(stat: number, formula: number): string {
  if (formula === 1) return BASE_LABEL[stat] ?? 'إحصاءات';
  return STAT_LABEL[stat]?.[formula === 2 ? 1 : 0] ?? 'إحصاءات';
}

/** One stat ratio, per rank (60% AP → coef 0.6). */
interface Scaling {
  label: string;
  tag?: string;
  /** The game's text icon shown instead of the label, and the word that keeps bonus/base apart. */
  icon?: string;
  suffix?: string;
  coef: number[];
  /** At champion level 18, when the ratio itself grows with level. */
  coefMax?: number[];
  /** A count, not a stat ratio: "(+2 لكل تكديسة)". */
  flat?: boolean;
}

/**
 * A value per ability rank. min/max differ when it also grows with champion level (1–18).
 * `other` marks a part we cannot name (stacks, resource) so the reader knows the number is not the whole story.
 */
interface Value {
  min: number[];
  max: number[];
  scalings: Scaling[];
  other: boolean;
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const fill = (ranks: number, n: number) => Array<number>(ranks).fill(n);
const plain = (min: number[], max = min): Value => ({ min, max, scalings: [], other: false });
const isPlain = (v: Value) => !v.scalings.length && !v.other;

function breakpointsAt(p: Part, level: number): number {
  let v = num(p.mLevel1Value) + num(p.mInitialBonusPerLevel) * (level - 1);
  for (const bp of (p.mBreakpoints as Part[] | undefined) ?? []) {
    const at = num(bp.mLevel);
    if (level < at) continue;
    v += num(bp.mAdditionalBonusAtThisLevel) + num(bp.mBonusPerLevelAtAndAfter) * (level - at + 1);
  }
  return v;
}

function add(a: Value, b: Value): Value {
  const scalings = a.scalings.map((s) => ({ ...s, coef: [...s.coef] }));
  for (const s of b.scalings) {
    const same = scalings.find((x) => x.label === s.label);
    if (same) {
      if (same.coefMax || s.coefMax) same.coefMax = (same.coefMax ?? same.coef).map((c, i) => c + (s.coefMax ?? s.coef)[i]);
      same.coef = same.coef.map((c, i) => c + s.coef[i]);
    } else scalings.push(s);
  }
  return { min: a.min.map((x, i) => x + b.min[i]), max: a.max.map((x, i) => x + b.max[i]), scalings, other: a.other || b.other };
}

/** Multiplies by a value that has no stat part of its own; anything else cannot be shown as "base + ratio". */
function times(v: Value, k: Value): Value {
  if (!isPlain(k)) return { min: v.min.map((x, i) => x * k.min[i]), max: v.max.map((x, i) => x * k.max[i]), scalings: [], other: true };
  return {
    min: v.min.map((x, i) => x * k.min[i]),
    max: v.max.map((x, i) => x * k.max[i]),
    scalings: v.scalings.map((s) => ({ ...s, coef: s.coef.map((c, i) => c * k.min[i]), ...(s.coefMax ? { coefMax: s.coefMax.map((c, i) => c * k.max[i]) } : {}) })),
    other: v.other,
  };
}

interface Ctx {
  ranks: number;
  dataValue: (name: string) => number[] | undefined;
  effect: (index: number) => number[] | undefined;
  calc: (name: string) => SpellCalculation | undefined;
  /** Another spell of the same character, by its name or path (ExternalNamedDataValue). */
  other: (spell: string) => Ctx | undefined;
  depth: number;
}

/** Field by its name, or by its hash when the game files leave it unnamed. */
const field = (p: Part, name: string) => p[name] ?? p[binHash(name)];
/** Part type by name; newer types appear only as hashes ({4ce08984} is ByCharLevelNamedDataValueBreakpointsCalculationPart). */
const isType = (p: Part, name: string) => p.__type === name || p.__type === binHash(name);

function evalPart(p: Part | undefined, c: Ctx): Value | null {
  if (!p) return null;
  const stat = (coef: number[] | undefined): Value | null =>
    coef
      ? {
          ...plain(fill(c.ranks, 0)),
          scalings: [{ label: statLabel(num(p.mStat), num(p.mStatFormula)), tag: STAT_TAG[num(p.mStat)], icon: STAT_TAG[num(p.mStat)], suffix: FORMULA_WORD[num(p.mStatFormula)], coef }],
        }
      : null;
  const dv = (name: unknown) => (typeof name === 'string' ? c.dataValue(name) : undefined);
  if (isType(p, 'ByCharLevelNamedDataValuesInterpolationCalculationPart')) {
    const [a, b] = [dv(field(p, 'StartDataValue')), dv(field(p, 'EndDataValue'))];
    return a && b ? plain(a, b) : null;
  }
  if (isType(p, 'ByCharLevelNamedDataValueBreakpointsCalculationPart')) {
    // Same rule as ByCharLevelBreakpoints, with every number read from a data value (per ability rank).
    const zero = fill(c.ranks, 0);
    const level1 = dv(field(p, 'Level1DataValue')) ?? zero;
    const perLevel = dv(field(p, 'InitialBonusPerLevelDataValue')) ?? zero;
    const bps = (Object.values(p).find(Array.isArray) as Part[] | undefined) ?? [];
    const at = (level: number) =>
      level1.map((v, i) => {
        let x = v + perLevel[i] * (level - 1);
        for (const bp of bps) {
          const lv = num(bp.level ?? bp.mLevel);
          if (level < lv) continue;
          x += (dv(field(bp, 'AdditionalBonusAtThisLevelDataValue')) ?? zero)[i] + (dv(field(bp, 'BonusPerLevelAtAndAfterDataValue')) ?? zero)[i] * (level - lv + 1);
        }
        return x;
      });
    return plain(at(1), at(18));
  }
  if (isType(p, 'SpellCalculationCalculationPart')) {
    const calc = c.calc(String(field(p, 'mSpellCalculationKey')));
    return calc ? evalCalc(calc, { ...c, depth: c.depth + 1 }) : null;
  }
  if (isType(p, 'ExternalNamedDataValueCalculationPart')) {
    const v = c.other(String(field(p, 'SourceObject')))?.dataValue(String(field(p, 'DataValue')));
    return v ? plain(v) : null;
  }
  switch (p.__type) {
    case 'ByCharLevelFormulaCalculationPart': {
      const values = (p.values as number[] | undefined) ?? []; // indexed by champion level
      return values.length ? plain(fill(c.ranks, values[1] ?? values[0]), fill(c.ranks, values[18] ?? values[values.length - 1])) : null;
    }
    case 'NumberCalculationPart':
      return plain(fill(c.ranks, num(p.mNumber)));
    case 'NamedDataValueCalculationPart': {
      const v = c.dataValue(String(p.mDataValue));
      return v ? plain(v) : null;
    }
    case 'EffectValueCalculationPart': {
      const v = c.effect(num(p.mEffectIndex));
      return v ? plain(v) : null;
    }
    case 'ByCharLevelInterpolationCalculationPart':
      return plain(fill(c.ranks, num(p.mStartValue)), fill(c.ranks, num(p.mEndValue)));
    case 'ByCharLevelBreakpointsCalculationPart':
      return plain(fill(c.ranks, breakpointsAt(p, 1)), fill(c.ranks, breakpointsAt(p, 18)));
    case 'StatByCoefficientCalculationPart':
      return stat(fill(c.ranks, num(p.mCoefficient)));
    case 'StatByNamedDataValueCalculationPart':
      return stat(c.dataValue(String(p.mDataValue)));
    case 'StatBySubPartCalculationPart': {
      const sub = evalPart(p.mSubpart as Part, c);
      if (!sub) return null;
      if (!isPlain(sub)) return { ...plain(fill(c.ranks, 0)), other: true };
      const v = stat(sub.min);
      // A ratio that grows with champion level ("5%–15% من ضرر الهجوم الإضافي")
      if (v && sub.min.some((x, i) => x !== sub.max[i])) v.scalings[0].coefMax = sub.max;
      return v;
    }
    case 'AbilityResourceByCoefficientCalculationPart': // the champion's resource bar, mana for item users
      return { ...plain(fill(c.ranks, 0)), scalings: [{ label: 'المانا القصوى', tag: 'scaleMana', icon: 'scaleMana', coef: fill(c.ranks, num(p.mCoefficient)) }] };
    case 'BuffCounterByCoefficientCalculationPart':
    case 'BuffCounterByNamedDataValueCalculationPart': {
      // value × the stacks of a buff, which only exist in a match
      const coef = p.__type === 'BuffCounterByCoefficientCalculationPart' ? fill(c.ranks, num(p.mCoefficient)) : dv(p.mDataValue);
      return coef ? { ...plain(fill(c.ranks, 0)), scalings: [{ label: 'لكل تكديسة', coef, flat: true }] } : null;
    }
    case 'SumOfSubPartsCalculationPart':
      return sumParts((p.mSubparts as Part[] | undefined) ?? [], c);
    case 'ProductOfSubPartsCalculationPart': {
      const a = evalPart(p.mPart1 as Part, c);
      const b = evalPart(p.mPart2 as Part, c);
      if (!a || !b) return null;
      return isPlain(a) ? times(b, a) : times(a, b);
    }
    default:
      return null; // unknown or unnamed part type: leave the placeholder unresolved
  }
}

function sumParts(parts: Part[], c: Ctx): Value | null {
  let total = plain(fill(c.ranks, 0));
  for (const p of parts) {
    const v = evalPart(p, c);
    if (!v) return null;
    total = add(total, v);
  }
  return total;
}

function evalCalc(calc: SpellCalculation, c: Ctx): Value | null {
  if (c.depth > 4) return null; // a modified calculation could point back at itself
  let v: Value | null;
  if (calc.__type === 'GameCalculationModified') {
    const inner = calc.mModifiedGameCalculation ? c.calc(calc.mModifiedGameCalculation) : undefined;
    v = inner ? evalCalc(inner, { ...c, depth: c.depth + 1 }) : null;
  } else if (calc.__type === 'GameCalculationConditional') {
    const inner = calc.mDefaultGameCalculation ? c.calc(calc.mDefaultGameCalculation) : undefined;
    v = inner ? evalCalc(inner, { ...c, depth: c.depth + 1 }) : null; // without a default it depends on a buff
  } else if (calc.__type && calc.__type !== 'GameCalculation' && !calc.mRangedMultiplier) {
    return null;
  } else v = sumParts(calc.mFormulaParts ?? [], c);
  if (!v || !calc.mMultiplier) return v;
  const m = evalPart(calc.mMultiplier, c);
  return m ? times(v, m) : null;
}

// A computed 0 is a real value: mark it so cleanText does not take it for CommunityDragon's "unknown" 0.
const fmt = (n: number, precision: number) => {
  const text = String(Number(n.toFixed(precision)));
  return text === '0' ? `0${REAL_ZERO}` : text;
};

/**
 * "70 / 120 / 170 / 220 / 270", or one number when every rank is the same.
 * The spaces matter: "70/120" is one left-to-right number run, so in Arabic text level 1 lands on the left;
 * spaced out, each number is its own run and level 1 comes first when read right to left.
 */
export function perRank(values: number[], precision: number, unit: string): string {
  const shown = values.map((x) => `${fmt(x, precision)}${unit}`);
  return shown.every((x) => x === shown[0]) ? shown[0] : shown.join(' / ');
}

/** Display data for one placeholder: the value and how the game prints it. */
interface Shown {
  v: Value;
  percent: boolean;
  precision: number;
}

function ratioText(s: Scaling, percent: boolean): string {
  const k = s.flat ? (percent ? 100 : 1) : percent ? 10000 : 100;
  const unit = s.flat && !percent ? '' : '%';
  const max = s.coefMax;
  const nums = max?.some((x, i) => x !== s.coef[i])
    ? `${fmt(s.coef[0] * k, 2)}${unit}–${fmt(max[max.length - 1] * k, 2)}${unit}`
    : perRank(s.coef.map((x) => x * k), 2, unit);
  if (s.flat) return `${nums} ${s.label}`;
  const stat = s.icon ? `%i:${s.icon}%${s.suffix ?? ''}` : s.label; // cleanText turns %i:…% into the game's icon
  return percent ? `${nums} لكل 100 ${stat}` : s.icon ? `${nums} ${stat}` : `${nums} من ${stat}`;
}
const liveRatios = (v: Value) => v.scalings.filter((s) => s.coef.some((x) => x !== 0));
const hasBase = (v: Value) => v.min.some((x) => x !== 0) || v.max.some((x) => x !== 0);
// <nowrap> keeps "(+50% من قوة القدرة)" on one line; cleanText turns it into a span.
const paint = (text: string, tag?: string) => (tag ? `<${tag}><nowrap>${text}</nowrap></${tag}>` : `<nowrap>${text}</nowrap>`);

function formatValue({ v, percent, precision }: Shown): string | null {
  const k = percent ? 100 : 1;
  const unit = percent ? '%' : '';
  const levelBased = v.min.some((x, i) => x !== v.max[i]);
  const base = levelBased
    ? `${fmt(v.min[0] * k, precision)}${unit}–${fmt(v.max[v.max.length - 1] * k, precision)}${unit}` // grows with champion level
    : perRank(v.min.map((x) => x * k), precision, unit);
  // A ratio inside a percent value reads "per 100 of the stat", as the game words it.
  const ratios = liveRatios(v).map((s) => ({ text: ratioText(s, percent), tag: s.tag }));
  if (!hasBase(v) && !ratios.length) return v.other ? null : base; // only an unnamed part: nothing truthful to print
  if (!hasBase(v) && !v.other) return ratios.map((r) => paint(r.text, r.tag)).join(' + ');
  const extra = [...ratios.map((r) => paint(`(+${r.text})`, r.tag)), ...(v.other ? [paint('(+إحصاءات)')] : [])].join(' ');
  return hasBase(v) ? `${base} ${extra}`.trim() : extra;
}

/**
 * Melee/ranged split as one short aside, so the sentence still reads: "40% من ضرر الهجوم (20% للمدى البعيد)".
 * The ranged half drops the stat name when it is the same single ratio or a plain number.
 */
function formatSplit(melee: Shown, ranged: Shown): string | null {
  const m = formatValue(melee);
  const r = formatValue(ranged);
  if (!m || !r || m === r) return m;
  const rs = liveRatios(ranged.v);
  const ms = liveRatios(melee.v);
  const sameRatio = !ranged.v.other && !ranged.percent && rs.length === 1 && ms.length === 1 && ms[0].label === rs[0].label;
  const sameBase = ranged.v.min.every((x, i) => x === melee.v.min[i] && ranged.v.max[i] === melee.v.max[i]);
  const short =
    sameRatio && !hasBase(ranged.v)
      ? perRank(rs[0].coef.map((x) => x * 100), 2, '%')
      : sameRatio && sameBase
        ? `+${perRank(rs[0].coef.map((x) => x * 100), 2, '%')}` // only the ratio differs: "5 (+13% …) (+10% للمدى البعيد)"
        : !rs.length && !ranged.v.other
          ? r
          : null;
  return short ? `${m} (${short} للمدى البعيد)` : `${m} (للمدى البعيد: ${r})`;
}

const LIVE_COUNTER = /@f\d+(?:\.\d+)?@|@QuestProgress@/i;
/** Placeholders that are words, not numbers: default key bindings, and the ability an Arena augment is tied to (picked in the match). */
const WORD_TOKENS: Record<string, string> = {
  spell1keybind: 'Q', spell2keybind: 'W', spell3keybind: 'E', spell4keybind: 'R',
  spellname: 'القدرة المختارة',
};
const plainText = (html: string) => html.replace(/<[^>]*>|@[^@\s]*@/g, '').trim();
/** A short line around a live counter is a match tracker ("الضرر الإجمالي: @f1@"); a long one is real text. */
const isTracker = (line: string, all: boolean) => LIVE_COUNTER.test(line) && (all || plainText(line).length <= 40);

/**
 * Whether a resolved tooltip is worth showing over the short description: at most half of its values unknown.
 * Unknown ones are values that change in a match (other items, stacks…); the stat ratios players read for are there.
 */
export function mostlyResolved(source: string, r: { text: string; unresolved: number }): boolean {
  const total = (source.match(/@[^@\s<>]+@/g) ?? []).filter((m) => !LIVE_COUNTER.test(m)).length;
  const missing = r.unresolved + (r.text.match(/\{\{[^}]*\}\}/g) ?? []).length;
  return missing === 0 || missing * 2 <= total;
}

export interface ResolveOptions {
  /** Ability ranks to show (5 for Q/W/E, 3 for R). Augments and items have one. */
  ranks?: number;
  /** Another spell of the same champion, for @spell.OtherSpell:Value@ (Jayce, Elise, Nidalee…). */
  spellRef?: (name: string) => SpellData | undefined;
  /** Drop every line with a live counter, not only short tracker lines (augments: their counters are all trackers). */
  dropLiveLines?: boolean;
}

function makeCtx(spell: SpellData | undefined, ranks: number, spellRef?: ResolveOptions['spellRef']): Ctx {
  // Index 0 is "rank 0"; ranks start at 1. A single-value list applies to every rank.
  const byRank = (values: number[] | undefined) =>
    values?.length ? Array.from({ length: ranks }, (_, i) => values[i + 1] ?? values[values.length === 1 ? 0 : values.length - 1]) : undefined;
  const values = spell?.DataValues ?? [];
  const calcs = Object.entries(spell?.mSpellCalculations ?? {});
  const fields: Record<string, number[] | undefined> = {
    cooldown: spell?.cooldownTime,
    cost: spell?.mana && [0, ...spell.mana], // mana starts at rank 1
    maxammo: spell?.mMaxAmmo,
    ammorechargetime: spell?.mAmmoRechargeTime,
  };
  return {
    ranks,
    dataValue: (name) => byRank(values.find((v) => sameName(v.name, name) || sameName(name, v.name))?.values ?? fields[name.toLowerCase()]),
    effect: (index) => byRank(spell?.mEffectAmount?.[index - 1]?.value),
    calc: (name) => calcs.find(([key]) => sameName(key, name) || sameName(name, key))?.[1],
    other: (ref) => {
      const found = spellRef?.(ref.split('/').pop() ?? ref);
      return found ? makeCtx(found, ranks, spellRef) : undefined;
    },
    depth: 0,
  };
}

/**
 * Returns the text with every placeholder it could fill, and how many it could not.
 * Short lines that only track live in-match counters (@f1@, @f2.0@ …) are dropped: they have no value outside a game.
 * A counter inside real text stays for cleanText to mark as an in-game value.
 */
export function resolveSpellValues(text: string, spell: SpellData | undefined, opts: ResolveOptions = {}): { text: string; unresolved: number } {
  const ranks = Math.max(1, opts.ranks ?? 1);
  // Split keeps separators at odd indexes; a dropped line takes the break before it along.
  const parts = text.split(/(<br\s*\/?>|<hr\s*\/?>)/i);
  const all = opts.dropLiveLines === true;
  let kept = parts[0] && isTracker(parts[0], all) ? '' : (parts[0] ?? '');
  for (let i = 1; i < parts.length; i += 2) if (!isTracker(parts[i + 1] ?? '', all)) kept += parts[i] + (parts[i + 1] ?? '');

  const own = makeCtx(spell, ranks, opts.spellRef);
  /** A calculation or data value by name, with the "*100" multiplier applied. */
  const lookup = (ctx: Ctx, name: string, k: Value, forcePercent: boolean): { shown: Shown; ranged?: Shown } | null => {
    const calc = ctx.calc(name);
    if (calc) {
      const v = evalCalc(calc, ctx);
      if (!v) return null;
      const shown = { v: times(v, k), percent: forcePercent || calc.mDisplayAsPercent === true, precision: Math.min(Math.max(calc.mPrecision ?? 2, 0), 6) }; // some calcs store -1
      if (!calc.mRangedMultiplier) return { shown };
      const rk = evalPart(calc.mRangedMultiplier, ctx);
      return rk ? { shown, ranged: { ...shown, v: times(shown.v, rk) } } : null;
    }
    const effect = /^Effect(\d+)Amount$/i.exec(name);
    const v = ctx.dataValue(name) ?? (effect ? ctx.effect(Number(effect[1])) : undefined);
    return v ? { shown: { v: times(plain(v), k), percent: forcePercent, precision: 2 } } : null;
  };

  let unresolved = 0;
  // @Name@, @Name*100@, @spell.Other:Name@; @Melee~Ranged@ (with an optional % flag) pairs two values for melee/ranged.
  const out = kept.replace(
    /@(?:spell\.(\w+):)?([\w.]+?)(?:~([\w.]+?))?(?:\*(-?[\d.]+))?(%)?@/g,
    (whole, ref: string | undefined, name: string, rangedName: string | undefined, mult?: string, pct?: string) => {
      if (LIVE_COUNTER.test(whole)) return whole;
      if (!ref && !rangedName && WORD_TOKENS[name.toLowerCase()] && !own.dataValue(name)) return WORD_TOKENS[name.toLowerCase()];
      const ctx = ref ? makeCtx(opts.spellRef?.(ref), ranks, opts.spellRef) : own;
      const k = plain(fill(ranks, mult ? Number(mult) : 1));
      // "@MaxDuration.1@": the number after the dot is how many decimals to show, not part of the name
      const digits = /^(.*)\.(\d+)$/.exec(name);
      const withDigits = (r: ReturnType<typeof lookup>) =>
        r && digits ? { shown: { ...r.shown, precision: Number(digits[2]) }, ranged: r.ranged && { ...r.ranged, precision: Number(digits[2]) } } : r;
      const a = withDigits(lookup(ctx, digits ? digits[1] : name, k, pct === '%'));
      const b = rangedName ? lookup(ctx, rangedName, k, pct === '%') : null;
      let shown: string | null = null;
      if (a && rangedName) shown = b ? formatSplit(a.shown, b.shown) : null;
      else if (a) shown = a.ranged ? formatSplit(a.shown, a.ranged) : formatValue(a.shown);
      else if (!rangedName && !ref) {
        // Item texts name a melee/ranged pair loosely: @BonusAS@ → BonusASMelee/BonusASRanged, @ShieldShredMeleeRangedSplit@ →
        // ShieldShred/ShieldShredRange, @MeleeRangedSplit@ → MeleeItemCalcValue/RangedItemCalcValue (2026-10 items).
        const base = name.replace(/(MeleeRanged|MeleeRange)?Split$/i, '');
        const pairs: [string, string][] = [
          ...(/split/i.test(name) ? [['MeleeItemCalcValue', 'RangedItemCalcValue'] as [string, string]] : []),
          [`${base}Melee`, `${base}Ranged`], [base, `${base}Range`], [base, `${base}Ranged`], [base, `Ranged${base}`],
        ];
        for (const [m, r] of pairs) {
          const pm = lookup(ctx, m, k, pct === '%');
          const pr = pm && lookup(ctx, r, k, pct === '%');
          if (pm && pr) {
            shown = formatSplit(pm.shown, pr.shown);
            break;
          }
        }
      }
      if (shown === null) unresolved++;
      return shown ?? whole;
    },
  );
  // "50 (25 للمدى البعيد) %" when the text puts the % after the placeholder
  return { text: out.replace(/([\d.]+) \(([\d.]+) للمدى البعيد\)\s?%/g, '$1% ($2% للمدى البعيد)'), unresolved };
}
