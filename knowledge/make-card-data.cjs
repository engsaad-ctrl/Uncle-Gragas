// Writes src/ai/cardMathData.ts from the numbers read out of the game's texts. Run by hand when a patch changes the texts:
//   node knowledge/make-card-data.cjs
const fs = require('fs');
const lines = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
// The generated file previously contained manual fixes absent from these inputs. Preserve their definitions explicitly.
const overrides = JSON.parse(fs.readFileSync('knowledge/math-overrides.json', 'utf8'));
if (overrides.schema !== 1) throw new Error('unsupported math-overrides schema');
const unchangedInput = (actual, expected, label) => {
  if (JSON.stringify(actual ?? null) !== JSON.stringify(expected)) throw new Error('changed generator input; review preserved override: ' + label);
};
const mergeRows = (rows, patches, expected) => {
  if (!Array.isArray(patches)) throw new Error('bad math-overrides rows');
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== rows.length || new Set(patches.map((row) => row.id)).size !== patches.length) throw new Error('duplicate math id');
  for (const patch of patches) {
    if (!Number.isSafeInteger(patch.id) || patch.id <= 0 || !Array.isArray(patch.ops)) throw new Error('bad math override');
    if (!Object.hasOwn(expected, patch.id)) throw new Error('missing expected input for math override');
    unchangedInput(byId.get(patch.id), expected[patch.id], patch.id);
    byId.set(patch.id, patch);
  }
  return [...byId.values()];
};
const timed = new Map(lines('knowledge/card-timed.jsonl').map((c) => [c.id, c]));
const needs = new Map(lines('knowledge/card-needs.jsonl').map((c) => [c.id, c]));
// Numbers read from the game's mode files; each line's ops is the card's whole list. knowledge/augment-math-file-report.md says what's still open.
const fromFile = new Map(lines('knowledge/augment-math-file.jsonl').map((c) => [c.id, c]));
// Conditions the text states and the first reading ran as always on, found by comparing predicted and real damage. Each line says why.
const fixes = new Map([...lines('knowledge/card-fixes.jsonl'), ...lines('knowledge/card-fixes-2.jsonl'), ...lines('knowledge/card-fixes-3.jsonl'), ...lines('knowledge/card-fixes-4.jsonl')].map((c) => [c.name, c]));
// Conditions the reading put on the wrong side: these cards' text gives ranged values too.
const BOTH_RANGES = new Set(['The Boom and the Bass', "Take'em Down Down Down", 'Scoped Weapons', 'Scoper Weapons', 'Scopiest Weapons', 'Scopier Weapons']);
const SECONDS = 15;
const cardsRead = [1, 2, 3].flatMap((n) => lines(`knowledge/augment-math-${n}.jsonl`)).map((c) => {
  const t = timed.get(c.id), need = BOTH_RANGES.has(c.name) ? { ...needs.get(c.id), class: 'always' } : needs.get(c.id);
  const fix = fixes.get(c.name);
  // Ops read from the game's files bring that reading's status and limits; the text reading's note ("no number is given") no longer applies.
  const file = !fix?.ops && fromFile.get(c.id);
  const notModelled = fix?.not_modelled ?? (file ? file.not_modelled : t?.not_modelled ?? c.not_modelled);
  let ops = fix?.ops ?? (file ? file.ops : undefined) ?? need?.ops_fix ?? t?.ops ?? c.ops ?? [];
  if (need?.class === 'window' && need.window?.seconds) {
    // Only part of a fight falls in the window, so a lasting effect counts for that share of it.
    const share = Math.min(1, need.window.seconds / Math.max(SECONDS, need.window.cooldown ?? 0));
    ops = ops.map((x) => (x.op === 'damage_amp' || x.op === 'mult' ? { ...x, factor: 1 + (x.factor - 1) * share } : x.op === 'add' && typeof x.value === 'number' ? { ...x, value: x.value * share } : x));
  }
  return { id: c.id, name: c.name, status: file ? file.status : c.status, ops, ...(need ? { need: { class: need.class, items: need.items ?? null, ability_kind: need.ability_kind ?? null } } : {}), ...(c.needs ? { needs: c.needs } : {}), ...(notModelled ? { not_modelled: notModelled } : {}) };
});
const cards = mergeRows(cardsRead, overrides.cards, overrides.expectedInputs.cards);
// Passives read again with the game's calculation records; these replace the first reading.
const passiveAgain = new Map([1, 2].flatMap((n) => lines(`knowledge/champion-math-file-${n}.jsonl`)).map((p) => [p.id, p]));
const passivesRead = [1, 2, 3, 4, 5, 6].flatMap((n) => lines(`knowledge/champion-math-${n}.jsonl`)).map((p) => passiveAgain.get(p.id) ?? p).map((p) => ({ id: p.id, ops: p.ops ?? [] }));
// Kits' own self healing, read per ability (knowledge/heal-brief.md, 2026-11-05), joins the passive's ops.
const kitHeal = [1, 2, 3].flatMap((n) => (fs.existsSync(`knowledge/champion-heal-${n}.jsonl`) ? lines(`knowledge/champion-heal-${n}.jsonl`) : []));
for (const h of kitHeal) { const p = passivesRead.find((x) => x.id === h.id); if (p) p.ops = [...p.ops, ...(h.ops ?? [])]; else passivesRead.push({ id: h.id, ops: h.ops ?? [] }); }
const passives = mergeRows(passivesRead.filter((p) => p.ops.length), overrides.passives, overrides.expectedInputs.passives);
// What an item's condition does in the fixed fight of 15 seconds on one target with no allies. Null: it can't happen there. Otherwise the share of the fight it holds.
const itemShare = (needs) => {
  const n = String(needs ?? '');
  if (/without damage|an ally|lowest health ally|only heals and shields|aura names|only abilities with immobilizing/i.test(n)) return null;
  const combat = /(\d+) seconds? (?:in|of) (?:champion )?combat/i.exec(n);
  if (combat) return (SECONDS - +combat[1]) / SECONDS;
  const below = /target below (\d+)% health/i.exec(n);
  if (below) return +below[1] / 100;
  const immobile = /(\d+) ?s(?:econds)? after an immobilize|immobilized in the last (\d+)s/i.exec(n);
  if (immobile) return +(immobile[1] ?? immobile[2]) / SECONDS;
  if (/full value only at high missing health/i.test(n)) return 0.5;
  // shortcut: the file says 9 stacks an attack; that 100 make an Energized Attack is from memory. Check on screen.
  if (/energized attacks only/i.test(n)) return 0.09;
  return 1;
};
const scaleOp = (x, share) => (x.op === 'damage_amp' || x.op === 'mult' ? { ...x, factor: 1 + (x.factor - 1) * share } : x.op === 'add' && typeof x.value === 'number' ? { ...x, value: x.value * share } : x.op === 'proc' && share < 1 ? { ...x, damage: Object.fromEntries(Object.entries(x.damage).map(([k, v]) => [k, typeof v === 'number' ? v * share : { min: v.min * share, max: v.max * share }])) } : x);
const reread = new Map(lines('knowledge/item-math-3.jsonl').map((p) => [p.id, p]));
const itemsRead = [1, 2].flatMap((n) => lines(`knowledge/item-math-${n}.jsonl`)).map((p) => reread.get(p.id) ?? p).filter((p) => p.ops?.length).map((p) => ({ id: p.id % 10000, ops: p.ops.flatMap((x) => {
  const share = itemShare(x.needs);
  if (share === null) return [];
  const y = scaleOp(x, share);
  return y.op === 'damage_amp' && /magic/i.test(String(x.needs ?? '')) ? [{ ...y, scope: 'magic' }] : [y];
}) })).filter((p) => p.ops.length);
const items = mergeRows(itemsRead, overrides.items, overrides.expectedInputs.items);
// How many times a cast hits one target, or which of its numbers is the normal one: read from each ability's text and calculation names.
const hitsRead = Object.fromEntries([1, 2, 3].flatMap((n) => lines(`knowledge/spell-hits-${n}.jsonl`)).map((h) => [h.path, { hits: h.hits ?? 1, ...(h.calc ? { calc: h.calc } : {}), ...(h.notModelled ? { notModelled: h.notModelled } : {}) }]));
for (const key of Object.keys(overrides.spellHits)) {
  if (!Object.hasOwn(overrides.expectedInputs.spellHits, key)) throw new Error('missing expected spell hit input');
  unchangedInput(hitsRead[key], overrides.expectedInputs.spellHits[key], key);
}
const hits = { ...hitsRead, ...overrides.spellHits };
const out = `// Generated by knowledge/make-card-data.cjs: the numbers in each augment's and champion passive's game text, patch 16.21, read by a model and not yet
// checked one by one in the game. No pick, buy or win rates. See src/ai/cardMath.ts.
import type { CardNumbers, CardNeed, CardOp } from './cardMath.js';

export const CARD_NUMBERS: (CardNumbers & { need?: CardNeed })[] = ${JSON.stringify(cards)} as (CardNumbers & { need?: CardNeed })[];

export const PASSIVE_NUMBERS: { id: number; ops: CardOp[] }[] = ${JSON.stringify(passives)} as { id: number; ops: CardOp[] }[];

export const SPELL_HITS: Record<string, { hits: number; calc?: string; targetBonusHealth?: boolean; notModelled?: string }> = ${JSON.stringify(hits)};
export const ITEM_NUMBERS: { id: number; ops: CardOp[] }[] = ${JSON.stringify(items)} as { id: number; ops: CardOp[] }[];
`;
let output = 'src/ai/cardMathData.ts', check = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--check') check = true;
  else if (arg === '--out' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) output = process.argv[++i];
  else throw new Error('usage: node knowledge/make-card-data.cjs [--check] [--out FILE]');
}
if (check) {
  const actual = fs.existsSync(output) ? fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n') : '';
  if (actual !== out) { console.error('Math data is stale:', output); process.exitCode = 1; }
  else console.log('Math data matches generator inputs:', output);
} else {
  fs.writeFileSync(output, out);
  console.log('cards', cards.length, 'with numbers', cards.filter((c) => c.ops.length).length, 'passives', passives.length, 'bytes', out.length);
}
