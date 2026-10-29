import { describe, expect, it } from 'vitest';
import { mayhemAugmentCheck } from '../../src/lcu/diagnostics.js';

const list = (games: unknown[]) => ({ games: { games } });

describe('mayhemAugmentCheck', () => {
  it('reads the first Mayhem game and counts the players whose augments are listed', async () => {
    const asked: number[] = [];
    const r = (await mayhemAugmentCheck(list([{ gameId: 1, queueId: 450, gameMode: 'ARAM', mapId: 12 }, { gameId: 2, queueId: 2400, gameMode: 'KIWI', mapId: 12 }]), async (id) => {
      asked.push(id);
      return {
        queueId: 2400,
        participants: [
          { championId: 21, stats: { win: true, playerAugment1: 1205, playerAugment2: 0 } },
          { championId: 103, stats: { win: false, playerAugment1: 0 } },
        ],
      };
    })) as Record<string, unknown>;
    expect(asked).toEqual([2]);
    expect(r.playersWithAugments).toBe(1);
    expect(r.augmentFields).toEqual(['playerAugment1', 'playerAugment2']);
    expect((r.rows as { augments: unknown[] }[])[0].augments).toEqual([1205, 0, null, null, null, null]);
  });

  it('says so when no Mayhem game is in the history, with the queues it saw', async () => {
    const r = await mayhemAugmentCheck(list([{ gameId: 1, queueId: 450, gameMode: 'ARAM', mapId: 12 }]), async () => {
      throw new Error('not called');
    });
    expect(r).toEqual({ found: false, gamesRead: 1, queues: ['450/ARAM/map12'] });
  });
});
