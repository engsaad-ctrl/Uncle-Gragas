# Arithmetic data generation

`node knowledge/make-card-data.cjs --check` compares the generated arithmetic definitions with `src/ai/cardMathData.ts` without writing anything. The normal test suite runs this check. To regenerate, run the same command without `--check`. Use `--out FILE` to inspect a generated file elsewhere first.

The inputs are the JSONL files named in the generator and `knowledge/math-overrides.json`. The overrides preserve 32 existing definitions that the previous generator could not reproduce: 7 augments, 18 champion passives, 1 spell-hit record, and 6 items. Their provenance is baseline commit `d2124b38a1ac4948f1ffd657de5d626290cd251d`; preserving them does not certify their in-game correctness.

Every preserved override also records the source definition it originally replaced (or `null` for an absent source). If that source changes, generation stops and requires reconciliation. A new source fix therefore cannot be silently hidden by an old preserved override. Update or remove the override and its expected input deliberately when consolidating a definition into the primary JSONL sources.

Before changing mechanics, use a patch-specific source, update the relevant inputs, regenerate, and run the mechanical regression and the generation check. An unexplained disagreement is an error, not permission to overwrite the generated output or accept a cached result. None of these checks measures recommendation quality or winning.

## Targeted haste correction (16.21)

`card-fixes-4.jsonl` records three Bread effects as 100 haste on a selected skill, replacing 33.33 haste on every basic skill. Each entry pins the Kiwi asset URL, content version and SHA256. Its current tooltip uses `{{SpellName}}` and the augment is marked `IsAbilityAugment`; the legacy Q/W/E value names alone are not used to guess the binding. The player supplies the skill shown in the actual offer. An unset or missing target has no simulated haste and is reported as unmodelled, including in complete plans and explanations.

The runtime stores independent targets per augment, adds same-skill haste before converting cooldowns, and propagates these targets to role/style checks. The old annotation that Q/W/E should be a main ability no longer halves the simulated targeted effect. Other unmodelled conditions retain their existing treatment; this correction does not validate those weights.

`tests/fixtures/game/spell-ranks-16.21.json` extracts rank metadata from 11 public champion bins with source URLs and SHA256. The fight reads explicit champion level requirements, with ordinary R defaulting to 6/11/16, skips rank-zero spells, and excludes ultimate-dependent effects before availability. Nonstandard stances and transformations use their data. Basic skill ranks remain a level-based estimate, without the player's learned ranks or a coherent skill-point allocation. This is a boundary correction, not a complete ability-rotation model.

The pinned game files are Riot game assets mirrored by CommunityDragon, not a Riot-hosted API. Patch-specific evidence does not establish that every generated mechanic is current on another patch.

## BEES!!! read from the loaded patch (2026-11-09)

BEES!!! (3086) has no fixed numbers in the generated data any more (`card-fixes-4.jsonl` sets its ops to `[]`). `src/ai/augmentFiles.ts` builds its card from the root spell and missiles that `loadAugments` keeps for `FILE_READ_AUGMENTS` (cache schema 14), so text and numbers come from one download of one patch. Every path (offer, full plan, build search, styles, explanation) takes cards through `cardsOf` in `src/main/services.ts`, which applies the reader. Missing file numbers give an empty card with the missing names; nothing falls back to 16.21.

Read from the file: `Calc_Damage` (75-200 in 16.21, 75-140 in 16.22, +1.5 bonus AD, +0.7 AP; the tooltip says total over `Damage_Duration`), `Calc_Cooldown` (`{4b11fb1c}`, 15 to 10 by level), `Calc_OnHit_Efficacy` (`{a21a0bfc}`, 0.4), `Damage_Duration` 2, `TicksPerSecond` 2, and the `Augment_BEES_Hive_Missile` travel time (0.75 s, then 1.1 s). Fixture: `tests/fixtures/game/bees-16.21-16.22.json` with URLs and SHA256.

