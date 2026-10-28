// Import/export (M5): CSV, JSON, KRDict. See packages/content/IMPORT.md.
export type { ImportKind, ImportIssue, ImportResult, ImportContext } from './types.ts';
export { parseCsv, toCsv } from './csv.ts';
export { importCsv, exportCsv, csvTemplate, csvColumns } from './csv-items.ts';
export { importJson, importItems, diffItems, generateId, idSlug } from './pipeline.ts';
export {
  parseKrdictXml, parseKrdict, krdictToVocab, krdictUrl, KRDICT_SOURCE, type KrdictSense,
} from './krdict.ts';
export {
  MASTER_COLUMNS, MASTER_STATUSES, MASTER_HEADER, parseMasterCsv, serializeMasterCsv, masterCells, stripFences, meaningAnswers,
  sessionWordItem, type MasterColumn, type MasterStatus, type MasterRow, type MasterIssue, type MasterParseResult,
} from './master.ts';
