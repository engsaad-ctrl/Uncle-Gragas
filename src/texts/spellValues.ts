// Fills tooltip placeholders (@Name@, @Name*100@) with the numbers stored in the game's spell data:
// DataValues (plain values) and mSpellCalculations (GameCalculation formulas). Seen in the 2026-10 game files.

type Part = { __type?: string; [field: string]: unknown };

export interface SpellCalculation {
  mFormulaParts?: Part[];
  mDisplayAsPercent?: boolean;
  mPrecision?: number;
  mMultiplier?: Part;
}

export interface SpellData {
  DataValues?: { name: string; values?: number[] }[];
  mSpellCalculations?: Record<string, SpellCalculation>;
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

/** A value over champion levels 1–18, plus whether part of it scales with a stat we do not name. */
interface Range {
  min: number;
  max: number;
  scales: boolean;
}

const SCALING_PARTS = new Set([
  'StatByCoefficientCalculationPart', 'StatByNamedDataValueCalculationPart', 'StatBySubPartCalculationPart',
  'BuffCounterByCoefficientCalculationPart', 'BuffCounterByNamedDataValueCalculationPart', 'AbilityResourceByCoefficientCalculationPart',
]);

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

function breakpointsAt(p: Part, level: number): number {
  let v = num(p.mLevel1Value);
  for (const bp of (p.mBreakpoints as Part[] | undefined) ?? []) {
    const at = num(bp.mLevel);
    if (level < at) continue;
    v += num(bp.mAdditionalBonusAtThisLevel) + num(bp.mBonusPerLevelAtAndAfter) * (level - at + 1);
  }
  return v;
}

function evalPart(p: Part | undefined, dataValue: (name: string) => number | undefined): Range | null {
  if (!p) return null;
  const t = p.__type ?? '';
  if (SCALING_PARTS.has(t)) return { min: 0, max: 0, scales: true };
  switch (t) {
    case 'NumberCalculationPart':
      return { min: num(p.mNumber), max: num(p.mNumber), scales: false };
    case 'NamedDataValueCalculationPart': {
      const v = dataValue(String(p.mDataValue));
      return v === undefined ? null : { min: v, max: v, scales: false };
    }
    case 'ByCharLevelInterpolationCalculationPart':
      return { min: num(p.mStartValue), max: num(p.mEndValue), scales: false };
    case 'ByCharLevelBreakpointsCalculationPart':
      return { min: breakpointsAt(p, 1), max: breakpointsAt(p, 18), scales: false };
    case 'SumOfSubPartsCalculationPart':
      return sum(((p.mSubparts as Part[] | undefined) ?? []).map((s) => evalPart(s, dataValue)));
    case 'ProductOfSubPartsCalculationPart': {
      const a = evalPart(p.mPart1 as Part, dataValue);
      const b = evalPart(p.mPart2 as Part, dataValue);
      return a && b ? { min: a.min * b.min, max: a.max * b.max, scales: a.scales || b.scales } : null;
    }
    default:
      return null; // unknown or unnamed part type: leave the placeholder unresolved
  }
}

function sum(parts: (Range | null)[]): Range | null {
  if (parts.some((r) => r === null)) return null;
  return (parts as Range[]).reduce((a, r) => ({ min: a.min + r.min, max: a.max + r.max, scales: a.scales || r.scales }), { min: 0, max: 0, scales: false });
}

const fmt = (n: number, precision: number) => String(Number(n.toFixed(precision)));

function formatRange(r: Range, percent: boolean, precision: number): string | null {
  const hasBase = r.min !== 0 || r.max !== 0;
  if (!hasBase) return null; // only stat scaling: nothing truthful to print
  const k = percent ? 100 : 1;
  const unit = percent ? '%' : '';
  const base = r.min === r.max ? `${fmt(r.min * k, precision)}${unit}` : `${fmt(r.min * k, precision)}${unit}–${fmt(r.max * k, precision)}${unit}`;
  return r.scales ? `${base} (+إحصاءات)` : base;
}

const LIVE_COUNTER = /@f\d+(?:\.\d+)?@/i;

/**
 * Returns the text with every placeholder it could fill, and how many it could not.
 * Lines that show live in-match counters (@f1@, @f2.0@ …) are dropped: they have no value outside a game.
 */
export function resolveSpellValues(text: string, spell: SpellData | undefined): { text: string; unresolved: number } {
  // Split keeps separators at odd indexes; a dropped line takes the break before it along.
  const parts = text.split(/(<br\s*\/?>|<hr\s*\/?>)/i);
  let kept = parts[0] && LIVE_COUNTER.test(parts[0]) ? '' : (parts[0] ?? '');
  for (let i = 1; i < parts.length; i += 2) if (!LIVE_COUNTER.test(parts[i + 1] ?? '')) kept += parts[i] + (parts[i + 1] ?? '');

  const values = spell?.DataValues ?? [];
  const dataValue = (name: string) => {
    const d = values.find((v) => sameName(v.name, name) || sameName(name, v.name));
    return d?.values?.[1] ?? d?.values?.[0]; // index 0 is "rank 0"; augments have one rank
  };
  const calcs = Object.entries(spell?.mSpellCalculations ?? {});

  let unresolved = 0;
  const out = kept.replace(/@([\w.]+?)(?:\*(-?[\d.]+))?@/g, (whole, name: string, mult?: string) => {
    const k = mult ? Number(mult) : 1;
    const calc = calcs.find(([key]) => sameName(key, name))?.[1];
    let shown: string | null = null;
    if (calc) {
      const r = sum((calc.mFormulaParts ?? []).map((p) => evalPart(p, dataValue)));
      const m = calc.mMultiplier ? evalPart(calc.mMultiplier, dataValue) : { min: 1, max: 1, scales: false };
      if (r && m) shown = formatRange({ min: r.min * m.min * k, max: r.max * m.max * k, scales: r.scales || m.scales }, calc.mDisplayAsPercent === true, calc.mPrecision ?? 2);
    } else {
      const v = dataValue(name);
      if (v !== undefined) shown = fmt(v * k, 2);
    }
    if (shown === null) unresolved++;
    return shown ?? whole;
  });
  return { text: out, unresolved };
}
