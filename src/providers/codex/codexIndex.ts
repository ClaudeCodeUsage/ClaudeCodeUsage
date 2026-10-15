import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';

import {
  dayKeyInZone,
  resolveTimeZone,
  rollingDayKeysFromDayKey,
} from '../../dateKeys';
import {
  NormalizedUsageEvent,
  ProviderLimitSnapshot,
  ProviderThreadRole,
  ProviderTokenCounts,
} from '../providerTypes';
import {
  CodexParserState,
  CodexStructuralEvent,
  createCodexParserState,
  parseCodexLine,
} from './codexParser';
import {
  CODEX_PERIOD_LINEAGE_VERSION,
  CODEX_ROLLING_HOURLY_DAYS,
  CodexFilePeriodIndex,
  CodexFileTodayIndex,
  CodexHourlyDays,
  CodexPeriodMigrationState,
  CodexStructuralSummary,
  CodexTodayMigrationState,
  isCompatibleCodexPeriodLineage,
  isCurrentCodexPeriodLineage,
  pruneCodexHourlyDays,
  reduceCodexRollingHourlySlice,
  reduceCodexStructuralSlice,
  reduceCodexUsageSlice,
  codexPeriodFitsAggregate,
} from './codexPeriodIndex';
import { parseJsonObject, stringField } from './codexSchema';
import { CodexZstdError, type CodexZstdErrorCode } from './codexZstd';
import {
  CodexManifest,
  CodexPersistedManifest,
  CodexRuntimeManifestEntry,
  CodexSourceArea,
  diffCodexManifest,
} from './codexManifest';
import {
  CodexJsonlReader,
  CodexJsonlCursor,
  CODEX_MAX_JSONL_LINE_BYTES,
  defaultCodexJsonlReader,
  scanCodexJsonlLines,
} from './codexJsonlScanner';
import {
  CodexDeduplication,
  classifyCodexSessionDuplicates,
} from './codexDedup';
import {
  NEUTRAL_CODEX_SESSION_KEY,
  PseudonymousIdentityKey,
  pseudonymousIdentityKey,
} from './codexIdentity';
import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';
import { CodexAchievementUsageWindow, CodexAchievementUsageDelta, copyCodexUsageWindow,
  emptyCodexUsageDelta, addCodexOriginEvent, copyCodexUsageDelta,
  codexOriginBaselineReady, finalizeCodexUsageDelta } from './codexAchievementOrigin';
import {
  CODEX_LINEAGE_FINGERPRINT_BYTES,
  CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK,
  CodexLineageTrace,
  createLineageDepthResolver,
} from './codexLineage';
import {
  appendCodexQuotaHistory,
  CODEX_FILE_QUOTA_HISTORY_LIMIT,
  CODEX_QUOTA_HISTORY_LIMIT,
  codexQuotaObservationsFromLimit,
  CodexQuotaObservation,
  sanitizeCodexQuotaHistory,
} from './codexQuotaHistory';
import {
  CODEX_UTC_HOUR_PROOF_VERSION,
  MAX_CODEX_HOURS_PER_FILE,
  CodexHourProof,
  CanonicalCodexOutputHours,
  addCodexOutputHourInPlace,
  canonicalCodexOutputHours,
} from './codexHourProof';

export {
  CodexPeriodMigrationState,
  CodexStructuralSummary,
} from './codexPeriodIndex';
export type { CodexQuotaObservation } from './codexQuotaHistory';

export interface CodexFileAggregate {
  total: ProviderTokenCounts;
  byDay: Record<string, ProviderTokenCounts>;
  byModel: Record<string, ProviderTokenCounts>;
  byEffort: Record<string, ProviderTokenCounts>;
  session: {
    sessionKey: string;
    parentSessionKey?: string;
    projectKey?: string;
    projectName?: string;
    projectDirectoryName?: string;
    agentNickname?: string;
    sessionTitle?: string;
    role: ProviderThreadRole;
    startedAt?: number;
    endedAt?: number;
  };
  structural: CodexStructuralSummary;
  period?: CodexFilePeriodIndex;
  /** Runtime-only current-source calendar provenance; never persisted as index proof. */
  achievementPeriodWitness?: {
    size: number;
    offset: number;
    expectedPrefixEvents: number;
    timeZone: string;
  };
  today?: CodexFileTodayIndex;
}

export interface CodexFileContribution {
  fileKey: string;
  sourceArea?: CodexSourceArea;
  /** size/offset remain decoded-byte coordinates; these describe on-disk bytes. */
  compression?: 'zstd';
  storageSize?: number;
  storageCtimeMs?: number;
  /** Present only after the exact physical representation reached verified EOF. */
  compressionVerified?: true;
  /** A deterministic failure of this exact physical representation, never usage. */
  compressionFailure?: { version: 1; code: CodexTerminalCompressionFailureCode };
  size: number;
  mtimeMs: number;
  dev?: number;
  ino?: number;
  offset: number;
  discardingOversizedLine: boolean;
  parserState: CodexParserState;
  lineage?: CodexLineageTrace;
  lineageReconciliation?: CodexLineageReconciliationState;
  aggregate: CodexFileAggregate;
  limit?: ProviderLimitSnapshot;
  limits?: Record<string, ProviderLimitSnapshot>;
  /** Small neutral history of weekly reset observations found in this file. */
  quotaHistory?: CodexQuotaObservation[];
  qualityFlags: string[];
  identityChecked?: boolean;
  periodMigration?: CodexPeriodMigrationState;
  todayMigration?: CodexTodayMigrationState;
  hourProof?: CodexHourProof;
  hourProofMigration?: CodexHourProofMigrationState;
}

export interface CodexHourProofMigrationState extends CodexJsonlCursor {
  version: typeof CODEX_UTC_HOUR_PROOF_VERSION;
  prefixEvents: number;
  tokenEventsSeen: number;
  parserState: CodexParserState;
  hours: number[];
  overflow?: boolean;
}

/**
 * A reset-required contribution may have been computed with an obsolete
 * lineage algorithm and is unsafe to present until rebuilt. A plain
 * `stale-file` contribution is different: an append read failed after its
 * previously verified prefix, so that conservative prefix remains usable.
 */
export function isCodexUsageContributionCurrent(
  contribution: CodexFileContribution,
): boolean {
  return !contribution.compressionFailure && !contribution.qualityFlags.includes('stale-reset-required') &&
    (contribution.compression !== 'zstd' || contribution.compressionVerified === true);
}

export interface CodexLineageReconciliationState extends CodexJsonlCursor {
  prefixEvents: number;
  tokenEventsSeen: number;
  parserState: CodexParserState;
  aggregate: CodexFileAggregate;
  qualityFlags: string[];
  hourProofHours?: number[];
  hourProofOverflow?: boolean;
}

// A first-time or legacy backfill receives one large streaming ceiling so a
// multi-gigabyte corpus can converge without hundreds of refresh cycles. This
// is an I/O limit, not a memory allocation. Once coverage is current, recurring
// work returns to the bounded background/foreground ceilings below.
export const CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES = 16_384;
export const CODEX_REFRESH_BACKFILL_MAX_BYTES = 64 * 1024 * 1024 * 1024;
export const CODEX_REFRESH_BACKGROUND_MAX_FILE_PASSES = 64;
export const CODEX_REFRESH_BACKGROUND_MAX_BYTES = 128 * 1024 * 1024;
export const CODEX_REFRESH_FOREGROUND_MAX_FILE_PASSES = 512;
export const CODEX_REFRESH_FOREGROUND_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const CODEX_REFRESH_MIN_BYTES = CODEX_MAX_JSONL_LINE_BYTES + 1;

export interface CodexIndexWorkBudget {
  maxFilePasses: number;
  maxBytes: number;
}

export interface CodexRangeCoverage {
  migratedFiles: number;
  totalFiles: number;
  migratedBytes: number;
  totalBytes: number;
  complete: boolean;
}

export interface CodexPeriodCoverage {
  timeZone: string;
  asOfDay: string;
  last7Days: CodexRangeCoverage;
  last30Days: CodexRangeCoverage;
  allTime: CodexRangeCoverage;
}

export interface CodexTodayCoverage {
  timeZone: string;
  day: string;
  indexedFiles: number;
  totalFiles: number;
  indexedBytes: number;
  totalBytes: number;
  complete: boolean;
}

export interface CodexHourlyDayCoverage {
  day: string;
  indexedFiles: number;
  totalFiles: number;
  indexedBytes: number;
  totalBytes: number;
  complete: boolean;
}

export interface CodexHourlyCoverage {
  timeZone: string;
  asOfDay: string;
  windowDays: number;
  indexedFiles: number;
  totalFiles: number;
  indexedBytes: number;
  totalBytes: number;
  complete: boolean;
  /** Coverage for each civil day that has a verified period contribution. */
  days: Record<string, CodexHourlyDayCoverage>;
}

export interface CodexIndexCoverage {
  indexedFiles: number;
  totalFiles: number;
  indexedBytes: number;
  totalBytes: number;
  complete: boolean;
  identity: CodexIdentityCoverage;
  period: CodexPeriodCoverage;
  /** Missing only on pre-v2.3.1 schema-3 snapshots. */
  hourly?: CodexHourlyCoverage;
  /** Current-day compatibility projection of `hourly`. */
  today: CodexTodayCoverage;
}

export interface CodexIdentityCoverage {
  exactDuplicateFiles: number;
  ambiguousSessionGroups: number;
  complete: boolean;
}

export interface CodexProviderAggregate {
  total: ProviderTokenCounts;
  byDay: Record<string, ProviderTokenCounts>;
  byModel: Record<string, ProviderTokenCounts>;
  byEffort: Record<string, ProviderTokenCounts>;
}

export interface CodexIndexV3 {
  schemaVersion: 3;
  /** Independent persisted generation for migration completion isolation. */
  indexGeneration?: number;
  files: Record<string, CodexFileContribution>;
  aggregate: CodexProviderAggregate;
  coverage: CodexIndexCoverage;
  /** Bounded neutral history retained across file replacement/removal. */
  quotaHistory?: CodexQuotaObservation[];
}

/** @deprecated Compatibility name until the remaining v2 consumers are rewired. */
export type CodexIndexV1 = CodexIndexV3;

export interface CodexIndexIo extends CodexJsonlReader {}

export interface CodexIndexProgress {
  scannedFiles: number;
  totalFiles: number;
  indexedBytes: number;
  totalBytes: number;
  period: CodexPeriodCoverage;
  /** Present once rolling-hour coverage has been normalized or recomputed. */
  hourly?: CodexHourlyCoverage;
}

export interface CodexIndexSchedulingPolicy {
  progressEveryMs: number;
  progressEveryBytes: number;
  checkpointEveryMs: number;
  checkpointEveryBytes: number;
  checkpointEveryFilePasses: number;
  now: () => number;
}

export const DEFAULT_CODEX_INDEX_SCHEDULING: CodexIndexSchedulingPolicy = {
  progressEveryMs: 250,
  progressEveryBytes: 16 * 1024 * 1024,
  // Progress remains frequent and in-memory. Durable checkpoints are much
  // coarser because a large index snapshot can itself be tens of megabytes;
  // writing it for every small group of completed files used to dominate a
  // high-throughput backfill. A crash can lose only the bounded interval below.
  checkpointEveryMs: 10_000,
  checkpointEveryBytes: 2 * 1024 * 1024 * 1024,
  checkpointEveryFilePasses: 256,
  now: Date.now,
};

export type CodexFilePassKind =
  | 'main'
  | 'lineage'
  | 'period'
  | 'today'
  | 'identity';

/** Identity-incomplete or partially migrated histories expose no hour IDs. */
export function codexHourProofSnapshot(
  index: CodexIndexV3,
  nowMs = Date.now(),
): CanonicalCodexOutputHours {
  const canonicalKeys = classifyCodexSessionDuplicates(index.files).canonicalFileKeys;
  const proof = canonicalCodexOutputHours(
    index.files,
    canonicalKeys,
    index.coverage.complete && index.coverage.identity.complete &&
      index.coverage.indexedFiles === index.coverage.totalFiles,
  );
  // A future-dated event in the current UTC hour cannot be distinguished
  // from an already-observed one by the minimal hour ID alone. Count only
  // closed UTC hours, accepting a delay of at most one hour for awards.
  return {
    ...proof,
    hours: proof.hours.filter((hour) => (hour + 1) * 3_600_000 <= nowMs),
    backfillableFiles: index.coverage.identity.complete
      ? [...canonicalKeys].filter((key) => {
          const contribution = index.files[key];
          return contribution && contribution.offset === contribution.size &&
            needsHourProofBackfill(contribution);
        }).length
      : 0,
  };
}

function needsHourProofBackfill(contribution: CodexFileContribution): boolean {
  if (contribution.identityChecked !== true || contribution.discardingOversizedLine ||
      contribution.lineageReconciliation || contribution.hourProofMigration?.overflow ||
      contribution.lineage?.appliedPrefixEvents !== contribution.lineage?.desiredPrefixEvents ||
      contribution.qualityFlags.some((flag) => [
        'stale-file', 'stale-reset-required', 'oversized-jsonl-line',
        'invalid-event-timestamp',
      ].includes(flag))) return false;
  const proof = sanitizeCodexHourProof(contribution.hourProof);
  return !proof || proof.indexedThrough !== contribution.offset ||
    proof.prefixEvents !== contribution.lineage?.desiredPrefixEvents;
}

function hourProofWorkEntries(
  index: CodexIndexV3,
  manifest: CodexManifest,
): CodexRuntimeManifestEntry[] {
  if (!index.coverage.identity.complete) return [];
  const canonical = classifyCodexSessionDuplicates(index.files).canonicalFileKeys;
  return manifest.files.filter((entry) => {
    if (!canonical.has(entry.fileKey)) return false;
    const contribution = index.files[entry.fileKey];
    return !!contribution && contribution.offset === entry.size &&
      needsHourProofBackfill(contribution);
  });
}

/**
 * A self-contained, per-file pass. Runtime paths are sent only to the local
 * worker that reads the file and are never persisted in the index.
 */
export interface CodexFilePassTask {
  taskId: string;
  kind: CodexFilePassKind;
  contribution: CodexFileContribution;
  entry: CodexRuntimeManifestEntry;
  salt: string;
  timeZone: string;
  asOfDay: string;
  endExclusive: number;
  achievementUsageWindow?: CodexAchievementUsageWindow;
}

export type CodexFilePassOutcome =
  | {
      taskId: string;
      ok: true;
      contribution: CodexFileContribution;
      bytesRead: number;
      achievementUsageDelta?: CodexAchievementUsageDelta;
    }
  | { taskId: string; ok: false; failureCode?: CodexZstdErrorCode };

const terminalCompressionCodes = [
  'malformed', 'truncated', 'trailing-data', 'size-mismatch', 'decode-failed', 'size-limit',
  'unknown-size', 'dictionary', 'reserved',
] as const satisfies readonly CodexZstdErrorCode[];
type CodexTerminalCompressionFailureCode = typeof terminalCompressionCodes[number];

/** Fixed enum copying at the worker boundary; never copy Error/message/stack. */
function copyFilePassFailureCode(value: unknown): CodexZstdErrorCode | undefined {
  switch (value) {
    case 'malformed': case 'truncated': case 'trailing-data': case 'size-mismatch':
    case 'decode-failed': case 'size-limit': case 'unknown-size': case 'dictionary': case 'reserved':
    case 'codec-unavailable': case 'replay-limit': case 'invalid-range': case 'invalid-options':
    case 'io-error': case 'aborted': case 'source-changed': return value;
    default: return undefined;
  }
}

export function codexFilePassFailureCode(error: unknown): CodexZstdErrorCode | undefined {
  return error instanceof CodexZstdError ? copyFilePassFailureCode(error.code) : undefined;
}

function terminalCompressionCode(value: unknown): CodexTerminalCompressionFailureCode | undefined {
  return terminalCompressionCodes.find(code => code === value);
}

export type CodexFilePassBatchRunner = (
  tasks: readonly CodexFilePassTask[],
  onOutcome: (outcome: CodexFilePassOutcome) => Promise<void>,
  shouldCancel?: () => boolean,
) => Promise<void>;

export interface CodexIndexUpdateOptions {
  /** Caller-owned accepted observation window, never inferred from refresh triggers. */
  achievementUsageWindow?: CodexAchievementUsageWindow;
  salt: string;
  timeZone: string;
  now?: () => number;
  io?: CodexIndexIo;
  budget?: CodexIndexWorkBudget;
  shouldCancel?: () => boolean;
  onProgress?: (progress: CodexIndexProgress) => void;
  onCheckpoint?: (index: CodexIndexV3) => Promise<void>;
  scheduling?: Partial<CodexIndexSchedulingPolicy>;
  /** Present only for accelerated cold/incomplete backfills. */
  filePassBatch?: CodexFilePassBatchRunner;
  /** False skips unchanged historical lineage/period/hour/identity passes while
   * still allowing the main changed-file and append-tail stage to run. */
  allowHistoricalBackfill?: boolean;
  /** False avoids separate history reads for achievements; existing usage cursors stay intact. */
  allowAchievementHourProof?: boolean;
  /** Internal resolved civil day shared with local file-pass workers. */
  asOfDay?: string;
}

export interface CodexIndexUpdateResult {
  achievementUsageDelta?: CodexAchievementUsageDelta;
  index: CodexIndexV3;
  indexChanged: boolean;
  bodyReads: number;
  failedFiles: number;
  migration: {
    filePasses: number;
    bytesRead: number;
    pending: boolean;
  };
}

export class CodexIndexCancelledError extends Error {
  readonly code = 'cancelled';

  constructor() {
    super('Codex indexing was cancelled');
    this.name = 'CodexIndexCancelledError';
  }
}

export class CodexIndexBudgetError extends Error {
  readonly code = 'invalid-work-budget';

  constructor() {
    super('Codex index byte budget is below the safe minimum');
    this.name = 'CodexIndexBudgetError';
  }
}

const MAX_IDENTITY_BYTES = 256 * 1024;
let lastRecoveryGeneration = 1;

function recoveredIndex(timeZone: string): CodexIndexV3 {
  const index = createEmptyCodexIndex(timeZone);
  lastRecoveryGeneration = Math.max(lastRecoveryGeneration + 1, Date.now());
  index.indexGeneration = lastRecoveryGeneration;
  return index;
}

function zeroTokens(): ProviderTokenCounts {
  return {
    inputTotal: 0,
    cachedInput: 0,
    cacheWriteInput: 0,
    outputTotal: 0,
    reasoningOutput: 0,
    sourceTotal: 0,
  };
}

function emptyAggregate(): CodexProviderAggregate {
  return { total: zeroTokens(), byDay: {}, byModel: {}, byEffort: {} };
}

function emptyStructural(): CodexStructuralSummary {
  return {
    patchCalls: 0,
    toolCalls: 0,
    postPatchToolCalls: 0,
    compactCount: 0,
    taskCompleteCount: 0,
  };
}

function emptyFileAggregate(
  fileKey: string,
  role: ProviderThreadRole,
): CodexFileAggregate {
  return {
    total: zeroTokens(),
    byDay: {},
    byModel: {},
    byEffort: {},
    session: { sessionKey: fileKey, role },
    structural: emptyStructural(),
  };
}

function createLineageTrace(): CodexLineageTrace {
  return {
    fingerprintBlocks: [],
    pendingFingerprints: [],
    tokenEvents: 0,
    desiredPrefixEvents: 0,
    appliedPrefixEvents: 0,
  };
}

function unpackTrailingLineageBlock(lineage: CodexLineageTrace): void {
  if (lineage.pendingFingerprints.length > 0) {
    return;
  }
  const trailing = lineage.fingerprintBlocks[
    lineage.fingerprintBlocks.length - 1
  ];
  if (!trailing) {
    return;
  }
  const bytes = Buffer.from(trailing, 'base64');
  const fingerprints = bytes.length / CODEX_LINEAGE_FINGERPRINT_BYTES;
  if (fingerprints >= CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK) {
    return;
  }
  lineage.fingerprintBlocks.pop();
  for (let offset = 0; offset < bytes.length; offset += CODEX_LINEAGE_FINGERPRINT_BYTES) {
    lineage.pendingFingerprints.push(
      bytes.subarray(offset, offset + CODEX_LINEAGE_FINGERPRINT_BYTES).toString('hex'),
    );
  }
}

function packPendingLineageFingerprints(lineage: CodexLineageTrace): void {
  if (lineage.pendingFingerprints.length === 0) {
    return;
  }
  lineage.fingerprintBlocks.push(
    Buffer.from(lineage.pendingFingerprints.join(''), 'hex').toString('base64'),
  );
  lineage.pendingFingerprints = [];
}

function addLineageToken(
  lineage: CodexLineageTrace,
  tokenKey: string,
): void {
  unpackTrailingLineageBlock(lineage);
  const fingerprint = createHash('sha256')
    .update('\0')
    .update(tokenKey)
    .digest('hex')
    .slice(0, CODEX_LINEAGE_FINGERPRINT_BYTES * 2);
  lineage.pendingFingerprints.push(fingerprint);
  lineage.tokenEvents += 1;
  if (
    lineage.pendingFingerprints.length ===
    CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK
  ) {
    packPendingLineageFingerprints(lineage);
  }
}

