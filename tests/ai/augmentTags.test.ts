import { describe, expect, it } from 'vitest';
import { tagWeight } from '../../src/ai/tagWeight.js';
import type { CardOp } from '../../src/ai/cardMath.js';

const proc = (needs?: string) => ({ op: 'proc', trigger: 'on_hit', damage: { flat: 1 }, type: 'true', ...(needs ? { needs } : {}) }) as CardOp;
describe('tag weight (knowledge/fight-rules.md, conditions)', () => {
  it('gives nothing for a card that works on his death', () => {
    expect(tagWeight({ tags: ['on_death', 'cc'] }, [proc()]).weight).toBe(0);
  });
  it('keeps a card whose condition the fight does not check at its full value, open and never certain; one whose ops carry it is settled', () => {
    expect(tagWeight({ tags: ['condition:hit enemy vital'] }, [proc()])).toEqual({ weight: 1, unread: true, open: ['hit enemy vital'] });
    expect(tagWeight({ tags: ['condition:hit from over 600 units'] }, [proc('ranged; beyond 600 range')])).toEqual({ weight: 1, unread: false, open: [] });
  });
  it('settles a condition the fight runs as an event, or that his kit and files show', () => {
    const onTakedown = { op: 'heal', amount: { flat: 50 }, trigger: 'takedown', internal_cooldown: null } as CardOp;
    expect(tagWeight({ tags: ['condition:takedown'] }, [onTakedown]).open).toEqual([]);
    expect(tagWeight({ tags: ['condition:takedown within 5s'] }, [onTakedown]).open).toEqual(['takedown within 5s']); // the window is not run
    expect(tagWeight({ tags: ['condition:keep attacking within 5 s'] }, [{ op: 'proc', trigger: 'attack', damage: { flat: 1 }, type: 'true' } as CardOp]).open).toEqual([]);
    expect(tagWeight({ tags: ['condition:dash or blink'] }, [proc()], 'yes').open).toEqual([]);
    expect(tagWeight({ tags: ['condition:dash or blink'] }, [proc()], 'unknown').open).toEqual(['dash or blink']);
    expect(tagWeight({ tags: ['on_death'] }, [proc()]).weight).toBe(0);
    expect(tagWeight(undefined, [proc()]).weight).toBe(1);
  });
});
