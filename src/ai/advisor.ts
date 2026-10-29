// Mayhem build advice from Gemini (free tier, the owner's key): the champion's and the chosen augments' texts and the
// map's items go in; a build comes back with a reason per item. Two calls with the arithmetic in between, not a tool
// loop: the first picks the build style, up to four candidate builds and the passives the texts describe; the app checks
// and calculates them; the second picks one and explains it. Runs only when the player asks.

import { z } from 'zod';
import { Effect, type BuildResult } from './calculator.js';

// Tried on the owner's free key (2026-10-29): 3.8 and 3.7 Flash hang, 3.6 and 3.5 Flash answer in about 5 s, 3.5
// Flash-Lite in 4 s. The free tier also answers 503 (busy) at times: each model gets a second try, then the next one.
export const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const BUSY_WAIT_MS = 4000;
const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** Build kinds as players name them; the model picks the one the augments point to. */
export const BUILD_STYLES = ['ap', 'ad', 'onhit', 'crit', 'attack-speed', 'lethality', 'burn', 'tank', 'health', 'omnivamp', 'lifesteal', 'haste', 'mana', 'utility'] as const;
export type BuildStyle = (typeof BUILD_STYLES)[number];

export interface AdviceInput {
  champion: { name: string; enName: string; abilities: { key: string; enName: string; text: string }[] };
  /** tier: how strong the augment is on this champion in real Mayhem games ("S+" to "C"), when known. */
  augments: { id: number; name: string; enName: string; text: string; tier?: string }[];
  /** Every finished item and boots on the map. */
  pool: { id: number; enName: string; gold: number; boots: boolean; text: string }[];
  /** The champion's usual build: what its Mayhem players buy whatever their augments (ARAM's when Mayhem's is unknown). */
  usual: number[];
  /**
   * Mayhem games read from the players' own clients: this champion's, and those of them that took one of the chosen
   * augments, with the items bought (most bought first). A small sample: a handful of players.
   */
  played?: { games: number; items: PickCount[]; withAugments: number; itemsWithAugments: PickCount[] };
}

export interface PickCount {
  id: number;
  games: number;
  wins: number;
}

/** Below this many games, the real games are mentioned but not trusted. */
export const FEW_GAMES = 5;

export interface Advice {
  style: BuildStyle;
  styleReason: string;
  items: { id: number; reason: string; inUsual: boolean }[];
  avoid: { id: number; reason: string }[];
  summary: string;
  /** The passives read from the texts that went into the numbers, with the sentence each came from. */
  effects: Effect[];
  /** The calculator's numbers for this build, shown so the player can check them. */
  calc: BuildResult;
  /** A strong build of another style, when the augments open more than one path (Back To Basics: AP W or AD Q Kai'Sa). */
  alternative?: { style: BuildStyle; when: string; items: { id: number; reason: string; inUsual: boolean }[]; calc: BuildResult };
}

// Plain JSON schemas (no oneOf, no constraints beyond enums), sent as responseJsonSchema.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    style: { type: 'string', enum: [...BUILD_STYLES] },
    styleReason: { type: 'string' },
    candidates: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, items: { type: 'array', items: { type: 'integer' } } }, required: ['label', 'items'] } },
    effects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['statMultiplier', 'onHit', 'burn', 'attackSpeedCap', 'abilityDamage'] },
          source: { type: 'integer' },
          evidence: { type: 'string' },
          stat: { type: 'string', enum: ['ap', 'ad', 'hp'] },
          factor: { type: 'number' },
          damageType: { type: 'string', enum: ['physical', 'magic', 'true'] },
          flat: { type: 'number' },
          apRatio: { type: 'number' },
          totalAdRatio: { type: 'number' },
          bonusAdRatio: { type: 'number' },
          fractionPerSecond: { type: 'number' },
          durationSeconds: { type: 'number' },
          cap: { type: 'number' },
        },
        required: ['kind', 'source', 'evidence'],
      },
    },
  },
  required: ['style', 'styleReason', 'candidates', 'effects'],
};

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    chosen: { type: 'integer' },
    style: { type: 'string', enum: [...BUILD_STYLES] },
    styleReason: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
    avoid: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
    summary: { type: 'string' },
    alternative: { type: 'integer' },
    alternativeStyle: { type: 'string', enum: [...BUILD_STYLES] },
    alternativeWhen: { type: 'string' },
    alternativeItems: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
  },
  required: ['chosen', 'style', 'styleReason', 'items', 'avoid', 'summary', 'alternative'],
};

