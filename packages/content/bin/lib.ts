// Shared helpers for content CLIs: seed loading, QuestionInstance construction, self-check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item, QuestionInstance, VocabItem } from '../src/schema/types.ts';
import { headword } from '../src/validate.ts';

export const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
export const SEED_DIR = join(PKG_DIR, 'seed');

export interface LoadedSeed { raws: unknown[]; origins: string[]; idRedirects: Record<string, string>; loadErrors: string[] }

/** Loads every seed/**\/*.json (arrays of items), in sorted path order. `idRedirects.json` is a map, not items. */
export function loadSeed(dir = SEED_DIR): LoadedSeed {
  const out: LoadedSeed = { raws: [], origins: [], idRedirects: {}, loadErrors: [] };
  const walk = (d: string): string[] =>
    readdirSync(d).sort().flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
    });
  for (const file of walk(dir)) {
    const rel = relative(PKG_DIR, file);
    let data: unknown;
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
      out.loadErrors.push(`${rel}: invalid JSON (${(e as Error).message})`); continue;
    }
    if (file.endsWith('idRedirects.json')) {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) Object.assign(out.idRedirects, data);
      else out.loadErrors.push(`${rel}: must be an object map`);
      continue;
    }
    if (!Array.isArray(data)) { out.loadErrors.push(`${rel}: must be a JSON array of items`); continue; }
    data.forEach((raw, i) => { out.raws.push(raw); out.origins.push(`${rel}#${i}`); });
  }
  return out;
}

// ---------------------------------------------------------------------------
// QuestionInstance construction (mirrors what the engine builds at queue time, §5)

export interface BuiltQuestion { q: QuestionInstance; ownRejected: string[] }

export function buildQuestions(items: readonly Item[]): BuiltQuestion[] {
  const vocabWords = items.filter((i): i is VocabItem => i.kind === 'vocab').map((v) => v.word);
  const out: BuiltQuestion[] = [];
  for (const it of items) {
    if (it.kind === 'hanja') continue;
    const base = (qtype: string, promptId?: string) =>
      ({ qid: `${it.id}#${qtype}${promptId ? `#${promptId}` : ''}`, itemId: it.id, ...(promptId ? { promptId } : {}) });
    const q = it.questions;
    for (const t of it.questionTypes) {
      if (t === 'meaning' && q.meaning) {
        const rej = q.meaning.rejected ?? [];
        out.push({ q: { ...base(t), qtype: 'meaning', promptKo: headword(it), accepted: q.meaning.accepted, rejected: rej }, ownRejected: rej });
      } else if (t === 'production' && q.production) {
        const p = q.production;
        const own = p.rejected ?? [];
        // §5: rejected is merged with every other vocab headword.
        const merged = [...new Set([...own, ...vocabWords.filter((w) => !p.accepted.includes(w))])];
        out.push({
          q: { ...base(t), qtype: 'production', promptEn: p.promptEn, ...(p.contextHint ? { contextHint: p.contextHint } : {}), accepted: p.accepted, rejected: merged },
          ownRejected: own,
        });
      } else if (t === 'cloze') {
        for (const z of q.cloze ?? []) {
          const idx = z.sentence.indexOf('{{}}');
          out.push({
            q: {
              ...base(t, z.id), qtype: 'cloze', before: z.sentence.slice(0, idx), after: z.sentence.slice(idx + 4),
              en: z.en, cue: z.cue, accepted: z.accepted, nearMiss: z.nearMiss ?? [],
              particleTolerance: z.particleTolerance, spacingStrict: z.spacingStrict ?? false,
            },
            ownRejected: (z.nearMiss ?? []).map((n) => n.answer),
          });
        }
      } else if (t === 'nuance') {
        for (const n of q.nuance ?? []) {
          const keys = n.options.map((_, i) => String.fromCharCode(97 + i));
          const correctKey = keys[n.options.findIndex((o) => o.correct)] ?? 'a';
          out.push({
            q: { ...base(t, n.id), qtype: 'nuance', situation: n.situation,
                 options: n.options.map((o, i) => ({ key: keys[i]!, text: o.text, why: o.why })), correctKey },
            ownRejected: keys.filter((k) => k !== correctKey),
          });
        }
      } else if (t === 'register') {
        for (const r of q.register ?? []) {
          out.push({
            q: { ...base(t, r.id), qtype: 'register', from: r.from, to: r.to, source: r.source, accepted: r.accepted,
                 features: r.features, coreWords: r.coreWords, particleTolerance: r.particleTolerance, finalPunctOptional: r.finalPunctOptional },
            ownRejected: [],
          });
        }
      }
    }
  }
  return out;
}

/** Answers that must grade correct for a question. */
export function expectedCorrect(q: QuestionInstance): string[] {
  return q.qtype === 'nuance' ? [q.correctKey] : q.accepted;
}

// ---------------------------------------------------------------------------
// Self-check (§9): accepted → correct; rejected / nearMiss / wrong nuance keys → not correct.

export type CheckFn = (q: QuestionInstance, response: string) => { outcome: string };
export interface SelfCheckResult { cases: number; failures: string[]; crashes: string[] }

export function runSelfCheck(items: readonly Item[], check: CheckFn): SelfCheckResult {
  const res: SelfCheckResult = { cases: 0, failures: [], crashes: [] };
  const run = (q: QuestionInstance, answer: string, wantCorrect: boolean) => {
    res.cases++;
    try {
      const { outcome } = check(q, answer);
      if (wantCorrect && outcome !== 'correct') res.failures.push(`${q.qid}: accepted "${answer}" graded ${outcome}`);
      if (!wantCorrect && outcome === 'correct') res.failures.push(`${q.qid}: rejected/nearMiss "${answer}" graded correct`);
    } catch (e) {
      res.crashes.push(`${q.qid}: checker threw on "${answer}": ${(e as Error).message}`);
    }
  };
  for (const { q, ownRejected } of buildQuestions(items)) {
    for (const a of expectedCorrect(q)) run(q, a, true);
    for (const r of ownRejected) run(q, r, false);
  }
  return res;
}

/** Dynamically loads answer-check's `check`, or returns null if it isn't exported yet. */
export async function loadChecker(): Promise<CheckFn | null> {
  try {
    const mod = (await import('../../answer-check/src/index.ts')) as unknown as Record<string, unknown>;
    return typeof mod.check === 'function' ? (mod.check as CheckFn) : null;
  } catch {
    return null;
  }
}
