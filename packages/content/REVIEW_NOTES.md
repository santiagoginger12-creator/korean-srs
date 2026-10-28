# Content review notes (owner queue)

Items the QA & Linguistic Review agent could not clear on its own (D15). One row per concern. Clear the item's `needs_review` once resolved.

**Status (QA pass, 2026-10-23):** the queue is empty. The QA agent resolved all 7 author-flagged items and the 변죽을 울리다 / 얼버무리다 gloss overlap, and cleared their `needs_review`. Every edit is listed in `REVIEW_LOG.md` with before → after, so the per-level skim can start there. The five rewritten nuance explanations and the two replaced distractors (g:고-말다 n1, g:는-양 n1) are the parts most worth a native glance.

| item id | field | concern | suggestion |
|---|---|---|---|
| — | — | (none open for L01–L03) | — |

## L04 (native-verb track, authored 2026-10-28)

**Status (L04 QA pass, 2026-10-28):** all 3 author flags are resolved and their `needs_review` is cleared. Details are in REVIEW_LOG.md under "L04 QA".
- **v:맞추다:check c1:** swapped to 카드 명세서와 영수증을 맞춰 보다. Owner: if you'd say 번역 원고를 원문과 맞춰 보다 yourself, the original frame can come back.
- **v:돌아보다:tour:** kept as a distinct sense (표준 「3」, 현장을 돌아보다). c2 moved from the expo hall (which is 둘러보다) to a guard's patrol round.
- **v:메다:choke c2:** kept. 목이 메다 for food is everyday usage, and it drills the same spelling, 메어.

| item id | field | concern | suggestion |
|---|---|---|---|
| — | — | (none open for L04) | — |

**Schema friction (for the Architect, not the owner):** vocab has no sense-sibling relation (`contrasts` is grammar-only), and the `meaning` prompt shows only `headword(item)`. Two senses of 걸치다 therefore look identical in a meaning review, and a sibling's gloss is graded "meaning of a different word". L04 works around this: there is no `meaning` question on multi-sense items, and siblings are linked through `verb:<word>` tags plus `guru` deps. A fix would be an optional `senseHint` on VocabItem, shown under the headword, plus vocab `contrasts` or `siblings` read by `relatedItems`.
