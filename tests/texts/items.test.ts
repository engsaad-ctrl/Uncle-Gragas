import { describe, expect, it } from 'vitest';
import arItems from '../fixtures/cdragon/items.ar_ae.sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import { buildItemTexts, type RawItem } from '../../src/texts/items.js';

// English ("default") is not in the fixtures in the sandbox; these two English entries are synthetic test input for the fallback path.
const en: RawItem[] = [
  { id: 1500, name: 'Penetrating Bullets', description: 'English fallback text', inStore: false, iconPath: '' },
  { id: 226660, name: 'GeneratedTip_Missing', description: '', inStore: false, iconPath: '' },
];

const texts = buildItemTexts(arItems as RawItem[], en);

describe('buildItemTexts', () => {
  it('keeps official Arabic names and cleans descriptions', () => {
    const sword = texts.get(3031)!;
    expect(sword.name).toBe('السيف الأبدي');
    expect(sword.translated).toBe(true);
    expect(sword.html).toBe(
      '<span class="t-stats"><span class="t-key"> 75</span> ضرر هجوم<br><span class="t-key"> 25%</span> فرصة ضربة حرجة<br><span class="t-key"> 30%</span> ضرر الضربة الحرجة</span>',
    );
  });

  it('keeps mode variants as separate entries', () => {
    expect(texts.get(223031)!.name).toBe(texts.get(3031)!.name);
  });

  it('falls back to English per field', () => {
    const t = texts.get(1500)!;
    expect(t.name).toBe('الرصاصات النافذة');
    expect(t.html).toBe('English fallback text');
    expect(t.translated).toBe(false);
  });

  it('empties a name with no usable fallback so the UI can hide it', () => {
    expect(texts.get(226660)!.name).toBe('');
  });

  it('marks live-computed zeros', () => {
    expect(texts.get(1035)!.html).toContain(`${VAR_HTML} ضرر سحر`);
  });

  it('never leaks raw markup or placeholder keys', () => {
    for (const t of texts.values()) {
      expect(t.html).not.toMatch(/<mainText|GeneratedTip_|@\w+@/i);
    }
  });
});
