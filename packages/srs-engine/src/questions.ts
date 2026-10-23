// Question instances built at queue time and handed to the answer checker (§5).

import type { Item, QuestionInstance, QuestionType } from '@ksrs/content';
import { headword } from './content-index.ts';
import { requiredQTypes } from './load.ts';
import { userAnswerKey, type DerivedState } from './state.ts';
import { seededShuffle } from './util.ts';

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

function pickPrompt<T>(prompts: readonly T[] | undefined, seed: string): T | undefined {
  if (!prompts || prompts.length === 0) return undefined;
  return seededShuffle(prompts, seed)[0];
}

/**
 * One instance per required qtype (item.questionTypes ∩ enabled, in item order; if the
 * intersection is empty the item's first qtype is used so it can still be reviewed). Qtypes
 * whose spec is missing are skipped. Never produces questions for hanja.
 *
 * - accepted is merged with the user's own accepted answers (userAnswer.add).
 * - production.rejected is merged with every other vocab headword (§5, e.g. 결재 for 결제),
 *   minus anything accepted.
 * - Multi-prompt types pick a prompt by seededShuffle keyed on (seed, itemId, qtype, reviewCount).
 * - Nuance options are shuffled deterministically and keyed a, b, c….
 */
export function buildQuestions(item: Item, s: DerivedState, enabled: readonly QuestionType[], seed: string): QuestionInstance[] {
  if (item.kind === 'hanja') return [];
  const reviews = s.items.get(item.id)?.stats.reviews ?? 0;
  const userAcc = (q: QuestionType) => s.userAnswers.get(userAnswerKey(item.id, q)) ?? [];
  const pseed = (q: QuestionType) => `${seed}|${item.id}|${q}|${reviews}`;
  const out: QuestionInstance[] = [];

  for (const qtype of requiredQTypes(item, enabled)) {
    const qs = item.questions;
    switch (qtype) {
      case 'meaning': {
        const spec = qs.meaning;
        if (!spec) break;
        out.push({
          qid: `${item.id}#meaning`, itemId: item.id, qtype, promptKo: headword(item),
          accepted: uniq([...spec.accepted, ...userAcc(qtype)]), rejected: (spec.rejected ?? []).slice(),
        });
        break;
      }
      case 'production': {
        const spec = qs.production;
        if (!spec) break;
        const accepted = uniq([...spec.accepted, ...userAcc(qtype)]);
        const acc = new Set(accepted);
        const others: string[] = [];
        for (const it of s.index.byId.values()) {
          if (it.kind === 'vocab' && it.id !== item.id && !acc.has(it.word)) others.push(it.word);
        }
        const q: QuestionInstance = {
          qid: `${item.id}#production`, itemId: item.id, qtype, promptEn: spec.promptEn,
          accepted, rejected: uniq([...(spec.rejected ?? []), ...others]),
        };
        if (spec.contextHint !== undefined) q.contextHint = spec.contextHint;
        out.push(q);
        break;
      }
      case 'cloze': {
        const p = pickPrompt(qs.cloze, pseed(qtype));
        if (!p) break;
        const i = p.sentence.indexOf('{{}}');
        out.push({
          qid: `${item.id}#cloze#${p.id}`, itemId: item.id, promptId: p.id, qtype,
          before: i < 0 ? p.sentence : p.sentence.slice(0, i), after: i < 0 ? '' : p.sentence.slice(i + 4),
          en: p.en, cue: p.cue, accepted: uniq([...p.accepted, ...userAcc(qtype)]),
          nearMiss: (p.nearMiss ?? []).map((n) => ({ ...n })), particleTolerance: p.particleTolerance,
          spacingStrict: p.spacingStrict ?? false,
        });
        break;
      }
      case 'nuance': {
        const p = pickPrompt(qs.nuance, pseed(qtype));
        if (!p) break;
        const shuffled = seededShuffle(p.options, `${pseed(qtype)}|${p.id}|options`);
        const keys = 'abcdefghij';
        const options = shuffled.map((o, i) => ({ key: keys[i] ?? String(i), text: o.text, why: o.why }));
        const ci = shuffled.findIndex((o) => o.correct);
        out.push({
          qid: `${item.id}#nuance#${p.id}`, itemId: item.id, promptId: p.id, qtype,
          situation: p.situation, options, correctKey: ci >= 0 ? options[ci]!.key : '',
        });
        break;
      }
      case 'register': {
        const p = pickPrompt(qs.register, pseed(qtype));
        if (!p) break;
        out.push({
          qid: `${item.id}#register#${p.id}`, itemId: item.id, promptId: p.id, qtype,
          from: p.from, to: p.to, source: p.source, accepted: uniq([...p.accepted, ...userAcc(qtype)]),
          features: p.features.map((f) => ({ ...f, any: f.any.slice() })), coreWords: p.coreWords.slice(),
          particleTolerance: p.particleTolerance, finalPunctOptional: p.finalPunctOptional,
        });
        break;
      }
    }
  }
  return out;
}
