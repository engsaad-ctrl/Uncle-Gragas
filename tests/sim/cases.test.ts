// Fixed fight cases (tests/fixtures/sim/cases.json) run on pinned 16.22 files with no network, no APPDATA and a throwaway cache.
// The report (tests/fixtures/sim/report.json) is the record: the same inputs give the same file, and a change to the engine shows as a diff of it.
// Rerun: node node_modules/vitest/vitest.mjs run tests/sim --configLoader runner   (add -u only to accept a change you can explain).
// Model quantities in one 15 s fight; no win chance, no ranking of choices.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { kitWithCards } from '../../src/ai/augmentChoice.js';
import { cardFromFiles } from '../../src/ai/augmentFiles.js';
import { explainBuild } from '../../src/ai/buildExplanation.js';
import { FIGHT, fight, type CardNumbers, type CardOp, type EnemyTeam, type FightResult } from '../../src/ai/cardMath.js';
import { CARD_NUMBERS, ITEM_NUMBERS, PASSIVE_NUMBERS } from '../../src/ai/cardMathData.js';
import type { TargetAbility } from '../../src/ai/abilityTarget.js';
import type { SkillPlan } from '../../src/ai/abilityRank.js';
import { fightKitOf } from '../../src/main/services.js';
import { buildAugmentTexts, type AugmentGameData } from '../../src/texts/augments.js';
import { augmentDataOnly } from '../../src/texts/augmentsLoader.js';
import { withDamageTypes } from '../../src/texts/damageTypes.js';
import { GAME_URLS, loadChampionBin, loadGameItems } from '../../src/texts/gameData.js';

const DIR = 'tests/fixtures/sim/16.22/';
const manifest = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8')) as { contentVersion: string; files: { path: string; sha256: string }[] };
interface Case {
  name: string; champion: { id: number; alias: string }; level: number; stacks?: number; incomingDps?: number;
  items: number[]; augments: { id: number; acquiredLevel: number; abilityKey?: TargetAbility }[]; enemy: EnemyTeam; skillPlan?: SkillPlan;
  variants?: { label: string; replace?: { id: number; ops: CardOp[] }; patch?: string; abilityKey?: null; skillPlan?: SkillPlan; noDamageTypes?: boolean }[];
}
const { cases } = JSON.parse(readFileSync('tests/fixtures/sim/cases.json', 'utf8')) as { cases: Case[] };
// The six champions' spell tooltips from the Arabic string table the app reads, for each hit's damage type.
const TOOLTIPS = JSON.parse(readFileSync(DIR + 'tooltips.cut.json', 'utf8')) as Record<string, string>;

// The URLs the loaders ask for, served from the pinned files; anything else is refused.
const served = new Map<string, string>([[GAME_URLS.items, DIR + 'items.cut.bin.json'], ...cases.map((c) => [GAME_URLS.championBin(c.champion.alias), `${DIR}champions/${c.champion.alias}.bin.json`] as [string, string])]);
const fetchImpl = (async (url: string) => { const path = served.get(String(url)); if (!path) throw new Error(`not pinned: ${url}`); return new Response(readFileSync(path)); }) as typeof fetch;
const cacheDir = mkdtempSync(join(tmpdir(), 'ug-sim-'));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));
const opts = { cacheDir, fetchImpl };

// Augments read from the patch file (src/ai/augmentFiles.ts), through the same loader steps the app uses, from pinned cuts of each patch's kiwi file.
const FILE_READ: Record<number, { file: string; nameId: string; name: string }> = {
  3086: { file: 'tests/fixtures/game/bees-16.21-16.22.json', nameId: 'BEES', name: 'BEES!!!' },
  2062: { file: 'tests/fixtures/game/echo-16.21-16.22.json', nameId: 'Ability_SelfAOE_DoubleCast', name: 'Echo Cast' },
  1019: { file: 'tests/fixtures/game/dashing-16.21-16.22.json', nameId: 'ARAM_Dashing', name: 'Dashing' },
};
const gameOf = async (id: number, patch: string): Promise<AugmentGameData | undefined> => {
  const f = FILE_READ[id];
  if (!f) return undefined;
  const bin = (JSON.parse(readFileSync(f.file, 'utf8')) as { patches: Record<string, { bin: Record<string, unknown> }> }).patches[patch]!.bin;
  const entry = { id, augmentNameId: f.nameId, nameTRA: f.name, augmentSmallIconPath: 'x.png', rarity: 'kGold' };
  return (await buildAugmentTexts({ listAr: [entry], listEn: [entry], bins: [augmentDataOnly(bin)], strings: {} }))[0]?.game;
};
const ITEM_OPS = Object.fromEntries(ITEM_NUMBERS.map((i) => [i.id, i.ops]));

