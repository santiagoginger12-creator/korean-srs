# korean_master_vocab.csv: format and sync rules

The master vocab list is shared by the study app, 대화 모드 (conversation mode) and tutoring sessions. It is UTF-8 CSV with a header row and these columns **in this order**:

| # | column | meaning |
|---|---|---|
| 1 | `word` | Korean headword, the dictionary form (e.g. 걸치다). It is the key: one row per word. |
| 2 | `meaning` | Short English gloss. Senses are separated with `;`. |
| 3 | `hanja` | Hanja for Sino-Korean words, e.g. 決裁; `-` marks a native syllable. Empty for native words. |
| 4 | `pos` | Part of speech, free text (noun, verb/adj, adverb, 관용구, …). |
| 5 | `status` | One of `new`, `learning`, `mastered`, `suspended`. |
| 6 | `times_missed` | Total misses from all sources (Anki lapses + app wrong answers + conversation misses). |
| 7 | `times_seen` | Total reviews or encounters from all sources. |
| 8 | `last_seen` | Date of the most recent review or encounter (YYYY-MM-DD). |
| 9 | `freq_rank` | Approximate frequency rank (lower = more common). Blank if unknown. |
| 10 | `sources` | A space-separated set drawn from `anki`, `app`, `convo`, `tutor`. |
| 11 | `tags` | Space-separated tags: `leech` (≥ 8 misses), `shaky`, `app-L<n>`, `native-verb`, … |
| 12 | `notes` | Free text, e.g. which sense was missed or a collocation. |

## One row per word family

- A noun and its 하다/되다 verb share one row, keyed by the noun, when they mean the same thing: 요구 covers 요구하다, and its notes say `also: 요구하다`. The verb's gloss is appended as `요구하다: ask`.
- Homograph pairs stay separate (전 "before" vs 전하다 "convey").
- Words the app teaches keep their own rows.
- Reports should use the family's row (the noun form) when a merged row exists.
- Synonyms are never deleted. Rows whose glosses overlap strongly are linked in `notes` as `similar: …`, so you can contrast them.

## Status rules

- `new`: added but not yet studied (an app lesson not done, or a word first met in conversation).
- `learning`: being studied and not stable. This includes any word with `times_missed ≥ 8`, even if Anki or the app considers it mature, because repeated misses mean it isn't really known.
- `mastered`: stable (Anki mature or app Guru+) with fewer than 8 misses. A word mastered in Anki stays `mastered` when its app lesson is done; it changes only when the app or a session records new misses for it (then the latest evidence applies).
- `suspended`: deliberately parked.

Conversation and tutoring modes prioritize `new` and `learning` rows with high `times_missed`.

## Where the numbers come from

- **Anki baseline:** a frozen snapshot of the owner's Anki history taken 2026-10-28 (`sources` includes `anki`). It does not change unless a new Anki export is imported.
- **App:** derived from the app's review log. App lessons and reviews add to `times_seen`, and wrong answers add to `times_missed`.
- **Conversation/tutoring:** the VOCAB ROWS from a session report are pasted into the app (Data → Master list → Add session rows), not into the file. The app records them, so they count exactly once.

The app produces the whole file (Data → Master list → Export) as a deterministic function of the Anki baseline, the app's history and the recorded session rows. Replace the project's copy with each new export. **Don't edit the file by hand.** Hand edits would be lost on the next export; put notes in the app or in a session row instead.
