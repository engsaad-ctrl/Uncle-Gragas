import { describe, expect, it } from 'vitest';
import { scrub } from '../../src/lcu/diagnostics.js';
import { toLcuState } from '../../src/lcu/state.js';

// Synthetic answers in the shape the LCU documents (/lol-gameflow/v1/session, /lol-champ-select/v1/session).
const flow = (gameMode: string, queueId: number, mapId = 11) => ({ phase: 'ChampSelect', gameData: { queue: { id: queueId, gameMode, mapId } } });
const select = (me: Record<string, unknown>) => ({
  localPlayerCellId: 2,
  myTeam: [{ cellId: 1, championId: 99, championPickIntent: 0, assignedPosition: 'top' }, { cellId: 2, ...me }],
  theirTeam: [{ cellId: 5, championId: 238 }],
});

describe('toLcuState', () => {
  it('reads my hovered champion, lane and mode in ranked', () => {
    const s = toLcuState('ChampSelect', flow('CLASSIC', 420), select({ championId: 0, championPickIntent: 103, assignedPosition: 'middle' }));
    expect(s).toEqual({ phase: 'ChampSelect', mode: 'normal', queueId: 420, gameMode: 'CLASSIC', championId: 103, locked: false, position: 'mid' });
  });

  it('prefers the locked champion over the hover and maps every lane name', () => {
    const lanes = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support', '': null } as const;
    for (const [lcu, ours] of Object.entries(lanes)) {
      const s = toLcuState('ChampSelect', flow('CLASSIC', 420), select({ championId: 64, championPickIntent: 103, assignedPosition: lcu }));
      expect(s).toMatchObject({ championId: 64, locked: true, position: ours });
    }
  });

  it('maps game modes to app modes', () => {
    expect(toLcuState('ChampSelect', flow('ARAM', 450, 12), select({ championId: 1 })).mode).toBe('aram');
    expect(toLcuState('ChampSelect', flow('CHERRY', 1700, 30), select({ championId: 1 })).mode).toBe('arena');
    expect(toLcuState('ChampSelect', flow('KIWI', 2400, 12), select({ championId: 1 })).mode).toBe('mayhem');
    expect(toLcuState('ChampSelect', flow('URF', 900), select({ championId: 1 })).mode).toBeNull();
  });

  it('carries no champion outside champ select', () => {
    expect(toLcuState('Lobby', flow('CLASSIC', 420), null)).toMatchObject({ phase: 'Lobby', championId: null, position: null });
    expect(toLcuState('ChampSelect', flow('CLASSIC', 420), select({ championId: 0, championPickIntent: 0 })).championId).toBeNull();
  });
});

describe('scrub', () => {
  it('redacts names, ids and secrets anywhere in a nested answer', () => {
    const raw = {
      gameName: 'Me', tagLine: 'EUW', summonerId: 1, puuid: 'abc', accountId: 2,
      myTeam: [{ cellId: 1, championId: 103, summonerName: 'Friend', obfuscatedPuuid: 'x', nameVisibilityType: 'VISIBLE' }],
      chat: { id: 'room@champ-select.pvp.net' }, password: 'p', token: 't',
    };
    expect(scrub(raw)).toEqual({
      gameName: '[حُذف]', tagLine: '[حُذف]', summonerId: '[حُذف]', puuid: '[حُذف]', accountId: '[حُذف]',
      myTeam: [{ cellId: 1, championId: 103, summonerName: '[حُذف]', obfuscatedPuuid: '[حُذف]', nameVisibilityType: 'VISIBLE' }],
      chat: '[حُذف]', password: '[حُذف]', token: '[حُذف]',
    });
  });

  it('keeps what diagnostics need: queue ids, game mode, champion ids, positions', () => {
    const flowAnswer = { gameData: { queue: { id: 2400, gameMode: 'KIWI', mapId: 12 } } };
    expect(scrub(flowAnswer)).toEqual(flowAnswer);
  });
});
