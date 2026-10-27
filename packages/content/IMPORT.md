# Importing and exporting content (M5)

You can add your own items, or edit copies of built-in ones, from **CSV** (one file per kind),
**JSON**, or **KRDict** (한국어기초사전). Every import is validated, shown as a diff
(`diffItems`), and then saved as `customItem.upsert` events, so imported items sync and appear
in backups. API: `@ksrs/content` → `importCsv`, `importJson`, `importItems`, `exportCsv`,
`csvTemplate`, `diffItems`, `parseKrdict`/`parseKrdictXml`, `krdictToVocab`.

Imports never throw. Problems come back as `issues`, each with a `severity` (`error` rejects
that item, `warning` is informational), a `row` number, the item `id`, and a field `path`.

## CSV basics

- Use **one file per kind**: vocab, grammar, expression, or hanja. Pass the kind to `importCsv(kind, …)`.
- The CSV format is RFC 4180: UTF-8 (a BOM is fine), `"` quoting, `""` for a literal quote, and
  line breaks inside quotes. LF and CRLF both work.
- The **first non-blank, non-comment row is the header.** Column names are case-insensitive and
  can come in any order. Spaces and hyphens in a name count as `_`. Unknown columns are ignored
  with a warning.
- A row whose first cell starts with `#` is a comment. Blank rows are skipped.
- **Row numbers** count CSV records, starting with the header as row 1, so they match
  spreadsheet row numbers. (A cell with a line break inside it still counts as one row.)
- **Multiple values** go in one cell separated by `|`, for example `decision|determination`.
- **Pairs** use `::`, for example `결정을 내리다::to make a decision`.
- To use `|` or `:` literally, put a backslash in front: `\|`, `\:`, `\\`. (A single `:` inside
  text is fine; you only need to escape it where it touches another colon or the start or end
  of the value.)
- Empty cells take the default.
- `exportCsv(kind, items)` writes exactly the format `importCsv` reads (with a BOM so Excel
  shows Korean correctly). Exporting and re-importing is lossless; all 200 seed items are tested.
- `csvTemplate(kind)` gives every column for that kind plus one example row commented out with `#`.

## Columns shared by every kind

| column | default | notes |
|---|---|---|
| `id` | generated | `v:<word>`, `g:<pattern>` (without the leading `-`), `x:<text>`, `h:<char>`; spaces become `-`. If an existing item has the same kind and headword, its id is reused (so the import updates it). If the id is taken by a different item, or used earlier in the same file, the importer tries `:2`, `:3`, and so on. `ctx.idPrefixUser` is inserted after the prefix (`v:my/결정`). For homographs, give an explicit id (`v:배:ship`). |
| `level` | **required** | integer ≥ 1 |
| `gating` | `true` (`false` for hanja) | `true/false/yes/no/1/0` |
| `needs_review` | `false` | |
| `tags` | — | `a\|b` |
| `mnemonic` | — | required for hanja |
| `unlock_deps` | — | `id@lesson\|id@guru`. A dep without `@…` defaults to `@lesson` for hanja ids and `@guru` for the rest. |
| `track` | `core` | |
| `rev` | `1` | |
| `source_kind`, `source_license`, `source_attribution`, `source_url`, `source_retrieved_at`, `krdict_target_code` | `ctx.defaultSource` | If `source_kind` is blank, the item gets `ctx.defaultSource` (any other source columns you fill in override it). If `source_kind` is filled in, the source comes only from these columns. **Any license other than `original-owned` requires an attribution.** |

## Question columns (vocab, grammar, expression)

| column | default |
|---|---|
| `question_types` | `meaning\|production`, plus `cloze` when `cloze_sentence` is set |
| `meaning_accepted` | vocab: `meanings`; grammar and expression: `meaning` (used only when `meaning` is a question type) |
| `meaning_rejected` | — |
| `production_prompt` | vocab: the meanings joined with `; `; grammar and expression: `meaning` |
| `production_hint` | — (`contextHint`) |
| `production_accepted` | the headword |
| `production_rejected` | — |
| `cloze_sentence` | one optional cloze prompt (id `c1`); the sentence must contain exactly one `{{}}` |
| `cloze_answer` | accepted answers, `a\|b` |
| `cloze_en`, `cloze_cue` | required when there is a cloze |
| `cloze_tolerance` | `none` (or `allomorph`, `loose`) |
| `cloze_near_miss` | `answer::hint\|…` |
| `questions_json` | JSON for prompts the columns can't express: **nuance, register, several clozes, `spacingStrict`**. For example `{"nuance":[{"id":"n1","situation":"…","options":[…]}]}`. A question type given both in a column and in `questions_json` is an error. |

## Vocab (`vocab.csv`)

| column | notes |
|---|---|
| `word` | **required** |
| `meanings` | **required**, `a\|b` (`meaning` also works as the column name) |
| `pos` | **required** (e.g. `명사`, `동사`) |
| `register` | `neutral` (or `formal`, `written`, `spoken`, `slang`) |
| `hanja` | `결:決\|정:定`. Each syllable links to `h:<char>` when that hanja exists already, so **import hanja before the vocab that uses them**. Write `결:決:-` for no link, or `결:決:h:決` to give the link explicitly. |
| `collocations` | `ko::en\|ko::en` |
| `examples` | `ko::en[::register[::review]]\|…`. Use 2–3 examples. The fourth part, `review`, flags an example `needs_review`. |