The fight op `delayed_dot`: launched on an ability hit once per cooldown, lands after the hive travel time, deals the damage in four even ticks at the end of each half second, ticks past 15 s are lost. Assumptions, all listed in the card's `not_modelled`: primary target only (the 425 radius is not counted, like every ability in this fight); bee flight from hive to target counted 0 (at most about 0.24 s at 1800 speed); damage read from stats at launch; on-hit damage only, at 0.4, once per hive (the number of applications in game is not established), with no on-hit stacks, heals, mana, refunds, spellblade or life steal; the slow is not counted.

Sensitivity of the on-hit assumption, level 15, 16.22, 300 AP, an on-hit of 75 damage: hive 338.5 before resists; on-hit +30 at one application, +120 if every tick applied it (368.5 against 458.5, about 24% apart).

## Fixed fight cases (step 3, 2026-11-09)

`node node_modules/vitest/vitest.mjs run tests/sim --configLoader runner` runs `tests/fixtures/sim/cases.json` (six cases: Ahri, Karthus, Nasus, Gragas, Udyr, Jayce) on pinned 16.22 files in `tests/fixtures/sim/16.22/` (six champion bins as they are, the items bin cut to 17 items; source URL, source SHA256 and stored SHA256 in its manifest; `make-inputs.cjs` made them from the Codex download). The real loaders read them through a fetch that refuses any other URL, with a throwaway cache: no network, no APPDATA. The result is `tests/fixtures/sim/report.json`; a run that differs fails, and `-u` is for a change you can explain. Two runs in a row gave the same file (SHA256 95134bfc...).

Per case it records the inputs, the fight quantities (damage by source, effective health, healing, healing denied, casts, stats), each item's removal effect and pair interactions (`explainBuild`), each augment's removal effect, and for a card that is one damage op its hits landed (the op set to 1 true damage). Variants rerun a case with one definition changed, so a fix is compared with the state before it. Enemies are stated numbers, not read from a match. No ranking, no win chance.

BEES on Ahri, level 11, 299 AP, magic taken 0.633 (70 resist minus 12 pen): per hive 75 + 65 x 10/17 + 0.7 x 299 = 322.5 in 16.22. Landed 1.5 hives (the second lands near the end, two of four ticks), 306.2 damage. The 16.21 file: 357.8 a hive, 1.75 hives (shorter flight), 396.3. The old fixed copy: two instant procs of 357.8, 453.0. Each difference is count x size x 0.633.

## Echo Cast read from the loaded patch (step 4, 2026-11-09)

Echo Cast (2062, `Ability_SelfAOE_DoubleCast`) was a `damage_amp` x2 on `one_ability`, spread as +1/3 on every ability, with no target and no delay. Its generated ops are now `[]` (`card-fixes-4.jsonl`); `src/ai/augmentFiles.ts` reads `DelayTime` (0.25) and `CloneDamageRatio` (1) from the root spell, the same in 16.21 and 16.22 (`tests/fixtures/game/echo-16.21-16.22.json`). The tooltip says the clone recasts "your {{SpellName}}" and the augment has `IsAbilityAugment`, so the target is the player's input, as for Bread (2062 joined `ABILITY_TARGET_AUGMENTS`; cache schema 15).

The fight op `echo`: each damaging, non-toggle cast of the chosen skill deals the same hit again after the delay, read from stats at the cast, with no mana and no cooldown; an echo past 15 s is lost. No target, or a target he lacks: no effect and a stated gap. Not established and listed in the card: whether the clone, which travels up to 500 toward the cursor, hits the same target; mana and cooldown of the recast; ability-hit effects and healing from the copy (counted none, a lower bound; `events: true` is the variant that fires them).

Ahri case (W, Fox-Fire): 3 casts x 395 x 0.633 = 750.5, against 757.7 for the old amp; the variant with ability-hit events adds 0 here (her procs were on their own cooldowns at those times).

## Dashing by movement tags (step 4, 2026-11-09)

