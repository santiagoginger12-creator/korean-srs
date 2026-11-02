// Public API of @ksrs/sync (ARCHITECTURE.md §11). Import only from here.
// Pure TS: no IndexedDB (§4 rule 3), no globals; fetch and the clock are injected.

export type {
  EventStore, QuarantineItem, RemoteEntry, RemoteFile, SyncClock, SyncOptions, SyncReport, SyncStateEntry, SyncTransport,
} from './types.ts';
export { SyncError, isSyncError, isConflict, type SyncErrorCode } from './errors.ts';
export {
  DEFAULT_ROOT, SYNC_FORMAT, SYNC_FORMAT_VERSION, DEVICE_ID_RE, manifestPath, devicePath, logDir, segmentPath, segmentName,
  parseSegmentPath, isoWeek, splitSegment, newLines, appendLines, segmentIds, eventLine, lineTag,
} from './segments.ts';
export { syncOnce, readLines, writeDeviceFile, testConnection } from './syncOnce.ts';
export { githubTransport, parseRepo, type GithubOptions, type GithubTransport, type FetchLike, type RepoInfo } from './transports/github.ts';
export { MemoryRemote, memoryTransport, type InjectedFailure, type RemoteOp, type RemoteRequest } from './transports/memory.ts';
export { createFakeGithub, type FakeGithubOptions, type FakeRequest, type FakeResponse } from './transports/fake-github.ts';
export { utf8ToBase64, base64ToUtf8 } from './base64.ts';
