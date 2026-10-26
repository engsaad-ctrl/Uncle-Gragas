import { describe, expect, it } from 'vitest';
import { filterAugments, normalizeArabic } from '../../src/renderer/search.js';

const list = [
  { name: 'شديد الإصرار', enName: 'Adamant', rarity: 'silver', modes: ['mayhem'] },
  { name: 'مبدأ السحر', enName: 'Arcane Axiom', rarity: 'gold', modes: ['arena'] },
  { name: 'كبير السحرة', enName: 'Archmage', rarity: 'prismatic', modes: ['arena', 'mayhem'] },
];

describe('normalizeArabic', () => {
  it('folds hamza forms, taa marbuta, alef maqsura, diacritics and tatweel', () => {
    expect(normalizeArabic('أُسطورةٌ')).toBe('اسطوره');
    expect(normalizeArabic('إلـــى  آخر')).toBe('الي اخر');
  });

  it('lowercases Latin text', () => {
    expect(normalizeArabic('Arcane AXIOM')).toBe('arcane axiom');
  });
});

describe('filterAugments', () => {
  it('matches Arabic without hamza', () => {
    expect(filterAugments(list, 'الاصرار', 'all').map((a) => a.enName)).toEqual(['Adamant']);
  });

  it('matches English names case-insensitively', () => {
    expect(filterAugments(list, 'arc', 'all').map((a) => a.enName)).toEqual(['Arcane Axiom', 'Archmage']);
  });

  it('filters by rarity', () => {
    expect(filterAugments(list, 'السحر', 'gold').map((a) => a.enName)).toEqual(['Arcane Axiom']);
  });

  it('filters by mode, keeping augments that exist in both', () => {
    expect(filterAugments(list, '', 'all', 'arena').map((a) => a.enName)).toEqual(['Arcane Axiom', 'Archmage']);
    expect(filterAugments(list, '', 'all', 'mayhem').map((a) => a.enName)).toEqual(['Adamant', 'Archmage']);
  });

  it('returns everything for an empty query', () => {
    expect(filterAugments(list, '  ', 'all')).toHaveLength(3);
  });
});
