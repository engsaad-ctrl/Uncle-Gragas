import { describe, expect, it } from 'vitest';
import arItems from '../fixtures/cdragon/items.ar_ae.sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import gameFx from '../fixtures/game/items.json' with { type: 'json' };
import type { GameItem } from '../../src/texts/gameData.js';
import { buildItemDetails, buildItemTexts, type RawItem } from '../../src/texts/items.js';

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
    // Each stat line carries the game's icon for its stat: AD, crit chance, crit damage.
    expect(sword.html.replace(/<img [^>]*statsicon\/(\w+)\.png"[^>]*>/g, '[$1]')).toBe(
      '<span class="t-stats"><span class="s-scalead">[scalead] 75 ضرر هجوم</span><br><span class="s-scalecrit">[scalecrit] 25% فرصة ضربة حرجة</span><br><span class="s-scalecritmult">[scalecritmult] 30% ضرر الضربة الحرجة</span></span>',
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
    expect(t.enName).toBe('Penetrating Bullets');
  });

  it('empties a name with no usable fallback so the UI can hide it', () => {
    expect(texts.get(226660)!.name).toBe('');
    expect(texts.get(226660)!.enName).toBe('');
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

describe('buildItemDetails (real game files, 2026-10)', () => {
  const strings = (k: string) => (gameFx.strings as Record<string, string>)[k.toLowerCase()];
  const d = buildItemDetails(gameFx.items as unknown as Record<number, GameItem>, strings);

  it('fills values CommunityDragon prints as 0, with stat ratios', () => {
    expect(d.get(1035)).toContain('<magicDamage>60 <scaleAP><nowrap>(+30% %i:scaleAP%)</nowrap></scaleAP> <scaleAD><nowrap>(+5% %i:scaleAD% إضافي)</nowrap></scaleAD> <scaleHealth><nowrap>(+2% %i:scaleHealth% إضافي)</nowrap></scaleHealth> ضرر سحر</magicDamage>');
  });

  it('shows both melee and ranged values, and the active cooldown from the item spell', () => {
    expect(d.get(3074)).toContain('<scaleAD><nowrap>40% %i:scaleAD%</nowrap></scaleAD> (20% للمدى البعيد)');
    expect(d.get(3146)).toMatch(/\(60ث\).*175–253 <scaleAP><nowrap>\(\+30% %i:scaleAP%\)<\/nowrap><\/scaleAP>/s);
  });

  it('keeps CommunityDragon\'s stats block with the game\'s stat icons, and swaps the body', () => {
    const item: RawItem = { id: 1035, name: 'سكين الجمر', description: '<mainText><stats><attention> 75</attention> ضرر هجوم<br><attention> 12%</attention> سرقة صحة</stats><br><br>قديم 0</mainText>', inStore: true, iconPath: '' };
    const html = buildItemTexts([item], [], d).get(1035)!.html;
    expect(html).toMatch(/^<span class="t-stats"><span class="s-scalead"><img class="t-ico" src="[^"]+statsicon\/scalead\.png"[^>]*> 75 ضرر هجوم<\/span><br><span class="s-scalels"><img [^>]+scalels\.png/);
    expect(html).toMatch(/60 <span class="s-scaleap"><span class="t-nw">\(\+30% <img [^>]+scaleap\.png/);
    expect(html).not.toContain('قديم');
  });
});

describe('item cooldowns and omitted stats', () => {
  const strings = (k: string) =>
    ({
      tip: '<section>الاسم</section><section>الإحصاءات</section><section>نشط (@ActiveCooldown@{{ Item_Cooldown }}). فرصة @FlatCritChanceMod*100@%</section>',
      blade: '<section>الاسم</section><section>الإحصاءات</section><section>حد السيف {{ Item_Cooldown }}.</section>',
      item_cooldown: '%i:cooldown% (@Cooldown@ث)',
    })[k.toLowerCase()];
  const items = {
    1: { tooltipKey: 'tip', DataValues: [{ name: 'ActiveCooldown', values: [90] }] }, // Gargoyle Stoneplate's shape
    2: { tooltipKey: 'blade', DataValues: [{ name: 'SpellbladeCooldown', values: [1.5] }] }, // Divine Sunderer's
  };

  it('prints a cooldown once after its value, reads a lone one from the item, and an omitted stat as 0', () => {
    const d = buildItemDetails(items, strings);
    expect(d.get(1)).toContain('(%i:cooldown% 90ث)'); // not "(90 (؟ث))"
    expect(d.get(1)).toMatch(/فرصة 0\u2060?%/);
    expect(d.get(2)).toContain('حد السيف %i:cooldown% (1.5ث)');
  });
});
