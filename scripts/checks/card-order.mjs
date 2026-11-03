// Card order: does a bigger card gain in the calculator go with more real damage per minute? Plan: knowledge/rebuild-checks-plan.md, check 2.
// Gate for any later change: the last 30%'s median agreement may not fall by more than 0.01.
import { band, loadPlayers, logM, orderReport, writeResult } from './common.mjs';

const t0 = Date.now();
const rows = (await loadPlayers()).filter((p) => p.held.length).map((p) => ({ c: p.c, late: p.late, y: p.y, n: p.items.length, b: band(p.level), k: p.held.length, x: logM(p.base, p.items, p.held.map((h) => h.card)) - logM(p.base, p.items, []) }));
const key = (r) => `${r.n}|${r.b}|${r.k}`;
writeResult(import.meta.url, [
  `card order, players with a numbered card ${rows.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  `first 70%: ${orderReport(rows.filter((r) => !r.late), key)}`,
  `last 30%: ${orderReport(rows.filter((r) => r.late), key)}`,
]);
process.exit(0);
