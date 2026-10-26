# Phase 2a — Champion Page (record)

> Written alongside the implementation, not before it. The owner asked to keep moving, so each part was built test-first and verified on real data. This file records what was built and why, for review and for the next plan.

**Goal:** A champion picker plus a champion page in the style of the stat site the owner showed. The page has the portrait, ability icons, skill priority and order, spells, items, runes and Mayhem augment ratings. Names are shown in English by default and every description is in Arabic. The champion is picked by hand; the client integration (2b) comes later and needs the owner's PC.

## Facts established on real data (2026-10-26, patch 16.21)

- **OP.GG `lol_get_champion_analysis`:** `champion` is the CommunityDragon alias upper-cased (`MONKEYKING`, `TWISTEDFATE`, `DRMUNDO`, `KSANTE` all work). `desired_output_fields` is a closed list; the exact strings are in `src/stats/opgg.ts` → `BUILD_FIELDS`. ARAM answers omit some sections (`sixth_items`).
- **OP.GG has no Mayhem build mode.** Mayhem pages show the ARAM build and say so on screen.
- **Mayhem ratings:** OP.GG `lol_list_aram_augments` ids match CommunityDragon augment ids (153 of 154). Entries with `popular == 0` carry placeholder performance values (0 or 170), so they are excluded. The rest are sorted by `performance`. The direction of the `tier` number (3/4/5) is unclear, so it is not shown.
- **Answer format:** OP.GG answers in its own `class X: fields` + `X(...)` format. `src/stats/opggFormat.ts` parses it, and plain JSON answers pass through.
- **CommunityDragon champion data:** `champion-summary.json` holds the list (ids ≥ 60000 are Jade variants and are dropped). `champions/{id}.json` holds `passive`/`spells` with `abilityIconPath`. `summoner-spells.json` and `perkstyles.json` cover spells and rune trees. English is the `default` locale.

## What was built

| File | Responsibility | Tests |
|---|---|---|
| `src/stats/opggFormat.ts` | `parseOpgg(text)` | `tests/stats/opggFormat.test.ts` (real answers + edge cases) |
| `src/stats/opgg.ts` | `mcpCaller`, `toBuild`, `toMayhemAugments`, `OpggStats` (6h file cache, stale fallback) | `tests/stats/opgg.test.ts` |
| `src/texts/assets.ts` | `assetUrl` (shared by augments, champions, items, runes) | `tests/texts/champions.test.ts` |
| `src/texts/champions.ts` | champion list, champion detail (P/Q/W/E/R), spells, rune trees | `tests/texts/champions.test.ts` |
| `src/texts/items.ts`, `runes.ts` | now also carry `enName` | existing tests extended |
| `src/texts/augments.ts` | `AugmentText.ids` (all merged platform ids); cache schema 3 | extended |
| `src/app/championPage.ts` | `composeChampionPage`: ids → texts, Mayhem stats ↔ augments join, build errors keep the page usable | `tests/app/championPage.test.ts` |
| `src/main/services.ts` | loads and caches everything; `parsePageRequest` validates IPC input | `tests/main/services.test.ts` |
| `src/main/main.ts`, `static/preload.cjs` | IPC: `augments:get`, `champions:list`, `champion:page` | smoke test |
| `src/renderer/*` | router (`app.ts`), `dom.ts` helpers, `augmentsView`, `championsView`, `championView` | smoke test with screenshots |

`@modelcontextprotocol/sdk` and `zod` are runtime dependencies again, because the app now calls OP.GG itself.

## Verification

- `npm test`: 91 tests passing; `npx tsc` clean.
- Real-data run (`probe-output/real3.test.ts`, not committed). Ahri ranked mid shows core Malignance → Shadowflame → Zhonya, Electrocute runes and skill order WQEQQRQWQWRWWEE. ARAM and Mayhem work too (152 rated augments before dropping the no-sample ones), and so does Wukong top.
- Electron smoke under Xvfb: picker (173 champions), Ahri ranked page, item detail (English name + Arabic description), Mayhem page, and the augments tab.

## Next (2b, needs the owner's PC)

- Read champion select from the League client (lockfile → LCU) and open the right champion page automatically.
- A "تصدير التشخيص" button that saves raw LCU answers, so fixes can be made from real data.

## Follow-up (owner feedback: animation, more modes, a real rune page)

- **Full rune page.** `perkstyles.json` slots (`kKeyStone`, `kMixedRegularSplashable` ×3, `kStatMod` ×3) are turned into `RuneTree` rows. Every rune is shown, the build's choices are lit, the rest are dimmed. Stat shards are matched by row index, because one shard id can sit in two rows.
- **Modes.** Flex works like Ranked (position pills). Arena, URF and Nexus Blitz have tabs with no build. For Arena, OP.GG has no data, and the tab links to `#/augments/arena`. For URF and Nexus Blitz, OP.GG's MCP tool demands `position = NONE` upstream but rejects `none`/`NONE` in its own enum (verified 2026-10-26), so no position value works.
- **Motion.** Views fade up; chips, champion cards and skill-path cells pop in with a stagger (`--delay` set via CSSOM, which the CSP allows). Cards lift on hover, the detail panel slides in on every pick, and loading lines get a spinner. Everything is switched off under `prefers-reduced-motion`.
- **Verified.** 96 tests pass. The Electron smoke shows 9 lit runes (4 + 2 + 3) and 21 dimmed, all 63 images on Ahri's page load, Flex and URF behave as described, and the Arena link opens the 272 Arena augments.
