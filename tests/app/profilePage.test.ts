import { describe, expect, it } from 'vitest';
import { composeProfile } from '../../src/app/profilePage.js';
import type { RawProfile } from '../../src/lcu/profile.js';
import type { ChampionListEntry, NamedText } from '../../src/texts/champions.js';
import type { ItemText } from '../../src/texts/items.js';

const champ = (id: number, enName: string): ChampionListEntry => ({ id, name: enName, enName, alias: enName, portraitUrl: `p${id}` });
const item = (id: number): ItemText => ({ id, name: `i${id}`, enName: `I${id}`, html: '', translated: true, inStore: true, iconPath: `/lol-game-data/assets/i${id}.png`, categories: [] });
const match = (gameId: number, championId: number, win: boolean, queueId = 420, gameMode = 'CLASSIC') =>
  ({ gameId, createdAt: gameId, durationSec: 1200, queueId, gameMode, championId, win, kills: 2, deaths: 1, assists: 3, cs: 100, level: 12, items: [3089, 9999], spells: [4] });

const raw: RawProfile = {
  puuid: 'me', gameName: 'Saad', tagLine: 'ME1', level: 312, iconId: 29,
  ranked: [], recent: [{ puuid: 'p2', gameName: 'Ally', tagLine: 'EUW', championId: 238, playedAt: 5 }],
  matches: [match(1, 103, true), match(2, 103, false, 2400, 'KIWI'), match(3, 238, true, 12345, 'CHERRY')],
};

describe('composeProfile', () => {
  const spells = new Map<number, NamedText>([[4, { id: 4, name: 'Flash', enName: 'Flash', html: '', iconUrl: 's4' }]]);
  const p = composeProfile(raw, [champ(103, 'Ahri'), champ(238, 'Zed')], new Map([[3089, item(3089)]]), spells, true);

  it('names queues (id first, then game mode) and resolves champions, items and spells', () => {
    expect(p.matches.map((m) => m.queue)).toEqual(['Ranked Solo/Duo', 'ARAM Mayhem', 'Arena']);
    expect(p.matches[0].champion?.enName).toBe('Ahri');
    expect(p.matches[0].items.map((i) => i.id)).toEqual([3089]); // unknown item ids skipped
    expect(p.matches[0].spells.map((s) => s.enName)).toEqual(['Flash']);
    expect(p.iconUrl).toMatch(/profile-icons\/29\.jpg$/);
  });

  it('sums the matches shown and ranks the most played champions', () => {
    expect(p.summary).toMatchObject({ games: 3, wins: 2, kills: 6, deaths: 3, assists: 9 });
    expect(p.summary.top.map((t) => [t.champion.enName, t.games, t.wins])).toEqual([['Ahri', 2, 1], ['Zed', 1, 1]]);
    expect(p.recent[0]).toMatchObject({ gameName: 'Ally', champion: { enName: 'Zed' } });
  });
});
