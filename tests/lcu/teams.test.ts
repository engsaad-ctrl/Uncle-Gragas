import { describe, expect, it } from 'vitest';
import { teamsInGame } from '../../src/lcu/teams.js';

describe('teamsInGame', () => {
  const flow = {
    gameData: {
      teamOne: [{ championId: 131, puuid: 'a', riotIdGameName: 'Me' }, { championId: 81, puuid: 'b', summonerName: 'Ally' }],
      teamTwo: [{ championId: 222, puuid: 'c', gameName: 'Foe' }, { championId: 0, puuid: 'd' }],
    },
  };
  it("splits the loading screen's players into the player's team and the enemy's, by the player's champion", () => {
    expect(teamsInGame(flow, 131)).toEqual({
      mine: [{ championId: 131, puuid: 'a', name: 'Me' }, { championId: 81, puuid: 'b', name: 'Ally' }],
      enemy: [{ championId: 222, puuid: 'c', name: 'Foe' }],
    });
    expect(teamsInGame(flow, 222)?.mine.map((p) => p.championId)).toEqual([222]);
  });
  it('gives nothing before a game, or without the player in it', () => {
    expect(teamsInGame(null, 131)).toBeNull();
    expect(teamsInGame(flow, 999)).toBeNull();
    expect(teamsInGame(flow, null)).toBeNull();
  });
});
