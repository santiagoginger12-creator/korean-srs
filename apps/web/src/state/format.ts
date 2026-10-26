// Display helpers (pure).
import type { Item, QuestionType, SpeechLevel } from '@ksrs/content';
import { headword, HOUR, MINUTE, DAY } from '@ksrs/srs-engine';

export const STAGE_NAMES = ['Lesson', 'Apprentice 1', 'Apprentice 2', 'Apprentice 3', 'Apprentice 4',
  'Guru 1', 'Guru 2', 'Master', 'Enlightened', 'Burned'] as const;

export const stageName = (stage: number): string => STAGE_NAMES[stage] ?? `Stage ${stage}`;

export const KIND_LABEL: Record<Item['kind'], string> = { hanja: 'Hanja', vocab: 'Vocabulary', grammar: 'Grammar', expression: 'Expression' };
export const KIND_KO: Record<Item['kind'], string> = { hanja: '한자', vocab: '어휘', grammar: '문법', expression: '표현' };

export const QTYPE_LABEL: Record<QuestionType, string> = {
  meaning: 'Meaning', production: 'Production', cloze: 'Fill the blank', nuance: 'Nuance', register: 'Register',
};

export const SPEECH_LEVEL: Record<SpeechLevel, { ko: string; en: string }> = {
  hapsyo: { ko: '합쇼체', en: 'formal polite (-ㅂ니다)' },
  haeyo: { ko: '해요체', en: 'polite (-아/어요)' },
  hae: { ko: '해체', en: 'casual (반말)' },
  haera: { ko: '해라체', en: 'plain (-다)' },
  written: { ko: '문어체', en: 'written style' },
  spoken: { ko: '구어체', en: 'spoken style' },
};

export const REGISTER_LABEL: Record<string, string> = {
  formal: '격식', written: '문어', neutral: '중립', spoken: '구어', slang: '속어',
};

export function title(it: Item): string { return headword(it); }

export function relTime(t: number, now: number): string {
  const d = t - now;
  if (d <= 0) return 'now';
  if (d < HOUR) return `in ${Math.max(1, Math.round(d / MINUTE))} min`;
  if (d < DAY) return `in ${Math.round(d / HOUR)} h`;
  return `in ${Math.round(d / DAY)} d`;
}

export function itemHref(id: string): string { return `#/item/${encodeURIComponent(id)}`; }

/** Local "YYYY-MM-DD HH:MM" in the device zone (display only). */
export function localDateTime(t: number): string {
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