export function createEmptyCodexIndex(timeZone = 'UTC'): CodexIndexV3 {
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const asOfDay = dayKeyInZone(new Date(Date.now()), resolvedTimeZone);
  const emptyRange = (): CodexRangeCoverage => ({
    migratedFiles: 0,
    totalFiles: 0,
    migratedBytes: 0,
    totalBytes: 0,
    complete: true,
  });
  return {
    schemaVersion: 3,
    indexGeneration: 1,
    files: {},
    aggregate: emptyAggregate(),
    coverage: {
      indexedFiles: 0,
      totalFiles: 0,
      indexedBytes: 0,
      totalBytes: 0,
      complete: true,
      identity: {
        exactDuplicateFiles: 0,
        ambiguousSessionGroups: 0,
        complete: true,
      },
      period: {
        timeZone: resolvedTimeZone,
        asOfDay,
        last7Days: emptyRange(),
        last30Days: emptyRange(),
        allTime: emptyRange(),
      },
      hourly: {
        timeZone: resolvedTimeZone,
        asOfDay,
        windowDays: CODEX_ROLLING_HOURLY_DAYS,
        indexedFiles: 0,
        totalFiles: 0,
        indexedBytes: 0,
        totalBytes: 0,
        complete: true,
        days: {},
      },
      today: {
        timeZone: resolvedTimeZone,
        day: asOfDay,
        indexedFiles: 0,
        totalFiles: 0,
        indexedBytes: 0,
        totalBytes: 0,
        complete: true,
      },
    },
  };
}

function cloneIndex(index: CodexIndexV3): CodexIndexV3 {
  return sanitizeIndexV2(index);
}

function cloneContribution(
  contribution: CodexFileContribution,
): CodexFileContribution {
  return JSON.parse(JSON.stringify(contribution)) as CodexFileContribution;
}

function addTokens(
  target: ProviderTokenCounts,
  source: ProviderTokenCounts,
): void {
  target.inputTotal += Math.max(0, source.inputTotal);
  target.cachedInput =
    (target.cachedInput ?? 0) + Math.max(0, source.cachedInput ?? 0);
  target.cacheWriteInput =
    (target.cacheWriteInput ?? 0) + Math.max(0, source.cacheWriteInput ?? 0);
  target.outputTotal += Math.max(0, source.outputTotal);
  target.reasoningOutput =
    (target.reasoningOutput ?? 0) + Math.max(0, source.reasoningOutput ?? 0);
  target.sourceTotal =
    (target.sourceTotal ?? 0) + Math.max(0, source.sourceTotal ?? 0);
}

function bucket(
  buckets: Record<string, ProviderTokenCounts>,
  key: string,
): ProviderTokenCounts {
  return (buckets[key] ??= zeroTokens());
}

function dayKey(timestamp: number): string {
  return timestamp > 0
    ? new Date(timestamp).toISOString().slice(0, 10)
    : 'unknown';
}

function observeTimestamp(aggregate: CodexFileAggregate, timestamp: number): void {
  if (timestamp <= 0) {
    return;
  }
  aggregate.session.startedAt = Math.min(
    aggregate.session.startedAt ?? timestamp,
    timestamp,
  );
  aggregate.session.endedAt = Math.max(
    aggregate.session.endedAt ?? timestamp,
    timestamp,
  );
}

function reduceUsage(
  aggregate: CodexFileAggregate,
  event: NormalizedUsageEvent,
): void {
  addTokens(aggregate.total, event.tokens);
  addTokens(bucket(aggregate.byDay, dayKey(event.timestamp)), event.tokens);
  addTokens(bucket(aggregate.byModel, event.model ?? 'unknown'), event.tokens);
  addTokens(bucket(aggregate.byEffort, event.effort ?? 'unknown'), event.tokens);
  observeTimestamp(aggregate, event.timestamp);
}

function reduceStructural(
  aggregate: CodexFileAggregate,
  event: CodexStructuralEvent,
): void {
  const structural = aggregate.structural;
  if (event.kind === 'patch') {
    structural.patchCalls += event.count ?? 1;
  } else if (event.kind === 'tool') {
    structural.toolCalls += event.count ?? 1;
    if (structural.patchCalls > 0) {
      structural.postPatchToolCalls += event.count ?? 1;
    }
  } else if (event.kind === 'compaction') {
    structural.compactCount += event.count ?? 1;
  } else if (event.kind === 'task-complete') {
    structural.taskCompleteCount += event.count ?? 1;
  }
  observeTimestamp(aggregate, event.timestamp);
}

function syncSession(
  aggregate: CodexFileAggregate,
  state: CodexParserState,
): void {
  aggregate.session = {
    ...aggregate.session,
    sessionKey: state.sessionKey,
    ...(state.parentSessionKey
      ? { parentSessionKey: state.parentSessionKey }
      : {}),
    ...(state.projectKey ? { projectKey: state.projectKey } : {}),
    ...(state.projectName ? { projectName: state.projectName } : {}),
    ...(state.projectDirectoryName
      ? { projectDirectoryName: state.projectDirectoryName }
      : {}),
    ...(state.agentNickname ? { agentNickname: state.agentNickname } : {}),
    role: state.role,
  };
}

function uniqueFlags(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort();
}

/** A valid checkpoint may still be skipping inherited events. Resuming that
 * scan is not permission to publish its dates; promotion still requires the
 * entire prefix and source cursor below. */
function resumablePeriodMigration(
  contribution: CodexFileContribution,
  timeZone: string,
): CodexPeriodMigrationState | undefined {
  const migration = contribution.periodMigration;
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  const seen = migration?.tokenEventsSeen;
  if (!migration || migration.timeZone !== timeZone || migration.prefixEvents !== prefixEvents ||
      typeof seen !== 'number' || !Number.isSafeInteger(seen) || seen < 0 ||
      !Number.isSafeInteger(migration.offset) || migration.offset < 0 || migration.offset > contribution.offset ||
      (seen < prefixEvents && Object.keys(migration.days).length > 0)) return undefined;
  return migration;
}

function promoteCaughtUpPeriod(
  contribution: CodexFileContribution,
  timeZone: string,
): void {
  const migration = contribution.periodMigration;
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  if (
    migration?.timeZone !== timeZone ||
    migration.prefixEvents !== prefixEvents ||
    !Number.isFinite(migration.tokenEventsSeen) ||
    (migration.tokenEventsSeen ?? 0) < prefixEvents ||
    migration.offset < contribution.offset ||
    migration.discardingOversizedLine
  ) {
    return;
  }
  contribution.aggregate.period = {
    timeZone,
    indexedThrough: contribution.offset,
    days: migration.days,
    lineageVersion: CODEX_PERIOD_LINEAGE_VERSION,
    lineagePrefixEvents: prefixEvents,
  };
  contribution.qualityFlags = uniqueFlags(
    contribution.qualityFlags,
    migration.qualityFlags,
  );
  delete contribution.periodMigration;
}

function emptyTodayIndex(
  day: string,
  timeZone: string,
  indexedThrough = 0,
): CodexFileTodayIndex {
  return {
    day,
    timeZone,
    indexedThrough,
    hours: {},
    windowDays: CODEX_ROLLING_HOURLY_DAYS,
    days: {},
  };
}

function rollingHourlyDaySet(day: string): Set<string> {
  return new Set(
    rollingDayKeysFromDayKey(day, CODEX_ROLLING_HOURLY_DAYS),
  );
}

function isRollingTodayIndex(
  value: CodexFileTodayIndex | undefined,
  timeZone: string,
): value is CodexFileTodayIndex & { days: CodexHourlyDays } {
  return Boolean(
    value &&
    value.timeZone === timeZone &&
    value.windowDays === CODEX_ROLLING_HOURLY_DAYS &&
    value.days,
  );
}

function syncTodayProjection(
  value: CodexFileTodayIndex & { days: CodexHourlyDays },
): void {
  pruneCodexHourlyDays(value.days, rollingHourlyDaySet(value.day));
  value.hours = value.days[value.day] ?? {};
}

/**
 * A forward civil-day rollover needs only pruning: unchanged files cannot have
 * events in the newly entered days. Moving the clock backwards can require
 * days that were previously evicted, so it deliberately falls back to the
 * resumable migration pass.
 */
function reanchorRollingToday(
  value: CodexFileTodayIndex | undefined,
  day: string,
  timeZone: string,
): boolean {
  if (!isRollingTodayIndex(value, timeZone) || day < value.day) {
    return false;
  }
  value.day = day;
  syncTodayProjection(value);
  return true;
}

function promoteCaughtUpToday(
  contribution: CodexFileContribution,
  day: string,
  timeZone: string,
): void {
  const migration = contribution.todayMigration;
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  if (
    migration?.day !== day ||
    migration.timeZone !== timeZone ||
    migration.windowDays !== CODEX_ROLLING_HOURLY_DAYS ||
    !migration.days ||
    migration.prefixEvents !== prefixEvents ||
    migration.offset < contribution.offset ||
    migration.discardingOversizedLine
  ) {
    return;
  }
  contribution.aggregate.today = {
    day,
    timeZone,
    indexedThrough: contribution.offset,
    hours: migration.days[day] ?? {},
    windowDays: CODEX_ROLLING_HOURLY_DAYS,
    days: migration.days,
  };
  syncTodayProjection(
    contribution.aggregate.today as CodexFileTodayIndex & {
      days: CodexHourlyDays;
    },
  );
  contribution.qualityFlags = uniqueFlags(
    contribution.qualityFlags,
    migration.qualityFlags,
  );
  delete contribution.todayMigration;
}

function pseudonymizer(salt: string): (raw: string) => string {
  return (raw) => pseudonymousIdentityKey(salt, raw);
}

function defaultIo(): CodexIndexIo {
  return defaultCodexJsonlReader;
}

function previousManifest(index: CodexIndexV3): CodexPersistedManifest {
  return Object.fromEntries(
    Object.values(index.files).flatMap((file) =>
      file.sourceArea
        ? [[
            file.fileKey,
            {
              fileKey: file.fileKey,
              sourceArea: file.sourceArea,
              size: file.size,
              mtimeMs: file.mtimeMs,
              dev: file.dev,
              ino: file.ino,
              ...(file.compression === 'zstd' ? { compression: file.compression,
                storageSize: file.storageSize, storageCtimeMs: file.storageCtimeMs } : {}),
            },
          ]]
        : [],
    ),
  );
}

function contributionFor(
  entry: CodexRuntimeManifestEntry,
  timeZone: string,
  flags: string[] = [],
): CodexFileContribution {
  const parserState = createCodexParserState(entry.fileKey);
  return {
    fileKey: entry.fileKey,
    sourceArea: entry.sourceArea,
    size: 0,
    mtimeMs: 0,
    dev: entry.dev,
    ino: entry.ino,
    ...compressedSourceMetadata(entry),
    offset: 0,
    discardingOversizedLine: false,
    parserState,
    lineage: createLineageTrace(),
    hourProof: {
      version: CODEX_UTC_HOUR_PROOF_VERSION,
      indexedThrough: 0,
      prefixEvents: 0,
      hours: [],
    },
    aggregate: {
      ...emptyFileAggregate(entry.fileKey, parserState.role),
      // A new empty cursor is built by the current reducer from byte zero.
      // Unlike a persisted legacy slice, it needs no second validation pass.
      period: { timeZone, indexedThrough: 0, days: {},
        lineageVersion: CODEX_PERIOD_LINEAGE_VERSION, lineagePrefixEvents: 0 },
    },
    qualityFlags: [...flags],
  };
}

interface CodexFilePassResult {
  achievementUsageDelta?: CodexAchievementUsageDelta;
  contribution: CodexFileContribution;
  bytesRead: number;
}

function compressedSourceMetadata(entry: CodexRuntimeManifestEntry):
  Pick<CodexFileContribution, 'compression' | 'storageSize' | 'storageCtimeMs'> {
  return entry.compression === 'zstd' ? { compression: 'zstd', storageSize: entry.storageSize,
    storageCtimeMs: entry.storageCtimeMs } : {};
}

function validCompressionFingerprint(row: Record<string, unknown>): boolean {
  return row.compression === 'zstd' &&
    typeof row.size === 'number' && Number.isSafeInteger(row.size) && row.size >= 0 &&
    typeof row.storageSize === 'number' && Number.isSafeInteger(row.storageSize) && row.storageSize > 0 &&
    typeof row.mtimeMs === 'number' && Number.isFinite(row.mtimeMs) &&
    typeof row.storageCtimeMs === 'number' && Number.isFinite(row.storageCtimeMs) && row.storageCtimeMs > 0 &&
    [row.dev, row.ino].every(value => value === undefined ||
      typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function hasCurrentCompressionFailure(contribution: CodexFileContribution | undefined,
  entry: CodexRuntimeManifestEntry): boolean {
  return !!contribution && contribution.compressionFailure?.version === 1 &&
    terminalCompressionCode(contribution.compressionFailure.code) !== undefined &&
    contribution.compression === 'zstd' && entry.compression === 'zstd' &&
    contribution.fileKey === entry.fileKey && contribution.size === entry.size &&
    contribution.storageSize === entry.storageSize && contribution.mtimeMs === entry.mtimeMs &&
    contribution.storageCtimeMs === entry.storageCtimeMs &&
    contribution.dev === entry.dev && contribution.ino === entry.ino;
}

/** Rebuild a metadata-only empty contribution. Never retain a failed draft's
 * parser state, tokens, quota observations, lineage or period/hour witnesses. */
function compressionFailureContribution(
  entry: Pick<CodexFileContribution, 'fileKey' | 'sourceArea' | 'size' | 'mtimeMs' |
    'storageSize' | 'storageCtimeMs' | 'dev' | 'ino'>,
  code: CodexTerminalCompressionFailureCode,
): CodexFileContribution {
  // This path is also a persistence sanitizer: construct the neutral state
  // through the explicit local DTO whitelist, not an opaque imported object.
  const parserState = sanitizeParserState(undefined, entry.fileKey);
  return {
    fileKey: entry.fileKey, sourceArea: entry.sourceArea, compression: 'zstd',
    size: entry.size, mtimeMs: entry.mtimeMs, storageSize: entry.storageSize,
    storageCtimeMs: entry.storageCtimeMs, dev: entry.dev, ino: entry.ino,
    compressionFailure: { version: 1, code }, offset: 0, discardingOversizedLine: false,
    parserState, aggregate: emptyFileAggregate(entry.fileKey, parserState.role),
    qualityFlags: ['stale-file', 'stale-reset-required'],
  };
}

/** A cancellation after the final decoded chunk can leave an unverified draft.
 * Revalidate rather than promoting an offset-equals-size claim. */
function compressedDraftNeedsRestart(contribution: CodexFileContribution | undefined): boolean {
  return contribution?.compression === 'zstd' && contribution.compressionVerified !== true &&
    contribution.offset >= contribution.size;
}

/** Compressed history is an immutable whole-frame task. Permit at most the
 * first file in a refresh to exceed the soft byte budget (codec hard caps still
 * apply), otherwise defer it. This avoids replay-prefix budget starvation. */
function compressedMainPassEnd(entry: CodexRuntimeManifestEntry, start: number, remaining: number, first: boolean): number {
  if (entry.compression === 'zstd') return entry.size <= remaining || first ? entry.size : start;
  return Math.min(entry.size, start + remaining);
}

type ContributionChunkHandler = (
  contribution: CodexFileContribution,
  bytesRead: number,
) => Promise<void>;

async function updateContribution(
  contribution: CodexFileContribution,
  entry: CodexRuntimeManifestEntry,
  options: CodexIndexUpdateOptions,
  io: CodexIndexIo,
  endExclusive: number,
  onChunk: ContributionChunkHandler,
): Promise<CodexFilePassResult> {
  const usageWindow = entry.compression === 'zstd' ? undefined : copyCodexUsageWindow(options.achievementUsageWindow);
  let usageDelta = usageWindow ? emptyCodexUsageDelta(usageWindow) : undefined;
  let parserState = contribution.parserState;
  const aggregate = contribution.aggregate;
  const lineage = contribution.lineage ?? createLineageTrace();
  const pseudonymize = pseudonymizer(options.salt);
  let limit = contribution.limit;
  const limits = { ...(contribution.limits ?? {}) };
  let quotaHistory = appendCodexQuotaHistory(
    contribution.quotaHistory ?? [],
    [],
    CODEX_FILE_QUOTA_HISTORY_LIMIT,
  );
  const timeZone = resolveTimeZone(options.timeZone);
  const asOfDay = options.asOfDay ?? dayKeyInZone(
    new Date((options.now ?? Date.now)()),
    timeZone,
  );
  const rollingDays = rollingHourlyDaySet(asOfDay);
  const desiredPrefixEvents = lineage.desiredPrefixEvents ?? 0;
  const advancePeriod =
    aggregate.period?.timeZone === timeZone &&
    aggregate.period.indexedThrough === contribution.offset &&
    lineage.appliedPrefixEvents === desiredPrefixEvents &&
    isCompatibleCodexPeriodLineage(aggregate.period, desiredPrefixEvents) &&
    codexPeriodFitsAggregate(aggregate.period, aggregate.total);
  const activeHourProof = contribution.hourProof?.version === CODEX_UTC_HOUR_PROOF_VERSION &&
    contribution.hourProof.indexedThrough === contribution.offset &&
    contribution.hourProof.prefixEvents === desiredPrefixEvents &&
    lineage.appliedPrefixEvents === desiredPrefixEvents &&
    !contribution.lineageReconciliation
      ? contribution.hourProof
      : undefined;
  if (aggregate.today && !reanchorRollingToday(aggregate.today, asOfDay, timeZone)) {
    delete aggregate.today;
  }
  if (!aggregate.today && contribution.offset === 0) {
    aggregate.today = emptyTodayIndex(asOfDay, timeZone);
  }
  const activeToday =
    isRollingTodayIndex(aggregate.today, timeZone) &&
      aggregate.today.day === asOfDay &&
      aggregate.today.indexedThrough === contribution.offset
      ? aggregate.today
      : undefined;
  let invalidEventTimestamp = false;
  let activeHourProofOverflow = false;

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => {
    syncSession(aggregate, parserState);
    if (activeToday) {
      activeToday.indexedThrough = cursor.offset;
      syncTodayProjection(activeToday);
    }
    if (activeHourProof) activeHourProof.indexedThrough = cursor.offset;
    return {
      ...contribution,
      fileKey: entry.fileKey,
      sourceArea: entry.sourceArea,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      dev: entry.dev,
      ino: entry.ino,
      ...compressedSourceMetadata(entry),
      ...(entry.compression === 'zstd' ? { compressionVerified: undefined } : {}),
      offset: cursor.offset,
      discardingOversizedLine: cursor.discardingOversizedLine,
      parserState,
      lineage,
      aggregate,
      ...(activeHourProof && !activeHourProofOverflow ? {
        hourProof: { ...activeHourProof, hours: [...activeHourProof.hours] },
      } : {}),
      ...(activeHourProofOverflow ? {
        hourProof: undefined,
        hourProofMigration: {
          version: CODEX_UTC_HOUR_PROOF_VERSION,
          prefixEvents: desiredPrefixEvents,
          tokenEventsSeen: 0,
          offset: cursor.offset,
          discardingOversizedLine: cursor.discardingOversizedLine,
          parserState,
          hours: [],
          overflow: true,
        },
      } : {}),
      limit,
      limits,
      ...(quotaHistory.length > 0 ? { quotaHistory } : {}),
      qualityFlags: uniqueFlags(
        contribution.qualityFlags,
        parserState.qualityFlags,
        invalidEventTimestamp ? ['invalid-event-timestamp'] : [],
      ),
      identityChecked: true,
    };
  };

  const scan = await scanCodexJsonlLines(
    entry,
    io,
    {
      offset: contribution.offset,
      discardingOversizedLine: contribution.discardingOversizedLine,
    },
    endExclusive,
    (line) => {
      if (line.trim() !== '') {
        const parsed = parseCodexLine(line, parserState, pseudonymize);
        parserState = parsed.state;
        if (parsed.lineageTokenKey) {
          addLineageToken(lineage, parsed.lineageTokenKey);
        }
        for (const event of parsed.events) {
          if (usageDelta && !addCodexOriginEvent(usageDelta, event)) usageDelta = undefined;
          reduceUsage(aggregate, event);
          if (activeHourProof) {
            const added = addCodexOutputHourInPlace(
              activeHourProof.hours, event.timestamp, event.tokens.outputTotal,
            );
            if (!added) activeHourProofOverflow = true;
          }
          if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
            invalidEventTimestamp = true;
          } else if (advancePeriod && aggregate.period) {
            reduceCodexUsageSlice(aggregate.period.days, event, timeZone);
          }
          if (activeToday) {
            reduceCodexRollingHourlySlice(
              activeToday.days,
              event,
              rollingDays,
              timeZone,
            );
          }
        }
        if (parsed.structural) {
          reduceStructural(aggregate, parsed.structural);
          if (
            !Number.isFinite(parsed.structural.timestamp) ||
            parsed.structural.timestamp <= 0
          ) {
            invalidEventTimestamp = true;
          } else if (advancePeriod && aggregate.period) {
            reduceCodexStructuralSlice(
              aggregate.period.days,
              parsed.structural,
              timeZone,
            );
          }
        }
        if (!limit || (parsed.limit?.observedAt ?? 0) >= limit.observedAt) {
          limit = parsed.limit ?? limit;
        }
        if (parsed.limit) {
          quotaHistory = appendCodexQuotaHistory(
            quotaHistory,
            codexQuotaObservationsFromLimit(parsed.limit),
            CODEX_FILE_QUOTA_HISTORY_LIMIT,
          );
          const limitKey =
            parsed.limit.limitId ?? parsed.limit.limitName ?? 'default';
          const previousLimit = limits[limitKey];
          if (
            !previousLimit ||
            parsed.limit.observedAt >= previousLimit.observedAt
          ) {
            limits[limitKey] = parsed.limit;
          }
        }
      }
    },
    async (progress) => {
      await onChunk(snapshot(progress.cursor), progress.bytesRead);
    },
  );

  if (!scan.reachedEnd) {
    throw new Error('Codex log changed during indexing');
  }

  if (advancePeriod && aggregate.period) {
    aggregate.period.indexedThrough = scan.cursor.offset;
  }
  if (activeToday) {
    activeToday.indexedThrough = scan.cursor.offset;
    syncTodayProjection(activeToday);
  }
  if (
    scan.cursor.offset >= entry.size &&
    !scan.cursor.discardingOversizedLine
  ) {
    packPendingLineageFingerprints(lineage);
  }
  const updated = snapshot(scan.cursor);
  if (entry.compression === 'zstd' && scan.cursor.offset === entry.size && !scan.cursor.discardingOversizedLine) {
    updated.compressionVerified = true;
  }
  updated.qualityFlags = uniqueFlags(
    updated.qualityFlags,
    scan.oversizedLines > 0 ? ['oversized-jsonl-line'] : [],
    scan.finalLineDiscarded ? ['invalid-json'] : [],
  );
  return { contribution: updated, bytesRead: scan.bytesRead,
    ...(usageDelta && usageDelta.processed > 0 ? { achievementUsageDelta: usageDelta } : {}) };
}

function promoteCaughtUpLineage(
  contribution: CodexFileContribution,
): void {
  const reconciliation = contribution.lineageReconciliation;
  const lineage = contribution.lineage;
  if (
    !reconciliation ||
    !lineage ||
    reconciliation.prefixEvents !== lineage.desiredPrefixEvents ||
    reconciliation.offset < contribution.offset ||
    reconciliation.discardingOversizedLine
  ) {
    return;
  }
  contribution.aggregate = reconciliation.aggregate;
  lineage.appliedPrefixEvents = reconciliation.prefixEvents;
  if (reconciliation.hourProofHours && !reconciliation.hourProofOverflow) {
    contribution.hourProof = {
      version: CODEX_UTC_HOUR_PROOF_VERSION,
      indexedThrough: contribution.offset,
      prefixEvents: reconciliation.prefixEvents,
      hours: reconciliation.hourProofHours,
    };
    delete contribution.hourProofMigration;
  } else if (reconciliation.hourProofOverflow) {
    delete contribution.hourProof;
    contribution.hourProofMigration = {
      version: CODEX_UTC_HOUR_PROOF_VERSION,
      prefixEvents: reconciliation.prefixEvents,
      tokenEventsSeen: reconciliation.tokenEventsSeen,
      offset: contribution.offset,
      discardingOversizedLine: false,
      parserState: reconciliation.parserState,
      hours: [],
      overflow: true,
    };
  }
  if (contribution.aggregate.period) {
    contribution.aggregate.period.lineageVersion = CODEX_PERIOD_LINEAGE_VERSION;
    contribution.aggregate.period.lineagePrefixEvents = reconciliation.prefixEvents;
  }
  contribution.qualityFlags = uniqueFlags(
    contribution.qualityFlags,
    reconciliation.qualityFlags,
  );
  delete contribution.lineageReconciliation;
}

function promoteCaughtUpHourProof(contribution: CodexFileContribution): void {
  const draft = contribution.hourProofMigration;
  if (!draft || draft.version !== CODEX_UTC_HOUR_PROOF_VERSION ||
      draft.overflow || draft.discardingOversizedLine ||
      draft.offset < contribution.offset || contribution.lineageReconciliation ||
      draft.tokenEventsSeen < draft.prefixEvents ||
      contribution.lineage?.appliedPrefixEvents !== draft.prefixEvents ||
      contribution.lineage.desiredPrefixEvents !== draft.prefixEvents) return;
  contribution.hourProof = {
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    indexedThrough: contribution.offset,
    prefixEvents: draft.prefixEvents,
    hours: draft.hours,
  };
  delete contribution.hourProofMigration;
}

async function reconcileContributionLineage(
  contribution: CodexFileContribution,
  entry: CodexRuntimeManifestEntry,
  options: CodexIndexUpdateOptions,
  io: CodexIndexIo,
  endExclusive: number,
  onChunk: ContributionChunkHandler,
): Promise<CodexFilePassResult> {
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  const timeZone = resolveTimeZone(options.timeZone);
  const asOfDay = options.asOfDay ?? dayKeyInZone(
    new Date((options.now ?? Date.now)()),
    timeZone,
  );
  const rollingDays = rollingHourlyDaySet(asOfDay);
  const initial = contribution.lineageReconciliation?.prefixEvents ===
      prefixEvents &&
      isRollingTodayIndex(
        contribution.lineageReconciliation.aggregate.today,
        timeZone,
      ) &&
      contribution.lineageReconciliation.aggregate.today.day === asOfDay
    ? contribution.lineageReconciliation
    : {
        prefixEvents,
        tokenEventsSeen: 0,
        offset: 0,
        discardingOversizedLine: false,
        parserState: createCodexParserState(entry.fileKey),
        aggregate: {
          ...emptyFileAggregate(entry.fileKey, 'root'),
          period: { timeZone, indexedThrough: 0, days: {} },
          today: emptyTodayIndex(asOfDay, timeZone),
        },
        qualityFlags: [],
        hourProofHours: [],
      };
  let parserState = initial.parserState;
  let tokenEventsSeen = initial.tokenEventsSeen;
  const aggregate = initial.aggregate;
  let invalidEventTimestamp = false;
  let hourProofHours = initial.hourProofHours ? [...initial.hourProofHours] : undefined;
  let hourProofOverflow = initial.hourProofOverflow === true;
  const pseudonymize = pseudonymizer(options.salt);
  let quotaHistory = appendCodexQuotaHistory(
    contribution.quotaHistory ?? [],
    [],
    CODEX_FILE_QUOTA_HISTORY_LIMIT,
  );

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => {
    syncSession(aggregate, parserState);
    if (aggregate.period) {
      aggregate.period.indexedThrough = cursor.offset;
    }
    if (aggregate.today) {
      aggregate.today.indexedThrough = cursor.offset;
      if (isRollingTodayIndex(aggregate.today, timeZone)) {
        syncTodayProjection(aggregate.today);
      }
    }
    return {
      ...contribution,
      ...(quotaHistory.length > 0 ? { quotaHistory } : {}),
      lineageReconciliation: {
        prefixEvents,
        tokenEventsSeen,
        offset: cursor.offset,
        discardingOversizedLine: cursor.discardingOversizedLine,
        parserState,
        aggregate,
        qualityFlags: uniqueFlags(
          initial.qualityFlags,
          parserState.qualityFlags,
          invalidEventTimestamp ? ['invalid-event-timestamp'] : [],
        ),
        ...(hourProofHours ? { hourProofHours: hourProofOverflow ? [] : [...hourProofHours] } : {}),
        ...(hourProofOverflow ? { hourProofOverflow: true } : {}),
      },
    };
  };

  const scan = await scanCodexJsonlLines(
    entry,
    io,
    {
      offset: initial.offset,
      discardingOversizedLine: initial.discardingOversizedLine,
    },
    endExclusive,
    (line) => {
      if (line.trim() === '') {
        return;
      }
      const parsed = parseCodexLine(line, parserState, pseudonymize);
      parserState = parsed.state;
      if (parsed.limit) {
        quotaHistory = appendCodexQuotaHistory(
          quotaHistory,
          codexQuotaObservationsFromLimit(parsed.limit),
          CODEX_FILE_QUOTA_HISTORY_LIMIT,
        );
      }
      if (parsed.lineageTokenKey) {
        tokenEventsSeen += 1;
      }
      const includeUsage = tokenEventsSeen > prefixEvents;
      if (includeUsage) {
        for (const event of parsed.events) {
          reduceUsage(aggregate, event);
          if (hourProofHours && !hourProofOverflow) {
            const added = addCodexOutputHourInPlace(
              hourProofHours, event.timestamp, event.tokens.outputTotal,
            );
            if (!added) hourProofOverflow = true;
          }
          if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
            invalidEventTimestamp = true;
          } else if (aggregate.period) {
            reduceCodexUsageSlice(aggregate.period.days, event, timeZone);
          }
          if (isRollingTodayIndex(aggregate.today, timeZone)) {
            reduceCodexRollingHourlySlice(
              aggregate.today.days,
              event,
              rollingDays,
              timeZone,
            );
          }
        }
      }
      if (parsed.structural && tokenEventsSeen >= prefixEvents) {
        reduceStructural(aggregate, parsed.structural);
        if (
          !Number.isFinite(parsed.structural.timestamp) ||
          parsed.structural.timestamp <= 0
        ) {
          invalidEventTimestamp = true;
        } else if (aggregate.period) {
          reduceCodexStructuralSlice(
            aggregate.period.days,
            parsed.structural,
            timeZone,
          );
        }
      }
    },
    async (progress) => {
      await onChunk(snapshot(progress.cursor), progress.bytesRead);
    },
  );
  if (!scan.reachedEnd) {
    throw new Error('Codex log changed during lineage reconciliation');
  }
  const updated = snapshot(scan.cursor);
  if (updated.lineageReconciliation && scan.oversizedLines > 0) {
    updated.lineageReconciliation.qualityFlags = uniqueFlags(
      updated.lineageReconciliation.qualityFlags,
      ['oversized-jsonl-line'],
    );
  }
  promoteCaughtUpLineage(updated);
  return { contribution: updated, bytesRead: scan.bytesRead };
}

