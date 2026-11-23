import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fight, type CardNumbers } from '../../src/ai/cardMath.js';
import { SPELL_HITS, ITEM_NUMBERS } from '../../src/ai/cardMathData.js';

// T208: the immobilize table moved from two hand rows (Morgana Q, Lux Q) to knowledge/immobilize-1.jsonl, each row an ability whose landed hit
// immobilizes the champion hit, checked against its own tooltip; generated onto its SPELL_HITS row as `cc`. Fixtures: the 16.22 record and spell.
const itemOps = Object.fromEntries(ITEM_NUMBERS.map((item) => [item.id, item.ops]));
const load = (file: string) => JSON.parse(readFileSync(`tests/fixtures/game/${file}-16.22.json`, 'utf8'));
const counter: CardNumbers = { id: 990208, name: 'CC counter', status: 'computed', ops: [{ op: 'proc', trigger: 'immobilize_hit', damage: { flat: 100 }, type: 'true' }] } as CardNumbers;
const run = (f: { bin: Record<string, unknown> }, key: 'Q' | 'E', level: number, rank: number) => fight({
  bin: f.bin as never, shop: {}, itemOps, items: [], passive: [], level, kit: { damage: 'magic', attacks: false },
  knownRanks: { level, ranks: { Q: 0, W: 0, E: 0, R: 0, [key]: rank } },
  cards: [counter], enemy: { hp: 2500, armor: 0, mr: 0, physicalShare: 0.5 },
});

it.each([[3, 1], [9, 5]])('Amumu Q (a checked row) stuns on each landed cast for StunDuration; an immobilize card fires once a cast (level %s rank %s)', (level, rank) => {
  const f = load('amumu-q');
  expect(SPELL_HITS[f.path]?.cc).toEqual({ field: 'StunDuration', kind: 'stun' });
  const r = run(f, 'Q', level, rank);
  const stun = f.bin[f.path].mSpell.DataValues.find((d: { name: string }) => d.name === 'StunDuration').values[rank];
  expect(r.casts.Q).toBeGreaterThan(0);
  expect(r.ccEvents.length).toBe(r.casts.Q);
  expect(r.ccEvents.every((e) => e.kind === 'stun' && e.duration === stun && e.key === 'Q')).toBe(true);
  expect(r.fromCards).toBeCloseTo(100 * r.casts.Q, 6);
});

it('Vayne E (stuns only into a wall: conditional, not in the table) raises no immobilize event', () => {
  const f = load('vayne-e');
  expect(SPELL_HITS[f.path]?.cc).toBeUndefined();
  const r = run(f, 'E', 9, 5);
  expect(r.casts.E).toBeGreaterThan(0);
  expect(r.ccEvents.length).toBe(0);
  expect(r.fromCards).toBe(0);
});

it('every table row names a duration field and an immobilize kind', () => {
  const rows = Object.entries(SPELL_HITS).filter(([, r]) => r.cc);
  expect(rows.length).toBeGreaterThan(70);
  for (const [, r] of rows) expect(['stun', 'root', 'knockup', 'suppression', 'sleep']).toContain(r.cc!.kind);
  expect(rows.every(([, r]) => /\w/.test(r.cc!.field) && !/^Effect\d/.test(r.cc!.field))).toBe(true);
});
