import { cleanText, pickText } from './clean.js';

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
  html: string;
  translated: boolean;
  iconPath: string;
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
      html: cleanText(desc.text),
      translated: name.translated && desc.translated,
      iconPath: a.iconPath,
    });
  }
  return out;
}
