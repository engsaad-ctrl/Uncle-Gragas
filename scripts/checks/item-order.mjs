// Item order: does a bigger item gain in the calculator go with more real damage per minute? Plan: knowledge/rebuild-checks-plan.md, check 1.
// Gate for any later change: the last 30%'s median agreement may not fall by more than 0.01.
import { band, loadPlayers, logM, orderReport, writeResult } from './common.mjs';

const t0 = Date.now();
const rows = (await loadPlayers()).map((p) => ({ c: p.c, late: p.late, y: p.y, n: p.items.length, b: band(p.level), x: logM(p.base, p.items, []) - logM(p.base, [], []) }));
const key = (r) => `${r.n}|${r.b}`;
writeResult(import.meta.url, [
  `item order, players ${rows.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  `first 70%: ${orderReport(rows.filter((r) => !r.late), key)}`,
  `last 30%: ${orderReport(rows.filter((r) => r.late), key)}`,
]);
process.exit(0);