const r2 = (x: number) => Math.round(x * 100) / 100;
const round = (v: unknown): unknown => typeof v === 'number' ? r2(v) : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
const units = (r: FightResult) => round({
  damage: r.damage, fromAbilities: r.fromAbilities, fromAttacks: r.fromAttacks, fromCards: r.fromCards, fromAllies: r.fromAllies ?? 0,
  effectiveHp: r.effectiveHp, healedHp: r.healedHp, abilityHealing: r.abilityHealing, healingDenied: r.healingDenied,
  attacks: r.attacks, casts: r.casts, perCast: r.perCast, stats: r.stats,
}) as Record<string, number>;

async function run(c: Case, v?: NonNullable<Case['variants']>[number]) {
  const [rawBin, shop] = await Promise.all([loadChampionBin(opts, manifest.contentVersion, c.champion.alias), loadGameItems(opts, manifest.contentVersion)]);
  const bin = v?.noDamageTypes ? rawBin : withDamageTypes(rawBin, TOOLTIPS);
  const games = new Map(await Promise.all(c.augments.map(async (a) => [a.id, await gameOf(a.id, v?.patch ?? '16.22')] as const)));
  const cards = c.augments.map((a): CardNumbers => {
    const stored = CARD_NUMBERS.find((x) => x.id === a.id);
    if (!stored) throw new Error(`no card ${a.id}`);
    const card = v?.replace?.id === a.id ? { ...stored, ops: v.replace.ops } : cardFromFiles(stored, games.get(a.id));
    return { ...card, acquiredLevel: a.acquiredLevel, abilityKey: v?.abilityKey === null ? undefined : a.abilityKey };
  });
  const input = {
    bin, shop, level: c.level, items: c.items, cards, itemOps: ITEM_OPS, enemy: c.enemy, stacks: c.stacks, incomingDps: c.incomingDps, skillPlan: v?.skillPlan ?? c.skillPlan,
    kit: kitWithCards(fightKitOf(c.champion.id), cards), passive: PASSIVE_NUMBERS.find((p) => p.id === c.champion.id)?.ops ?? [],
  };
  const result = fight(input), why = explainBuild(input);
  // Each augment: F(all) - F(without it), in the same units; not shares of the total.
  const without = (i: number) => { const rest = cards.filter((_, j) => j !== i); return units(fight({ ...input, cards: rest, kit: kitWithCards(fightKitOf(c.champion.id), rest) })); };
  const base = units(result);
  // Events behind a card that is one damage op: its damage set to 1 true damage (no on-hit), the gain is the hits it lands in the fight
  // (a delayed hit cut by the fight's end counts its share of ticks), times any all-damage amp. Divides a change into count x size.
  const unit = (x: CardOp): CardOp => (x.op === 'delayed_dot' ? { ...x, damage: { flat: 1 }, type: 'true', onHitEfficacy: 0 } : { ...x, damage: { flat: 1 }, type: 'true' } as CardOp);
  const hits = cards.flatMap((card, i) => {
    if (card.ops.length !== 1 || (card.ops[0]!.op !== 'proc' && card.ops[0]!.op !== 'delayed_dot')) return [];
    const probe = cards.map((x, j) => (j === i ? { ...x, ops: [unit(x.ops[0]!)] } : x));
    return [{ id: card.id, op: card.ops[0]!.op, landed: r2(fight({ ...input, cards: probe }).fromCards - without(i).fromCards!) }];
  });
  return {
    units: base,
    hits,
    augments: cards.map((card, i) => { const w = without(i); return { id: card.id, name: card.name, delta: Object.fromEntries(['damage', 'fromCards', 'effectiveHp', 'healedHp'].map((k) => [k, r2(base[k]! - w[k]!)])) }; }),
    items: why.items.map((i) => ({ id: i.id, delta: round(i.delta), interactions: i.interactions.map((x) => ({ kind: x.kind, id: x.id, delta: round(x.delta) })) })),
    notModelled: [...new Set(result.notModelled)],
  };
}

