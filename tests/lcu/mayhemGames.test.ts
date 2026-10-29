import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LcuCall } from '../../src/lcu/client.js';
import { collectMayhemGames, readMayhemGames, toMayhemGame } from '../../src/lcu/mayhemGames.js';

const game = (gameId: number, queueId = 2400) => ({
  gameId,
  queueId,
  gameMode: queueId === 2400 ? 'KIWI' : 'ARAM',
  gameCreation: 1000,
  gameVersion: '16.21.1',
  participantIdentities: [{ player: { gameName: 'someone', puuid: 'p1' } }],
  participants: [
    { championId: 110, stats: { win: true, playerAugment1: 1038, playerAugment2: 0, item0: 3153, item1: 0, item6: 2052 } },
    { championId: 21, stats: { win: false, playerAugment1: 1084 } },
  ],
});

/** A client that answers the summoner, the history list and game details, and records what was asked. */
function client(history: unknown[]) {
  const asked: string[] = [];
  const call: LcuCall = async (_m, path) => {
    asked.push(path);
    if (path === '/lol-summoner/v1/current-summoner') return { puuid: 'me' };
    if (path.includes('/matches?')) return { games: { games: history } };
    const id = Number(path.split('/').pop());
    return game(id, (history as { gameId: number; queueId: number }[]).find((g) => g.gameId === id)!.queueId);
  };
  return { call, asked };
}

describe('toMayhemGame', () => {
  it('keeps champion, win, augments and items, and drops names and empty slots', () => {
    const g = toMayhemGame(game(7))!;
    expect(g).toEqual({
      id: 7, at: 1000, version: '16.21.1',
      players: [{ champion: 110, win: true, augments: [1038], items: [3153, 2052] }, { champion: 21, win: false, augments: [1084], items: [] }],
    });
    expect(JSON.stringify(g)).not.toContain('someone');
  });

  it('refuses other modes', () => {
    expect(toMayhemGame(game(7, 450))).toBeNull();
  });
});

describe('collectMayhemGames', () => {
  it('reads only new Mayhem games, and adds them to the file', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'lolh-mg-')), 'mayhem-games.json');
    const first = client([{ gameId: 1, queueId: 2400 }, { gameId: 2, queueId: 450 }]);
    expect(await collectMayhemGames(first.call, file)).toBe(1);
    expect(first.asked.filter((p) => p.includes('/games/'))).toEqual(['/lol-match-history/v1/games/1']);

    const second = client([{ gameId: 3, queueId: 2400 }, { gameId: 1, queueId: 2400 }]);
    expect(await collectMayhemGames(second.call, file)).toBe(1);
    expect(second.asked.filter((p) => p.includes('/games/'))).toEqual(['/lol-match-history/v1/games/3']);
    expect((await readMayhemGames(file)).map((g) => g.id)).toEqual([1, 3]);
    expect(await readdir(join(file, '..'))).toEqual(['mayhem-games.json']); // no temp file left
  });

  it('never overwrites a damaged file', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'lolh-mg-')), 'mayhem-games.json');
    await writeFile(file, '{ broken');
    await expect(collectMayhemGames(client([{ gameId: 1, queueId: 2400 }]).call, file)).rejects.toThrow();
  });
});
