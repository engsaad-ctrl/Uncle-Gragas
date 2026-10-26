# Phase 1 — Augment Search Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first usable Windows app: an Arabic RTL window where the owner searches any Arena or Mayhem augment by its Arabic or English name and reads its official Arabic description.

**Architecture:** On first run, the Electron main process downloads the augment name lists, the Arabic game string table and four game-data files from CommunityDragon. It links each augment to its description key and cleans the text with the existing `cleanText`. It caches the result as one small `augments.json` and rebuilds only when the game version in `content-metadata.json` changes. The renderer gets the list once over IPC and filters it locally as the user types. A GitHub Actions Windows runner builds a portable `.exe`.

**Tech Stack:** Electron 44.7.0, electron-builder 26.17.0, hash-wasm 4.12.0, plus everything from the first plan (TypeScript 6.0.3, Vitest 5.0.3).

**Spec:** `docs/specs/2026-10-26-lol-helper-design.md` (sections 5.3, 5.5, 9 — phase 1)

## Global Constraints

- Everything in `docs/plans/2026-10-26-probe-and-texts.md` → Global Constraints still applies (npm 11, pinned versions, `.js` import suffixes, `cleanText` as the only producer of HTML).
- Facts below were established by the probe on 2026-10-26 (game version 16.21):
  - Augment names: `…/global/ar_ae/v1/cherry-augments.json` (Arabic) and `…/global/default/v1/cherry-augments.json` (English). 594 entries with fields `id, augmentNameId, nameTRA, augmentSmallIconPath, rarity`. These files have no descriptions.
  - Descriptions: the `entries` object of `https://raw.communitydragon.org/latest/game/ar_ae/data/menu/en_us/lol.stringtable.json` (38MB).
  - Link from id to key: `AugmentData` objects (`__type === 'AugmentData'`) in `latest/game/maps/modespecificdata/{cherry,kiwi,kiwi_jade}.bin.json` and `latest/game/data/maps/shipping/map30/map30.bin.json`. Their `AugmentPlatformId` equals the list `id`. Use `DescriptionTra` first, then `AugmentTooltipTra`.
  - Key lookup: match the key case-insensitively. If it is not present, look up `{hex}`, where hex is `xxh3_64(lowercased key) & (2^38 − 1)` as 10 lowercase hex digits. This was verified: `Kiwi_Augment_ArcaneAxiom_Description` → `{2a67b4a441}`.
  - Coverage: 560 of 594 augments get a description. The other 34 are absent from every game-data file (most likely out of rotation). Show them with name only and the message "لا يوجد وصف رسمي لهذا التعزيز في ملفات اللعبة الحالية."
  - Game version: `https://raw.communitydragon.org/latest/content-metadata.json` → `{ "version": "16.21.…" }`.
- **No Arena/Mayhem mode filter in this phase.** The game files mix the two modes (Mayhem augments also sit in `cherry.bin`), so mode labels from file origin would be wrong.
- Rarity labels (official Arabic, from `lolmodes_augment_tier_*_name`): `kSilver` is فضي, `kGold` is ذهبي and `kPrismatic` is موشوري. `kEventChoice` is shown as خاص.
- Icon URL: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/` + `augmentSmallIconPath` without its `/lol-game-data/assets/` prefix, lowercased.
- Electron security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a CSP meta tag. The renderer never sees Node APIs, only `window.lolh.getAugments()`.
- In the main process, network calls use Electron `net.fetch`, so they follow Windows proxy settings.
- `LOLH_CACHE_DIR` env var overrides the cache folder (used by the smoke test only).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/texts/stringhash.ts` | `stringTableKey(key)` → `{hex}` key for hashed string-table entries |
| `src/texts/augments.ts` | `buildAugmentTexts(sources)` (pure), `iconUrl(path)` |
| `src/texts/augmentsLoader.ts` | `loadAugments({cacheDir, fetchImpl})`: version check, download, build, cache |
| `src/renderer/search.ts` | `normalizeArabic`, `filterAugments` (pure) |
| `src/renderer/app.ts` | DOM: rarity sections of chips, detail panel, search and rarity pills |
| `src/main/main.ts` | Electron main: window and IPC handler |
| `static/preload.cjs` | Exposes `window.lolh.getAugments` via `contextBridge` |
| `static/index.html`, `static/styles.css` | RTL page and styling |
| `scripts/make-augment-fixture.mjs` | Regenerates the real-data test fixture from `probe-output/` |
| `tests/fixtures/augments/sample.json` | 6 real augments with their bin links and strings |
| `tsconfig.build.json` | Emits `src/` to `dist/` for Electron |
| `.github/workflows/build-windows.yml` | Windows portable `.exe` artifact |

---

### Task 1: Augment text builder on real data

**Files:**
- Create: `scripts/make-augment-fixture.mjs`, `tests/fixtures/augments/sample.json`
- Create: `src/texts/stringhash.ts`, `src/texts/augments.ts`
- Test: `tests/texts/augments.test.ts`

**Interfaces:**
- Consumes: `cleanText`, `isUntranslated` from `src/texts/clean.ts`
- Produces:
  - `stringTableKey(key: string): Promise<string>`
  - `interface AugmentListEntry { id: number; augmentNameId: string; nameTRA: string; augmentSmallIconPath: string; rarity: string }`
  - `type Rarity = 'silver' | 'gold' | 'prismatic' | 'event'`
  - `interface AugmentText { id: number; name: string; enName: string; html: string; described: boolean; rarity: Rarity; iconUrl: string }`
  - `interface AugmentSources { listAr: AugmentListEntry[]; listEn: AugmentListEntry[]; bins: object[]; strings: Record<string, string> }`
  - `buildAugmentTexts(src: AugmentSources): Promise<AugmentText[]>`, sorted by Arabic name
  - `iconUrl(path: string): string`

