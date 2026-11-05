// Items in the engine's build that the champion's own players (almost) never hold. The owner, 2026-11-05 («نعم، اعتمده»): win rates are kept
// only for this, catching items nobody buys; they can't choose between two builds players do buy (knowledge/test-the-win-check.txt).
// A flag is a question for the owner, not a failure: an item nobody holds may still be right. The kit's own build only; buttons are alternatives on purpose.
// Run from the repo root after the build: node scripts/checks/unheld.mjs
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { dir, writeResult } from './common.mjs';
const imp = (p) => import(pathToFileURL(`${process.cwd()}/dist/${p}`).href);
const { createServices } = await imp('main/services.js');
const services = createServices({ cacheDir: dir, fetchImpl: fetch });
const list = (await services.items('mayhem')).list;
const fin = new Map(list.filter((i) => i.group === 'legendary' && i.html && Math.floor(i.id / 10000) !== 77).map((i) => [i.id, i]));
const fold = (id) => (fin.has(id) ? id : fin.has(id % 10000) ? id % 10000 : null);
const MIN_PLAYERS = 300, MIN_HELD = 20; // same thresholds as the tested win check

const raw = JSON.parse(readFileSync(`${dir}/mayhem-games.json`, 'utf8'));
const held = new Map(); // champion -> { players, items: Map(item -> holders) }
for (const g of Array.isArray(raw) ? raw : raw.games) for (const p of g.players) {
  const items = [...new Set((p.items ?? []).map(fold).filter((x) => x !== null))];
  if (items.length < 4) continue; // unfinished builds
  const h = held.get(p.champion) ?? { players: 0, items: new Map() };
  h.players++; for (const id of items) h.items.set(id, (h.items.get(id) ?? 0) + 1);
  held.set(p.champion, h);
}
const names = new Map((await services.champions()).map((c) => [c.id, c.name]));

const flags = []; let checked = 0;
for (const [c, h] of [...held].sort((a, b) => b[1].players - a[1].players)) {
  if (h.players < MIN_PLAYERS) continue;
  let build; try { build = (await services.mathBuild(c, [])).map((s) => fold(s.item.id)).filter((x) => x !== null); } catch { continue; }
  checked++;
  for (const id of build) { const n = h.items.get(id) ?? 0; if (n < MIN_HELD) flags.push(`${names.get(c) ?? c}: ${fin.get(id)?.enName ?? id} held by ${n} of ${h.players}`); }
}
const L = [`items in the kit build held by fewer than ${MIN_HELD} of the champion's players (champions with ${MIN_PLAYERS}+ finished builds): ${flags.length} in ${checked} champions`, ...flags.map((f) => `- ${f}`)];
console.log(L.join('\n'));
writeResult(import.meta.url, L);