async function migrateContributionPeriod(
  contribution: CodexFileContribution,
  entry: CodexRuntimeManifestEntry,
  options: CodexIndexUpdateOptions,
  io: CodexIndexIo,
  endExclusive: number,
  onChunk: ContributionChunkHandler,
): Promise<CodexFilePassResult> {
  const timeZone = resolveTimeZone(options.timeZone);
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  const savedMigration = resumablePeriodMigration(contribution, timeZone);
  const initial: CodexPeriodMigrationState = savedMigration
    ? savedMigration
    : {
        timeZone,
        prefixEvents,
        tokenEventsSeen: 0,
        offset: 0,
        discardingOversizedLine: false,
        parserState: createCodexParserState(entry.fileKey),
        days: {},
        qualityFlags: [],
      };
  let parserState = initial.parserState;
  const days = initial.days;
  let tokenEventsSeen = initial.tokenEventsSeen ?? 0;
  let invalidEventTimestamp = false;
  const pseudonymize = pseudonymizer(options.salt);
  let quotaHistory = appendCodexQuotaHistory(
    contribution.quotaHistory ?? [],
    [],
    CODEX_FILE_QUOTA_HISTORY_LIMIT,
  );

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => ({
    ...contribution,
    ...(quotaHistory.length > 0 ? { quotaHistory } : {}),
    aggregate: {
      ...contribution.aggregate,
      // A compatible legacy slice can still serve ordinary usage while its
      // stronger calendar proof is rebuilt. Only the completed body pass may
      // replace it with current lineage markers.
      period: isReadableCodexPeriod(contribution, timeZone)
        ? contribution.aggregate.period : undefined,
    },
    periodMigration: {
      timeZone,
      prefixEvents,
      tokenEventsSeen,
      offset: cursor.offset,
      discardingOversizedLine: cursor.discardingOversizedLine,
      parserState,
      days,
      qualityFlags: uniqueFlags(
        initial.qualityFlags,
        parserState.qualityFlags,
        invalidEventTimestamp ? ['invalid-event-timestamp'] : [],
      ),
    },
  });

  const scan = await scanCodexJsonlLines(
    entry,
    io,
    {
      offset: initial.offset,
      discardingOversizedLine: initial.discardingOversizedLine,
    },
    endExclusive,
    (line) => {
      if (line.trim() === '') {
        return;
      }
      const parsed = parseCodexLine(line, parserState, pseudonymize);
      parserState = parsed.state;
      if (parsed.limit) {
        quotaHistory = appendCodexQuotaHistory(
          quotaHistory,
          codexQuotaObservationsFromLimit(parsed.limit),
          CODEX_FILE_QUOTA_HISTORY_LIMIT,
        );
      }
      if (parsed.lineageTokenKey) {
        tokenEventsSeen += 1;
      }
      if (tokenEventsSeen > prefixEvents) {
        for (const event of parsed.events) {
          if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
            invalidEventTimestamp = true;
          } else {
            reduceCodexUsageSlice(days, event, timeZone);
          }
        }
      }
      if (parsed.structural && tokenEventsSeen >= prefixEvents) {
        if (
          !Number.isFinite(parsed.structural.timestamp) ||
          parsed.structural.timestamp <= 0
        ) {
          invalidEventTimestamp = true;
        } else {
          reduceCodexStructuralSlice(days, parsed.structural, timeZone);
        }
      }
    },
    async (progress) => {
      await onChunk(snapshot(progress.cursor), progress.bytesRead);
    },
  );
  if (!scan.reachedEnd) {
    throw new Error('Codex log changed during period migration');
  }
  const updated = snapshot(scan.cursor);
  if (updated.periodMigration && scan.oversizedLines > 0) {
    updated.periodMigration.qualityFlags = uniqueFlags(
      updated.periodMigration.qualityFlags,
      ['oversized-jsonl-line'],
    );
  }
  promoteCaughtUpPeriod(updated, timeZone);
  return { contribution: updated, bytesRead: scan.bytesRead };
}

/** One-time historical UTC hour scan; its draft is safe to checkpoint mid-file. */
async function migrateContributionHourProof(
  contribution: CodexFileContribution,
  entry: CodexRuntimeManifestEntry,
  options: CodexIndexUpdateOptions,
  io: CodexIndexIo,
  endExclusive: number,
  onChunk: ContributionChunkHandler,
): Promise<CodexFilePassResult> {
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  const saved = contribution.hourProofMigration;
  const initial: CodexHourProofMigrationState = saved?.version === CODEX_UTC_HOUR_PROOF_VERSION &&
      saved.prefixEvents === prefixEvents && !saved.overflow
    ? saved
    : {
        version: CODEX_UTC_HOUR_PROOF_VERSION,
        prefixEvents,
        tokenEventsSeen: 0,
        offset: 0,
        discardingOversizedLine: false,
        parserState: createCodexParserState(entry.fileKey),
        hours: [],
      };
  let parserState = initial.parserState;
  let tokenEventsSeen = initial.tokenEventsSeen;
  const hours = [...initial.hours];
  let overflow = false;
  const pseudonymize = pseudonymizer(options.salt);
  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => ({
    ...contribution,
    hourProof: undefined,
    hourProofMigration: {
      version: CODEX_UTC_HOUR_PROOF_VERSION,
      prefixEvents,
      tokenEventsSeen,
      offset: cursor.offset,
      discardingOversizedLine: cursor.discardingOversizedLine,
      parserState,
      hours: overflow ? [] : [...hours],
      ...(overflow ? { overflow: true } : {}),
    },
  });
  const scan = await scanCodexJsonlLines(
    entry,
    io,
    { offset: initial.offset, discardingOversizedLine: initial.discardingOversizedLine },
    endExclusive,
    (line) => {
      if (line.trim() === '') return;
      const parsed = parseCodexLine(line, parserState, pseudonymize);
      parserState = parsed.state;
      if (parsed.lineageTokenKey) tokenEventsSeen += 1;
      if (tokenEventsSeen <= prefixEvents || overflow) return;
      for (const event of parsed.events) {
        if (!addCodexOutputHourInPlace(hours, event.timestamp, event.tokens.outputTotal)) {
          overflow = true;
          break;
        }
      }
    },
    async (progress) => { await onChunk(snapshot(progress.cursor), progress.bytesRead); },
  );
  if (!scan.reachedEnd) throw new Error('Codex log changed during hour proof migration');
  if (scan.oversizedLines > 0) overflow = true;
  const updated = snapshot(scan.cursor);
  if (updated.hourProofMigration &&
      updated.hourProofMigration.offset >= contribution.offset &&
      !updated.hourProofMigration.discardingOversizedLine &&
      tokenEventsSeen >= prefixEvents && !overflow) {
    updated.hourProof = {
      version: CODEX_UTC_HOUR_PROOF_VERSION,
      indexedThrough: contribution.offset,
      prefixEvents,
      hours,
    };
    delete updated.hourProofMigration;
  }
  return { contribution: updated, bytesRead: scan.bytesRead };
}

async function migrateContributionToday(
  contribution: CodexFileContribution,
  entry: CodexRuntimeManifestEntry,
  options: CodexIndexUpdateOptions,
  io: CodexIndexIo,
  endExclusive: number,
  onChunk: ContributionChunkHandler,
): Promise<CodexFilePassResult> {
  const timeZone = resolveTimeZone(options.timeZone);
  const day = options.asOfDay ?? dayKeyInZone(
    new Date((options.now ?? Date.now)()),
    timeZone,
  );
  const rollingDays = rollingHourlyDaySet(day);
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  const initial =
    contribution.todayMigration?.day === day &&
      contribution.todayMigration.timeZone === timeZone &&
      contribution.todayMigration.windowDays ===
        CODEX_ROLLING_HOURLY_DAYS &&
      contribution.todayMigration.days &&
      contribution.todayMigration.prefixEvents === prefixEvents
      ? contribution.todayMigration
      : {
          day,
          timeZone,
          prefixEvents,
          tokenEventsSeen: 0,
          offset: 0,
          discardingOversizedLine: false,
          parserState: createCodexParserState(entry.fileKey),
          hours: {},
          windowDays: CODEX_ROLLING_HOURLY_DAYS,
          days: {},
          qualityFlags: [],
        };
  let parserState = initial.parserState;
  let tokenEventsSeen = initial.tokenEventsSeen;
  const days = initial.days as CodexHourlyDays;
  pruneCodexHourlyDays(days, rollingDays);
  let invalidEventTimestamp = false;
  const pseudonymize = pseudonymizer(options.salt);
  let quotaHistory = appendCodexQuotaHistory(
    contribution.quotaHistory ?? [],
    [],
    CODEX_FILE_QUOTA_HISTORY_LIMIT,
  );

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => ({
    ...contribution,
    ...(quotaHistory.length > 0 ? { quotaHistory } : {}),
    aggregate: {
      ...contribution.aggregate,
      today: undefined,
    },
    todayMigration: {
      day,
      timeZone,
      prefixEvents,
      tokenEventsSeen,
      offset: cursor.offset,
      discardingOversizedLine: cursor.discardingOversizedLine,
      parserState,
      hours: days[day] ?? {},
      windowDays: CODEX_ROLLING_HOURLY_DAYS,
      days,
      qualityFlags: uniqueFlags(
        initial.qualityFlags,
        parserState.qualityFlags,
        invalidEventTimestamp ? ['invalid-event-timestamp'] : [],
      ),
    },
  });

  const scan = await scanCodexJsonlLines(
    entry,
    io,
    {
      offset: initial.offset,
      discardingOversizedLine: initial.discardingOversizedLine,
    },
    endExclusive,
    (line) => {
      if (line.trim() === '') {
        return;
      }
      const parsed = parseCodexLine(line, parserState, pseudonymize);
      parserState = parsed.state;
      if (parsed.limit) {
        quotaHistory = appendCodexQuotaHistory(
          quotaHistory,
          codexQuotaObservationsFromLimit(parsed.limit),
          CODEX_FILE_QUOTA_HISTORY_LIMIT,
        );
      }
      if (parsed.lineageTokenKey) {
        tokenEventsSeen += 1;
      }
      if (tokenEventsSeen <= prefixEvents) {
        return;
      }
      for (const event of parsed.events) {
        if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
          invalidEventTimestamp = true;
          continue;
        }
        reduceCodexRollingHourlySlice(days, event, rollingDays, timeZone);
      }
    },
    async (progress) => {
      await onChunk(snapshot(progress.cursor), progress.bytesRead);
    },
  );
  if (!scan.reachedEnd) {
    throw new Error('Codex log changed during rolling-hour migration');
  }
  const updated = snapshot(scan.cursor);
  if (updated.todayMigration && scan.oversizedLines > 0) {
    updated.todayMigration.qualityFlags = uniqueFlags(
      updated.todayMigration.qualityFlags,
      ['oversized-jsonl-line'],
    );
  }
  promoteCaughtUpToday(updated, day, timeZone);
  return { contribution: updated, bytesRead: scan.bytesRead };
}

async function backfillIdentity(
  contribution: CodexFileContribution,
  entry: CodexRuntimeManifestEntry,
  options: CodexIndexUpdateOptions,
  io: CodexIndexIo,
  onChunk?: () => Promise<void>,
): Promise<CodexFileContribution> {
  if (contribution.identityChecked === true) {
    return contribution;
  }
  const end = Math.min(entry.size, MAX_IDENTITY_BYTES);
  const pseudonymize = pseudonymizer(options.salt);
  let parserState = contribution.parserState;
  let result: CodexFileContribution | undefined;
  await scanCodexJsonlLines(
    entry,
    io,
    { offset: 0, discardingOversizedLine: false },
    end,
    (line) => {
      const entryObject = parseJsonObject(line);
      if (
        result === undefined &&
        entryObject &&
        stringField(entryObject, 'type') === 'session_meta'
      ) {
        parserState = parseCodexLine(
          line,
          parserState,
          pseudonymize,
        ).state;
        const aggregate = cloneContribution(contribution).aggregate;
        syncSession(aggregate, parserState);
        result = {
          ...contribution,
          parserState,
          aggregate,
          identityChecked: true,
        };
      }
    },
    onChunk,
  );
  return result ?? { ...contribution, identityChecked: true };
}

/**
 * Execute one independent file pass. Cross-file lineage ownership,
 * duplicate classification, aggregation, and durable checkpoints remain in
 * `updateCodexIndex`, so parallel workers cannot change global semantics.
 */