- [ ] **Step 1: Install hash-wasm**

Run: `npx -y npm@11 install hash-wasm@4.12.0 --save-exact`
Expected: `found 0 vulnerabilities`, and `"hash-wasm": "4.12.0"` appears under `dependencies`.

- [ ] **Step 2: Create the fixture script and generate the fixture**

`scripts/make-augment-fixture.mjs`:
```js
// Rebuilds tests/fixtures/augments/sample.json from a probe run.
// Needs probe-output/ with cdragon/*/cherry-augments.json, gamestrings/lol.ar_ae.json and bins/*.bin.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { xxhash3 } from 'hash-wasm';

const P = 'probe-output/';
// Adamant (plain key), ArcaneAxiom (hashed key), LegDay (Cherry_ key in kiwi bin), SpeedDemon, Dropkick, Cerberus (no game data)
const IDS = [1327, 3118, 1305, 1405, 2006, 1397];
const read = (p) => JSON.parse(readFileSync(P + p, 'utf8'));

const listAr = read('cdragon/ar_ae/cherry-augments.json').filter((a) => IDS.includes(a.id));
const listEn = read('cdragon/default/cherry-augments.json').filter((a) => IDS.includes(a.id));
const entries = read('gamestrings/lol.ar_ae.json').entries;
const lower = new Map(Object.keys(entries).map((k) => [k.toLowerCase(), k]));

const bins = {};
const keys = new Set();
for (const f of ['cherry', 'kiwi', 'kiwi_jade', 'map30']) {
  bins[f] = {};
  for (const [k, v] of Object.entries(read(`bins/${f}.bin.json`))) {
    if (v?.__type === 'AugmentData' && IDS.includes(v.AugmentPlatformId)) {
      bins[f][k] = v;
      keys.add(v.DescriptionTra);
      keys.add(v.AugmentTooltipTra);
    }
  }
}

const strings = { kiwi_adamant_name: entries.kiwi_adamant_name };
for (const k of keys) {
  if (!k) continue;
  const real = lower.get(k.toLowerCase());
  if (real) {
    strings[real] = entries[real];
    continue;
  }
  const h = BigInt('0x' + (await xxhash3(k.toLowerCase()))) & ((1n << 38n) - 1n);
  const hashed = `{${h.toString(16).padStart(10, '0')}}`;
  if (entries[hashed] !== undefined) strings[hashed] = entries[hashed];
}

mkdirSync('tests/fixtures/augments', { recursive: true });
writeFileSync('tests/fixtures/augments/sample.json', JSON.stringify({ listAr, listEn, bins, strings }, null, 1));
console.log(`augments ${listAr.length}, strings ${Object.keys(strings).length}`);
```

The probe in the first plan does not download `gamestrings/` or `bins/`. Fetch them once:
```bash
mkdir -p probe-output/gamestrings probe-output/bins
R=https://raw.communitydragon.org/latest
curl -s -o probe-output/gamestrings/lol.ar_ae.json $R/game/ar_ae/data/menu/en_us/lol.stringtable.json
for f in cherry kiwi kiwi_jade; do curl -s -o probe-output/bins/$f.bin.json $R/game/maps/modespecificdata/$f.bin.json; done
curl -s -o probe-output/bins/map30.bin.json $R/game/data/maps/shipping/map30/map30.bin.json
node scripts/make-augment-fixture.mjs
```
Expected: `augments 6, strings 9`.

- [ ] **Step 3: Write the failing test**

`tests/texts/augments.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fx from '../fixtures/augments/sample.json' with { type: 'json' };
import { VAR_HTML } from '../../src/texts/clean.js';
import { buildAugmentTexts, iconUrl, type AugmentListEntry } from '../../src/texts/augments.js';
import { stringTableKey } from '../../src/texts/stringhash.js';

const texts = await buildAugmentTexts({
  listAr: fx.listAr as AugmentListEntry[],
  listEn: fx.listEn as AugmentListEntry[],
  bins: Object.values(fx.bins),
  strings: fx.strings as Record<string, string>,
});
const byId = new Map(texts.map((t) => [t.id, t]));

describe('stringTableKey', () => {
  it('matches the hash Riot uses for unnamed string-table keys', async () => {
    expect(await stringTableKey('Kiwi_Augment_ArcaneAxiom_Description')).toBe('{2a67b4a441}');
  });
});

describe('buildAugmentTexts', () => {
  it('keeps every augment, sorted by Arabic name', () => {
    expect(texts.map((t) => t.id).sort()).toEqual([1305, 1327, 1397, 1405, 2006, 3118]);
    const names = texts.map((t) => t.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ar')));
  });

  it('resolves a plain description key and cleans it', () => {
    const a = byId.get(1327)!;
    expect(a.name).toBe('شديد الإصرار');
    expect(a.enName).toBe('Adamant');
    expect(a.described).toBe(true);
    expect(a.html).toContain('<span class="t-armor">دروعًا</span>');
  });

  it('resolves a hashed description key', () => {
    const a = byId.get(3118)!;
    expect(a.name).toBe('مبدأ السحر');
    expect(a.html).toContain('تستعيد جزءًا');
    expect(a.html).toContain(VAR_HTML);
  });

  it('follows a key that points at another mode (Cherry_ key from a kiwi bin)', () => {
    expect(byId.get(1305)!.html).toContain('<span class="t-speed">');
  });

  it('shows augments with no game data by name only', () => {
    const a = byId.get(1397)!;
    expect(a.name).toBe('سيربيروس');
    expect(a.described).toBe(false);
    expect(a.html).toBe('');
    expect(a.rarity).toBe('prismatic');
  });

  it('builds CommunityDragon icon URLs', () => {
    expect(byId.get(1397)!.iconUrl).toBe(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/cherry/augments/icons/cerberus_small.png',
    );
    expect(iconUrl('/lol-game-data/assets/A/B.PNG')).toBe(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/a/b.png',
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/texts/augments.test.ts`
Expected: FAIL, because `src/texts/augments.js` cannot be resolved.

