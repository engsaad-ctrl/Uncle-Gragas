// Would the engine, shown the same augment offers as a creator, take a path like his? (the owner, T024, 2026-11-11)
// A measure, not a gate on its own: it reads the creators' recorded rounds (knowledge/notes-300/creator-offers-2026-11-10.jsonl) and
// purchases (creator-items-2026-11-10.jsonl) and asks the app's own services the questions the overlay asks.
//   (a) on the creator's history: at each round his earlier picks and the items proven bought before the round, the offer ranked
//       as the walk ranks it (cardValues, then rankOffer); dominantOffer for stage and plan together, apart.
//   (b) the engine's own path: no augments, each recorded offer in order, the engine's own pick carried on. Two branches: the
//       app's decision (dominantOffer; no decision stops the branch) and the walk's first card (the stage order only, not a plan pick).
// Level: Mayhem's unlock levels (AUGMENT_LEVELS 3/7/11/15) are a derived phase, not an observed level; one Superfans round at 21 is
// an event from the note. Only `level` is sent: the history's levels stay estimated (no acquiredLevels, no historyComplete).
// Usage, from the repo root after the build, APPDATA on the snapshot:
//   node scripts/checks/creator-path.mjs [--dist=<dist folder>] [--out=<file>] [--json=<file>] [--only=Veigar,Qiyana] [--self-check]
// The text result goes next to the script (creator-path.txt) unless --out says otherwise; its first line is the date and the code.
// Data or service errors stop with exit 1 (a name that maps to no id, or to another id, is one). Unknowns are counted, never dropped.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const norm = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const EPS = 1e-12;
const TRUSTED = new Set(['screen']), SAID = new Set(['screen', 'said']);

