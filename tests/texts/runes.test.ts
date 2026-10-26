import { describe, expect, it } from 'vitest';
import arPerks from '../fixtures/cdragon/perks.ar_ae.sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import { buildRuneTexts, percentRatios, type RawPerk } from '../../src/texts/runes.js';

const runes = buildRuneTexts(arPerks as RawPerk[], [
  // synthetic English entry for the enName path; real English perks are not in the fixtures
  { id: 8112, name: 'Electrocute', shortDesc: '', longDesc: '', iconPath: '' },
]);

describe('buildRuneTexts', () => {
  it('drops the Template entry and crew bonuses', () => {
    expect(runes.has(7000)).toBe(false);
    expect(runes.has(8004)).toBe(false);
    expect(runes.size).toBe(6);
  });

  it('uses longDesc with the real numbers', () => {
    const e = runes.get(8112)!;
    expect(e.name).toBe('الصعقة الكهربائية');
    expect(e.html).toContain('70 - 240');
    expect(e.translated).toBe(true);
    expect(e.enName).toBe('Electrocute');
    expect(runes.get(8446)!.enName).toBe('');
  });

  it('renders melee/ranged splits', () => {
    expect(runes.get(8446)!.html).toContain(' / ');
    expect(runes.get(8446)!.html).not.toContain('||');
  });

  it('marks leftover placeholders instead of showing them', () => {
    const html = runes.get(8360)!.html;
    expect(html).toContain(VAR_HTML);
    expect(html).not.toMatch(/@\w+@/);
  });

  it('renders list items', () => {
    expect(runes.get(8437)!.html).toContain('• ');
  });
});

describe('percentRatios', () => {
  it('turns rune coefficients into the percentages used everywhere else', () => {
    expect(percentRatios('الضرر: 70 - 240 (+0.1 ضرر هجوم إضافي، +0.05 قوة قدرة) ضرر.')).toBe(
      'الضرر: 70 - 240 (<scaleAD><nowrap>+10% من ضرر الهجوم الإضافي</nowrap></scaleAD>، <scaleAP><nowrap>+5% من قوة القدرة</nowrap></scaleAP>) ضرر.',
    );
    expect(percentRatios('(+ 0.05 قوة قدرة )')).toBe('(<scaleAP><nowrap>+5% من قوة القدرة</nowrap></scaleAP> )');
    expect(percentRatios('+2.5% صحة إضافية')).toBe('+2.5% صحة إضافية'); // already a percentage
  });
});
