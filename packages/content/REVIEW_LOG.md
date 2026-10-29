# QA & Linguistic Review log: seed L01–L03

This file lists the QA & Linguistic Review agent's edits to `seed/`, grouped by level and item id. Each entry gives the field, before → after, and the reason. Ids, `rev`, and schema are unchanged. The validator reports 0 errors and the answer self-check passes (1355 cases, 0 failures).

Tags: **[N]** naturalness · **[A]** accuracy · **[G]** grammar claim · **[Q]** gradeability · **[S]** spelling/usage · **[C]** content-rule risk · **(flag)** resolves a REVIEW_NOTES row

Totals: 33 items edited. N 9 · A 4 · G 9 · Q 8 · S 2 · C 1 (counted by primary category).

---

## L01

**v:얼버무리다** [Q] (flag: x:변죽을-울리다 row)
- `questions.meaning.accepted`: removed "beat around the bush". That idiom now maps only to x:변죽을-울리다; 얼버무리다 means equivocating or dodging, not hinting.
- `examples[2].en`: "Don't beat around the bush. Just tell me honestly." → "Stop dodging the question and just tell me honestly."

**v:식별** [N]
- `examples[1]`: 쌍둥이라 처음엔 누가 누군지 식별이 안 되더라고요. (spoken) → 안개가 너무 짙어서 바로 앞차도 식별이 안 될 정도였어요. (neutral). In casual talk about twins people say 구별/구분; 식별 belongs to visual "making out".

**v:신경전** [N]
- `examples[1].ko`: 신경전하다가 → 신경전을 벌이다가. 신경전하다 isn't a verb; the collocation is 신경전을 벌이다.

**v:미제-사건** [N]
- `examples[0]`: 삼십 년 넘게 장기 미제 사건으로 남아 있던 사건의 범인이… → 장기 미제 사건으로 남아 있던 이십 년 전 강도 살인의 범인이 DNA 재감정으로 붙잡혔다. The original repeated 사건 (미제 사건으로 남아 있던 사건). The English gloss was updated to match.

**v:머쓱하다** [N]
- `examples[1]`: 분위기가 머쓱해졌어 → 괜히 머쓱해졌어 ("I felt kind of silly"). 머쓱하다 describes the person; for the room it's 어색해지다/썰렁해지다.

**v:식견** [N]
- `examples[1]`: 짧은 식견이지만 말씀드리자면, 이 계획은 너무 서두르는 것 같습니다. → 제 짧은 식견으로는 이 계획이 다소 성급해 보입니다. The humble formula is 제 짧은 식견으로는.

**v:구축** [N]
- `examples[1]`: …신뢰부터 쌓으려고 애썼고, 그렇게 구축한 관계가 큰 힘이 됐다. → 새 팀장은 부임하자마자 팀원들과 신뢰 관계를 구축하는 데 공을 들였다. The original read as translationese, and it used 쌓다 and 구축 for the same thing.

**g:는-통에** [G] (flag)
- `nuance`: "It is more colloquial than -는 바람에 and -(으)ㄴ/는 탓에 and often carries a note of irritation." → "It is at home in everyday speech and often carries a note of irritation or exasperation." The register ranking was dropped. Both 바람에 and 통에 are everyday forms, and ranking them isn't defensible.
- `needs_review`: true → false.

**g:더라도** [G] (flag)
- I confirmed that 좀 비쌀망정 택시 타자 is unnatural. The reason is register and stance (망정 is a principled or literary concession), not a hard ban: literary advice like 가난할망정 비굴하게 살지는 마라 does occur.
- `contrasts[0].note`: "…doesn't sit naturally before a request or suggestion." → "…it is somewhat literary and sounds stilted before an everyday request or suggestion."
- `cloze c1 nearMiss 바쁠망정 hint`: rewritten on the same basis.
- `nuance n1 option b why`: rewritten as "…Leading into an offhand practical suggestion like 택시 타자, it sounds stilted; -더라도 or -아/어도 is what people actually say."
- `needs_review`: true → false.

**g:ㄹ망정** [G] (flag)
- `nuance`: dropped the claim that -(으)ㄹ지언정 is interchangeable only in use (1). It now reads "…it rarely leads into an everyday request. It is a near-synonym of -(으)ㄹ지언정, which sounds more emphatic and bookish." 피곤할지언정 마음은 편하다 is fine too.
- `contrasts[0].note`: "Interchangeable in the 'I'd sooner X than Y' use; …" → "Near-synonyms in both uses; -(으)ㄹ지언정 sounds more emphatic and bookish."
- `cloze c1 nearMiss 피곤할지언정 hint`: "Also heard; … the more usual choice for 'X, but at least Y'." → "Also correct (a near-synonym, a bit more emphatic); the cue asks for -(으)ㄹ망정."
- `needs_review`: true → false.

**g:ㄹ지언정** [G][N]
- `contrasts[0].note`: "…also covers 'X, but at least Y'." → "Near-synonym in both uses; -(으)ㄹ망정 is a little less emphatic and more conversational." This keeps it consistent with g:ㄹ망정.
- `cloze c1.sentence`: 마음에도 없는 사람과는 → 마음 안 맞는 사람과는. 마음에도 없는 collocates with 말 (insincere words), not with a person. The English gloss was updated to match.

**x:사공이-많으면-배가-산으로-간다** [Q]
- `questions.meaning.accepted`: added "too many cooks in the kitchen".

## L02

**v:곤혹스럽다** [S]
- `collocations[1]`: 곤혹을 치르다 → 곤혹을 느끼다 ("to feel perplexed and uncomfortable"). 곤혹을 치르다 is a well-known misuse; the standard collocation is 곤욕(困辱)을 치르다.

**v:되레** [A]
- `register`: spoken → neutral. 되레 is the standard short form of 도리어 and is very common in news headlines.
- `production.promptEn`: dropped ", colloquial".
- `production.contextHint`: "spoken short form of 도리어" → "short form of 도리어, common in speech and headlines".

