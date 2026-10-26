import { describe, expect, it } from 'vitest';
import fx from '../fixtures/augments/sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import { buildAugmentTexts, iconUrl, type AugmentListEntry } from '../../src/texts/augments.js';
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
    expect(a.html).toContain('<span class="t-armor">دروعًا</span>');
  });

  it('resolves a hashed description key', () => {
    const a = byId.get(3118)!;
    expect(a.name).toBe('مبدأ السحر');
    expect(a.html).toContain('تستعيد جزءًا');
    expect(a.html).toContain(VAR_HTML);
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

  it('builds CommunityDragon icon URLs', () => {
    expect(byId.get(1397)!.iconUrl).toBe(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/cherry/augments/icons/cerberus_small.png',
    );
    expect(iconUrl('/lol-game-data/assets/A/B.PNG')).toBe(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/a/b.png',
    );
  });
});
