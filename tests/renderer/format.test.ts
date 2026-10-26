import { describe, expect, it } from 'vitest';
import { duration, gamesCount, kdaRatio, lastGames, timeAgo } from '../../src/renderer/format.js';

describe('profile formats', () => {
  const now = Date.UTC(2026, 9, 26, 12);
  it('says how long ago in Arabic with Latin digits', () => {
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('قبل 3 ساعات');
    expect(timeAgo(now - 20_000, now)).toMatch(/دقيقة/);
    expect(timeAgo(now - 2 * 86400_000, now)).toBe('أول أمس'); // numeric: 'auto' words it naturally
  });
  it('formats KDA and game length', () => {
    expect(kdaRatio(5, 2, 7)).toBe('6.00');
    expect(kdaRatio(3, 0, 4)).toBe('مثالي');
    expect(duration(1925)).toBe('32:05');
  });

  it('counts games the Arabic way', () => {
    expect([1, 2, 3, 10, 11, 20].map(gamesCount)).toEqual(['مباراة واحدة', 'مباراتان', '3 مباريات', '10 مباريات', '11 مباراة', '20 مباراة']);
    expect([1, 2, 5, 20].map(lastGames)).toEqual(['آخر مباراة', 'آخر مباراتين', 'آخر 5 مباريات', 'آخر 20 مباراة']);
  });
});
