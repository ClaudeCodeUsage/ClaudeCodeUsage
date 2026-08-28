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
  CodexFilePeriodIndex,
  CodexFileTodayIndex,
  CodexPeriodMigrationState,
  CodexStructuralSummary,
  CodexTodayMigrationState,
  reduceCodexHourlySlice,
  reduceCodexStructuralSlice,
  reduceCodexUsageSlice,
} from './codexPeriodIndex';
import { parseJsonObject, stringField } from './codexSchema';
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
import {
  CODEX_LINEAGE_FINGERPRINT_BYTES,
  CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK,
  CodexLineageTrace,
} from './codexLineage';

export {
  CodexPeriodMigrationState,
  CodexStructuralSummary,
} from './codexPeriodIndex';

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
  today?: CodexFileTodayIndex;
}

export interface CodexFileContribution {
  fileKey: string;
  sourceArea?: CodexSourceArea;
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
  qualityFlags: string[];
  identityChecked?: boolean;
  periodMigration?: CodexPeriodMigrationState;
  todayMigration?: CodexTodayMigrationState;
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
  return !contribution.qualityFlags.includes('stale-reset-required');
}

export interface CodexLineageReconciliationState extends CodexJsonlCursor {
  prefixEvents: number;
  tokenEventsSeen: number;
  parserState: CodexParserState;
  aggregate: CodexFileAggregate;
  qualityFlags: string[];
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

export interface CodexIndexCoverage {
  indexedFiles: number;
  totalFiles: number;
  indexedBytes: number;
  totalBytes: number;
  complete: boolean;
  identity: CodexIdentityCoverage;
  period: CodexPeriodCoverage;
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
  files: Record<string, CodexFileContribution>;
  aggregate: CodexProviderAggregate;
  coverage: CodexIndexCoverage;
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
}

export type CodexFilePassOutcome =
  | {
      taskId: string;
      ok: true;
      contribution: CodexFileContribution;
      bytesRead: number;
    }
  | { taskId: string; ok: false };

export type CodexFilePassBatchRunner = (
  tasks: readonly CodexFilePassTask[],
  onOutcome: (outcome: CodexFilePassOutcome) => Promise<void>,
  shouldCancel?: () => boolean,
) => Promise<void>;

export interface CodexIndexUpdateOptions {
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
  /** Internal resolved civil day shared with local file-pass workers. */
  asOfDay?: string;
}

export interface CodexIndexUpdateResult {
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

function promoteCaughtUpPeriod(
  contribution: CodexFileContribution,
  timeZone: string,
): void {
  const migration = contribution.periodMigration;
  if (
    migration?.timeZone !== timeZone ||
    migration.offset < contribution.offset ||
    migration.discardingOversizedLine
  ) {
    return;
  }
  contribution.aggregate.period = {
    timeZone,
    indexedThrough: contribution.offset,
    days: migration.days,
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
  return { day, timeZone, indexedThrough, hours: {} };
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
    hours: migration.hours,
  };
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
    offset: 0,
    discardingOversizedLine: false,
    parserState,
    lineage: createLineageTrace(),
    aggregate: {
      ...emptyFileAggregate(entry.fileKey, parserState.role),
      period: { timeZone, indexedThrough: 0, days: {} },
    },
    qualityFlags: [...flags],
  };
}

interface CodexFilePassResult {
  contribution: CodexFileContribution;
  bytesRead: number;
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
  let parserState = contribution.parserState;
  const aggregate = contribution.aggregate;
  const lineage = contribution.lineage ?? createLineageTrace();
  const pseudonymize = pseudonymizer(options.salt);
  let limit = contribution.limit;
  const limits = { ...(contribution.limits ?? {}) };
  const timeZone = resolveTimeZone(options.timeZone);
  const asOfDay = options.asOfDay ?? dayKeyInZone(
    new Date((options.now ?? Date.now)()),
    timeZone,
  );
  const advancePeriod =
    aggregate.period?.timeZone === timeZone &&
    aggregate.period.indexedThrough === contribution.offset;
  if (
    aggregate.today &&
    (aggregate.today.day !== asOfDay || aggregate.today.timeZone !== timeZone)
  ) {
    delete aggregate.today;
  }
  if (!aggregate.today && contribution.offset === 0) {
    aggregate.today = emptyTodayIndex(asOfDay, timeZone);
  }
  const advanceToday =
    aggregate.today?.day === asOfDay &&
    aggregate.today.timeZone === timeZone &&
    aggregate.today.indexedThrough === contribution.offset;
  let invalidEventTimestamp = false;

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => {
    syncSession(aggregate, parserState);
    if (advanceToday && aggregate.today) {
      aggregate.today.indexedThrough = cursor.offset;
    }
    return {
      ...contribution,
      fileKey: entry.fileKey,
      sourceArea: entry.sourceArea,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      dev: entry.dev,
      ino: entry.ino,
      offset: cursor.offset,
      discardingOversizedLine: cursor.discardingOversizedLine,
      parserState,
      lineage,
      aggregate,
      limit,
      limits,
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
          reduceUsage(aggregate, event);
          if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
            invalidEventTimestamp = true;
          } else if (advancePeriod && aggregate.period) {
            reduceCodexUsageSlice(aggregate.period.days, event, timeZone);
          }
          if (advanceToday && aggregate.today) {
            reduceCodexHourlySlice(
              aggregate.today.hours,
              event,
              asOfDay,
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
  if (advanceToday && aggregate.today) {
    aggregate.today.indexedThrough = scan.cursor.offset;
  }
  if (
    scan.cursor.offset >= entry.size &&
    !scan.cursor.discardingOversizedLine
  ) {
    packPendingLineageFingerprints(lineage);
  }
  const updated = snapshot(scan.cursor);
  updated.qualityFlags = uniqueFlags(
    updated.qualityFlags,
    scan.oversizedLines > 0 ? ['oversized-jsonl-line'] : [],
  );
  return { contribution: updated, bytesRead: scan.bytesRead };
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
  contribution.qualityFlags = uniqueFlags(
    contribution.qualityFlags,
    reconciliation.qualityFlags,
  );
  delete contribution.lineageReconciliation;
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
  const initial = contribution.lineageReconciliation?.prefixEvents ===
      prefixEvents &&
      contribution.lineageReconciliation.aggregate.today?.day === asOfDay &&
      contribution.lineageReconciliation.aggregate.today.timeZone === timeZone
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
      };
  let parserState = initial.parserState;
  let tokenEventsSeen = initial.tokenEventsSeen;
  const aggregate = initial.aggregate;
  let invalidEventTimestamp = false;
  const pseudonymize = pseudonymizer(options.salt);

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => {
    syncSession(aggregate, parserState);
    if (aggregate.period) {
      aggregate.period.indexedThrough = cursor.offset;
    }
    if (aggregate.today) {
      aggregate.today.indexedThrough = cursor.offset;
    }
    return {
      ...contribution,
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
      if (parsed.lineageTokenKey) {
        tokenEventsSeen += 1;
      }
      const includeUsage = tokenEventsSeen > prefixEvents;
      if (includeUsage) {
        for (const event of parsed.events) {
          reduceUsage(aggregate, event);
          if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
            invalidEventTimestamp = true;
          } else if (aggregate.period) {
            reduceCodexUsageSlice(aggregate.period.days, event, timeZone);
          }
          if (aggregate.today) {
            reduceCodexHourlySlice(
              aggregate.today.hours,
              event,
              asOfDay,
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
  const initial = contribution.periodMigration?.timeZone === timeZone
    ? contribution.periodMigration
    : {
        timeZone,
        offset: 0,
        discardingOversizedLine: false,
        parserState: createCodexParserState(entry.fileKey),
        days: {},
        qualityFlags: [],
      };
  let parserState = initial.parserState;
  const days = initial.days;
  let invalidEventTimestamp = false;
  const pseudonymize = pseudonymizer(options.salt);

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => ({
    ...contribution,
    aggregate: {
      ...contribution.aggregate,
      period: undefined,
    },
    periodMigration: {
      timeZone,
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
      for (const event of parsed.events) {
        if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
          invalidEventTimestamp = true;
        } else {
          reduceCodexUsageSlice(days, event, timeZone);
        }
      }
      if (parsed.structural) {
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
  if (
    updated.periodMigration &&
    updated.periodMigration.offset >= contribution.offset &&
    !updated.periodMigration.discardingOversizedLine
  ) {
    updated.aggregate.period = {
      timeZone,
      indexedThrough: contribution.offset,
      days: updated.periodMigration.days,
    };
    updated.qualityFlags = uniqueFlags(
      updated.qualityFlags,
      updated.periodMigration.qualityFlags,
    );
    delete updated.periodMigration;
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
  const prefixEvents = contribution.lineage?.desiredPrefixEvents ?? 0;
  const initial =
    contribution.todayMigration?.day === day &&
      contribution.todayMigration.timeZone === timeZone &&
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
          qualityFlags: [],
        };
  let parserState = initial.parserState;
  let tokenEventsSeen = initial.tokenEventsSeen;
  const hours = initial.hours;
  let invalidEventTimestamp = false;
  const pseudonymize = pseudonymizer(options.salt);

  const snapshot = (cursor: CodexJsonlCursor): CodexFileContribution => ({
    ...contribution,
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
      hours,
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
        reduceCodexHourlySlice(hours, event, day, timeZone);
      }
    },
    async (progress) => {
      await onChunk(snapshot(progress.cursor), progress.bytesRead);
    },
  );
  if (!scan.reachedEnd) {
    throw new Error('Codex log changed during current-day migration');
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
    if (!contribution?.lineage) {
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
    if (!contribution.lineage) {
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

  const depthMemo = new Map<CodexFileContribution, number>();
  const depthFor = (
    contribution: CodexFileContribution,
    visiting = new Set<CodexFileContribution>(),
  ): number => {
    const cached = depthMemo.get(contribution);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(contribution)) {
      return 0;
    }
    const parentKey = contribution.aggregate.session.parentSessionKey;
    if (!parentKey) {
      depthMemo.set(contribution, 0);
      return 0;
    }
    const nextVisiting = new Set(visiting).add(contribution);
    const parents = (parentCandidates.get(parentKey) ?? []).filter((parent) =>
      !contribution.parserState.treeKey ||
      !parent.parserState.treeKey ||
      contribution.parserState.treeKey === parent.parserState.treeKey,
    );
    const depth = parents.length > 0
      ? 1 + Math.min(...parents.map((parent) => depthFor(parent, nextVisiting)))
      : 1;
    depthMemo.set(contribution, depth);
    return depth;
  };

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

function coverageFor(
  files: Record<string, CodexFileContribution>,
  manifest: CodexManifest,
  timeZone: string,
  asOfDay: string,
  deduplication = classifyCodexSessionDuplicates(files),
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
      const periodIsCurrent = Boolean(
        contribution && isCodexUsageContributionCurrent(contribution),
      );
      const promoted = periodIsCurrent &&
        contribution?.aggregate.period?.timeZone === timeZone
        ? Math.min(
            contribution.aggregate.period.indexedThrough,
            contribution.offset,
            entry.size,
          )
        : 0;
      const draft = periodIsCurrent &&
        contribution?.periodMigration?.timeZone === timeZone
        ? Math.min(contribution.periodMigration.offset, contribution.offset, entry.size)
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
  const last30Start = rollingDayKeysFromDayKey(asOfDay, 30)[0];
  const last7Days = rangeCoverage(last7Start);
  const last30Days = rangeCoverage(last30Start);
  const allTime = rangeCoverage();
  let todayIndexedFiles = 0;
  let todayTotalFiles = 0;
  let todayIndexedBytes = 0;
  let todayTotalBytes = 0;
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
      !contribution.aggregate.period?.days[asOfDay]
    ) {
      continue;
    }
    todayTotalFiles += 1;
    todayTotalBytes += entry.size;
    const promoted =
      contribution.aggregate.today?.day === asOfDay &&
      contribution.aggregate.today.timeZone === timeZone
        ? Math.min(
            contribution.aggregate.today.indexedThrough,
            contribution.offset,
            entry.size,
          )
        : 0;
    const draft =
      contribution.todayMigration?.day === asOfDay &&
      contribution.todayMigration.timeZone === timeZone &&
      contribution.todayMigration.prefixEvents ===
        (contribution.lineage?.desiredPrefixEvents ?? 0)
        ? Math.min(
            contribution.todayMigration.offset,
            contribution.offset,
            entry.size,
          )
        : 0;
    todayIndexedBytes += Math.max(0, Math.max(promoted, draft));
    if (
      contribution.aggregate.today?.day === asOfDay &&
      contribution.aggregate.today.timeZone === timeZone &&
      contribution.aggregate.today.indexedThrough >= contribution.offset
    ) {
      todayIndexedFiles += 1;
    }
  }
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
    today: {
      timeZone,
      day: asOfDay,
      indexedFiles: todayIndexedFiles,
      totalFiles: todayTotalFiles,
      indexedBytes: todayIndexedBytes,
      totalBytes: todayTotalBytes,
      complete: last7Days.complete && todayIndexedFiles === todayTotalFiles,
    },
  };
}

function recomputeDerivedIndex(
  index: CodexIndexV3,
  manifest: CodexManifest,
  timeZone: string,
  asOfDay: string,
  reconcileLineage = true,
): void {
  const initialDeduplication = classifyCodexSessionDuplicates(index.files);
  if (reconcileLineage) {
    reconcileLineageContributions(
      index.files,
      initialDeduplication.canonicalFileKeys,
    );
  }
  const deduplication = classifyCodexSessionDuplicates(index.files);
  index.aggregate = recomputeAggregate(index.files, deduplication);
  index.coverage = coverageFor(
    index.files,
    manifest,
    timeZone,
    asOfDay,
    deduplication,
  );
}

function progressFor(index: CodexIndexV3, scannedFiles: number): CodexIndexProgress {
  return {
    scannedFiles,
    totalFiles: index.coverage.totalFiles,
    indexedBytes: index.coverage.indexedBytes,
    totalBytes: index.coverage.totalBytes,
    period: index.coverage.period,
  };
}

function isWarmNoOp(
  previous: CodexIndexV3,
  manifest: CodexManifest,
  diff: ReturnType<typeof diffCodexManifest>,
  timeZone: string,
  asOfDay: string,
): boolean {
  const totalBytes = manifest.files.reduce((sum, entry) => sum + entry.size, 0);
  if (
    diff.appended.length > 0 ||
    diff.truncated.length > 0 ||
    diff.replaced.length > 0 ||
    diff.moved.length > 0 ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    !previous.coverage.complete ||
    previous.coverage.totalFiles !== manifest.files.length ||
    previous.coverage.indexedFiles !== manifest.files.length ||
    previous.coverage.totalBytes !== totalBytes ||
    previous.coverage.indexedBytes !== totalBytes ||
    !previous.coverage.period.allTime.complete ||
    previous.coverage.period.timeZone !== timeZone ||
    previous.coverage.period.asOfDay !== asOfDay ||
    !previous.coverage.today?.complete ||
    previous.coverage.today.timeZone !== timeZone ||
    previous.coverage.today.day !== asOfDay
  ) {
    return false;
  }
  const canonical = classifyCodexSessionDuplicates(previous.files)
    .canonicalFileKeys;
  return manifest.files.every((entry) => {
    const contribution = previous.files[entry.fileKey];
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
      !contribution.qualityFlags.includes('stale-file') &&
      !contribution.qualityFlags.includes('stale-reset-required'),
    );
    if (!baseIsCurrent || !contribution) {
      return false;
    }
    if (
      !canonical.has(entry.fileKey) ||
      !contribution.aggregate.period?.days[asOfDay]
    ) {
      return true;
    }
    return Boolean(
      contribution.aggregate.today?.day === asOfDay &&
      contribution.aggregate.today.timeZone === timeZone &&
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
  const asOfDay = dayKeyInZone(new Date(refreshInstant), timeZone);
  const normalizedOptions: CodexIndexUpdateOptions = {
    ...options,
    timeZone,
    asOfDay,
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
  if (isWarmNoOp(previous, manifest, diff, timeZone, asOfDay)) {
    return {
      index: previous,
      indexChanged: false,
      bodyReads: 0,
      failedFiles: 0,
      migration: {
        filePasses: 0,
        bytesRead: 0,
        pending: false,
      },
    };
  }
  const index = cloneIndex(previous);
  const entries = new Map(manifest.files.map((entry) => [entry.fileKey, entry]));
  let bodyReads = 0;
  let failedFiles = 0;
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
    index.files[move.toKey] = contribution;
  }
  for (const key of diff.removed) {
    delete index.files[key];
  }
  for (const contribution of Object.values(index.files)) {
    promoteCaughtUpLineage(contribution);
    if (contribution.aggregate.period?.timeZone !== timeZone) {
      delete contribution.aggregate.period;
    }
    if (contribution.periodMigration?.timeZone !== timeZone) {
      delete contribution.periodMigration;
    }
    promoteCaughtUpPeriod(contribution, timeZone);
    if (
      contribution.aggregate.today &&
      (
        contribution.aggregate.today.day !== asOfDay ||
        contribution.aggregate.today.timeZone !== timeZone
      )
    ) {
      delete contribution.aggregate.today;
    }
    if (
      contribution.todayMigration &&
      (
        contribution.todayMigration.day !== asOfDay ||
        contribution.todayMigration.timeZone !== timeZone ||
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
  const changedKeys = new Set([
    ...diff.added,
    ...diff.appended,
    ...diff.truncated,
    ...diff.replaced,
  ]);
  for (const entry of manifest.files) {
    const contribution = index.files[entry.fileKey];
    if (
      contribution &&
      (contribution.offset < entry.size ||
        contribution.discardingOversizedLine ||
        contribution.qualityFlags.includes('stale-file') ||
        contribution.qualityFlags.includes('stale-reset-required'))
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
    recomputeDerivedIndex(index, manifest, timeZone, asOfDay, false);
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
          if (outcome.ok) {
            bytesRead += outcome.bytesRead;
            index.files[task.entry.fileKey] = outcome.contribution;
          } else {
            failedFiles += 1;
            onFailure(task);
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
      const base = resetFlag || !prior ||
          prior.qualityFlags.includes('stale-reset-required')
        ? contributionFor(entry, timeZone, resetFlag ? [resetFlag] : [])
        : {
            ...cloneContribution(prior),
            qualityFlags: prior.qualityFlags.filter(
              (flag) => flag !== 'stale-file' && flag !== 'stale-reset-required',
            ),
          };
      const remainingBytes = budget.maxBytes - bytesRead - reservedBytes;
      const endExclusive = Math.min(entry.size, base.offset + remainingBytes);
      if (endExclusive <= base.offset) {
        break;
      }
      const taskId = `main:${entry.fileKey}`;
      tasks.push({
        taskId,
        kind: 'main',
        contribution: base,
        entry,
        salt: normalizedOptions.salt,
        timeZone,
        asOfDay,
        endExclusive,
      });
      priorByTask.set(taskId, prior);
      resetFlagByTask.set(taskId, resetFlag);
      reservedBytes += endExclusive - base.offset;
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
    const base = resetFlag || !prior ||
        prior.qualityFlags.includes('stale-reset-required')
      ? contributionFor(entry, timeZone, resetFlag ? [resetFlag] : [])
      : {
          ...cloneContribution(prior),
          qualityFlags: prior.qualityFlags.filter(
            (flag) => flag !== 'stale-file' && flag !== 'stale-reset-required',
          ),
        };
    const remainingBytes = budget.maxBytes - bytesRead;
    const endExclusive = Math.min(entry.size, base.offset + remainingBytes);
    if (endExclusive <= base.offset) {
      break;
    }
    bodyReads += 1;
    filePasses += 1;
    const passStartingBytes = bytesRead;
    try {
      const pass = await updateContribution(
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
      if (prior) {
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
  const lineageWork = manifest.files
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
      index.files[entry.fileKey] = prior;
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
  const periodWork = manifest.files
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
      const start = base.periodMigration?.timeZone === timeZone
        ? base.periodMigration.offset
        : 0;
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
    const start = base.periodMigration?.timeZone === timeZone
      ? base.periodMigration.offset
      : 0;
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
      index.files[entry.fileKey] = prior;
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
  const todayWork = manifest.files
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
        contribution.aggregate.period?.days[asOfDay] &&
        (
          contribution.aggregate.today?.day !== asOfDay ||
          contribution.aggregate.today.timeZone !== timeZone ||
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
      index.files[entry.fileKey] = prior;
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
  const identityWork = manifest.files.sort(recentFirst);
  const pendingIdentity = identityWork.filter(
    (entry) => index.files[entry.fileKey]?.identityChecked !== true,
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
  } else for (const entry of identityWork) {
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
    }
    dirtySinceCheckpoint = true;
    filePassesSinceCheckpoint += 1;
    if (!(await checkpoint(false))) {
      publishProgress(false);
    }
  }

  await finishStage(filePasses > identityPassStart);
  if (filePasses === 0) {
    options.onProgress?.(progressFor(index, manifest.files.length));
  } else {
    publishProgress(true);
  }
  return {
    index,
    indexChanged: true,
    bodyReads,
    failedFiles,
    migration: {
      filePasses,
      bytesRead,
      pending:
        !index.coverage.complete ||
        !index.coverage.period.allTime.complete ||
        !index.coverage.today.complete,
    },
  };
}

interface LegacyCodexIndexV1 {
  readonly schemaVersion: 1;
  readonly files: Readonly<Record<string, LegacyCodexFileContribution>>;
  readonly aggregate?: unknown;
  readonly coverage?: unknown;
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
    schemaVersion: 3,
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

function sanitizeToday(value: unknown): CodexFileTodayIndex | undefined {
  if (
    !isRecord(value) ||
    typeof value.timeZone !== 'string' ||
    typeof value.day !== 'string' ||
    rollingDayKeysFromDayKey(value.day, 1)[0] !== value.day
  ) {
    return undefined;
  }
  return {
    day: value.day,
    timeZone: resolveTimeZone(value.timeZone),
    indexedThrough: Math.max(0, finiteNumber(value.indexedThrough)),
    hours: sanitizeHourlySlices(value.hours),
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
    offset: Math.max(0, finiteNumber(value.offset)),
    discardingOversizedLine: value.discardingOversizedLine === true,
    parserState: sanitizeParserState(value.parserState, fileKey),
    days: period.days,
    qualityFlags: sanitizeQualityFlags(value.qualityFlags),
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
  return {
    schemaVersion: 3,
    files,
    aggregate: sanitizeProviderAggregate(index.aggregate),
    coverage: sanitizeCoverage(index.coverage),
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
  const parserState = sanitizeParserState(contribution.parserState, fileKey);
  const safeOffset = offsetOverride ?? Math.max(0, finiteNumber(contribution.offset));
  const limit = sanitizeLimit(contribution.limit);
  const limits = sanitizeLimits(contribution.limits);
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
  }
  const todayMigration = sanitizeTodayMigration(
    contribution.todayMigration,
    fileKey,
  );
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
    offset: safeOffset,
    discardingOversizedLine: discardingOverride ??
      contribution.discardingOversizedLine === true,
    parserState,
    ...(lineage ? { lineage } : {}),
    ...(lineageReconciliation ? { lineageReconciliation } : {}),
    aggregate,
    ...(limit ? { limit } : {}),
    ...(limits ? { limits } : {}),
    qualityFlags: sanitizeQualityFlags(contribution.qualityFlags),
    ...(typeof contribution.identityChecked === 'boolean'
      ? { identityChecked: contribution.identityChecked }
      : {}),
    ...(periodMigration ? { periodMigration } : {}),
    ...(todayMigration ? { todayMigration } : {}),
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
  return {
    schemaVersion: 3,
    files,
    aggregate: sanitizeProviderAggregate(index.aggregate),
    coverage,
  };
}

function requiresTokenSemanticsRescan(index: CodexIndexV3): boolean {
  return Object.values(index.files).some((contribution) =>
    !isRecord(contribution) ||
    !isRecord(contribution.parserState) ||
    contribution.parserState.schemaVersion !== 3
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

export async function loadCodexIndex(
  indexPath: string,
  timeZone = 'UTC',
  onRecovery?: (recovery: CodexIndexRecovery) => void,
): Promise<CodexIndexV3> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return createEmptyCodexIndex(timeZone);
    }
    if (error instanceof SyntaxError) {
      await quarantineCorruptCodexIndex(indexPath);
      onRecovery?.({ reason: 'invalid-json' });
      return createEmptyCodexIndex(timeZone);
    }
    throw error;
  }
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
  await quarantineCorruptCodexIndex(indexPath);
  onRecovery?.({ reason: 'unsupported-schema' });
  return createEmptyCodexIndex(timeZone);
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
