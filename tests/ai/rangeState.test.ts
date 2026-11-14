import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { passiveRangePairs, passiveRangeReading, rangeState } from '../../src/ai/rangeState.js';

// T061: his attack range state for the display (src/ai/rangeState.ts), on real 16.22 records (840 snapshot) and on hand-made bounds.
// Expected values are written by hand from the files: Kayle's passive says Rank1 (level 6) → UpgradedAttackRange 525, Rank3 (level 16) →
// FinalAttackRange 625, and her base range is 175.
const real = JSON.parse(readFileSync('tests/fixtures/game/range-state-16.22.json', 'utf8')) as Record<string, { bin: Record<string, unknown>; strings: Record<string, string> }>;
const at = (who: string, level: number, heldMelee = false) => rangeState({ ...real[who]!, level, heldMelee });

describe('range state on real 16.22 records', () => {
  it('Kayle: 175 at 5, 525 at 6 and 15, 625 at 16, read from her passive (ranged from 6)', () => {
    expect(at('kayle', 5)).toEqual({ known: true, range: 175, melee: true, source: 'base', level: 5 });
    expect(at('kayle', 6)).toEqual({ known: true, range: 525, melee: false, source: 'passive-rank', level: 6 });
    expect(at('kayle', 15)).toEqual({ known: true, range: 525, melee: false, source: 'passive-rank', level: 15 });
    expect(at('kayle', 16)).toEqual({ known: true, range: 625, melee: false, source: 'passive-rank', level: 16 });
  });
  it('her tooltip pairs Rank1 with UpgradedAttackRange and Rank3 with FinalAttackRange; Rank0 and Rank2 name no range', () => {
    expect(passiveRangePairs(real.kayle!.strings.spell_kaylepassive_tooltip)).toEqual([
      { levelVar: 'LevelForPassiveRank1', rangeVar: 'UpgradedAttackRange' }, { levelVar: 'LevelForPassiveRank3', rangeVar: 'FinalAttackRange' }]);
  });
  it('Master Yi keeps his base 175 at every level; Vayne is ranged (550)', () => {
    for (const level of [1, 6, 11, 16, 18]) expect(at('masteryi', level)).toMatchObject({ known: true, range: 175, melee: true, source: 'base' });
    expect(at('vayne', 9)).toMatchObject({ known: true, range: 550, melee: false, source: 'base' });
  });
  it('Akshan: a passive range value that no tooltip item pairs with a level is not a range state: his base range stands', () => {
    expect(at('akshan', 9)).toMatchObject({ known: true, source: 'base', range: 500 });
  });
  it('Jayce: his form is not read, so no range (not his record\'s 125)', () => {
    expect(at('jayce', 9)).toEqual({ known: false, reason: 'form-unread', level: 9 });
  });
  it('a held live melee card makes him melee at 200, before his form or his passive (Kayle 16, Jayce)', () => {
    expect(at('kayle', 16, true)).toEqual({ known: true, range: 200, melee: true, source: 'held-melee', level: 16 });
    expect(at('jayce', 9, true)).toMatchObject({ known: true, range: 200, source: 'held-melee' });
  });
});

