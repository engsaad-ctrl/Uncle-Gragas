// The Cloudflare Worker behind game sharing: takes Mayhem games and hands them out. It stores only what validGame allows
// (no names, no accounts) and never the sender's address. Anyone can post, so a game must pass validGame and a repeat is
// ignored; a forged but well-formed game cannot be told apart here.

import { validGame } from '../src/lcu/gameShape.js';

const MAX_BODY = 2_000_000;
const MAX_BATCH = 100;
const PAGE = 500;

interface Statement {
  bind(...values: unknown[]): Statement;
  all(): Promise<{ results: { seq: number; body: string }[] }>;
  run(): Promise<unknown>;
}
export interface Env {
  DB: { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<{ meta?: { changes?: number } }[]> };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== '/games') return json({ error: 'not found' }, 404);

  if (req.method === 'GET') {
    const after = Number(url.searchParams.get('after') ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) return json({ error: 'bad after' }, 400);
    const { results } = await env.DB.prepare('SELECT seq, body FROM games WHERE seq > ? ORDER BY seq LIMIT ?').bind(after, PAGE).all();
    return json({ games: results.map((r) => JSON.parse(r.body) as unknown), last: results.at(-1)?.seq ?? after });
  }

  if (req.method === 'POST') {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
    let games: unknown;
    try {
      games = JSON.parse(text);
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    if (!Array.isArray(games) || games.length > MAX_BATCH) return json({ error: 'bad batch' }, 400);
    const good = games.filter((g) => validGame(g));
    if (good.length) {
      const insert = env.DB.prepare('INSERT OR IGNORE INTO games (id, body) VALUES (?, ?)');
      await env.DB.batch(good.map((g) => insert.bind(g.id, JSON.stringify(g))));
    }
    return json({ accepted: good.length, rejected: games.length - good.length });
  }

  return json({ error: 'method not allowed' }, 405);
}

export default { fetch: handle };