- [ ] **Step 5: Implement `src/texts/stringhash.ts`**

```ts
import { xxhash3 } from 'hash-wasm';

// Riot string tables key unnamed entries by xxh3-64 of the lowercased key, truncated to 38 bits.
export async function stringTableKey(key: string): Promise<string> {
  const h = BigInt('0x' + (await xxhash3(key.toLowerCase()))) & ((1n << 38n) - 1n);
  return `{${h.toString(16).padStart(10, '0')}}`;
}
```

- [ ] **Step 6: Implement `src/texts/augments.ts`**

```ts
import { cleanText, isUntranslated } from './clean.js';
import { stringTableKey } from './stringhash.js';

export interface AugmentListEntry {
  id: number;
  augmentNameId: string;
  nameTRA: string;
  augmentSmallIconPath: string;
  rarity: string;
}

export type Rarity = 'silver' | 'gold' | 'prismatic' | 'event';

export interface AugmentText {
  id: number;
  name: string;
  enName: string;
  html: string;
  described: boolean;
  rarity: Rarity;
  iconUrl: string;
}

export interface AugmentSources {
  listAr: AugmentListEntry[];
  listEn: AugmentListEntry[];
  bins: object[];
  strings: Record<string, string>;
}

interface AugmentData {
  __type?: string;
  AugmentPlatformId?: number;
  DescriptionTra?: string;
  AugmentTooltipTra?: string;
}

const RARITY: Record<string, Rarity> = { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic', kEventChoice: 'event' };
const ASSETS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';

export const iconUrl = (path: string) => ASSETS + path.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase();

export async function buildAugmentTexts(src: AugmentSources): Promise<AugmentText[]> {
  const data = new Map<number, AugmentData>();
  for (const bin of src.bins) {
    for (const v of Object.values(bin) as AugmentData[]) {
      if (v?.__type === 'AugmentData' && v.AugmentPlatformId && !data.has(v.AugmentPlatformId)) data.set(v.AugmentPlatformId, v);
    }
  }
  const byLower = new Map(Object.entries(src.strings).map(([k, v]) => [k.toLowerCase(), v]));
  const lookup = async (key?: string) =>
    key ? (byLower.get(key.toLowerCase()) ?? src.strings[await stringTableKey(key)]) : undefined;
  const enNames = new Map(src.listEn.map((a) => [a.id, a.nameTRA]));

  const out: AugmentText[] = [];
  for (const a of src.listAr) {
    const d = data.get(a.id);
    // shortcut: a description that only references another key ({{Other_Key}}) renders as ؟; resolve one level if users hit it.
    const raw = (await lookup(d?.DescriptionTra)) ?? (await lookup(d?.AugmentTooltipTra)) ?? '';
    const html = isUntranslated(raw) ? '' : cleanText(raw);
    const enName = enNames.get(a.id) ?? '';
    const name = isUntranslated(a.nameTRA) ? enName : a.nameTRA;
    if (!name) continue;
    out.push({
      id: a.id,
      name,
      enName,
      html,
      described: html !== '',
      rarity: RARITY[a.rarity] ?? 'event',
      iconUrl: iconUrl(a.augmentSmallIconPath),
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'ar'));
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run && npx tsc`
Expected: all tests PASS and tsc reports no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/make-augment-fixture.mjs tests/fixtures/augments src/texts/stringhash.ts src/texts/augments.ts tests/texts/augments.test.ts
git commit -m "Add augment text builder: link augments to official Arabic descriptions"
```

---

### Task 2: Augment loader with version-based cache

**Files:**
- Create: `src/texts/augmentsLoader.ts`
- Test: `tests/texts/augmentsLoader.test.ts`

**Interfaces:**
- Consumes: `buildAugmentTexts`, `AugmentText`, `AugmentListEntry` from `src/texts/augments.ts`; `CDRAGON_BASE` from `src/texts/cdragon.ts`
- Produces:
  - `AUGMENT_URLS: { version: string; listAr: string; listEn: string; strings: string; bins: string[] }`
  - `interface AugmentsResult { version: string; augments: AugmentText[]; stale: boolean }`
  - `loadAugments(opts: { cacheDir: string; fetchImpl?: typeof fetch }): Promise<AugmentsResult>`
  - The cache file is `<cacheDir>/augments.json`, containing `{ version, augments }`.

- [ ] **Step 1: Write the failing test**

`tests/texts/augmentsLoader.test.ts`:
```ts
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import fx from '../fixtures/augments/sample.json' with { type: 'json' };
import { AUGMENT_URLS, loadAugments } from '../../src/texts/augmentsLoader.js';