export async function runCodexFilePass(
  task: CodexFilePassTask,
): Promise<Extract<CodexFilePassOutcome, { ok: true }>> {
  const options: CodexIndexUpdateOptions = {
    salt: task.salt,
    timeZone: task.timeZone,
    asOfDay: task.asOfDay,
    ...(task.kind === 'main' ? { achievementUsageWindow: copyCodexUsageWindow(task.achievementUsageWindow) } : {}),
  };
  const noChunk: ContributionChunkHandler = async () => undefined;
  let result: CodexFilePassResult;
  switch (task.kind) {
    case 'main':
      result = await updateContribution(
        task.contribution,
        task.entry,
        options,
        defaultIo(),
        task.endExclusive,
        noChunk,
      );
      break;
    case 'lineage':
      result = await reconcileContributionLineage(
        task.contribution,
        task.entry,
        options,
        defaultIo(),
        task.endExclusive,
        noChunk,
      );
      break;
    case 'period':
      result = await migrateContributionPeriod(
        task.contribution,
        task.entry,
        options,
        defaultIo(),
        task.endExclusive,
        noChunk,
      );
      break;
    case 'today':
      result = await migrateContributionToday(
        task.contribution,
        task.entry,
        options,
        defaultIo(),
        task.endExclusive,
        noChunk,
      );
      break;
    case 'identity': {
      const contribution = await backfillIdentity(
        task.contribution,
        task.entry,
        options,
        defaultIo(),
      );
      result = {
        contribution,
        bytesRead: Math.min(task.entry.size, MAX_IDENTITY_BYTES),
      };
      break;
    }
  }
  return {
    taskId: task.taskId,
    ok: true,
    contribution: result.contribution,
    bytesRead: result.bytesRead,
    ...(result.achievementUsageDelta ? { achievementUsageDelta: result.achievementUsageDelta } : {}),
  };
}

function lineageFingerprintBuffer(lineage: CodexLineageTrace): Buffer {
  return Buffer.concat([
    ...lineage.fingerprintBlocks.map((block) => Buffer.from(block, 'base64')),
    Buffer.from(lineage.pendingFingerprints.join(''), 'hex'),
  ]);
}

function commonLineagePrefix(
  child: Buffer,
  parent: Buffer,
): number {
  const events = Math.floor(
    Math.min(child.length, parent.length) / CODEX_LINEAGE_FINGERPRINT_BYTES,
  );
  let event = 0;
  for (; event < events; event += 1) {
    const offset = event * CODEX_LINEAGE_FINGERPRINT_BYTES;
    if (!child.subarray(
      offset,
      offset + CODEX_LINEAGE_FINGERPRINT_BYTES,
    ).equals(parent.subarray(
      offset,
      offset + CODEX_LINEAGE_FINGERPRINT_BYTES,
    ))) {
      break;
    }
  }
  return event;
}

function longestLineagePrefix(
  child: Buffer,
  parent: Buffer,
): number {
  if (child.length < CODEX_LINEAGE_FINGERPRINT_BYTES) {
    return 0;
  }
  const first = child.subarray(0, CODEX_LINEAGE_FINGERPRINT_BYTES);
  let best = 0;
  let searchFrom = 0;
  while (searchFrom < parent.length) {
    const offset = parent.indexOf(first, searchFrom);
    if (offset < 0) {
      break;
    }
    searchFrom = offset + CODEX_LINEAGE_FINGERPRINT_BYTES;
    if (offset % CODEX_LINEAGE_FINGERPRINT_BYTES !== 0) {
      continue;
    }
    const events = Math.floor(
      Math.min(child.length, parent.length - offset) /
        CODEX_LINEAGE_FINGERPRINT_BYTES,
    );
    let event = 0;
    for (; event < events; event += 1) {
      const childOffset = event * CODEX_LINEAGE_FINGERPRINT_BYTES;
      const parentOffset = offset + childOffset;
      if (!child.subarray(
        childOffset,
        childOffset + CODEX_LINEAGE_FINGERPRINT_BYTES,
      ).equals(parent.subarray(
        parentOffset,
        parentOffset + CODEX_LINEAGE_FINGERPRINT_BYTES,
      ))) {
        break;
      }
    }
    best = Math.max(best, event);
    if (best * CODEX_LINEAGE_FINGERPRINT_BYTES === child.length) {
      break;
    }
  }
  return best;
}

function reconcileLineageContributions(
  files: Record<string, CodexFileContribution>,
  canonicalFileKeys: Set<string>,
): void {
  const parentCandidates = new Map<string, CodexFileContribution[]>();
  const treeCandidates = new Map<string, CodexFileContribution[]>();
  const fingerprints = new Map<CodexFileContribution, Buffer>();
  const traceFor = (contribution: CodexFileContribution): Buffer => {
    let trace = fingerprints.get(contribution);
    if (!trace) {
      trace = lineageFingerprintBuffer(contribution.lineage!);
      fingerprints.set(contribution, trace);
    }
    return trace;
  };
  for (const fileKey of canonicalFileKeys) {
    const contribution = files[fileKey];
    if (!contribution?.lineage || (contribution.compression === 'zstd' && !contribution.compressionVerified)) {
      continue;
    }
    const key = contribution.aggregate.session.sessionKey;
    const group = parentCandidates.get(key) ?? [];
    group.push(contribution);
    parentCandidates.set(key, group);
    const treeKey = contribution.parserState.treeKey;
    if (treeKey) {
      const tree = treeCandidates.get(treeKey) ?? [];
      tree.push(contribution);
      treeCandidates.set(treeKey, tree);
    }
  }

  for (const contribution of Object.values(files)) {
    if (!contribution.lineage || (contribution.compression === 'zstd' && !contribution.compressionVerified)) {
      continue;
    }
    const childTrace = traceFor(contribution);
    const parentKey = contribution.aggregate.session.parentSessionKey;
    const candidates = parentKey
      ? (parentCandidates.get(parentKey) ?? []).filter((parent) =>
          !contribution.parserState.treeKey ||
          !parent.parserState.treeKey ||
          contribution.parserState.treeKey === parent.parserState.treeKey,
        )
      : [];
    let prefixEvents = 0;
    for (const parent of candidates) {
      prefixEvents = Math.max(
        prefixEvents,
        longestLineagePrefix(childTrace, traceFor(parent)),
      );
    }
    contribution.lineage.desiredPrefixEvents = prefixEvents;
    contribution.qualityFlags = uniqueFlags(
      contribution.qualityFlags.filter((flag) => flag !== 'missing-parent'),
      parentKey && candidates.length === 0 ? ['missing-parent'] : [],
    );
  }

  for (const sameSession of parentCandidates.values()) {
    for (const contribution of sameSession) {
      const lineage = contribution.lineage;
      if (!lineage || !contribution.sourceArea) {
        continue;
      }
      const trace = traceFor(contribution);
      for (const candidate of sameSession) {
        if (
          candidate === contribution ||
          !candidate.lineage ||
          !candidate.sourceArea ||
          candidate.sourceArea === contribution.sourceArea ||
          candidate.lineage.tokenEvents > lineage.tokenEvents
        ) {
          continue;
        }
        const candidateEvents = candidate.lineage.tokenEvents;
        if (
          commonLineagePrefix(trace, traceFor(candidate)) !== candidateEvents ||
          candidateEvents === lineage.tokenEvents &&
            contribution.sourceArea !== 'archive'
        ) {
          continue;
        }
        lineage.desiredPrefixEvents = Math.max(
          lineage.desiredPrefixEvents,
          candidateEvents,
        );
      }
    }
  }

  const depthFor = createLineageDepthResolver<CodexFileContribution>((contribution) => {
    const parentKey = contribution.aggregate.session.parentSessionKey;
    if (!parentKey) {
      return null;
    }
    return (parentCandidates.get(parentKey) ?? []).filter((parent) =>
      !contribution.parserState.treeKey ||
      !parent.parserState.treeKey ||
      contribution.parserState.treeKey === parent.parserState.treeKey,
    );
  });

  for (const tree of treeCandidates.values()) {
    const ordered = [...tree].sort((left, right) =>
      depthFor(left) - depthFor(right) ||
      (left.aggregate.session.endedAt ?? Number.MAX_SAFE_INTEGER) -
        (right.aggregate.session.endedAt ?? Number.MAX_SAFE_INTEGER) ||
      left.fileKey.localeCompare(right.fileKey),
    );
    const seen: Array<{
      contribution: CodexFileContribution;
      trace: Buffer;
    }> = [];
    for (const contribution of ordered) {
      const trace = traceFor(contribution);
      let insertion = 0;
      let high = seen.length;
      while (insertion < high) {
        const middle = Math.floor((insertion + high) / 2);
        if (Buffer.compare(seen[middle].trace, trace) <= 0) {
          insertion = middle + 1;
        } else {
          high = middle;
        }
      }
      const parentKey = contribution.aggregate.session.parentSessionKey;
      const missingParent = contribution.qualityFlags.includes('missing-parent');
      if (parentKey && !missingParent && contribution.lineage) {
        let left = insertion - 1;
        while (left >= 0 && seen[left].trace.equals(trace)) {
          left -= 1;
        }
        let right = insertion;
        while (right < seen.length && seen[right].trace.equals(trace)) {
          right += 1;
        }
        for (const candidate of [seen[left], seen[right]]) {
          if (!candidate) {
            continue;
          }
          contribution.lineage.desiredPrefixEvents = Math.max(
            contribution.lineage.desiredPrefixEvents,
            commonLineagePrefix(trace, candidate.trace),
          );
        }
      }
      seen.splice(insertion, 0, { contribution, trace });
    }
  }
}

function recomputeAggregate(
  files: Record<string, CodexFileContribution>,
  deduplication = classifyCodexSessionDuplicates(files),
): CodexProviderAggregate {
  const aggregate = emptyAggregate();
  for (const fileKey of deduplication.canonicalFileKeys) {
    const file = files[fileKey];
    if (!file || !isCodexUsageContributionCurrent(file)) {
      continue;
    }
    addTokens(aggregate.total, file.aggregate.total);
    for (const [key, value] of Object.entries(file.aggregate.byDay)) {
      addTokens(bucket(aggregate.byDay, key), value);
    }
    for (const [key, value] of Object.entries(file.aggregate.byModel)) {
      addTokens(bucket(aggregate.byModel, key), value);
    }
    for (const [key, value] of Object.entries(file.aggregate.byEffort)) {
      addTokens(bucket(aggregate.byEffort, key), value);
    }
  }
  return aggregate;
}

/**
 * Merge the small per-file observations into the index-level history before
 * any manifest removals can discard their last copy. The history is neutral by
 * construction, so it can preserve reset boundaries without pretending to
 * identify which account produced them.
 */
function mergeCodexQuotaHistory(index: CodexIndexV3): void {
  const additions: CodexQuotaObservation[] = [];
  for (const contribution of Object.values(index.files)) {
    // Draft decoded bytes are provisional until the entire physical frame is
    // verified. The global history outlives files, so premature promotion here
    // could not be withdrawn by later terminal-frame cleanup.
    if (contribution.compression === 'zstd' && !isCodexUsageContributionCurrent(contribution)) continue;
    additions.push(...(contribution.quotaHistory ?? []));
    for (const snapshot of [
      ...Object.values(contribution.limits ?? {}),
      ...(contribution.limit ? [contribution.limit] : []),
    ]) {
      additions.push(...codexQuotaObservationsFromLimit(snapshot));
    }
  }
  const history = appendCodexQuotaHistory(
    sanitizeCodexQuotaHistory(index.quotaHistory, CODEX_QUOTA_HISTORY_LIMIT),
    additions,
    CODEX_QUOTA_HISTORY_LIMIT,
  );
  index.quotaHistory = history.length > 0 ? history : undefined;
}

function hasCodexQuotaEvidence(index: CodexIndexV3): boolean {
  return Object.values(index.files).some((contribution) =>
    (contribution.quotaHistory?.length ?? 0) > 0 || [
      ...Object.values(contribution.limits ?? {}),
      ...(contribution.limit ? [contribution.limit] : []),
    ].some((snapshot) => codexQuotaObservationsFromLimit(snapshot).length > 0),
  );
}

export function isReadableCodexPeriod(
  contribution: CodexFileContribution | undefined,
  timeZone: string,
): boolean {
  if (!contribution || !isCodexUsageContributionCurrent(contribution)) {
    return false;
  }
  const period = contribution.aggregate.period;
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  return period?.timeZone === timeZone &&
    isCompatibleCodexPeriodLineage(period, prefixEvents) &&
    codexPeriodFitsAggregate(period, contribution.aggregate.total);
}

function coverageFor(
  files: Record<string, CodexFileContribution>,
  manifest: CodexManifest,
  timeZone: string,
  asOfDay: string,
  deduplication = classifyCodexSessionDuplicates(files),
  requireCalendarProof = false,
): CodexIndexCoverage {
  let indexedFiles = 0;
  let indexedBytes = 0;
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
  for (const entry of manifest.files) {
    const contribution = files[entry.fileKey];
    if (!contribution) {
      continue;
    }
    const flags = new Set(contribution.qualityFlags);
    const resetIsStale = flags.has('stale-reset-required');
    const parsedBytes = resetIsStale
      ? 0
      : Math.max(0, Math.min(contribution.offset, entry.size));
    indexedBytes += parsedBytes;
    if (
      !resetIsStale &&
      isCodexUsageContributionCurrent(contribution) &&
      !flags.has('stale-file') &&
      contribution.offset >= entry.size &&
      !contribution.discardingOversizedLine &&
      contribution.lineage?.appliedPrefixEvents ===
        contribution.lineage?.desiredPrefixEvents &&
      !contribution.lineageReconciliation
    ) {
      indexedFiles += 1;
    }
  }
  const totalFiles = manifest.files.length;
  const rangeCoverage = (oldestDay?: string): CodexRangeCoverage => {
    let migratedFiles = 0;
    let migratedBytes = 0;
    let rangeTotalFiles = 0;
    let rangeTotalBytes = 0;
    for (const entry of manifest.files) {
      if (deduplication.exactDuplicateFileKeys.has(entry.fileKey)) {
        continue;
      }
      const contribution = files[entry.fileKey];
      const flags = new Set(contribution?.qualityFlags ?? []);
      const mainVerified = Boolean(
        contribution &&
        isCodexUsageContributionCurrent(contribution) &&
        contribution.offset === entry.size &&
        !contribution.discardingOversizedLine &&
        contribution.lineage?.appliedPrefixEvents ===
          contribution.lineage?.desiredPrefixEvents &&
        !contribution.lineageReconciliation &&
        !flags.has('stale-file') &&
        !flags.has('stale-reset-required'),
      );
      const endedAt = contribution?.aggregate.session.endedAt;
      if (
        oldestDay &&
        mainVerified &&
        endedAt !== undefined &&
        Number.isFinite(endedAt)
      ) {
        const endedDay = dayKeyInZone(new Date(endedAt), timeZone);
        if (endedDay && endedDay < oldestDay) {
          continue;
        }
      }
      rangeTotalFiles += 1;
      rangeTotalBytes += entry.size;
      // Recent display ranges retain legacy compatibility. Calendar evidence
      // requires proof across every canonical file, including older history.
      const periodIsCurrent = isReadableCodexPeriod(contribution, timeZone) &&
        (!requireCalendarProof || oldestDay !== undefined ||
          isCurrentCodexPeriodLineage(contribution?.aggregate.period,
            contribution?.lineage?.desiredPrefixEvents ?? 0));
      const periodMigration = contribution?.periodMigration;
      // A migration draft is intentionally not a readable period yet, but
      // its cursor still represents verified work for the progress display.
      // Keep this separate from periodIsCurrent so a rejected legacy sidecar
      // cannot be rendered as data while an active rebuild remains visible.
      const periodMigrationIsCurrent = Boolean(
        contribution &&
        isCodexUsageContributionCurrent(contribution) &&
        periodMigration?.timeZone === timeZone &&
        periodMigration.prefixEvents ===
          (contribution.lineage?.desiredPrefixEvents ?? 0),
      );
      const promoted = periodIsCurrent &&
        contribution?.aggregate.period?.timeZone === timeZone
        ? Math.min(
            contribution.aggregate.period.indexedThrough,
            contribution.offset,
            entry.size,
          )
        : 0;
      const draft = periodMigrationIsCurrent && periodMigration
        ? Math.min(periodMigration.offset, contribution.offset, entry.size)
        : 0;
      const migrated = Math.max(0, Math.max(promoted, draft));
      migratedBytes += migrated;
      if (
        periodIsCurrent &&
        contribution &&
        contribution.offset >= entry.size &&
        !contribution.discardingOversizedLine &&
        contribution.aggregate.period?.timeZone === timeZone &&
        contribution.aggregate.period.indexedThrough >= contribution.offset
      ) {
        migratedFiles += 1;
      }
    }
    return {
      migratedFiles,
      totalFiles: rangeTotalFiles,
      migratedBytes,
      totalBytes: rangeTotalBytes,
      complete: migratedFiles === rangeTotalFiles,
    };
  };
  const last7Start = rollingDayKeysFromDayKey(asOfDay, 7)[0];
  const last30DayKeys = rollingDayKeysFromDayKey(
    asOfDay,
    CODEX_ROLLING_HOURLY_DAYS,
  );
  const last30Start = last30DayKeys[0];
  const last7Days = rangeCoverage(last7Start);
  const last30Days = rangeCoverage(last30Start);
  const allTime = rangeCoverage();
  const rollingDays = new Set(last30DayKeys);
  const hourlyDays: Record<string, CodexHourlyDayCoverage> = {};
  let hourlyIndexedFiles = 0;
  let hourlyTotalFiles = 0;
  let hourlyIndexedBytes = 0;
  let hourlyTotalBytes = 0;
  for (const entry of manifest.files) {
    if (!deduplication.canonicalFileKeys.has(entry.fileKey)) {
      continue;
    }
    const contribution = files[entry.fileKey];
    if (
      !contribution ||
      !isCodexUsageContributionCurrent(contribution) ||
      contribution.lineageReconciliation ||
      contribution.lineage?.appliedPrefixEvents !==
        contribution.lineage?.desiredPrefixEvents ||
      !isReadableCodexPeriod(contribution, timeZone)
    ) {
      continue;
    }
    const eligibleDays = Object.keys(contribution.aggregate.period!.days)
      .filter((day) => rollingDays.has(day));
    if (eligibleDays.length === 0) {
      continue;
    }
    hourlyTotalFiles += 1;
    hourlyTotalBytes += entry.size;
    const promoted =
      isRollingTodayIndex(contribution.aggregate.today, timeZone) &&
      contribution.aggregate.today.day === asOfDay
        ? Math.min(
            contribution.aggregate.today.indexedThrough,
            contribution.offset,
            entry.size,
          )
        : 0;
    const draft =
      contribution.todayMigration?.day === asOfDay &&
      contribution.todayMigration.timeZone === timeZone &&
      contribution.todayMigration.windowDays ===
        CODEX_ROLLING_HOURLY_DAYS &&
      contribution.todayMigration.days &&
      contribution.todayMigration.prefixEvents ===
        (contribution.lineage?.desiredPrefixEvents ?? 0)
        ? Math.min(
            contribution.todayMigration.offset,
            contribution.offset,
            entry.size,
          )
        : 0;
    const migratedBytes = Math.max(0, Math.max(promoted, draft));
    hourlyIndexedBytes += migratedBytes;
    const completeFile = Boolean(
      isRollingTodayIndex(contribution.aggregate.today, timeZone) &&
      contribution.aggregate.today.day === asOfDay &&
      contribution.aggregate.today.indexedThrough >= contribution.offset,
    );
    if (completeFile) {
      hourlyIndexedFiles += 1;
    }
    for (const day of eligibleDays) {
      const current = (hourlyDays[day] ??= {
        day,
        indexedFiles: 0,
        totalFiles: 0,
        indexedBytes: 0,
        totalBytes: 0,
        complete: false,
      });
      current.totalFiles += 1;
      current.totalBytes += entry.size;
      current.indexedBytes += migratedBytes;
      if (completeFile) {
        current.indexedFiles += 1;
      }
    }
  }
  const hourlyComplete =
    last30Days.complete && hourlyIndexedFiles === hourlyTotalFiles;
  for (const coverage of Object.values(hourlyDays)) {
    coverage.complete =
      last30Days.complete && coverage.indexedFiles === coverage.totalFiles;
  }
  const todayDayCoverage = hourlyDays[asOfDay] ?? {
    day: asOfDay,
    indexedFiles: 0,
    totalFiles: 0,
    indexedBytes: 0,
    totalBytes: 0,
    complete: last30Days.complete,
  };
  return {
    indexedFiles,
    totalFiles,
    indexedBytes,
    totalBytes,
    complete: indexedFiles === totalFiles,
    identity: {
      exactDuplicateFiles: deduplication.exactDuplicateFileKeys.size,
      ambiguousSessionGroups: deduplication.ambiguousSessionGroups,
      complete: deduplication.ambiguousSessionGroups === 0,
    },
    period: {
      timeZone,
      asOfDay,
      last7Days,
      last30Days,
      allTime,
    },
    hourly: {
      timeZone,
      asOfDay,
      windowDays: CODEX_ROLLING_HOURLY_DAYS,
      indexedFiles: hourlyIndexedFiles,
      totalFiles: hourlyTotalFiles,
      indexedBytes: hourlyIndexedBytes,
      totalBytes: hourlyTotalBytes,
      complete: hourlyComplete,
      days: hourlyDays,
    },
    today: {
      timeZone,
      day: asOfDay,
      indexedFiles: todayDayCoverage.indexedFiles,
      totalFiles: todayDayCoverage.totalFiles,
      indexedBytes: todayDayCoverage.indexedBytes,
      totalBytes: todayDayCoverage.totalBytes,
      complete: todayDayCoverage.complete,
    },
  };
}

