// Shared by the engine checks in this folder (plan: knowledge/rebuild-checks-plan.md). Run them from the repo root after npm run build.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const imp = (p) => import(pathToFileURL(`${process.cwd()}/dist/${p}`).href);
export const { fight, cardGain } = await imp('ai/cardMath.js');
export const { fightValue, teamPlace, enemyDpsAt } = await imp('ai/itemMath.js');
const { CARD_NUMBERS, ITEM_NUMBERS, PASSIVE_NUMBERS } = await imp('ai/cardMathData.js');
const { CHAMPION_KITS } = await imp('ai/championKits.js');
const { loadGameItems, loadChampionBin, loadGameVersion } = await imp('texts/gameData.js');

export const dir = `${process.env.APPDATA}/LOL_helper`;
const o = { cacheDir: dir, fetchImpl: fetch };
const v = await loadGameVersion(o);
export const shop = await loadGameItems(o, v);
export const itemOps = Object.fromEntries(ITEM_NUMBERS.map((i) => [i.id, i.ops]));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
const sum = readJson(`${dir}/cdragon/default/champion-summary.json`);
const alias = new Map((sum.data ?? sum).filter((c) => c.id > 0 && c.id < 1000).map((c) => [c.id, String(c.alias).toLowerCase()]));
const bins = new Map();
const binOf = async (id) => { if (!bins.has(id)) bins.set(id, alias.has(id) ? await loadChampionBin(o, v, alias.get(id)).catch(() => null) : null); return bins.get(id); };

/** Cards with numbers, by every platform id their augment carries, and each card's rarity from the cached augment list. */
const augments = readJson(`${dir}/augments.json`).data.augments;
export const NUMBERED = CARD_NUMBERS.filter((c) => c.ops.length).map((c) => ({ card: c, rarity: augments.find((a) => a.ids.includes(c.id))?.rarity ?? 'unknown' }));
const byPlatformId = new Map();
for (const a of augments) { const n = NUMBERED.find((x) => a.ids.includes(x.card.id)); if (n) for (const id of a.ids) byPlatformId.set(id, n); }

export const kitOf = (id) => { const k = CHAMPION_KITS.find((x) => x.id === id); return { damage: k?.damage ?? 'mixed', attacks: k?.relies.includes('attacks') ?? false, buffsAllies: !!k && k.relies.includes('allies') && (k.relies.includes('healing') || k.relies.includes('shielding')) }; };
export const passiveOf = (id) => PASSIVE_NUMBERS.find((x) => x.id === id)?.ops ?? [];

/** Every stored player with a game file, a level and damage dealt, games in time order: y = damage to champions per minute, late = in the last 30% of games. */
export async function loadPlayers() {
  const raw = readJson(`${dir}/mayhem-games.json`);
  const games = (Array.isArray(raw) ? raw : raw.games).slice().sort((a, b) => a.at - b.at);
  const out = [];
  for (const [n, g] of games.entries()) {
    const minutes = (g.duration ?? 0) / 60; // stored in seconds
    if (minutes <= 0) continue;
    for (const p of g.players ?? []) {
      const dmg = p.stats?.totalDamageDealtToChampions ?? 0, level = p.stats?.champLevel;
      if (dmg <= 0 || !level) continue;
      const bin = await binOf(p.champion);
      if (!bin) continue;
      const held = (p.augments ?? []).flatMap((id) => byPlatformId.get(id) ?? []);
      out.push({ game: n, late: n >= games.length * 0.7, c: p.champion, level, items: (p.items ?? []).filter((id) => shop[id]), held, y: dmg / minutes, base: { bin, shop, itemOps, level, kit: kitOf(p.champion), passive: passiveOf(p.champion) } });
    }
  }
  return out;
}

export const logM = (base, items, cards) => Math.log(Math.max(fight({ ...base, items, cards }).damage, 1));
export const band = (level) => (level <= 6 ? 1 : level <= 12 ? 2 : 3);

/** Pairs within each group of one champion: concordant when the player with the higher x has the higher y; ties in x or y are skipped. */
function agreementByChampion(rows, keyOf) {
  const groups = new Map();
  for (const r of rows) { const k = `${r.c}|${keyOf(r)}`; const g = groups.get(k) ?? []; g.push(r); groups.set(k, g); }
  const champ = new Map();
  for (const g of groups.values()) {
    const t = champ.get(g[0].c) ?? { good: 0, all: 0 };
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const dx = g[i].x - g[j].x, dy = g[i].y - g[j].y;
      if (!dx || !dy) continue;
      t.all++; if (dx > 0 === dy > 0) t.good++;
    }
    champ.set(g[0].c, t);
  }
  return [...champ.values()].filter((t) => t.all >= 30).map((t) => t.good / t.all);
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
let seed = 7;
export const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
export const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Median agreement over champions with 30 pairs or more, champions below 0.50, and the median of 20 runs with y shuffled within each group. */
export function orderReport(rows, keyOf) {
  const real = agreementByChampion(rows, keyOf);
  const groups = new Map();
  for (const r of rows) { const k = `${r.c}|${keyOf(r)}`; const g = groups.get(k) ?? []; g.push(r); groups.set(k, g); }
  const shuffled = Array.from({ length: 20 }, () => median(agreementByChampion([...groups.values()].flatMap((g) => { const ys = shuffle(g.map((r) => r.y)); return g.map((r, i) => ({ ...r, y: ys[i] })); }), keyOf)));
  return `median agreement ${median(real).toFixed(4)}, champions ${real.length}, below 0.50 ${real.filter((a) => a < 0.5).length}, shuffled median ${median(shuffled).toFixed(4)}`;
}

/** The result next to the script, with the date and the commit it ran on. */
export function writeResult(scriptUrl, lines) {
  const commit = execSync('git rev-parse --short HEAD').toString().trim(), dirty = execSync('git status --porcelain --untracked-files=no').toString().trim() ? ' (with uncommitted changes)' : '';
  const text = [`${new Date().toISOString()} on ${commit}${dirty}`, ...lines].join('\n') + '\n';
  const path = fileURLToPath(scriptUrl).replace(/\.mjs$/, '.txt');
  writeFileSync(path, text);
  console.log(text);
}
