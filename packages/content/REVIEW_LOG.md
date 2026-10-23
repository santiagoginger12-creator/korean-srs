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
