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

## Grammar QA (L01–L03, L05–L07, 2026-10-29)

**Status:** all 5 author flags above are resolved, and every grammar `needs_review` is cleared. Details (before → after) are in REVIEW_LOG.md under "Grammar QA". Short version: 바쁜 바람에 distractor → swapped for a -느라고 meaning error · 머니만큼 → 힘드니만큼 · 있었었어요 → 다녔었어요, and the n1 결혼했었어 contrast is confirmed · 바쁘나 봐요 stays **close** with a softer hint · 한다니 / 만든다니 stay **close**, with hints that now call them "also natural if reacting to what you were told". Two questions remain for the owner:

| item id | field | question (yes/no) | if yes / if no |
|---|---|---|---|
| g:나-보다 | `questions.cloze[c3]` nearMiss 바쁘나 봐요 | Should the app keep grading adjective + -나 보다 (바쁘나 봐요) as **close** (standard-first), not correct? | Yes: no change. No: move 바쁘나 봐요 to `accepted` and drop "the standard form" from the nuance. |
| g:지-뭐 | `questions.cloze[c2]` nearMiss, `questions.nuance[n2]` option c | Do you treat 했지 뭐요 as wrong in the narrative "can you believe it" use (only 했지 뭐예요 is right)? | Yes: no change. No: move 했지 뭐요 to `accepted` and rewrite n2 option c to a meaning error. |

## Frequency vocab L05–L10 (authored 2026-10-28/29)

240 new vocab items (`track: "vocab-freq"`), 40 per level, drawn in rank order from the owner's never-drilled Anki gap (ranks ~5,100–6,730). Four items are flagged for a native check:

| item id | field | concern | suggestion |
|---|---|---|---|
| v:골머리 | `meanings`, `questions.meaning` | The noun lives almost entirely inside 골머리를 앓다 / 골머리가 아프다, so a bare-word meaning prompt is awkward. Accepted answers lean on "headache"; the cloze also accepts 골치. | Keep, or drop `meaning` and make it cloze-led like L04 if the bare gloss feels artificial. |
| v:공연히 | `register` | Tagged `written` as the fuller, more literary 괜히. It also occurs in older speakers' speech, and spoken example 1 uses it. | Retag `neutral` if it sounds natural in speech to you. |
| v:다짜고짜 | `promptEn`, cloze c1 | Its boundary with 대뜸 (L10) is fine-grained: 다짜고짜 = without asking or explaining, 대뜸 = right off the bat. Both clozes cross-accept the other word. | Confirm that the cross-acceptance is right, or narrow one cloze so it only fits one word. |
| v:대수롭다 | `tags` | No origin tag: I'm not certain whether 대수 is Sino-Korean. Production accepts 대수롭다 and 대수롭지 않다. | Add `native` or `sino-korean` if you know. |

## Vocab QA (L05–L10, L01–L03 mnemonics, 2026-10-29)

**Status:** the four author flags above are handled, and every vocab `needs_review` is cleared. Details (before → after) are in REVIEW_LOG.md under "Vocab QA". Short version:
- 골머리: now cloze-led, with no `meaning` question; 골치 is graded close.
- 공연히: stays `written`, and 괜히 is graded close.
- 다짜고짜 / 대뜸: each cloze grades the other word close. 다짜고짜 doesn't fit the 대뜸 frame, and the hint says why.
- 대수롭다: the content is fine; the tag question is below.

Also: 개봉하다 and 초과하다 were swapped for 반박하다 and 약탈하다. In 24 clozes, synonyms that had been graded correct (자부심 for 긍지, 갑자기 for 난데없이…) are now graded close.

Three questions remain for the owner:

| item id | field | question (yes/no) | if yes / if no |
|---|---|---|---|
| v:대수롭다 | `tags` | Is the 대수 in 대수롭다 the Sino-Korean 大數 of "그게 대수야?" (표준 대수 「2」 '대단한 것')? | Yes: add `sino-korean` (no breakdown needed for a -롭다 word). No: add `native`. |
| L05–L10 clozes | `nearMiss` | Should a real synonym typed into a headword-cued cloze (자부심 for 긍지, 대답 for 대꾸, 결국 for 급기야) be graded **close** with "also fits; the cue asks for X", not correct? | Yes: no change. No: move those 25 forms back to `accepted` (list in REVIEW_LOG). |
| v:출동하다, v:추락하다, v:참견하다, v:복용하다, v:임명되다 (L05) | selection | Are these too basic to be worth drilling, like the two words already swapped (개봉하다, 초과하다)? | Yes: swap each for the next candidate in rank order (the L05 band is thin; candidates may come from the L06 range). No: keep them. |

## Owner rulings (2026-10-30). All open rows above are closed.

- g:나-보다: **keep** 바쁘나 봐요 as close (standard-first).
- g:지-뭐: **keep** 했지 뭐요 as wrong in the narrative use; only 했지 뭐예요 is correct.
- L05–L10 clozes: **keep** synonyms typed into a headword-cued cloze as close ("also fits; the cue asks for X").
- 출동하다, 추락하다, 참견하다, 복용하다, 임명되다: **keep**. They are not too basic.
- v:대수롭다: **no origin label.** The item stays untagged, with no hanja annotation.

## Practical starter levels L01–L03 (authored 2026-10-30)

The niche Sino-Korean starter set is now L11–L13 (ids unchanged). New L01–L03 hold 120 common words from the owner's Anki leeches. Four items are flagged for a native check:

| item id | field | concern | suggestion |
|---|---|---|---|
| v:경우 | `examples[1]`, `meanings[1]` | The second example teaches 경우가 없다 ("has no sense of decency"), on the guess that this sense is behind the 49 misses. It may be too marked for a starter item. | If the misses are really about -는 경우 (case), swap examples[1] for a second "case" sentence and drop the sense from meanings. |
| v:겨우 | cloze c1 | The cloze targets "only, a mere" (겨우 세 개), and examples[0] covers "barely". It's a guess which sense causes the misses. | If "barely" is the problem sense, change c1 to a 겨우 시간에 맞추다-type frame with 간신히 as nearMiss. |
| v:십상 | `meanings`, tags | Only the -기 십상이다 sense is taught. There is no hanja breakdown or origin tag, since I'm not certain 十常 covers both senses (표준 also lists a "just right" 십상). | If 十常 is right for this sense, add `sino-korean` and the breakdown. |
| v:지나치다 | `pos`, `meaning` | One item covers both the adjective (excessive) and the verb (pass by). `pos` is 형용사·동사, `meaning` accepts both senses, and production and cloze target "excessive". | If you'd rather split it, make it two sense items (v:지나치다:excessive / :pass), following the L04 pattern. |

## Starter QA (2026-10-30)

**Status:** all four author flags above are resolved, and every L01–L03 `needs_review` is cleared (details in REVIEW_LOG.md under "Starter QA"). In short: 경우 is kept as is (경우가 없다 is everyday speech). 겨우 gets a second cloze, so both "barely" and "a mere" are tested. 십상 is tagged 十常 (표준 십상팔구 sense) and catches the misspelling 쉽상. 지나치다 stays one item with `pos` 동사, since 표준 has one 동사 headword for both senses.

One question remains for the owner:

| item id | field | question (yes/no) | if yes / if no |
|---|---|---|---|
| v:서두르다, v:우연히, v:혼나다, v:망치다, v:자녀, v:편찮다 | selection | These are TOPIK-I-level words. Keep them in the starter set because they're proven Anki leeches? | Yes: no change. No: swap each for the next unused candidate in data-private/starter-candidates.tsv. |
