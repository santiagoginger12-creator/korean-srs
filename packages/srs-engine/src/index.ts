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
export {
  computeUnlocks, levelProgress, grammarProgress, availableLessons, unlockDepsOf, openLevels, openGrammarStages,
  vocabLevels, grammarStages, isSeparatePath, hanjaLessonsOn, LEVEL_THRESHOLD,
  type LessonPath, type PathSettings, type GrammarProgress, type GrammarStageProgress,
} from './unlock.ts';
export {
  ghostSlots, dueGhosts, nextGhostAt, pruneGhostDone, GHOST_OFFSETS_MS, GHOST_EXPIRY_MS, type GhostSlot, type GhostDue,
} from './ghost.ts';
export { dueItems } from './queue.ts';
export { relatedItems, type RelatedItems } from './related.ts';
export { forecast, stageCounts, stageGroup, type ForecastBucket, type StageGroup } from './forecast.ts';
export { leechScore, isLeech, troubleItems, LEECH_MIN_REVIEWS, LEECH_MIN_SCORE, ANKI_SHAKY_TAG, PRIOR_LEECH_MIN_SCORE } from './leech.ts';
export {
  dailyLessonCap, secPerQEstimates, rollingAccuracy, itemCost, requiredQTypes, DEFAULT_SEC_PER_Q,
  type LessonCapReport, type GrammarCapReport, type CapSettings,
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
  defaultAppSettings, coerceAppSetting, settingPayload, extPayload, EXT_PREFIX, EXTRA_SETTING_DEFAULTS,
  type AppSettings, type AppSettingKey, type ExtraSettings,
} from './settings.ts';
export {
  HOTKEY_ACTIONS, HOTKEY_GROUPS, HOTKEY_BY_ID, RESERVED_CODES, MAX_KEYS_PER_ACTION,
  isBindableCode, canonicalCode, codeMatches, formatCode, coerceBindings, resolveBindings, compactBindings,
  conflictFor, findConflicts, bindKey, removeAlternate,
  type HotkeyAction, type HotkeyGroup, type HotkeyScreen, type HotkeyBindings, type HotkeyConflict, type BindResult, type KeyLike,
} from './hotkeys.ts';
export {
  variantsInbox, extraStudyItems, resetCandidates, normalizeResponse, baseLayer,
  type VariantEntry, type ExtraStudySource,
} from './study.ts';

export { pickExample, type DictExample, type PickedExample } from './examples.ts';

export { localDayStart, nextLocalDayStart, localDayBoundaries, type TzOffset } from './time.ts';
export { floorHour, seededShuffle, canonicalJson, sha256Hex, MINUTE, HOUR, DAY } from './util.ts';
export {
  MASTER_EXT_BASELINE, MASTER_EXT_SESSION_PREFIX, MASTER_EXT_LAST_EXPORT, MASTER_LEECH_MISSES,
  readMasterExt, sessionKey, baselineRows, statusCounts, appWords, localDate, buildMasterList, compareMasterRows,
  sessionHash, planSession, itemsForWord,
  type BaselineBlob, type SessionRowRec, type SessionRecord, type SessionSource, type LastExport, type MasterExt,
  type AppWord, type MasterInputs,
} from './master.ts';

// Anki-style drill (D78–D84): FSRS-5 scheduling, event-derived state, queue and counts.
export type { DrillCardId } from './events.ts';
export { DRILL_CARD_RE } from './events.ts';
export {
  FSRS5_DEFAULT_W, DEFAULT_FSRS_PARAMS, DEFAULT_RETENTION, MAX_IVL_DAYS, RATINGS, RATING_LABELS, DECAY, FACTOR,
  retrievability, rawInterval, nextIntervalDays, initStability, initDifficulty, nextDifficulty, recallStability,
  forgetStability, shortTermStability, nextMemory, fuzzRange, fuzzFactor, applyFuzz, newCardSched, scheduleAll, schedule,
  formatInterval, type Rating, type FsrsParams, type CardSched, type CardPhase,
} from './drill/fsrs.ts';
export {
  replayDrill, applyDrillEvents, emptyDrillState, drillParams, parseCardId, drillCardId, isDrillEvent, isDrillRelevant,
  REVERSE_UNLOCK_DAYS, MATURE_DAYS,
  type DrillState, type DrillCard, type DrillReviewRec, type DrillPlacement, type DrillDir,
} from './drill/state.ts';
export {
  tierOf, dueLearning, dueReviews, nextLearningDue, newIntroducedToday, reviewsToday, drillRetention, unseenForward,
  unseenByTier, effectiveStartTier, reverseNewIds, newLeftToday, drillCounts, newForwardIds, mixNew, pickNext, afterAnswer,
  LEARN_AHEAD_MS,
  type DeckMeta, type DeckTier, type DrillDay, type DrillCounts, type DrillSettingsView, type DrillSession, type DrillPick, type PickSource,
} from './drill/queue.ts';