function recomputeDerivedIndex(
  index: CodexIndexV3,
  manifest: CodexManifest,
  timeZone: string,
  asOfDay: string,
  reconcileLineage = true,
  requireCalendarProof = false,
): void {
  const initialDeduplication = classifyCodexSessionDuplicates(index.files);
  if (reconcileLineage) {
    reconcileLineageContributions(
      index.files,
      initialDeduplication.canonicalFileKeys,
    );
  }
  mergeCodexQuotaHistory(index);
  const deduplication = classifyCodexSessionDuplicates(index.files);
  index.aggregate = recomputeAggregate(index.files, deduplication);
  index.coverage = coverageFor(
    index.files,
    manifest,
    timeZone,
    asOfDay,
    deduplication,
    requireCalendarProof,
  );
}

function progressFor(index: CodexIndexV3, scannedFiles: number): CodexIndexProgress {
  return {
    scannedFiles,
    totalFiles: index.coverage.totalFiles,
    indexedBytes: index.coverage.indexedBytes,
    totalBytes: index.coverage.totalBytes,
    period: index.coverage.period,
    hourly: index.coverage.hourly,
  };
}

function isWarmNoOp(
  previous: CodexIndexV3,
  manifest: CodexManifest,
  diff: ReturnType<typeof diffCodexManifest>,
  timeZone: string,
  asOfDay: string,
  allowHistoricalBackfill: boolean,
  allowAchievementHourProof: boolean,
): boolean {
  // Older schema-3 indexes have a current `limit` projection but no neutral
  // reset history. Give the next refresh one chance to seed the bounded cache
  // even when the JSONL manifest itself has not changed.
  if (hasCodexQuotaEvidence(previous) && !previous.quotaHistory?.length) {
    return false;
  }
  const totalBytes = manifest.files.reduce((sum, entry) => sum + entry.size, 0);
  const terminalEntries = manifest.files.filter(entry => hasCurrentCompressionFailure(previous.files[entry.fileKey], entry));
  const terminalCount = terminalEntries.length;
  const availableBytes = totalBytes - terminalEntries.reduce((sum, entry) => sum + entry.size, 0);
  const hourlyCoverage = previous.coverage.hourly;
  if (
    (allowHistoricalBackfill && allowAchievementHourProof &&
      hourProofWorkEntries(previous, manifest).length > 0) ||
    diff.appended.length > 0 ||
    diff.truncated.length > 0 ||
    diff.replaced.length > 0 ||
    diff.moved.length > 0 ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    (!terminalCount && !previous.coverage.complete) ||
    previous.coverage.totalFiles !== manifest.files.length ||
    previous.coverage.indexedFiles + terminalCount !== manifest.files.length ||
    previous.coverage.totalBytes !== totalBytes ||
    previous.coverage.indexedBytes !== availableBytes ||
    (terminalCount ? previous.coverage.period.allTime.migratedFiles + terminalCount !== previous.coverage.period.allTime.totalFiles
      : !previous.coverage.period.allTime.complete) ||
    previous.coverage.period.timeZone !== timeZone ||
    previous.coverage.period.asOfDay !== asOfDay ||
    !hourlyCoverage || (terminalCount ? hourlyCoverage.indexedFiles !== hourlyCoverage.totalFiles : !hourlyCoverage.complete) ||
    hourlyCoverage.timeZone !== timeZone ||
    hourlyCoverage.asOfDay !== asOfDay ||
    hourlyCoverage.windowDays !== CODEX_ROLLING_HOURLY_DAYS ||
    !previous.coverage.today || (terminalCount ? previous.coverage.today.indexedFiles !== previous.coverage.today.totalFiles
      : !previous.coverage.today.complete) ||
    previous.coverage.today.timeZone !== timeZone ||
    previous.coverage.today.day !== asOfDay
  ) {
    return false;
  }
  const canonical = classifyCodexSessionDuplicates(previous.files)
    .canonicalFileKeys;
  const rollingDays = rollingHourlyDaySet(asOfDay);
  return manifest.files.every((entry) => {
    const contribution = previous.files[entry.fileKey];
    if (hasCurrentCompressionFailure(contribution, entry)) return true;
    const baseIsCurrent = Boolean(
      contribution &&
      contribution.offset === entry.size &&
      !contribution.discardingOversizedLine &&
      contribution.identityChecked === true &&
      contribution.lineage?.appliedPrefixEvents ===
        contribution.lineage?.desiredPrefixEvents &&
      !contribution.lineageReconciliation &&
      contribution.aggregate.period?.timeZone === timeZone &&
      contribution.aggregate.period.indexedThrough >= contribution.offset &&
      isReadableCodexPeriod(contribution, timeZone) &&
      (!allowAchievementHourProof || !canonical.has(entry.fileKey) || isCurrentCodexPeriodLineage(
        contribution.aggregate.period, contribution.lineage?.desiredPrefixEvents ?? 0,
      )) &&
      !contribution.qualityFlags.includes('stale-file') &&
      isCodexUsageContributionCurrent(contribution),
    );
    if (!baseIsCurrent || !contribution) {
      return false;
    }
    const hasRollingDay = Object.keys(
      contribution.aggregate.period?.days ?? {},
    ).some((day) => rollingDays.has(day));
    if (!canonical.has(entry.fileKey) || !hasRollingDay) {
      return true;
    }
    return Boolean(
      isRollingTodayIndex(contribution.aggregate.today, timeZone) &&
      contribution.aggregate.today.day === asOfDay &&
      contribution.aggregate.today.indexedThrough >= contribution.offset &&
      !contribution.todayMigration
    );
  });
}

