import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanLine, errorLog } from '../../src/main/errorLog.js';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'log-')), 'errors.log');

describe('errorLog', () => {
  it('takes account ids and the Windows user name out', () => {
    const line = cleanLine(`no history for ${'a'.repeat(78)} in C:\\Users\\Saad\\AppData`);
    expect(line).toBe('no history for [id] in C:\\Users\\[user]\\AppData');
  });
  it('writes one line per error, with where it happened', () => {
    const f = fresh();
    errorLog(f)('ipc', new Error('boom'));
    const text = readFileSync(f, 'utf8');
    expect(text).toMatch(/\[ipc\] boom/);
    expect(text.trim().split('\n')).toHaveLength(1);
  });
  it('stays small, keeping the newest lines', () => {
    const f = fresh();
    const log = errorLog(f);
    for (let i = 0; i < 800; i++) log('x', `${i} ${'e '.repeat(450)}`);
    expect(statSync(f).size).toBeLessThanOrEqual(512_000);
    expect(readFileSync(f, 'utf8')).toContain('[x] 799 ');
    expect(readFileSync(f, 'utf8')).not.toContain('[x] 0 ');
  });
  it('never throws when it cannot write', () => {
    expect(() => errorLog(join(tmpdir(), 'no-such-folder', 'x', 'errors.log'))('x', 'y')).not.toThrow();
  });
});
