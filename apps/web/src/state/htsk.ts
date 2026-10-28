// HowtoStudyKorean cross-references from `htsk:<n>` tags (pure; unit-tested).
import type { Item } from '@ksrs/content';

export interface HtskRef { lesson: number; label: string; url: string | null }

/** Lessons 101–125 are Unit 5, 126–150 Unit 6; anything else has no known page (label only). */
export function htskUrl(lesson: number): string | null {
  if (lesson >= 101 && lesson <= 125) return 'https://www.howtostudykorean.com/unit-5/';
  if (lesson >= 126 && lesson <= 150) return 'https://www.howtostudykorean.com/unit-6/';
  return null;
}

export function htskRefs(item: Item): HtskRef[] {
  const out: HtskRef[] = [];
  for (const t of Array.isArray(item.tags) ? item.tags : []) {
    const m = /^htsk:(\d+)$/.exec(t);
    if (!m) continue;
    const lesson = Number(m[1]);
    if (out.some((r) => r.lesson === lesson)) continue;
    out.push({ lesson, label: `HowtoStudyKorean Lesson ${lesson}`, url: htskUrl(lesson) });
  }
  return out;
}

/** Drops a trailing "See also HowtoStudyKorean Lesson N." (or "Lessons N and M.") sentence. */
export function stripHtskSentence(text: string): string {
  return text.replace(/\s*See also HowtoStudyKorean Lessons?\s+\d+(?:\s*(?:,|and|&|–|-)\s*\d+)*\.?\s*$/i, '').trimEnd();
}

/** Nuance as displayed: the HTSK sentence is removed when the tag link is shown instead. */
export function displayNuance(item: Item & { nuance?: string }): string {
  const n = item.nuance ?? '';
  return htskRefs(item).length ? stripHtskSentence(n) : n;
}
