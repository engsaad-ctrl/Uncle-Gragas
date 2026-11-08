import { describe, expect, it } from 'vitest';
import { itemsByChampion } from '../../src/lcu/liveGame.js';

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