export async function updateCodexIndex(
  previous: CodexIndexV3,
  manifest: CodexManifest,
  options: CodexIndexUpdateOptions,
): Promise<CodexIndexUpdateResult> {
  const requestedMaxBytes = options.budget?.maxBytes;
  if (
    requestedMaxBytes !== undefined &&
    requestedMaxBytes > 0 &&
    requestedMaxBytes < CODEX_REFRESH_MIN_BYTES
  ) {
    throw new CodexIndexBudgetError();
  }
  const io = options.io ?? defaultIo();
  const timeZone = resolveTimeZone(options.timeZone);
  const refreshInstant = (options.now ?? Date.now)();
  const requireCalendarProof = options.allowAchievementHourProof !== false;
  const requestedUsageWindow = copyCodexUsageWindow(options.achievementUsageWindow);
  const usageWindow = requestedUsageWindow && requestedUsageWindow.through <= refreshInstant &&
    previous.coverage.period.timeZone === timeZone && codexOriginBaselineReady(previous)
    ? requestedUsageWindow : undefined;
  const asOfDay = dayKeyInZone(new Date(refreshInstant), timeZone);
  const normalizedOptions: CodexIndexUpdateOptions = {
    ...options,
    timeZone,
    asOfDay,
    achievementUsageWindow: undefined,
  };
  const scheduling: CodexIndexSchedulingPolicy = {
    ...DEFAULT_CODEX_INDEX_SCHEDULING,
    ...options.scheduling,
  };
  const budget: CodexIndexWorkBudget = {
    maxFilePasses: Math.max(
      0,
      Math.min(
        CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES,
        Math.floor(
          options.budget?.maxFilePasses ??
          CODEX_REFRESH_BACKGROUND_MAX_FILE_PASSES,
        ),
      ),
    ),
    maxBytes: Math.max(
      0,
      Math.min(
        CODEX_REFRESH_BACKFILL_MAX_BYTES,
        Math.floor(
          options.budget?.maxBytes ?? CODEX_REFRESH_BACKGROUND_MAX_BYTES,
        ),
      ),
    ),
  };
  const diff = diffCodexManifest(previousManifest(previous), manifest.persistable);
  const terminalCount = manifest.files.filter(entry => hasCurrentCompressionFailure(previous.files[entry.fileKey], entry)).length;
  const originAppends = new Set(usageWindow ? diff.appended.filter(key => {
    const prior = previous.files[key], entry = manifest.persistable[key];
    return prior && entry && !prior.compression && !entry.compression && prior.dev! > 0 && prior.ino! > 0 &&
      prior.dev === entry.dev && prior.ino === entry.ino;
  }) : []);
  const originCandidates = new Map<string, CodexAchievementUsageDelta>();
  if (isWarmNoOp(previous, manifest, diff, timeZone, asOfDay,
    options.allowHistoricalBackfill !== false, options.allowAchievementHourProof !== false)) {
    return {
      index: previous,
      indexChanged: false,
      bodyReads: 0,
      failedFiles: terminalCount,
      migration: {
        filePasses: 0,
        bytesRead: 0,
        pending: false,
      },
    };
  }
  const index = cloneIndex(previous);
  // Seed the durable neutral history before moved/removed files disappear.
  // This also upgrades an older index without rereading unchanged JSONL.
  mergeCodexQuotaHistory(index);
  if (previous.coverage.period.timeZone !== timeZone) {
    index.indexGeneration = Math.max(1, Math.floor(previous.indexGeneration ?? 0) + 1);
  }
  const entries = new Map(manifest.files.map((entry) => [entry.fileKey, entry]));
  let bodyReads = 0;
  let failedFiles = terminalCount;
  let filePasses = 0;
  let bytesRead = 0;
  let cancellationCheckpointed = false;
  let dirtySinceCheckpoint = true;
  let filePassesSinceCheckpoint = 0;
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  let lastProgressBytes = 0;
  // A fresh update does not need an immediate durable write after its first
  // chunk. Start the timer now so small warm appends converge into the forced
  // stage checkpoint, while large rebuilds still checkpoint by time, bytes, or
  // completed file passes.
  let lastCheckpointAt = scheduling.now();
  let lastCheckpointBytes = 0;
  let reconcileLineageForCheckpoint = true;
  const recordTerminalFailure = (entry: CodexRuntimeManifestEntry, value: unknown): boolean => {
    const code = terminalCompressionCode(copyFilePassFailureCode(value));
    if (entry.compression !== 'zstd' || !code || !validCompressionFingerprint({ ...entry })) return false;
    index.files[entry.fileKey] = compressionFailureContribution(entry, code);
    return true;
  };
  for (const move of diff.moved) {
    const contribution = index.files[move.fromKey];
    const entry = entries.get(move.toKey);
    if (!contribution || !entry) {
      continue;
    }
    delete index.files[move.fromKey];
    contribution.fileKey = move.toKey;
    contribution.sourceArea = entry.sourceArea;
    contribution.size = entry.size;
    contribution.mtimeMs = entry.mtimeMs;
    contribution.dev = entry.dev;
    contribution.ino = entry.ino;
    contribution.parserState.fileKey = move.toKey;
    if (contribution.lineageReconciliation) {
      contribution.lineageReconciliation.parserState.fileKey = move.toKey;
    }
    if (contribution.periodMigration) {
      contribution.periodMigration.parserState.fileKey = move.toKey;
    }
    if (contribution.todayMigration) {
      contribution.todayMigration.parserState.fileKey = move.toKey;
    }
    if (contribution.hourProofMigration) {
      contribution.hourProofMigration.parserState.fileKey = move.toKey;
    }
    index.files[move.toKey] = contribution;
  }
  for (const key of diff.removed) {
    delete index.files[key];
  }
  for (const contribution of Object.values(index.files)) {
    promoteCaughtUpLineage(contribution);
    promoteCaughtUpHourProof(contribution);
    const desiredPrefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
    if (contribution.aggregate.period && (
      !isCompatibleCodexPeriodLineage(
        contribution.aggregate.period,
        desiredPrefixEvents,
      ) ||
      !codexPeriodFitsAggregate(
        contribution.aggregate.period,
        contribution.aggregate.total,
      ) ||
      contribution.aggregate.period.timeZone !== timeZone
    )) {
      delete contribution.aggregate.period;
    }
    if (contribution.periodMigration && !resumablePeriodMigration(contribution, timeZone)) {
      delete contribution.periodMigration;
    }
    promoteCaughtUpPeriod(contribution, timeZone);
    const today = contribution.aggregate.today;
    if (today) {
      if (isRollingTodayIndex(today, timeZone)) {
        const previousDay = today.day;
        const nextWindow = rollingHourlyDaySet(asOfDay);
        const hasPreviouslyFutureUsage =
          asOfDay > previousDay &&
          Object.keys(contribution.aggregate.period?.days ?? {}).some(
            (day) => day > previousDay && nextWindow.has(day),
          );
        if (
          hasPreviouslyFutureUsage ||
          !reanchorRollingToday(today, asOfDay, timeZone)
        ) {
          delete contribution.aggregate.today;
        }
      } else if (today.day !== asOfDay || today.timeZone !== timeZone) {
        delete contribution.aggregate.today;
      }
    }
    if (
      contribution.todayMigration &&
      (
        contribution.todayMigration.day !== asOfDay ||
        contribution.todayMigration.timeZone !== timeZone ||
        contribution.todayMigration.windowDays !==
          CODEX_ROLLING_HOURLY_DAYS ||
        !contribution.todayMigration.days ||
        contribution.todayMigration.prefixEvents !==
          (contribution.lineage?.desiredPrefixEvents ?? 0)
      )
    ) {
      delete contribution.todayMigration;
    }
    promoteCaughtUpToday(contribution, asOfDay, timeZone);
  }

  const resetFlags = new Map<string, string>();
  for (const key of diff.truncated) {
    resetFlags.set(key, 'truncated-jsonl');
  }
  for (const key of diff.replaced) {
    resetFlags.set(key, 'replaced-jsonl');
  }
  // A known encoding/version replacement withdraws old authority immediately,
  // including cancellation before its first decoded chunk or checkpoint.
  for (const key of diff.replaced) {
    const prior = index.files[key], entry = entries.get(key);
    if (prior) delete prior.compressionFailure;
    if (prior && (prior.compression || entry?.compression)) prior.qualityFlags = uniqueFlags(
      prior.qualityFlags, ['stale-reset-required']);
  }
  const changedKeys = new Set([
    ...diff.added,
    ...diff.appended,
    ...diff.truncated,
    ...diff.replaced,
  ]);
  for (const entry of manifest.files) {
    const contribution = index.files[entry.fileKey];
    if (hasCurrentCompressionFailure(contribution, entry)) continue;
    if (
      contribution &&
      (contribution.offset < entry.size ||
        contribution.discardingOversizedLine ||
        contribution.qualityFlags.includes('stale-file') ||
        contribution.qualityFlags.includes('stale-reset-required') ||
        compressedDraftNeedsRestart(contribution))
    ) {
      changedKeys.add(entry.fileKey);
    }
  }
  const recentFirst = (
    left: CodexRuntimeManifestEntry,
    right: CodexRuntimeManifestEntry,
  ): number => right.mtimeMs - left.mtimeMs || left.fileKey.localeCompare(right.fileKey);
  const mainWork = [...changedKeys]
    .map((key) => entries.get(key))
    .filter((entry): entry is CodexRuntimeManifestEntry => entry !== undefined)
    .sort(recentFirst);

  const publishProgress = (force = false): boolean => {
    if (!options.onProgress) {
      return false;
    }
    const current = scheduling.now();
    const due = force ||
      lastProgressAt === Number.NEGATIVE_INFINITY ||
      current - lastProgressAt >= Math.max(0, scheduling.progressEveryMs) ||
      bytesRead - lastProgressBytes >= Math.max(0, scheduling.progressEveryBytes);
    if (!due) {
      return false;
    }
    recomputeDerivedIndex(index, manifest, timeZone, asOfDay, false, requireCalendarProof);
    options.onProgress(progressFor(index, index.coverage.indexedFiles));
    lastProgressAt = current;
    lastProgressBytes = bytesRead;
    return true;
  };
  const checkpoint = async (force = false): Promise<boolean> => {
    if (!options.onCheckpoint || !dirtySinceCheckpoint) {
      return false;
    }
    const current = scheduling.now();
    const due = force ||
      lastCheckpointAt === Number.NEGATIVE_INFINITY ||
      current - lastCheckpointAt >= Math.max(0, scheduling.checkpointEveryMs) ||
      bytesRead - lastCheckpointBytes >= Math.max(0, scheduling.checkpointEveryBytes) ||
      filePassesSinceCheckpoint >= Math.max(
        1,
        scheduling.checkpointEveryFilePasses,
      );
    if (!due) {
      return false;
    }
    recomputeDerivedIndex(
      index,
      manifest,
      timeZone,
      asOfDay,
      reconcileLineageForCheckpoint,
      requireCalendarProof,
    );
    options.onProgress?.(progressFor(index, index.coverage.indexedFiles));
    lastProgressAt = current;
    lastProgressBytes = bytesRead;
    // The callback is awaited, so the live index cannot change while an atomic
    // save sanitizes and serializes it. Avoid a second whole-index clone here.
    await options.onCheckpoint(index);
    dirtySinceCheckpoint = false;
    filePassesSinceCheckpoint = 0;
    lastCheckpointAt = current;
    lastCheckpointBytes = bytesRead;
    return true;
  };
  const finishStage = async (
    didWork: boolean,
    ensureDerived = false,
  ): Promise<void> => {
    if (didWork && !dirtySinceCheckpoint) {
      return;
    }
    if (didWork) {
      if (await checkpoint(true)) {
        return;
      }
      recomputeDerivedIndex(
        index,
        manifest,
        timeZone,
        asOfDay,
        reconcileLineageForCheckpoint,
        requireCalendarProof,
      );
      publishProgress(true);
      return;
    }
    if (ensureDerived) {
      recomputeDerivedIndex(
        index,
        manifest,
        timeZone,
        asOfDay,
        reconcileLineageForCheckpoint,
        requireCalendarProof,
      );
    }
  };
  const cancelBeforePass = async (): Promise<void> => {
    if (!options.shouldCancel?.()) {
      return;
    }
    if (!cancellationCheckpointed) {
      await checkpoint(true);
      cancellationCheckpointed = true;
    }
    throw new CodexIndexCancelledError();
  };
  const onChunk = (
    entry: CodexRuntimeManifestEntry,
    passStartingBytes: number,
  ): ContributionChunkHandler => async (contribution, passBytesRead) => {
    bytesRead = passStartingBytes + passBytesRead;
    index.files[entry.fileKey] = contribution;
    dirtySinceCheckpoint = true;
    if (options.shouldCancel?.()) {
      if (!cancellationCheckpointed) {
        await checkpoint(true);
        cancellationCheckpointed = true;
      }
      throw new CodexIndexCancelledError();
    }
    if (!(await checkpoint(false))) {
      publishProgress(false);
    }
    // A progress/checkpoint callback can make an external cancellation visible
    // while this worker is paused. Re-check before reading the next chunk so a
    // final chunk still leaves a resumable draft rather than running another
    // phase first.
    if (options.shouldCancel?.()) {
      if (!cancellationCheckpointed) {
        await checkpoint(true);
        cancellationCheckpointed = true;
      }
      throw new CodexIndexCancelledError();
    }
  };
  const hasBudget = (): boolean =>
    filePasses < budget.maxFilePasses && bytesRead < budget.maxBytes;
  const runParallelTasks = async (
    tasks: readonly CodexFilePassTask[],
    onFailure: (task: CodexFilePassTask) => void,
  ): Promise<void> => {
    if (!options.filePassBatch || tasks.length === 0) {
      return;
    }
    const byId = new Map(tasks.map((task) => [task.taskId, task]));
    bodyReads += tasks.length;
    filePasses += tasks.length;
    try {
      await options.filePassBatch(
        tasks,
        async (outcome) => {
          const task = byId.get(outcome.taskId);
          if (!task) {
            throw new Error('Codex file worker returned an unknown task');
          }
          byId.delete(outcome.taskId);
          if (outcome.ok) {
            bytesRead += outcome.bytesRead;
            index.files[task.entry.fileKey] = outcome.contribution;
            const proof = task.kind === 'main' && originAppends.has(task.entry.fileKey)
              ? copyCodexUsageDelta(outcome.achievementUsageDelta, usageWindow) : undefined;
            if (proof) originCandidates.set(task.entry.fileKey, proof);
          } else {
            failedFiles += 1;
            if (!recordTerminalFailure(task.entry, outcome.failureCode)) onFailure(task);
          }
          dirtySinceCheckpoint = true;
          filePassesSinceCheckpoint += 1;
          if (!(await checkpoint(false))) {
            publishProgress(false);
          }
          if (options.shouldCancel?.()) {
            if (!cancellationCheckpointed) {
              await checkpoint(true);
              cancellationCheckpointed = true;
            }
            throw new CodexIndexCancelledError();
          }
        },
        options.shouldCancel,
      );
    } catch (error) {
      if (error instanceof CodexIndexCancelledError) {
        if (!cancellationCheckpointed) {
          await checkpoint(true);
          cancellationCheckpointed = true;
        }
      }
      throw error;
    }
  };

  const mainPassStart = filePasses;
  if (options.filePassBatch && mainWork.length > 1) {
    await cancelBeforePass();
    const tasks: CodexFilePassTask[] = [];
    const priorByTask = new Map<string, CodexFileContribution | undefined>();
    const resetFlagByTask = new Map<string, string | undefined>();
    let reservedBytes = 0;
    for (const entry of mainWork) {
      if (
        filePasses + tasks.length >= budget.maxFilePasses ||
        bytesRead + reservedBytes >= budget.maxBytes
      ) {
        break;
      }
      const resetFlag = resetFlags.get(entry.fileKey);
      const prior = index.files[entry.fileKey];
      const base = resetFlag || !prior || compressedDraftNeedsRestart(prior) ||
          prior.qualityFlags.includes('stale-reset-required')
        ? contributionFor(entry, timeZone, resetFlag ? [resetFlag] : [])
        : {
            ...cloneContribution(prior),
            qualityFlags: prior.qualityFlags.filter(
              (flag) => flag !== 'stale-file' && flag !== 'stale-reset-required',
            ),
          };
      const remainingBytes = budget.maxBytes - bytesRead - reservedBytes;
      const endExclusive = compressedMainPassEnd(entry, base.offset, remainingBytes, filePasses + tasks.length === 0 && bytesRead === 0);
      if (endExclusive <= base.offset && !(entry.compression === 'zstd' && entry.size === 0)) {
        break;
      }
      const taskId = `main:${entry.fileKey}`;
      tasks.push({
        taskId,
        kind: 'main',
        ...(originAppends.has(entry.fileKey) ? { achievementUsageWindow: usageWindow } : {}),
        contribution: base,
        entry,
        salt: normalizedOptions.salt,
        timeZone,
        asOfDay,
        endExclusive,
      });
      priorByTask.set(taskId, prior);
      resetFlagByTask.set(taskId, resetFlag);
      reservedBytes += entry.compression === 'zstd' ? endExclusive : endExclusive - base.offset;
    }
    await runParallelTasks(tasks, (task) => {
      const prior = priorByTask.get(task.taskId);
      if (!prior) {
        return;
      }
      index.files[task.entry.fileKey] = {
        ...prior,
        qualityFlags: uniqueFlags(
          prior.qualityFlags,
          ['stale-file'],
          resetFlagByTask.get(task.taskId)
            ? ['stale-reset-required']
            : [],
        ),
      };
    });
  } else for (const entry of mainWork) {
    if (!hasBudget()) {
      break;
    }
    await cancelBeforePass();
    const resetFlag = resetFlags.get(entry.fileKey);
    const prior = index.files[entry.fileKey];
    const base = resetFlag || !prior || compressedDraftNeedsRestart(prior) ||
        prior.qualityFlags.includes('stale-reset-required')
      ? contributionFor(entry, timeZone, resetFlag ? [resetFlag] : [])
      : {
          ...cloneContribution(prior),
          qualityFlags: prior.qualityFlags.filter(
            (flag) => flag !== 'stale-file' && flag !== 'stale-reset-required',
          ),
        };
    const remainingBytes = budget.maxBytes - bytesRead;
    const endExclusive = compressedMainPassEnd(entry, base.offset, remainingBytes, filePasses === 0 && bytesRead === 0);
    if (endExclusive <= base.offset && !(entry.compression === 'zstd' && entry.size === 0)) {
      break;
    }
    bodyReads += 1;
    filePasses += 1;
    const passStartingBytes = bytesRead;
    try {
      const pass = await updateContribution(
        base,
        entry,
        { ...normalizedOptions, achievementUsageWindow: originAppends.has(entry.fileKey) ? usageWindow : undefined },
        io,
        endExclusive,
        onChunk(entry, passStartingBytes),
      );
      bytesRead = passStartingBytes + pass.bytesRead;
      index.files[entry.fileKey] = pass.contribution;
      const proof = copyCodexUsageDelta(pass.achievementUsageDelta, usageWindow);
      if (proof) originCandidates.set(entry.fileKey, proof);
    } catch (error) {
      if (error instanceof CodexIndexCancelledError) {
        throw error;
      }
      failedFiles += 1;
      if (recordTerminalFailure(entry, codexFilePassFailureCode(error))) {
        // Provisional chunks may already have been checkpointed; replace them
        // with the safe failure record before the next durable stage boundary.
      } else if (!prior && entry.compression === 'zstd') delete index.files[entry.fileKey];
      else if (prior) {
        index.files[entry.fileKey] = {
          ...prior,
          qualityFlags: uniqueFlags(
            prior.qualityFlags,
            ['stale-file'],
            resetFlag ? ['stale-reset-required'] : [],
          ),
        };
      }
    }
    dirtySinceCheckpoint = true;
    filePassesSinceCheckpoint += 1;
    if (!(await checkpoint(false))) {
      publishProgress(false);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  await finishStage(filePasses > mainPassStart, true);
  const mainPassEnd = filePasses;
  const allowHistoricalBackfill = options.allowHistoricalBackfill !== false;
  const lineageWork = (allowHistoricalBackfill ? manifest.files : [])
    .filter((entry) => {
      const contribution = index.files[entry.fileKey];
      return Boolean(
        contribution?.lineage &&
        (
          contribution.lineage.appliedPrefixEvents !==
            contribution.lineage.desiredPrefixEvents ||
          contribution.lineageReconciliation
        ),
      );
    })
    .sort(recentFirst);

  reconcileLineageForCheckpoint = false;
  const lineagePassStart = filePasses;
  if (options.filePassBatch && lineageWork.length > 1) {
    await cancelBeforePass();
    const tasks: CodexFilePassTask[] = [];
    const priorByTask = new Map<string, CodexFileContribution>();
    let reservedBytes = 0;
    for (const entry of lineageWork) {
      if (
        filePasses + tasks.length >= budget.maxFilePasses ||
        bytesRead + reservedBytes >= budget.maxBytes
      ) {
        break;
      }
      const prior = index.files[entry.fileKey];
      if (!prior) {
        continue;
      }
      const base = cloneContribution(prior);
      const reconciliation = base.lineageReconciliation;
      const start = reconciliation &&
          reconciliation.prefixEvents === base.lineage?.desiredPrefixEvents
        ? reconciliation.offset
        : 0;
      const endExclusive = Math.min(
        entry.size,
        start + (budget.maxBytes - bytesRead - reservedBytes),
      );
      if (endExclusive <= start) {
        promoteCaughtUpLineage(base);
        index.files[entry.fileKey] = base;
        continue;
      }
      const taskId = `lineage:${entry.fileKey}`;
      tasks.push({
        taskId,
        kind: 'lineage',
        contribution: base,
        entry,
        salt: normalizedOptions.salt,
        timeZone,
        asOfDay,
        endExclusive,
      });
      priorByTask.set(taskId, prior);
      reservedBytes += endExclusive - start;
    }
    await runParallelTasks(tasks, (task) => {
      const prior = priorByTask.get(task.taskId);
      if (prior) {
        index.files[task.entry.fileKey] = prior;
      }
    });
  } else for (const entry of lineageWork) {
    if (!hasBudget()) {
      break;
    }
    await cancelBeforePass();
    const prior = index.files[entry.fileKey];
    if (!prior) {
      continue;
    }
    const base = cloneContribution(prior);
    const reconciliation = base.lineageReconciliation;
    const start = reconciliation &&
        reconciliation.prefixEvents === base.lineage?.desiredPrefixEvents
      ? reconciliation.offset
      : 0;
    const endExclusive = Math.min(
      entry.size,
      start + (budget.maxBytes - bytesRead),
    );
    if (endExclusive <= start) {
      promoteCaughtUpLineage(base);
      index.files[entry.fileKey] = base;
      continue;
    }
    bodyReads += 1;
    filePasses += 1;
    const passStartingBytes = bytesRead;
    try {
      const pass = await reconcileContributionLineage(
        base,
        entry,
        normalizedOptions,
        io,
        endExclusive,
        onChunk(entry, passStartingBytes),
      );
      bytesRead = passStartingBytes + pass.bytesRead;
      index.files[entry.fileKey] = pass.contribution;
    } catch (error) {
      if (error instanceof CodexIndexCancelledError) {
        throw error;
      }
      failedFiles += 1;
      if (!recordTerminalFailure(entry, codexFilePassFailureCode(error))) index.files[entry.fileKey] = prior;
    }
    dirtySinceCheckpoint = true;
    filePassesSinceCheckpoint += 1;
    if (!(await checkpoint(false))) {
      publishProgress(false);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  await finishStage(filePasses > lineagePassStart);
  const canonical = classifyCodexSessionDuplicates(index.files).canonicalFileKeys;
  const periodWork = (allowHistoricalBackfill ? manifest.files : [])
    .filter((entry) => {
      if (!canonical.has(entry.fileKey)) {
        return false;
      }
      const contribution = index.files[entry.fileKey];
      return Boolean(
        contribution &&
        !contribution.lineageReconciliation &&
        contribution.lineage?.appliedPrefixEvents ===
          contribution.lineage?.desiredPrefixEvents &&
        contribution.offset > 0 &&
        contribution.offset >= entry.size &&
        !contribution.discardingOversizedLine &&
        (
          (requireCalendarProof && !isCurrentCodexPeriodLineage(
            contribution.aggregate.period,
            contribution.lineage?.desiredPrefixEvents ?? 0,
          )) ||
          !isCompatibleCodexPeriodLineage(
            contribution.aggregate.period,
            contribution.lineage?.desiredPrefixEvents ?? 0,
          ) ||
          !codexPeriodFitsAggregate(
            contribution.aggregate.period,
            contribution.aggregate.total,
          ) ||
          contribution.aggregate.period?.timeZone !== timeZone ||
          contribution.aggregate.period.indexedThrough !== contribution.offset
        ),
      );
    })
    .sort(recentFirst);

  const periodPassStart = filePasses;
  if (options.filePassBatch && periodWork.length > 1) {
    await cancelBeforePass();
    const tasks: CodexFilePassTask[] = [];
    const priorByTask = new Map<string, CodexFileContribution>();
    let reservedBytes = 0;
    for (const entry of periodWork) {
      if (
        filePasses + tasks.length >= budget.maxFilePasses ||
        bytesRead + reservedBytes >= budget.maxBytes
      ) {
        break;
      }
      const prior = index.files[entry.fileKey];
      if (!prior) {
        continue;
      }
      const base = cloneContribution(prior);
      const start = resumablePeriodMigration(base, timeZone)?.offset ?? 0;
      const endExclusive = Math.min(
        base.offset,
        start + (budget.maxBytes - bytesRead - reservedBytes),
      );
      if (endExclusive <= start) {
        break;
      }
      const taskId = `period:${entry.fileKey}`;
      tasks.push({
        taskId,
        kind: 'period',
        contribution: base,
        entry,
        salt: normalizedOptions.salt,
        timeZone,
        asOfDay,
        endExclusive,
      });
      priorByTask.set(taskId, prior);
      reservedBytes += endExclusive - start;
    }
    await runParallelTasks(tasks, (task) => {
      const prior = priorByTask.get(task.taskId);
      if (prior) {
        index.files[task.entry.fileKey] = prior;
      }
    });
  } else for (const entry of periodWork) {
    if (!hasBudget()) {
      break;
    }
    await cancelBeforePass();
    const prior = index.files[entry.fileKey];
    if (!prior) {
      continue;
    }
    const base = cloneContribution(prior);
    const start = resumablePeriodMigration(base, timeZone)?.offset ?? 0;
    const endExclusive = Math.min(
      base.offset,
      start + (budget.maxBytes - bytesRead),
    );
    if (endExclusive <= start) {
      break;
    }
    bodyReads += 1;
    filePasses += 1;
    const passStartingBytes = bytesRead;
    try {
      const pass = await migrateContributionPeriod(
        base,
        entry,
        normalizedOptions,
        io,
        endExclusive,
        onChunk(entry, passStartingBytes),
      );
      bytesRead = passStartingBytes + pass.bytesRead;
      index.files[entry.fileKey] = pass.contribution;
    } catch (error) {
      if (error instanceof CodexIndexCancelledError) {
        throw error;
      }
      failedFiles += 1;
      if (!recordTerminalFailure(entry, codexFilePassFailureCode(error))) index.files[entry.fileKey] = prior;
    }
    dirtySinceCheckpoint = true;
    filePassesSinceCheckpoint += 1;
    if (!(await checkpoint(false))) {
      publishProgress(false);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  await finishStage(filePasses > periodPassStart);

  const todayCanonical = classifyCodexSessionDuplicates(index.files)
    .canonicalFileKeys;
  const hourlyWindowDays = rollingHourlyDaySet(asOfDay);
  const todayWork = (allowHistoricalBackfill ? manifest.files : [])
    .filter((entry) => {
      if (!todayCanonical.has(entry.fileKey)) {
        return false;
      }
      const contribution = index.files[entry.fileKey];
      return Boolean(
        contribution &&
        isCodexUsageContributionCurrent(contribution) &&
        !contribution.lineageReconciliation &&
        contribution.lineage?.appliedPrefixEvents ===
          contribution.lineage?.desiredPrefixEvents &&
        contribution.offset > 0 &&
        contribution.offset >= entry.size &&
        !contribution.discardingOversizedLine &&
        Object.keys(contribution.aggregate.period?.days ?? {})
          .some((day) => hourlyWindowDays.has(day)) &&
        (
          !isRollingTodayIndex(contribution.aggregate.today, timeZone) ||
          contribution.aggregate.today.day !== asOfDay ||
          contribution.aggregate.today.indexedThrough !== contribution.offset
        )
      );
    })
    .sort(recentFirst);

  const todayPassStart = filePasses;
  if (options.filePassBatch && todayWork.length > 1) {
    await cancelBeforePass();
    const tasks: CodexFilePassTask[] = [];
    const priorByTask = new Map<string, CodexFileContribution>();
    let reservedBytes = 0;
    for (const entry of todayWork) {
      if (
        filePasses + tasks.length >= budget.maxFilePasses ||
        bytesRead + reservedBytes >= budget.maxBytes
      ) {
        break;
      }
      const prior = index.files[entry.fileKey];
      if (!prior) {
        continue;
      }
      const base = cloneContribution(prior);
      const migration = base.todayMigration;
      const start =
        migration?.day === asOfDay &&
          migration.timeZone === timeZone &&
          migration.windowDays === CODEX_ROLLING_HOURLY_DAYS &&
          migration.days &&
          migration.prefixEvents ===
            (base.lineage?.desiredPrefixEvents ?? 0)
          ? migration.offset
          : 0;
      const endExclusive = Math.min(
        base.offset,
        start + (budget.maxBytes - bytesRead - reservedBytes),
      );
      if (endExclusive <= start) {
        promoteCaughtUpToday(base, asOfDay, timeZone);
        index.files[entry.fileKey] = base;
        continue;
      }
      const taskId = `today:${entry.fileKey}`;
      tasks.push({
        taskId,
        kind: 'today',
        contribution: base,
        entry,
        salt: normalizedOptions.salt,
        timeZone,
        asOfDay,
        endExclusive,
      });
      priorByTask.set(taskId, prior);
      reservedBytes += endExclusive - start;
    }
    await runParallelTasks(tasks, (task) => {
      const prior = priorByTask.get(task.taskId);
      if (prior) {
        index.files[task.entry.fileKey] = prior;
      }
    });
  } else for (const entry of todayWork) {
    if (!hasBudget()) {
      break;
    }
    await cancelBeforePass();
    const prior = index.files[entry.fileKey];
    if (!prior) {
      continue;
    }
    const base = cloneContribution(prior);
    const migration = base.todayMigration;
    const start =
      migration?.day === asOfDay &&
        migration.timeZone === timeZone &&
        migration.windowDays === CODEX_ROLLING_HOURLY_DAYS &&
        migration.days &&
        migration.prefixEvents ===
          (base.lineage?.desiredPrefixEvents ?? 0)
        ? migration.offset
        : 0;
    const endExclusive = Math.min(
      base.offset,
      start + (budget.maxBytes - bytesRead),
    );
    if (endExclusive <= start) {
      promoteCaughtUpToday(base, asOfDay, timeZone);
      index.files[entry.fileKey] = base;
      continue;
    }
    bodyReads += 1;
    filePasses += 1;
    const passStartingBytes = bytesRead;
    try {
      const pass = await migrateContributionToday(
        base,
        entry,
        normalizedOptions,
        io,
        endExclusive,
        onChunk(entry, passStartingBytes),
      );
      bytesRead = passStartingBytes + pass.bytesRead;
      index.files[entry.fileKey] = pass.contribution;
    } catch (error) {
      if (error instanceof CodexIndexCancelledError) {
        throw error;
      }
      failedFiles += 1;
      if (!recordTerminalFailure(entry, codexFilePassFailureCode(error))) index.files[entry.fileKey] = prior;
    }
    dirtySinceCheckpoint = true;
    filePassesSinceCheckpoint += 1;
    if (!(await checkpoint(false))) {
      publishProgress(false);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  await finishStage(filePasses > todayPassStart);

  reconcileLineageForCheckpoint = true;
  const identityPassStart = filePasses;
  const identityWork = allowHistoricalBackfill
    ? manifest.files.sort(recentFirst)
    : [];
  const pendingIdentity = identityWork.filter(
    (entry) => !hasCurrentCompressionFailure(index.files[entry.fileKey], entry) &&
      index.files[entry.fileKey]?.identityChecked !== true,
  );
  if (options.filePassBatch && pendingIdentity.length > 1) {
    await cancelBeforePass();
    const tasks: CodexFilePassTask[] = [];
    let reservedBytes = 0;
    for (const entry of pendingIdentity) {
      const contribution = index.files[entry.fileKey];
      if (!contribution) {
        continue;
      }
      const identityBytes = Math.min(entry.size, MAX_IDENTITY_BYTES);
      if (
        filePasses + tasks.length >= budget.maxFilePasses ||
        bytesRead + reservedBytes + identityBytes > budget.maxBytes
      ) {
        break;
      }
      tasks.push({
        taskId: `identity:${entry.fileKey}`,
        kind: 'identity',
        contribution: cloneContribution(contribution),
        entry,
        salt: normalizedOptions.salt,
        timeZone,
        asOfDay,
        endExclusive: identityBytes,
      });
      reservedBytes += identityBytes;
    }
    await runParallelTasks(tasks, () => undefined);
  } else for (const entry of pendingIdentity) {
    if (!hasBudget()) {
      break;
    }
    const contribution = index.files[entry.fileKey];
    if (!contribution || contribution.identityChecked === true) {
      continue;
    }
    await cancelBeforePass();
    const identityBytes = Math.min(entry.size, MAX_IDENTITY_BYTES);
    if (identityBytes > budget.maxBytes - bytesRead) {
      break;
    }
    bodyReads += 1;
    filePasses += 1;
    bytesRead += identityBytes;
    try {
      index.files[entry.fileKey] = await backfillIdentity(
        contribution,
        entry,
        normalizedOptions,
        io,
        async () => {
          publishProgress(false);
          if (options.shouldCancel?.()) {
            if (!cancellationCheckpointed) {
              await checkpoint(true);
              cancellationCheckpointed = true;
            }
            throw new CodexIndexCancelledError();
          }
        },
      );
    } catch (error) {
      if (error instanceof CodexIndexCancelledError) {
        throw error;
      }
      failedFiles += 1;
      recordTerminalFailure(entry, codexFilePassFailureCode(error));
    }
    dirtySinceCheckpoint = true;
    filePassesSinceCheckpoint += 1;
    if (!(await checkpoint(false))) {
      publishProgress(false);
    }
  }

  await finishStage(filePasses > identityPassStart);
  // A migrated index has no older hour positions in its period projection.
  // Run this only under the historical-work allowance and only after lineage
  // and duplicate classification have settled. Each pass is streaming and
  // checkpointed at the same safe JSONL cursor as the other migrations.
  recomputeDerivedIndex(index, manifest, timeZone, asOfDay, true, requireCalendarProof);
  const hourProofStart = filePasses;
  // Routine appended tails should not starve older hour proofs. Keep only one
  // historical migration stage per refresh to protect the bounded I/O budget.
  if (allowHistoricalBackfill && options.allowAchievementHourProof !== false &&
      filePasses === mainPassEnd && hasBudget()) {
    const hourWork = hourProofWorkEntries(index, manifest).sort(recentFirst);
    for (const entry of hourWork) {
      if (!hasBudget()) break;
      await cancelBeforePass();
      const prior = index.files[entry.fileKey];
      const base = cloneContribution(prior);
      const draft = base.hourProofMigration;
      const start = draft?.version === CODEX_UTC_HOUR_PROOF_VERSION &&
        draft.prefixEvents === (base.lineage?.desiredPrefixEvents ?? 0) &&
        !draft.overflow
          ? draft.offset : 0;
      const endExclusive = Math.min(base.offset, start + budget.maxBytes - bytesRead);
      if (endExclusive <= start) break;
      bodyReads += 1;
      filePasses += 1;
      const passStartingBytes = bytesRead;
      try {
        const pass = await migrateContributionHourProof(
          base, entry, normalizedOptions, io, endExclusive,
          onChunk(entry, passStartingBytes),
        );
        bytesRead = passStartingBytes + pass.bytesRead;
        index.files[entry.fileKey] = pass.contribution;
      } catch (error) {
        if (error instanceof CodexIndexCancelledError) throw error;
        failedFiles += 1;
        if (!recordTerminalFailure(entry, codexFilePassFailureCode(error))) index.files[entry.fileKey] = prior;
      }
      dirtySinceCheckpoint = true;
      filePassesSinceCheckpoint += 1;
      if (!(await checkpoint(false))) publishProgress(false);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  await finishStage(filePasses > hourProofStart);
  if (filePasses === 0) {
    options.onProgress?.(progressFor(index, manifest.files.length));
  } else {
    publishProgress(true);
  }
  const historicalHourProof = codexHourProofSnapshot(index);
  const achievementUsageDelta = finalizeCodexUsageDelta(previous, index, originCandidates, usageWindow);
  const terminalSettled = manifest.files.some(entry => hasCurrentCompressionFailure(index.files[entry.fileKey], entry)) &&
    isWarmNoOp(index, manifest, diffCodexManifest(previousManifest(index), manifest.persistable),
      timeZone, asOfDay, allowHistoricalBackfill, options.allowAchievementHourProof !== false);
  return {
    ...(achievementUsageDelta ? { achievementUsageDelta } : {}),
    index,
    indexChanged: true,
    bodyReads,
    failedFiles,
    migration: {
      filePasses,
      bytesRead,
      pending:
        !terminalSettled && (!index.coverage.complete ||
        !index.coverage.period.allTime.complete ||
        !index.coverage.hourly?.complete ||
        (options.allowAchievementHourProof !== false && !historicalHourProof.complete &&
          (historicalHourProof.backfillableFiles ?? 0) > 0)),
    },
  };
}

interface LegacyCodexIndexV1 {
  readonly schemaVersion: 1;
  readonly files: Readonly<Record<string, LegacyCodexFileContribution>>;
  readonly aggregate?: unknown;
  readonly coverage?: unknown;
  readonly quotaHistory?: unknown;
}

interface LegacyCodexFileContribution {
  readonly fileKey?: unknown;
  readonly sourceArea?: unknown;
  readonly size?: unknown;
  readonly mtimeMs?: unknown;
  readonly dev?: unknown;
  readonly ino?: unknown;
  readonly offset?: unknown;
  readonly discardingOversizedLine?: unknown;
  readonly carry?: unknown;
  readonly parserState?: unknown;
  readonly aggregate?: unknown;
  readonly limit?: unknown;
  readonly limits?: unknown;
  readonly quotaHistory?: unknown;
  readonly qualityFlags?: unknown;
  readonly identityChecked?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndexV1(value: unknown): value is LegacyCodexIndexV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isRecord(value.files)
  );
}

interface LegacyCodexIndexV2 {
  readonly schemaVersion: 2;
  readonly files: Readonly<Record<string, unknown>>;
  readonly aggregate?: unknown;
  readonly coverage?: unknown;
  readonly quotaHistory?: unknown;
}

function isLegacyIndexV2(value: unknown): value is LegacyCodexIndexV2 {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    isRecord(value.files)
  );
}

function isIndexV3(value: unknown): value is CodexIndexV3 {
  return (
    isRecord(value) &&
    value.schemaVersion === 3 &&
    isRecord(value.files) &&
    isRecord(value.aggregate) &&
    isRecord(value.coverage)
  );
}

interface LegacyCodexStructuralSummary {
  filesChanged?: number;
  patchRounds?: number;
  commands?: number;
  postChangeCommands?: number;
  compactCount?: number;
  taskCompleteCount?: number;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function sanitizeTokens(value: unknown): ProviderTokenCounts {
  const record = isRecord(value) ? value : {};
  return {
    inputTotal: finiteNumber(record.inputTotal),
    ...(optionalNumber(record.cachedInput) !== undefined
      ? { cachedInput: optionalNumber(record.cachedInput) }
      : {}),
    ...(optionalNumber(record.cacheWriteInput) !== undefined
      ? { cacheWriteInput: optionalNumber(record.cacheWriteInput) }
      : {}),
    outputTotal: finiteNumber(record.outputTotal),
    ...(optionalNumber(record.reasoningOutput) !== undefined
      ? { reasoningOutput: optionalNumber(record.reasoningOutput) }
      : {}),
    ...(optionalNumber(record.sourceTotal) !== undefined
      ? { sourceTotal: optionalNumber(record.sourceTotal) }
      : {}),
  };
}

function sanitizeBuckets(value: unknown): Record<string, ProviderTokenCounts> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, tokens]) => [key, sanitizeTokens(tokens)]),
  );
}

function sanitizeLabelBuckets(
  value: unknown,
): Record<string, ProviderTokenCounts> {
  if (!isRecord(value)) {
    return {};
  }
  const buckets: Record<string, ProviderTokenCounts> = {};
  for (const [key, tokens] of Object.entries(value)) {
    const label = sanitizeCodexMetadataLabel(key) ?? 'unknown';
    addTokens(bucket(buckets, label), sanitizeTokens(tokens));
  }
  return buckets;
}

function sanitizeProviderAggregate(value: unknown): CodexProviderAggregate {
  const record = isRecord(value) ? value : {};
  return {
    total: sanitizeTokens(record.total),
    byDay: sanitizeBuckets(record.byDay),
    byModel: sanitizeLabelBuckets(record.byModel),
    byEffort: sanitizeLabelBuckets(record.byEffort),
  };
}

function sanitizeRole(value: unknown): ProviderThreadRole {
  return value === 'root' ||
    value === 'subagent' ||
    value === 'approval-reviewer' ||
    value === 'unknown'
    ? value
    : 'unknown';
}

function sanitizeQualityFlags(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(
        (flag): flag is string =>
          typeof flag === 'string' && /^[a-z0-9-]{1,80}$/.test(flag),
      ))].sort()
    : [];
}

function sanitizePseudonymousIdentityKey(
  value: unknown,
): PseudonymousIdentityKey | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    ? value as PseudonymousIdentityKey
    : undefined;
}

const TOKEN_SNAPSHOT_SIGNATURE =
  /^t:(?:-|\d+:\d+:\d+:\d+:\d+)\|l:(?:-|\d+:\d+:\d+:\d+:\d+)$/;
const MAX_TOKEN_SNAPSHOT_SOURCES = 32;

function sanitizeTokenSnapshotSignature(value: unknown): string | undefined {
  return typeof value === 'string' &&
      value.length <= 200 &&
      TOKEN_SNAPSHOT_SIGNATURE.test(value)
    ? value
    : undefined;
}

function sanitizeTokenSnapshotSource(value: string): string | undefined {
  if (value === 'default' || value === 'unknown-source') {
    return value;
  }
  return sanitizePseudonymousIdentityKey(value);
}

function sanitizeTokenSnapshotSignatures(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const signatures: Record<string, string> = {};
  let found = false;
  for (const [rawSource, rawSignature] of Object.entries(value)) {
    const source = sanitizeTokenSnapshotSource(rawSource);
    const signature = sanitizeTokenSnapshotSignature(rawSignature);
    if (!source || !signature) {
      continue;
    }
    delete signatures[source];
    signatures[source] = signature;
    found = true;
    const keys = Object.keys(signatures);
    if (keys.length > MAX_TOKEN_SNAPSHOT_SOURCES) {
      delete signatures[keys[0]];
    }
  }
  return found ? signatures : undefined;
}

function sanitizeParserState(value: unknown, fileKey: string): CodexParserState {
  const record = isRecord(value) ? value : {};
  const verifiedFileKey =
    sanitizePseudonymousIdentityKey(fileKey) ?? NEUTRAL_CODEX_SESSION_KEY;
  const sessionKey =
    sanitizePseudonymousIdentityKey(record.sessionKey) ?? verifiedFileKey;
  const parentSessionKey = sanitizePseudonymousIdentityKey(
    record.parentSessionKey,
  );
  const treeKey = sanitizePseudonymousIdentityKey(record.treeKey);
  const projectKey = sanitizePseudonymousIdentityKey(record.projectKey);
  const agentNickname = sanitizeCodexMetadataLabel(record.agentNickname);
  const model = sanitizeCodexMetadataLabel(record.model);
  const effort = sanitizeCodexMetadataLabel(record.effort);
  const highWater = isRecord(record.highWater)
    ? {
        inputTokens: finiteNumber(record.highWater.inputTokens),
        cachedInputTokens: finiteNumber(record.highWater.cachedInputTokens),
        outputTokens: finiteNumber(record.highWater.outputTokens),
        reasoningOutputTokens: finiteNumber(record.highWater.reasoningOutputTokens),
        totalTokens: finiteNumber(record.highWater.totalTokens),
      }
    : undefined;
  const snapshotSignaturesBySource = sanitizeTokenSnapshotSignatures(
    record.snapshotSignaturesBySource,
  );
  const previousSnapshotSignature = sanitizeTokenSnapshotSignature(
    record.previousSnapshotSignature,
  );
  return {
    schemaVersion: 4,
    fileKey,
    sessionKey,
    ...(treeKey ? { treeKey } : {}),
    identityLocked: record.identityLocked === true,
    ...(parentSessionKey ? { parentSessionKey } : {}),
    ...(projectKey ? { projectKey } : {}),
    ...(optionalString(record.projectName)
      ? { projectName: optionalString(record.projectName) }
      : {}),
    ...(optionalString(record.projectDirectoryName)
      ? { projectDirectoryName: optionalString(record.projectDirectoryName) }
      : {}),
    ...(agentNickname ? { agentNickname } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    role: sanitizeRole(record.role),
    ...(highWater ? { highWater } : {}),
    ...(snapshotSignaturesBySource ? { snapshotSignaturesBySource } : {}),
    ...(previousSnapshotSignature ? { previousSnapshotSignature } : {}),
    qualityFlags: sanitizeQualityFlags(record.qualityFlags),
  };
}

function legacyCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function migrateLegacyStructural(
  structural: Record<string, unknown>,
): CodexStructuralSummary {
  const legacy = structural as LegacyCodexStructuralSummary;
  return {
    patchCalls: legacyCount(legacy.patchRounds),
    toolCalls: legacyCount(legacy.commands),
    postPatchToolCalls: legacyCount(legacy.postChangeCommands),
    compactCount: legacyCount(legacy.compactCount),
    taskCompleteCount: legacyCount(legacy.taskCompleteCount),
  };
}

function sanitizeStructural(value: unknown): CodexStructuralSummary {
  const structural = isRecord(value) ? value : {};
  if ('patchCalls' in structural) {
    return {
      patchCalls: legacyCount(structural.patchCalls),
      toolCalls: legacyCount(structural.toolCalls),
      postPatchToolCalls: legacyCount(structural.postPatchToolCalls),
      compactCount: legacyCount(structural.compactCount),
      taskCompleteCount: legacyCount(structural.taskCompleteCount),
    };
  }
  return migrateLegacyStructural(structural);
}

function sanitizePeriod(value: unknown): CodexFilePeriodIndex | undefined {
  if (!isRecord(value) || typeof value.timeZone !== 'string') {
    return undefined;
  }
  const rawDays = isRecord(value.days) ? value.days : {};
  const days = Object.fromEntries(
    Object.entries(rawDays).flatMap(([key, rawSlice]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isRecord(rawSlice)) {
        return [];
      }
      return [[key, {
        total: sanitizeTokens(rawSlice.total),
        byModel: sanitizeLabelBuckets(rawSlice.byModel),
        byEffort: sanitizeLabelBuckets(rawSlice.byEffort),
        structural: sanitizeStructural(rawSlice.structural),
        ...(optionalNumber(rawSlice.firstObservedAt) !== undefined
          ? { firstObservedAt: optionalNumber(rawSlice.firstObservedAt) }
          : {}),
        ...(optionalNumber(rawSlice.lastObservedAt) !== undefined
          ? { lastObservedAt: optionalNumber(rawSlice.lastObservedAt) }
          : {}),
      }]];
    }),
  );
  return {
    timeZone: resolveTimeZone(value.timeZone),
    indexedThrough: Math.max(0, finiteNumber(value.indexedThrough)),
    days,
    ...(optionalNumber(value.lineageVersion) !== undefined
      ? { lineageVersion: optionalNumber(value.lineageVersion) }
      : {}),
    ...(optionalNumber(value.lineagePrefixEvents) !== undefined
      ? { lineagePrefixEvents: Math.max(0, Math.floor(optionalNumber(value.lineagePrefixEvents)!)) }
      : {}),
  };
}

function sanitizeHourlySlices(
  value: unknown,
): CodexFileTodayIndex['hours'] {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([hour, rawSlice]) => {
      if (!/^(?:[01]\d|2[0-3])$/.test(hour) || !isRecord(rawSlice)) {
        return [];
      }
      return [[hour, {
        total: sanitizeTokens(rawSlice.total),
        byModel: sanitizeLabelBuckets(rawSlice.byModel),
      }]];
    }),
  );
}

