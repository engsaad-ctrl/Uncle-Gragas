// Creators' Mayhem builds (knowledge/creators-mayhem-notes.md, read from transcripts and checked against the shop names) set against the engine's build
// for the same champion and the augments they said they took. A measure, not a pass mark: a creator's choice isn't proof of the best build (owner's rule 3),
// it shows which items fit his augments. Counts only facts marked (said), or items named on screen; offered, passed, planned or unsure ones are left out.
// Run from the repo root after the build: node scripts/checks/creator-cases.mjs
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { writeResult } from './common.mjs';
const imp = (p) => import(pathToFileURL(`${process.cwd()}/dist/${p}`).href);
const { createServices } = await imp('main/services.js');
const { CHAMPION_KITS } = await imp('ai/championKits.js');
const notesPath = 'knowledge/creators-mayhem-notes.md';
if (!existsSync(notesPath)) { console.log(`no ${notesPath}`); process.exit(0); }
const services = createServices({ cacheDir: `${process.env.APPDATA}/LOL_helper`, fetchImpl: fetch });
const items = (await services.items('mayhem')).list.filter((i) => (i.group === 'legendary' || i.group === 'boots') && i.html && Math.floor(i.id / 10000) !== 77);
const augs = (await services.augments()).augments.filter((a) => a.modes.includes('mayhem'));
const byLen = (xs) => [...xs].sort((a, b) => b.enName.length - a.enName.length);
const findAll = (text, list) => { const out = []; let t = text.toLowerCase(); for (const x of byLen(list)) { const n = x.enName.toLowerCase(); if (t.includes(n)) { out.push(x); t = t.split(n).join(' '); } } return out; };
const SKIP = /offered|passed|unsure|weighed|consider|skipped|instead|plan|wanted|would|if |could|thinks? about|not taken|declin/i;
const facts = (line) => line.split(/;|,(?![^(]*\))/).filter((f) => /\(said\)/.test(f) && !SKIP.test(f)).join(' ; ');
const cases = [];
for (const block of readFileSync(notesPath, 'utf8').split(/\n(?=### )/)) {
  const head = /^### (.+?) — (.+?) \(([\w-]{11})\)/.exec(block); if (!head || /unsure/i.test(head[2])) continue;
  const kit = CHAMPION_KITS.find((k) => k.name.toLowerCase() === head[2].toLowerCase()); if (!kit) continue;
  const line = (label) => (new RegExp(`^- ${label}:(.*)$`, 'm').exec(block)?.[1] ?? '');
  const a = findAll(facts(line('Augments')), augs), screen = findAll(line('Final items on screen'), items), said = findAll(facts(line('Items')), items);
  const its = [...new Map([...said, ...screen].map((i) => [i.id, i])).values()].filter((i) => i.group !== 'boots');
  if (its.length) cases.push({ channel: head[1], champ: kit, video: head[3], augs: a, items: its });
}
let hit = 0, total = 0; const missed = new Map(), extra = new Map(); const L = [];
for (const c of cases) {
  let b; try { b = (await services.mathBuild(c.champ.id, c.augs.map((x) => x.id))).map((s) => s.item); } catch { continue; }
  const ids = new Set(b.map((i) => i.id % 10000)); const got = c.items.filter((i) => ids.has(i.id % 10000));
  hit += got.length; total += c.items.length;
  for (const i of c.items) if (!ids.has(i.id % 10000)) missed.set(i.enName, (missed.get(i.enName) ?? 0) + 1);
  const theirs = new Set(c.items.map((i) => i.id % 10000)); for (const i of b) if (i.group !== 'boots' && !theirs.has(i.id % 10000)) extra.set(i.enName, (extra.get(i.enName) ?? 0) + 1);
  L.push(`- ${c.champ.name} (${c.channel}, ${c.video}) with ${c.augs.map((x) => x.enName).join(', ') || 'no said augment'}: ${got.length} of ${c.items.length} [${c.items.map((i) => (ids.has(i.id % 10000) ? '' : '-') + i.enName).join(', ')}] | engine: ${b.map((i) => i.enName).join(', ')}`);
}
const top = (m) => [...m].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([n, k]) => `${n} ${k}`).join(', ');
L.splice(0, 0, `creator cases: ${cases.length}; their items in the engine's build: ${hit} of ${total} (${total ? ((100 * hit) / total).toFixed(1) : 0}%)`, `their items the engine leaves out: ${top(missed)}`, `items the engine adds they didn't name: ${top(extra)}`, '');
writeResult(import.meta.url, L);
console.log(L.slice(0, 4).join('\n'));
