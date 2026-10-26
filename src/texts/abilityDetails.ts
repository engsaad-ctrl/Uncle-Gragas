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

/** Riot markup, still to go through cleanText: a stats line and, when every value resolved, the full tooltip. */
export interface AbilityDetail {
  head: string;
  body?: string;
}

const RESOURCE: Record<number, string> = { 0: 'المانا', 1: 'الطاقة' }; // other resources: the number alone
const KEYS: AbilityKey[] = ['Q', 'W', 'E', 'R'];

function headLine(s: RawSpellDetail, ranks: number, resource: string): string {
  const parts: string[] = [];
  const cd = s.cooldownCoefficients?.slice(0, ranks) ?? [];
  if (cd.some((x) => x > 0)) parts.push(`التبريد: ${perRank(cd, 2, '')}ث`);
  const cost = s.costCoefficients?.slice(0, ranks) ?? [];
  if (s.cost?.includes('@Cost@') && cost.some((x) => x > 0))
    parts.push(`التكلفة: ${s.cost.replace('@Cost@', perRank(cost, 2, '')).replace('@AbilityResourceName@', resource).trim()}`);
  return parts.length ? `<stats>${parts.join(' · ')}</stats>` : '';
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
    out.set(key, { head: headLine(s, ranks, resource), body: resolve(s.dynamicDescription, spell, ranks) });
  });

  const passive = bin[record.mCharacterPassiveSpell ?? '']?.mSpell;
  const passiveKey = passive?.mClientData?.mTooltipData?.mLocKeys?.keyTooltip;
  out.set('P', { head: '', body: resolve(passiveKey ? strings(passiveKey) : undefined, passive, 1) });
  return out;
}
