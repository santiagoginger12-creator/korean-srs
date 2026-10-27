// Public API of @ksrs/srs-engine (ARCHITECTURE.md §7.2). Import only from here.

export type {
  AppEvent, EventBase, EventPayload, EventType, EventOf, HLC, NoteField, SettingKey, Settings,
  ValidationResult, UnknownFutureVersion,
} from './events.ts';
export {
  EVENT_VERSION, QUESTION_TYPES, DEFAULT_INTERVALS, DEFAULT_SETTINGS, SRS_SETTING_KEYS, defaultSettings, coerceSetting,
  compareEvents, sortEvents, unionEvents, validateEvent, validateLog, upcastEvent, isUnknownFutureVersion, eventItemId,
} from './events.ts';

export { createHlc, formatHlc, parseHlc, type HlcClock, type ParsedHlc } from './hlc.ts';
export { uuidv7, UUIDV7_RE } from './uuid7.ts';
export { createEventFactory } from './factory.ts';

export type { Scheduler, SrsCore, SrsParams, Stage, ReviewOutcome } from './scheduler/index.ts';
export { wkScheduler, wkNextStage, wkAvailableAt, getScheduler } from './scheduler/wk.ts';

export type { DerivedState, ItemState, ItemStats, PendingGroup } from './state.ts';
export { noteKey, userAnswerKey } from './state.ts';
export { buildContentIndex, resolveId, headword, repairCustomItem, type ContentIndex } from './content-index.ts';

export { replayAll, applyEvents, liveEvents, DUENESS_GRACE_MS } from './replay.ts';
export { computeUnlocks, levelProgress, availableLessons, unlockDepsOf, LEVEL_THRESHOLD } from './unlock.ts';
export { dueItems } from './queue.ts';
export { relatedItems, type RelatedItems } from './related.ts';
export { forecast, stageCounts, stageGroup, type ForecastBucket, type StageGroup } from './forecast.ts';
export { leechScore, isLeech, troubleItems, LEECH_MIN_REVIEWS, LEECH_MIN_SCORE } from './leech.ts';
export {
  dailyLessonCap, secPerQEstimates, rollingAccuracy, itemCost, requiredQTypes, DEFAULT_SEC_PER_Q,
  type LessonCapReport,
} from './load.ts';
export { buildQuestions } from './questions.ts';
export {
  sessionReducer, emptySession, currentQuestion,
  type ReviewSession, type SessionAction, type SessionCtx, type SessionItem, type SessionMode, type StartItem,
  type CheckOutcome, type AnswerRecord,
} from './session.ts';
export {
  makeBackup, parseBackup, serializeBackup, mergeBackup, mergeEventSets, eventsChecksum,
  BACKUP_FORMAT, BACKUP_FORMAT_VERSION, DUPLICATE_ID_REASON, type BackupFile, type BackupMeta, type ParseBackupResult,
} from './backup.ts';

export {
  defaultAppSettings, coerceAppSetting, settingPayload, EXTRA_SETTING_DEFAULTS,
  type AppSettings, type AppSettingKey, type ExtraSettings,
} from './settings.ts';
export {
  variantsInbox, extraStudyItems, resetCandidates, normalizeResponse,
  type VariantEntry, type ExtraStudySource,
} from './study.ts';

export { localDayStart, nextLocalDayStart, localDayBoundaries, type TzOffset } from './time.ts';
export { floorHour, seededShuffle, canonicalJson, sha256Hex, MINUTE, HOUR, DAY } from './util.ts';
