import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lcuGetter } from '../../src/lcu/client.js';

// A local HTTPS server with a throwaway self-signed certificate stands in for the League client.
let server: Server;
let port = 0;
let lastAuth = '';
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version']);
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  if (!hasOpenssl) return;
  const dir = mkdtempSync(join(tmpdir(), 'lcu-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
    lastAuth = req.headers.authorization ?? '';
    if (req.url === '/lol-gameflow/v1/gameflow-phase') return res.end('"ChampSelect"');
    if (req.url === '/broken') return res.writeHead(500).end('oops');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server?.close());

describe.skipIf(!hasOpenssl)('lcuGetter (against a self-signed local HTTPS server)', () => {
  it('sends riot:<password> basic auth and parses JSON', async () => {
    const get = lcuGetter({ port, password: 'pw' });
    expect(await get('/lol-gameflow/v1/gameflow-phase')).toBe('ChampSelect');
    expect(lastAuth).toBe(`Basic ${Buffer.from('riot:pw').toString('base64')}`);
  });
  it('maps 404 to null and other errors to rejections', async () => {
    const get = lcuGetter({ port, password: 'pw' });
    expect(await get('/lol-champ-select/v1/session')).toBeNull();
    await expect(get('/broken')).rejects.toThrow('HTTP 500');
  });
  it('rejects when nothing listens', async () => {
    await expect(lcuGetter({ port: 1, password: 'pw' })('/x')).rejects.toThrow();
  });
});