```csv
id,level,word,meanings,pos,register,hanja,collocations,examples,question_types,production_hint,tags
,4,결정,decision|determination,명사,neutral,결:決|정:定,결정을 내리다::to make a decision,"결정은 내일까지 미루기로 했다.::We agreed to put off the decision until tomorrow.::written|이제 네가 결정해.::It's your call now.::spoken",meaning|production,a choice that has been made,sino-korean
```

## Grammar (`grammar.csv`)

| column | notes |
|---|---|
| `pattern` | **required**, e.g. `-는 김에` |
| `meaning` | **required** |
| `attachment` | `stem::final::tense::form::example\|…`. stem is `V`, `A`, `N`, `N이다` or `V/A`; final is `vowel`, `consonant`, `ㄹ`, `any` or empty; tense is `present`, `past`, `future` or `any`. Example: `V::any::present::V-는 김에::나가는 김에` |
| `nuance` | required by validation |
| `contrasts` | `g:other-id::how they differ\|…` |
| `examples` | at least 1 |

## Expression (`expression.csv`)

| column | notes |
|---|---|
| `text` | **required** |
| `meaning` | **required** |
| `subtype` | `관용구` (default), `속담` or `사자성어` |
| `hanja_text` | for 사자성어 |
| `literal`, `usage` | required by validation |
| `examples` | at least 1 |

## Hanja (`hanja.csv`)

Required: `char`, `hun`, `eum`, `meanings`, `mnemonic`, and `level`. Hanja take no question
columns, `gating` defaults to `false`, and `unlock_deps` must be empty.

```csv
id,level,char,hun,eum,meanings,mnemonic
,4,定,정할,정,decide|fix|settle,"A roof (宀) over feet that have stopped (正): you settle down and decide to stay."
```

## Validation

Each item must pass `validateItem`. The merged set (existing items plus incoming ones) must
also pass the `validateBundle` checks: references resolve, there are no dependency cycles, a
dep's level is ≤ the item's level, attribution is present, and cloze, nuance and register
prompts are well formed. If an item is rejected, any item that depends on it is rejected too.

**Draft tolerance:** for items whose `source.kind` isn't `original` (`user`, `krdict`, `import`),
the example-count rules (2–3 examples for vocab, at least 1 for grammar and expressions) are
**warnings**, so you can save a draft and add examples later. Seed (`original`) content stays strict.

Other warnings include an import that replaces a built-in item, and the hanja reading
mismatches already accepted in D40.

## JSON

`importJson(text, ctx)` accepts a `ContentBundle` (like `dist/content.bundle.json`), a bare
`Item[]`, `{ "items": [...] }`, or a single item object. Missing base fields are filled in:
`source`, `track`, `rev`, `tags`, `unlockDeps`, `needs_review`, `gating`, and the empty
`collocations`, `examples` and `contrasts` lists. A missing `id` is generated as for CSV. Issue
`row` is the item's 1-based position in the array. `idRedirects` are ignored, with a warning.
JSON is the only way to author nuance and register prompts in full (or use `questions_json` in CSV).

`importItems(items, ctx)` runs the same validation on items that are already built, such as a
KRDict draft after you edit it.

## KRDict

`parseKrdict(text)` (or `parseKrdictXml`) reads:

1. **Open API search responses**: `<channel><item><target_code/><word/><sup_no/><pos/><link/><sense><definition/><translation><trans_lang/><trans_word/><trans_dfn/>…`. Use `translated=y&trans_lang=1` to get English.
2. **Open API view responses**: the same fields under `<word_info>` and `<sense_info>`.
3. **The downloadable dictionary in LMF XML**: `<LexicalEntry att="id" val="…">` with `feat`
   `partOfSpeech`, `<Lemma><feat att="writtenForm"/>`, `<Sense><feat att="definition"/>`, and
   `<Equivalent>`. The English equivalent's `lemma` and `definition` are used.
4. **JSON** in either shape.

The reader is a small tolerant XML parser (no `DOMParser`). It handles entities, CDATA,
comments and unclosed tags, and never throws. An API `<error>` response is returned as `error`.

Each sense becomes one `KrdictSense`. `krdictToVocab(sense, { level, retrievedAt, idHint? })`
turns a sense into a **draft** vocab item:

- `needs_review: true`, `gating: false`, tag `krdict`
- source: `{kind:'krdict', license:'CC-BY-SA-2.0-KR', attribution:'한국어기초사전 (국립국어원)', url, retrievedAt, krdictTargetCode}`
- `meanings` come from `trans_word` split on `;` and `,` (or from `trans_dfn` if there is no `trans_word`). The Korean definition becomes the production `contextHint`.
- When 원어 lines up with the word (決定 for 결정, or 決定하다 for 결정하다), the item gets a `hanjaBreakdown` (unlinked).
- `examples` start empty, which validation reports as a warning. Add your own examples.

**Browser access:** the KRDict API is unlikely to allow cross-origin requests from the app.
Instead, the UI accepts a **file upload**: a saved API response (XML or JSON) or the
downloadable dictionary file. KRDict-derived items live only in your event log and are
**never committed** to the public repo (D15).