const Plan = z.object({
  style: z.enum(BUILD_STYLES),
  styleReason: z.string(),
  candidates: z.array(z.object({ label: z.string(), items: z.array(z.number().int()) })),
  effects: z.array(z.record(z.string(), z.unknown())),
});
const Final = z.object({
  chosen: z.number().int(),
  style: z.enum(BUILD_STYLES),
  styleReason: z.string(),
  items: z.array(z.object({ id: z.number().int(), reason: z.string() })),
  avoid: z.array(z.object({ id: z.number().int(), reason: z.string() })),
  summary: z.string(),
  alternative: z.number().int(),
  alternativeStyle: z.enum(BUILD_STYLES).optional(),
  alternativeWhen: z.string().optional(),
  alternativeItems: z.array(z.object({ id: z.number().int(), reason: z.string() })).optional(),
});

const RULES = `You recommend League of Legends ARAM: Mayhem item builds for one champion after the player chose some augments.
A single augment can change the whole build: one that adds magic damage to attacks can turn an AD marksman into AP, an attack-speed or on-hit augment favours on-hit items, and an "Upgrade <item>" augment makes that item a priority.
The usual build is what players of this champion buy in Mayhem whatever their augments: keep its items when they still fit, replace them when an augment points elsewhere.
Only use item ids from the item list. A build is six different items with at most one pair of boots (boots first when the champion buys boots).
Real Mayhem games, when listed, show what players actually bought and how often they won. With ${FEW_GAMES} or more games they outweigh your reading of the texts; with fewer, treat them as a hint only and say in the summary that there are too few real games to confirm the build.
Write every reason and summary in Arabic, short and concrete (one sentence, numbers when you have them). Item and champion names stay in English. Never name any website or data provider.`;

// The first real run read "Vulnerability" (damage over time and item effects can crit, +25% crit) as a plain crit
// build: hence the explicit "which damage sources change" step and a candidate built on the augment's own mechanic.
const PLAN_TASK = `Step 1.
First, for each augment, say to yourself which of this champion's damage sources it changes: basic attacks, on-hit, abilities, damage over time, item effects, healing or shields. The headline stat of an augment (for example "+25% crit chance") is often not its point; the rule it adds (for example "damage over time can crit") is.
Then match that against the champion's abilities: which ability deals damage over time, which applies on-hit, what scales with AP or AD.
Decide the build style from that, then give 2 to 4 candidate builds worth comparing: different ideas, not small swaps. At least one candidate must be built around the augment's own rule (items whose effects that rule improves), and one may be the champion's usual style.
Also list the passives that matter for these candidates, read from the item and augment texts, so a calculator can add them up:
- statMultiplier: an item or augment that multiplies AP, AD or health (stat, factor: 1.3 for +30%).
- onHit: damage added to every attack (damageType, flat, apRatio, totalAdRatio, bonusAdRatio as fractions: 0.2 for 20%).
- burn: damage over time as a share of the target's max health (damageType, fractionPerSecond: 0.01 for 1% per second, durationSeconds).
- attackSpeedCap: an augment that changes the 2.5 attack speed cap (cap; 0 means no cap).
- abilityDamage: an augment or item that multiplies the damage of abilities (factor: 1.35 for +35% ability damage).
Rabadon's and Warmog's multipliers are read from the game files already; you need not list them.
source is the item id or augment id the passive comes from; evidence is the exact sentence from its text. List every burn and on-hit item in your candidates and every augment passive that fits these kinds; leave out only what you are not sure of.`;

const FINAL_TASK = `Step 2. The calculator results for the candidates are below (level 18, target with 100 armor, 80 magic resist, 3000 health).
Pick the best candidate for these augments (chosen: its index), name the style of that build (style, styleReason: may differ from step 1), give a reason for every one of its items, up to 3 items of the usual build the augments make worse (avoid), and a two-sentence summary.
Many augments open more than one strong path (an ability damage augment suits both AP and AD versions of a champion). If another candidate of a different style is also strong, give it as the alternative (its index), with its style, one sentence on when to pick it instead (alternativeWhen) and a reason for each of its items. If there is only one sensible path, set alternative to -1.`;

