// Small text formats for the profile page.

const relative = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', Infinity]];

/** "قبل 3 ساعات" for a time in ms, against `now`. */
export function timeAgo(at: number, now = Date.now()): string {
  let n = Math.max(0, (now - at) / 60000); // minutes
  for (const [unit, size] of STEPS) {
    if (n < size) return relative.format(-Math.max(1, Math.round(n)), unit);
    n /= size;
  }
  return '';
}

/** KDA ratio as games show it: (kills + assists) / deaths, "مثالي" with no deaths. */
export const kdaRatio = (k: number, d: number, a: number) => (d ? ((k + a) / d).toFixed(2) : 'مثالي');

export const duration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Arabic counting of games: مباراة واحدة، مباراتان، 3–10 مباريات، 11+ مباراة. */
export function gamesCount(n: number): string {
  if (n === 1) return 'مباراة واحدة';
  if (n === 2) return 'مباراتان';
  return n >= 3 && n <= 10 ? `${n} مباريات` : `${n} مباراة`;
}

/** "آخر مباراتين", "آخر 5 مباريات", "آخر 20 مباراة". */
export function lastGames(n: number): string {
  if (n === 1) return 'آخر مباراة';
  if (n === 2) return 'آخر مباراتين';
  return n >= 3 && n <= 10 ? `آخر ${n} مباريات` : `آخر ${n} مباراة`;
}
