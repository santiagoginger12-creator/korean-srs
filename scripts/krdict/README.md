# KRDict example sentences

`build_examples.py` builds `packages/content/examples/krdict-examples.json`, a bank of dictionary example sentences for each vocab item and idiom. The data comes from 한국어기초사전 (국립국어원), CC BY-SA 2.0 KR; see `packages/content/examples/LICENSE.md`. The app rotates through the examples so that each review shows a different one.

## Re-running (including with a newer KRDict download)

1. Download the KRDict full-dictionary export in **LMF XML** format (the `*.xml` files, same format as the 2019-06-26 snapshot). Put it in a **new, empty directory outside the repo**. It is untrusted input, so never commit it and never run anything from inside that directory.
2. Run the build with `python3 -I` from the repo root. It takes about 10 seconds.

   ```sh
   python3 -I scripts/krdict/build_examples.py <xml_dir> packages/content/seed \
     scripts/krdict/sense-map.json packages/content/examples/krdict-examples.json \
     --worksheet /tmp/krdict-worksheet.txt
   ```

3. Read the stderr summary:
   - **unresolved**: these items have several KRDict senses or homographs and no entry in `sense-map.json`, so they were skipped. Add a decision for each one (see below) and run the build again.
   - **sense-map: … unknown entry/sense**: a newer snapshot renumbered or removed a sense. Look the word up in the worksheet and fix the ref.
4. If the snapshot date changed, update `SOURCE["snapshot"]` in `build_examples.py` and the date in `LICENSE.md`.
5. Run `npm run check`.

The output is deterministic: the same inputs give a byte-identical file.

## Sense alignment: `sense-map.json`

An app item usually targets one sense of a word. For example, `v:걸치다:span` means "span a period", not "throw on a coat". Examples from the wrong sense would teach the wrong thing, so every item whose KRDict lemma (with a matching part of speech) has more than one sense, or more than one homograph, needs a decision:

```jsonc
"v:걸치다:span": ["16301:2", "16301:3"],   // <LexicalEntry id>:<Sense id>
"v:경우": "all",                            // every sense of the single matching entry
"v:십상": [],                               // nothing fits: no examples
"x:핑계-없는-무덤-없다": ["85210/핑계 없는 무덤이 없다:1"]
```

- Idiom (관용구) and proverb (속담) entries reuse their head word's entry id, so their refs are written `<id>/<lemma>:<sense>`.
- A ref may point at a different lemma when KRDict lacks the app's word: `v:상쇄` uses 상쇄하다/상쇄되다, and `v:개의치-않다` uses 개의하다. Vocab items fall back to matching that lemma's surface form. Expressions always have to match their own phrase.
- `_why` holds a short reason for each non-obvious call. Keys starting with `_` are ignored.
- Items not in the map are used only when exactly one entry with exactly one sense matches.
- When unsure, list fewer senses.

The `--worksheet` file lists each multi-sense item with its meanings, collocations, and examples, next to every candidate KRDict sense's definition, English gloss, and first example. Work from that file when you edit the map.

## What the build does

- **Parsing**: a tolerant regex scanner reads `LexicalEntry` › `Lemma/writtenForm`, `partOfSpeech`, `origin`, and `Sense` › `definition` and `SenseExample`. It is not an XML parser, because some files in the snapshot are not well-formed.
- **Examples**: only `문장` (sentence) and `대화` (dialogue) examples are used. A dialogue is one `SenseExample` with 2–4 lines, labelled `가:`/`나:`.
- **`match`** is the highlighted surface form.
  - Verbs and adjectives are stem-matched: 다 is stripped, and the build generates contracted and irregular stems (하→해, ㅣ→ㅕ, 르, ㅂ, ㄷ, ㅅ, ㄹ, ㅎ). It then takes the eojeol from that point, so 기르다 matches 길러서 and 이르다 matches 일렀다.
  - Nouns, adverbs, and fixed phrases match literally. Idioms tolerate a changed particle or ending, so 변죽을 울리다 matches 변죽만 울리는.
  - A sentence where the word cannot be found is dropped.
  - For dialogues, `matchLine` is the **0-based** index into `lines`.
- **Selection**:
  - Senses are taken round-robin so the examples are varied.
  - Exact duplicates are dropped, and so are near-duplicates (character-bigram Jaccard ≥ 0.7), including near-copies of the item's own examples.
  - Each item keeps at most 12 examples. Sentences come first, and up to 2 slots are kept for dialogues. The text is verbatim apart from whitespace and entity normalization.
