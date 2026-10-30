// The calculator's statistical core: each Mayhem game as team against team. A player's strength is their champion's
// plus their augments'; the team with more strength is more likely to win:
//   P(first team wins) = sigmoid(bias + sum of first team's strengths - sum of second team's).
// Fitting on games, not players, lets teammates' and opponents' champions and augments act as controls; a player's own
// win says little (on held-out games: 53% per player, 61% per team). Regularised logistic regression (L-BFGS), so a
// champion or augment with few games stays near zero. Plan and acceptance numbers: docs/calculator-plan.md.

import type { MayhemGame } from '../lcu/mayhemGames.js';

/**
 * Prior standard deviations on the team log-odds scale: how far a champion or an augment may move with few games.
 * Chosen by 4-fold blocked cross-validation (champion and augment separately) on the first 80% of the current patch's
 * games, then tested once on the last 1,000: log-loss 0.659, accuracy 61.1% (the per-player model: 53%). Strict test on
 * the same games: augment ranking AUC 0.64 against the site's tiers 0.61, and level with each augment's plain win rate.
 * Class x augment terms did not improve cross-validated log-loss by 0.002 and stay out (classes unset).
 */
export const PRIORS = { champion: 0.105, augment: 0.1, classAugment: 0.05, bias: 0.1 };
/** A class x augment feature enters only with this many player appearances in the training games. */
export const CLASS_SUPPORT = 200;

/** Champion classes (Riot's roles: fighter, mage ...); a champion with two counts half in each. */
export type Classes = Map<number, string[]>;

export interface TeamModel {
  /** Feature keys: "c:<champion id>", "a:<augment id>". */
  keys: string[];
  weights: Float64Array;
  bias: number;
  /** The classes it was fitted with, if any: needed to read class x augment weights. */
  classes?: Classes;
}

interface Design {
  keys: string[];
  index: Map<string, number>;
  /** Per game: feature indices and their signed counts (+ first team, - second team). */
  rows: { idx: Int32Array; val: Float64Array; y: number }[];
  prior: Float64Array;
}

/** A player's features with their weights: champion, augments, and (with classes) class x augment at 1/classes each. */
function featuresOf(p: MayhemGame['players'][number], classes?: Classes): [string, number][] {
  const augs = [...new Set(p.augments)];
  const roles = classes?.get(p.champion) ?? [];
  return [[`c:${p.champion}`, 1], ...augs.map((a): [string, number] => [`a:${a}`, 1]), ...roles.flatMap((r) => augs.map((a): [string, number] => [`k:${r}|a:${a}`, 1 / roles.length]))];
}

