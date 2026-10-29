// Mayhem build advice from Gemini (free tier, the owner's key): the champion's and the chosen augments' texts and the
// map's items go in; a build comes back with a reason per item. Two calls with the arithmetic in between, not a tool
// loop: the first picks the build style, up to four candidate builds and the passives the texts describe; the app checks
// and calculates them; the second picks one and explains it. Runs only when the player asks.

import { z } from 'zod';
import { Effect, type BuildResult } from './calculator.js';

export const MODEL = 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Build kinds as players name them; the model picks the one the augments point to. */
export const BUILD_STYLES = ['ap', 'ad', 'onhit', 'crit', 'attack-speed', 'lethality', 'burn', 'tank', 'health', 'omnivamp', 'lifesteal', 'haste', 'mana', 'utility'] as const;
export type BuildStyle = (typeof BUILD_STYLES)[number];

export interface AdviceInput {
  champion: { name: string; enName: string; abilities: { key: string; enName: string; text: string }[] };
  augments: { id: number; name: string; enName: string; text: string }[];
  /** Every finished item and boots on the map. */
  pool: { id: number; enName: string; gold: number; boots: boolean; text: string }[];
  /** The champion's usual build from match data. It is ARAM's (no Mayhem build data exists), so augments are not in it. */
  usual: number[];
}

export interface Advice {
  style: BuildStyle;
  styleReason: string;
  items: { id: number; reason: string; inUsual: boolean }[];
  avoid: { id: number; reason: string }[];
  summary: string;
  /** The passives read from the texts that went into the numbers, with the sentence each came from. */
  effects: Effect[];
}

// Plain JSON schemas (no oneOf, no constraints beyond enums): the most widely accepted shape for structured output.
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
          kind: { type: 'string', enum: ['statMultiplier', 'onHit', 'burn', 'attackSpeedCap'] },
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
    items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
    avoid: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
    summary: { type: 'string' },
  },
  required: ['chosen', 'items', 'avoid', 'summary'],
};

const Plan = z.object({
  style: z.enum(BUILD_STYLES),
  styleReason: z.string(),
  candidates: z.array(z.object({ label: z.string(), items: z.array(z.number().int()) })),
  effects: z.array(z.record(z.string(), z.unknown())),
});
const Final = z.object({
  chosen: z.number().int(),
  items: z.array(z.object({ id: z.number().int(), reason: z.string() })),
  avoid: z.array(z.object({ id: z.number().int(), reason: z.string() })),
  summary: z.string(),
});

const RULES = `You recommend League of Legends ARAM: Mayhem item builds for one champion after the player chose some augments.
A single augment can change the whole build: one that adds magic damage to attacks can turn an AD marksman into AP, an attack-speed or on-hit augment favours on-hit items, and an "Upgrade <item>" augment makes that item a priority.
The usual build is from ordinary ARAM games and ignores augments: keep its items when they still fit, replace them when an augment points elsewhere.
Only use item ids from the item list. A build is six different items with at most one pair of boots (boots first when the champion buys boots).
Write every reason and summary in Arabic, short and concrete (one sentence, numbers when you have them). Item and champion names stay in English. Never name any website or data provider.`;

const PLAN_TASK = `Step 1. Decide the build style the augments point to, then give 2 to 4 candidate builds worth comparing (different ideas, not small swaps).
Also list the passives that matter for these candidates, read from the item and augment texts, so a calculator can add them up:
- statMultiplier: an item or augment that multiplies AP, AD or health (stat, factor: 1.3 for +30%).
- onHit: damage added to every attack (damageType, flat, apRatio, totalAdRatio, bonusAdRatio as fractions: 0.2 for 20%).
- burn: damage over time as a share of the target's max health (damageType, fractionPerSecond: 0.01 for 1% per second, durationSeconds).
- attackSpeedCap: an augment that changes the 2.5 attack speed cap (cap; 0 means no cap).
source is the item id or augment id the passive comes from; evidence is the exact sentence from its text. Leave out passives you are not sure of.`;

