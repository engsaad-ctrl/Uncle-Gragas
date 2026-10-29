import { describe, expect, it } from 'vitest';
import { adaptBuild, focusOf } from '../../src/app/augmentBuild.js';
import type { ChampionPage } from '../../src/app/championPage.js';

const icon = (s: string) => `<img class="t-ico" src="https://x/statsicon/${s}.png">`;
const item = (id: number, enName: string, html: string) => ({ id, name: enName, enName, html, iconUrl: '' });
const IE = item(3031, 'Infinity Edge', `${icon('scalead')} ضرر ${icon('scalecrit')}`);
const KRAKEN = item(6672, 'Kraken Slayer', `${icon('scalead')} ${icon('scaleas')}`);
const RABADON = item(3089, "Rabadon's Deathcap", `${icon('scaleap')} قوة القدرة`);
const THORN = item(3075, 'Thornmail', `${icon('scalehealth')} ${icon('scalearmor')}`);
const BOOTS = item(3006, "Berserker's Greaves", icon('scaleas'));
const page = {
  core: { items: [IE, KRAKEN], games: 1, winRate: 0.5 }, boots: { items: [BOOTS], games: 1, winRate: 0.5 },
  fourth: [], fifth: [], sixth: [],
} as unknown as ChampionPage;
const pool = [IE, KRAKEN, RABADON, THORN];

describe('adaptBuild', () => {
  it('reads stats from icons and colour tags', () => {
    expect([...focusOf(`<span class="s-scaleap">x</span> ${icon('scaleap')} ${icon('scalearmor')}`)]).toEqual([['ap', 2], ['tank', 1]]);
  });

  it('keeps the champion build when nothing is chosen, boots first', () => {
    expect(adaptBuild(page, [], pool).items.map((x) => x.item.enName)).toEqual(["Berserker's Greaves", 'Infinity Edge', 'Kraken Slayer']);
  });

  it('moves items matching the augments up, with the reason, and puts an "Upgrade X" item first', () => {
    const ap = adaptBuild(page, [{ name: 'تعزيز قوة', enName: 'Big Brain', html: `${icon('scaleap')} ${icon('scaleap')} ${icon('scaleap')}` }], pool);
    expect(ap.focus[0]).toBe('ap');
    expect(ap.items.find((x) => x.item.enName === "Rabadon's Deathcap")?.reasons).toContain('يناسب تعزيز قوة');
    const up = adaptBuild(page, [{ name: 'ترقية الدرع الشوكي', enName: 'Upgrade Thornmail', html: '' }], pool);
    expect(up.items[1].item.enName).toBe('Thornmail'); // after the boots
    expect(up.items[1].reasons).toContain('ترقية الدرع الشوكي يطوّره');
  });
});