**v:오롯이** [N]
- `examples[1]`: 그 영화는 주연 배우의 연기에 오롯이 기대고 있다. → 그 영화는 원작의 쓸쓸한 정서를 화면에 오롯이 담아냈다. "오롯이 기대다" is translationese for 전적으로 기대다; 오롯이 means whole and undiminished (오롯이 담다/느끼다).

**g:니만큼** [Q]
- `cloze c1.nearMiss`: added 참석하시는 만큼, the obvious sibling answer, with the hint "Also natural (-는 만큼 'since', spaced); the cue asks for -(으)니만큼, written as one word."

**g:는-셈이다** [Q]
- `cloze c1.accepted`: added 붙은 셈이야. The blank is sentence-final and nothing in the sentence forces 해라체.

**g:기-마련이다** [Q]
- `cloze c1.accepted`: added 서툴기 마련이야 and 서툴기 마련이에요 (sentence-final blank).

**g:는-법이다** [Q]
- `cloze c1.accepted`: added 멀어지는 법이야 (sentence-final blank).

**g:기-십상이다** [G] (flag)
- `nuance`: "Not used for good outcomes; …" → "Attached to a good outcome it sounds off, even sarcastic; …". The first sentence already said "almost always undesirable".
- `nuance n1 option b why`: "is reserved for likely unwanted outcomes" → "is used almost exclusively for likely unwanted outcomes; attached to a good result like improving, it sounds off, even sarcastic." I kept the option because 실력이 늘기 십상이야 is unnatural.
- `needs_review`: true → false.

**x:도마-위에-오르다** [Q]
- `questions.meaning.accepted`: removed "be on the chopping block". That phrase means "about to be cut or eliminated", not "under fire".

**x:아전인수** [N]
- `examples[1]`: 회의록을 완전히 아전인수로 읽고 있잖아 → 회의록을 완전히 아전인수 격으로 해석하고 있잖아. The idiomatic frames are 아전인수 격으로 and 아전인수식으로 + 해석하다. The English gloss was updated to match.

## L03

**v:관성** [A]
- `collocations[1]`: 관성에 젖다 ("steeped in old habits") → 관성에 따라 움직이다 ("to keep going out of sheer inertia"). The set idiom is 타성(惰性)에 젖다.

**v:하물며** [C]
- `examples[1]`: 동물도 제 새끼는 아끼는데 하물며 사람이야 말할 것도 없지. (neutral) → 평소에도 주차할 데가 없는 동넨데, 하물며 명절 연휴야 말할 것도 없지. (spoken). The "짐승도 제 새끼는…" frame is a stock dictionary and textbook sentence.

**v:떠넘기다** [A]
- `register`: spoken → neutral. 책임을 떠넘기다 is standard in news writing.
- `production.contextHint`: "colloquial counterpart of 전가하다" → "everyday counterpart of 전가하다".