/** "m:ss", "m:ss.s", "by m:ss" or "a-b" (the later end) in seconds; undefined when the note gives no time. */
export function seconds(t) {
  if (!t) return undefined;
  const last = String(t).replace(/^by\s+/, '').split('-').pop().trim();
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(last);
  if (!m) throw new Error(`bad time "${t}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** One id for a name: exactly one Mayhem augment with that normalized name, and the id the file stored. Anything else is a data error. */
export function checkAugment(augs, name, storedId) {
  const found = augs.filter((a) => a.modes.includes('mayhem') && norm(a.enName) === norm(name));
  if (found.length !== 1) throw new Error(`augment "${name}": ${found.length} matches`);
  if (storedId !== undefined && found[0].id !== storedId) throw new Error(`augment "${name}": file says ${storedId}, the data says ${found[0].id}`);
  return found[0];
}

/** What the creator had when a round opened: his picks before it (a transmute as what it became) and the items proven bought by then. */
export function contextAt(game, r) {
  const round = game.rounds[r], at = seconds(round.time);
  const held = game.rounds.slice(0, r).flatMap((x) => (x.transmute ? x.transmute.into.map((t) => t.aug_id) : [x.taken_aug_id]));
  const owned = game.purchases.filter((p) => p.status === 'bought' && p.time && seconds(p.time) <= at).map((p) => p.item_id);
  const unsureBefore = game.rounds.slice(0, r).filter((x) => !SAID.has(x.taken_evidence)).map((x) => `${x.round}:${x.taken_evidence}`);
  return { held, owned: [...new Set(owned)], unsureBefore };
}

/** The walk's order (rankOffer) by each card's stage value, its group (0 settled, 1 open condition, 2 not measured) and the first card's verdict. */
export function stageOrder(rankOffer, ids, rowOf) {
  const value = (id) => rowOf(id)?.value, open = (id) => (rowOf(id)?.open?.length ?? 0) > 0;
  const order = rankOffer(ids, value, open);
  const group = (id) => (value(id) === undefined ? 2 : open(id) ? 1 : 0);
  const same = (a, b) => group(a) === group(b) && group(a) < 2 && Math.abs(value(a) - value(b)) < EPS;
  const place = (id) => 1 + order.filter((x) => group(x) < group(id) || (group(x) === group(id) && group(x) < 2 && value(x) - value(id) > EPS)).length;
  const top = order[0];
  const verdict = group(top) === 2 ? 'none: no card measured' : order.length > 1 && same(order[0], order[1]) ? 'tie' : 'first';
  return { order, group, place, top, verdict };
}

/** dominantOffer's answer, and when it gives none, why, in its own order of conditions: missing, uncertain, unsupported, tie, no dominance. */
export function dominance(dominantOffer, offers) {
  const id = dominantOffer(offers);
  if (id !== undefined) return { id, why: 'dominant' };
  if (offers.some((o) => !Number.isFinite(o.value) || o.absent)) return { why: 'missing' };
  if (offers.some((o) => o.certain !== true)) return { why: 'uncertain' };
  if (offers.some((o) => o.missing || !o.plan || o.plan.missing?.length > 0 || !Number.isFinite(o.plan.value))) return { why: 'unsupported' };
  const tied = offers.some((a) => offers.some((b) => a !== b && Math.abs(a.value - b.value) < EPS && Math.abs(a.plan.value - b.plan.value) < EPS));
  return { why: tied ? 'tie' : 'no dominance' };
}

/** The engine's own walk over the recorded offers. pick(state, round) gives { id } or { stop }. Stops are reported with the valid prefix. */
export async function walkEngine(game, pick) {
  const held = [], steps = [];
  let diverged = -1;
  for (let r = 0; r < game.rounds.length; r++) {
    const round = game.rounds[r], ids = round.offered.map((c) => c.aug_id);
    if (ids.some((id) => held.includes(id))) return { steps, held, stop: `offer holds a card the engine already has (round ${round.round})`, prefix: r, diverged };
    // Before the first difference the engine and the creator share his items; after it nothing of his is copied.
    const owned = diverged < 0 ? contextAt(game, r).owned : contextAt(game, diverged).owned;
    const choice = await pick({ held: [...held], owned, round, r });
    if (choice.stop) return { steps, held, stop: `${choice.stop} (round ${round.round})`, prefix: r, diverged };
    if (round.offered.find((c) => c.aug_id === choice.id)?.name.startsWith('Transmute')) return { steps, held, stop: `transmute: its result is unknown (round ${round.round})`, prefix: r, diverged };
    steps.push({ round: round.round, engine: choice.id, creator: round.taken_aug_id, same: choice.id === round.taken_aug_id });
    if (choice.id !== round.taken_aug_id && diverged < 0) diverged = r;
    held.push(choice.id);
  }
  return { steps, held, stop: null, prefix: game.rounds.length, diverged };
}

function selfCheck() {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  // Name to id: an absent name and a wrong stored id both stop the run.
  const augs = [{ id: 1, enName: 'Alpha', modes: ['mayhem'] }, { id: 2, enName: 'Beta', modes: ['arena'] }, { id: 3, enName: 'Twin', modes: ['mayhem'] }, { id: 4, enName: 'twin', modes: ['mayhem'] }];
  ok(checkAugment(augs, 'ALPHA!', 1).id === 1, 'exact normalized name maps');
  for (const [n, id] of [['Gamma', undefined], ['Beta', undefined], ['Alpha', 9], ['Twin', 3]]) { let thrown = false; try { checkAugment(augs, n, id); } catch { thrown = true; } ok(thrown, `match failure ${n}/${id} stops`); }
  // Tie against no dominance against missing against uncertain.
  const dom = (os) => os.find((a) => os.every((b) => a === b || (a.value >= b.value && a.plan.value >= b.plan.value && (a.value > b.value || a.plan.value > b.plan.value))))?.id;
  const plan = (v) => ({ value: v, missing: [] });
  const fake = (os) => dominance((x) => (x.some((o) => !o.plan || o.certain !== true) ? undefined : dom(x)), os);
  ok(fake([{ id: 1, value: 1, certain: true, plan: plan(1) }, { id: 2, value: 1, certain: true, plan: plan(1) }]).why === 'tie', 'tie');
  ok(fake([{ id: 1, value: 2, certain: true, plan: plan(1) }, { id: 2, value: 1, certain: true, plan: plan(2) }]).why === 'no dominance', 'no dominance is not a tie');
  ok(fake([{ id: 1, value: NaN, absent: true }, { id: 2, value: 1, certain: true, plan: plan(1) }]).why === 'missing', 'missing');
  ok(fake([{ id: 1, value: 2, certain: false, plan: plan(2) }, { id: 2, value: 1, certain: true, plan: plan(1) }]).why === 'uncertain', 'uncertain');
  ok(fake([{ id: 1, value: 2, certain: true, plan: plan(2) }, { id: 2, value: 1, certain: true, plan: plan(1) }]).id === 1, 'dominant');
  // Stage order: a tie at the top, and nothing measured.
  const rank = (cs, p) => [...cs].sort((a, b) => (p(a) === undefined) - (p(b) === undefined) || (p(b) ?? 0) - (p(a) ?? 0));
  ok(stageOrder(rank, [1, 2, 3], (id) => ({ 1: { value: 0.2, open: [] }, 2: { value: 0.2, open: [] }, 3: { value: 0.1, open: [] } })[id]).verdict === 'tie', 'stage tie');
  ok(stageOrder(rank, [1, 2], () => undefined).verdict.startsWith('none'), 'unknown stage is not a tie');
  ok(stageOrder(rank, [1, 2, 3], (id) => ({ 1: { value: 0.2, open: [] }, 3: { value: 0.1, open: [] } })[id]).place(2) === 3, 'an unmeasured card ranks last');
  // No future leak: the context of a round holds only earlier picks, a transmute as its result, and items bought by its time.
  const g = { rounds: [
    { round: 1, time: '1:00', taken_aug_id: 10, taken_evidence: 'screen', offered: [{ aug_id: 10, name: 'A' }, { aug_id: 11, name: 'B' }, { aug_id: 12, name: 'C' }] },
    { round: 2, time: '5:00', taken_aug_id: 20, taken_evidence: 'inferred', offered: [{ aug_id: 20, name: 'Transmute: X' }, { aug_id: 21, name: 'D' }, { aug_id: 22, name: 'E' }], transmute: { into: [{ aug_id: 30 }] } },
    { round: 3, time: '9:00', taken_aug_id: 40, taken_evidence: 'screen', offered: [{ aug_id: 40, name: 'F' }, { aug_id: 10, name: 'A' }, { aug_id: 41, name: 'G' }] },
  ], purchases: [{ item_id: 100, time: '4:59', status: 'bought' }, { item_id: 101, time: '5:01', status: 'bought' }, { item_id: 102, time: '2:00', status: 'planned' }] };
  ok(contextAt(g, 0).held.length === 0 && contextAt(g, 0).owned.length === 0, 'round 1 knows nothing');
  ok(contextAt(g, 1).held.join() === '10' && contextAt(g, 1).owned.join() === '100', 'round 2: earlier pick, item bought by 5:00 only, no planned item');
  ok(contextAt(g, 2).held.join() === '10,30', 'round 3: the transmute counts as what it became, never as the card');
  ok(contextAt(g, 2).unsureBefore.join() === '2:inferred', 'a round after an inferred pick is marked conditional');
  return (async () => {
    // The engine's walk: an offer with a card it holds stops it; a transmute pick stops it; no decision stops it.
    const w1 = await walkEngine(g, async ({ round }) => ({ id: round.offered[0].aug_id }));
    ok(w1.stop?.startsWith('transmute') && w1.prefix === 1, `transmute stops the branch (${w1.stop})`);
    const w2 = await walkEngine(g, async ({ round }) => ({ id: round.offered[round.round === 2 ? 1 : 0].aug_id }));
    ok(w2.stop?.startsWith('offer holds') && w2.prefix === 2, `an offer with a held card stops the branch (${w2.stop})`);
    const w3 = await walkEngine(g, async () => ({ stop: 'no decision' }));
    ok(w3.stop?.startsWith('no decision') && w3.prefix === 0 && w3.steps.length === 0, 'no decision stops at once');
    const w4 = await walkEngine(g, async ({ owned, round }) => { if (round.round === 3) ok(owned.join() === '', 'after the difference the creator\'s later items are not copied'); return { id: round.offered[round.round === 1 ? 1 : 2].aug_id }; });
    ok(w4.diverged === 0, 'first difference found');
    console.log(fails.length ? `self-check FAILED: ${fails.join('; ')}` : 'self-check passed: name match, tie / no dominance / missing / uncertain, stage tie and unknown, no future leak, transmute, conditional, branch stops');
    process.exit(fails.length ? 1 : 0);
  })();
}

if (process.argv.includes('--self-check')) await selfCheck();

// ---- the measure ----
const dist = resolve(arg('dist') ?? 'dist');
const imp = (p) => import(pathToFileURL(`${dist}/${p}`).href);
const { createServices } = await imp('main/services.js');
const { rankOffer } = await imp('app/walk.js');
const { dominantOffer } = await imp('app/offerComparison.js');
// The app's own boundary for a level (main's IPC parses every progress with it): a level it refuses is refused here too, as the app would.
const { parseAugmentProgress } = await imp('ai/augmentProgress.js');
const appProgress = (level) => { try { return { progress: parseAugmentProgress({ level }) }; } catch (e) { return { refused: `the app refuses level ${level} (${e.message})` }; } };
const s = createServices({ cacheDir: `${process.env.APPDATA}/LOL_helper`, fetchImpl: fetch });
const augs = (await s.augments()).augments, champs = await s.champions(), list = (await s.items('mayhem')).list;
const boots = new Set(list.filter((i) => i.group === 'boots').map((i) => i.id % 10000));
const nameOf = (id) => augs.find((a) => a.id === id)?.enName ?? String(id);
const itemName = (id) => list.find((i) => i.id % 10000 === id)?.enName ?? String(id);

const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const offersFile = 'knowledge/notes-300/creator-offers-2026-11-10.jsonl', itemsFile = 'knowledge/notes-300/creator-items-2026-11-10.jsonl';
const rounds = lines(offersFile).filter((o) => o.record !== 'meta'), gameRecs = lines(itemsFile).filter((o) => o.record === 'game');
const only = arg('only')?.split(',');
const games = [];
for (const rec of gameRecs) {
  if (only && !only.includes(rec.champion)) continue;
  const c = champs.filter((x) => norm(x.enName ?? x.name) === norm(rec.champion));
  if (c.length !== 1) throw new Error(`champion "${rec.champion}": ${c.length} matches`);
  const rs = rounds.filter((r) => r.video === rec.video && r.game_no === rec.game_no).sort((a, b) => a.round - b.round);
  if (!rs.length) throw new Error(`no rounds for ${rec.champion} ${rec.video}`);
  for (const r of rs) {
    for (const card of r.offered) checkAugment(augs, card.name, card.aug_id);
    checkAugment(augs, r.taken, r.taken_aug_id);
    if (!r.offered.some((x) => x.aug_id === r.taken_aug_id)) throw new Error(`${rec.champion} round ${r.round}: taken not offered`);
    for (const t of r.transmute?.into ?? []) checkAugment(augs, t.name, t.aug_id);
    for (const w of r.rerolled_offers ?? []) for (const n of w) checkAugment(augs, n);
  }
  for (const p of rec.purchases) { const found = [...new Set(list.filter((i) => norm(i.enName) === norm(p.name)).map((i) => i.id % 10000))]; if (found.length !== 1 || found[0] !== p.item_id) throw new Error(`item "${p.name}": file ${p.item_id}, data ${found.join('/') || 'none'}`); }
  games.push({ ...rec, id: c[0].id, key: `${rec.video}#${rec.game_no}`, rounds: rs });
}

const calls = { cardValues: 0, mathBuild: 0 };
async function judge(championId, held, owned, level, ids) {
  const { progress, refused } = appProgress(level);
  if (refused) return { refused };
  calls.cardValues++;
  const rows = await s.cardValues(championId, held, owned, undefined, progress, ids);
  const rowOf = (id) => rows.find((x) => x.id === id);
  const stage = stageOrder(rankOffer, ids, rowOf);
  const dom = dominance(dominantOffer, ids.map((id) => rowOf(id) ?? { id, value: NaN, absent: true }));
  const why = (id) => { const row = rowOf(id); if (row) return row.certain ? 'certain' : 'uncertain'; if (held.includes(id)) return 'held'; return augs.find((a) => a.id === id)?.ids?.length ? 'not computed' : 'unknown'; };
  return { stage, dom, rowOf, why, planFields: ids.some((id) => rowOf(id)?.plan !== undefined || rowOf(id)?.planError !== undefined) };
}
const legendary = (ids) => ids.map((id) => id % 10000).filter((id) => !boots.has(id));
// T167: a plan's purchase order (a merge row is not a buy) and its final inventory (a merge takes its ingredients out). Rows with no merge give the same list twice.
const inventory = (rows) => rows.reduce((inv, r) => [...(r.consumes ? inv.filter((id) => !r.consumes.includes(id)) : inv), r.item.id], []);
async function planRows(championId, held, owned, level) { const { progress, refused } = appProgress(level); if (refused) return null; calls.mathBuild++; return s.mathBuild(championId, held, owned, undefined, undefined, undefined, progress); }
async function plan(championId, held, owned, level) { const rows = await planRows(championId, held, owned, level); return rows && rows.filter((r) => !r.consumes).map((r) => r.item.id); }
async function planFinal(championId, held, owned, level) { const rows = await planRows(championId, held, owned, level); return rows && inventory(rows); }

const out = [], detail = { games: [] };
const T = { a: { all: 0, refused: 0, top: 0, tie: 0, none: 0, place: {}, dom: {}, trusted: { n: 0, top: 0, tie: 0 }, said: { n: 0, top: 0, tie: 0 }, conditional: { n: 0, top: 0 }, excluded: [] }, pre: { n: 0, topRerolled: 0, topKept: 0, none: 0 } };
const fmtV = (v) => (v === undefined ? '-' : `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)}%`);
out.push(`sample: ${games.length} games, ${games.reduce((n, g) => n + g.rounds.length, 0)} rounds (${offersFile}, ${itemsFile})`);
out.push('level: derived phase 3/7/11/15 (AUGMENT_LEVELS) or a noted event; sent as progress.level only, history levels estimated, no historyComplete');
for (const g of games) {
  const G = { key: g.key, creator: g.creator, champion: g.champion, rounds: [] };
  out.push(`\n## ${g.creator} ${g.champion} (${g.key})`);
  // (a) on his history
  for (let r = 0; r < g.rounds.length; r++) {
    const round = g.rounds[r], ctx = contextAt(g, r), ids = round.offered.map((c) => c.aug_id);
    const j = await judge(g.id, ctx.held, ctx.owned, round.level, ids);
    if (j.refused) { T.a.all++; T.a.excluded.push(`${g.champion} R${round.round}: ${j.refused}`); out.push(`a R${round.round} L${round.level}: not judged: ${j.refused}`); G.rounds.push({ round: round.round, level: round.level, refused: j.refused }); continue; }
    const taken = round.taken_aug_id, place = j.stage.place(taken);
    const flags = [round.taken_evidence !== 'screen' ? `taken ${round.taken_evidence}` : '', ctx.unsureBefore.length ? `after ${ctx.unsureBefore.join(',')}` : '', round.level_conflict ? 'level contradicted' : '', round.superfans_extra ? 'Superfans extra' : '', round.transmute ? 'transmute' : '', round.reroll_order_known === false ? 'reroll order unknown' : ''].filter(Boolean);
    const cards = j.stage.order.map((id) => `${nameOf(id)}${id === taken ? '*' : ''} ${fmtV(j.rowOf(id)?.value)}${j.stage.group(id) === 1 ? ' (open)' : j.stage.group(id) === 2 ? ` (${j.why(id)})` : ''}`);
    out.push(`a R${round.round} L${round.level}${round.level_source === 'event' ? ' event' : ''}: ${cards.join(' > ')} | first ${j.stage.verdict}, his card ${place}/3${j.stage.group(taken) === 2 ? ' unmeasured' : ''}; dominance ${j.dom.id !== undefined ? nameOf(j.dom.id) : `none (${j.dom.why})`}${flags.length ? ` [${flags.join('; ')}]` : ''}`);
    const counted = !round.level_conflict;
    T.a.all++;
    if (!counted) T.a.excluded.push(`${g.champion} R${round.round}: level contradicted`);
    else {
      const top = j.stage.verdict === 'first' && j.stage.top === taken, tie = j.stage.verdict === 'tie' && j.stage.place(taken) === 1;
      if (j.stage.verdict.startsWith('none')) T.a.none++; else if (top) T.a.top++; else if (tie) T.a.tie++;
      T.a.place[place] = (T.a.place[place] ?? 0) + 1;
      T.a.dom[j.dom.id !== undefined ? (j.dom.id === taken ? 'dominant = his' : 'dominant, not his') : j.dom.why] = (T.a.dom[j.dom.id !== undefined ? (j.dom.id === taken ? 'dominant = his' : 'dominant, not his') : j.dom.why] ?? 0) + 1;
      const bucket = ctx.unsureBefore.length ? T.a.conditional : null;
      if (bucket) { bucket.n++; if (top) bucket.top++; }
      else {
        if (TRUSTED.has(round.taken_evidence)) { T.a.trusted.n++; if (top) T.a.trusted.top++; if (tie) T.a.trusted.tie++; }
        if (SAID.has(round.taken_evidence)) { T.a.said.n++; if (top) T.a.said.top++; if (tie) T.a.said.tie++; }
      }
    }
    G.rounds.push({ round: round.round, level: round.level, order: j.stage.order, values: Object.fromEntries(ids.map((id) => [id, j.rowOf(id)?.value ?? null])), verdict: j.stage.verdict, top: j.stage.top, taken, place, dominance: j.dom, flags, planFields: j.planFields });
    // The first set, before his rerolls, apart: did he reroll away the card the walk would have shown first?
    for (const first of round.rerolled_offers ?? []) {
      const fids = first.map((n) => checkAugment(augs, n).id), fj = await judge(g.id, ctx.held, ctx.owned, round.level, fids);
      T.pre.n++;
      if (fj.stage.verdict !== 'first') { T.pre.none++; out.push(`  before rerolls: ${first.join(', ')}: first ${fj.stage.verdict}`); continue; }
      const gone = !ids.includes(fj.stage.top);
      if (gone) T.pre.topRerolled++; else T.pre.topKept++;
      out.push(`  before rerolls: ${first.join(', ')}: walk's first ${nameOf(fj.stage.top)}, ${gone ? 'he rerolled it away' : 'still on the table at his pick'}`);
    }
  }
  // Items on his history: each round's next item against what he bought or named before the next round; then his known items in the last plan.
  const known = [...new Set(legendary(g.purchases.filter((p) => p.status === 'bought' || p.status === 'named').map((p) => p.item_id)))];
  const stagesItems = [];
  for (let r = 0; r < g.rounds.length; r++) {
    const ctx = contextAt(g, r), after = contextAt(g, Math.min(r + 1, g.rounds.length - 1));
    const from = seconds(g.rounds[r].time), to = r + 1 < g.rounds.length ? seconds(g.rounds[r + 1].time) : Infinity;
    const his = g.purchases.filter((p) => (p.status === 'bought' || p.status === 'named') && p.time && seconds(p.time) > from && seconds(p.time) <= to).sort((a, b) => seconds(a.time) - seconds(b.time)).map((p) => p.item_id % 10000).filter((id) => !boots.has(id));
    if (!his.length) continue;
    const heldAfter = r + 1 < g.rounds.length ? after.held : [...ctx.held, ...(g.rounds[r].transmute ? g.rounds[r].transmute.into.map((t) => t.aug_id) : [g.rounds[r].taken_aug_id])];
    const raw = await plan(g.id, heldAfter, ctx.owned, g.rounds[r].level);
    if (!raw) { out.push(`items after R${g.rounds[r].round}: not judged (the app refuses level ${g.rounds[r].level})`); continue; }
    const p = legendary(raw).filter((id) => !ctx.owned.map((x) => x % 10000).includes(id));
    stagesItems.push({ round: g.rounds[r].round, next: p[0], his: his[0], same: p[0] === his[0], hisInPlan: p.includes(his[0]) });
    out.push(`items after R${g.rounds[r].round}: engine next ${itemName(p[0])}, his next ${itemName(his[0])} (${p[0] === his[0] ? 'same' : p.includes(his[0]) ? 'in the plan, later' : 'not in the plan'})`);
  }
  const last = g.rounds.length - 1, lctx = contextAt(g, last);
  const finalHeld = [...lctx.held, ...(g.rounds[last].transmute ? g.rounds[last].transmute.into.map((t) => t.aug_id) : [g.rounds[last].taken_aug_id])];
  const lastOwned = g.purchases.filter((p) => p.status === 'bought').map((p) => p.item_id);
  // The last round's level, or the last level the app accepts when that one is refused (said in the line).
  const lastLevel = [...g.rounds].reverse().find((x) => !appProgress(x.level).refused)?.level;
  const fin = legendary((await planFinal(g.id, finalHeld, lastOwned, lastLevel)) ?? []);
  const hit = known.filter((id) => fin.includes(id));
  out.push(`items, his known (bought or named, legendary, folded): ${known.map(itemName).join(', ') || 'none'}; engine plan with his augments at level ${lastLevel}: ${fin.map(itemName).join(', ')}; recall ${hit.length}/${known.length}; full-set and first-item likeness not counted (his final six are unknown)`);
  G.items = { known, plan: fin, hit, stages: stagesItems };
  // (b) the engine's own path, two branches.
  const branch = async (label, decide) => {
    const w = await walkEngine(g, async ({ held, owned, round }) => { const j = await judge(g.id, held, owned, round.level, round.offered.map((c) => c.aug_id)); return j.refused ? { stop: j.refused } : decide(j); });
    const same = w.steps.filter((x) => x.same).length;
    const union = new Set([...w.held, ...g.rounds.slice(0, w.prefix).map((x) => x.taken_aug_id)]), inter = w.held.filter((id) => g.rounds.slice(0, w.prefix).some((x) => x.taken_aug_id === id));
    out.push(`b ${label}: ${w.steps.map((x) => `R${x.round} ${nameOf(x.engine)}${x.same ? ' =' : ` (his ${nameOf(x.creator)})`}`).join(', ') || 'no step'}; ${w.stop ? `stopped: ${w.stop}, valid prefix ${w.prefix}/${g.rounds.length}` : 'complete'}; same place ${same}/${w.steps.length}; set ${inter.length}/${union.size}${w.diverged >= 0 ? `; first difference R${g.rounds[w.diverged].round}` : ''}`);
    return { ...w, same, inter: inter.length, union: union.size };
  };
  G.decision = await branch('decision (dominantOffer)', (j) => (j.dom.id !== undefined ? { id: j.dom.id } : { stop: `no settled decision: ${j.dom.why}` }));
  G.stagePath = await branch("walk's first card (stage order, not a plan pick)", (j) => (j.stage.verdict === 'first' ? { id: j.stage.top } : { stop: `stage ${j.stage.verdict}` }));
  detail.games.push(G);
}

// Totals with their denominators.
const sum = (k) => detail.games.reduce((n, g) => n + g[k].same, 0), steps = (k) => detail.games.reduce((n, g) => n + g[k].steps.length, 0), full = (k) => detail.games.filter((g) => !g[k].stop).length;
out.push('\n## totals');
out.push(`a: rounds ${T.a.all}, counted ${T.a.all - T.a.excluded.length} (${T.a.excluded.join('; ') || 'none excluded'})`);
out.push(`a, walk's first card = his pick: screen ${T.a.trusted.top}/${T.a.trusted.n} (ties at the top with his card ${T.a.trusted.tie}); screen+said ${T.a.said.top}/${T.a.said.n} (ties ${T.a.said.tie}); after an unsure or inferred pick ${T.a.conditional.top}/${T.a.conditional.n}`);
out.push(`a, all counted rounds: first = his ${T.a.top}, tie with his ${T.a.tie}, no card measured ${T.a.none}; his card's place ${Object.entries(T.a.place).sort().map(([k, v]) => `${k}: ${v}`).join(', ')}`);
out.push(`a, dominance (stage and plan together): ${Object.entries(T.a.dom).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
out.push(`a, first sets before his rerolls: ${T.pre.n}; walk's first rerolled away by him ${T.pre.topRerolled}, kept on the table ${T.pre.topKept}, no first card ${T.pre.none}`);
out.push(`b decision: complete paths ${full('decision')}/${detail.games.length}; steps ${steps('decision')}, same place ${sum('decision')}`);
out.push(`b walk's first card: complete paths ${full('stagePath')}/${detail.games.length}; steps ${steps('stagePath')}, same place ${sum('stagePath')}; set overlap ${detail.games.reduce((n, g) => n + g.stagePath.inter, 0)}/${detail.games.reduce((n, g) => n + g.stagePath.union, 0)}`);
const st = detail.games.flatMap((g) => g.items.stages);
out.push(`items: next item same ${st.filter((x) => x.same).length}/${st.length}, in the plan ${st.filter((x) => x.hisInPlan).length}/${st.length}; known-item recall ${detail.games.reduce((n, g) => n + g.items.hit.length, 0)}/${detail.games.reduce((n, g) => n + g.items.known.length, 0)}`);
out.push(`calls: cardValues ${calls.cardValues}, mathBuild ${calls.mathBuild}`);

let commit = '?';
try { commit = execSync('git rev-parse --short HEAD', { cwd: resolve(dist, '..') }).toString().trim(); } catch { /* not a checkout */ }
const head = `${new Date().toISOString()} dist ${dist} on ${commit}`;
const text = [head, ...out].join('\n') + '\n';
writeFileSync(arg('out') ?? fileURLToPath(import.meta.url).replace(/\.mjs$/, '.txt'), text);
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(detail, null, 1));
console.log(text);