describe('range state bounds', () => {
  const kayleLike = (values: Record<string, number | undefined>, tooltip?: string) => ({
    bin: {
      rec: { __type: 'CharacterRecord', mCharacterName: 'Test', mCharacterPassiveSpell: 'P', attackRangeModifiable: { baseValue: 175 } },
      P: { mSpell: { DataValues: Object.entries(values).flatMap(([name, v]) => (v === undefined ? [] : [{ name, values: [v, v] }])), mClientData: { mTooltipData: { mLocKeys: { keyTooltip: 'T_Tip' } } } } },
    },
    strings: (tooltip === undefined ? {} : { t_tip: tooltip }) as Record<string, string>,
  });
  const TIP = '<ul><li>@LevelForPassiveRank0@ nothing</li><li>@LevelForPassiveRank1@ range @UpgradedAttackRange@</li><li>@LevelForPassiveRank3@ range @FinalAttackRange@</li></ul>';
  const FULL = { LevelForPassiveRank0: 1, LevelForPassiveRank1: 6, LevelForPassiveRank3: 16, UpgradedAttackRange: 525, FinalAttackRange: 625 };
  it('a needed number missing is unknown, never a silent 175', () => {
    expect(rangeState({ ...kayleLike({ ...FULL, FinalAttackRange: undefined }, TIP), level: 9, heldMelee: false })).toEqual({ known: false, reason: 'rank-values-missing', level: 9 });
    expect(rangeState({ ...kayleLike({ ...FULL, LevelForPassiveRank1: undefined }, TIP), level: 3, heldMelee: false })).toMatchObject({ known: false, reason: 'rank-values-missing' });
  });
  it('v2: no tooltip, while the file declares a range by level: unknown, not the base range (no evidence of the transition is not melee)', () => {
    expect(rangeState({ ...kayleLike(FULL), level: 16, heldMelee: false })).toEqual({ known: false, reason: 'level-range-text-unread', level: 16 });
    expect(rangeState({ ...kayleLike(FULL), level: 5, heldMelee: false })).toEqual({ known: false, reason: 'level-range-text-unread', level: 5 });
  });
  it('the step is taken at its own level: 5 → base, 6 → 525, 15 → 525, 16 → 625', () => {
    const s = (level: number) => rangeState({ ...kayleLike(FULL, TIP), level, heldMelee: false });
    expect([5, 6, 15, 16].map((l) => { const r = s(l); return r.known ? r.range : null; })).toEqual([175, 525, 525, 625]);
  });
  it('no record range and no passive: unknown', () => {
    expect(rangeState({ bin: { rec: { __type: 'CharacterRecord', mCharacterName: 'X' } }, strings: {}, level: 9, heldMelee: false })).toEqual({ known: false, reason: 'range-unread', level: 9 });
  });
});

describe("v2 (Codex's T061 review): missing text and list-item bounds", () => {
  const kayle = real.kayle!;
  const tipKey = 'spell_kaylepassive_tooltip';
  it('real Kayle at 6 and 16 with the string table missing ({}): unknown, never 175 or melee', () => {
    for (const level of [6, 16]) expect(rangeState({ bin: kayle.bin, strings: {}, level, heldMelee: false })).toEqual({ known: false, reason: 'level-range-text-unread', level });
  });
  it('real Kayle with her tooltip key missing from the table: unknown', () => {
    const strings = Object.fromEntries(Object.entries(kayle.strings).filter(([k]) => k !== tipKey));
    expect(rangeState({ bin: kayle.bin, strings, level: 6, heldMelee: false })).toMatchObject({ known: false, reason: 'level-range-text-unread' });
  });
  it('real Kayle with text that pairs nothing (the range sentence in a paragraph after the list): unknown', () => {
    const strings = { [tipKey]: '<ul><li>@LevelForPassiveRank1@</li></ul><p>@UpgradedAttackRange@</p>' };
    expect(rangeState({ bin: kayle.bin, strings, level: 6, heldMelee: false })).toMatchObject({ known: false, reason: 'level-range-text-unread' });
  });
  it('a held live melee card still wins when her text is missing (200)', () => {
    expect(rangeState({ bin: kayle.bin, strings: {}, level: 6, heldMelee: true })).toEqual({ known: true, range: 200, melee: true, source: 'held-melee', level: 6 });
  });
  it('champions whose file declares no range by level keep their base with no text (Master Yi 175, Akshan 500)', () => {
    expect(rangeState({ bin: real.masteryi!.bin, strings: {}, level: 9, heldMelee: false })).toMatchObject({ known: true, range: 175, source: 'base' });
    expect(rangeState({ bin: real.akshan!.bin, strings: {}, level: 9, heldMelee: false })).toMatchObject({ known: true, range: 500, source: 'base' });
  });
  it('a pair is read only inside one closed list item', () => {
    expect(passiveRangeReading('<ul><li>@LevelForPassiveRank1@</li></ul><p>@UpgradedAttackRange@</p>')).toEqual({ pairs: [], ambiguous: false });
    expect(passiveRangeReading('<ul><li>@LevelForPassiveRank1@</li><li>@UpgradedAttackRange@</li></ul>')).toEqual({ pairs: [], ambiguous: false });
    expect(passiveRangeReading('<ul><li>@LevelForPassiveRank1@ to @UpgradedAttackRange@')).toEqual({ pairs: [], ambiguous: true });
    expect(passiveRangeReading('<ul><li>@LevelForPassiveRank1@ <li>@UpgradedAttackRange@</li></ul>')).toEqual({ pairs: [], ambiguous: true });
    expect(passiveRangeReading('<li>@LevelForPassiveRank1@ @LevelForPassiveRank3@ @UpgradedAttackRange@</li>')).toEqual({ pairs: [], ambiguous: true });
    expect(passiveRangeReading('<ul><li class="x">Level @LevelForPassiveRank1@: range @UpgradedAttackRange@.<br></li></ul>')).toEqual({ pairs: [{ levelVar: 'LevelForPassiveRank1', rangeVar: 'UpgradedAttackRange' }], ambiguous: false });
  });
});

