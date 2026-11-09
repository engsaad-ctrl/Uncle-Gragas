import { describe, expect, it } from 'vitest';
import { activeFromLive, itemsByChampion, MatchEpoch, playersByChampion, ranksFromLive, snapshotFromLive } from '../../src/lcu/liveGame.js';

describe('itemsByChampion', () => {
  it("keys each player's held items by his champion's alias, whatever the client's language", () => {
    const list = [
      { championName: 'ملكة القراصنة', rawChampionName: 'game_character_displayname_MissFortune', items: [{ itemID: 3031 }, { itemID: 3006 }] },
      { championName: 'Garen', rawChampionName: 'game_character_displayname_Garen', items: [] },
      { championName: 'broken', items: [{ itemID: 1 }] }, // no raw name: skipped
    ];
    expect(itemsByChampion(list)).toEqual({ MissFortune: [3031, 3006], Garen: [] });
  });
  it('reads nothing from an answer that is not a list', () => {
    expect(itemsByChampion(null)).toEqual({});
    expect(itemsByChampion({ errorCode: 'RESOURCE_NOT_FOUND' })).toEqual({});
  });
});

describe('match identity', () => {
  const session = (gameId: number) => ({ gameData: { gameId } });
  it('keeps recorded choices across a failed poll and reconnect to the same match', () => {
    const epoch = new MatchEpoch();
    expect(epoch.observe('InProgress', session(10))).toBe(true);
    epoch.observe('Disconnected', null);
    expect(epoch.observe('InProgress', session(10))).toBe(false);
    expect(epoch.value).toBe(1);
  });
  it('detects a different match even if it missed the lobby', () => {
    const epoch = new MatchEpoch();
    epoch.observe('InProgress', session(10));
    epoch.observe('Disconnected', null);
    expect(epoch.observe('InProgress', session(11))).toBe(true);
    expect(epoch.value).toBe(2);
  });
  it('starts the next game once when its id becomes available late', () => {
    const epoch = new MatchEpoch();
    epoch.observe('InProgress', session(10));
    epoch.observe('EndOfGame', session(10));
    expect(epoch.observe('InProgress', {})).toBe(true);
    expect(epoch.observe('InProgress', session(11))).toBe(false);
    expect(epoch.value).toBe(2);
  });
});

describe('live progression data', () => {
  it('separates the active player and enemy inventory in a mirror match without returning identities', () => {
    const list = [
      { rawChampionName: 'game_character_displayname_Gragas', riotId: 'mine#ONE', level: 9, team: 'ORDER', items: [{ itemID: 1058 }] },
      { rawChampionName: 'game_character_displayname_Gragas', riotId: 'other#TWO', level: 11, team: 'CHAOS', items: [{ itemID: 3089 }] },
    ];
    expect(playersByChampion(list)).toEqual({});
    expect(snapshotFromLive({ riotId: 'mine#ONE', level: 9 }, list)).toEqual({ players: {}, active: { alias: 'Gragas', level: 9, team: 'ORDER', items: [1058] }, enemies: { Gragas: { level: 11, team: 'CHAOS', items: [3089] } } });
  });
  it('does not substitute the only champion match when active identity is unavailable or conflicting', () => {
    const list = [{ rawChampionName: 'game_character_displayname_Gragas', riotId: 'other#TWO', summonerName: 'same', level: 11, items: [{ itemID: 3089 }] }];
    expect(activeFromLive({}, list)).toBeUndefined();
    expect(activeFromLive({ riotId: 'mine#ONE', summonerName: 'same' }, list)).toBeUndefined();
    expect(snapshotFromLive({}, null)).toBeNull();
  });
  it('returns the actual champion level and inventory without identifying fields', () => {
    expect(playersByChampion([{ rawChampionName: 'game_character_displayname_Gragas', level: 9, summonerName: 'private', riotId: 'private#123', items: [{ itemID: 1058 }] }])).toEqual({ Gragas: { level: 9, items: [1058] } });
  });
  it('rejects malformed levels, item ids and unsafe aliases', () => {
    expect(playersByChampion([{ rawChampionName: 'game_character_displayname_Gragas', level: '9', items: [{ itemID: '3089' }, { itemID: -1 }, { itemID: 1.2 }, { itemID: 3089 }] }, { rawChampionName: 'game_character_displayname___proto__', level: 9 }])).toEqual({ Gragas: { items: [3089] } });
    expect(playersByChampion(null)).toEqual({});
  });
});

describe('live skill ranks', () => {
  it('reads Q W E R ranks of the active player only, with no identity, and drops odd values', () => {
    const list = [{ rawChampionName: 'game_character_displayname_Gragas', riotId: 'mine#ONE', level: 9, team: 'ORDER', items: [] }];
    const abilities = { Passive: { displayName: 'x' }, Q: { abilityLevel: 5, displayName: 'Barrel Roll', id: 'GragasQ' }, W: { abilityLevel: 1 }, E: { abilityLevel: 2.5 }, R: { abilityLevel: 1 } };
    expect(activeFromLive({ riotId: 'mine#ONE', level: 9, abilities: { ...abilities, E: { abilityLevel: 2 } } }, list)).toEqual({ alias: 'Gragas', level: 9, team: 'ORDER', items: [], ranks: { Q: 5, W: 1, E: 2, R: 1 } });
    expect(activeFromLive({ riotId: 'mine#ONE', level: 9, abilities }, list)).toEqual({ alias: 'Gragas', level: 9, team: 'ORDER', items: [] }); // E 2.5: no ranks
    expect(ranksFromLive({ Q: { abilityLevel: 7 } })).toBeUndefined();
    expect(ranksFromLive(null)).toBeUndefined();
  });
});

it('reads no ranks at all when one of Q W E R is missing or odd, rather than taking it as rank 0', () => {
  expect(ranksFromLive({ Q: { abilityLevel: 5 }, W: { abilityLevel: 1 }, E: { abilityLevel: 2.5 }, R: { abilityLevel: 1 } })).toBeUndefined();
  expect(ranksFromLive({ Q: { abilityLevel: 1 }, W: { abilityLevel: 0 }, E: { abilityLevel: 0 }, R: { abilityLevel: 0 } })).toEqual({ Q: 1, W: 0, E: 0, R: 0 });
});
