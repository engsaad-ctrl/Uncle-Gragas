import { describe, expect, it } from 'vitest';
import { VAR_HTML, cleanText, isUntranslated, pickText } from '../../src/texts/clean.js';

describe('cleanText', () => {
  it('maps whitelisted tags to spans and drops wrappers', () => {
    expect(cleanText('<mainText><stats><attention> 75</attention> ضرر هجوم</stats><br><br></mainText>')).toBe(
      '<span class="t-stats"><span class="t-key"> 75</span> ضرر هجوم</span>',
    );
  });

  it('turns a standalone 0 into the dynamic-value marker', () => {
    expect(cleanText('<magicDamage>0 ضرر سحر</magicDamage> خلال 5ث')).toBe(
      `<span class="t-ap">${VAR_HTML} ضرر سحر</span> خلال 5ث`,
    );
    expect(cleanText('لمدة 0ث')).toBe(`لمدة ${VAR_HTML}ث`);
  });

  it('leaves real numbers containing 0 alone', () => {
    expect(cleanText('10 و 0.25ث و 20% و 1.0ث')).toBe('10 و 0.25ث و 20% و 1.0ث');
  });

  it('turns @…@ and {{ … }} placeholders into the marker', () => {
    expect(cleanText('هي @f3@ث')).toBe(`هي ${VAR_HTML}ث`);
    expect(cleanText('تكسب {{ Item_Melee_Ranged_Split }}% سرعة')).toBe(`تكسب ${VAR_HTML}% سرعة`);
  });

  it('shows the game\'s stat icons for known tokens and drops unknown ones', () => {
    expect(cleanText('%i:scaleAS%سرعة هجوم')).toBe(
      '<img class="t-ico" src="https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/fonts/texticons/lol/statsicon/scaleas.png" alt="سرعة الهجوم" title="سرعة الهجوم">سرعة هجوم',
    );
    expect(cleanText('(%i:cooldown% 30ث)')).toContain('gameplay/cooldown.png');
    expect(cleanText('%i:somethingNew%نص')).toBe('نص');
    expect(cleanText('%i:scaleAP"onerror=x%')).toBe('%i:scaleAP&quot;onerror=x%'); // only \w names become icons; the rest stays escaped text
  });

  it('renders melee/ranged splits and plain brackets', () => {
    expect(cleanText('[85 قتال قريب || 50 قتال بعيد]')).toBe('85 قتال قريب / 50 قتال بعيد');
    expect(cleanText('+[30 - 45]ث')).toBe('+30 - 45ث');
  });

  it('keeps the text of unknown tags', () => {
    expect(
      cleanText("<lol-uikit-tooltipped-keyword key='x'><font color='#48C4B7'>متكيفة</font></lol-uikit-tooltipped-keyword>"),
    ).toBe('متكيفة');
  });

  it('escapes HTML and never emits non-whitelisted tags', () => {
    expect(cleanText('a & b "c"')).toBe('a &amp; b &quot;c&quot;');
    expect(cleanText('<script>alert(1)</script><img src=x onerror=alert(1)>')).toBe('alert(1)');
  });

  it('renders list items as bullets', () => {
    expect(cleanText('<li>أ<li>ب')).toBe('• أ<br>• ب');
  });

  it('collapses runs of line breaks and trims them at the edges', () => {
    expect(cleanText('<br>أ<br><br><br> <br>ب<br>')).toBe('أ<br><br>ب');
  });

  it('drops empty spans so they do not block edge trimming', () => {
    expect(cleanText('<stats></stats><br><br> <passive>7%</passive> علاج')).toBe('<b>7%</b> علاج');
  });

  it('closes unbalanced tags in order', () => {
    expect(cleanText('<b>أ<i>ب</b>')).toBe('<b>أ<i>ب</i></b>');
  });
});

describe('isUntranslated / pickText', () => {
  it('detects placeholder keys and empty strings', () => {
    expect(isUntranslated('GeneratedTip_Item_1500_ExternalDescription')).toBe(true);
    expect(isUntranslated('Item_226660_Name')).toBe(true);
    expect(isUntranslated('  ')).toBe(true);
    expect(isUntranslated(undefined)).toBe(true);
    expect(isUntranslated('السيف الأبدي')).toBe(false);
  });

  it('prefers Arabic, falls back to English, then to empty', () => {
    expect(pickText('السيف', 'Sword')).toEqual({ text: 'السيف', translated: true });
    expect(pickText('Item_1_Name', 'Sword')).toEqual({ text: 'Sword', translated: false });
    expect(pickText('Item_1_Name', 'GeneratedTip_X')).toEqual({ text: '', translated: false });
    expect(pickText('', undefined)).toEqual({ text: '', translated: false });
  });
});