describe('Codex: the complete passive range reading must agree', () => {
  const key = 'spell_kaylepassive_tooltip';
  const kayle = real.kayle!;
  const withoutRank = (rank: number) => kayle.strings[key]!.replace(/<li\b[^>]*>[\s\S]*?<\/li\s*>/gi, (item) => item.includes(`@LevelForPassiveRank${rank}@`) ? '' : item);
  it('a missing level-6 item with the level-16 item still present is unread, not base 175', () => {
    const strings = { [key]: withoutRank(1) };
    for (const level of [5, 6, 16]) expect(rangeState({ ...kayle, strings, level, heldMelee: false })).toMatchObject({ known: false, reason: 'level-range-text-unread' });
  });
  it('a missing final-range item does not make the remaining steps a complete reading', () => {
    const strings = { [key]: withoutRank(3) };
    for (const level of [15, 16]) expect(rangeState({ ...kayle, strings, level, heldMelee: false })).toMatchObject({ known: false, reason: 'level-range-text-unread' });
  });
  it('one level linked to two different ranges in separate items is unread', () => {
    const strings = { [key]: '<li>@LevelForPassiveRank1@ @UpgradedAttackRange@</li><li>@LevelForPassiveRank1@ @FinalAttackRange@</li>' };
    expect(rangeState({ ...kayle, strings, level: 16, heldMelee: false })).toMatchObject({ known: false, reason: 'level-range-text-unread' });
  });
  it('a repeated range name cannot give the final threshold a second, different range', () => {
    const strings = { [key]: kayle.strings[key]! + '<li>@LevelForPassiveRank3@ @UpgradedAttackRange@</li>' };
    expect(rangeState({ ...kayle, strings, level: 16, heldMelee: false })).toMatchObject({ known: false, reason: 'level-range-text-unread' });
  });
  it('different level variables with the same numeric threshold and different ranges are unread', () => {
    const bin = structuredClone(kayle.bin) as Record<string, { mSpell?: { DataValues?: { name: string; values: number[] }[] } }>;
    const passive = Object.values(bin).find((x) => x.mSpell?.DataValues?.some((d) => d.name === 'LevelForPassiveRank3'))!;
    passive.mSpell!.DataValues!.find((d) => d.name === 'LevelForPassiveRank3')!.values = [6];
    expect(rangeState({ bin, strings: kayle.strings, level: 6, heldMelee: false })).toMatchObject({ known: false, reason: 'level-range-text-unread' });
  });
  it('repeating the same exact link is harmless', () => {
    const strings = { [key]: kayle.strings[key]! + '<li>@LevelForPassiveRank1@ @UpgradedAttackRange@</li>' };
    expect(rangeState({ ...kayle, strings, level: 16, heldMelee: false })).toMatchObject({ known: true, range: 625, source: 'passive-rank' });
  });
});