Dashing (1019, `ARAM_Dashing`): the tooltip gives `Haste` (175) to "your dash, leap, blink, or teleport Abilities". The old reading spread 175/3 on every basic skill. Its generated ops are now `[]`; `src/ai/augmentFiles.ts` reads `Haste` (175 in 16.21 and 16.22, `tests/fixtures/game/dashing-16.21-16.22.json`), and the fight gives it to each of his four skills whose `mSpellTags` hold `PositiveEffect_MoveBlock`, `PositiveEffect_Teleport` or `Trait_PlayerSelectedDashDirection` (`MOVEMENT_TAGS` in cardMath.ts). No such skill: no effect and a stated gap. Its "has a dash or blink" tag no longer halves it in `tagWeight`, since the fight checks it per skill. Cache schema 16.

Evidence: `tests/fixtures/game/movement-tags-16.22.json` holds the tags of 140 slot skills of 35 champions (URL and SHA256 each) and the skills that move by their own descriptions (Claude's labels). The tags mark all of them but four: Twisted Fate R, Sion R, Nocturne R and Lee Sin's second Q (a recast not in the slot). No skill that doesn't move is tagged; `AbilityTraits=2048` is not used (Ahri E has it). Not established: that the game's Dashing reads these same tags. Skills of a transforming champion's other form are not slots in the fight.

Gragas case (E, Body Slam): E cast twice instead of once, one fewer W in the casting windows; damage +60, healing -528 (fewer W casts). The old spread gave W a fourth cast instead.

## Legal skill ranks (step 4, 2026-11-09)

The fight took each basic skill at ceil(level / 3) ranks: ten points at level 9 (3, 3, 3 and R), fourteen at 11. `allocateAbilityRanks` in `src/ai/abilityRank.ts` now spends one point a level: an ordinary ultimate (four ranks or fewer) as soon as a rank opens, a starting form's rank 1 free at level 1 (Jayce, Elise, Nidalee, Karma), a basic rank n from level 2n - 1 unless the champion file names a level (Udyr), first one point in each basic, then the lowest rank (Q W E R on ties), or a max order when one is given. Every pinned champion at every level spends no more than its level and no rank above its bound (test).

The live game's own ranks are read now: `/liveclientdata/activeplayer` `abilities.Q/W/E/R.abilityLevel` for the active player only (`ranksFromLive`), passed by the main process with the live level (`AugmentProgress.abilityRanks`, never accepted from the page). At that level they are used as they are; later levels (the plan to 15) go on from them by the rule; an earlier level ignores them. They reach the offer values, the complete plans, the item search and the explanation, and the build cache key. Without them the build notes say the ranks are an even legal allocation.

Not established: how players actually spend points. The even spread is a neutral default and is low for a champion who maxes one skill: Nasus level 13 with Q-targeted Bread fell from 4,295 to 3,229 (Q rank 5 to 4, its cooldown longer, 9 casts to 6). The fixed cases changed by rank alone: Ahri 3,558 to 3,325, Karthus 7,146 to 6,797, Gragas 1,163 to 1,103, Udyr 7,938 to 7,821, Jayce unchanged.

## Skill order from the build page (the owner, 2026-11-09)

When the match gives no ranks, the allocation follows the build page's skill order (the owner chose this over the even spread): the Mayhem site's most picked level-by-level order and max order (`sitePage` in `src/stats/arammayhem.ts`), else OP.GG's ARAM build. Each level takes the page's key when that rank is legal there, else the rule; past the page's levels the max order, then the even rule. No page: the even spread. `skillPlanFor` in services loads it once per champion, from the same disk caches as the build page; it reaches the offer values, the item search, the explanation and the role check. The build notes say which one was used. This is an assumption about how the player levels, taken from what most players pick; it does not weigh any item or augment. Live ranks, when read, still come first.

Fixed case: Nasus level 13 with Q, then E, then W maxed (a stated order, not read from a site in the test) is 4,295 again, against 3,229 with the even spread.

## Damage type of each hit (step 4, 2026-11-09)

The fight took every ability by the kit's type (`CHAMPION_KITS`), and a mixed kit by the mean of physical and magic. Each spell's tooltip marks its own: `<magicDamage>@TotalDamage@ ...</magicDamage>`. `src/texts/damageTypes.ts` reads these spans from the tooltip strings the app already loads (the Arabic table keeps the English tags: checked on 16.22) and attaches them to the spell (`mSpell.__damageTypes`); services' `fightBin` gives every fight that bin. A cast takes the types around the value it deals, a share each (Ahri's Q `TotalDamage`: magic out, true back, half each); a value the text doesn't mark takes all the spell's marked types; no tooltip: the kit's type, as before. A toggle's burn takes the most marked type. Echo Cast's copy follows its cast. Items' and augments' own ops keep their stated types.

