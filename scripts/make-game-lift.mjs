// T137 (owner 2026-11-18, «Yes, build it»): a second number, "from the games", for the augments the fight cannot value.
// Which cards: no champion gets a non-zero cardValues row at levels 7 and 13 (no row at all, or zero on every champion).
// Their number: champion-adjusted win lift = mean over the players who took it of (win - his champion's win rate without it),
// shrunk toward 0 by n / (n + SHRINK). stable = the two halves of the games (split by game id) give the same sign.
// Association, not cause: who takes the card and what else was offered are not controlled. Display only: never ranked, never mixed with the fight.
// Run from the repo root after the build, APPDATA on the games: node scripts/make-game-lift.mjs   (--self-check runs the arithmetic on a tiny set)
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const SHRINK = 1000, MIN_PLAYERS = 1000, EVERYONE = 0.5; // a card more than half the players carry is not a choice
const NON_CHOICE = new Set([3176]); // T138 Codex: Pentakill is given, not picked; the share filter alone keeps it (11% of records)

/** games: [{ id, players: [{ champion, win, augments }] }]; key(id) folds an entry's ids to one. Returns key -> { points, players, stable }. */
export function gameLift(games, key, wanted) {
  const half = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h & 1; };
  const champ = new Map(), took = new Map(); let players = 0;
  const bump = (m, k, win) => { const v = m.get(k) ?? { n: 0, w: 0 }; v.n++; if (win) v.w++; m.set(k, v); };
  for (const g of games) for (const p of g.players ?? []) {
    if (!Array.isArray(p.augments)) continue; // an unknown list is neither a taker nor a non-taker (T138)
    players++; bump(champ, `${p.champion}|${half(g.id)}`, p.win);
    for (const a of new Set((p.augments ?? []).map(key))) if (wanted.has(a)) bump(took, `${p.champion}|${a}|${half(g.id)}`, p.win);
  }
  const acc = new Map();
  for (const [k, t] of took) {
    const [c, a, h] = k.split('|'); const all = champ.get(`${c}|${h}`); // his champion's players in the same half
    const rest = { n: all.n - t.n, w: all.w - t.w }; if (rest.n < 1) continue;
    const v = acc.get(+a) ?? { n: [0, 0], s: [0, 0] }; v.n[+h] += t.n; v.s[+h] += t.w - t.n * (rest.w / rest.n); acc.set(+a, v);
  }
  const out = new Map();
  for (const [a, v] of acc) {
    const n = v.n[0] + v.n[1]; if (n < MIN_PLAYERS || n > EVERYONE * players) continue;
    const lift = (v.s[0] + v.s[1]) / n, l0 = v.n[0] ? v.s[0] / v.n[0] : 0, l1 = v.n[1] ? v.s[1] / v.n[1] : 0;
    out.set(a, { points: Math.round(1000 * 100 * lift * n / (n + SHRINK)) / 1000, players: n, stable: Math.sign(l0) === Math.sign(l1) && l0 !== 0 });
  }
  return out;
}

if (process.argv.includes('--self-check')) {
  // Champion 1 wins half without card 7; the 2000 players who took 7 won 60% across both halves: lift +10 points, shrunk by 2000/3000.
  const games = []; let id = 0;
  for (let i = 0; i < 2000; i++) games.push({ id: id++, players: [{ champion: 1, win: i % 2 === 0, augments: [] }] });
  for (let i = 0; i < 2000; i++) games.push({ id: id++, players: [{ champion: 1, win: i % 5 < 3, augments: [7] }] });
  games.push({ id: id++, players: [{ champion: 1, win: true }] }); // no augment list: counted nowhere
  const r = gameLift(games, (x) => x, new Set([7])).get(7);
  assert.equal(r.players, 2000); assert.ok(Math.abs(r.points - 10 * 2000 / 3000) < 0.2, `points ${r.points}`); assert.equal(r.stable, true);
  assert.equal(gameLift(games.slice(0, 2500), (x) => x, new Set([7])).size, 0, 'under MIN_PLAYERS is left out');
  console.log('self-check ok'); process.exit(0);
}

const imp = (p) => import(pathToFileURL(`${process.cwd()}/dist/${p}`).href);
const { createServices } = await imp('main/services.js');
const s = createServices({ cacheDir: `${process.env.APPDATA}/LOL_helper`, fetchImpl: fetch });
const augs = (await s.augments()).augments.filter((a) => a.modes.includes('mayhem'));
const champs = await s.champions();
const valued = new Set();
for (const c of champs) for (const level of [7, 13]) for (const r of await s.cardValues(c.id, [], [], undefined, { level })) if (Math.abs(r.value) > 1e-9) valued.add(r.id);
const keyOf = new Map(); for (const a of augs) for (const id of a.ids) keyOf.set(id, a.ids[0]);
const unvalued = augs.filter((a) => !a.ids.some((id) => valued.has(id) || NON_CHOICE.has(id)));
const games = ['mayhem-games.json', 'mayhem-games-na.json'].flatMap((f) => { const raw = JSON.parse(readFileSync(`${process.env.APPDATA}/LOL_helper/${f}`, 'utf8')); return Array.isArray(raw) ? raw : raw.games; });
const lift = gameLift(games, (id) => keyOf.get(id) ?? id, new Set(unvalued.map((a) => a.ids[0])));
const rows = unvalued.filter((a) => lift.has(a.ids[0])).sort((a, b) => lift.get(b.ids[0]).players - lift.get(a.ids[0]).players);
const players = games.reduce((n, g) => n + (g.players?.length ?? 0), 0);
writeFileSync('src/ai/gameLift.ts', `// Generated by scripts/make-game-lift.mjs on ${new Date().toISOString().slice(0, 10)}: ${games.length} stored games, ${players} players; ${unvalued.length} Mayhem augments the fight values at zero or not at all, ${rows.length} taken by ${MIN_PLAYERS}+ players.
// points: champion-adjusted win lift in win points, shrunk by n/(n+${SHRINK}); stable: both halves of the games agree in sign. Association, not cause; display only.
export const GAME_LIFT: Readonly<Record<number, { points: number; players: number; stable: boolean }>> = {
${rows.flatMap((a) => { const v = lift.get(a.ids[0]); return a.ids.map((id) => `  ${id}: { points: ${v.points}, players: ${v.players}, stable: ${v.stable} }, // ${a.enName}`); }).join('\n')}
};
`);
console.log(`${games.length} games, ${players} players; unvalued ${unvalued.length}, written ${rows.length}`);
