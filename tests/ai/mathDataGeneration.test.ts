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

describe('a card whose numbers come from the game files carries the status and limits (T029)', () => {
  const lines = (f: string) => readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as { id: number; status: string; ops: unknown[]; not_modelled: string | null });
  const fromFile = lines('knowledge/augment-math-file.jsonl');
  const textReading = new Map([1, 2, 3].flatMap((n) => lines(`knowledge/augment-math-${n}.jsonl`)).map((c) => [c.id, c]));
  it('keeps the file status and note wherever its ops are used', async () => {
    const { CARD_NUMBERS } = await import('../../src/ai/cardMathData.js');
    const byId = new Map(CARD_NUMBERS.map((c) => [c.id, c]));
    let used = 0;
    for (const f of fromFile) {
      const c = byId.get(f.id);
      if (!c || JSON.stringify(c.ops) !== JSON.stringify(f.ops)) continue; // a fix or a preserved override took this card's ops
      used++;
      expect(c.status, String(f.id)).toBe(f.status);
      expect(c.not_modelled ?? null, String(f.id)).toBe(f.not_modelled ?? null);
    }
    expect(used).toBeGreaterThan(30);
  });
  it('drops the text "not stated" note on Tooth Fairy, whose tooth the file states', async () => {
    const { CARD_NUMBERS } = await import('../../src/ai/cardMathData.js');
    const tooth = CARD_NUMBERS.find((c) => c.id === 2083)!;
    expect(textReading.get(2083)!.not_modelled).toMatch(/not stated/);
    expect(tooth.not_modelled).not.toMatch(/not stated/);
    expect(tooth.not_modelled).toMatch(/magic pen/); // the file reading's own limit is shown instead
    expect(tooth.status).toBe('conditional');
  });
});
