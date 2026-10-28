// #/grammar progress page view model (pure; unit-tested in test/grammar.test.ts).
import type { GrammarItem, ItemId } from '@ksrs/content';
import { grammarProgress, type DerivedState, type GrammarStageProgress } from '@ksrs/srs-engine';
import { shortMeaning } from './hints.ts';

export interface PatternRow {
  id: ItemId;
  pattern: string;
  meaning: string;
  /** Grammar-path stage (1-based) and its content level. */
  stage: number;
  level: number;
  /** SRS stage (0 = not learned) and whether the lesson is open. */
  srsStage: number;
  learned: boolean;
  unlocked: boolean;
}
export interface PatternGroup { key: string; label: string; rows: PatternRow[] }
export interface ContrastSet { key: string; label: string; rows: PatternRow[] }
export interface GrammarPageView { stages: GrammarStageProgress[]; groups: PatternGroup[]; contrastSets: ContrastSet[]; total: number }

const FN = 'fn:';
const CS = 'contrast-set:';
export const OTHER_GROUP = 'Other';

/** "fn:cause-reason" → "Cause reason"; "contrast-set:unwanted-cause" → "Unwanted cause". */
export function tagLabel(raw: string): string {
  const t = raw.replace(/[-_]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : raw;
}

export function grammarPageView(s: DerivedState): GrammarPageView {
  const gp = grammarProgress(s.index, s);
  const stageOf = new Map(gp.stages.map((g) => [g.level, g.stage]));
  const items = [...s.index.byId.values()].filter((it): it is GrammarItem => it.kind === 'grammar')
    .sort((a, b) => a.level - b.level || (s.index.order.get(a.id) ?? 0) - (s.index.order.get(b.id) ?? 0));
  const groups = new Map<string, PatternGroup>();
  const sets = new Map<string, ContrastSet>();
  for (const it of items) {
    const st = s.items.get(it.id);
    const row: PatternRow = {
      id: it.id, pattern: it.pattern, meaning: shortMeaning(it), stage: stageOf.get(it.level) ?? 0, level: it.level,
      srsStage: st?.stage ?? 0, learned: st?.lessonAt !== undefined, unlocked: s.unlocked.has(it.id),
    };
    const tags = Array.isArray(it.tags) ? it.tags : [];
    const fns = [...new Set(tags.filter((t) => t.startsWith(FN) && t.length > FN.length))];
    for (const t of fns.length ? fns : [null]) {
      const key = t ?? OTHER_GROUP;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, label: t ? tagLabel(t.slice(FN.length)) : OTHER_GROUP, rows: [] }));
      g.rows.push(row);
    }
    for (const t of new Set(tags.filter((x) => x.startsWith(CS) && x.length > CS.length))) {
      let c = sets.get(t);
      if (!c) sets.set(t, (c = { key: t, label: tagLabel(t.slice(CS.length)), rows: [] }));
      c.rows.push(row);
    }
  }
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const ordered = [...groups.values()].filter((g) => g.key !== OTHER_GROUP).sort(byLabel);
  const other = groups.get(OTHER_GROUP);
  return {
    stages: gp.stages,
    groups: other ? [...ordered, other] : ordered,
    contrastSets: [...sets.values()].sort(byLabel),
    total: items.length,
  };
}
