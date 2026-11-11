# DECISIONS.md

Append-only log of tradeoffs. Newest at the bottom.

## Initial (Architect, 2026-10-16)

1. **D1: React over Svelte.** IME correctness comes from one uncontrolled input component, not from the framework. React gives the most reliable multi-agent output and the best test tooling. The bundle cost is irrelevant once cached.
2. **D2: Dexie/IndexedDB over SQLite-WASM.** iOS Safari maturity. No COOP/COEP requirement (which GitHub Pages can't provide). About 30 KB vs about 1 MB. Rebuildable projections remove the migration advantage of SQL.
3. **D3: Event-sourced state for everything.** Reviews, notes, settings, and custom items all live in one log. Merge is a set union. LWW for non-log state falls out of HLC ordering. Undo and override are events. Backups are just the log. Tradeoff: log growth (about 25 MB/yr worst case), which is acceptable; snapshots can come later without format changes.
4. **D4: HLC + UUIDv7, total order `(hlc, id)`.** Ordering stays deterministic under device clock skew.
5. **D5: Dueness gate for concurrent duplicate reviews.** First by HLC wins. The loser's incorrect answers still feed leech stats. This is simple and deterministic, at the cost of occasionally ignoring a valid offline review.
6. **D6: SRS settings are time-indexed.** Changing intervals or scheduler never rewrites past progress.
7. **D7: Close attempts are not events.** They are embedded in the final answer, which keeps the log small. Only graded outcomes matter for scheduling.
8. **D8: GitHub private data repo + single-repo fine-grained PAT** as the sync transport. Per-device, per-week append-only JSONL means cross-device write conflicts are impossible. Git history doubles as off-site backup. Drive was rejected (OAuth friction in iOS PWAs). The Worker is deferred behind `SyncTransport`. Manual file sync always stays available.
9. **D9: Korean typos are "close", English typos are "correct".** This follows the owner's ㅔ/ㅐ requirement and WaniKani precedent. Known other-word collisions (결제/결재) are always incorrect.
10. **D10: Missing target feature in register/cloze is "incorrect", not "close".** It is the skill under test. A near-miss of the feature itself (one jamo off) is close.
11. **D11: Lenient variants are accepted but surfaced** in a Variants inbox for owner curation, rather than silently trusted.
12. **D12: Hanja are lesson-only nodes** that unlock vocab via `lesson` deps. Gating counts vocab, grammar, and expressions only. "Passed" (first Guru) is sticky.
13. **D13: Load-estimator cap** is the minimum of the steady-state and 7-day headroom caps, recalibrated from measured answer durations, and user-overridable.
14. **D14: Hash routing + relative manifest scope** for portability between GitHub Pages and Cloudflare Pages.
15. **D15: Seed content review is tiered.** The QA & Linguistic Review agent checks every item first. Only items it can't confidently clear get `needs_review: true`, and each level adds a short owner skim-and-approve pass, so the owner's review queue stays small. KRDict content never enters the public repo. *(Orchestrator amendment: the Architect had proposed flagging all seed content.)*
16. **D16: Sync in M6.** The format is locked in M1 and the semantics are proven by manual sync in M5.

## Open questions for the owner (pending)

1. **Public app repo:** free GitHub Pages requires the *app* repo to be public. It would contain only code and original seed content; your review data goes in a separate **private** `ksrs-data` repo. Is that acceptable, or would you rather deploy the app to Cloudflare Pages from a private repo?
2. **Day boundary:** is a 4:00 a.m. local day rollover (for lesson caps and "today" stats) right for you, and should "today" follow the device's current timezone while you're in Seoul each summer? (Default if unanswered: 4:00 a.m., device timezone.)

---

## Owner answers (2026-10-16)

17. **D17: Public app repo + GitHub Pages.** The app repo is public (code + original seed content only). Review data lives in the private `ksrs-data` repo.
18. **D18: Day rollover at 4:00 a.m. in the device's current timezone.** "Today" follows the owner to Seoul.

## M1 (2026-10-16)

19. **D19: Pure packages are dependency-free; tests use Node's built-in runner.** This session's network blocks the npm registry, so Vitest, Zod, fast-check, and ts-fsrs can't be installed. The engine, answer checker, and content schema are therefore written with zero runtime dependencies: plain TS types plus a hand-written validator, `node:test` via tsx, and a small seeded property-test helper. A script (`scripts/check-boundaries.ts`) enforces the §4 rules in place of dependency-cruiser. This is a net simplification for pure code. Zod and fast-check can be added later without API changes. **FSRS mode is deferred** behind the `Scheduler` interface until `ts-fsrs` can be installed.
20. **D20: Optional `mnemonic` on all item kinds** (required for hanja), because item pages show mnemonics for vocab, grammar, and expressions too.

## M1 integration (2026-10-23)

21. **D21: Engine API additions.** `DerivedState` carries the `ContentIndex` and an `fsrsFallback` flag. `ItemState` adds `recentIncorrectAt[]` (for the 90-day leech window), `ignoredEarly`, and pending `closeAttempts`. `forecast`/`dailyLessonCap` take an optional `tz`. `createHlc` accepts the last persisted HLC. `createEventFactory` builds events for the app. The engine keeps its own copy of the checker's outcome type (`CheckOutcome`) because srs-engine may not import answer-check (§4).
22. **D22: Forward-compatible settings.** `validateEvent` accepts any `settings.set` key; replay ignores unknown keys and invalid values, so an older app never rejects a newer device's settings. `upcastEvent` only routes by version.
23. **D23: Daily lesson cap never exceeds `maxLessonsPerDay` for the whole day.** The engine clamps before subtracting lessons already done today; read literally, the §7.4 formula could allow more than 20.
24. **D24: Engine edge semantics.** Unknown dependency ids are ignored. A level with no gating items unlocks the next. Reviews before a lesson are ignored. A repeated lesson does nothing. An empty `note.set` deletes the note. A custom item with a content item's id replaces it. The duration EMA uses α = 0.2.
25. **D25: `check(q, response, opts?)` signature.** `opts` carries `otherHeadwords` (layer 2) and `userAccepted`. `CheckResult` adds `converted?` (the dubeolsik-converted text). Production questions use `allomorph` particle tolerance. Latin letters inside Korean answers compare case-insensitively. A whole cloze sentence typed into the blank is trimmed to the blank.
26. **D26: Checker leniency calls.** Empty input → close. English typed in a Korean field → close ("Answer in Korean"). Wrong particle allomorph (책를) → close at every tolerance level. A one-jamo near-miss on an ending feature counts only for features ≥ 3 jamo. A wrong allomorph blocks variant acceptance (close instead). A nuance response matching no option → close.
27. **D27: Layer 6 (features, core words, variants) shipped in M1** instead of M4, because the owner asked for lenient free-form grading. M4 still owns the cloze/nuance/register *UI* and the ≥ 60-case owner-reviewed golden file.
28. **D28: Content conventions.** Renamed ids go in an optional `seed/idRedirects.json`. `track` is `"core"` for all seed items until tracks are defined (planned values: `hanja-sino`, `native`, `grammar`, `expression`). Content self-check failures exit 1 (block CI); a checker crash only warns.

## M2 toolchain (2026-10-23)

29. **D29: Offline build path for M2.** The session's npm registry access is blocked by account policy, so M2 uses what's preinstalled: **React 19.2 + esbuild 0.28** (instead of Vite), a small **hand-written IndexedDB wrapper** (instead of Dexie), and a **hand-written service worker** (instead of vite-plugin-pwa). React's type definitions aren't available, so `apps/web` uses a minimal local `react` type shim until `@types/react` can be installed. Each piece sits behind our own module (`db/`, `pwa/`, `build.ts`), so moving to Vite/Dexie later is contained. `apps/web/package.json` still declares real dependencies, so GitHub Actions (which has npm access) installs them normally.

## M1 QA (2026-10-23)

30. **D30: Stricter English typo tolerance, plus a real-word guard.** This supersedes the English row of §8.2. Distance is now OSA (Damerau), so a transposition counts as one typo. Tolerance by length: ≤ 4 → 0, 5–7 → 1, ≥ 8 → min(4, ⌊n/4⌋). A typo is not accepted when the response contains a different real English word: either from a small built-in common-word list, or from another item's meaning passed in `CheckOptions.otherMeanings`. Inflections and derivations of the target word (hesitates, approve/approval) are still allowed. "to be X" glosses also accept plain "X". The reason: one edit on a short word usually lands on another word (ship/shop, dessert/desert), and accepting those silently is worse than an occasional "I was right".
31. **D31: `loose` particle drops are limited to 은/는, 이/가, 을/를.** Spoken Korean doesn't drop 와/과 or (으)로, and as word endings those syllables are common (결과, 도로, 피로). A dropped 이/가 after a one-syllable stem (놀이 → 놀, 휴가 → 휴) is ambiguous, so it grades as close, not correct.
32. **D32: Variant guards in layer 6.** A response eojeol that is a one-jamo substitution of an accepted eojeol (시간애, 됬어요) is a typo and grades close (D9), not a variant. A response that drops the honorific -(으)시- that every accepted answer's predicate has also grades close.

33. **D33: `item.reset` keeps item stats (pending owner input).** A reset leech stays on the trouble list until it rebuilds a correct streak. Revisit if that feels punishing.

## M2 (2026-10-23)

34. **D34: No IndexedDB projection stores in M2.** Derived state lives in memory: `replayAll` on load, `applyEvents` after each write. At about 100 ms for 50k events this is fast enough. The stores can be added later without changing the event log.
35. **D35: Session snapshot keeps two levels of undo.** The persisted review session keeps undo history for only the last two answers, because nested snapshots grow too fast when serialized. The in-app Undo is still limited to the most recent answer anyway (§6.2).
36. **D36: Test hooks.** e2e tests fake time with Playwright's `page.clock`. `window.__ksrs` is a read-only test hook. E2E tests live in `apps/web/tests/e2e/` and run against a frozen 10-item fixture seed (`KSRS_SEED_DIR`), plus one real-seed smoke test, so content edits can't break the UI tests.
37. **D37: Pretendard from the jsDelivr CDN**, cached by the service worker at runtime. It is not self-hosted yet because the font files can't be downloaded in this workspace. The fallback stack is Apple SD Gothic Neo / Noto Sans KR. Self-hosting is planned for M5.
38. **D38: Deploy workflow uses npm** with a separate `apps/web` install (no workspaces). The e2e CI job is non-blocking until it has run once on GitHub.
39. **D39: Content style rules from the M2 review.** Write "rarely" or "sounds stilted" instead of "never" for usage claims. Nuance distractors must fail on form or meaning, not register alone. Register labels follow news and written usage. Sentence-final cloze blanks accept every reasonable speech level. Check 표준국어대사전 single-word entries before spacing a word (참다못해). Avoid stock textbook frames. `rev` stays 1 for pre-release edits.
40. **D40: Five validator warnings are accepted:** alternate hanja readings (更 갱, 殺 쇄) and 두음법칙 (論 → 논란, 논조). The schema holds one `eum` per hanja. A future `altEum[]` field would silence them.

## Owner answers (2026-10-26)

41. **D41: `item.reset` keeps leech history** (confirms D33). A reset item stays on the trouble list until it rebuilds a correct streak.
42. **D42: Keep lenient particle drops** (confirms D31). A dropped 이/가 after a stem of two or more syllables is accepted. The rare truncation false-positive (물놀이 → 물놀) is an accepted tradeoff for fewer retries.
43. **D43: Phone install and GitHub deploy are deferred** by the owner. M3–M5 continue locally. The deploy workflow stays ready.

## M3 (2026-10-26)

44. **D44: The daily lesson cap is fixed for the study day.** The headroom projection skips items whose lesson was completed today, because `lessonsDoneToday` already pays for them. Previously they were counted twice, so the cap shrank as the owner did lessons. This amends §7.4.
45. **D45: "+5 anyway" raises the day's total.** Each press adds exactly 5 to the day's allowance, even with a review backlog. Previously the extras were added to a cap that floors at 0, so they were offered again after every batch. The lessons tile always shows the limit actually enforced.
46. **D46: The level-up banner is UI-only.** It is derived by comparing `userLevel` before and after applying events, so no event is stored. It doesn't reappear after a reload.
47. **D47: `relatedItems(index, itemId)`** is added to the engine. It returns contrasts in both directions (one entry per pair, with a direction flag), vocab grouped by shared hanja, unlock deps, and the items each one unlocks. It tolerates custom items with missing fields.
48. **D48: Light-mode `--muted` darkened to #686b72** (≈5:1 on the background and card) so small labels and chart axes meet WCAG AA.
49. **D49: e2e fixture seed grown to 15 items over 2 levels** (10 gating in L1), so level-up can be tested at 8/10 (no) vs 9/10 (yes). The exact 90% arithmetic is unit-tested in the engine and probed on the real seed (45/51 no, 46/51 yes).
50. **D50: Known minor gap.** In half-hour time zones (e.g. India), forecast hour labels read ":00" for buckets that start at :30. This doesn't affect the owner (New York / Seoul).

## M5 (2026-10-27)

51. **D51: Import pipeline.** CSV/JSON import lives in `@ksrs/content/import` (pure, no deps). One CSV per kind, with header-named columns, `|` for multi-values and `ko::en` pairs. Nuance, register and multi-cloze prompts go in a `questions_json` column, so everything round-trips. Exports include a BOM for Excel. Hanja must be imported before the vocab that links to them. See packages/content/IMPORT.md.
52. **D52: Draft tolerance.** Items whose source isn't `original` (user, import, krdict) get a *warning*, not an error, for fewer than 2 examples. KRDict drafts are `needs_review: true` and `gating: false`. `repairCustomItem` repairs or drops malformed prompts, examples, collocations and attachments in custom items at index time, so imported or synced data can never crash lessons, reviews or item pages.
53. **D53: Settings beyond the frozen M1 keys** (`inbox.dismissed`, `tts.autoplay`, `tts.rate`, `tts.voiceURI`) go through `settingPayload()` and are coerced on replay (`AppSettings`, a superset of `Settings`). `events.ts` is unchanged.
54. **D54: Variants inbox.** Built from live `review.answer` events with `check.layer === 'variant'`. Promote = `userAnswer.add`, normalized like the checker. Dismissing hides every entry with the same (item, qtype, normalized response). Dismissals are LWW via settings and survive merges.
55. **D55: Backup, restore and manual sync.**
    - Merge is an event-set union. Replace is atomic (one IndexedDB transaction) and also clears an open session and any "+5" extras.
    - Duplicate ids inside one file: one copy is kept deterministically, and the other is quarantined and reported.
    - Future-version events are quarantined and included in later backups, so they're never lost. A quarantined copy never overwrites an existing event.
    - Projections compare in canonical form. Manual sync is the same flow, run in both directions.
56. **D56: IndexedDB schema v2** adds `secrets` (never exported or backed up) and `quarantine`. The v1→v2 upgrade is verified to preserve data.
57. **D57: KRDict.** The app tries a browser fetch first. The API likely blocks it (CORS), so the fallbacks are pasting the XML or uploading a file (API search/view XML, the downloadable LMF XML, or JSON). Attribution: 한국어기초사전 (국립국어원), CC BY-SA 2.0 KR.
58. **D58: Known limits.**
    - A 50k-event restore takes about 40 s in this sandbox, IndexedDB-bound, with about 1.4 s of main-thread parsing. That parsing could move to a background worker later.
    - On a merge conflict (same id, different content), the local copy wins and the conflict is reported, not quarantined.
    - WebKit/iOS remains untested.

## Hosted preview (2026-10-27)

59. **D59: `KSRS_TARGET=artifact` build for a private claude.ai page.**
    - Relative paths, no service worker or manifest, and Google Fonts Noto Sans/Serif KR (the page's CSP blocks the jsDelivr Pretendard CSS).
    - The page content is emitted without a document skeleton.
    - Files (backup, CSV templates, exports) go through the page's `downloads` capability (`src/host.ts`, `data/files.ts`), which asks the viewer to confirm.
    - Backups are uncompressed `.ksrs.json` on that target, because `.gz` isn't an allowed save extension.
    - Progress lives in that browser's IndexedDB for the page's origin. It survives republishes to the same URL, but not other browsers or devices. Use Backup/Merge to move it.
    - The PWA build is unchanged.

## Anki integration (2026-10-28)

60. **D60: Imported extras interleave with the curriculum.** Non-gating, non-original items (e.g. the personal Anki "shaky words" import) no longer queue ahead of curriculum lessons. After hanja, lessons alternate between 3 curriculum items and 2 extras, and the daily cap still applies. This amends the §7.3 lesson order.
61. **D61: Master list sync.** The master vocab CSV (docs/MASTER_LIST.md) is a deterministic export from three sources:
    - the frozen Anki baseline, stored in `ext.master.baseline`, compressed
    - app history
    - recorded session rows, one `ext.` key per block, keyed by the block's hash, so pasting the same block twice is a no-op
    
    No new event types were added (D22). Status rules: a word mastered in Anki stays mastered until new misses are recorded, ≥ 8 total misses means `learning`, and suspended stays suspended. Removing a recorded block also removes the unstudied lesson items it created. The CSV uses CRLF and no BOM, to match the owner's file.
62. **D62: Level 4 is a native-verb track** built from the owner's Anki leeches: 64 sense-level items covering 30 verbs and 8 adverbs, all cloze-led, with sense ids such as `v:걸치다:span`. Later senses unlock after the earlier sense reaches Guru.
    - **Known schema gaps:** no sense-hint field for meaning prompts, and no sibling relation for vocab. Siblings use `verb:` tags for now.
    - **Personal imports never reuse curriculum ids.** The import generator skips words and ids already in the seed.

## Owner direction (2026-10-28, afternoon)

63. **D63: Hanja are removed as lesson nodes; this supersedes D12.**
    - The owner asked to remove the WaniKani-style hanja element and focus on learning and reviewing Hangul vocabulary.
    - The seed has no hanja items, and vocab has no hanja unlock deps.
    - `hanjaBreakdown` keeps `syllable` + `hanja`, without `hanjaId`. It is shown only as one subtle, muted annotation on Sino-Korean vocab.
    - Hanja lesson events already in a log replay harmlessly.
    - Hanja lessons can only be re-enabled through the `hanja.lessons` setting, which defaults to off.
64. **D64: The vocab path starts where the owner's Anki history ends.**
    - New vocab levels (L05+) come from words the owner has never drilled, in frequency order from rank ~5,000 upward (data-private/vocab-candidates.tsv, a private word list).
    - Trivial loanwords and transparent compounds are skipped.
    - All glosses and sentences are original.
    - Grammar runs on its own path (separate pacing), so vocab level numbers and grammar stage numbers are independent.
65. **D65: Separate grammar path.** Vocab levels gate on vocab and expressions only. Grammar stages are the distinct grammar `level` values in ascending order, and each stage opens at 90% of the previous one. Each path has its own lesson queue, and `grammar.dailyLessons` defaults to 3. There is still one 45-minute review budget: the projected cost of the grammar allowance is reserved before the vocab cap is computed. `grammar.separatePath` set to false restores the combined behavior.
66. **D66: Hint ladder.** The cue format is "<dictionary form> + <pattern>". Level 0 shows the dictionary form; level 1 shows the meaning without revealing the pattern; level 2 shows the full pattern. A correct answer after level 2 counts as a miss. The hint level is recorded in `check.layer` (e.g. `exact+hint2`), so the event format is unchanged.
67. **D67: Ghost reviews.** A grammar miss schedules practice at +2 h and +24 h, derived from the review log. Ghost sessions write no events, completion is tracked per device, and ghosts expire after 7 days.
68. **D68: Sentence banks rotate.** Each item and question type has a fixed shuffled order of prompts, and review n shows prompt n mod length. Every sentence appears once before any repeat, and the same sentence never appears in back-to-back reviews. Grammar items have 9 cloze + 2 nuance prompts (L1–L3).

## Owner rulings (2026-10-30)

69. **D69: Standing grading conventions.**
    - **Standard-first.** A colloquial but nonstandard form is graded close, not correct (e.g. adjective + -나 보다).
    - **Synonyms in headword-cued clozes are graded close**, with an "also fits; the cue asks for X" hint. The learner must produce the target word.
    - **Narrative -지 뭐예요.** 했지 뭐요 is wrong in that use.
    - **No origin labels when the etymology is uncertain.**

    Future content follows these conventions.

## Hosting (2026-10-30)

70. **D70: GitHub Pages deploys from a `gh-pages` branch, not from GitHub Actions.** The Claude GitHub App can't write `.github/workflows/`, so the workflow files were removed from history and kept under `docs/ci/` for reference. Each release is built locally with `BASE=/korean-srs/` and the contents of `dist/` are pushed to `gh-pages`. The site is `https://santiagoginger12-creator.github.io/korean-srs/`.

## Dictionary examples (2026-11-02)

71. **D71: Dynamic example sentences from 한국어기초사전.**
    - **Source and license.** Each vocab or expression item has a bank of up to 12 verbatim KRDict sentences and dialogues (2019-06-26 snapshot, CC BY-SA 2.0 KR) in `packages/content/examples/`. That folder has its own LICENSE.md, and the share-alike terms apply to the folder only.
    - **Sense matching.** `scripts/krdict/sense-map.json` decides which KRDict senses match each app item. When unsure, it includes fewer senses. QA found 0.4% wrong-sense examples, all of them fixed.
    - **Rotation.** After each answer, `pickExample` rotates through the item's original examples plus the dictionary bank, in a fixed per-item order, and shows one. Every sentence appears once before any repeats. Nothing is shown before the answer is submitted.
    - **Display.** Each sentence is credited to its source and linked to the dictionary entry. A setting, `examples.dictionary` (default on), turns them off.
    - **Updating.** Rebuild with a newer KRDict download via scripts/krdict/README.md.

## M6 sync (2026-11-02)

72. **D72: GitHub sync.**
    - **Package.** `packages/sync` is pure TS; fetch and the clock are injected.
    - **Remote layout.** It follows §11.2. Listing uses the git trees API, and reads and writes use the contents API with sha checks.
    - **No changes to stored events.** "Already pushed" is tracked in a separate `syncPushed` store.
    - **Segments.** They are keyed by the ISO week of the *event*, so a first upload of history doesn't create one big file that gets re-sent all week.
    - **Conflicts.** A sha conflict is retried up to 3 times by re-reading and taking the union.
    - **Device-only settings.** Repo, enabled flag and token expiry are stored only on the device and never synced.
    - **Token.** It lives only in the IndexedDB `secrets` store and is never in backups, exports or the repo.
    - **When it runs.** Sync is off on the artifact target (CSP). It runs after first paint, after a session ends, on tab focus (at most every 15 s), and on demand. It never runs during a session.
    - **Schema.** The IndexedDB schema is now v3.
    - **Setup.** See docs/SYNC.md.
73. **D73: Live keyboard-layout conversion.** A page can't switch the OS keyboard, so answer fields convert instead (setting `input.autoConvert`, default on, coerced per D53). Korean fields: Latin keys with no IME composition and no Ctrl/Meta/Alt are kept as a raw run at the caret and re-rendered with `dubeolsikToHangul` on each key; Backspace in a run removes one keystroke; anything else (space, digits, punctuation, Enter, navigation, click, paste, blur, composition start) commits the run. English fields: Hangul becomes `hangulToDubeolsik` keys after composition ends. Real IME composition is never intercepted. Off, or bypassed: D26 grading still applies, and a meaning answer that is English typed on the Korean layout now also gets a "Use …" offer.
74. **D74: Vocab and expression questions never show their answer.** Cloze cues, cloze `en` and production prompts/context hints are English only, and the headword or its -다 stem never appears outside the blank. The hint ladder goes English cue → 초성 with syllable counts (only the blanked words for partial proverbs) → dictionary form, and the last step counts as a miss. Korean contrast, spelling and conjugation notes moved to `mnemonic` or `collocations`. `validate.ts` makes these errors for seed items and warnings for user, KRDict and imported items (the KRDict importer still puts a Korean definition in `contextHint`). Answers (`accepted`, `nearMiss`, `rejected`) are unchanged.
75. **D75: Finish screens lead straight to the next thing.** Every end-of-session screen (lessons, reviews, practice, ghosts) shows Home plus Lessons, Grammar lessons and Reviews buttons with live counts; a button is hidden when its count is 0. Keys: → Home, L lessons, G grammar lessons, R reviews. The keys match `e.code` too, so they work while the Korean input source is on. One press acts once, and held-key repeats are ignored. On the lesson "Quiz passed" screen → presses Finish lessons, so → → from the last answer reaches Home. Leaving the review summary closes the session first. R from the review summary starts a new session in place. Key hints are hidden on touch-only devices.
76. **D76: Grammar sentence translations are hidden until asked for.** In grammar fill-in-the-blank questions (reviews, lesson quizzes, practice), the English translation is replaced by a "Show translation" button. The button, or T when no field is focused, reveals it for that question only. The translation appears automatically after answering. Setting `grammar.showTranslation` (Settings → Grammar questions, default off) shows it every time. Vocab questions are unchanged (D74).
77. **D77: Grammar reviews test the pattern, not the speech level.** The 17 seed grammar items that also asked "rewrite this whole sentence in 합쇼체" lost that question type and its prompts. Changing the sentence ending didn't show whether the owner could form or choose the pattern. Grammar reviews are now a fill-in-the-blank (8–9 rotating sentences per pattern; dictionary form shown, pattern recalled, D66) plus "which pattern fits" (nuance). The `register` question type stays in the engine for content that is actually about speech levels; the e2e fixture still exercises it.

## Anki-style drill (2026-11-11)

78. **D78: A separate Anki-style vocabulary drill at `#/drill`.**
    - **Separate program.** The drill has its own deck, cards, schedule and events. It never changes WaniKani-style items, reviews, levels or lesson caps: the main replay ignores every drill event (tested), and drill settings are only read by the drill. It shares storage, sync, backup and the dashboard.
    - **Deck.** All 10,878 words of the word bank in its order (tier 1→6, then frequency = id order `kw00001…`). `scripts/drill/build-deck.ts` builds `packages/content/drill/deck.json` from the separate korean-public repo, which is never modified.
    - **Glosses.** Words with original content (tier 1 today) use its gloss and first example (`gloss_source: "original"`). Every other word gets the unique 한국어기초사전 short equivalents from `private/sense_hints.json`, joined with "; " and capped at about 60 characters, and no example (`"krdict"`). Proverb- or idiom-like and truncated equivalents are dropped, so 202 words have no gloss yet and say so. KRDict definitions and example sentences are never used. Cards with a krdict gloss show the plain credit line "English glosses for some words: 국립국어원 한국어기초사전 (CC BY-SA 2.0 KR)"; `packages/content/drill/LICENSE.md` has the notes. The deck is rebuilt as more tiers get original content.
    - **Cards.** `<wordId>:f` (Korean → English) for every word. `<wordId>:r` (English → Korean) unlocks once the forward card's interval reaches 7 days (sticky, even after a later lapse); it is a new card that enters the queue from the next study day and doesn't count against the daily new limit. Card ids don't depend on the deck version, so rebuilding the deck never touches history.
79. **D79: FSRS-5 with Anki's learning steps.** `packages/srs-engine/src/drill/fsrs.ts`, pure.
    - Published FSRS-5 default weights (19), desired retention 0.9 (setting, 0.80–0.97), maximum interval 36,500 days. Formulas and their sources are listed in the file header; the tests check the published reference values.
    - Learning steps 1m 10m, relearning step 10m. Hard on the first step is the mean of the first two steps (5.5m), and 1.5× a single step. Easy graduates at once. A same-day answer (< 24 h since the last) uses the short-term stability formula; otherwise elapsed time is fractional days. A lapse takes min(S, forget stability).
    - Review intervals round to whole days (at least 1). Fuzz (Anki/ts-fsrs ranges) applies to intervals of 3+ days, with one factor per answer seeded from card id + review count, so replay is exact. After fuzz, Hard ≤ Good < Easy among review-phase outcomes. A review card is due on its due day (counted until that study day ends); learning cards are due to the minute.
80. **D80: Drill events, derived like everything else.** New v1 types: `drill.review {cardId, rating 1–4, durationMs?}`, `drill.undo {targetId}` (voids one `drill.review` or `drill.known`; an undo of an undo is ignored and rejected by validation), `drill.known {cardIds, reason?}` (placement or "I already know this"), `drill.reset {cardIds?}` (back to new; no list = the whole drill, engine and backup only, no UI yet).
    - **No version bump.** Events keep `v: 1`, uuidv7, HLC and device id, so sync, backup, import and replay carry them. An older app's validator rejects the new types as "unknown type", so sync and restore put them in quarantine (kept, never dropped, included in backups), and `resolveQuarantine` moves them into the log once that device updates. Tested in `drill-state.test.ts`.
    - **Replay.** `replayDrill(events)` is a pure function of the drill events and the `drill.retention` timeline in (hlc, id) order: a retention change applies only to later answers. `applyDrillEvents` is the incremental path (falls back to a full drill replay on undo, reset or out-of-order input). Two devices answering the same card offline both count, in HLC order (no dueness gate, unlike §6.1; the second answer just sees a shorter elapsed time). Marking known is cleared by a later review of that card.
    - The store keeps the projection as `AppState.drill` next to `derived`.
81. **D81: Drill settings and the study day.** `drill.newPerDay` (20, 0–200), `drill.retention` (0.9, 0.80–0.97), `drill.answerMode` (`flip`; any well-formed name is kept so a newer device's mode survives, and the UI falls back to Flip), `drill.reverse` (on), `drill.startTier` (0 = the first tier with unseen cards). All are coerced on replay (D53). "Today" uses `dayStartHour` like lessons. New cards counted against the limit are forward cards first studied today.
82. **D82: Session order and pluggable answer modes.**
    - **Order** (`pickNext`): learning cards that are due; then reviews due today with the session's new cards spread among them (one new card after every ⌊reviews left / (new left + 1)⌋ reviews); then learning cards within Anki's 20-minute learn-ahead limit; then a wait screen for later learning cards today. Reverse cards are spread evenly among the forward new cards.
    - **Answer modes.** The answer step is a component taking `AnswerModeProps` (front, back, revealed, reveal, grade, intervals, paused), registered in `features/drill/modes/index.ts`. Only `flip` exists. A typed-then-self-grade mode is one new component; the session, scheduler and events don't change.
    - **Keys.** Space/Enter (or a tap) show the answer and never grade; 1–4 grade, with the next interval on each button; Z or Ctrl/Cmd+Z undoes the last answer (or known-mark), also from the summary; K asks "mark as known?" and K/Enter/Y confirms, Esc/N cancels; T shows the example's English. Keys match `e.code` (Korean input source) and ignore auto-repeat. TTS autoplay (`tts.autoplay`) speaks the headword on reveal. Sync waits while a drill session is on screen.
83. **D83: The deck loads only when the drill opens.** `build.ts` copies the deck to `dist/drill/deck.json` (`KSRS_DRILL_DECK` overrides it; e2e uses a 30-word fixture) and compiles only its tier summary (`__DRILL_META__`: count and id range per tier) into the main bundle, so the dashboard and NextSteps counts need no download. The service worker precaches the deck, so the drill works offline.
84. **D84: Drill on the dashboard and finish screens; placement.**
    - **NextSteps** gets a Drill destination with its due + new count and key D (hidden at 0, like the others); from the drill's own summary D starts a fresh session in place. The dashboard has a compact full-width Drill tile (due, new today, Start drill) and D opens the drill (straight into a session when cards are waiting).
    - **Skip ahead** marks the unseen forward cards of every word below a chosen tier known (cards already in study are left alone), after an in-page confirm. Each batch is listed on the drill page with Undo (`drill.undo` of that event).
    - **Anki skip** (opt-in button) marks known every unseen word whose headword has status `mastered` in the master list's Anki baseline (D61), decoded at runtime from this device's data; nothing private goes into the repo. All homonyms with that spelling match.