function sanitizeHourlyDays(value: unknown): CodexHourlyDays {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([day, rawHours]) => {
      if (rollingDayKeysFromDayKey(day, 1)[0] !== day) {
        return [];
      }
      const hours = sanitizeHourlySlices(rawHours);
      return Object.keys(hours).length > 0 ? [[day, hours]] : [];
    }),
  );
}

function sanitizeToday(value: unknown): CodexFileTodayIndex | undefined {
  if (
    !isRecord(value) ||
    typeof value.timeZone !== 'string' ||
    typeof value.day !== 'string' ||
    rollingDayKeysFromDayKey(value.day, 1)[0] !== value.day
  ) {
    return undefined;
  }
  const timeZone = resolveTimeZone(value.timeZone);
  const modern = value.windowDays === CODEX_ROLLING_HOURLY_DAYS &&
    isRecord(value.days);
  const days = modern ? sanitizeHourlyDays(value.days) : undefined;
  if (days) {
    pruneCodexHourlyDays(days, rollingHourlyDaySet(value.day));
  }
  return {
    day: value.day,
    timeZone,
    indexedThrough: Math.max(0, finiteNumber(value.indexedThrough)),
    hours: days ? days[value.day] ?? {} : sanitizeHourlySlices(value.hours),
    ...(days
      ? {
          windowDays: CODEX_ROLLING_HOURLY_DAYS,
          days,
        }
      : {}),
  };
}

function sanitizeLineage(value: unknown): CodexLineageTrace | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const fingerprintBlocks = Array.isArray(value.fingerprintBlocks)
    ? value.fingerprintBlocks.filter((block): block is string => {
        const encodedLength = typeof block === 'string' ? block.length : 0;
        const padding = typeof block === 'string'
          ? (block[encodedLength - 1] === '=' ? 1 : 0) +
            (block[encodedLength - 2] === '=' ? 1 : 0)
          : 0;
        const decodedBytes = encodedLength / 4 * 3 - padding;
        return (
          typeof block === 'string' &&
          encodedLength > 0 &&
          encodedLength <= Math.ceil(
            CODEX_LINEAGE_FINGERPRINT_BYTES *
              CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK / 3,
          ) * 4 &&
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(block) &&
          decodedBytes % CODEX_LINEAGE_FINGERPRINT_BYTES === 0
        );
      })
    : [];
  const pendingFingerprints = Array.isArray(value.pendingFingerprints)
    ? value.pendingFingerprints.filter(
        (fingerprint, index): fingerprint is string =>
          index < CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK - 1 &&
          typeof fingerprint === 'string' &&
          /^[a-f0-9]{32}$/.test(fingerprint),
      )
    : [];
  let packedTokenEvents = 0;
  for (const block of fingerprintBlocks) {
    const padding = (block[block.length - 1] === '=' ? 1 : 0) +
      (block[block.length - 2] === '=' ? 1 : 0);
    packedTokenEvents += (block.length / 4 * 3 - padding) /
      CODEX_LINEAGE_FINGERPRINT_BYTES;
  }
  const tokenEvents = packedTokenEvents + pendingFingerprints.length;
  const desiredPrefixEvents = Math.min(
    tokenEvents,
    Math.max(0, Math.floor(finiteNumber(value.desiredPrefixEvents))),
  );
  const appliedPrefixEvents = Math.min(
    tokenEvents,
    Math.max(0, Math.floor(finiteNumber(value.appliedPrefixEvents))),
  );
  return {
    fingerprintBlocks,
    pendingFingerprints,
    tokenEvents,
    desiredPrefixEvents,
    appliedPrefixEvents,
  };
}

function sanitizePeriodMigration(
  value: unknown,
  fileKey: string,
): CodexPeriodMigrationState | undefined {
  if (!isRecord(value) || typeof value.timeZone !== 'string') {
    return undefined;
  }
  const period = sanitizePeriod({
    timeZone: value.timeZone,
    indexedThrough: value.offset,
    days: value.days,
  });
  if (!period) {
    return undefined;
  }
  return {
    timeZone: period.timeZone,
    ...(optionalNumber(value.prefixEvents) !== undefined
      ? { prefixEvents: Math.max(0, Math.floor(optionalNumber(value.prefixEvents)!)) }
      : {}),
    ...(optionalNumber(value.tokenEventsSeen) !== undefined
      ? { tokenEventsSeen: Math.max(0, Math.floor(optionalNumber(value.tokenEventsSeen)!)) }
      : {}),
    offset: Math.max(0, finiteNumber(value.offset)),
    discardingOversizedLine: value.discardingOversizedLine === true,
    parserState: sanitizeParserState(value.parserState, fileKey),
    days: period.days,
    qualityFlags: sanitizeQualityFlags(value.qualityFlags),
  };
}

// Keep the persisted DTO sanitizer local: repository policy audits every field
// reachable from sanitizeIndexV2 rather than trusting an external return value.
function sanitizeCodexHourProof(value: unknown): CodexHourProof | undefined {
  if (!isRecord(value) || value.version !== CODEX_UTC_HOUR_PROOF_VERSION ||
      !Number.isSafeInteger(value.indexedThrough) || (value.indexedThrough as number) < 0 ||
      !Number.isSafeInteger(value.prefixEvents) || (value.prefixEvents as number) < 0 ||
      !Array.isArray(value.hours) || value.hours.length > MAX_CODEX_HOURS_PER_FILE) {
    return undefined;
  }
  const hours: number[] = [];
  for (const hour of value.hours) {
    if (!Number.isSafeInteger(hour) || hour <= 0 ||
        (hours.length > 0 && hour <= hours[hours.length - 1])) return undefined;
    hours.push(hour);
  }
  return {
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    indexedThrough: value.indexedThrough as number,
    prefixEvents: value.prefixEvents as number,
    hours,
  };
}

function sanitizeHourProofMigration(
  value: unknown,
  fileKey: string,
): CodexHourProofMigrationState | undefined {
  if (!isRecord(value) || value.version !== CODEX_UTC_HOUR_PROOF_VERSION ||
      !Number.isSafeInteger(value.offset) || (value.offset as number) < 0 ||
      !Number.isSafeInteger(value.prefixEvents) || (value.prefixEvents as number) < 0 ||
      !Number.isSafeInteger(value.tokenEventsSeen) ||
      (value.tokenEventsSeen as number) < 0 ||
      !isRecord(value.parserState) || value.parserState.schemaVersion !== 4 ||
      value.parserState.fileKey !== fileKey) return undefined;
  const proof = sanitizeCodexHourProof({
    version: value.version,
    indexedThrough: value.offset,
    prefixEvents: value.prefixEvents,
    hours: value.hours,
  });
  if (!proof) return undefined;
  return {
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    offset: proof.indexedThrough,
    prefixEvents: proof.prefixEvents,
    tokenEventsSeen: value.tokenEventsSeen as number,
    discardingOversizedLine: value.discardingOversizedLine === true,
    parserState: sanitizeParserState(value.parserState, fileKey),
    hours: proof.hours,
    ...(value.overflow === true ? { overflow: true } : {}),
  };
}

function sanitizeTodayMigration(
  value: unknown,
  fileKey: string,
): CodexTodayMigrationState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const today = sanitizeToday({
    day: value.day,
    timeZone: value.timeZone,
    indexedThrough: value.offset,
    hours: value.hours,
    windowDays: value.windowDays,
    days: value.days,
  });
  if (!today) {
    return undefined;
  }
  return {
    day: today.day,
    timeZone: today.timeZone,
    prefixEvents: Math.max(0, Math.floor(finiteNumber(value.prefixEvents))),
    tokenEventsSeen: Math.max(
      0,
      Math.floor(finiteNumber(value.tokenEventsSeen)),
    ),
    offset: Math.max(0, finiteNumber(value.offset)),
    discardingOversizedLine: value.discardingOversizedLine === true,
    parserState: sanitizeParserState(value.parserState, fileKey),
    hours: today.hours,
    ...(today.windowDays === CODEX_ROLLING_HOURLY_DAYS && today.days
      ? {
          windowDays: CODEX_ROLLING_HOURLY_DAYS,
          days: today.days,
        }
      : {}),
    qualityFlags: sanitizeQualityFlags(value.qualityFlags),
  };
}

function sanitizeLimit(value: unknown): ProviderLimitSnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.windows)) {
    return undefined;
  }
  const windows = value.windows.flatMap((window) => {
    if (!isRecord(window) || optionalNumber(window.usedPercent) === undefined) {
      return [];
    }
    return [{
      ...(optionalString(window.label) ? { label: optionalString(window.label) } : {}),
      usedPercent: finiteNumber(window.usedPercent),
      ...(optionalNumber(window.windowMinutes) !== undefined
        ? { windowMinutes: optionalNumber(window.windowMinutes) }
        : {}),
      ...(optionalNumber(window.resetsAt) !== undefined
        ? { resetsAt: optionalNumber(window.resetsAt) }
        : {}),
    }];
  });
  const credits = isRecord(value.credits) ? value.credits : undefined;
  return {
    provider: value.provider === 'claude' ? 'claude' : 'codex',
    ...(optionalString(value.limitId) ? { limitId: optionalString(value.limitId) } : {}),
    ...(optionalString(value.limitName)
      ? { limitName: optionalString(value.limitName) }
      : {}),
    observedAt: finiteNumber(value.observedAt),
    source: value.source === 'oauth' ? 'oauth' : 'local-log',
    windows,
    confidence: value.confidence === 'exact' || value.confidence === 'unknown'
      ? value.confidence
      : 'last-observed',
    ...(credits
      ? {
          credits: {
            ...(typeof credits.hasCredits === 'boolean'
              ? { hasCredits: credits.hasCredits }
              : {}),
            ...(typeof credits.unlimited === 'boolean'
              ? { unlimited: credits.unlimited }
              : {}),
            ...(optionalString(credits.balance)
              ? { balance: optionalString(credits.balance) }
              : {}),
          },
        }
      : {}),
  };
}

function sanitizeLimits(value: unknown): Record<string, ProviderLimitSnapshot> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const limits = Object.entries(value).flatMap(([key, raw]) => {
    const limit = sanitizeLimit(raw);
    return limit ? [[key, limit] as const] : [];
  });
  return limits.length > 0 ? Object.fromEntries(limits) : undefined;
}

