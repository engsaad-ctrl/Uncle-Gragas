// In-game style ability tooltips: per-rank values, stat ratios, cooldown and cost.
// Text comes from CommunityDragon's champion file (dynamicDescription) and the game string table (passive);
// the numbers come from the champion's bin (game/data/characters/<alias>/<alias>.bin.json).

import type { AbilityKey } from './champions.js';
import { expandRefs } from './gameData.js';
import { perRank, resolveSpellValues, type SpellData } from './spellValues.js';

export interface RawSpellDetail {
  dynamicDescription?: string;
  cost?: string;
  costCoefficients?: number[];
  cooldownCoefficients?: number[];
}

interface BinSpell extends SpellData {
  mClientData?: { mTooltipData?: { mLocKeys?: { keyTooltip?: string }; mLists?: { LevelUp?: { levelCount?: number } } } };
}
type Bin = Record<string, { __type?: string; mSpell?: BinSpell; [field: string]: unknown } | undefined>;

interface CharacterRecord {
  __type: 'CharacterRecord';
  spells?: string[];
  mCharacterPassiveSpell?: string;
  primaryAbilityResource?: { arType?: number };
}

/** One line of the per-level table: a label and one value per ability level (level 1 first). */
export interface RankRow {
  label: string;
  values: string[];
}

/** Cooldown/cost per level, and (Riot markup, still to go through cleanText) the full tooltip when every value resolved. */
export interface AbilityDetail {
  ranks: RankRow[];
  body?: string;
}

const RESOURCE: Record<number, string> = { 0: 'المانا', 1: 'الطاقة' }; // other resources: the number alone
const KEYS: AbilityKey[] = ['Q', 'W', 'E', 'R'];

// A table, not "9/8/7/6/5": in right-to-left text a slash list reads backwards and hides which level is which.
function rankRows(s: RawSpellDetail, ranks: number, resource: string): RankRow[] {
  const rows: RankRow[] = [];
  const cd = s.cooldownCoefficients?.slice(0, ranks) ?? [];
  if (cd.some((x) => x > 0)) rows.push({ label: 'التبريد', values: cd.map((x) => `${perRank([x], 2, '')}ث`) });
  const cost = s.costCoefficients?.slice(0, ranks) ?? [];
  if (s.cost?.includes('@Cost@') && cost.some((x) => x > 0)) {
    // What is left around @Cost@ names the resource ("المانا", "من الصحة" …)
    const unit = s.cost.replace('@Cost@', '').replace('@AbilityResourceName@', resource).replace(/<[^>]*>|@\w+@/g, '').trim();
    rows.push({ label: unit ? `التكلفة (${unit})` : 'التكلفة', values: cost.map((x) => perRank([x], 2, '')) });
  }
  return rows;
}

export function buildAbilityDetails(spells: RawSpellDetail[], gameBin: Record<string, unknown>, strings: (key: string) => string | undefined): Map<AbilityKey, AbilityDetail> {
  const bin = gameBin as Bin;
  const out = new Map<AbilityKey, AbilityDetail>();
  const record = Object.values(bin).find((v) => v?.__type === 'CharacterRecord') as CharacterRecord | undefined;
  if (!record) return out;
  const resource = RESOURCE[record.primaryAbilityResource?.arType ?? -1] ?? '';

  const spellRef = (name: string) => {
    const tail = `/${name.toLowerCase()}`;
    return Object.entries(bin).find(([path, v]) => v?.__type === 'SpellObject' && path.toLowerCase().endsWith(tail))?.[1]?.mSpell;
  };
  const resolve = (raw: string | undefined, spell: BinSpell | undefined, ranks: number) => {
    if (!raw) return undefined;
    const r = resolveSpellValues(expandRefs(raw.replace(/@SpellModifierDescriptionAppend@/g, ''), strings), spell, { ranks, spellRef });
    return r.unresolved === 0 ? r.text : undefined; // a half-filled tooltip is worse than the short description
  };

  KEYS.forEach((key, i) => {
    const spell = bin[record.spells?.[i] ?? '']?.mSpell;
    const s = spells[i];
    if (!s) return;
    const ranks = spell?.mClientData?.mTooltipData?.mLists?.LevelUp?.levelCount ?? (key === 'R' ? 3 : 5);
    out.set(key, { ranks: rankRows(s, ranks, resource), body: resolve(s.dynamicDescription, spell, ranks) });
  });

  const passive = bin[record.mCharacterPassiveSpell ?? '']?.mSpell;
  const passiveKey = passive?.mClientData?.mTooltipData?.mLocKeys?.keyTooltip;
  out.set('P', { ranks: [], body: resolve(passiveKey ? strings(passiveKey) : undefined, passive, 1) });
  return out;
}
