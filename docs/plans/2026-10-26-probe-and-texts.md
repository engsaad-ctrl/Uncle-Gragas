# Probe Script + Arabic Texts Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build spec phase 0, the probe script that settles the open questions about OP.GG MCP and CommunityDragon, and the `texts` core of phase 1, which turns official Arabic item and rune data into clean, safe HTML.

**Architecture:** This is a plain Node/TypeScript project with no Electron yet; the Electron shell comes in the next plan, once the probe results are known. `scripts/probe.mjs` is a standalone ESM script. `src/texts/` holds pure functions (`clean.ts`, `items.ts`, `runes.ts`) plus one I/O module (`cdragon.ts`) that fetches and caches CommunityDragon JSON. Tests run on real Arabic samples the project owner pasted from CommunityDragon `ar_ae`.

**Tech Stack:** Node 22+, TypeScript 6.0.3, Vitest 5.0.3, @modelcontextprotocol/sdk 1.32.1, @types/node 22.20.5.

**Spec:** `docs/specs/2026-10-26-lol-helper-design.md`

## Global Constraints

- Install with **npm 11** (`npx -y npm@11 install …`). npm 10.9.4 crashes on Vitest's peer set with `Cannot read properties of null (reading 'edgesOut')`.
- Exact dependency versions are pinned; no `^` or `~` ranges.
- `package.json` uses `"type": "module"`. TS imports between source files use the `.js` extension (`./clean.js`).
- Arabic source: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/{ar_ae|en_us}/v1/<file>`.
- Item text field is `description`. Rune text field is `longDesc`, falling back to `shortDesc`. Never use `tooltip`.
- A text is untranslated when it is empty, starts with `GeneratedTip_`, or matches `Item_<digits>_Name`. Its fallback is the `en_us` text with the same id; if that is also untranslated, use the empty string (the UI hides entries with an empty name).
- A dynamic value (a standalone `0`, `@…@`, `{{ … }}`) is rendered as `<span class="t-var" title="قيمة تحسبها اللعبة أثناء المباراة">؟</span>`.
- Excluded runes: id `7000` (Template) and any perk whose `iconPath` ends with `/RunesIcon.png` (crew bonuses).
- Cache TTL for CommunityDragon files is 24 hours. A failed fetch falls back to the stale cache, and throws only when no cache exists.
- `cleanText` output is inserted as HTML, so every text segment must be HTML-escaped and only whitelisted tags may be emitted.
- `probe-output/` is never committed (it is git-ignored).

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `.gitignore`, `vitest.config.ts` | Project setup |
| `scripts/probe-lib.mjs` | Pure helpers for the probe: `fillArgs`, `summarizeJson` |
| `scripts/probe.mjs` | Runs the probe against CommunityDragon and OP.GG MCP, writes `probe-output/` |
| `src/texts/clean.ts` | `cleanText`, `isUntranslated`, `pickText`, `VAR_HTML` |
| `src/texts/items.ts` | `buildItemTexts` |
| `src/texts/runes.ts` | `buildRuneTexts` |
| `src/texts/cdragon.ts` | `loadCdragonJson` (fetch and 24h file cache) |
| `tests/probe-lib.test.ts`, `tests/texts/*.test.ts` | Tests |
| `tests/fixtures/cdragon/*.sample.json` | Real `ar_ae` samples |

---

### Task 1: Project scaffold + probe script

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `scripts/probe-lib.mjs`, `scripts/probe.mjs`
- Test: `tests/probe-lib.test.ts`

**Interfaces:**
- Produces: `fillArgs(schema, hints?) → Record<string, unknown> | null` and `summarizeJson(data) → string` from `scripts/probe-lib.mjs`. The CLI command is `npm run probe`, which writes `probe-output/summary.txt`.

- [ ] **Step 1: Create the project files**

`package.json`:
```json
{
  "name": "lol-helper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc",
    "probe": "node scripts/probe.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.32.1"
  },
  "devDependencies": {
    "@types/node": "22.20.5",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "scripts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

`.gitignore`:
```
node_modules/
probe-output/
```

Run: `npx -y npm@11 install`
Expected: `found 0 vulnerabilities` and a `package-lock.json` is created.

- [ ] **Step 2: Write the failing test**

`tests/probe-lib.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fillArgs, summarizeJson } from '../scripts/probe-lib.mjs';

describe('fillArgs', () => {
  it('fills required fields from hints, matching enums case-insensitively', () => {
    const schema = {
      type: 'object',
      properties: {
        champion: { type: 'string', enum: ['AATROX', 'AHRI'] },
        position: { type: 'string', enum: ['top', 'mid'] },
        lang: { type: 'string' },
        optional: { type: 'string' },
      },
      required: ['champion', 'position', 'lang'],
    };
    expect(fillArgs(schema)).toEqual({ champion: 'AHRI', position: 'mid', lang: 'ar_AE' });
  });

  it('uses the first enum value when no hint matches', () => {
    const schema = { properties: { region: { enum: ['na', 'euw'] } }, required: ['region'] };
    expect(fillArgs(schema, {})).toEqual({ region: 'na' });
  });

  it('uses defaults for numbers and booleans', () => {
    const schema = {
      properties: { limit: { type: 'integer', default: 5 }, flag: { type: 'boolean' } },
      required: ['limit', 'flag'],
    };
    expect(fillArgs(schema, {})).toEqual({ limit: 5, flag: false });
  });

  it('returns null when a required string cannot be filled', () => {
    const schema = { properties: { puuid: { type: 'string' } }, required: ['puuid'] };
    expect(fillArgs(schema, {})).toBeNull();
  });

  it('returns {} for a schema with no required fields', () => {
    expect(fillArgs({ type: 'object' })).toEqual({});
  });
});

describe('summarizeJson', () => {
  it('summarizes an array: length, first keys, first Arabic sample', () => {
    const s = summarizeJson([{ id: 1, name: 'السيف الأبدي', price: 3 }]);
    expect(s).toBe('array(1) keys=[id,name,price] ar="السيف الأبدي"');
  });

  it('summarizes an object by its keys', () => {
    expect(summarizeJson({ a: 1, b: 'x' })).toBe('object keys=[a,b] ar=none');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/probe-lib.test.ts`
Expected: FAIL, because `scripts/probe-lib.mjs` cannot be resolved.

- [ ] **Step 4: Implement `scripts/probe-lib.mjs`**

```js
// Guesses for required MCP tool arguments; enums are matched case-insensitively.
export const HINTS = {
  champion: 'Ahri',
  champion_name: 'Ahri',
  position: 'mid',
  lane: 'mid',
  game_mode: 'ranked',
  mode: 'ranked',
  region: 'kr',
  lang: 'ar_AE',
  language: 'ar_AE',
  desc_lang: 'ar_AE',
  game_name: 'Hide on bush',
  tag_line: 'KR1',
};

export function fillArgs(schema, hints = HINTS) {
  const props = schema?.properties ?? {};
  const args = {};
  for (const key of schema?.required ?? []) {
    const p = props[key] ?? {};
    if (Array.isArray(p.enum) && p.enum.length) {
      const hint = String(hints[key] ?? '').toLowerCase();
      args[key] = p.enum.find((v) => String(v).toLowerCase() === hint) ?? p.enum[0];
    } else if (key in hints) args[key] = hints[key];
    else if (p.default !== undefined) args[key] = p.default;
    else if (p.type === 'integer' || p.type === 'number') args[key] = 1;
    else if (p.type === 'boolean') args[key] = false;
    else return null;
  }
  return args;
}

const ARABIC = /[\u0600-\u06FF]/;

function firstArabic(value) {
  if (typeof value === 'string') return ARABIC.test(value) ? value : null;
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const hit = firstArabic(v);
      if (hit) return hit;
    }
  }
  return null;
}

export function summarizeJson(data) {
  const first = Array.isArray(data) ? data[0] : data;
  const keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 25).join(',') : '';
  const ar = firstArabic(first);
  const head = Array.isArray(data) ? `array(${data.length})` : 'object';
  return `${head} keys=[${keys}] ar=${ar ? JSON.stringify(ar.slice(0, 120)) : 'none'}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/probe-lib.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Write `scripts/probe.mjs`**

```js
// Phase-0 probe: what do CommunityDragon and OP.GG MCP actually return?
// Usage: npm run probe  → writes probe-output/ (summary.txt is the part to share)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fillArgs, summarizeJson } from './probe-lib.mjs';

const OUT = 'probe-output';
const CD = 'https://raw.communitydragon.org';
const V1 = (loc) => `${CD}/latest/plugins/rcp-be-lol-game-data/global/${loc}/v1`;
const FILES = ['items.json', 'perks.json', 'perkstyles.json', 'cherry-augments.json'];
const LISTINGS = ['latest/plugins/rcp-be-lol-game-data/global/ar_ae/v1/', 'latest/game/data/maps/shipping/'];

const report = [];
const log = (line) => {
  report.push(line);
  console.log(line);
};

async function save(rel, data) {
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function probeCdragon() {
  log('== CommunityDragon');
  for (const loc of ['ar_ae', 'en_us']) {
    for (const file of FILES) {
      try {
        const data = await getJson(`${V1(loc)}/${file}`);
        await save(`cdragon/${loc}/${file}`, data);
        log(`OK ${loc}/${file} ${summarizeJson(data)}`);
      } catch (e) {
        log(`FAIL ${loc}/${file} ${e.message}`);
      }
    }
  }
  for (const dir of LISTINGS) {
    try {
      const names = (await getJson(`${CD}/json/${dir}`)).map((entry) => entry.name);
      await save(`cdragon/listing-${dir.replaceAll('/', '_')}.json`, names);
      const hits = names.filter((n) => /kiwi|augment|cherry|mayhem/i.test(n));
      log(`LIST ${dir} ${names.length} entries; matches: ${hits.join(', ') || 'none'}`);
    } catch (e) {
      log(`FAIL list ${dir} ${e.message}`);
    }
  }
}

async function probeOpgg() {
  log('== OP.GG MCP');
  const client = new Client({ name: 'lol-helper-probe', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp-api.op.gg/mcp')));
  } catch (e) {
    log(`FAIL connect ${e.message}`);
    return;
  }
  const { tools } = await client.listTools();
  await save('opgg/tools.json', tools);
  log(`OK tools(${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
  for (const tool of tools.filter((t) => t.name.startsWith('lol_'))) {
    const args = fillArgs(tool.inputSchema);
    if (!args) {
      log(`SKIP ${tool.name} (cannot fill required args)`);
      continue;
    }
    try {
      const res = await client.callTool({ name: tool.name, arguments: args });
      const text = JSON.stringify(res);
      await save(`opgg/${tool.name}.json`, { args, res });
      log(`${res.isError ? 'ERR' : 'OK'} ${tool.name} ${JSON.stringify(args)} ${text.length}B ${text.slice(0, 150)}`);
    } catch (e) {
      log(`FAIL ${tool.name} ${JSON.stringify(args)} ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1000)); // stay polite to the free API
  }
  await client.close();
}

await probeCdragon();
await probeOpgg();
await save('summary.txt', report.join('\n'));
console.log(`\nDone. Share ${join(OUT, 'summary.txt')}`);
```

- [ ] **Step 7: Run the probe**

Run: `npm run probe`
Expected: `probe-output/summary.txt` exists. Every line starts with `OK`, `ERR`, `FAIL`, `SKIP` or `LIST`. If the sandbox blocks the network (`FAIL … fetch failed`), that is an environment limit, not a bug. Record it, and ask the project owner to run the probe on their PC or to allow-list `raw.communitydragon.org` and `mcp-api.op.gg`.

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc`
Expected: no errors.

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore scripts tests/probe-lib.test.ts
git commit -m "Add project scaffold and phase-0 probe script"
```

---

### Task 2: `cleanText` and the untranslated-text helpers

**Files:**
- Create: `src/texts/clean.ts`
- Test: `tests/texts/clean.test.ts`

**Interfaces:**
- Produces:
  - `VAR_HTML: string`
  - `cleanText(raw: string): string`, which returns safe HTML
  - `isUntranslated(s: string | undefined): boolean`
  - `pickText(ar: string, en: string | undefined): { text: string; translated: boolean }`

- [ ] **Step 1: Write the failing test**

`tests/texts/clean.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { VAR_HTML, cleanText, isUntranslated, pickText } from '../../src/texts/clean.js';

describe('cleanText', () => {
  it('maps whitelisted tags to spans and drops wrappers', () => {
    expect(cleanText('<mainText><stats><attention> 75</attention> ضرر هجوم</stats><br><br></mainText>')).toBe(
      '<span class="t-stats"><span class="t-key"> 75</span> ضرر هجوم</span>',
    );
  });

  it('turns a standalone 0 into the dynamic-value marker', () => {
    expect(cleanText('<magicDamage>0 ضرر سحر</magicDamage> خلال 5ث')).toBe(
      `<span class="t-ap">${VAR_HTML} ضرر سحر</span> خلال 5ث`,
    );
    expect(cleanText('لمدة 0ث')).toBe(`لمدة ${VAR_HTML}ث`);
  });

  it('leaves real numbers containing 0 alone', () => {
    expect(cleanText('10 و 0.25ث و 20% و 1.0ث')).toBe('10 و 0.25ث و 20% و 1.0ث');
  });

  it('turns @…@ and {{ … }} placeholders into the marker', () => {
    expect(cleanText('هي @f3@ث')).toBe(`هي ${VAR_HTML}ث`);
    expect(cleanText('تكسب {{ Item_Melee_Ranged_Split }}% سرعة')).toBe(`تكسب ${VAR_HTML}% سرعة`);
  });

  it('removes inline icon tokens', () => {
    expect(cleanText('%i:scaleAS%سرعة هجوم')).toBe('سرعة هجوم');
  });

  it('renders melee/ranged splits and plain brackets', () => {
    expect(cleanText('[85 قتال قريب || 50 قتال بعيد]')).toBe('85 قتال قريب / 50 قتال بعيد');
    expect(cleanText('+[30 - 45]ث')).toBe('+30 - 45ث');
  });

  it('keeps the text of unknown tags', () => {
    expect(
      cleanText("<lol-uikit-tooltipped-keyword key='x'><font color='#48C4B7'>متكيفة</font></lol-uikit-tooltipped-keyword>"),
    ).toBe('متكيفة');
  });

  it('escapes HTML and never emits non-whitelisted tags', () => {
    expect(cleanText('a & b "c"')).toBe('a &amp; b &quot;c&quot;');
    expect(cleanText('<script>alert(1)</script><img src=x onerror=alert(1)>')).toBe('alert(1)');
  });

  it('renders list items as bullets', () => {
    expect(cleanText('<li>أ<li>ب')).toBe('• أ<br>• ب');
  });

  it('collapses runs of line breaks and trims them at the edges', () => {
    expect(cleanText('<br>أ<br><br><br> <br>ب<br>')).toBe('أ<br><br>ب');
  });

  it('drops empty spans so they do not block edge trimming', () => {
    expect(cleanText('<stats></stats><br><br> <passive>7%</passive> علاج')).toBe('<b>7%</b> علاج');
  });

  it('closes unbalanced tags in order', () => {
    expect(cleanText('<b>أ<i>ب</b>')).toBe('<b>أ<i>ب</i></b>');
  });
});

describe('isUntranslated / pickText', () => {
  it('detects placeholder keys and empty strings', () => {
    expect(isUntranslated('GeneratedTip_Item_1500_ExternalDescription')).toBe(true);
    expect(isUntranslated('Item_226660_Name')).toBe(true);
    expect(isUntranslated('  ')).toBe(true);
    expect(isUntranslated(undefined)).toBe(true);
    expect(isUntranslated('السيف الأبدي')).toBe(false);
  });

  it('prefers Arabic, falls back to English, then to empty', () => {
    expect(pickText('السيف', 'Sword')).toEqual({ text: 'السيف', translated: true });
    expect(pickText('Item_1_Name', 'Sword')).toEqual({ text: 'Sword', translated: false });
    expect(pickText('Item_1_Name', 'GeneratedTip_X')).toEqual({ text: '', translated: false });
    expect(pickText('', undefined)).toEqual({ text: '', translated: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/texts/clean.test.ts`
Expected: FAIL, because `src/texts/clean.js` cannot be resolved.

- [ ] **Step 3: Implement `src/texts/clean.ts`**

```ts
// Converts Riot's tooltip markup into a small, safe HTML subset for display.

const SPAN: Record<string, string> = {
  stats: 't-stats',
  attention: 't-key', keyword: 't-key', keywordmajor: 't-key', keywordstealth: 't-key',
  scalelevel: 't-key', spellname: 't-key', buffedstat: 't-key',
  scalead: 't-ad', physicaldamage: 't-ad', scalelethality: 't-ad', armorpen: 't-ad',
  scaleap: 't-ap', magicdamage: 't-ap',
  truedamage: 't-true',
  healing: 't-heal', scalehealth: 't-heal', health: 't-heal', shield: 't-heal', lifesteal: 't-heal', omnivamp: 't-heal',
  speed: 't-speed', ms: 't-speed',
  gold: 't-gold',
  scalearmor: 't-armor', scalemr: 't-mr', scalemana: 't-mana',
  status: 't-status', danger: 't-status',
  raritylegendary: 't-rarity', raritymythic: 't-rarity', raritygeneric: 't-rarity', prismatic: 't-rarity',
};

const WRAP: Record<string, 'b' | 'i'> = {
  passive: 'b', active: 'b', unique: 'b', b: 'b', spellpassive: 'b', onhit: 'b',
  i: 'i', flavortext: 'i', rules: 'i', jaderules: 'i',
};

export const VAR_HTML = '<span class="t-var" title="قيمة تحسبها اللعبة أثناء المباراة">؟</span>';
const VAR_SENTINEL = '\u0001';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function cleanSegment(text: string): string {
  return escapeHtml(text)
    .replace(/(?<![\d.,])0(?![\d.,])/g, VAR_SENTINEL) // the client leaves live-computed values as 0
    .replaceAll(VAR_SENTINEL, VAR_HTML);
}

const openTag = (name: string) => (SPAN[name] ? `<span class="${SPAN[name]}">` : `<${WRAP[name]}>`);
const closeTag = (name: string) => (SPAN[name] ? '</span>' : `</${WRAP[name]}>`);

function tidy(html: string): string {
  return html
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/<span class="[^"]*">\s*<\/span>|<b>\s*<\/b>|<i>\s*<\/i>/g, '')
    .replace(/(?:\s*<br>\s*){3,}/g, '<br><br>')
    .replace(/^(?:\s*(?:<br>|<hr>))+\s*|\s*(?:(?:<br>|<hr>)\s*)+$/g, '')
    .trim();
}

export function cleanText(raw: string): string {
  const pre = raw
    .replace(/@[\w.*]+@/g, VAR_SENTINEL)
    .replace(/\{\{[^}]*\}\}/g, VAR_SENTINEL)
    .replace(/%i:\w+%/g, '')
    .replace(/\[([^[\]|]*?)\s*\|\|\s*([^[\]]*?)\]/g, '$1 / $2')
    .replace(/\[([^[\]|]*)\]/g, '$1');

  const out: string[] = [];
  const stack: string[] = [];
  for (const part of pre.split(/(<[^>]*>)/)) {
    if (!/^<[^>]*>$/.test(part)) {
      out.push(cleanSegment(part));
      continue;
    }
    const m = /^<(\/?)\s*([a-zA-Z][\w-]*)/.exec(part);
    if (!m) continue;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'br') out.push('<br>');
    else if (name === 'hr') out.push('<hr>');
    else if (name === 'li') {
      if (!closing) out.push('<br>• ');
    } else if (SPAN[name] || WRAP[name]) {
      if (!closing) {
        stack.push(name);
        out.push(openTag(name));
      } else if (stack.at(-1) === name) {
        stack.pop();
        out.push(closeTag(name));
      }
    }
  }
  while (stack.length) out.push(closeTag(stack.pop()!));
  return tidy(out.join(''));
}

export function isUntranslated(s: string | undefined): boolean {
  const t = (s ?? '').trim();
  return t === '' || t.startsWith('GeneratedTip_') || /^Item_\d+_Name$/.test(t);
}

export function pickText(ar: string, en: string | undefined): { text: string; translated: boolean } {
  if (!isUntranslated(ar)) return { text: ar, translated: true };
  return { text: isUntranslated(en) ? '' : en!, translated: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/texts/clean.test.ts`
Expected: PASS (14 tests). If an exact-string assertion fails only on whitespace, fix `tidy`, not the test. The expected strings are what the UI must show.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc`
Expected: no errors.

```bash
git add src/texts/clean.ts tests/texts/clean.test.ts
git commit -m "Add cleanText: Riot tooltip markup to safe Arabic HTML"
```

---

### Task 3: Item and rune text builders on real Arabic samples

**Files:**
- Create: `tests/fixtures/cdragon/items.ar_ae.sample.json`, `tests/fixtures/cdragon/perks.ar_ae.sample.json`
- Create: `src/texts/items.ts`, `src/texts/runes.ts`
- Test: `tests/texts/items.test.ts`, `tests/texts/runes.test.ts`

**Interfaces:**
- Consumes: `cleanText`, `pickText` from `src/texts/clean.ts`
- Produces:
  - `interface RawItem { id: number; name: string; description: string; inStore: boolean; iconPath: string }`
  - `interface ItemText { id: number; name: string; html: string; translated: boolean; inStore: boolean; iconPath: string }`
  - `buildItemTexts(ar: RawItem[], en: RawItem[]): Map<number, ItemText>`
  - `interface RawPerk { id: number; name: string; shortDesc: string; longDesc: string; iconPath: string }`
  - `interface RuneText { id: number; name: string; html: string; translated: boolean; iconPath: string }`
  - `buildRuneTexts(ar: RawPerk[], en: RawPerk[]): Map<number, RuneText>`

- [ ] **Step 1: Create the fixtures from the owner's real pastes**

The full `ar_ae` files the owner pasted are saved in this session's scratchpad. Extract the entries the tests need:

```bash
S=/tmp/claude-0/-home-user-home-inspect/8ffa46ed-b5e0-5d76-b428-f338700d20de/scratchpad
mkdir -p tests/fixtures/cdragon
node -e '
const fs = require("fs");
const pick = (src, ids) => JSON.parse(fs.readFileSync(src, "utf8")).filter((x) => ids.includes(x.id));
fs.writeFileSync("tests/fixtures/cdragon/items.ar_ae.sample.json",
  JSON.stringify(pick(process.argv[1], [3031, 223031, 1500, 226660, 3157, 6653, 1035]), null, 1));
fs.writeFileSync("tests/fixtures/cdragon/perks.ar_ae.sample.json",
  JSON.stringify(pick(process.argv[2], [8112, 8446, 8008, 8141, 8004, 7000, 8437, 8360]), null, 1));
' "$S/items.ar_ae.json" "$S/perks.ar_ae.json"
node -e 'for (const f of ["items","perks"]) console.log(f, require("./tests/fixtures/cdragon/" + f + ".ar_ae.sample.json").length)'
```
Expected: `items 7` and `perks 8`.

- [ ] **Step 2: Write the failing tests**

`tests/texts/items.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import arItems from '../fixtures/cdragon/items.ar_ae.sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import { buildItemTexts, type RawItem } from '../../src/texts/items.js';

// en_us is not available in the sandbox; these two English entries are synthetic test input for the fallback path.
const en: RawItem[] = [
  { id: 1500, name: 'Penetrating Bullets', description: 'English fallback text', inStore: false, iconPath: '' },
  { id: 226660, name: 'GeneratedTip_Missing', description: '', inStore: false, iconPath: '' },
];

const texts = buildItemTexts(arItems as RawItem[], en);

describe('buildItemTexts', () => {
  it('keeps official Arabic names and cleans descriptions', () => {
    const sword = texts.get(3031)!;
    expect(sword.name).toBe('السيف الأبدي');
    expect(sword.translated).toBe(true);
    expect(sword.html).toBe(
      '<span class="t-stats"><span class="t-key"> 75</span> ضرر هجوم<br><span class="t-key"> 25%</span> فرصة ضربة حرجة<br><span class="t-key"> 30%</span> ضرر الضربة الحرجة</span>',
    );
  });

  it('keeps mode variants as separate entries', () => {
    expect(texts.get(223031)!.name).toBe(texts.get(3031)!.name);
  });

  it('falls back to English per field', () => {
    const t = texts.get(1500)!;
    expect(t.name).toBe('الرصاصات النافذة');
    expect(t.html).toBe('English fallback text');
    expect(t.translated).toBe(false);
  });

  it('empties a name with no usable fallback so the UI can hide it', () => {
    expect(texts.get(226660)!.name).toBe('');
  });

  it('marks live-computed zeros', () => {
    expect(texts.get(1035)!.html).toContain(`${VAR_HTML} ضرر سحر`);
  });

  it('never leaks raw markup or placeholder keys', () => {
    for (const t of texts.values()) {
      expect(t.html).not.toMatch(/<mainText|GeneratedTip_|@\w+@/i);
    }
  });
});
```

`tests/texts/runes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import arPerks from '../fixtures/cdragon/perks.ar_ae.sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import { buildRuneTexts, type RawPerk } from '../../src/texts/runes.js';

const runes = buildRuneTexts(arPerks as RawPerk[], []);

describe('buildRuneTexts', () => {
  it('drops the Template entry and crew bonuses', () => {
    expect(runes.has(7000)).toBe(false);
    expect(runes.has(8004)).toBe(false);
    expect(runes.size).toBe(6);
  });

  it('uses longDesc with the real numbers', () => {
    const e = runes.get(8112)!;
    expect(e.name).toBe('الصعقة الكهربائية');
    expect(e.html).toContain('70 - 240');
    expect(e.translated).toBe(true);
  });

  it('renders melee/ranged splits', () => {
    expect(runes.get(8446)!.html).toContain(' / ');
    expect(runes.get(8446)!.html).not.toContain('||');
  });

  it('marks leftover placeholders instead of showing them', () => {
    const html = runes.get(8360)!.html;
    expect(html).toContain(VAR_HTML);
    expect(html).not.toMatch(/@\w+@/);
  });

  it('renders list items', () => {
    expect(runes.get(8437)!.html).toContain('• ');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/texts/items.test.ts tests/texts/runes.test.ts`
Expected: FAIL, because `src/texts/items.js` and `src/texts/runes.js` cannot be resolved.

- [ ] **Step 4: Implement `src/texts/items.ts`**

```ts
import { cleanText, pickText } from './clean.js';

export interface RawItem {
  id: number;
  name: string;
  description: string;
  inStore: boolean;
  iconPath: string;
}

export interface ItemText {
  id: number;
  name: string;
  html: string;
  translated: boolean;
  inStore: boolean;
  iconPath: string;
}

export function buildItemTexts(ar: RawItem[], en: RawItem[]): Map<number, ItemText> {
  const enById = new Map(en.map((i) => [i.id, i]));
  const out = new Map<number, ItemText>();
  for (const a of ar) {
    const e = enById.get(a.id);
    const name = pickText(a.name, e?.name);
    const desc = pickText(a.description, e?.description);
    out.set(a.id, {
      id: a.id,
      name: name.text,
      html: cleanText(desc.text),
      translated: name.translated && desc.translated,
      inStore: a.inStore,
      iconPath: a.iconPath,
    });
  }
  return out;
}
```

- [ ] **Step 5: Implement `src/texts/runes.ts`**

```ts
import { cleanText, pickText } from './clean.js';

export interface RawPerk {
  id: number;
  name: string;
  shortDesc: string;
  longDesc: string;
  iconPath: string;
}

export interface RuneText {
  id: number;
  name: string;
  html: string;
  translated: boolean;
  iconPath: string;
}

// 7000 is a template; RunesIcon.png marks the legacy "crew bonus" perks no player can pick.
const isPlayable = (p: RawPerk) => p.id !== 7000 && !p.iconPath.endsWith('/RunesIcon.png');

export function buildRuneTexts(ar: RawPerk[], en: RawPerk[]): Map<number, RuneText> {
  const enById = new Map(en.map((p) => [p.id, p]));
  const out = new Map<number, RuneText>();
  for (const a of ar.filter(isPlayable)) {
    const e = enById.get(a.id);
    const name = pickText(a.name, e?.name);
    const desc = pickText(a.longDesc || a.shortDesc, e && (e.longDesc || e.shortDesc));
    out.set(a.id, {
      id: a.id,
      name: name.text,
      html: cleanText(desc.text),
      translated: name.translated && desc.translated,
      iconPath: a.iconPath,
    });
  }
  return out;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS for all test files.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc`
Expected: no errors.

```bash
git add src/texts/items.ts src/texts/runes.ts tests/texts/items.test.ts tests/texts/runes.test.ts tests/fixtures/cdragon
git commit -m "Add Arabic item and rune text builders with real ar_ae fixtures"
```

---

### Task 4: CommunityDragon loader with a 24-hour cache

**Files:**
- Create: `src/texts/cdragon.ts`
- Test: `tests/texts/cdragon.test.ts`

**Interfaces:**
- Produces:
  - `CDRAGON_BASE: string`
  - `type Locale = 'ar_ae' | 'en_us'`
  - `interface LoadOptions { cacheDir: string; ttlMs?: number; now?: () => number; fetchImpl?: typeof fetch }`
  - `interface Loaded<T> { data: T; fetchedAt: number; stale: boolean }`
  - `loadCdragonJson<T>(locale: Locale, file: string, opts: LoadOptions): Promise<Loaded<T>>`
  - The cache file is `<cacheDir>/cdragon/<locale>/<file>`, containing `{ fetchedAt, data }`.

- [ ] **Step 1: Write the failing test**

`tests/texts/cdragon.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CDRAGON_BASE, loadCdragonJson } from '../../src/texts/cdragon.js';

const DAY = 24 * 60 * 60 * 1000;
let cacheDir: string;
let calls: string[];

const okFetch = (body: unknown) =>
  (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

const failFetch = (async (url: string | URL | Request) => {
  calls.push(String(url));
  throw new Error('offline');
}) as typeof fetch;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'lolh-'));
  calls = [];
});

describe('loadCdragonJson', () => {
  it('fetches the right URL and caches the result', async () => {
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    expect(r).toEqual({ data: [1], fetchedAt: 1000, stale: false });
    expect(calls).toEqual([`${CDRAGON_BASE}/ar_ae/v1/items.json`]);
  });

  it('serves the cache inside the TTL without fetching', async () => {
    await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    calls = [];
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000 + DAY - 1, fetchImpl: okFetch([2]) });
    expect(r.data).toEqual([1]);
    expect(calls).toEqual([]);
  });

  it('refetches after the TTL', async () => {
    await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000 + DAY, fetchImpl: okFetch([2]) });
    expect(r).toEqual({ data: [2], fetchedAt: 1000 + DAY, stale: false });
  });

  it('returns the stale cache when the fetch fails', async () => {
    await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000, fetchImpl: okFetch([1]) });
    const r = await loadCdragonJson('ar_ae', 'items.json', { cacheDir, now: () => 1000 + DAY, fetchImpl: failFetch });
    expect(r).toEqual({ data: [1], fetchedAt: 1000, stale: true });
  });

  it('treats a non-200 response as a failure', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(loadCdragonJson('ar_ae', 'x.json', { cacheDir, fetchImpl: notFound })).rejects.toThrow('HTTP 404');
  });

  it('throws when the fetch fails and there is no cache', async () => {
    await expect(loadCdragonJson('en_us', 'perks.json', { cacheDir, fetchImpl: failFetch })).rejects.toThrow('offline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/texts/cdragon.test.ts`
Expected: FAIL, because `src/texts/cdragon.js` cannot be resolved.

- [ ] **Step 3: Implement `src/texts/cdragon.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const CDRAGON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global';

export type Locale = 'ar_ae' | 'en_us';

export interface LoadOptions {
  cacheDir: string;
  ttlMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface Loaded<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

export async function loadCdragonJson<T>(locale: Locale, file: string, opts: LoadOptions): Promise<Loaded<T>> {
  const { cacheDir, ttlMs = 24 * 60 * 60 * 1000, now = Date.now, fetchImpl = fetch } = opts;
  const path = join(cacheDir, 'cdragon', locale, file);
  const cached = await readFile(path, 'utf8')
    .then((s) => JSON.parse(s) as { fetchedAt: number; data: T })
    .catch(() => null);
  if (cached && now() - cached.fetchedAt < ttlMs) return { ...cached, stale: false };

  try {
    const res = await fetchImpl(`${CDRAGON_BASE}/${locale}/v1/${file}`);
    if (!res.ok) throw new Error(`CommunityDragon ${locale}/${file}: HTTP ${res.status}`);
    const fresh = { fetchedAt: now(), data: (await res.json()) as T };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(fresh));
    return { ...fresh, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS for all test files.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc`
Expected: no errors.

```bash
git add src/texts/cdragon.ts tests/texts/cdragon.test.ts
git commit -m "Add CommunityDragon loader with 24h cache and stale fallback"
```

---

## After this plan

The next plan (Electron shell, augment texts and the augment search window) is written **after** the probe's `summary.txt` is in. It needs three answers that only the probe can give:

1. **Arena augment fields:** which fields in `cherry-augments.json` hold the description.
2. **Mayhem augments:** whether they show up anywhere in the CommunityDragon listings.
3. **OP.GG:** which tools need auth, and whether augment tiers exist.

The LCU checks (other players' match history, the Mayhem queue id) are not part of this probe. They become a built-in "export diagnostics" button in phase 2, so the owner never has to run a script against the game client.
