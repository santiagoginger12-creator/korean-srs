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