Not established: the share of each type when the text names one value twice (Ahri's Q counts out and back once each, so hitting with only one leg is not modelled); a span that marks a value in another unit (a % of health) is taken as that value's type.

Fixed cases (tooltips pinned in `tests/fixtures/sim/16.22/tooltips.cut.json`; each case has a variant with the kit's type): Ahri +258 (Q: 3 casts x 469 x (half true 1 + half magic 0.633 - 0.633)); Nasus +19, Udyr +9, Jayce +26; Karthus and Gragas unchanged (all magic).

## Timing of effects that wait for combat (step 4, 2026-11-09)

`make-card-data.cjs` stores an effect that waits N seconds of champion combat averaged over the 15 s fight: Jak'Sho's +30% bonus resists after 5 s as 1.2, Riftmaker's 10% (melee) omnivamp after 4 s as 0.0733. The fight already undid this for damage amps. Now also for adds and multipliers: before their seconds the stat is without them, after them it is in full (`current`), so a skill that scales with armor or health is cast with the resists it has at that moment; effective health and the shown stats keep the average (a time average of the resists is what one effective health a fight can hold); omnivamp heals only from his own damage after its seconds (read from the damage by second). Jak'Sho and Riftmaker are the only such adds and multipliers in the data.

Burns: re-applying a burn adds a stack and refreshes them all, as before. The only text that says a burn stacks without limit (Firebrand) does not say each stack keeps its own time; a third-party list (ClutchPoints) says it "refreshes with each application". No burn in the data is documented as expiring stack by stack, so none is modelled that way.

Not modelled: whether the fight is "in champion combat" from its first second (taken so); the six fixed cases hold neither item, so their report is unchanged.

## Conditions: no more 0.5 (step 4, 2026-11-09)

`tagWeight` halved a card's value when its tags named a condition the fight doesn't check (78 cards with numbers). The half was not a measured chance. Now a card counts in full, its value being what it gives when the condition holds, and the condition is either settled or open:
- settled by an event the fight runs, when the card's ops hang on it: a takedown condition with a takedown or kill trigger (13 cards), an attack condition with an attack or on-hit trigger; by the existing exemptions (Bread's chosen skill, Dashing's tags);
- settled by his own kit and files for a card whose `need` is an ability kind (18 cards): `spellTraits` reads a moving skill (`MOVEMENT_TAGS`) and an immobilizing one (`Trait_ImmobilizingCCSpell`) from his four skills' tags, and heals or shields on allies come from his kit; only "yes" is read, a kind not found stays unknown;
- open otherwise (47 cards, and the 18 when his kit doesn't show the kind): the row says "شرط لا يفحصه القتال: ... ؛ القيمة إن تحقق، واحتمال تحققه غير مقاس", and the card is never certain. The offer comparison already declares no winner while any offer is uncertain.

Consequence to know: an open-condition card's value is now its value if the condition holds, about twice what it showed, so a plain list sorted by value can put it above certain cards; its note and "not certain" say why.

Open conditions are ranked apart (the owner, 2026-11-09, «Yes, separate them»): each row carries `open` (the conditions), the relative place among a rarity is computed among settled cards and among open ones separately (overlay `mathPlaces`), an open card's tag reads "N% مشروط" with its conditions in the tooltip, and an offer lists settled cards first, then open ones, then those with no value (`rankOffer`). The overlay was not opened to look at it (no Electron start); the ranking is tested in tests/app/walk.test.ts.
