import type { AbilityDetail, RankRow, RawSpellDetail } from './abilityDetails.js';
import { assetUrl } from './assets.js';
import { cleanText, isUntranslated, pickText } from './clean.js';

/** Anything shown with a name, an Arabic description and an icon (items, runes, spells, abilities…). */
export interface NamedText {
  id: number;
  name: string;
  enName: string;
  html: string;
  iconUrl: string;
}

export interface RawChampionSummary {
  id: number;
  name: string;
  alias: string;
  squarePortraitPath: string;
}

export interface ChampionListEntry {
  id: number;
  name: string;
  enName: string;
  alias: string;
  portraitUrl: string;
}

export function buildChampionList(ar: RawChampionSummary[], en: RawChampionSummary[]): ChampionListEntry[] {
  const enNames = new Map(en.map((c) => [c.id, c.name]));
  return ar
    .filter((c) => c.id > 0 && c.id < 10000) // -1 is "none"; ids from 60000 are Jade-mode variants
    .map((c) => ({ id: c.id, name: c.name, enName: enNames.get(c.id) ?? c.alias, alias: c.alias, portraitUrl: assetUrl(c.squarePortraitPath) }))
    .sort((a, b) => a.enName.localeCompare(b.enName, 'en'));
}

export type AbilityKey = 'P' | 'Q' | 'W' | 'E' | 'R';

export interface AbilityText {
  key: AbilityKey;
  name: string;
  enName: string;
  html: string;
  iconUrl: string;
  /** Cooldown and cost per ability level, shown as a small table. */
  ranks?: RankRow[];
}

interface RawAbility extends RawSpellDetail {
  name: string;
  description: string;
  abilityIconPath: string;
  spellKey?: string;
}

export interface RawChampion {
  id: number;
  name: string;
  alias: string;
  title: string;
  squarePortraitPath: string;
  passive: RawAbility;
  spells: RawAbility[];
}

export interface ChampionDetail {
  id: number;
  name: string;
  enName: string;
  alias: string;
  title: string;
  portraitUrl: string;
  abilities: AbilityText[];
}

const SPELL_KEYS: AbilityKey[] = ['Q', 'W', 'E', 'R'];

/** `details` (from the game files) adds the in-game tooltip: per-rank values, ratios, cooldown and cost. */
export function buildChampionDetail(ar: RawChampion, en: RawChampion | undefined, details?: Map<AbilityKey, AbilityDetail>): ChampionDetail {
  const ability = (key: AbilityKey, a: RawAbility, e: RawAbility | undefined): AbilityText => {
    const d = details?.get(key);
    const text = d?.body ?? pickText(a.description, e?.description).text;
    return { key, name: a.name, enName: e?.name ?? '', html: cleanText(text), iconUrl: assetUrl(a.abilityIconPath), ...(d?.ranks.length ? { ranks: d.ranks } : {}) };
  };
  return {
    id: ar.id,
    name: ar.name,
    enName: en?.name ?? ar.alias,
    alias: ar.alias,
    title: ar.title,
    portraitUrl: assetUrl(ar.squarePortraitPath),
    abilities: [
      ability('P', ar.passive, en?.passive),
      ...ar.spells.map((s, i) => ability((s.spellKey?.toUpperCase() as AbilityKey) || SPELL_KEYS[i], s, en?.spells[i])),
    ],
  };
}

interface RawNamed {
  id: number;
  name: string;
  description?: string;
  iconPath: string;
}

function buildNamed(ar: RawNamed[], en: RawNamed[]): Map<number, NamedText> {
  const enById = new Map(en.map((x) => [x.id, x]));
  return new Map(
    ar.map((a) => {
      const e = enById.get(a.id);
      const name = pickText(a.name, e?.name).text;
      const enName = isUntranslated(e?.name) ? '' : e!.name;
      const desc = a.description === undefined ? '' : cleanText(pickText(a.description, e?.description).text);
      return [a.id, { id: a.id, name, enName, html: desc, iconUrl: assetUrl(a.iconPath) }];
    }),
  );
}

export const buildSpellTexts = (ar: RawNamed[], en: RawNamed[]) => buildNamed(ar, en);

export interface StyleSlot {
  /** kKeyStone, kMixedRegularSplashable or kStatMod */
  type: string;
  label: string;
  perks: number[];
}

/** A rune tree (Precision, Domination…) with its rows, as the client lays it out. */
export interface StyleTree extends NamedText {
  slots: StyleSlot[];
}

interface RawStyle extends RawNamed {
  slots?: { type: string; slotLabel?: string; perks: number[] }[];
}

export function buildStyleTrees(ar: RawStyle[], en: RawStyle[]): Map<number, StyleTree> {
  const named = buildNamed(ar, en);
  return new Map(
    ar.map((s) => [
      s.id,
      { ...named.get(s.id)!, slots: (s.slots ?? []).map((sl) => ({ type: sl.type, label: sl.slotLabel ?? '', perks: sl.perks })) },
    ]),
  );
}