function design(games: MayhemGame[], keys?: string[], classes?: Classes): Design {
  // Class x augment features need support in these games (see CLASS_SUPPORT); the others always enter.
  const support = new Map<string, number>();
  if (!keys && classes) for (const g of games) for (const p of g.players) for (const [f] of featuresOf(p, classes)) if (f.startsWith('k:')) support.set(f, (support.get(f) ?? 0) + 1);
  const index = new Map<string, number>((keys ?? []).map((k, i) => [k, i]));
  const all = keys ? [...keys] : [];
  const rows = games
    .filter((g) => g.players.length === 10)
    .map((g) => {
      const sum = new Map<number, number>();
      g.players.forEach((p, i) => {
        for (const [f, v] of featuresOf(p, classes)) {
          let j = index.get(f);
          if (j === undefined) {
            if (keys || (f.startsWith('k:') && (support.get(f) ?? 0) < CLASS_SUPPORT)) continue; // unseen, or too rare
            j = all.length;
            all.push(f);
            index.set(f, j);
          }
          sum.set(j, (sum.get(j) ?? 0) + (i < 5 ? v : -v));
        }
      });
      const used = [...sum].filter(([, v]) => v !== 0);
      return { idx: Int32Array.from(used.map(([j]) => j)), val: Float64Array.from(used.map(([, v]) => v)), y: g.players[0].win ? 1 : 0 };
    });
  const prior = Float64Array.from(all, (k) => (k.startsWith('c:') ? PRIORS.champion : k.startsWith('k:') ? PRIORS.classAugment : PRIORS.augment));
  return { keys: all, index, rows, prior };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const softplus = (z: number) => (z > 30 ? z : Math.log1p(Math.exp(z)));

/** Mean negative log-likelihood plus the priors, and its gradient; x = [weights..., bias]. */
function objective(d: Design, x: Float64Array, grad: Float64Array, weightOf: Float64Array): number {
  const n = d.keys.length;
  grad.fill(0);
  let loss = 0;
  let total = 0;
  for (let r = 0; r < d.rows.length; r++) {
    const w = weightOf[r];
    if (!w) continue;
    const row = d.rows[r];
    let eta = x[n];
    for (let k = 0; k < row.idx.length; k++) eta += x[row.idx[k]] * row.val[k];
    loss += w * (softplus(eta) - row.y * eta);
    const g = w * (sigmoid(eta) - row.y);
    for (let k = 0; k < row.idx.length; k++) grad[row.idx[k]] += g * row.val[k];
    grad[n] += g;
    total += w;
  }
  for (let j = 0; j < n; j++) {
    const s2 = d.prior[j] * d.prior[j];
    loss += (0.5 * x[j] * x[j]) / s2;
    grad[j] += x[j] / s2;
  }
  loss += (0.5 * x[n] * x[n]) / (PRIORS.bias * PRIORS.bias);
  grad[n] += x[n] / (PRIORS.bias * PRIORS.bias);
  for (let j = 0; j <= n; j++) grad[j] /= total;
  return loss / total;
}

/** L-BFGS with a backtracking (Armijo) line search; history 10, at most maxIter steps. */
function minimise(f: (x: Float64Array, g: Float64Array) => number, x0: Float64Array, maxIter = 200): Float64Array {
  const n = x0.length;
  const x = Float64Array.from(x0);
  let g = new Float64Array(n);
  let fx = f(x, g);
  const S: Float64Array[] = [];
  const Y: Float64Array[] = [];
  const dot = (a: Float64Array, b: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  };
  for (let it = 0; it < maxIter; it++) {
    // Two-loop recursion: d = -H g.
    const q = Float64Array.from(g);
    const alpha: number[] = [];
    for (let i = S.length - 1; i >= 0; i--) {
      const a = dot(S[i], q) / dot(Y[i], S[i]);
      alpha[i] = a;
      for (let k = 0; k < n; k++) q[k] -= a * Y[i][k];
    }
    if (S.length) {
      const last = S.length - 1;
      const gamma = dot(S[last], Y[last]) / dot(Y[last], Y[last]);
      for (let k = 0; k < n; k++) q[k] *= gamma;
    }
    for (let i = 0; i < S.length; i++) {
      const b = dot(Y[i], q) / dot(Y[i], S[i]);
      for (let k = 0; k < n; k++) q[k] += S[i][k] * (alpha[i] - b);
    }
    for (let k = 0; k < n; k++) q[k] = -q[k];
    let slope = dot(q, g);
    if (slope >= 0) {
      for (let k = 0; k < n; k++) q[k] = -g[k]; // not a descent direction: fall back to the gradient
      slope = dot(q, g);
    }
    let step = it === 0 ? 1 / Math.max(1, Math.sqrt(dot(g, g))) : 1;
    const xn = new Float64Array(n);
    const gn = new Float64Array(n);
    let fn = Infinity;
    for (let tries = 0; tries < 30; tries++) {
      for (let k = 0; k < n; k++) xn[k] = x[k] + step * q[k];
      fn = f(xn, gn);
      if (fn <= fx + 1e-4 * step * slope) break;
      step /= 2;
    }
    if (!(fn < fx)) break;
    const s = new Float64Array(n);
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) (s[k] = xn[k] - x[k]), (y[k] = gn[k] - g[k]);
    if (dot(s, y) > 1e-12) {
      S.push(s);
      Y.push(y);
      if (S.length > 10) S.shift(), Y.shift();
    }
    x.set(xn);
    const improvement = (fx - fn) / Math.max(1e-12, Math.abs(fx));
    fx = fn;
    g = Float64Array.from(gn);
    let gmax = 0;
    for (let k = 0; k < n; k++) gmax = Math.max(gmax, Math.abs(g[k]));
    if (gmax < 1e-6 || improvement < 1e-10) break;
  }
  return x;
}

