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

## Follow-up 2 (owner: main menu with Champions / Items / Augments / Tier List, a Modes menu, same font)

- **Side menu (right side, RTL)** with the four sections, plus a "الأطوار" menu (Normal, ARAM, ARAM Mayhem, Arena). The mode is app-wide state (saved in `localStorage`). Champion links open that mode's build, Items show that map's items, and Augments filter to Arena or Mayhem. Tier List exists only for Normal; OP.GG has none for the other modes.
- **Items:** OP.GG `lol_list_items` (per map: `SUMMONERS_RIFT`, `HOWLING_ABYSS`, `ARENA_MAP_1`) supplies ids, gold and build tree, with a 24h cache. Names and Arabic text come from CommunityDragon, and items are grouped shop-style (`src/app/itemList.ts`). OP.GG's lists include mode copies of the same item (32xxxx, 66xxxx, 77xxxx next to the base id), so we keep the base id. Which copy the ARAM shop really uses is unverified (marked as a `shortcut:` in code).
- **Tier List:** OP.GG `lol_list_lane_meta_champions` with `position: 'all'`, cached 6h. All 263 rows across the five lanes matched CommunityDragon English names (`src/app/tierList.ts`). Rows show the rank change since the last period and link to the champion page for that lane.
- **Font:** Inter (the stat site's font) for Latin and Noto Sans Arabic for Arabic, both OFL, bundled under `static/fonts/` with their licences.
- **Verified:** 105 tests pass. Smoke run covered every menu, the mode switching (Arena 272 / Mayhem 321 augments, 227 Rift items, 186 Arena items), the Tier List → champion link, and confirmed the fonts loaded (Inter and Noto Sans Arabic at 400/600/700).

## Follow-up 3 (owner: too many "؟", hide OP.GG, hover cards, app icon)

- **Real numbers in augment texts** (`src/texts/spellValues.ts`). `@Name@` placeholders are filled from the augment's root spell (`bin[RootSpell].mSpell`): `DataValues` (rank 1), plus `mSpellCalculations` with Number, NamedDataValue, ByCharLevelInterpolation (shown as a range), ByCharLevelBreakpoints, Sum, Product and `mMultiplier`, honouring `mDisplayAsPercent` and `mPrecision`. Stat-scaling parts print "(+إحصاءات)" instead of guessing the stat; the stat-id meanings could not be confirmed from the data. Hashed names are FNV-1a 32-bit of the lowercased name (verified: `Calc_Bonus_Crit_Damage` → `{d130a2db}`). Lines with live match counters (`@f1@`…) are dropped. The tooltip text is used when it fully resolves, otherwise whichever text has fewer unknowns. Result on 16.21: augments containing "؟" went from 306 to 106, and "؟" marks from 490 to 119. The cache schema is 4.
- **OP.GG is not named anywhere in the UI** (owner's request). The data source is unchanged.
- **Hover cards** (`withTooltip` in `src/renderer/dom.ts`): one floating card, fed from a WeakMap, showing the icon, name, other-language name and Arabic description. It uses a 120ms delay, flips above when there is no room below, and fades and slides.
- **App icon**: Gentleman Gragas, face cropped from the splash the owner sent, with rounded corners and a gold frame. (An earlier Hillbilly Gragas version was replaced at the owner's request.) Saved as `build/icon.ico` (16–256 px) for the exe and `static/icon.png` for the window and side menu.
- **Not done yet**: about 35 Summoner's Rift items still show "؟". Their values live in the items bin file, not in the augment spells.

## Follow-up 4 (owner: random splash background, colours taken from the image)

- **Backgrounds:** four splash images the owner sent (Shamrock Malphite, Gentleman Gragas, Blitzcrank, Hillbilly Gragas), re-encoded to `static/backgrounds/*.jpg` (about 250KB total).
- **Colours per image:** a median-cut palette (12 colours, 160px thumbnail). The accent is the colour with the highest (saturation × value)^1.5 × count^0.35, nudged to S ≥ 0.65 and L 0.55–0.65 so it reads on dark. The second accent is the next colour with a clearly different hue. Background and panel tints are dark shades of the accent hue. All of it is precomputed into `src/renderer/theme.ts` (no image work at runtime).
- **On launch:** `applyRandomTheme()` sets the CSS variables and `--bg-image`, and never repeats the previous image (`pickThemeIndex`, tested). The art sits in `body::before` (slightly blurred), with a gradient veil in `body::after` that is lighter on the menu side. Panels are translucent with a backdrop blur, and leftover fixed colours were replaced with `color-mix()` on the theme variables.

## Follow-up 5 (owner: calmer colours, clearer art, settings button, "Summoner's Rift" label)

- **Calmer accents:** the hue still comes from each image, but the accent is softened to S 0.48 / L 0.64 and the second accent to S 0.42 / L 0.68. Panels are low-saturation tints of the same hue.
- **Clearer art:** no blur, a lighter veil (72% → 15% across the window), panels at 66% opacity with a 12px backdrop blur, and a text shadow on headings and menu text for readability.
- **Settings:** a gear button at the bottom of the side menu opens a panel with the name language (English/عربي) and "تغيير الخلفية" (next image). It closes on an outside click or Esc.
- The "العادي" mode is labelled **Summoner's Rift**.

## Follow-up 6 (owner: side menu collapses to icons, expands on hover)

- **Collapsed:** the side menu is a fixed 68px icon rail. On hover it widens to 236px over the page (the content does not move), labels fade in, and a shadow separates it. It stays open while the settings panel is open (`.pinned`).
- **Mode icons:** each mode got its own icon (crossed swords: Summoner's Rift, snowflake: ARAM, flame: Mayhem, ring: Arena), and the active mode's icon glows in the theme accent. The "الأطوار" title becomes a thin divider when collapsed. Links have `aria-label`s, so the rail stays accessible with labels hidden.
