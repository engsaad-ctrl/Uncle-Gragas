import { cleanText, isUntranslated, pickText } from './clean.js';

export interface RawPerk {
  id: number;
  name: string;
  shortDesc: string;
  longDesc: string;
  iconPath: string;
}

export interface RuneText {
  id: number;
  name: string;
  /** English client name; the UI shows it by default next to the Arabic description. */
  enName: string;
  html: string;
  translated: boolean;
  iconPath: string;
}

// Runes write ratios as coefficients ("+0.1 ضرر هجوم إضافي"); the rest of the app says "+10% من ضرر الهجوم الإضافي".
const RATIO_LABEL: [RegExp, string, string][] = [
  [/ضرر (?:ال)?هجوم (?:ال)?إضافي/, 'ضرر الهجوم الإضافي', 'scaleAD'],
  [/(?:قوة قدرة|قوة القدرة)/, 'قوة القدرة', 'scaleAP'],
  [/ضرر (?:ال)?هجوم/, 'ضرر الهجوم', 'scaleAD'],
];
const RATIO = /\+\s?(\d*\.\d+)\s+(?:من\s+)?(ضرر (?:ال)?هجوم (?:ال)?إضافي|قوة قدرة|قوة القدرة|ضرر (?:ال)?هجوم)/g;

export function percentRatios(text: string): string {
  return text.replace(RATIO, (whole, n: string, label: string) => {
    const k = Number(n);
    const hit = RATIO_LABEL.find(([re]) => re.test(label));
    if (!hit || !(k < 5)) return whole; // not a coefficient
    const [, name, tag] = hit;
    return `<${tag}><nowrap>+${Number((k * 100).toFixed(2))}% من ${name}</nowrap></${tag}>`;
  });
}

// 7000 is a template; RunesIcon.png marks the legacy "crew bonus" perks no player can pick.
const isPlayable = (p: RawPerk) => p.id !== 7000 && !p.iconPath.endsWith('/RunesIcon.png');

export function buildRuneTexts(ar: RawPerk[], en: RawPerk[]): Map<number, RuneText> {
  const enById = new Map(en.map((p) => [p.id, p]));
  const out = new Map<number, RuneText>();
  for (const a of ar.filter(isPlayable)) {
    const e = enById.get(a.id);
    const name = pickText(a.name, e?.name);
    const desc = pickText(a.longDesc || a.shortDesc, e && (e.longDesc || e.shortDesc));
    out.set(a.id, {
      id: a.id,
      name: name.text,
      enName: isUntranslated(e?.name) ? '' : e!.name,
      html: cleanText(percentRatios(desc.text)),
      translated: name.translated && desc.translated,
      iconPath: a.iconPath,
    });
  }
  return out;
}
