export function normalizeArabic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // harakat, dagger alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterAugments<T extends { name: string; enName: string; rarity: string }>(
  list: T[],
  query: string,
  rarity: string,
): T[] {
  const q = normalizeArabic(query);
  return list.filter(
    (a) =>
      (rarity === 'all' || a.rarity === rarity) &&
      (!q || normalizeArabic(a.name).includes(q) || normalizeArabic(a.enName).includes(q)),
  );
}
