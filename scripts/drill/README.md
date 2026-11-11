# Drill deck builder

Builds `packages/content/drill/deck.json`, the 10,878-word deck for the Anki-style drill at `#/drill`
(docs/DRILL.md, DECISIONS.md D78–D84).

```
npx tsx scripts/drill/build-deck.ts                     # reads ../korean-public
npx tsx scripts/drill/build-deck.ts --wordbank <dir> --out <file>
```

## Inputs (read only)

| file in the word-bank repo | used for |
|---|---|
| `wordbank/wordbank.csv` | words, deck order (tier 1→6, then frequency = id order), pos, origin/hanja, tier, frequency rank |
| `wordbank/content/tier*/*.jsonl` | original glosses and the first example sentence (`gloss_source: "original"`) |
| `private/sense_hints.json` | short English equivalents from 한국어기초사전 for every other word (`gloss_source: "krdict"`) |

The word-bank repo is never modified. Only the generated deck is committed here.

## Rules

- A word with original content uses its gloss and first example.
- Any other word gets the unique dictionary equivalents joined with "; ", capped at about 60 characters,
  and no example. Proverb- or idiom-like equivalents are dropped (`sentenceLike`); a word left with
  nothing shows "No English gloss yet" in the app.
- KRDict definitions and example sentences are never used.
- The output is deterministic, one word per line, with a `version` hash. The app keys nothing on the
  version: card ids are `<wordId>:f` / `<wordId>:r`, so rebuilding never touches review history.

## When to rebuild

Whenever the word bank gets original content for another tier (or fixes to tier 1). Then run
`npm run check` and commit the new `deck.json`.

## Test fixture

The e2e build uses `apps/web/tests/e2e/fixture-drill-deck.json` (30 words, five per tier) through
`KSRS_DRILL_DECK`; see `apps/web/build.ts`.
