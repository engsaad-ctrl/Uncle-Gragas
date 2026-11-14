# creator-path: would the engine take a creator's augment path?

The owner's question (T024, 2026-11-11): shown the same augment offers a creator was shown at each round, would the engine suggest a path like his?

This is a measure. It is not training, and it changes no calculation. The method and the first results are in `knowledge/codex-claude/T024-creator-paths.md`.

## Run

From the repo root, after `npx tsc -p tsconfig.build.json`, with `APPDATA` on the data the engine should read:

```
node scripts/checks/creator-path.mjs --self-check
node scripts/checks/creator-path.mjs                      # writes scripts/checks/creator-path.txt
node scripts/checks/creator-path.mjs --dist=<other dist>  # the same questions to another build (a baseline)
```

Options:
- `--out=<file>`: write the text result to another file.
- `--json=<file>`: also write every round's numbers.
- `--only=Veigar,Qiyana`: run a few games only.

The first line of the result is the date, the dist and its commit. Compare runs with `tail -n +2`.

- **Exit 1:** a data or service error. Examples: a name that matches no id or more than one, an id that differs from the one in the file, a taken card that is not in its offer, or an error thrown by the services.
- **Exit 0:** everything else. Unknowns, ties and uncertain cards are counted and shown, never dropped.
- A lower likeness is not a failure.

## In the gate

The lines below are at the end of `gate2.sh`, and so also run in `gate3.sh`, which calls gate2. `gate2.sh` runs with `set -e`, so a technical failure stops the gate. The diff to the baseline is printed as a warning only.

```
# T024 creator path (scripts/checks/creator-path.md): a technical failure stops the gate (set -e); a lower likeness is a warning, shown as the diff to the hand-kept baseline.
node scripts/checks/creator-path.mjs --self-check
node scripts/checks/creator-path.mjs > /dev/null
diff <(tail -n +2 scripts/checks/creator-path-baseline.txt) <(tail -n +2 scripts/checks/creator-path.txt) | head -60 || true
```

`creator-path-baseline.txt` is kept by hand. No run replaces it.

## Records

### `knowledge/notes-300/creator-offers-2026-11-10.jsonl`

- The first line is `{"record":"meta", ...}`: the date of the source notes and the sha256 of each note file (CR removed).
- Every other line is one round, in the shape of `zwag-picks.jsonl`:

| Field | Meaning |
|---|---|
| `video`, `game_no`, `round` | A round's identity. One video can hold two games (Malphite and Pyke). |
| `time` | Video time of the first offer. It is never turned into a level. |
| `champion`, `creator` | |
| `held` | His earlier picks by name. A transmute counts as what it became, from the round it happened. |
| `offered` | The offer at his pick: each `{name, aug_id, rarity, sure}`. It is the first set with each reroll applied to its card's place. |
| `rerolled_offers` | `[first set]` when he rerolled. Intermediate states are not kept. |
| `rerolls` | `[{place, gave, gave_aug_id, at}]`. `reroll_order_known: false` when the note gives no order; the final set is still valid. |
| `taken`, `taken_aug_id`, `taken_evidence` | `taken_evidence` is screen, said, unsure or inferred. `taken_how` holds the evidence and the note line. |
| `offered_evidence` | screen. |
| `level`, `level_source` | `derived`: Mayhem's unlock level for the round (3/7/11/15). `event`: a level the note gives for an event, with `level_ref`. |
| `level_conflict` | A note that contradicts the derived level. The round is left out of the stage counts only. |
| `superfans_extra` | The extra augment at level 21. |
| `transmute` | `{into: [{name, aug_id}], evidence, at}`. |
| `note_ref` | The note file and line. |

### `knowledge/notes-300/creator-items-2026-11-10.jsonl`

- The first line is the same meta line.
- Then one `{"record":"game", ...}` line per game, in the shape of `zwag-unnamed-read.jsonl`:
  - `augments`: his picks.
  - `items`: empty, and `items_complete: false`, because his final six are not known for these games.
  - `purchases`: `{name, item_id, time, status, evidence, note}`. `status` is one of:
    - `bought`: proven owned by that time. Only these count as owned before a round.
    - `named`: said as built.
    - `planned`, `considered`, `declined` or `unsure`.
  - `item_id` is folded to `id % 10000`, as the other creator checks fold items.

Both files are made by `knowledge/codex-claude/T024/make-offers.mjs` from `notes-8.md`, `notes-9.md` and `notes-10.md`.

## What it asks

**(a) On his history.** Each round gets his earlier picks and the items bought by then. `cardValues` (with the offer) gives each card's stage value, and the walk's `rankOffer` orders them: settled cards first, then cards with an open condition, then unmeasured ones. The script then records:
- whether the first card is his pick, or tied with it at the top;
- his card's place;
- `dominantOffer` (stage and plan together), or why it gives none: missing, uncertain, unsupported, tie or no dominance.

The first set before his rerolls is reported apart from the decisions.

**(b) The engine's own path.** It starts with no augments and goes through his offers in order, keeping its own picks, in two branches:
- **decision:** `dominantOffer`. The branch stops when there is no settled decision.
- **the walk's first card:** stage order only. This is not a plan choice. It stops on a tie or when no card is measured.

Either branch also stops on an offer that holds a card the engine already has, or on a transmute pick. After the first difference, none of his later items are copied.

**Items.**
- After each round: the engine's next item against the first item he bought or named before the next round.
- Over the game: recall of his known items (bought or named, legendary) in the engine's plan with his augments.
- Full-set and first-item likeness are not counted, because his final six are unknown.
