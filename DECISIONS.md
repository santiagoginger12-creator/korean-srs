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
