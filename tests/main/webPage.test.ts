import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webServer, type Handler } from '../../src/main/webPage.js';

const KEY = 'test-key-0123456789';
const root = mkdtempSync(join(tmpdir(), 'web-'));
mkdirSync(join(root, 'static'));
writeFileSync(join(root, 'static/overlay.html'), '<p>ok</p>');
writeFileSync(join(root, 'secret.txt'), 'no');
const handlers = new Map<string, Handler>([
  ['build:engine', (_e, ...args) => ({ args })],
  ['ai:key:set', () => 'set'],
]);
const server = webServer(root, handlers, KEY);
let base = '';
beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => void server.close());

const cookie = { cookie: `ugk=${KEY}` };
const post = (channel: string, headers: Record<string, string>, body = '[1,[2]]') =>
  fetch(`${base}/ipc/${channel}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

describe('webServer', () => {
  it('turns the link key into a cookie and goes to the page', async () => {
    const r = await fetch(`${base}/?k=${KEY}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/static/overlay.html');
    expect(r.headers.get('set-cookie')).toMatch(/ugk=test-key-0123456789; HttpOnly; SameSite=Strict/);
  });
  it('refuses everything without the key', async () => {
    expect((await fetch(`${base}/static/overlay.html`)).status).toBe(403);
    expect((await fetch(`${base}/?k=wrong-key-0123456789`)).status).toBe(403);
    expect((await post('build:engine', {})).status).toBe(403);
  });
  it('serves the page with the key, and nothing outside static and dist', async () => {
    expect(await (await fetch(`${base}/static/overlay.html`, { headers: cookie })).text()).toBe('<p>ok</p>');
    expect((await fetch(`${base}/static/../secret.txt`, { headers: cookie })).status).toBe(404);
    expect((await fetch(`${base}/static/%2e%2e/secret.txt`, { headers: cookie })).status).toBe(404);
  });
  it('answers overlay calls with the same handler and arguments', async () => {
    const r = await post('build:engine', cookie);
    expect(await r.json()).toEqual({ args: [1, [2]] });
  });
  it('never answers calls outside the overlay, or posts that are not JSON', async () => {
    expect((await post('ai:key:set', cookie)).status).toBe(404);
    const form = await fetch(`${base}/ipc/build:engine`, { method: 'POST', headers: { ...cookie, 'content-type': 'text/plain' }, body: '[]' });
    expect(form.status).toBe(415);
  });
});
