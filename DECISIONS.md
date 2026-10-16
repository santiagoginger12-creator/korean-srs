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
