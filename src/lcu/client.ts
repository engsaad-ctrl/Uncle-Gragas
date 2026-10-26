import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { findCredentials, type LcuCredentials } from './credentials.js';
import type { LcuGet } from './watcher.js';

/** GET against the client's local API. 404 means "nothing there right now" (e.g. no champ select) → null. */
export function lcuGetter(creds: LcuCredentials, host = '127.0.0.1'): LcuGet {
  const auth = `Basic ${Buffer.from(`riot:${creds.password}`).toString('base64')}`;
  return (path) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host,
          port: creds.port,
          path,
          method: 'GET',
          headers: { Authorization: auth, Accept: 'application/json' },
          rejectUnauthorized: false, // the client serves a Riot self-signed certificate, on this machine only
          timeout: 3000,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode === 404) return resolve(null);
            if (!res.statusCode || res.statusCode >= 400) return reject(new Error(`LCU ${path}: HTTP ${res.statusCode}`));
            try {
              resolve(body ? JSON.parse(body) : null);
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`LCU ${path}: timeout`)));
      req.on('error', reject);
      req.end();
    });
}

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
