import { describe, expect, it } from 'vitest';
import { augmentEffects, bootstrapWeights, evaluate, fitTeamModel, predictGames, strength } from '../../src/app/teamModel.js';
import type { MayhemGame } from '../../src/lcu/mayhemGames.js';

// Synthetic games: augment 9 wins its team the game far more often; champions 1-10 are equal.
function games(n: number, seed = 1): MayhemGame[] {
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (_, id) => {
    const nine = Math.floor(rand() * 10); // which player has augment 9
    const firstWins = rand() < (nine < 5 ? 0.75 : 0.25);
    const players = Array.from({ length: 10 }, (_, i) => ({ champion: i + 1, win: i < 5 ? firstWins : !firstWins, augments: i === nine ? [9, 100 + i] : [100 + i], items: [] }));
    return { id, at: id, version: '16.21.1', players };
  });
}

describe('team model', () => {
  it('learns a strong augment from team results, and predicts held-out games better than a coin', () => {
    const m = fitTeamModel(games(1500));
    expect(strength(m, 1, [9])).toBeGreaterThan(strength(m, 1, [101]) + 0.1);
    const e = evaluate(predictGames(m, games(500, 99)));
    expect(e.accuracy).toBeGreaterThan(0.65);
    expect(e.logLoss).toBeLessThan(Math.log(2));
  });

  it('gives each augment an effect in points, with a range once bootstrap refits exist', () => {
    const g = games(800);
    const m = fitTeamModel(g);
    let s = 3;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const boot = Array.from({ length: 20 }, () => fitTeamModel(g, bootstrapWeights(g.length, rand)));
    const nine = augmentEffects(m, boot).get(9)!;
    expect(nine.points).toBeGreaterThan(2);
    expect(nine.low).toBeGreaterThan(0); // sure: the whole range is above zero
    expect(augmentEffects(m, []).get(9)!.low).toBeUndefined();
  });
});