const plain = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();

/** The champion, the augments and the item list, as the model reads them. */
export function contextText(input: AdviceInput): string {
  const c = input.champion;
  const name = (id: number) => input.pool.find((i) => i.id === id)?.enName ?? String(id);
  return [
    RULES,
    '',
    `Champion: ${c.enName} (${c.name})`,
    ...c.abilities.map((a) => `${a.key} ${a.enName}: ${plain(a.text)}`),
    '',
    'Chosen augments (id | name | tier on this champion | effect):',
    ...input.augments.map((a) => `${a.id} | ${a.enName} (${a.name}) | ${a.tier ?? 'unknown'} | ${plain(a.text)}`),
    '',
    `Usual build: ${input.usual.length ? input.usual.map((id) => `${id} ${name(id)}`).join(', ') : 'none'}`,
    '',
    ...playedText(input.played, name),
    'Item list (id | name | cost | boots | effect):',
    ...[...input.pool].sort((a, b) => a.id - b.id).map((i) => `${i.id} | ${i.enName} | ${i.gold}g | ${i.boots ? 'boots' : '-'} | ${plain(i.text).replace(/\n+/g, ' ')}`),
  ].join('\n');
}

function playedText(p: AdviceInput['played'], name: (id: number) => string): string[] {
  if (!p?.games) return ['Real Mayhem games of this champion: none recorded yet.', ''];
  const list = (items: PickCount[]) => items.map((i) => `${i.id} ${name(i.id)} (${i.games} games, ${i.wins} wins)`).join(', ') || 'none';
  return [
    `Real Mayhem games of this champion: ${p.games}${p.games < FEW_GAMES ? ' (too few)' : ''}. Items bought: ${list(p.items)}`,
    `Of them with one of the chosen augments: ${p.withAugments}${p.withAugments < FEW_GAMES ? ' (too few)' : ''}. Items bought: ${list(p.itemsWithAugments)}`,
    '',
  ];
}

/** A passive as the model wrote it, held to the calculator's schema; anything that does not fit is dropped. */
export function toEffect(raw: Record<string, unknown>): Effect | null {
  const r = Effect.safeParse(raw.kind === 'attackSpeedCap' ? { ...raw, cap: raw.cap === 0 ? null : raw.cap } : raw);
  return r.success ? r.data : null;
}

/** Candidates that are real builds on this map: known items, no repeats, at most six, at most one pair of boots. */
export function legalBuilds(candidates: { label: string; items: number[] }[], pool: AdviceInput['pool']): { label: string; items: number[] }[] {
  const byId = new Map(pool.map((i) => [i.id, i]));
  return candidates.filter((c) => {
    const items = c.items.map((id) => byId.get(id));
    return c.items.length >= 1 && c.items.length <= 6 && new Set(c.items).size === c.items.length && items.every(Boolean) && items.filter((i) => i!.boots).length <= 1;
  });
}

/** Sends one request to one model; `post` is fetch in the app and a fake in tests. status 0: no answer in time. */
export type GeminiPost = (model: string, body: object) => Promise<{ status: number; json: unknown }>;

/** Google sends an error as { error } or [{ error }]. */
const errorMessage = (json: unknown) => ((Array.isArray(json) ? json[0] : json) as { error?: { message?: string } } | null)?.error?.message ?? '';