**g:ㄴ-나머지** [N][S]
- `examples[1]`: 기쁜 나머지 합격 소식을 듣자마자 부모님께 전화부터 드렸다. → 합격 소식을 듣고 너무 기쁜 나머지 도서관 한복판에서 소리를 지르고 말았다. In the original, the joy was placed before the news that caused it, and calling one's parents isn't an overflow with an unintended result.
- `contrasts[0].note`: (참다 못해, → (참다못해,

**g:다-못해** [S]
- 참다못해 and 보다못해 are adverbs in 표준국어대사전 and are written closed up.
- `attachment[0].example`: 참다 못해 → 기다리다 못해. This shows the productive pattern with a verb that isn't lexicalized.
- `nuance`: 보다 못해 한마디 했다 → 보다못해 한마디 했다. "…also written as single words; both spellings are common." → "…are adverbs in 표준국어대사전 and are written closed up; elsewhere keep the space (기다리다 못해, 지루하다 못해)."
- `examples[0]`: 참다 못해 → 참다못해.
- `cloze c1.accepted`: reordered to ["보다못해", "보다 못해"] so the revealed answer is the normative spelling. The nearMiss hint now says "set word is 보다못해".
- `nuance n1 option a`: 참다 못해 → 참다못해.

**g:ㄹ-지경이다** [Q]
- `cloze c1.accepted`: added 막힐 지경이었어 and 막힐 지경이었어요 (sentence-final blank).

**g:어-버리다** [G] (flag)
- I confirmed that 그냥 지원하고 말아! is unnatural as a breezy push. `nuance n1 option b why` → "-고 말다 is about an outcome reached despite resistance, or one's own resolve. As a breezy 'just do it' push to someone else it sounds unnatural; its imperative turns up only in solemn exhortations (꼭 이기고 말아라)."
- `needs_review`: true → false.

**g:고-말다** [G][Q] (flag)
- `nuance`: "It isn't used for brisk commands or suggestions to others." → "It doesn't work as a brisk 'just do it' command or suggestion; an imperative turns up only in solemn exhortations (꼭 이기고 말아라)."
- `nuance n1 option b`: 다음엔 무슨 일이 있어도 합격해 버릴 거야. (heard jokingly, so "wrong" was contestable) → 다음엔 무슨 일이 있어도 합격하고 말았어. The new why: "-고 말았다 reports an outcome already reached (use 1). A vow about next time needs the resolve form, -고 말 거다 or -고 말겠다." It now tests the item's own two uses instead of a register judgment.
- `cloze c1.accepted`: added 내고 말았어 and 내고 말았어요.
- `needs_review`: true → false.

**g:다시피** [A]
- `attachment`: added the past form { V, past, V-았/었다시피, 말씀드렸다시피 }. The nuance already cites 말씀드렸다시피.

**g:듯이** [G]
- `contrasts[1].note`: "but suggests a false or presumptuous pose" → "but often suggests…". This keeps it consistent with g:는-양.

**g:는-양** [G] (flag)
- `nuance`: removed the claim that it "doesn't describe neutral appearances such as the weather". The new text reads "It is mostly about people's poses and attitudes; literary prose can extend it to things (꽃잎이 춤추는 양 흩날렸다), but for an everyday 'looks like (rain)', -(으)ㄹ 듯하다 or -(으)ㄴ 것 같다 is the natural choice."
- `nuance n1`: replaced the weather prompt, which depended on the contested restriction, with one on the item's core sense, a presumptuous pose. The situation is a new hire lecturing seniors as if he knew the company inside out:
  - a ✓ 그는 회사 사정을 다 아는 양 선배들을 가르치려 들었다.
  - b ✗ …다 알다시피… (-다시피 = shared knowledge or "practically")
  - c ✗ …다 아는 둥 마는 둥… (half-hearted action)
- `needs_review`: true → false.

---

### Reviewed and left as is (for the owner's skim)
- 30 hanja: every 훈음 matches the standard 대표훈음, including 更 고칠 경/다시 갱 and 殺 죽일 살/감할 쇄. The 5 validator warnings (論→논, 更→갱, 殺→쇄) are correct 두음법칙 or alternate readings.
- -(으)ㄹ뿐더러 is written attached in every field, with `spacingStrict` set on the cloze. -(으)ㄴ/는 데다가 and -(으)ㄴ/는 듯이 are spaced, and -듯(이) after a stem is attached.
- 갱신/경신: kept the 기록 = 경신, 계약 = 갱신 split and its rejected lists.
- 조는 바람에: did not add 졸던 바람에. -는 바람에 does not take -던.

---

## L04 (author self-pass, 2026-10-28)

L04 is the **native-verb track**: 64 vocab items (`track: "native-verb"`) covering 56 senses of 30 high-lapse native verbs (from the owner's Anki leech list) plus 8 discourse adverbs. Everything is original. The author wrote the level, then did an independent linguistic re-read; the edits are below. Validator: 0 errors. Self-check: 1931 cases, 0 failures.

**Conventions used.**
- Sense ids follow `v:<word>:<sense>`.
- Senses that share a headword are linked by `tags` (`verb:<word>`, `sense:<name>`) and by `guru` unlockDeps (sense 2 depends on sense 1, sense 3 on sense 2), so two senses of one verb never land in the same lesson batch.
- Third senses are `gating: false` (걸치다:perch, 맞추다:order, 빠지다:drain, 이르다:early).
- Multi-sense items have **no `meaning` question**: the meaning prompt shows only the headword, so it can't say which sense it wants (see the schema-friction note in REVIEW_NOTES). They use cloze + nuance instead.
- Adverb cloze cues give 초성 plus a sense hint (e.g. ㅁㅊ · (not) in time), because a cue that showed the word itself would give the answer away.

**Self-pass edits** (before → after):

**v:맞추다:adjust** [N]
- `examples[0]`: …맞춰서 해야지, 전문 용어만 늘어놓으면 소용없어요. → …맞춰서 해야 해요. 전문 용어만 늘어놓으면 소용없어요. One sentence was mixing 반말 (해야지) with 해요체.

**v:맞추다:order** [Q]
- `cloze c2`: 기성복은 어깨가 안 맞아서 아예 정장을 한 벌 맞춰 입기로 했다 → 엄마 환갑 선물로 금반지를 하나 맞춰 드렸다. The old c2 repeated the nuance situation, and 맞춰 입다 can also be read as "dress to match".

**v:걸치다:span** [G]
- `nuance n1`: replaced the distractor 반세기를 거친 연구, because 거치다 with a time span is attested (오랜 세월을 거쳐 형성된). The new distractors test the frame instead: 반세기에 걸린 연구 (걸리다 needs the time as subject: 반세기가 걸린) and 반세기를 걸친 연구 (the span sense takes 에).

**v:건지다:fish-out** [A]
- `nuance n1 option c why`: tightened. 거르다 = strain a liquid / skip a meal; lifting solids out one by one is 건지다.

**v:이루다:achieve** [N]
- `cloze c2`: 작은 성공을 여러 번 이뤄 보면 → 작은 목표라도 하나씩 이뤄 가다 보면. 성공 collocates more naturally with 거두다; 목표를 이루다 is the core frame.

**v:넘어가다:fall-for** [G]
- `cloze c2.accepted`: removed 넘어갈래. Falling for something isn't volitional, so 안 넘어갈래 is odd.

**v:세우다:draw-up** [N]
- `cloze c1`: 장마다 마감일을 따로 세워 → 장마다 세부 일정을 따로 세워. Deadlines are 정하다, not 세우다; 일정을 세우다 is the frame.

**v:이르다:reach** [N]
- `cloze c1`: 숨을 헐떡이며 정상에 이르러 보니 구름이 걷혀 있었다 → 산 정상에 이르러서야 바다가 보였다. 이르러 보니 is stilted. accepted: 이르러서야 / 이르러서 / 이르러. nearMiss: 일러서야.

**v:이르다:tell** [A]
- `register`: spoken → neutral. 누누이 이르다 / 일러 주다 are at home in writing too.

**v:짓다:conclude** [A]
- `examples[0].register`: spoken → neutral (…매듭을 짓고 퇴근합시다).

### Reviewed and left as is (for the owner's skim)
- **Spacing checked against 표준국어대사전 single-word entries:** 돌려보내다, 들어주다, 내려놓다, 넘어가다, 결론짓다, 매듭짓다, 데려다주다, 장사진, 한잔.
  - 들어주다 is one word only in the "grant" sense. The "listen to (someone)" use is 듣다 + -어 주다 and is spaced (들어 주다); this is recorded in the item's mnemonic. That is why there's no separate 들어주다:listen item.
  - 마무리 is only ever used with a particle (마무리를 짓다), so whether 마무리짓다 is one word never comes up.
- **Irregular forms are drilled through nearMiss** (18 entries): 이르다 러/르 (이르러 vs 일러), 들르다/들리다 (들러 vs 들려), 메다/매다, 짓다/짖다, 왠지/웬지, 굳이/구지, 빌다/빌리다, 메어/메여.
- **사랑에 떨어지다** is used as a nuance distractor and labelled a calque. Its "why" avoids "never".
- **고인의 명복을 빕니다** is a fixed condolence formula. It is kept as an example because the frame itself is the target.

## L04 QA (independent review, 2026-10-28)

An independent re-read of all 64 L04 items by the QA & Linguistic Review agent, as a native-speaker editor. Ids, `rev`, schema and unlock graph are unchanged. Validator: 0 errors. Self-check: 1949 cases, 0 failures. All 3 author flags are resolved, and the L04 queue in REVIEW_NOTES is empty.

Totals: 24 items edited. N 6 · A 5 · G 3 · Q 9 · flag-only 1 (counted by primary category).

**v:맞추다:check** [N] (flag)
- `cloze c1`: 번역 원고와 원문을 한 줄씩 맞춰 보면서 빠진 문장이 없는지 → 카드 명세서와 영수증을 한 장씩 맞춰 보면서 빠진 내역이 없는지. 맞춰 보다 for a translation is fine colloquially, but in the owner's own field the professional word is 대조하다, so the frame invites second-guessing. The receipts frame is unambiguous. `en` updated to match. `needs_review` cleared.
- Left as is: this item merges two 표준 senses (조각을 맞추다 "fit together" and 답을 맞추다 "compare"). Both are clozed (c2 / c1) and the nuance tests "compare", so the merge is workable.

**v:돌아보다:tour** [N] (flag)
- Kept. 표준 돌아보다 「3」 (여기저기 두루 돌아다니며 살피다) is a distinct, high-frequency news sense (현장을 돌아보다). It differs from 둘러보다: 돌아보다 = move from site to site and check; 둘러보다 = look around one place or browse.
- `cloze c2`: 주말에 박람회장을 천천히 돌아보며 볼 만한 부스를 적어 두었다 → 경비원은 밤 열 시가 되면 층마다 한 바퀴씩 돌아보며 문이 잠겼는지 확인한다. The author was right that browsing an expo hall is 둘러보다; a patrol round is unambiguously 돌아보다. cue: make the rounds of → make the rounds. accepted: 돌아보며 / 돌아보면서 / 돌아보고 / 돌아보고서.
- `cloze c1.accepted`: + 돌아보셨다 / 돌아보셨어요 / 돌아보셨습니다 (honorific for 시장 in speech).
- `mnemonic`: added (none) → the 돌아보다 / 둘러보다 contrast above. `needs_review` cleared.

**v:메다:choke** (flag)
- Kept c2 (고구마를 물도 없이 먹었더니 목이 메어서). 목이 메다 for food is everyday native usage (표준 메다¹ 「1」 막히다), and it reinforces the same spelling, 메어. The item's third meaning already names it. `needs_review` cleared.

**v:걸치다:wear** [A]
- `nuance n1 option b why`: "things you slip fingers or hands into: rings, gloves, contact lenses" → "things fitted onto or into a body part: rings, gloves, contact lenses". Lenses aren't slipped onto fingers.

**v:걸치다:perch** [Q]
- `cloze c1.nearMiss`: + 걸터 → "걸터앉다 (one word) paints the same picture, but the cue asks for 걸치다". This is the most likely native answer for "perched on the armrest".

**v:맞추다:adjust** [N]
- `cloze c2`: 시곗바늘을 서울 시간에 맞춰 놓는 걸 → 시계를 서울 시간에 맞춰 놓는 걸. Natives set the 시계, not the hands.

**v:어긋나다:contrary** [A]
- `meanings[3]`: to fall short of (expectations) → to disappoint (expectations). "Fall short of" is 못 미치다. 기대에 어긋나다 is going against the hope, not under-reaching it.
- `collocations[0].en`: to fall short of / go against expectations → to disappoint expectations; to go against what was hoped for.

**v:어긋나다:awry** [Q]
- `cloze c2.nearMiss`: + 엇갈리고. 길이 엇갈리다 is at least as common as 길이 어긋나다; it now gets a hint instead of a flat miss.

**v:갖추다:equip** [G]
- `nuance n1 option b why`: "차리다 is to set out a meal, open a business, or come to one's senses" → "차리다 is for setting something out or up (밥상을 차리다, 가게를 차리다, 격식을 차리다)…". The old list omitted 격식/예의를 차리다, which is a near-synonym of the sibling sense 갖추다:observe.

**v:갖추다:observe** [N]
- `cloze c1.nearMiss`: + 차려 / 차려서 (격식을 차리다 is equally idiomatic).
- `cloze c2`: 어르신께 편지를 쓸 때는 예를 갖춰 쓰는 게 좋다 → 드레스 코드가 있는 자리라서 오랜만에 정장을 갖춰 입고 갔다. 예를 갖춰 쓰다 is stilted, and c1 already used the 갖춰 쓰다 frame. The new c2 drills 정장을 갖춰 입다 from the collocations. cue: show (due respect) → dress (properly). accepted: 갖춰 / 갖추어.

**v:대다:cite** [G]
- `nuance n1 option a why`: "An excuse is always 핑계를 대다." → "Making an excuse is 핑계를 대다." (D39: no absolutes).
- `nuance n1 option b why`: "…but not 핑계." → "…With 핑계 the verb is 대다; 핑계를 들다 sounds off." 핑계를 들어 is sporadically attested, so "not" overstated it.
- `cloze c1.accepted`: + 대기에 / 대기. 핑계 대기에 바빴다 is at least as natural as 대느라 바빴다.

**v:끼다:settle** [A]
- `cloze c2.en`: "…tiles that had gotten scaly with grime" → "…gave the bathroom tiles, crusted with soap scum, a hard scrub." 물때 is soap scum or limescale.
- `nuance n1 option a why`: "Fog, cloud, dust and grime 끼다" → "…take 끼다" (grammar of the English).

**v:빌다:wish** [Q]
- `cloze c2.accepted`: + 빌겠습니다.

**v:들어주다:grant** [N]
- `cloze c2`: 무리한 조건을 다 들어주면서 → 무리한 요구를 다 들어주면서. 조건 collocates with 받아들이다/수용하다; 요구를 들어주다 is the core frame. cue: accept (demands) → give in to (demands). `en` updated.

**v:내놓다:release** [Q]
- `cloze c1.accepted`: + 내놨는데 / 내놓았는데.

**v:놀리다:tease** [Q]
- `cloze c2`: 놀리려는 건 아니었는데, {{}} 것처럼 → 장난으로 한 말인데, {{}} 것처럼. The old sentence printed the answer's stem next to the blank. `en` updated.
- `collocations[1].ko`: 말투를 놀리다 → 말투를 가지고 놀리다. The bare object sounds clipped; natives say "X 가지고 놀리다".

**v:놀리다:idle** [Q]
- `cloze c1.accepted`: + 놀리기가.

**v:넘어가다:let-slide** [Q]
- `cloze c1.accepted`: + 넘어가시죠 / 넘어갈까요 (the usual chair's phrasing in a meeting).

**v:넘기다:overrun** [G]
- `nuance n1 option b why`: "넘어가다 is intransitive here: the deadline is its subject…, not its object." → "With a person as subject, missing a deadline is transitive 넘기다. 넘어가다 makes the deadline the subject (마감이 넘어갔다)." 넘어가다 does take time objects (시간이 자정을 넘어갔다), so "intransitive" was too strong.

**v:넘기다:pull-through** [Q]
- `cloze c1.accepted`: + 넘겨서.

**v:이르다:early** [Q]
- `cloze c1.nearMiss`: + 어린 → "어린 나이에 is also natural…". It's the commoner native collocation.

**v:짓다:express** [A]
- `nuance n1 option a why`: "짓다 is ㅅ-irregular: 지어, 지었다." → "A facial expression is 표정을 짓다. 짓다 is ㅅ-irregular…". The old text explained only the form, not why the verb fits.
- `cloze c2.nearMiss`: + 쉬었다 / 쉬셨다. 한숨을 쉬다 is the everyday verb, and the hint says the cue wants the literary 한숨을 짓다.

**v:짓다:conclude** [N]
- `cloze c1`: 원고 작업의 마무리를 짓고 → 원고 마무리를 짓고 (the double genitive was heavy).
- `cloze c2.nearMiss`: + 낼 (결판을 내다 is just as idiomatic).
- **Correction to the author note above:** "마무리 is only ever used with a particle" is not right. 마무리 짓다 without a particle is very common. It isn't a single 표준 entry, so it's spaced (마무리 짓다), and the item still avoids it.

**v:굳이** [A]
- `questions.meaning.accepted`: removed "deliberately". That is 일부러, which is itself on the owner's leech list. Accepting it would reinforce the confusion. It is not added to `rejected`, because the checker's "not this word's meaning" message would overstate it.

### Considered and left as is
- **들어주다 meaning accepts "listen to".** I left it accepted. 보조용언 붙여쓰기 is permitted (맞춤법 제47항), so the string 들어주다 can legitimately read "listen to". The mnemonic's "spaced in careful writing" is accurate (원칙).
- **Cue collision ㅁㅊ:** 미처 and 마침 share 초성. The sense hints ("always with a negative" vs "just then") disambiguate.
- **Stock-frame risk:** 고인의 명복을 빕니다 and 사랑에 빠지다 are fixed formulas, kept because the frame is the target (as the author noted). No other sentence matches a dictionary or textbook stock example closely enough to flag.
- **Spacing spot-checks:** 한잔, 데려다주다, 결혼반지, 잘되다, 빌려주다, 들여놓다 are single 표준 entries and are written solid. 짚고 넘어가다, 짚어 주다, 맞춰 보다 and 마무리 짓다 are spaced.

---

## Grammar banks (L01–L03, 2026-10-28)

Bunpro-style sentence banks for the 30 grammar items. Ids, `rev` and schema are unchanged; existing prompts are kept. The validator reports 0 errors in L01–L03, and the self-check passes with 0 failures.

**Added:** 241 cloze (29 → 270, 9 per item), 31 nuance (29 → 60, 2 per item), 10 register (10 → 20, a second prompt on every item that already had one). Every new cloze blank requires applying the attachment rule. Stems are mixed per pattern: vowel, consonant, ㄹ-drop, and ㅂ/ㄷ/ㅅ/르/ㅎ irregulars wherever the pattern conjugates (plus 러-irregular 이르다 in g:ㄹ-지경이다 c4). Conjugation slips (덥은, 듣은, 짓은, 살을, 놀는…) and sibling patterns are `nearMiss` entries with hints. Sentence-final blanks accept 해라 / 반말 / 해요 / 합쇼 (D39).

**Tags:** every item gets exactly one `fn:` tag. Debatable calls: g:기는커녕 and g:느니-차라리 → fn:contrast. The three inevitability items (g:기-마련이다, g:는-법이다, g:기-십상이다) → fn:conjecture. g:어-버리다 and g:고-말다 → fn:emphasis-attitude. The 셈/격/마찬가지 set → fn:manner-comparison.

**Schema-level edits**
- **g:는-탓에** `questionTypes`: [nuance, register] → [cloze, nuance, register]. It had no cloze.
- **g:는-통에** `questionTypes`: [cloze] → [cloze, nuance]. It had no nuance.

**Existing prompts edited** [Q]: cues normalized to "<dictionary form> + <pattern>" with exactly one " + ", for the UI hint ladder. Tense and speech level now come from the sentence and `en`, not the cue.
- **g:는-데다가 c1** cue: 설치다 (past) + -(으)ㄴ 데다가 → 설치다 + -(으)ㄴ 데다가.
- **g:니만큼 c1** cue: 참석하시다 + … → 참석하다 + -(으)니만큼. Added nearMiss 참석하니만큼 (honorific -시- needed for 대표님).
- **g:는-셈이다 c1** cue: (past) dropped. accepted + 셈이에요 / 셈입니다.
- **g:는-격이다 c1**, **g:는-법이다 c1**: accepted + 해요 / 합쇼 forms (D39).
- **g:거나-마찬가지다 c1** cue: (past) and (반말) dropped. accepted = 다 / 야 / 예요 / 입니다, for both 거나 and 것이나.
- **g:기-마련이다 c1**: accepted = all four levels for both -기 and -게 마련이다.
- **g:기-십상이다 c1** cue: (반말) dropped. accepted + 해요 / 합쇼.
- **g:ㄹ-지경이다 c1** cue: (past) dropped. accepted + 이었습니다.
- **g:어-버리다 c1** cue: (suggestion, -자) dropped (en says "let's"). accepted + 끝내 버립시다.
- **g:고-말다 c1** cue: (past) dropped. accepted + 말았습니다.
- **g:다시피 c1** cue: 살다 + -다시피 (하다) → 살다 + -다시피 하다.

**Author self-review notes (for the owner's skim)**
- **Proverb clozes** (g:는-격이다 c2–c9): the proverbs are fixed, but each blank tests the -는 / -(으)ㄴ choice and stem changes (부는, 붓는, 온, 뿌린).
- **Honorific clozes:** two accept only the honorific form and grade the plain form close: g:다시피 c2 (아시다시피) and c5 (들으셨다시피), both addressed to an audience in 합쇼체.
- **-다 못해 with adjectives** (파랗다/뜨겁다/짜다/어이없다 못해): the blank is the dictionary form + 못해. That is inherent to the pattern; these prompts test choosing the pattern, not conjugation.
- **Spacing:** 참다못해 is solid (표준 adverb). 들은 양했다 is solid because 양하다 is a 보조용언. 부실기업 is solid (표준 entry). -(으)ㄹ뿐더러 prompts keep `spacingStrict: true`.
- **Flags:** 2 (see REVIEW_NOTES).


## HTSK grammar (L05–L07, author self-pass, 2026-10-28)

New files: `seed/L05/grammar.json` (11), `seed/L06/grammar.json` (13), `seed/L07/grammar.json` (13). `track: "grammar"`, all gating, all `original-owned`. HTSK was used only as a coverage checklist; every sentence and explanation is original. Each cloze `cue` follows "<dictionary form> + <pattern>". Each item has exactly one `fn:` tag.

**Notable self-review edits**
- **g:므로 n1:** dropped a register-only distractor ("too formal for a text") per D39. The prompt now tests -(으)므로 vs -(으)ㅁ으로써 (reason vs means).
- **g:ㄹ걸-그랬다 n1:** reframed as "scold your sibling" (reproach), so the distractor fails on meaning, not on a claim that -(으)ㄹ걸 그랬다 can never be about others.
- **g:는-길에:** removed the planned claim "*온 길에 is wrong". 온 길에 exists ("since I came all this way", ≈ -(으)ㄴ 김에); the nearMiss hint and nuance say so.
- **g:이라도 n1:** replaced the distractor 차라도 한잔 드렸어요, which is actually natural ("at least I served tea"), with 차까지 (oversells).
- **g:ㄴ다니 n2:** replaced 결혼한다니까 / 결혼하다니 distractors, both of which are defensible, with a form error (결혼하는다니).
- **g:었어야-했다:** nuance softened. -아/어야 했는데 can also imply an unmet obligation, so the nearMiss hint says the form "first reads as 'had to'" rather than "is wrong".
- **g:었어도-되다 n2:** dropped a 쉬어도 됐는데 vs 쉬었어도 됐는데 contrast; both are natural.
- **g:어-두다:** dropped a 어질러 두고 distractor (marginal, not wrong).
- **g:느라고 register:** core words reduced to 오시느라 / 많으셨, so 고생 → 수고 variants pass.

**Skipped HTSK points:** 101–102 (slang, quoted abbreviations; vocabulary), 103 한/약/전반/당하다 (lexical; only -(으)므로 kept), 105 (miscellany), 107 ~도 revisited (no advanced nuance beyond 기는 하다 / 기도 하다), 110 어쩔 수 없다 (fixed phrase), 126 ~별(로) and 127 ~씩 (everyday morphology), 128 나다 and 129 넘다 (lexical senses), 130 large numbers, 131 사이시옷 (orthography, not a grammar pattern), 134 Konglish, 135 성, 136 -기에/-길래 and 147 -는 바람에 (already in L01–L02), 149 하필 and 150 어쩐지 (adverbs).


## Grammar QA (L01–L03, L05–L07, independent review, 2026-10-29)

Independent native-editor pass over all 67 grammar items: 524 cloze, 134 nuance, and 27 register prompts. Ids, `rev` (D39), and schema are unchanged. `npm run validate-content`: 0 errors, self-check 6444 cases, 0 failures, `needs_review` 0. Tags as in the L01 log (**[N] [A] [G] [Q] [S] [C]**, **(flag)**).

**Totals:** 9 rewrites (sentences, distractors, examples) · 8 nuance/hint claims corrected or softened · 76 `accepted` forms added across 62 prompts · 8 sibling `nearMiss` entries added · 5 author flags resolved · 0 `fn:` tags changed.

### Flags resolved
- **g:는-바람에 n2 option b** (flag) [G]: 퇴근 직전에 일이 너무 바쁜 바람에 못 갔어 ("adjective can't take it") → 퇴근 직전에 급한 일이 생기느라고 못 갔어. The distractor now fails cleanly on meaning: -느라고 needs the subject's own activity, and 일이 생기다 is something that happened to you. `needs_review` cleared.
- **g:니만큼 c3** (flag) [N]: 행사장이 시내에서 꽤 머니만큼 대중교통을… → 이번 산행 코스는 경사가 가팔라 꽤 힘드니만큼 등산화를 꼭 신고 오십시오 (cue 힘들다 + -(으)니만큼; nearMiss 힘들으니만큼 / 힘든 만큼 / 힘드니까). This keeps the ㄹ-drop drill without the stilted 머니만큼. The old sentence also nearly duplicated g:므로 c4 (행사장은 시내에서 멀므로…). `needs_review` cleared.
- **g:었었다 c2** (flag) [N]: 작년까지만 해도 이 자리에 작은 서점이 있었었어요 → 작년까지만 해도 이 회사에 다녔었어요 (cue 다니다; nearMiss 다녔어요). **n1** kept: 결혼했어 (still married) vs 결혼했었어 (no longer) is sound. `needs_review` cleared.
- **g:나-보다** (flag) [G]: standard-first grading kept (바쁘나 봐요 = close). Nuance "common in casual speech but nonstandard" → "very common in casual speech, but the standard form after an adjective is -(으)ㄴ가 보다"; the c3 hint is reworded to match. `needs_review` cleared. The owner policy question is in REVIEW_NOTES.
- **g:다니** (flag) [G]: c1 한다니 and c7 만든다니 stay **close**, but each hint now says "Also natural if you're reacting to what you were told (the quoted -ㄴ/는다니). The cue asks for the bare stem." Before, the hints implied these were wrong. The c6 합격한다니 hint is unchanged because it is a real tense error. Nuance adds that the two forms overlap heavily in speech, and the bare stem is the one that needs no report behind it. `needs_review` cleared.

### Other edits
- **g:었었다 c3 + example** [G]: 그 배우는 데뷔 전에 은행원이었었다 → 지금은 배우지만 데뷔 전에는 은행에서 일했었어요 (cue 일하다). The old sentence used -었었- only to mark sequence ("before his debut"), which the item's own nuance warns against. The example sentence and the N이다 attachment example (은행원이었었다 → 학교였었다) were changed to match.
- **g:는-바람에 nuance** [G]: "The form is always -는 … not *넘어진 바람에" → "stays -는 … (넘어진 바람에 is nonstandard)".
- **g:ㄹ지언정** [G]: added attachment `V/A-았/었을지언정` (c6 졌을지언정 had no matching rule). Nuance adds the concessive "past fact before a redeeming point" use, which c6 drills.
- **g:ㄴ-채로 nuance + 5 hints** [G]: "always uses the past modifier" → action verbs take -(으)ㄴ, but stative 모르다 and 있다 take -는 (모르는 채, 살아 있는 채로). Hints changed from "Always the past modifier:" to "The completed state takes the past modifier:".
- **g:더라 nuance, n1 option c** [G]: "-더라요 doesn't exist" / "There is no -더라요" → "-더라요 is nonstandard".
- **g:다-보면 nuance** [G]: "The main clause isn't past" → "is rarely a one-time past result". Past habitual is possible: 놀다 보면 해가 지곤 했다.
- **g:는-길에 c7** [N]: 사장님은 방금 회의에 들어가시는 길이에요 → 지금 막 …. 방금 reads as "just did", which clashes with -는 길이다.
- **g:었어도-되다 c5** [N][S]: 회의에 굳이 안 참석하셨어도 → 안 나오셨어도 (cue 나오다; nearMiss 나와도). 안 + Sino-Korean 하다 verb is weak in edited prose; 참석 안 하다 would be the standard order.
- **Sibling nearMiss** [Q]: g:어-놓다 c1/c5/c6 now accept the -아/어 두다 forms (만들어 뒀어요, 적어 둬, 예약해 뒀어요) as close, with "Also natural; the cue asks for -아/어 놓다". g:어-두다 c2/c3/c4/c6 do the same in reverse (챙겨 놨어요, 저장해 놔야, 비워 놓을게요, 받아 놔). Before this, natural sibling answers fell through to jamo distance.
- **`accepted` coverage** [Q] (D39, all reasonable levels for sentence-final blanks). The main gap was 합쇼체 across L05–L07: 자나/왔나/바쁜가/… 봅니다 (g:나-보다 c1–c8); …걸 그랬습니다 (g:ㄹ걸-그랬다 c1–c8, plus c4 그랬어요 and c8 그랬다); …리가 없습니다 (g:ㄹ-리가-없다 c1, c2, c4–c6); 했어야 했습니다 (g:었어야-했다 c1, c3, c8, plus c8 했어/했어요, c2 사과했어야죠); 잤어도 됐습니다; …곤 했습니다/합니다 (g:곤-하다 c1–c8, plus c6–c8 했어); 놓았습니다/뒀습니다, 놨어/뒀어/둘게 (g:어-놓다, g:어-두다); 만합니다 (g:ㄹ-만하다 c4–c6); 편입니다/편이었습니다/편이야 (g:는-편이다 c4, c6, c8); 길입니다/길이야 (g:는-길에 c6, c7); 었었습니다 (g:었었다 c4, c6, c7); 일어나야죠/일어나야지요 (g:어야 c9); 타자니까요. Non-final blanks with valid tense alternates: g:기에 c1 않았기에, c4 부르기에, c5 방대했기에; g:길래 c9 어두워졌길래; g:는-둥-마는-둥 c1 들은 둥 만 둥; g:다-보니 c4/c6/c7 -다가 보니. L03: 이르렀어 (g:ㄹ-지경이다 c4), 끝내 버려요 / 끝내 버리죠 (g:어-버리다 c1), 지워 버려라 (c8).

### Reviewed and left as is
- **Retrospective family:** -더라 (first-hand), -던가 (recall, rhetorical), -던 (읽던 / 읽은 / 읽었던), -더니 (third person) vs -았/었더니 (first person), and the nearMiss hints are accurate. "Normally" and "rarely" are already used where the rule has exceptions.
- **-(으)로서 / -(으)로써**, **-느라고** (same subject, no tense, no command; n1 and n2 test each constraint), **-(으)ㄹ수록** (no tense), and **-다니까 / -ㄴ다니 / -다니**: correct.
- **Registers without 합쇼체:** -더라, -던가, -지 뭐, -(으)ㄹ걸요, and -다니(까) were intentionally not given 합쇼 forms.
- **`fn:` tags:** no clear mis-tags. Arguable but defensible: 셈/격/마찬가지 → manner-comparison; 마련/법/십상 → conjecture; 어-놓다/두다 and 곤-하다 → sequence-time; 로써 → manner-comparison.
- **g:는-양 c9** (무슨 상사인 양, literary 양 in casual 반말): kept. The pose reading is the point, and the mix is attested.
- **Stock frames:** the proverb clozes (g:는-격이다), 급할수록 돌아가라, and 고객 여러분의 성원이 있었기에 are set phrases used as the frame on purpose. No sentence reproduces a dictionary, textbook, or HTSK example.

## Hanja removal (content side, 2026-10-28)

Owner direction: drop the WaniKani-style hanja element and focus on Hangul vocabulary.
- Deleted `seed/L01–L03/hanja.json` (30 items). The loader walks `seed/**/*.json`, so no empty placeholder files are needed.
- Stripped `hanjaId` from every vocab `hanjaBreakdown` entry (71 entries). `syllable` + `hanja` stay as a subtle annotation.
- Removed the `hanja:<char>` tags from x:환골탈태, x:고육지책, x:전화위복. No `unlockDeps` pointed at hanja ids.
- `validate.ts` is unchanged. It never required hanja items, and the `hanjaId` checks still apply to custom or imported items.
- `test/import.test.ts`: the CSV round-trip tests for the `hanja` kind sampled the real seed, so they now use six in-test hanja fixtures. The import/export path still supports the kind.

## Hangul-first mnemonics (2026-10-28/29)

Owner direction: hanja may stay only as a subtle hint, never as the main device.
- **L01–L03 vocab:** rewrote all 81 mnemonics that opened with characters (決 decide + 裁 judge…). Each one now anchors on a Hangul word the learner already knows that shares the syllable (결제 ↔ 경제, 재 ↔ 재판, 지양 ↔ 중지, 지향 ↔ 방향, 임대 ↔ 대출, 임차 ↔ 차용), on a collocation, or on a meaning contrast. None of them contains a hanja character any more.
  - Contrast pairs were kept: 결재/결제, 갱신/경신, 일체/일절, 유래/유례, 혼동/혼돈, 지양/지향, 임대/임차, 소환/소집.
  - **v:결딴나다:** now relies on the sound contrast (hard ㄸ = hard landing) rather than "not 決斷".
  - **v:간담회:** added the 간담이 서늘하다 homograph warning, which is useful for a translator.
  - Native-word mnemonics and L04 were already Hangul-only and were left untouched.
  - Expressions (사자성어) keep their character breakdowns. There, the characters are the idiom.
- **L05–L10:** mnemonics only where they add something: homographs a translator will meet (발효 law/fermentation, 공모 contest/conspiracy, 관용 tolerance/idiom, 고찰 study/temple, 감수 accept/supervise), and spelling traps (게재, 곰곰이, 금세, 낱낱이). They were written Hangul-first from the start, with homographs flagged by their collocation, not their characters.

## Frequency vocab L05–L10 (author self-pass, 2026-10-28/29)

Source: `data-private/vocab-candidates.tsv`, the owner's never-drilled Anki words in approximate frequency order. It was used as a word list only, and nothing from it is copied into the seed. Every gloss, collocation, example and prompt is original.

| level | words | rank range |
|---|---|---|
| L05 | 40 | 5,097–5,668 |
| L06 | 40 | 5,669–5,993 |
| L07 | 40 | 5,995–6,108 |
| L08 | 40 | 6,114–6,304 |
| L09 | 40 | 6,307–6,474 |
| L10 | 40 | 6,477–6,732 |

**Skipped**
- Loanwords and Konglish: 피시, 가이드, 카운터, 크림, 테이프, 파트너, 가스, 코스, 매너, 그래프, 오페라, 렌즈, 스튜디오, 샐러드, 헬멧, 노크, 오버하다, 레저, 리더십, 마케팅…
- Transparent compounds and derivations an advanced speaker infers: 작은집/큰집, 촬영지, 경비실, 상담실, 성적표, 수리비, 아랫집, 여고, 초가을/초겨울, 경고문, 결승선, 고가품, 고교생, 기행문, 기념회, 낚시터, 논밭, 농어촌…
- Proper nouns and nationalities: 대한민국, 아프리카, 북미, 그리스, 경찰청, 국세청, 기상청, 법무부.
- Interjections and fragments: 아냐, 아하, 어머, 어휴, 년생.
- Concrete everyday nouns: 깍두기, 팬티, 벤치, 요구르트, 단무지, 너구리, 캥거루, 족발, 저금통, 털실…
- Offensive terms: 병신.
- Near-duplicates of app items or of a picked sibling: 지향하다 and 개입하다 (already in L01–L03), 권장 (as 권장하다), 당면 (as 당면하다), 끼얹다 (in x:찬물을-끼얹다), 기피 (as 기피하다), and others.
- Low-yield Sino-Korean nouns where a 하다 verb or adverb sat nearby were dropped in favor of the verb or adverb. The owner asked for a preference for 하다/되다 verbs, adverbs, mimetics and register-marked words.

**Design notes**
- **Contrast pairs:** each is built inside the band, with `rejected` set in both directions and nearMiss hints on the clozes:
  - 간략/간소, 강인/강직, 경멸/경시, 고달프다/고되다, 결여/결핍, 과감/과격, 광범위/광활, 냉담/냉혹, 다짜고짜/대뜸, 곤욕/곤혹
  - links to earlier items: 간과/묵과, 거침없이/서슴없이, 관여/개입, 추락/전락, 선발/발탁, 복구/회복
- **Homographs:** tagged `homograph:<hanja>` so the UI can surface them. In meaning prompts, the other sense is a `rejected` answer: 발효 → "ferment", 양산 → "parasol", 공모 → "conspiracy", 관용 → "idiom".
- **Spelling:** spelling items carry the misspelling as a production `rejected` and a cloze nearMiss: 곰곰히, 금새, 낱낱히, 게제. 게을리하다, 그때그때 and 눈여겨보다 have spacing-strict clozes, with the spaced form as a nearMiss.
- **Clozes:** a cloze appears only where there is a strong frame (~___을 금치 못하다, ___를 앓다, 고하를 ___하고). Sentence-final blanks accept the common speech levels (D39).
- **hanjaBreakdown:** used only for Sino-Korean words where I'm certain of the characters. Mixed words are left without one (그간), as are uncertain etymologies (대수롭다; 눈총, which may be 눈 + 銃). 기필코 is tagged `mixed` and broken down for 기필 only.
- **꺼림칙하다:** production also accepts 께름칙하다 (both are standard).
- **Removed during self-review:** 꼬빡 as a cloze variant (not sure it's standard). Rewrote an English gloss ("lived off a friend" → "crashed at a friend's place") and one 고수하다 example that repeated 고집.
