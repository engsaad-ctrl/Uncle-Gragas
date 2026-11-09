// F7 on a phone on the same Wi-Fi: the same overlay page served by the app, its calls answered by the same handlers.
// Any device on the network can reach the port, so everything needs the access key: the link from settings carries it
// once, then a cookie for this host only (SameSite=Strict, so other sites open on the phone cannot call with it).

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export const WEB_PORT = 7317;

/** The overlay's calls only: no keys, no settings, nothing sent to the game client. */
export const WEB_CHANNELS = new Set([
  'overlay:data', 'ai:build', 'ai:last', 'mayhem:fit', 'mayhem:effects', 'mayhem:open', 'items:list', 'champions:list', 'game:teams',
  'build:engine', 'build:stackBase', 'build:styles', 'build:cardvalues', 'build:experimental',
  'game:progress',
]);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

const COOKIE = 'ugk';
const same = (a: string | undefined | null, b: string) => !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOf = (header: string | undefined) => header?.split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

/** This machine's address on the home network (192.168.x.x and the like), or null without one. */
export function lanAddress(): string | null {
  // Virtual adapters (Hyper-V, WSL, VirtualBox, VMware) have private addresses too, but a phone cannot reach them.
  const ips = Object.entries(networkInterfaces())
    .filter(([name]) => !/vEthernet|WSL|VirtualBox|VMware|Hyper-V/i.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  // Home routers hand out 192.168.x.x most often, then 10.x.x.x, then 172.16-31.x.x.
  for (const pattern of [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./]) {
    const ip = ips.find((a) => pattern.test(a));
    if (ip) return ip;
  }
  return null;
}

export type Handler = (event: null, ...args: unknown[]) => unknown;

export function webServer(root: string, handlers: Map<string, Handler>, key: string): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: string | Buffer, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end(body);
    };
    const url = new URL(req.url ?? '/', 'http://x');
    // The link from settings: keep the key as a cookie and drop it from the address bar.
    if (req.method === 'GET' && same(url.searchParams.get('k'), key)) {
      res.writeHead(302, { location: '/static/overlay.html', 'set-cookie': `${COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
      return res.end();
    }
    if (!same(cookieOf(req.headers.cookie), key)) return send(403, 'افتح الرابط من إعدادات البرنامج على الكمبيوتر.');
    const path = decodeURIComponent(url.pathname);

    if (path.startsWith('/ipc/')) {
      const channel = path.slice(5);
      const handler = handlers.get(channel);
      if (req.method !== 'POST' || !WEB_CHANNELS.has(channel) || !handler) return send(404, 'not found');
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, 'json only');
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 100_000) return send(413, 'too large');
      }
      let args: unknown;
      try {
        args = JSON.parse(text || '[]');
      } catch {
        return send(400, 'bad json');
      }
      if (!Array.isArray(args)) return send(400, 'bad args');
      return send(200, JSON.stringify((await handler(null, ...args)) ?? null), 'application/json');
    }

    if (req.method !== 'GET') return send(405, 'method not allowed');
    if (path === '/') {
      res.writeHead(302, { location: '/static/overlay.html' });
      return res.end();
    }
    // Pages, styles, fonts and the compiled renderer only.
    const file = normalize(join(root, path));
    if (![join(root, 'static') + sep, join(root, 'dist') + sep].some((dir) => file.startsWith(dir))) return send(404, 'not found');
    try {
      send(200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
    } catch {
      send(404, 'not found');
    }
  });
}