async function ask(post: GeminiPost, input: string, schema: object): Promise<unknown> {
  const body = { contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema } };
  let r = { status: 0, json: null as unknown };
  models: for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await post(model, body);
      if (r.status !== 0 && r.status !== 429 && r.status < 500) break models;
      if (r.status < 500) break; // timeout or quota: the same model will not do better now
      await new Promise((done) => setTimeout(done, BUSY_WAIT_MS)); // busy: often free again a few seconds later
    }
  }
  if (r.status === 0) throw new Error('تأخر Gemini كثيراً. حاول مرة أخرى بعد قليل.');
  if (r.status === 429) throw new Error('انتهى الحد المجاني لـ Gemini الآن. حاول بعد قليل أو غداً.');
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    const msg = errorMessage(r.json);
    throw new Error(/key/i.test(msg) ? 'مفتاح Gemini غير صالح. راجعه في الإعدادات.' : `رفض Gemini الطلب: ${msg.slice(0, 200)}`);
  }
  if (r.status >= 300) throw new Error(`تعذّر الاتصال بـ Gemini (HTTP ${r.status}).`);
  const reply = r.json as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const c = reply.candidates?.[0];
  if (!c || c.finishReason !== 'STOP') throw new Error('لم يكتمل رد Gemini.');
  return JSON.parse((c.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join(''));
}

export function geminiPost(apiKey: string, fetchImpl: typeof fetch): GeminiPost {
  return async (model, body) => {
    try {
      // A stuck request must not leave the F7 button waiting for good.
      const res = await fetchImpl(ENDPOINT(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') return { status: 0, json: null };
      throw err;
    }
  };
}

export async function adviseBuild(post: GeminiPost, input: AdviceInput, calculate: (builds: number[][], effects: Effect[]) => BuildResult[]): Promise<Advice> {
  const context = contextText(input);
  const plan = Plan.parse(await ask(post, `${context}\n\n${PLAN_TASK}`, PLAN_SCHEMA));
  const effects = plan.effects.map(toEffect).filter((e): e is Effect => e !== null);
  // The usual build is always one of the candidates: the answer is then compared with what players do.
  const candidates = legalBuilds([...plan.candidates, { label: 'usual build', items: input.usual.slice(0, 6) }], input.pool).slice(0, 5);
  if (!candidates.length) throw new Error('لم يقترح Gemini بناءً صالحاً من أيتمات هذه الخريطة.');
  const results = calculate(candidates.map((c) => c.items), effects);
  const table = candidates.map((c, i) => `${i}. ${c.label}: ${JSON.stringify({ ...results[i], stats: undefined, keyStats: pickStats(results[i]) })}`).join('\n');
  const final = Final.parse(
    await ask(post, `${context}\n\nYour step 1: style ${plan.style} (${plan.styleReason}); passives: ${JSON.stringify(effects)}\n\n${FINAL_TASK}\n${table}`, FINAL_SCHEMA),
  );
  const chosenAt = candidates[final.chosen] ? final.chosen : 0;
  const chosen = candidates[chosenAt];
  const usual = new Set(input.usual);
  const poolIds = new Set(input.pool.map((i) => i.id));
  const alt = candidates[final.alternative];
  const shownAlt = alt && alt !== chosen && final.alternativeStyle && final.alternativeStyle !== final.style ? alt : undefined;
  const reasons = (list: { id: number; reason: string }[] | undefined, ids: number[]) =>
    ids.map((id) => ({ id, reason: list?.find((i) => i.id === id)?.reason ?? '', inUsual: usual.has(id) }));
  // The builds are the calculated candidates as they are; the model only supplies the words.
  return {
    style: final.style, // the chosen build's, not step 1's guess: they differed on the first real run
    styleReason: final.styleReason,
    items: reasons(final.items, chosen.items),
    // Nothing shown as "avoid" may sit in either build: the first real alternative held two of the avoided items.
    avoid: final.avoid.filter((a) => poolIds.has(a.id) && !chosen.items.includes(a.id) && !shownAlt?.items.includes(a.id)).slice(0, 3),
    summary: final.summary,
    effects: effects.filter((e) => !poolIds.has(e.source) || chosen.items.includes(e.source)),
    calc: results[chosenAt],
    ...(shownAlt && final.alternativeStyle
      ? { alternative: { style: final.alternativeStyle, when: final.alternativeWhen ?? '', items: reasons(final.alternativeItems, shownAlt.items), calc: results[final.alternative] } }
      : {}),
  };
}

const pickStats = (r: BuildResult) => ({ ad: r.stats.ad, ap: r.stats.ap, attackSpeed: r.stats.attackSpeed, crit: r.stats.crit, hp: r.stats.hp, armor: r.stats.armor, mr: r.stats.mr, haste: r.stats.haste });
