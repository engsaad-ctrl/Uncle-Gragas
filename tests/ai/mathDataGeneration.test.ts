import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const generate = (...args: string[]) => spawnSync(process.execPath, ['knowledge/make-card-data.cjs', ...args], { encoding: 'utf8', cwd: process.cwd() });

describe('arithmetic data can be regenerated without losing prior definitions', () => {
  it('matches the committed inputs and preserved baseline overrides', () => {
    const r = generate('--check');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Math data matches generator inputs');
  });
  it('detects changed generated numbers without overwriting the checked file', () => {
    const folder = mkdtempSync(join(tmpdir(), 'unclegragas-math-'));
    const file = join(folder, 'cardMathData.ts');
    try {
      expect(generate('--out', file).status).toBe(0);
      const original = readFileSync(file, 'utf8');
      const changed = original.replace(/"value":-?\d+(?:\.\d+)?/, (value) => value === '"value":0' ? '"value":1' : '"value":0');
      expect(changed).not.toBe(original);
      writeFileSync(file, changed);
      const r = generate('--check', '--out', file);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Math data is stale');
      expect(readFileSync(file, 'utf8')).toBe(changed);
    } finally {
      if (existsSync(file)) unlinkSync(file);
      rmdirSync(folder);
    }
  });
  it('stops when a source definition changes underneath a preserved override', () => {
    const code = readFileSync('knowledge/make-card-data.cjs', 'utf8');
    let wrote = false;
    const fs = {
      existsSync: (p: string) => existsSync(p),
      readFileSync: (p: string, encoding: 'utf8') => {
        const raw = readFileSync(p, encoding);
        if (p !== 'knowledge/math-overrides.json') return raw;
        const data = JSON.parse(raw);
        data.expectedInputs.cards['1025'].name = 'different source input';
        return JSON.stringify(data);
      },
      writeFileSync: () => { wrote = true; },
    };
    expect(() => runInNewContext(code, { require: () => fs, process: { argv: [] }, console: { log: () => undefined } })).toThrow(/changed generator input; review preserved override: 1025/);
    expect(wrote).toBe(false);
  });
});