const FINAL_TASK = `Step 2. The calculator results for the candidates are below (level 18, target with 100 armor, 80 magic resist, 3000 health).
Pick the best candidate for these augments (chosen: its index), give a reason for every one of its items, up to 3 items of the usual build the augments make worse (avoid), and a two-sentence summary.`;

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
    'Chosen augments (id | name | effect):',
    ...input.augments.map((a) => `${a.id} | ${a.enName} (${a.name}) | ${plain(a.text)}`),
    '',
    `Usual ARAM build: ${input.usual.length ? input.usual.map((id) => `${id} ${name(id)}`).join(', ') : 'none'}`,
    '',
    'Item list (id | name | cost | boots | effect):',
    ...[...input.pool].sort((a, b) => a.id - b.id).map((i) => `${i.id} | ${i.enName} | ${i.gold}g | ${i.boots ? 'boots' : '-'} | ${plain(i.text).replace(/\n+/g, ' ')}`),
  ].join('\n');
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

/** Sends one request; `post` is fetch in the app and a fake in tests. Returns the model's text. */
export type GeminiPost = (body: object) => Promise<{ status: number; json: unknown }>;

async function ask(post: GeminiPost, input: string, schema: object): Promise<unknown> {
  const r = await post({
    model: MODEL,
    input,
    store: false,
    response_format: { type: 'text', mime_type: 'application/json', schema },
    generation_config: { thinking_level: 'medium' },
  });
  if (r.status === 429) throw new Error('انتهى الحد المجاني لـ Gemini الآن. حاول بعد قليل أو غداً.');
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    // Google sends the error as [{ error }] or { error }.
    const body = (Array.isArray(r.json) ? r.json[0] : r.json) as { error?: { message?: string } } | null;
    const msg = body?.error?.message ?? '';
    throw new Error(/key/i.test(msg) ? 'مفتاح Gemini غير صالح. راجعه في الإعدادات.' : `رفض Gemini الطلب: ${msg.slice(0, 200)}`);
  }
  if (r.status >= 300) throw new Error(`تعذّر الاتصال بـ Gemini (HTTP ${r.status}).`);
  const body = r.json as { status?: string; steps?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  if (body.status !== 'completed') throw new Error('لم يكتمل رد Gemini.');
  const text = (body.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).flatMap((c) => (c.type === 'text' && c.text ? [c.text] : [])).join('');
  return JSON.parse(text);
}

export function geminiPost(apiKey: string, fetchImpl: typeof fetch): GeminiPost {
  return async (body) => {
    const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

export async function adviseBuild(post: GeminiPost, input: AdviceInput, calculate: (builds: number[][], effects: Effect[]) => BuildResult[]): Promise<Advice> {
  const context = contextText(input);
  const plan = Plan.parse(await ask(post, `${context}\n\n${PLAN_TASK}`, PLAN_SCHEMA));
  const effects = plan.effects.map(toEffect).filter((e): e is Effect => e !== null);
  // The usual build is always one of the candidates: the answer is then compared with what players do.
  const candidates = legalBuilds([...plan.candidates, { label: 'usual ARAM build', items: input.usual.slice(0, 6) }], input.pool).slice(0, 5);
  if (!candidates.length) throw new Error('لم يقترح Gemini بناءً صالحاً من أيتمات هذه الخريطة.');
  const results = calculate(candidates.map((c) => c.items), effects);
  const table = candidates.map((c, i) => `${i}. ${c.label}: ${JSON.stringify({ ...results[i], stats: undefined, keyStats: pickStats(results[i]) })}`).join('\n');
  const final = Final.parse(
    await ask(post, `${context}\n\nYour step 1: style ${plan.style} (${plan.styleReason}); passives: ${JSON.stringify(effects)}\n\n${FINAL_TASK}\n${table}`, FINAL_SCHEMA),
  );
  const chosen = candidates[final.chosen] ?? candidates[0];
  const usual = new Set(input.usual);
  const poolIds = new Set(input.pool.map((i) => i.id));
  // The build is the calculated candidate as it is; the model only supplies the words.
  return {
    style: plan.style,
    styleReason: plan.styleReason,
    items: chosen.items.map((id) => ({ id, reason: final.items.find((i) => i.id === id)?.reason ?? '', inUsual: usual.has(id) })),
    avoid: final.avoid.filter((a) => poolIds.has(a.id) && !chosen.items.includes(a.id)).slice(0, 3),
    summary: final.summary,
    effects: effects.filter((e) => !poolIds.has(e.source) || chosen.items.includes(e.source)),
  };
}

const pickStats = (r: BuildResult) => ({ ad: r.stats.ad, ap: r.stats.ap, attackSpeed: r.stats.attackSpeed, crit: r.stats.crit, hp: r.stats.hp, armor: r.stats.armor, mr: r.stats.mr, haste: r.stats.haste });
