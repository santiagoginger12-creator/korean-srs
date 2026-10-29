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

## Grammar banks L01–L03 (authored 2026-10-28)

Each of the 30 grammar items now has 9 cloze prompts, 2 nuance prompts, and (for the 10 items that had one) 2 register prompts. Two items are flagged for a native check:

| item id | field | concern | suggestion |
|---|---|---|---|
| g:는-바람에 | `questions.nuance[n2]` option b | The distractor rests on the claim that 바쁜 바람에 (adjective + 바람에) is ungrammatical. Grammars describe -는 바람에 as verb-only, but colloquial "바쁜 바람에" does turn up. | If it sounds acceptable to you, soften the why to "sounds off", or swap option b for a different distractor. |
| g:니만큼 | `questions.cloze[c3]` | 머니만큼 (멀다 + -(으)니만큼, ㄹ-drop) is correct by rule, but natives may prefer 먼 만큼 here. It's the only ㄹ-stem in the bank. | If 머니만큼 sounds stilted, change the stem (e.g. 힘들다 → 힘드니만큼) and keep the ㄹ-drop nearMiss. |


## HTSK grammar L05–L07 (authored 2026-10-28)

37 new grammar items covering the untaught points of HowtoStudyKorean Units 5–6 (Lessons 103–148). Each has 8–9 cloze prompts, 2 nuance prompts, and 7 have a register prompt. Three items are flagged for a native check:

| item id | field | concern | suggestion |
|---|---|---|---|
| g:나-보다 | `nuance`, `questions.cloze[c3]` nearMiss | Treats adjective + -나 보다 (바쁘나 봐요) as nonstandard and grades it **close**. That follows the 표준국어대사전 entry for the ending -나 (verbs, 있다/없다, -었-/-겠-), but the form is very common in speech, and some 국립국어원 Q&A answers are lenient about it. | If you'd accept 바쁘나 봐요 from a student, move it to `accepted` and soften the nuance sentence to "-(으)ㄴ가 보다 is the standard written form". |
| g:었었다 | `questions.cloze[c2]`, `questions.nuance[n1]` | c2 accepts 있었었어요 with "작년까지만 해도"; some speakers find 있었었다 redundant there. n1 rests on 결혼했어 = "still married" vs 결혼했었어 = "no longer married". | If 있었었어요 grates, swap c2 to a verb (다녔었어요). Confirm the n1 contrast holds for you. |
| g:다니 | `nuance`, `questions.cloze[c1, c6, c7]` nearMiss | The item separates bare-stem -다니 (reacting to a fact: 그런 짓을 하다니) from quoted -ㄴ/는다니 (g:ㄴ다니, reacting to what was said: 한다니). The nearMiss hints grade 한다니 / 합격한다니 / 만든다니 **close** in fact-reaction frames. In a context with no hearsay, a native may hear 한다니 as equally fine. | If you'd use -ㄴ/는다니 freely for plain surprise, drop those three nearMiss entries (or move them to `accepted`) and loosen the nuance sentence. |

**Schema friction (for the Architect):** there is no structured reference field, so the HTSK cross-reference lives in two places: tags (`htsk:<lesson>`, `htsk-unit:<n>`) and the last sentence of `nuance` ("See also HowtoStudyKorean Lesson N."). An optional `refs: {source, id, title?, url?}[]` on ItemBase would let the UI link it without parsing prose. Also, the single `meaning` string can't hold the per-reading split for multi-use patterns (-지 뭐, -(으)ㄹ 만하다), so those use numbered glosses.
