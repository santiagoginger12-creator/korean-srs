# The drill (단어 드릴)

The drill is an Anki-style flashcard deck inside the app, at **Drill** on the home screen (`#/drill`).
It is separate from lessons and reviews: nothing you do in the drill changes your WaniKani-style
items, levels, review queue or lesson caps. It uses the same storage, sync and backups, so it
follows you across your iPad, phone and laptop.

## What's in it

- **All 10,878 words of the word bank**, in word-bank order: tier 1 (Beginner 1) through tier 6
  (Expert), most frequent first within each tier.
- **Glosses.** Tier 1 words have the project's own glosses and example sentences. Every other word
  has a short English gloss taken from 한국어기초사전, and no example yet. Those cards show the line
  "English glosses for some words: 국립국어원 한국어기초사전 (CC BY-SA 2.0 KR)". About 200 words have
  no usable dictionary gloss (the dictionary only had an idiom or proverb for them), and say "No
  English gloss yet". As more tiers get original glosses and sentences, the deck is rebuilt
  (`scripts/drill/README.md`) and your progress carries over.
- **Two directions.** Every word starts as a **Korean → English** card. When a word's Korean →
  English card reaches a 7-day interval, its **English → Korean** card unlocks and appears from the
  next day. Reverse cards are new cards, but they don't count toward your daily new-card limit. You
  can turn them off in Settings → Drill.

## How a session works

Press **Start** (or Space) on the drill page, **Start drill** on the home screen, or **D** on the
home screen or any finish screen.

1. The card shows the Korean word (or, on a reverse card, the English gloss).
2. Recall the answer, then press **Space** or **Enter**, or tap the card, to flip it.
3. The back shows the gloss, part of speech, hanja or source spelling in grey, the tier, and the
   example sentence if there is one. The sentence's English is hidden until you tap
   **Show translation** (or press **T**).
4. Grade yourself. Each button shows when you'll see the card next:
   - **Again (1)** — you didn't know it. It comes back in a minute (new cards) or ten (lapsed cards).
   - **Hard (2)** — you got it with effort.
   - **Good (3)** — you knew it.
   - **Easy (4)** — you knew it instantly. A new card graduates straight to a multi-day interval.

The order is Anki's: learning cards that are due come first, then the day's reviews with new cards
mixed in, then learning cards due in the next 20 minutes. New cards go through two short steps
(1 minute, then 10 minutes) before their first multi-day interval, so a new card comes back during
the same session. If the only cards left are learning cards due later, the session shows how long
until the next one; you can wait or end the session.

When you finish, the summary shows what you did, and the usual buttons: **→** Home, **L** lessons,
**G** grammar lessons, **R** reviews, and **D** for another drill session if cards are still waiting.

## Keys

| key | does |
|---|---|
| Space / Enter (or tap) | show the answer (never grades) |
| 1 / 2 / 3 / 4 | Again / Hard / Good / Easy (after the answer is shown) |
| Z, or Ctrl/⌘+Z | undo the last answer (also works from the summary) |
| K | "I already know this": asks first; K or Enter confirms, Esc cancels |
| T | show the example's English |
| D | open the drill (home screen, finish screens) |

The keys work with the Korean keyboard on (ㅋ is Z, ㅏ is K), and holding a key down never answers
twice. On a phone or iPad without a keyboard, tap the buttons.

## Placement: start where you are

Starting at 하다 would waste your time, so the drill page has two ways to skip what you know.
Both ask you to confirm on the page, and both can be undone from the list under **Placement**.

- **Skip ahead to tier N** marks every word below tier N that you haven't studied in the drill as
  known. Known words are never shown. Words you're already studying keep their schedule.
- **Skip N words you've mastered in Anki** appears once your Anki history is imported as the master
  list's baseline (Data → Master list). It marks known every word whose headword has status
  `mastered` there. Homographs (two words spelled the same) are both marked. It reads your data on
  this device; nothing is uploaded.

During a session, **K** marks just the current word known; **Z** right after brings it back.

**Start new cards at** on the drill page chooses the tier new cards come from. Left on "First tier
with new words", it moves on by itself as you finish tiers.

## Scheduling

The drill uses **FSRS-5**, the scheduler Anki uses by default, with its published default
parameters. Settings → Drill has:

- **New cards per day** (default 20, up to 200).
- **Desired retention** (default 90%, 80–97%). Higher means more reviews and fewer lapses. A change
  applies to answers from then on; it doesn't reschedule existing cards.
- **Answer mode** (only "Flip" for now; other ways of answering can be added later).
- **Reverse cards** on or off.

Intervals of three days or more get a small, fixed random spread (Anki's "fuzz") so cards learned
together don't all come back on the same day. The spread is the same on every device. The longest
interval is 100 years.

The drill page also shows: cards due, new cards available today, reviews done today, your 30-day
retention (share of review answers that weren't Again), and how many cards are new, learning, young
(interval under 21 days), mature (21 days or more), and known.

## Fill in the blank

Settings → Drill → Answer mode → **Fill in the blank** swaps the flip card for a sentence. You see one of the word's example sentences with the word blanked out, plus its English translation. Type the missing word as it appears in the sentence (conjugated, with or without its particle) and press Enter.

- The site tells you how you did: **Correct**, **Close** (a small typo), **Right word but a different form** (you typed the dictionary form), or **Not quite**.
- Enter on an empty box just shows the answer.
- You still grade yourself with 1–4. The suggested grade is outlined: Good after a correct answer, Hard after a close one, Again after a miss.
- Latin letters typed with a Korean keyboard layout are understood, and the auto-convert setting applies.
- Only words with an example sentence can be blanked. Today that's Beginner 1. Every other word falls back to the normal flip card until its tier gets original sentences.

## Reset

At the bottom of the Drill page, **Reset drill progress…** clears every drill review, known mark and reverse card after an in-page confirm. Your WaniKani-style reviews are untouched. **Undo reset** appears right after, in case you didn't mean it. Like everything else, the reset syncs to your other devices.

## Notes

- Everything you do is saved as it happens, so closing the app mid-session loses nothing.
- If you drill on two devices offline, both sets of answers count once they sync.
- An older copy of the app on another device keeps drill answers it doesn't understand aside
  (the Data page lists them as quarantined) and applies them after it updates. Nothing is lost.
