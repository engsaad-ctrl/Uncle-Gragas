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

// Runes write ratios as coefficients ("+0.1 ضرر هجوم إضافي"); the rest of the app shows "+10% [AD icon] إضافي".
// The stat shows as the game's icon (%i:…%), with "إضافي" kept for bonus AD.
const RATIO_LABEL: [RegExp, string, string][] = [
  [/ضرر (?:ال)?هجوم (?:ال)?إضافي/, '%i:scaleAD% إضافي', 'scaleAD'],
  [/(?:قوة قدرة|قوة القدرة)/, '%i:scaleAP%', 'scaleAP'],
  [/ضرر (?:ال)?هجوم/, '%i:scaleAD%', 'scaleAD'],
];
const RATIO = /\+\s?(\d*\.\d+)\s+(?:من\s+)?(ضرر (?:ال)?هجوم (?:ال)?إضافي|قوة قدرة|قوة القدرة|ضرر (?:ال)?هجوم)/g;

export function percentRatios(text: string): string {
  return text.replace(RATIO, (whole, n: string, label: string) => {
    const k = Number(n);
    const hit = RATIO_LABEL.find(([re]) => re.test(label));
    if (!hit || !(k < 5)) return whole; // not a coefficient
    const [, name, tag] = hit;
    return `<${tag}><nowrap>+${Number((k * 100).toFixed(2))}% ${name}</nowrap></${tag}>`;
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
