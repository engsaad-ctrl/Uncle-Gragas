import { describe, expect, it } from 'vitest';
import fx from '../fixtures/augments/sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import { assetUrl } from '../../src/texts/assets.js';
import { buildAugmentTexts, type AugmentListEntry } from '../../src/texts/augments.js';
import { stringTableKey } from '../../src/texts/stringhash.js';

const texts = await buildAugmentTexts({
  listAr: fx.listAr as AugmentListEntry[],
  listEn: fx.listEn as AugmentListEntry[],
  bins: Object.values(fx.bins),
  strings: fx.strings as Record<string, string>,
});
const byId = new Map(texts.map((t) => [t.id, t]));

describe('stringTableKey', () => {
  it('matches the hash Riot uses for unnamed string-table keys', async () => {
    expect(await stringTableKey('Kiwi_Augment_ArcaneAxiom_Description')).toBe('{2a67b4a441}');
  });
});

describe('buildAugmentTexts', () => {
  it('keeps every augment, sorted by Arabic name', () => {
    expect(texts.map((t) => t.id).sort()).toEqual([1305, 1327, 1397, 1405, 2006, 3118]);
    const names = texts.map((t) => t.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ar')));
  });

  it('resolves a plain description key and cleans it', () => {
    const a = byId.get(1327)!;
    expect(a.name).toBe('شديد الإصرار');
    expect(a.enName).toBe('Adamant');
    expect(a.described).toBe(true);
    // Tooltip chosen because every value resolved from the spell data (ResistsPerLevel etc.)
    expect(a.html).toContain('تكسب 2–10 <span class="t-armor"> دروع</span>');
    expect(a.html).toContain('لمدة 10ث');
    expect(a.html).not.toContain(VAR_HTML);
  });

  it('resolves a hashed description key', () => {
    const a = byId.get(3118)!;
    expect(a.name).toBe('مبدأ السحر');
    expect(a.html).toBe('عند موت بطلٍ ألحقت الضرر به خلال 3ث، تستعيد 15%–30% من إجمالي فترة تبريد قدرتك الخارقة.');
  });

  it('follows a key that points at another mode (Cherry_ key from a kiwi bin)', () => {
    expect(byId.get(1305)!.html).toContain('<span class="t-speed">');
  });

  it('shows augments with no game data by name only', () => {
    const a = byId.get(1397)!;
    expect(a.name).toBe('سيربيروس');
    expect(a.described).toBe(false);
    expect(a.html).toBe('');
    expect(a.rarity).toBe('prismatic');
  });

  it('labels ids >= 1000 as Mayhem', () => {
    expect(byId.get(1327)!.modes).toEqual(['mayhem']);
  });

  it('labels ids < 1000 as Arena, merges identical twins and drops "???" placeholders', async () => {
    const entry = (id: number, augmentNameId: string, nameTRA: string): AugmentListEntry => ({
      id, augmentNameId, nameTRA, augmentSmallIconPath: '/lol-game-data/assets/x.png', rarity: 'kGold',
    });
    const data = (id: number, key: string) => ({ __type: 'AugmentData', AugmentPlatformId: id, DescriptionTra: key });
    // Synthetic input mirroring real pairs: MasterofDuality 54/ARAM_MasterofDuality 1054, Typhoon 87/ARAM_Typhoon 1087.
    const r = await buildAugmentTexts({
      listAr: [
        entry(54, 'MasterofDuality', 'أستاذ'), entry(1054, 'ARAM_MasterofDuality', 'أستاذ'),
        entry(87, 'Typhoon', 'إعصار'), entry(1087, 'ARAM_Typhoon', 'إعصار'),
        entry(1424, 'ARAM_MissingPingAugment', '???'),
      ],
      listEn: [],
      bins: [{ a: data(54, 'same'), b: data(1054, 'same'), c: data(87, 'arena'), d: data(1087, 'mayhem') }],
      strings: { same: 'نص واحد', arena: 'نص الأرينا', mayhem: 'نص مايهم' },
    });
    expect(r.filter((a) => a.name === 'أستاذ').map((a) => [a.modes, a.ids])).toEqual([[['arena', 'mayhem'], [54, 1054]]]);
    expect(r.filter((a) => a.name === 'إعصار').map((a) => a.modes).sort()).toEqual([['arena'], ['mayhem']]);
    expect(r.some((a) => a.name === '???')).toBe(false);
  });

  it('builds CommunityDragon icon URLs', () => {
    expect(byId.get(1397)!.iconUrl).toBe(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/cherry/augments/icons/cerberus_small.png',
    );
    expect(assetUrl('/lol-game-data/assets/A/B.PNG')).toBe(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/a/b.png',
    );
  });
});
