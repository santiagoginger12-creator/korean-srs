# License notes for the drill deck (`deck.json`)

`deck.json` is the word list for the Anki-style vocabulary drill (docs/DRILL.md). It is built by
`scripts/drill/build-deck.ts` from the owner's word bank. Two kinds of gloss are mixed in it, and
each word says which one it has in `gloss_source`.

## `gloss_source: "original"`

Glosses and example sentences written for this project (word bank tier 1 today, more tiers as
they are written). They are original work and are not covered by the license below.

## `gloss_source: "krdict"`

Short English equivalents taken from **한국어기초사전 (Basic Korean Dictionary)**, published by
**국립국어원 (National Institute of Korean Language)**, licensed under **Creative Commons
Attribution-ShareAlike 2.0 Korea** (CC BY-SA 2.0 KR).

Credit line shown in the app on every card that uses one of these glosses:

> English glosses for some words: 국립국어원 한국어기초사전 (CC BY-SA 2.0 KR)

### Changes made

- Only the short English equivalents are used. No definitions and no example sentences are copied.
- Equivalents are de-duplicated, joined with "; ", and cut to about 60 characters.
- Equivalents that are proverb or idiom translations (sentence-like entries) are left out, so a few
  words have no English gloss yet.

If you share these glosses, or a work adapted from them, give the same attribution and license them
under CC BY-SA 2.0 KR or a compatible license.

## Word list

The headwords, tiers and the frequency order come from the word bank, whose own README covers their
sources (KRDict learner levels; FrequencyWords counts, CC BY-SA 4.0).

## Scope

These notes cover only `packages/content/drill/`. The rest of the repository is not covered.
