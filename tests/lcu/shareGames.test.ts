import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../../server/worker.js';
import { anonymous, shareId, uniqueGames, validGame, validShared } from '../../src/lcu/gameShape.js';
import type { MayhemGame } from '../../src/lcu/mayhemGames.js';
import { shareGames } from '../../src/lcu/shareGames.js';

const now = Date.now();
const player = (champion: number, win: boolean) => ({ champion, win, augments: [1054], items: [3084], stats: { kills: 2 } });
/** A game as collected here: Riot's id, the exact start. `n` makes it a different game. */
const game = (n: number): MayhemGame => ({ id: 7000000000 + n, at: now - 1000, duration: 900, version: '16.21.712.4567', players: [...Array(5).fill(0).map(() => player(n, true)), ...Array(5).fill(0).map(() => player(n, false))] });

/** The worker's database, in memory: what the worker asks of it and no more. */
function memoryDb(): Env & { rows: { seq: number; id: number; body: string }[] } {
  const rows: { seq: number; id: number; body: string }[] = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v),
    all: async () => ({ results: rows.filter((r) => r.seq > (args[0] as number)).slice(0, args[1] as number) }),
    run: async () => {
      if (!rows.some((r) => r.id === args[0])) rows.push({ seq: rows.length + 1, id: args[0] as number, body: args[1] as string });
    },
  });
  type S = ReturnType<typeof statement>;
  return { rows, DB: { prepare: (sql: string) => statement(sql), batch: async (list: S[]) => (await Promise.all(list.map((s) => s.run())), []) } } as never;
}
const post = (env: Env, body: unknown) => handle(new Request('https://x/games', { method: 'POST', body: JSON.stringify(body) }), env).then((r) => r.json() as Promise<{ accepted: number; rejected: number }>);

describe('validGame', () => {
  it('accepts a real game', () => expect(validGame(game(1), now)).toBe(true));
  it('refuses a name anywhere, an unknown stat, a bad split, and the future', () => {
    const g = game(1);
    expect(validGame({ ...g, player: 'Saad' }, now)).toBe(false);
    expect(validGame({ ...g, players: [{ ...g.players[0], name: 'Saad' }, ...g.players.slice(1)] }, now)).toBe(false);
    expect(validGame({ ...g, players: [{ ...g.players[0], stats: { puuid: 1 } }, ...g.players.slice(1)] }, now)).toBe(false);
    expect(validGame({ ...g, players: g.players.map((p) => ({ ...p, win: true })) }, now)).toBe(false);
    expect(validGame({ ...g, players: g.players.slice(0, 9) }, now)).toBe(false);
    expect(validGame({ ...g, at: now + 3 * 86_400_000 }, now)).toBe(false);
    expect(validGame({ ...g, version: '<script>' }, now)).toBe(false);
  });
});

describe('what leaves the machine', () => {
  it("replaces Riot's game id and rounds the time to the hour", () => {
    const a = anonymous(game(1));
    expect(a.id).not.toBe(game(1).id);
    expect(a.id).toBe(shareId(game(1)));
    expect(a.at % 3_600_000).toBe(0);
    expect(validShared(a, now)).toBe(true);
    expect(validShared(game(1), now)).toBe(false);
  });
  it('gives different games different numbers, and the same game the same number from anyone', () => {
    expect(shareId(game(1))).not.toBe(shareId(game(2)));
    const same: MayhemGame = { ...game(1), id: 5, at: 1 };
    expect(shareId(same)).toBe(shareId(game(1)));
    expect(Number.isSafeInteger(shareId(game(1)))).toBe(true);
  });
  it('counts a game collected here and received from others once', () => {
    expect(uniqueGames([game(1), anonymous(game(1)), game(2)]).map((g) => g.id)).toEqual([game(1).id, game(2).id]);
  });
});

describe('the server', () => {
  it("stores good games once, and refuses the rest, a game with Riot's id among them", async () => {
    const env = memoryDb();
    const a = anonymous(game(1));
    expect(await post(env, [a, a, game(2), { id: 2 }])).toEqual({ accepted: 2, rejected: 2 });
    expect(env.rows.map((r) => r.id)).toEqual([a.id]);
  });
  it('refuses a huge batch and bad json', async () => {
    const env = memoryDb();
    expect((await handle(new Request('https://x/games', { method: 'POST', body: JSON.stringify(Array(101).fill(anonymous(game(1)))) }), env)).status).toBe(400);
    expect((await handle(new Request('https://x/games', { method: 'POST', body: '{' }), env)).status).toBe(400);
  });
  it('hands games out after a place', async () => {
    const env = memoryDb();
    const [a, b, c] = [1, 2, 3].map((n) => anonymous(game(n)));
    await post(env, [a, b, c]);
    const r = (await (await handle(new Request('https://x/games?after=1'), env)).json()) as { games: MayhemGame[]; last: number };
    expect(r.games.map((g) => g.id)).toEqual([b.id, c.id]);
    expect(r.last).toBe(3);
  });
});

describe('shareGames', () => {
  const server = (env: Env): typeof fetch => ((url: string, init?: RequestInit) => handle(new Request(url, init), env)) as never;
  const fileWith = async (games: MayhemGame[]) => {
    const f = join(await mkdtemp(join(tmpdir(), 'share-')), 'games.json');
    await writeFile(f, JSON.stringify(games));
    return f;
  };

  it("sends what is here without Riot's id, takes the others' games, and sends nothing twice", async () => {
    const env = memoryDb();
    await post(env, [anonymous(game(9))]);
    const f = await fileWith([game(1), game(2)]);
    expect(await shareGames(f, 'https://x', server(env))).toEqual({ sent: 2, taken: 1 });
    expect((JSON.parse(await readFile(f, 'utf8')) as MayhemGame[]).map((g) => g.id)).toEqual([game(1).id, game(2).id, shareId(game(9))]);
    expect(env.rows.map((r) => r.id).sort()).toEqual([1, 2, 9].map((n) => shareId(game(n))).sort());
    expect(env.rows.some((r) => r.body.includes(String(game(1).id)))).toBe(false);
    expect(await shareGames(f, 'https://x', server(env))).toEqual({ sent: 0, taken: 0 });
  });

  it('does not take back a game it already has under its own id', async () => {
    const env = memoryDb();
    await post(env, [anonymous(game(1))]);
    const f = await fileWith([game(1)]);
    expect(await shareGames(f, 'https://x', server(env))).toEqual({ sent: 1, taken: 0 });
  });

  it('leaves the file alone and goes on later when the server fails', async () => {
    const f = await fileWith([game(1)]);
    const down = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(shareGames(f, 'https://x', down)).rejects.toThrow(/500/);
    expect(JSON.parse(await readFile(f, 'utf8'))).toHaveLength(1);
    const env = memoryDb();
    expect(await shareGames(f, 'https://x', server(env))).toEqual({ sent: 1, taken: 0 });
  });

  it("does not take a game the server shouldn't have", async () => {
    const f = await fileWith([]);
    const bad = (async () => new Response(JSON.stringify({ games: [{ id: 5, name: 'Saad' }, game(3)], last: 1 }))) as unknown as typeof fetch;
    expect(await shareGames(f, 'https://x', bad)).toMatchObject({ taken: 0 });
    expect(JSON.parse(await readFile(f, 'utf8'))).toEqual([]);
  });
});
