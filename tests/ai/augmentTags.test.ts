import { describe, expect, it } from 'vitest';
import { tagWeight } from '../../src/ai/tagWeight.js';
import type { CardOp } from '../../src/ai/cardMath.js';

const proc = (needs?: string) => ({ op: 'proc', trigger: 'on_hit', damage: { flat: 1 }, type: 'true', ...(needs ? { needs } : {}) }) as CardOp;
describe('tag weight (knowledge/fight-rules.md, conditions)', () => {
  it('gives nothing for a card that works on his death', () => {
    expect(tagWeight({ tags: ['on_death', 'cc'] }, [proc()]).weight).toBe(0);
  });
  it('halves a card whose condition the fight does not check, and keeps one whose ops carry it', () => {
    expect(tagWeight({ tags: ['condition:hit enemy vital'] }, [proc()])).toEqual({ weight: 0.5, unread: true });
    expect(tagWeight({ tags: ['condition:hit from over 600 units'] }, [proc('ranged; beyond 600 range')])).toEqual({ weight: 1, unread: false });
    expect(tagWeight(undefined, [proc()]).weight).toBe(1);
  });
});