function sanitizeSession(
  value: unknown,
  parserState: CodexParserState,
): CodexFileAggregate['session'] {
  const session = isRecord(value) ? value : {};
  const sessionKey =
    sanitizePseudonymousIdentityKey(session.sessionKey) ??
    sanitizePseudonymousIdentityKey(parserState.sessionKey) ??
    NEUTRAL_CODEX_SESSION_KEY;
  const parentSessionKey =
    sanitizePseudonymousIdentityKey(session.parentSessionKey) ??
    sanitizePseudonymousIdentityKey(parserState.parentSessionKey);
  const projectKey =
    sanitizePseudonymousIdentityKey(session.projectKey) ??
    sanitizePseudonymousIdentityKey(parserState.projectKey);
  const agentNickname = sanitizeCodexMetadataLabel(session.agentNickname);
  return {
    sessionKey,
    ...(parentSessionKey ? { parentSessionKey } : {}),
    ...(projectKey ? { projectKey } : {}),
    ...(optionalString(session.projectName)
      ? { projectName: optionalString(session.projectName) }
      : {}),
    ...(optionalString(session.projectDirectoryName)
      ? { projectDirectoryName: optionalString(session.projectDirectoryName) }
      : {}),
    ...(agentNickname ? { agentNickname } : {}),
    role: sanitizeRole(session.role),
    ...(optionalNumber(session.startedAt) !== undefined
      ? { startedAt: optionalNumber(session.startedAt) }
      : {}),
    ...(optionalNumber(session.endedAt) !== undefined
      ? { endedAt: optionalNumber(session.endedAt) }
      : {}),
  };
}

function sanitizeFileAggregate(
  value: unknown,
  parserState: CodexParserState,
): CodexFileAggregate {
  const aggregate = isRecord(value) ? value : {};
  const period = sanitizePeriod(aggregate.period);
  const today = sanitizeToday(aggregate.today);
  return {
    total: sanitizeTokens(aggregate.total),
    byDay: sanitizeBuckets(aggregate.byDay),
    byModel: sanitizeLabelBuckets(aggregate.byModel),
    byEffort: sanitizeLabelBuckets(aggregate.byEffort),
    session: sanitizeSession(aggregate.session, parserState),
    structural: sanitizeStructural(aggregate.structural),
    ...(period ? { period } : {}),
    ...(today ? { today } : {}),
  };
}

function sanitizeLineageReconciliation(
  value: unknown,
  fileKey: string,
): CodexLineageReconciliationState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const parserState = sanitizeParserState(value.parserState, fileKey);
  const hourProof = sanitizeCodexHourProof({
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    indexedThrough: value.offset,
    prefixEvents: value.prefixEvents,
    hours: value.hourProofHours,
  });
  return {
    prefixEvents: Math.max(0, Math.floor(finiteNumber(value.prefixEvents))),
    tokenEventsSeen: Math.max(
      0,
      Math.floor(finiteNumber(value.tokenEventsSeen)),
    ),
    offset: Math.max(0, finiteNumber(value.offset)),
    discardingOversizedLine: value.discardingOversizedLine === true,
    parserState,
    aggregate: sanitizeFileAggregate(value.aggregate, parserState),
    qualityFlags: sanitizeQualityFlags(value.qualityFlags),
    ...(hourProof ? { hourProofHours: hourProof.hours } : {}),
    ...(value.hourProofOverflow === true ? { hourProofOverflow: true } : {}),
  };
}

function sanitizeCoverage(value: unknown): CodexIndexCoverage {
  const coverage = isRecord(value) ? value : {};
  const identity = isRecord(coverage.identity) ? coverage.identity : {};
  const period = isRecord(coverage.period) ? coverage.period : {};
  const sanitizeRange = (value: unknown): CodexRangeCoverage => {
    const range = isRecord(value) ? value : {};
    const migratedFiles = Math.max(0, finiteNumber(range.migratedFiles));
    const totalFiles = Math.max(0, finiteNumber(range.totalFiles));
    return {
      migratedFiles,
      totalFiles,
      migratedBytes: Math.max(0, finiteNumber(range.migratedBytes)),
      totalBytes: Math.max(0, finiteNumber(range.totalBytes)),
      complete: typeof range.complete === 'boolean'
        ? range.complete
        : migratedFiles === totalFiles,
    };
  };
  const timeZone = resolveTimeZone(
    typeof period.timeZone === 'string' ? period.timeZone : 'UTC',
  );
  const candidateAsOfDay = typeof period.asOfDay === 'string'
    ? period.asOfDay
    : '';
  const hasValidAsOfDay =
    rollingDayKeysFromDayKey(candidateAsOfDay, 1)[0] === candidateAsOfDay;
  const asOfDay = hasValidAsOfDay
    ? candidateAsOfDay
    : dayKeyInZone(new Date(Date.now()), timeZone);
  const last7Days = sanitizeRange(period.last7Days);
  const last30Days = sanitizeRange(period.last30Days);
  const rawHourly = isRecord(coverage.hourly) ? coverage.hourly : {};
  const hourlyTimeZone = resolveTimeZone(
    typeof rawHourly.timeZone === 'string' ? rawHourly.timeZone : timeZone,
  );
  const candidateHourlyDay = typeof rawHourly.asOfDay === 'string'
    ? rawHourly.asOfDay
    : '';
  const hasValidHourly =
    typeof rawHourly.timeZone === 'string' &&
    rawHourly.windowDays === CODEX_ROLLING_HOURLY_DAYS &&
    rollingDayKeysFromDayKey(candidateHourlyDay, 1)[0] === candidateHourlyDay;
  const hourlyAsOfDay = hasValidHourly ? candidateHourlyDay : asOfDay;
  const allowedHourlyDays = rollingHourlyDaySet(hourlyAsOfDay);
  const rawHourlyDays = isRecord(rawHourly.days) ? rawHourly.days : {};
  const hourlyDays = Object.fromEntries(
    Object.entries(rawHourlyDays).flatMap(([day, raw]) => {
      if (!allowedHourlyDays.has(day) || !isRecord(raw)) {
        return [];
      }
      const indexedFiles = Math.max(0, finiteNumber(raw.indexedFiles));
      const totalFiles = Math.max(0, finiteNumber(raw.totalFiles));
      return [[day, {
        day,
        indexedFiles,
        totalFiles,
        indexedBytes: Math.max(0, finiteNumber(raw.indexedBytes)),
        totalBytes: Math.max(0, finiteNumber(raw.totalBytes)),
        complete: hasValidHourly && raw.complete === true,
      }]];
    }),
  );
  const hourlyIndexedFiles = Math.max(0, finiteNumber(rawHourly.indexedFiles));
  const hourlyTotalFiles = Math.max(0, finiteNumber(rawHourly.totalFiles));
  const rawToday = isRecord(coverage.today) ? coverage.today : {};
  const todayTimeZone = resolveTimeZone(
    typeof rawToday.timeZone === 'string' ? rawToday.timeZone : timeZone,
  );
  const candidateTodayDay = typeof rawToday.day === 'string'
    ? rawToday.day
    : '';
  const hasValidToday =
    rollingDayKeysFromDayKey(candidateTodayDay, 1)[0] === candidateTodayDay &&
    typeof rawToday.timeZone === 'string';
  const todayDay = hasValidToday ? candidateTodayDay : asOfDay;
  const todayIndexedFiles = Math.max(
    0,
    finiteNumber(rawToday.indexedFiles),
  );
  const todayTotalFiles = Math.max(0, finiteNumber(rawToday.totalFiles));
  if (!hasValidAsOfDay) {
    last7Days.complete = false;
    last30Days.complete = false;
  }
  return {
    indexedFiles: finiteNumber(coverage.indexedFiles),
    totalFiles: finiteNumber(coverage.totalFiles),
    indexedBytes: finiteNumber(coverage.indexedBytes),
    totalBytes: finiteNumber(coverage.totalBytes),
    complete: coverage.complete === true,
    identity: {
      exactDuplicateFiles: Math.max(
        0,
        finiteNumber(identity.exactDuplicateFiles),
      ),
      ambiguousSessionGroups: Math.max(
        0,
        finiteNumber(identity.ambiguousSessionGroups),
      ),
      complete: identity.complete !== false,
    },
    period: {
      timeZone,
      asOfDay,
      last7Days,
      last30Days,
      allTime: sanitizeRange(period.allTime),
    },
    hourly: {
      timeZone: hourlyTimeZone,
      asOfDay: hourlyAsOfDay,
      windowDays: CODEX_ROLLING_HOURLY_DAYS,
      indexedFiles: hourlyIndexedFiles,
      totalFiles: hourlyTotalFiles,
      indexedBytes: Math.max(0, finiteNumber(rawHourly.indexedBytes)),
      totalBytes: Math.max(0, finiteNumber(rawHourly.totalBytes)),
      complete: hasValidHourly && rawHourly.complete === true,
      days: hourlyDays,
    },
    today: {
      timeZone: todayTimeZone,
      day: todayDay,
      indexedFiles: todayIndexedFiles,
      totalFiles: todayTotalFiles,
      indexedBytes: Math.max(0, finiteNumber(rawToday.indexedBytes)),
      totalBytes: Math.max(0, finiteNumber(rawToday.totalBytes)),
      complete: hasValidToday && rawToday.complete === true,
    },
  };
}

function markLineageRescanRequired(index: CodexIndexV3): CodexIndexV3 {
  index.indexGeneration = Math.max(1, Math.floor(index.indexGeneration ?? 0) + 1);
  for (const contribution of Object.values(index.files)) {
    delete contribution.lineage;
    delete contribution.lineageReconciliation;
    delete contribution.aggregate.today;
    delete contribution.todayMigration;
    contribution.qualityFlags = uniqueFlags(
      contribution.qualityFlags,
      ['stale-reset-required'],
    );
    contribution.identityChecked = false;
  }
  index.aggregate = emptyAggregate();
  index.coverage.indexedFiles = 0;
  index.coverage.indexedBytes = 0;
  index.coverage.complete = false;
  index.coverage.identity.exactDuplicateFiles = 0;
  index.coverage.identity.ambiguousSessionGroups = 0;
  index.coverage.identity.complete = false;
  for (const range of [
    index.coverage.period.last7Days,
    index.coverage.period.last30Days,
    index.coverage.period.allTime,
  ]) {
    range.migratedFiles = 0;
    range.migratedBytes = 0;
    range.complete = false;
  }
  index.coverage.today.indexedFiles = 0;
  index.coverage.today.indexedBytes = 0;
  index.coverage.today.complete = false;
  if (index.coverage.hourly) {
    index.coverage.hourly.indexedFiles = 0;
    index.coverage.hourly.indexedBytes = 0;
    index.coverage.hourly.complete = false;
    index.coverage.hourly.days = {};
  }
  return index;
}

function migrateIndexV1(index: LegacyCodexIndexV1): CodexIndexV3 {
  const files: Record<string, CodexFileContribution> = {};
  for (const [key, old] of Object.entries(index.files)) {
    const offset = Math.max(0, finiteNumber(old.offset));
    const carryBytes = typeof old.carry === 'string'
      ? Buffer.byteLength(old.carry, 'utf8')
      : 0;
    files[key] = sanitizeFileContribution(
      key,
      old,
      Math.max(0, offset - carryBytes),
      false,
    );
  }
  const quotaHistory = sanitizeCodexQuotaHistory(index.quotaHistory);
  return {
    schemaVersion: 3,
    files,
    aggregate: sanitizeProviderAggregate(index.aggregate),
    coverage: sanitizeCoverage(index.coverage),
    ...(quotaHistory.length > 0
      ? { quotaHistory }
      : {}),
  };
}

function migrateIndexV2(index: LegacyCodexIndexV2): CodexIndexV3 {
  return markLineageRescanRequired(sanitizeIndexV2({
    ...index,
    schemaVersion: 3,
  }));
}

function sanitizeFileContribution(
  key: string,
  value: unknown,
  offsetOverride?: number,
  discardingOverride?: boolean,
): CodexFileContribution {
  const contribution = isRecord(value) ? value : {};
  const fileKey = key;
  const failure = isRecord(contribution.compressionFailure) ? contribution.compressionFailure : undefined;
  const failureCode = failure?.version === 1 ? terminalCompressionCode(failure.code) : undefined;
  if (failureCode && validCompressionFingerprint(contribution)) {
    return compressionFailureContribution({
      fileKey,
      sourceArea: contribution.sourceArea === 'sessions' || contribution.sourceArea === 'archive'
        ? contribution.sourceArea : undefined,
      size: contribution.size as number, mtimeMs: contribution.mtimeMs as number,
      storageSize: contribution.storageSize as number, storageCtimeMs: contribution.storageCtimeMs as number,
      dev: optionalNumber(contribution.dev), ino: optionalNumber(contribution.ino),
    }, failureCode);
  }
  const parserState = sanitizeParserState(contribution.parserState, fileKey);
  const safeOffset = offsetOverride ?? Math.max(0, finiteNumber(contribution.offset));
  const limit = sanitizeLimit(contribution.limit);
  const limits = sanitizeLimits(contribution.limits);
  const quotaHistory = sanitizeCodexQuotaHistory(
    contribution.quotaHistory,
    CODEX_FILE_QUOTA_HISTORY_LIMIT,
  );
  const lineage = sanitizeLineage(contribution.lineage);
  const lineageReconciliation = sanitizeLineageReconciliation(
    contribution.lineageReconciliation,
    fileKey,
  );
  if (lineageReconciliation) {
    lineageReconciliation.offset = Math.min(
      lineageReconciliation.offset,
      safeOffset,
    );
    lineageReconciliation.prefixEvents = Math.min(
      lineageReconciliation.prefixEvents,
      lineage?.tokenEvents ?? 0,
    );
    lineageReconciliation.tokenEventsSeen = Math.min(
      lineageReconciliation.tokenEventsSeen,
      lineage?.tokenEvents ?? 0,
    );
  }
  const periodMigration = sanitizePeriodMigration(
    contribution.periodMigration,
    fileKey,
  );
  if (periodMigration) {
    periodMigration.offset = Math.min(periodMigration.offset, safeOffset);
    if (lineage) {
      if (periodMigration.prefixEvents !== undefined) {
        periodMigration.prefixEvents = Math.min(
          periodMigration.prefixEvents,
          lineage.tokenEvents,
        );
      }
      if (periodMigration.tokenEventsSeen !== undefined) {
        periodMigration.tokenEventsSeen = Math.min(
          periodMigration.tokenEventsSeen,
          lineage.tokenEvents,
        );
      }
    }
  }
  const todayMigration = sanitizeTodayMigration(
    contribution.todayMigration,
    fileKey,
  );
  const rawHourProof = sanitizeCodexHourProof(contribution.hourProof);
  const hourProof = rawHourProof && rawHourProof.indexedThrough <= safeOffset
    ? rawHourProof : undefined;
  const rawHourDraft = sanitizeHourProofMigration(contribution.hourProofMigration, fileKey);
  const hourProofMigration = rawHourDraft && rawHourDraft.offset <= safeOffset
    ? rawHourDraft : undefined;
  if (todayMigration) {
    todayMigration.offset = Math.min(todayMigration.offset, safeOffset);
    todayMigration.prefixEvents = Math.min(
      todayMigration.prefixEvents,
      lineage?.tokenEvents ?? 0,
    );
    todayMigration.tokenEventsSeen = Math.min(
      todayMigration.tokenEventsSeen,
      lineage?.tokenEvents ?? 0,
    );
  }
  const aggregate = sanitizeFileAggregate(contribution.aggregate, parserState);
  if (aggregate.today) {
    aggregate.today.indexedThrough = Math.min(
      aggregate.today.indexedThrough,
      safeOffset,
    );
  }
  return {
    fileKey,
    ...(contribution.sourceArea === 'sessions' || contribution.sourceArea === 'archive'
      ? { sourceArea: contribution.sourceArea }
      : {}),
    size: finiteNumber(contribution.size),
    mtimeMs: finiteNumber(contribution.mtimeMs),
    ...(optionalNumber(contribution.dev) !== undefined
      ? { dev: optionalNumber(contribution.dev) }
      : {}),
    ...(optionalNumber(contribution.ino) !== undefined
      ? { ino: optionalNumber(contribution.ino) }
      : {}),
    ...(contribution.compression === 'zstd' ? {
      compression: 'zstd' as const,
      storageSize: finiteNumber(contribution.storageSize),
      storageCtimeMs: finiteNumber(contribution.storageCtimeMs),
      ...(contribution.compressionVerified === true && contribution.compressionFailure === undefined &&
        typeof contribution.storageSize === 'number' &&
        Number.isSafeInteger(contribution.storageSize) && contribution.storageSize > 0 &&
        typeof contribution.storageCtimeMs === 'number' && Number.isFinite(contribution.storageCtimeMs) &&
        contribution.storageCtimeMs > 0 ? { compressionVerified: true as const } : {}),
    } : {}),
    offset: safeOffset,
    discardingOversizedLine: discardingOverride ??
      contribution.discardingOversizedLine === true,
    parserState,
    ...(lineage ? { lineage } : {}),
    ...(lineageReconciliation ? { lineageReconciliation } : {}),
    aggregate,
    ...(limit ? { limit } : {}),
    ...(limits ? { limits } : {}),
    ...(quotaHistory.length > 0 ? { quotaHistory } : {}),
    qualityFlags: uniqueFlags(sanitizeQualityFlags(contribution.qualityFlags),
      contribution.compression !== undefined && contribution.compression !== 'zstd' ? ['stale-reset-required'] : []),
    ...(typeof contribution.identityChecked === 'boolean'
      ? { identityChecked: contribution.identityChecked }
      : {}),
    ...(periodMigration ? { periodMigration } : {}),
    ...(todayMigration ? { todayMigration } : {}),
    ...(hourProof ? { hourProof } : {}),
    ...(hourProofMigration ? { hourProofMigration } : {}),
  };
}

function sanitizeIndexV2(value: unknown): CodexIndexV3 {
  const index = isRecord(value) ? value : {};
  const rawFiles = isRecord(index.files) ? index.files : {};
  const coverage = sanitizeCoverage(index.coverage);
  const files = Object.fromEntries(
    Object.entries(rawFiles).map(([key, contribution]) => [
      key,
      sanitizeFileContribution(key, contribution),
    ]),
  );
  for (const contribution of Object.values(files)) {
    if (
      contribution.aggregate.today &&
      (
        contribution.aggregate.today.day !== coverage.today.day ||
        contribution.aggregate.today.timeZone !== coverage.today.timeZone
      )
    ) {
      delete contribution.aggregate.today;
    }
    if (
      contribution.todayMigration &&
      (
        contribution.todayMigration.day !== coverage.today.day ||
        contribution.todayMigration.timeZone !== coverage.today.timeZone
      )
    ) {
      delete contribution.todayMigration;
    }
  }
  const quotaHistory = sanitizeCodexQuotaHistory(index.quotaHistory);
  return {
    schemaVersion: 3,
    ...(typeof index.indexGeneration === 'number' &&
      Number.isSafeInteger(index.indexGeneration) && index.indexGeneration > 0
      ? { indexGeneration: index.indexGeneration }
      : {}),
    files,
    aggregate: sanitizeProviderAggregate(index.aggregate),
    coverage,
    ...(quotaHistory.length > 0
      ? { quotaHistory }
      : {}),
  };
}

function requiresTokenSemanticsRescan(index: CodexIndexV3): boolean {
  return Object.values(index.files).some((contribution) =>
    !isRecord(contribution) ||
    !isRecord(contribution.parserState) ||
    contribution.parserState.schemaVersion !== 4
  );
}

export type CodexIndexRecoveryReason =
  | 'invalid-json'
  | 'unsupported-schema';

export interface CodexIndexRecovery {
  reason: CodexIndexRecoveryReason;
}

async function quarantineCorruptCodexIndex(indexPath: string): Promise<void> {
  const parsed = path.parse(indexPath);
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.corrupt-${Date.now()}-${process.pid}${parsed.ext}`,
  );
  await rename(indexPath, backupPath);
}

/** Shared normalization lets read-only legacy adoption parse its container once. */
export function normalizeCodexIndex(parsed: unknown): CodexIndexV3 | null {
  if (isIndexV1(parsed)) {
    return markLineageRescanRequired(migrateIndexV1(parsed));
  }
  if (isLegacyIndexV2(parsed)) {
    return migrateIndexV2(parsed);
  }
  if (isIndexV3(parsed)) {
    const needsTokenSemanticsRescan = requiresTokenSemanticsRescan(parsed);
    const sanitized = sanitizeIndexV2(parsed);
    return needsTokenSemanticsRescan
      ? markLineageRescanRequired(sanitized)
      : sanitized;
  }
  return null;
}

export async function loadCodexIndex(
  indexPath: string,
  timeZone = 'UTC',
  onRecovery?: (recovery: CodexIndexRecovery) => void,
): Promise<CodexIndexV3> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createEmptyCodexIndex(timeZone);
    if (error instanceof SyntaxError) {
      await quarantineCorruptCodexIndex(indexPath);
      onRecovery?.({ reason: 'invalid-json' });
      return recoveredIndex(timeZone);
    }
    throw error;
  }
  const normalized = normalizeCodexIndex(parsed);
  if (normalized) return normalized;
  await quarantineCorruptCodexIndex(indexPath);
  onRecovery?.({ reason: 'unsupported-schema' });
  return recoveredIndex(timeZone);
}

export async function saveCodexIndexAtomic(
  indexPath: string,
  index: CodexIndexV3,
): Promise<void> {
  await mkdir(path.dirname(indexPath), { recursive: true });
  const temporaryPath = `${indexPath}.tmp-${process.pid}-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'w', 0o600);
    await handle.writeFile(JSON.stringify(sanitizeIndexV2(index)), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, indexPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