let cacheDir: string;
let calls: string[];

function fakeFetch(version: string) {
  const bodies = new Map<string, unknown>([
    [AUGMENT_URLS.version, { version }],
    [AUGMENT_URLS.listAr, fx.listAr],
    [AUGMENT_URLS.listEn, fx.listEn],
    [AUGMENT_URLS.strings, { entries: fx.strings }],
    [AUGMENT_URLS.bins[0], fx.bins.cherry],
    [AUGMENT_URLS.bins[1], fx.bins.kiwi],
    [AUGMENT_URLS.bins[2], fx.bins.kiwi_jade],
    [AUGMENT_URLS.bins[3], fx.bins.map30],
  ]);
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    const body = bodies.get(String(url));
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(JSON.stringify(body));
  }) as typeof fetch;
}

const offline = (async () => {
  throw new Error('offline');
}) as typeof fetch;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'lolh-aug-'));
  calls = [];
});

describe('loadAugments', () => {
  it('downloads every source, builds the list and caches it', async () => {
    const r = await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    expect(r.version).toBe('16.21.1');
    expect(r.stale).toBe(false);
    expect(r.augments).toHaveLength(6);
    expect(new Set(calls)).toEqual(new Set([AUGMENT_URLS.version, AUGMENT_URLS.listAr, AUGMENT_URLS.listEn, AUGMENT_URLS.strings, ...AUGMENT_URLS.bins]));
    await expect(access(join(cacheDir, 'augments.json'))).resolves.toBeUndefined();
  });

  it('only checks the version when the cache is current', async () => {
    await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    calls = [];
    const r = await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    expect(calls).toEqual([AUGMENT_URLS.version]);
    expect(r.augments).toHaveLength(6);
  });

  it('rebuilds when the game version changes', async () => {
    await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    calls = [];
    const r = await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.22.1') });
    expect(r.version).toBe('16.22.1');
    expect(calls).toContain(AUGMENT_URLS.strings);
  });

  it('falls back to the cache when offline', async () => {
    await loadAugments({ cacheDir, fetchImpl: fakeFetch('16.21.1') });
    const r = await loadAugments({ cacheDir, fetchImpl: offline });
    expect(r).toMatchObject({ version: '16.21.1', stale: true });
    expect(r.augments).toHaveLength(6);
  });

  it('throws when offline with no cache', async () => {
    await expect(loadAugments({ cacheDir, fetchImpl: offline })).rejects.toThrow('offline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/texts/augmentsLoader.test.ts`
Expected: FAIL, because `src/texts/augmentsLoader.js` cannot be resolved.

- [ ] **Step 3: Implement `src/texts/augmentsLoader.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAugmentTexts, type AugmentListEntry, type AugmentText } from './augments.js';
import { CDRAGON_BASE } from './cdragon.js';

const RAW = 'https://raw.communitydragon.org/latest';

export const AUGMENT_URLS = {
  version: `${RAW}/content-metadata.json`,
  listAr: `${CDRAGON_BASE}/ar_ae/v1/cherry-augments.json`,
  listEn: `${CDRAGON_BASE}/default/v1/cherry-augments.json`,
  strings: `${RAW}/game/ar_ae/data/menu/en_us/lol.stringtable.json`,
  bins: [
    ...['cherry', 'kiwi', 'kiwi_jade'].map((n) => `${RAW}/game/maps/modespecificdata/${n}.bin.json`),
    `${RAW}/game/data/maps/shipping/map30/map30.bin.json`,
  ],
};

export interface AugmentsResult {
  version: string;
  augments: AugmentText[];
  stale: boolean;
}

interface Cache {
  version: string;
  augments: AugmentText[];
}

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const augmentDataOnly = (bin: object) =>
  Object.values(bin).filter((v) => (v as { __type?: string } | null)?.__type === 'AugmentData');

export async function loadAugments(opts: { cacheDir: string; fetchImpl?: typeof fetch }): Promise<AugmentsResult> {
  const { cacheDir, fetchImpl = fetch } = opts;
  const path = join(cacheDir, 'augments.json');
  const cached = await readFile(path, 'utf8')
    .then((s) => JSON.parse(s) as Cache)
    .catch(() => null);

  try {
    const { version } = await getJson<{ version: string }>(fetchImpl, AUGMENT_URLS.version);
    if (cached?.version === version) return { ...cached, stale: false };

    const [listAr, listEn, strings] = await Promise.all([
      getJson<AugmentListEntry[]>(fetchImpl, AUGMENT_URLS.listAr),
      getJson<AugmentListEntry[]>(fetchImpl, AUGMENT_URLS.listEn),
      getJson<{ entries: Record<string, string> }>(fetchImpl, AUGMENT_URLS.strings).then((t) => t.entries),
    ]);
    const bins: object[] = [];
    // One at a time and trimmed right away: these files are 4–21MB each.
    for (const url of AUGMENT_URLS.bins) bins.push(augmentDataOnly(await getJson<object>(fetchImpl, url)));

    const fresh: Cache = { version, augments: await buildAugmentTexts({ listAr, listEn, bins, strings }) };
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(fresh));
    return { ...fresh, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npx tsc`
Expected: all tests PASS and tsc reports no errors.

- [ ] **Step 5: Real-data check (needs network access to raw.communitydragon.org)**

Run it through Vitest with a throwaway file outside `tests/`, so it is never committed:
```bash
mkdir -p probe-output && cat > probe-output/real.test.ts <<'EOF'
import { it, expect } from 'vitest';
import { loadAugments } from '../src/texts/augmentsLoader.js';
it('real', async () => {
  const r = await loadAugments({ cacheDir: 'probe-output/cache' });
  const described = r.augments.filter((a) => a.described).length;
  console.log(r.version, r.augments.length, described);
  expect(described).toBeGreaterThan(500);
}, 300_000);
EOF
printf "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['probe-output/*.test.ts'] } });\n" > probe-output/vitest.real.config.ts
NODE_USE_ENV_PROXY=1 npx vitest run --config probe-output/vitest.real.config.ts  # the project config only includes tests/
```
Expected: PASS, with more than 500 described augments. If the network is blocked, record it and continue.

- [ ] **Step 6: Commit**

```bash
git add src/texts/augmentsLoader.ts tests/texts/augmentsLoader.test.ts
git commit -m "Add augment loader: rebuild only when the game version changes"
```

---

### Task 3: Arabic-aware search

**Files:**
- Create: `src/renderer/search.ts`
- Test: `tests/renderer/search.test.ts`

**Interfaces:**
- Produces:
  - `normalizeArabic(s: string): string`
  - `filterAugments<T extends { name: string; enName: string; rarity: string }>(list: T[], query: string, rarity: string): T[]`, where `rarity === 'all'` means no rarity filter.

- [ ] **Step 1: Write the failing test**

`tests/renderer/search.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { filterAugments, normalizeArabic } from '../../src/renderer/search.js';

const list = [
  { name: 'شديد الإصرار', enName: 'Adamant', rarity: 'silver' },
  { name: 'مبدأ السحر', enName: 'Arcane Axiom', rarity: 'gold' },
  { name: 'كبير السحرة', enName: 'Archmage', rarity: 'prismatic' },
];

describe('normalizeArabic', () => {
  it('folds hamza forms, taa marbuta, alef maqsura, diacritics and tatweel', () => {
    expect(normalizeArabic('أُسطورةٌ')).toBe('اسطوره');
    expect(normalizeArabic('إلـــى  آخر')).toBe('الي اخر');
  });

  it('lowercases Latin text', () => {
    expect(normalizeArabic('Arcane AXIOM')).toBe('arcane axiom');
  });
});

describe('filterAugments', () => {
  it('matches Arabic without hamza', () => {
    expect(filterAugments(list, 'الاصرار', 'all').map((a) => a.enName)).toEqual(['Adamant']);
  });

  it('matches English names case-insensitively', () => {
    expect(filterAugments(list, 'arc', 'all').map((a) => a.enName)).toEqual(['Arcane Axiom', 'Archmage']);
  });

  it('filters by rarity', () => {
    expect(filterAugments(list, 'السحر', 'gold').map((a) => a.enName)).toEqual(['Arcane Axiom']);
  });

  it('returns everything for an empty query', () => {
    expect(filterAugments(list, '  ', 'all')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/search.test.ts`
Expected: FAIL, because `src/renderer/search.js` cannot be resolved.

- [ ] **Step 3: Implement `src/renderer/search.ts`**

```ts
export function normalizeArabic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // harakat, dagger alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterAugments<T extends { name: string; enName: string; rarity: string }>(
  list: T[],
  query: string,
  rarity: string,
): T[] {
  const q = normalizeArabic(query);
  return list.filter(
    (a) =>
      (rarity === 'all' || a.rarity === rarity) &&
      (!q || normalizeArabic(a.name).includes(q) || normalizeArabic(a.enName).includes(q)),
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npx tsc`
Expected: all tests PASS and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/search.ts tests/renderer/search.test.ts
git commit -m "Add Arabic-aware augment search"
```

---

### Task 4: Electron window

**Files:**
- Create: `src/main/main.ts`, `src/renderer/app.ts`, `static/preload.cjs`, `static/index.html`, `static/styles.css`, `tsconfig.build.json`
- Modify: `package.json` (add `main`, `description`, `author`, scripts, `build` config, Electron devDependencies), `tsconfig.json` (add DOM lib), `.gitignore`

**Interfaces:**
- Consumes: `loadAugments`, `AugmentsResult` from `src/texts/augmentsLoader.ts`; `filterAugments` from `src/renderer/search.ts`; `AugmentText` from `src/texts/augments.ts`
- Produces: IPC channel `augments:get` → `AugmentsResult | { error: string }`, and `window.lolh.getAugments()` in the renderer. Commands: `npm run build`, `npm start`.

- [ ] **Step 1: Install Electron tooling**

Run: `npx -y npm@11 install -D electron@44.7.0 electron-builder@26.17.0 --save-exact`
Expected: install finishes. `npx electron --version` prints `v44.7.0`; running as root may print a sandbox error instead, which is fine.

- [ ] **Step 2: Project config**

In `package.json`, add these top-level fields (keep the existing ones):
```json
  "description": "مساعد شخصي لـ League of Legends",
  "author": "engsaad",
  "main": "dist/main/main.js",
```
Set `scripts` to:
```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc",
    "build": "tsc -p tsconfig.build.json",
    "start": "npm run build && electron .",
    "dist:win": "npm run build && electron-builder --win portable --publish never",
    "probe": "node scripts/probe.mjs"
  },
```
Add the top-level `build` block:
```json
  "build": {
    "appId": "com.engsaad.lolhelper",
    "productName": "LOL_helper",
    "files": ["dist/**/*", "static/**/*", "package.json"],
    "directories": { "output": "release" },
    "win": { "target": "portable" }
  }
```

In `tsconfig.json` `compilerOptions`, add: `"lib": ["ES2023", "DOM", "DOM.Iterable"],`

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "allowJs": false },
  "include": ["src"]
}
```

Append to `.gitignore`:
```
dist/
release/
```

- [ ] **Step 3: Main process — `src/main/main.ts`**

```ts
import { app, BrowserWindow, ipcMain, net } from 'electron';
import { join } from 'node:path';
import { loadAugments, type AugmentsResult } from '../texts/augmentsLoader.js';

const root = app.getAppPath();
const cacheDir = process.env.LOLH_CACHE_DIR ?? app.getPath('userData');
let augments: Promise<AugmentsResult> | undefined;

ipcMain.handle('augments:get', async () => {
  augments ??= loadAugments({ cacheDir, fetchImpl: net.fetch as typeof fetch });
  try {
    return await augments;
  } catch (err) {
    augments = undefined; // let the next window load retry
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 760,
    title: 'LOL_helper',
    autoHideMenuBar: true,
    backgroundColor: '#0a1428',
    webPreferences: {
      preload: join(root, 'static/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(join(root, 'static/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 4: Preload — `static/preload.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lolh', { getAugments: () => ipcRenderer.invoke('augments:get') });
```

- [ ] **Step 5: Page — `static/index.html`**

Visual direction (owner's request): mirror the dark "build & augments" stat-site look the owner showed. That means deep navy panels, a pill filter bar with a search field, augments grouped by rarity under headings with an accent bar, and chips that show an icon and a name inside a rarity-coloured border. No third-party logos or brand names.

```html
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; img-src 'self' https://raw.communitydragon.org; style-src 'self'; script-src 'self'">
  <title>LOL_helper — التعزيزات</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="top">
    <div class="title">
      <h1>تعزيزات Arena و<span class="accent">Mayhem</span></h1>
      <span id="patch" class="pill static">باتش …</span>
    </div>
    <p class="sub">ابحث عن أي تعزيز بالاسم العربي أو الإنجليزي، واضغط عليه لترى وصفه الرسمي بالعربي.</p>
    <nav class="filters">
      <span class="filters-label">تصفية</span>
      <div id="rarity" class="pills" role="group" aria-label="الندرة">
        <button type="button" class="pill active" data-rarity="all">كل الندرات</button>
        <button type="button" class="pill" data-rarity="prismatic">موشوري</button>
        <button type="button" class="pill" data-rarity="gold">ذهبي</button>
        <button type="button" class="pill" data-rarity="silver">فضي</button>
      </div>
      <label class="search">
        <input id="q" type="search" placeholder="ابحث عن تعزيز" autocomplete="off">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
      </label>
    </nav>
  </header>
  <section id="detail" class="panel detail" hidden></section>
  <p id="status">جاري تحميل بيانات التعزيزات… أول مرة قد تستغرق دقيقة.</p>
  <main id="list"></main>
  <script type="module" src="../dist/renderer/app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Styles — `static/styles.css`**

```css
:root {
  --bg: #070720; --panel: #11112a; --panel-2: #191937; --line: #2c2c4a;
  --text: #ffffff; --muted: #9a9ac2; --accent: #3273fa;
  --prism: #a06bff; --gold: #b8913c; --silver: #6b7385; --event: #3fb8af;
  --ad: #ff8c34; --ap: #8ab4ff; --heal: #5cd65c; --speed: #f0e68c; --goldtxt: #e6c35c;
  --armor: #ffb36b; --mr: #8fd3ff; --mana: #6fa8ff; --status: #ff7a7a;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.7 "Segoe UI", Tahoma, sans-serif; }
.top { position: sticky; top: 0; z-index: 2; padding: 18px 20px 12px; background: linear-gradient(180deg, #0d0d33 0%, var(--bg) 100%); border-bottom: 1px solid var(--line); }
.title { display: flex; align-items: center; gap: 12px; }
h1 { margin: 0; font-size: 26px; font-weight: 700; }
h1 .accent { color: var(--muted); font-weight: 400; }
.sub { margin: 4px 0 12px; color: var(--muted); font-size: 13px; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.filters-label { color: var(--text); font-weight: 600; margin-inline-end: 4px; }
.pills { display: flex; gap: 6px; }
.pill { padding: 7px 14px; color: var(--text); font: inherit; font-weight: 600; background: var(--panel-2); border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
.pill:hover { border-color: var(--line); }
.pill.active { border-color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); }
.pill.static { cursor: default; font-size: 13px; background: #1f1f45; }
.search { display: flex; align-items: center; gap: 8px; min-width: 240px; padding: 0 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px; }
.search input { flex: 1; padding: 8px 0; color: var(--text); font: inherit; background: none; border: 0; outline: 0; }
.search svg { width: 16px; height: 16px; fill: none; stroke: var(--muted); stroke-width: 2; }
#status { margin: 10px 20px; color: var(--muted); font-size: 12px; }
#list { display: grid; gap: 14px; padding: 0 20px 24px; }
.panel { padding: 14px 16px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
.panel h2 { margin: 0 0 12px; padding-inline-start: 10px; font-size: 15px; border-inline-start: 3px solid var(--accent); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.chip { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px 10px; color: var(--text); font: inherit; font-weight: 600; text-align: start; background: var(--panel-2); border: 1px solid var(--silver); border-radius: 4px; cursor: pointer; }
.chip span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.chip img { width: 28px; height: 28px; flex: none; border-radius: 4px; }
.chip:hover, .chip.selected { background: #232350; }
.chip.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.r-prismatic { border-color: var(--prism); } .r-gold { border-color: var(--gold); } .r-event { border-color: var(--event); }
.detail { display: flex; gap: 14px; margin: 12px 20px 0; }
.detail[hidden] { display: none; }
.detail img { width: 64px; height: 64px; flex: none; border: 2px solid var(--silver); border-radius: 6px; }
.detail.r-prismatic img { border-color: var(--prism); } .detail.r-gold img { border-color: var(--gold); }
.detail h3 { margin: 0; font-size: 18px; }
.detail .en { color: var(--muted); font-size: 12px; }
.detail p { margin: 6px 0 0; font-size: 15px; }
.tag { margin-inline-start: 8px; padding: 1px 8px; font-size: 11px; font-weight: 600; color: var(--bg); background: var(--silver); border-radius: 10px; vertical-align: middle; }
.r-prismatic .tag { background: var(--prism); } .r-gold .tag { background: var(--gold); } .r-event .tag { background: var(--event); }
.missing { color: var(--muted); font-style: italic; }
.t-stats, .t-key { color: var(--goldtxt); }
.t-ad { color: var(--ad); } .t-ap { color: var(--ap); } .t-true { color: #fff; font-weight: 700; }
.t-heal { color: var(--heal); } .t-speed { color: var(--speed); } .t-gold { color: var(--goldtxt); }
.t-armor { color: var(--armor); } .t-mr { color: var(--mr); } .t-mana { color: var(--mana); }
.t-status { color: var(--status); } .t-rarity { color: var(--prism); }
.t-var { padding: 0 5px; color: var(--bg); background: var(--goldtxt); border-radius: 3px; cursor: help; }
```

- [ ] **Step 7: Renderer — `src/renderer/app.ts`**

```ts
import type { AugmentText, Rarity } from '../texts/augments.js';
import type { AugmentsResult } from '../texts/augmentsLoader.js';
import { filterAugments } from './search.js';

type Reply = AugmentsResult | { error: string };

declare global {
  interface Window {
    lolh: { getAugments(): Promise<Reply> };
  }
}

const RARITY_LABEL: Record<Rarity, string> = { prismatic: 'موشوري', gold: 'ذهبي', silver: 'فضي', event: 'خاص' };
const SECTIONS: { rarity: Rarity; title: string }[] = [
  { rarity: 'prismatic', title: 'التعزيزات الموشورية' },
  { rarity: 'gold', title: 'التعزيزات الذهبية' },
  { rarity: 'silver', title: 'التعزيزات الفضية' },
  { rarity: 'event', title: 'تعزيزات خاصة' },
];
const MISSING = 'لا يوجد وصف رسمي لهذا التعزيز في ملفات اللعبة الحالية.';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function icon(src: string): HTMLImageElement {
  const img = el('img');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  return img;
}

function showDetail(panel: HTMLElement, a: AugmentText | undefined) {
  panel.hidden = !a;
  if (!a) return;
  panel.className = `panel detail r-${a.rarity}`;
  const title = el('h3', '', a.name);
  title.append(el('span', 'tag', RARITY_LABEL[a.rarity]));
  const desc = el('p');
  if (a.described) desc.innerHTML = a.html; // safe: cleanText escapes text and emits only whitelisted tags
  else {
    desc.className = 'missing';
    desc.textContent = MISSING;
  }
  const body = el('div');
  body.append(title, el('div', 'en', a.enName), desc);
  panel.replaceChildren(icon(a.iconUrl), body);
}

async function main() {
  const status = byId('status');
  const list = byId('list');
  const detail = byId('detail');
  const query = byId<HTMLInputElement>('q');
  const pills = byId('rarity');
  let rarity = 'all';
  let selected: AugmentText | undefined;

  const reply = await window.lolh.getAugments();
  if ('error' in reply) {
    status.textContent = `تعذّر تحميل البيانات: ${reply.error}`;
    return;
  }
  byId('patch').textContent = `باتش ${reply.version.split('.').slice(0, 2).join('.')}`;

  const render = () => {
    const shown = filterAugments(reply.augments, query.value, rarity);
    if (!selected || !shown.includes(selected)) selected = query.value.trim() ? shown[0] : undefined;
    const sections = SECTIONS.flatMap(({ rarity: r, title }) => {
      const items = shown.filter((a) => a.rarity === r);
      if (!items.length) return [];
      const grid = el('div', 'grid');
      for (const a of items) {
        const chip = el('button', `chip r-${a.rarity}${a === selected ? ' selected' : ''}`);
        chip.type = 'button';
        chip.title = a.enName;
        chip.append(icon(a.iconUrl), el('span', '', a.name));
        chip.addEventListener('click', () => {
          selected = a;
          render();
        });
        grid.append(chip);
      }
      const section = el('section', 'panel');
      section.append(el('h2', '', `${title} (${items.length})`), grid);
      return [section];
    });
    list.replaceChildren(...sections);
    showDetail(detail, selected);
    status.textContent =
      `${shown.length} من ${reply.augments.length} تعزيزاً` + (reply.stale ? ' · بيانات محفوظة (تعذّر التحديث)' : '');
  };

  query.addEventListener('input', render);
  pills.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rarity]');
    if (!btn) return;
    rarity = btn.dataset.rarity!;
    for (const b of pills.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    render();
  });
  render();
  query.focus();
}

void main();
```

- [ ] **Step 8: Build and typecheck**

Run: `npm run build && npx tsc && npm test`
Expected: `dist/main/main.js`, `dist/renderer/app.js` and `dist/renderer/search.js` exist, tsc reports no errors, and all tests PASS.

- [ ] **Step 9: Smoke test with a screenshot (local tool, not committed)**

Save as `$SCRATCH/smoke.cjs`, where `$SCRATCH` is this session's scratchpad. `playwright` is preinstalled there and resolvable with `require`.
```js
const { _electron } = require('playwright');
const [, , repo, out, cache] = process.argv;
(async () => {
  const app = await _electron.launch({
    executablePath: require(repo + '/node_modules/electron'),
    args: ['--no-sandbox', '--ignore-certificate-errors', repo], // sandbox/TLS flags: root container + MITM proxy only
    env: { ...process.env, LOLH_CACHE_DIR: cache },
  });
  const win = await app.firstWindow();
  await win.waitForFunction(() => document.querySelectorAll('.chip').length > 0 || /تعذّر/.test(document.getElementById('status').textContent), null, { timeout: 300000 });
  console.log('status:', await win.textContent('#status'));
  await win.screenshot({ path: out + '/augments-all.png' });
  await win.fill('#q', 'الاصرار');
  await win.waitForTimeout(300);
  console.log('after search:', await win.textContent('#status'));
  await win.screenshot({ path: out + '/augments-search.png' });
  await win.fill('#q', '');
  await win.click('#rarity [data-rarity="prismatic"]');
  await win.click('.chip >> nth=0');
  await win.screenshot({ path: out + '/augments-prismatic.png' });
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
```
To skip the 88MB download, pre-fill the cache from Task 2 Step 5 (`probe-output/cache/augments.json`) and run:
```bash
xvfb-run -a node $SCRATCH/smoke.cjs "$PWD" $SCRATCH "$PWD/probe-output/cache"
```
Expected: the status line shows `594 من 594 تعزيزاً` (or the current number), the patch pill shows `باتش 16.21`, and all three screenshots show RTL rarity sections with chips. The search and prismatic shots also show the detail panel. Look at the screenshots. If the page is blank, check whether the CSP or `type="module"` over `file://` is the cause, fix it, and record the fix in this plan.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json .gitignore src/main src/renderer/app.ts static
git commit -m "Add Electron augment search window (Arabic RTL)"
```

---

### Task 5: Windows build on GitHub Actions

**Files:**
- Create: `.github/workflows/build-windows.yml`

**Interfaces:**
- Produces: the artifact `LOL_helper-windows`, containing `LOL_helper <version>.exe` (portable, unsigned).

- [ ] **Step 1: Write the workflow**

```yaml
name: build-windows
on:
  push:
    branches: [claude/sleepy-cerf-xyrs3s, main]
  workflow_dispatch:
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npx -y npm@11 ci
      - run: npm test
      - run: npm run dist:win
      - uses: actions/upload-artifact@v4
        with:
          name: LOL_helper-windows
          path: release/*.exe
          if-no-files-found: error
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/build-windows.yml
git commit -m "Build a portable Windows exe on GitHub Actions"
git push -u origin claude/sleepy-cerf-xyrs3s
```

- [ ] **Step 3: Verify the run**

Use the GitHub MCP tools (`actions_list` for runs of `build-windows.yml`, then `get_job_logs` on failure) to wait for the run triggered by the push.
Expected: the run is green and the artifact `LOL_helper-windows` is listed. If it fails, read the logs, fix the cause, and push again. Do not mark this task done while the run is red.

---

## After this plan

- The owner downloads the artifact from the Actions run page, unzips it and runs `LOL_helper <version>.exe`. SmartScreen will warn ("More info" → "Run anyway").
- Next plan (phase 2): `lcu` read-only plus `stats`, which includes the parser for OP.GG's `Class(...)` response format. Mayhem augment tiers from `lol_list_aram_augments` are added to these chips once a champion is known.

## Changes made during execution (2026-10-26)

- **Modes are back.** The real data showed a clean split: `map30.bin` (the Arena map) holds only augment ids < 1000, and `kiwi*.bin` (Mayhem) only ids ≥ 1000. Each `AugmentText` now has `modes: ('arena' | 'mayhem')[]`. Twins with the same name and the same text merge into one entry with both modes. Of 94 duplicate names, 47 were identical twins; in the other 47 the text differs, and they stay as two entries labelled Arena and Mayhem. The UI gained a "الطور" pill group, and chips show a small mode badge.
- **The `???` placeholder augment (1424) is dropped.** Result: 546 augments, 512 with an official Arabic description.
- **The cache file has a `schema` number (2),** so caches written before the shape change are rebuilt even when the game version matches.
- **Pill buttons use `data-value`** (shared handler for the rarity and mode groups). Chips are min 210px wide and show "name — English name" on hover.
- **The real-data check needs its own Vitest config,** because the project config only includes `tests/`.
- **npm 11.21 no longer runs install scripts by default.** Electron 44 downloads its binary on first run anyway, so nothing else was needed.
