export function normalizeArabic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // harakat, dagger alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/['’.&-]/g, '') // Kai'Sa, Dr. Mundo, Nunu & Willump: "kaisa", "drmundo", "nunu willump"
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterAugments<T extends { name: string; enName: string; rarity: string; modes: string[] }>(
  list: T[],
  query: string,
  rarity: string,
  mode = 'all',
): T[] {
  const q = normalizeArabic(query);
  return list.filter(
    (a) =>
      (rarity === 'all' || a.rarity === rarity) &&
      (mode === 'all' || a.modes.includes(mode)) &&
      (!q || normalizeArabic(a.name).includes(q) || normalizeArabic(a.enName).includes(q)),
  );
}

/** Match short pieces of successive words, with optional words skipped. */
export function findOfferMatches<T extends { name: string; enName: string }>(list: T[], query: string): T[] {
  const q = normalizeArabic(query);
  if (!q) return [];
  const parts = q.split(' ');
  return list.filter((a) => [a.name, a.enName].some((name) => {
    const normalized = normalizeArabic(name);
    if (normalized.includes(q)) return true;
    if (parts.length === 1) return false;
    const words = normalized.split(' ');
    let next = 0;
    return parts.every((part) => {
      const index = words.findIndex((word, i) => i >= next && word.startsWith(part));
      next = index + 1;
      return index >= 0;
    });
  }));
}