describe('fixed fight cases on pinned 16.22 files', () => {
  it('uses the immediate Gragas Q damage and exposes the unmodelled charge', async () => {
    const rawBin = await loadChampionBin(opts, manifest.contentVersion, 'gragas');
    const r = fight({
      bin: withDamageTypes(rawBin, TOOLTIPS), shop: {}, kit: fightKitOf(79),
      items: [], cards: [], level: 1, knownRanks: { level: 1, ranks: { Q: 1, W: 0, E: 0, R: 0 } },
    });
    expect(r.perCast.Q).toBe(80); // MinDamage at rank 1, with zero AP
    expect(r.notModelled.join(' ')).toContain('Gragas Q');
  });
  it('reads only the pinned files, unchanged', () => {
    for (const f of manifest.files) expect(createHash('sha256').update(readFileSync(DIR + f.path)).digest('hex'), f.path).toBe(f.sha256);
  });
  it('gives the stored report', async () => {
    const report = [];
    for (const c of cases) {
      const base = await run(c);
      const variants = [];
      for (const v of c.variants ?? []) {
        const r = await run(c, v);
        const change = Object.fromEntries(['damage', 'fromCards', 'effectiveHp', 'healedHp'].map((k) => [k, r2(r.units[k]! - base.units[k]!)]));
        variants.push({ label: v.label, change, hits: r.hits, units: r.units, notModelled: r.notModelled });
      }
      report.push({ name: c.name, inputs: { champion: c.champion, level: c.level, stacks: c.stacks, skillPlan: c.skillPlan, items: c.items, augments: c.augments, enemy: c.enemy, incomingDps: c.incomingDps ?? FIGHT.incomingDps, seconds: FIGHT.seconds }, ...base, variants });
    }
    await expect(`${JSON.stringify({ patch: manifest.contentVersion, report }, null, 1)}\n`).toMatchFileSnapshot('../fixtures/sim/report.json');
  });
  it.each([[1, 144], [2, 194]])('adds rank %i Jayce melee E max-health damage as magic', async (rank, expected) => {
    const rawBin = await loadChampionBin(opts, manifest.contentVersion, 'jayce');
    const r = fight({
      bin: withDamageTypes(rawBin, TOOLTIPS), shop: {}, kit: { damage: 'physical', attacks: false },
      items: [], cards: [], level: 3, knownRanks: { level: 3, ranks: { Q: 0, W: 0, E: rank, R: 0 } },
      enemy: { armor: 0, mr: 100, physicalShare: 0.5, hp: 1800 },
    });
    expect(r.perCast.E).toBe(expected);
    expect(r.fromAbilities / r.casts.E!).toBeCloseTo(rank === 1 ? 72 : 97.2);
    expect(r.notModelled.join(' ')).toContain('Jayce E');
  });
  it('deals Nasus R max-health magic damage over the storm instead of on cast', async () => {
    const rawBin = await loadChampionBin(opts, manifest.contentVersion, 'nasus');
    const cast = (rank: number) => fight({
      bin: withDamageTypes(rawBin, TOOLTIPS), shop: {}, kit: { damage: 'physical', attacks: false },
      items: [], cards: [], level: 6, knownRanks: { level: 6, ranks: { Q: 0, W: 0, E: 0, R: rank } },
      enemy: { armor: 0, mr: 100, physicalShare: 0.5, hp: 2000 },
    });
    const r = cast(1), base = cast(0);
    expect(r.casts.R).toBe(1);
    expect(r.fromAbilities).toBeCloseTo(450); // 3% of 2000 per second, for 15 s, halved by 100 MR
    expect(r.damageBySecond[0]! - base.damageBySecond[0]!).toBeCloseTo(30);
    expect(r.notModelled.join(' ')).toContain('Nasus R');
  });
  it('shortens only the cooldown of a landed Gragas E using the pinned refund', async () => {
    const rawBin = await loadChampionBin(opts, manifest.contentVersion, 'gragas');
    const bin = withDamageTypes(rawBin, TOOLTIPS);
    const cards: CardNumbers[] = [{ id: 0, name: 'Test haste', status: 'computed', ops: [{ op: 'add', stat: 'haste', value: 20 }] }];
    const options = { shop: {}, kit: { damage: 'magic' as const, attacks: false }, items: [], cards, level: 9, knownRanks: { level: 9, ranks: { Q: 1, W: 0, E: 5, R: 0 } } };
    const r = fight({ ...options, bin });
    const path = 'Characters/Gragas/Spells/GragasEAbility/GragasE';
    const entry = bin[path] as { mSpell: { DataValues: { name: string }[] } };
    const withoutRefund = { ...bin, [path]: { ...entry, mSpell: { ...entry.mSpell, DataValues: entry.mSpell.DataValues.filter((v) => v.name !== 'CooldownRefund') } } };
    const base = fight({ ...options, bin: withoutRefund });
    expect(base.casts.E).toBe(2);
    expect(r.casts.E).toBe(3);
    expect(r.casts.Q).toBe(base.casts.Q);
    expect(r.notModelled.join(' ')).toContain('Gragas E');
  });
  it('uses the pinned Nasus Q cooldown reduction only for casts during R', async () => {
    const rawBin = await loadChampionBin(opts, manifest.contentVersion, 'nasus');
    const bin = withDamageTypes(rawBin, TOOLTIPS);
    const path = 'Characters/Nasus/Spells/NasusRAbility/NasusR';
    const entry = bin[path] as { mSpell: { DataValues: { name: string; values: number[] }[] } };
    const countQ = (data = entry.mSpell.DataValues) => fight({
      bin: { ...bin, [path]: { ...entry, mSpell: { ...entry.mSpell, DataValues: data } } },
      shop: {}, kit: { damage: 'physical', attacks: true }, items: [], cards: [], level: 6,
      knownRanks: { level: 6, ranks: { Q: 1, W: 0, E: 0, R: 1 } },
    }).casts.Q;
    expect(countQ(entry.mSpell.DataValues.filter((v) => v.name !== 'QCDR'))).toBe(2);
    expect(countQ()).toBe(4);
    expect(countQ(entry.mSpell.DataValues.map((v) => v.name === 'Duration' ? { ...v, values: v.values.map(() => 1) } : v))).toBe(3);
  });
  it('does not award Karthus E mana for simulated target changes without kill credit', async () => {
    const bin = await loadChampionBin(opts, manifest.contentVersion, 'karthus');
    const path = 'Characters/Karthus/Spells/KarthusDefileAbility/KarthusDefile';
    const entry = bin[path] as { mSpell: { DataValues: { name: string }[] } };
    const withoutRestore = { ...bin, [path]: { ...entry, mSpell: { ...entry.mSpell, DataValues: entry.mSpell.DataValues.filter((v) => v.name !== 'ManaRestoreOnKill') } } };
    const countQ = (input: typeof bin) => fight({
      bin: input, shop: {}, kit: { damage: 'magic', attacks: false }, items: [], cards: [], level: 2, mana: 55,
      knownRanks: { level: 2, ranks: { Q: 1, W: 0, E: 1, R: 0 } },
    }).casts.Q;
    expect(countQ(withoutRestore)).toBe(2);
    expect(countQ(bin)).toBe(2);
  });
  it('weights Nasus R bonus health and resists by its active time', async () => {
    const bin = await loadChampionBin(opts, manifest.contentVersion, 'nasus');
    const run = (ready: number) => fight({
      bin, shop: {}, kit: { damage: 'physical', attacks: true }, items: [], cards: [], level: 6,
      knownRanks: { level: 6, ranks: { Q: 0, W: 0, E: 0, R: 1 } }, cooldowns: { R: ready },
    });
    const base = run(16);
    for (const [ready, share] of [[0, 1], [7.49, 0.5]] as const) {
      const r = run(ready);
      expect(r.stats.hp - base.stats.hp).toBeCloseTo(300 * share);
      expect(r.stats.armor - base.stats.armor).toBeCloseTo(40 * share);
      expect(r.stats.mr - base.stats.mr).toBeCloseTo(40 * share);
      expect(r.effectiveHp).toBeGreaterThan(base.effectiveHp);
    }
  });
});
