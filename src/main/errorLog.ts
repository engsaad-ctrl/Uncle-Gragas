// A hidden log of what went wrong, on this machine only: never shown and never sent. It leaves the machine only inside the
// diagnostics file the player chooses to export. Account ids and the Windows user name are taken out of each line.

import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const MAX_BYTES = 512_000;

export const cleanLine = (text: string) =>
  text
    .replace(/[\w-]{60,}/g, '[id]')
    .replace(/([\\/]Users[\\/])[^\\/\s]+/gi, '$1[user]')
    .replace(/\s+/g, ' ')
    .slice(0, 1000);

export function errorLog(file: string) {
  /** Never throws: a log that can't be written must not take the app down with it. */
  const log = (where: string, err: unknown) => {
    try {
      const text = err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err);
      appendFileSync(file, `${new Date().toISOString()} [${where}] ${cleanLine(text)}\n`);
      if (statSync(file).size > MAX_BYTES) {
        const kept = readFileSync(file, 'utf8').slice(-MAX_BYTES / 2);
        writeFileSync(file, kept.slice(kept.indexOf('\n') + 1));
      }
    } catch {
      // nothing to do
    }
  };
  return log;
}
