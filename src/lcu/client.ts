import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { findCredentials, type LcuCredentials } from './credentials.js';
import type { LcuGet } from './watcher.js';

export type LcuMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type LcuCall = (method: LcuMethod, path: string, body?: unknown) => Promise<unknown>;

/** A request to the client's local API. 404 means "nothing there right now" (e.g. no champ select) → null. */
export function lcuCaller(creds: LcuCredentials, host = '127.0.0.1'): LcuCall {
  const auth = `Basic ${Buffer.from(`riot:${creds.password}`).toString('base64')}`;
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          host,
          port: creds.port,
          path,
          method,
          headers: {
            Authorization: auth,
            Accept: 'application/json',
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          },
          rejectUnauthorized: false, // the client serves a Riot self-signed certificate, on this machine only
          timeout: 5000,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (text += chunk));
          // A socket dropped mid-answer ends the stream with no 'end': without this the request never settles
          // and the watcher's polling stops for good. Rejecting after a resolve is a no-op.
          res.on('error', reject);
          res.on('close', () => reject(new Error(`LCU ${method} ${path}: closed`)));
          res.on('end', () => {
            if (res.statusCode === 404) return resolve(null);
            // The client explains refusals in the body ("max pages reached" …): keep it for the diagnostics log.
            if (!res.statusCode || res.statusCode >= 400) return reject(new Error(`LCU ${method} ${path}: HTTP ${res.statusCode} ${text.slice(0, 200)}`));
            try {
              resolve(text ? JSON.parse(text) : null);
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`LCU ${path}: timeout`)));
      req.on('error', reject);
      req.end(payload);
    });
}

export const lcuGetter = (creds: LcuCredentials, host?: string): LcuGet => {
  const call = lcuCaller(creds, host);
  return (path) => call('GET', path);
};

/** Command line of the running LeagueClientUx.exe (Windows only), via PowerShell/CIM. */
function processCommandLine(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script = "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -First 1).CommandLine";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim() || null),
    );
  });
}

const testLockfile = process.env.LOLH_LCU_LOCKFILE; // smoke tests only: point at a fake client's lockfile

export const findClient = () =>
  findCredentials({
    processCommandLine: testLockfile ? async () => null : processCommandLine,
    readFile: (p) => readFile(testLockfile ?? p, 'utf8'),
  });
