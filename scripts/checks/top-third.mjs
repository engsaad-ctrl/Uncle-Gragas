// Top-third card gain: do players holding a card the calculator ranks in its rarity's top third deal more real damage? Plan: knowledge/rebuild-checks-plan.md, check 3.
// Gate for any later change: no rarity may lose its pass, and no gain may fall by more than its bootstrap standard error.
// shortcut: the rank is computed once per champion, level and item count, with the first stored player's items for that key and no other cards held,
// since ranking every card for every player's exact build is about 27 million fights (hours); upgrade if the fights get faster.
// Card conditions (an item or a trait a card needs) are not checked, so a card that wouldn't apply is ranked by its numbers alone.
import { NUMBERED, enemyDpsAt, fight, fightValue, loadPlayers, rand, shop, teamPlace, writeResult } from './common.mjs';

const RARITIES = ['silver', 'gold', 'prismatic'];
const t0 = Date.now();
const players = await loadPlayers();
const pool = Object.fromEntries(RARITIES.map((r) => [r, NUMBERED.filter((n) => n.rarity === r)]));
const ranks = new Map();
const topOf = (p) => {
  const key = `${p.c}|${p.level}|${p.items.length}`;
  if (!ranks.has(key)) {
    const base = { ...p.base, items: p.items, cards: [] };
    const place = { ...teamPlace({ championId: p.c, bin: p.base.bin, shop, kit: p.base.kit, passive: p.base.passive }), enemyDps: enemyDpsAt(p.level) };
    const before = Math.max(fightValue(fight(base), place), 1e-9);
    const top = new Set();
    for (const r of RARITIES) {
      const gains = pool[r].map((n) => ({ id: n.card.id, g: fightValue(fight({ ...base, cards: [n.card] }), place) / before - 1 })).sort((a, b) => b.g - a.g || a.id - b.id);
      gains.slice(0, Math.floor(gains.length / 3)).forEach((x) => top.add(x.id));
    }
    ranks.set(key, top);
  }
  return ranks.get(key);
};
const rows = [];
for (const [i, p] of players.entries()) for (const h of p.held) if (RARITIES.includes(h.rarity)) rows.push({ p: i, c: p.c, r: h.rarity, late: p.late, ly: Math.log(p.y), top: topOf(p).has(h.card.id) });
const ranked = Date.now();

// Within champion: log y less the champion's mean over the players in this half.
const demean = (set) => {
  const by = new Map(), seen = new Set();
  for (const r of set) { if (seen.has(r.p)) continue; seen.add(r.p); const b = by.get(r.c) ?? { s: 0, n: 0 }; b.s += r.ly; b.n++; by.set(r.c, b); }
  return set.map((r) => ({ ...r, d: r.ly - by.get(r.c).s / by.get(r.c).n }));
};
const gain = (set, rarity, topKey = 'top') => {
  let st = 0, nt = 0, sr = 0, nr = 0;
  for (const r of set) if (r.r === rarity) { if (r[topKey]) { st += r.d; nt++; } else { sr += r.d; nr++; } }
  return nt && nr ? Math.exp(st / nt - sr / nr) - 1 : NaN;
};
const pct = (x) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(2)}%`;
const report = (label, raw) => {
  const set = demean(raw);
  // Chance: the same labels shuffled within champion and rarity.
  const cells = new Map();
  for (const [i, r] of set.entries()) { const k = `${r.c}|${r.r}`; const c = cells.get(k) ?? []; c.push(i); cells.set(k, c); }
  const chance = Object.fromEntries(RARITIES.map((r) => [r, []]));
  for (let s = 0; s < 200; s++) {
    const labels = new Array(set.length);
    for (const idx of cells.values()) { const tops = idx.map((i) => set[i].top); for (let j = tops.length - 1; j > 0; j--) { const k = Math.floor(rand() * (j + 1)); [tops[j], tops[k]] = [tops[k], tops[j]]; } idx.forEach((i, j) => (labels[i] = tops[j])); }
    const shuffled = set.map((r, i) => ({ ...r, s: labels[i] }));
    for (const r of RARITIES) chance[r].push(gain(shuffled, r, 's'));
  }
  // Bootstrap over players: a player's cards move together.
  const byPlayer = new Map();
  for (const r of set) { const b = byPlayer.get(r.p) ?? []; b.push(r); byPlayer.set(r.p, b); }
  const groups = [...byPlayer.values()], boots = Object.fromEntries(RARITIES.map((r) => [r, []]));
  for (let b = 0; b < 200; b++) { const draw = []; for (let i = 0; i < groups.length; i++) draw.push(...groups[Math.floor(rand() * groups.length)]); for (const r of RARITIES) boots[r].push(gain(draw, r)); }
  const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
  return RARITIES.map((r) => {
    const g = gain(set, r), p95 = [...chance[r]].sort((a, b) => a - b)[189], n = set.filter((x) => x.r === r).length;
    return `${label} ${r}: cards held ${n}, top third ${set.filter((x) => x.r === r && x.top).length}, gain ${pct(g)} se ${(100 * sd(boots[r])).toFixed(2)}, chance 95th ${pct(p95)}: ${g > p95 ? 'PASS' : 'FAIL'}`;
  });
};
writeResult(import.meta.url, [
  `top-third card gain, players ${players.length}, numbered cards held ${rows.length}, ranked keys ${ranks.size}, cards per rarity ${RARITIES.map((r) => `${r} ${pool[r].length}`).join(', ')}, ranking ${((ranked - t0) / 1000).toFixed(0)} s, all ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  ...report('first 70%', rows.filter((r) => !r.late)),
  ...report('last 30%', rows.filter((r) => r.late)),
]);
process.exit(0);