/** Fits the team model; weights per game (a bootstrap draws games with repeats) default to one each. */
export function fitTeamModel(games: MayhemGame[], weights?: Float64Array, classes?: Classes): TeamModel {
  const d = design(games, undefined, classes);
  const w = weights ?? new Float64Array(d.rows.length).fill(1);
  const x = minimise((xx, g) => objective(d, xx, g, w), new Float64Array(d.keys.length + 1));
  return { keys: d.keys, weights: x.slice(0, d.keys.length), bias: x[d.keys.length], classes };
}

/** A player's strength under the model (champion + augments); features it never saw count zero. */
export function strength(m: TeamModel, champion: number, augments: number[]): number {
  const at = new Map(m.keys.map((k, i) => [k, i]));
  return featuresOf({ champion, augments, win: false, items: [] }, m.classes).reduce((s, [f, v]) => s + v * (m.weights[at.get(f) ?? -1] ?? 0), 0);
}

/** P(first team wins) for each game with ten players. */
export function predictGames(m: TeamModel, games: MayhemGame[]): { p: number; y: number }[] {
  const d = design(games, m.keys, m.classes);
  return d.rows.map((r) => {
    let eta = m.bias;
    for (let k = 0; k < r.idx.length; k++) eta += m.weights[r.idx[k]] * r.val[k];
    return { p: sigmoid(eta), y: r.y };
  });
}

/** Log-loss, accuracy and calibration error (5 equal-count bins) of predictions. */
export function evaluate(preds: { p: number; y: number }[]): { logLoss: number; accuracy: number; calibration: number } {
  const eps = 1e-6;
  const logLoss = preds.reduce((s, { p, y }) => s - (y ? Math.log(Math.max(eps, p)) : Math.log(Math.max(eps, 1 - p))), 0) / preds.length;
  const accuracy = preds.filter(({ p, y }) => (p > 0.5 ? 1 : 0) === y).length / preds.length;
  const sorted = [...preds].sort((a, b) => a.p - b.p);
  let calibration = 0;
  for (let b = 0; b < 5; b++) {
    const bin = sorted.slice(Math.floor((b * sorted.length) / 5), Math.floor(((b + 1) * sorted.length) / 5));
    if (!bin.length) continue;
    const gap = Math.abs(bin.reduce((s, x) => s + x.p, 0) / bin.length - bin.reduce((s, x) => s + x.y, 0) / bin.length);
    calibration = Math.max(calibration, gap);
  }
  return { logLoss, accuracy, calibration };
}

/** Games drawn with repeats (a bootstrap sample), as per-game weights; rand returns numbers in [0, 1). */
export function bootstrapWeights(count: number, rand: () => number): Float64Array {
  const w = new Float64Array(count);
  for (let i = 0; i < count; i++) w[Math.floor(rand() * count)]++;
  return w;
}

/** Games the model can use: both teams complete. */
export const fullGames = (games: MayhemGame[]) => games.filter((g) => g.players.length === 10);

/**
 * Each augment's effect on its team's win chance, in percentage points (a log-odds weight w is about 25w points near
 * 50%), with the 5th and 95th percentiles over bootstrap refits when there are any.
 */
export function augmentEffects(m: TeamModel, boot: TeamModel[]): Map<number, { points: number; low?: number; high?: number }> {
  const out = new Map<number, { points: number; low?: number; high?: number }>();
  m.keys.forEach((k, i) => {
    if (!k.startsWith('a:')) return;
    const draws = boot.map((b) => 25 * (b.weights[b.keys.indexOf(k)] ?? 0)).sort((x, y) => x - y);
    const at = (q: number) => draws[Math.min(draws.length - 1, Math.floor(q * draws.length))];
    out.set(Number(k.slice(2)), { points: 25 * m.weights[i], ...(draws.length >= 20 ? { low: at(0.05), high: at(0.95) } : {}) });
  });
  return out;
}
