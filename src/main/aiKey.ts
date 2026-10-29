// The Gemini key, typed once in settings and kept only on this machine, encrypted by Windows for this user (safeStorage).

import { safeStorage } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function aiKeyStore(dir: string) {
  const path = join(dir, 'gemini-key.bin');
  return {
    async get(): Promise<string | null> {
      const data = await readFile(path).catch(() => null);
      return data ? safeStorage.decryptString(data) : null;
    },
    async set(key: unknown): Promise<void> {
      // Any printable text without spaces: Google's key formats change (AIza…, and newer ones with dots); Gemini itself
      // says whether the key works on the first request.
      if (typeof key !== 'string' || !/^[\x21-\x7e]{20,300}$/.test(key.trim())) throw new Error('هذا لا يبدو مفتاح Gemini: الصقه كاملاً بلا مسافات.');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('التشفير غير متاح على هذا الجهاز، فلن يُحفظ المفتاح.');
      await writeFile(path, safeStorage.encryptString(key.trim()));
    },
    clear: () => rm(path, { force: true }),
  };
}
