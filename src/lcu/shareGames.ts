// Shares Mayhem games between the players who turned it on: sends the games collected here, takes those of the others.
// Only what validGame allows travels: no names, no accounts. Runs after a collection, in the same queue, so the two
// never write the games file at once.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { validGame } from './gameShape.js';
import { readMayhemGames, type MayhemGame } from './mayhemGames.js';

const BATCH = 100;
const PAGES_PER_RUN = 5;
// shortcut: the whole file is read into memory, so taking stops here; dropping old patches from the file would lift it.
const MAX_STORED = 30_000;

type Fetch = typeof fetch;

export async function shareGames(file: string, url: string, fetchImpl: Fetch): Promise<{ sent: number; taken: number }> {
  const marks = `${file}.share.json`;
  const saved = (await readFile(marks, 'utf8').then(JSON.parse, () => null)) as { sent?: number; after?: number } | null;
  let sentUpTo = saved?.sent ?? 0;
  let after = saved?.after ?? 0;
  const stored = await readMayhemGames(file);
  const save = () => writeFile(marks, JSON.stringify({ sent: sentUpTo, after }));

  // A failure stops here with the marks saved: the next run goes on from them.
  let sent = 0;
  for (; sentUpTo < stored.length; sentUpTo = Math.min(sentUpTo + BATCH, stored.length)) {
    const games = stored.slice(sentUpTo, sentUpTo + BATCH).filter((g) => validGame(g));
    if (!games.length) continue;
    const res = await fetchImpl(`${url}/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(games) });
    if (!res.ok) {
      await save();
      throw new Error(`share: HTTP ${res.status}`);
    }
    sent += games.length;
    await save();
  }

  const have = new Set(stored.map((g) => g.id));
  const taken: MayhemGame[] = [];
  for (let page = 0; page < PAGES_PER_RUN && stored.length + taken.length < MAX_STORED; page++) {
    const res = await fetchImpl(`${url}/games?after=${after}`);
    if (!res.ok) break;
    const body = (await res.json()) as { games?: unknown; last?: unknown };
    if (!Array.isArray(body.games) || !body.games.length || typeof body.last !== 'number') break;
    for (const g of body.games) {
      if (validGame(g) && !have.has(g.id)) {
        have.add(g.id);
        taken.push(g);
      }
    }
    after = body.last;
  }
  if (taken.length) {
    const tmp = `${file}.${process.pid}.share.tmp`;
    await writeFile(tmp, JSON.stringify([...stored, ...taken]));
    await rename(tmp, file); // a crash mid-write leaves the old file whole
    sentUpTo = stored.length + taken.length; // these came from the server: not sent back
  }
  await save();
  return { sent, taken: taken.length };
}
