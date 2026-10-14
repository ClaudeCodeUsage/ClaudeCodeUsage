import { lstat } from 'node:fs/promises';
import * as path from 'node:path';
import { immutableCodexAchievementFiles } from '../../codexAchievementRevision';

import {
  ProviderLimitSnapshot,
  ProviderSourceOutcome,
  ProviderTokenCounts,
} from '../providerTypes';
import {
  CodexFileContribution,
  CodexFileAggregate,
  CodexIndexCoverage,
  CodexIndexProgress,
  CodexIndexRecovery,
  CodexHourlyCoverage,
  CodexTodayCoverage,
  CodexIndexV1,
  createEmptyCodexIndex,
  codexHourProofSnapshot,
  isReadableCodexPeriod,
  isCodexUsageContributionCurrent,
  loadCodexIndex,
} from './codexIndex';
import type { CanonicalCodexOutputHours } from './codexHourProof';
import {
  CODEX_ROLLING_HOURLY_DAYS,
  codexPeriodFitsAggregate,
  isCompatibleCodexPeriodLineage,
  isCurrentCodexPeriodLineage,
} from './codexPeriodIndex';
import {
  appendCodexQuotaHistory,
  CODEX_QUOTA_HISTORY_LIMIT,
  CODEX_QUOTA_RESET_CLUSTER_MS,
  CodexQuotaObservation,
  weeklyQuotaObservationsFromCodexHistory,
  weeklyQuotaObservationsFromCodexLimit,
} from './codexQuotaHistory';
import { CodexIndexClient, CodexWorkerError } from './codexIndexClient';
import {
  CodexWorkerRefreshInput,
  CodexWorkerResult,
  CodexIndexErrorCode,
  safeCodexIndexErrorCode,
} from './codexWorkerProtocol';
import { CodexSessionTitleCache } from './codexIdentity';
import { CodexAchievementUsageDelta, CodexAchievementUsageWindow,
  copyCodexUsageWindow, copyCodexUsageDelta } from './codexAchievementOrigin';
import { classifyCodexSessionDuplicates } from './codexDedup';
import {
  equivalentUsageFromProviderTokens,
  WeeklyQuotaObservation,
  WeeklyValueInputs,
} from '../../weeklyValue';

export interface CodexProviderOptions extends CodexWorkerRefreshInput {
  enabled: boolean;
}

export interface CodexIndexClientLike {
  refresh(
    input: CodexWorkerRefreshInput,
    onProgress?: (progress: CodexIndexProgress) => void,
  ): Promise<CodexWorkerResult>;
  cancel?(): void;
  whenIdle?(): Promise<void>;
  dispose(): void | Promise<void>;
}

export interface CodexProviderSnapshot {
  provider: 'codex';
  /** Persisted index generation used to isolate migration completion state. */
  indexGeneration?: number;
  /** Runtime-only: this worker run has checked the current source manifest. */
  currentManifestVerified?: boolean;
  total: ProviderTokenCounts;
  files: CodexFileAggregate[];
  /** Complete, canonical UTC positive-output hour proof; empty while pending. */
  outputHourProof?: CanonicalCodexOutputHours;
  coverage: CodexIndexCoverage;
  qualityFlags: Record<string, number>;
  limits: ProviderLimitSnapshot[];
  limit: ProviderLimitSnapshot | null;
  /** Aggregate-only inputs for reset-aligned API-equivalent value estimates. */
  weeklyValueInputs?: WeeklyValueInputs;
  /** Exact sparse configured-zone hour coverage for the rolling 30-day view. */
  hourlyCoverage?: CodexHourlyCoverage;
  /** Independent exact-hour backfill state for the current civil day. */
  todayCoverage: CodexTodayCoverage;
  todayPartial: boolean;
}

export interface CodexProviderResult {
  outcome: ProviderSourceOutcome;
  /** Fixed diagnostic category only; never a raw worker error or its message. */
  failureCode?: CodexProviderFailureCode;
  snapshot: CodexProviderSnapshot;
  progress?: CodexIndexProgress;
  /** Runtime-only proof for this caller's accepted observation window. */
  achievementUsageDelta?: CodexAchievementUsageDelta;
  diagnostic?: {
    bodyReads: number;
    failedFiles: number;
    metadataMs: number;
    parseMs: number;
    migrationPending: boolean;
    indexRecovery?: CodexIndexRecovery;
    errorCode?: CodexIndexErrorCode;
  };
}

export type CodexProviderFailureCode =
  | 'cancelled'
  | 'busy'
  | 'worker-failed'
  | 'disposed'
  | 'refresh-failed';

function safeWorkerFailureCode(error: unknown): CodexProviderFailureCode {
  if (error instanceof CodexWorkerError) {
    switch (error.code) {
      case 'cancelled':
      case 'busy':
      case 'worker-failed':
      case 'disposed':
      case 'refresh-failed':
        return error.code;
    }
  }
  return 'refresh-failed';
}

function displayOnlySnapshot(snapshot: CodexProviderSnapshot): CodexProviderSnapshot {
  return {
    ...snapshot,
    currentManifestVerified: false,
    files: snapshot.files.map((file) => {
      const { achievementPeriodWitness: _witness, ...display } = file;
      return display;
    }),
    ...(snapshot.outputHourProof ? {
      outputHourProof: { ...snapshot.outputHourProof, complete: false, hours: [] },
    } : {}),
  };
}

export type CodexIndexClientFactory = () => CodexIndexClientLike;

function emptySnapshot(timeZone: string): CodexProviderSnapshot {
  return snapshotFromIndex(createEmptyCodexIndex(timeZone));
}

function latestLimits(
  files: CodexIndexV1['files'][string][],
): ProviderLimitSnapshot[] {
  const latest = new Map<string, ProviderLimitSnapshot>();
  for (const file of files) {
    const snapshots = [
      ...Object.values(file.limits ?? {}),
      ...(file.limit ? [file.limit] : []),
    ];
    for (const snapshot of snapshots) {
      const key = snapshot.limitId ?? snapshot.limitName ?? 'default';
      const current = latest.get(key);
      if (!current || snapshot.observedAt >= current.observedAt) {
        latest.set(key, snapshot);
      }
    }
  }
  return [...latest.values()].sort(
    (left, right) =>
      right.observedAt - left.observedAt ||
      (left.limitName ?? left.limitId ?? '').localeCompare(
        right.limitName ?? right.limitId ?? '',
      ),
  );
}

function qualityCounts(
  files: CodexIndexV1['files'][string][],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    for (const flag of new Set(file.qualityFlags)) {
      counts[flag] = (counts[flag] ?? 0) + 1;
    }
  }
  return counts;
}

function aggregateTotal(
  files: CodexIndexV1['files'][string][],
): ProviderTokenCounts {
  const total: ProviderTokenCounts = {
    inputTotal: 0,
    cachedInput: 0,
    cacheWriteInput: 0,
    outputTotal: 0,
    reasoningOutput: 0,
    sourceTotal: 0,
  };
  for (const file of files) {
    total.inputTotal += Math.max(0, file.aggregate.total.inputTotal);
    total.cachedInput = (total.cachedInput ?? 0) +
      Math.max(0, file.aggregate.total.cachedInput ?? 0);
    total.cacheWriteInput = (total.cacheWriteInput ?? 0) +
      Math.max(0, file.aggregate.total.cacheWriteInput ?? 0);
    total.outputTotal += Math.max(0, file.aggregate.total.outputTotal);
    total.reasoningOutput = (total.reasoningOutput ?? 0) +
      Math.max(0, file.aggregate.total.reasoningOutput ?? 0);
    total.sourceTotal = (total.sourceTotal ?? 0) +
      Math.max(0, file.aggregate.total.sourceTotal ?? 0);
  }
  return total;
}

function codexWeeklyValueInputs(
  files: CodexFileContribution[],
  persistedHistory: readonly CodexQuotaObservation[] = [],
  timeZone = 'UTC',
): WeeklyValueInputs {
  const currentObservations: WeeklyQuotaObservation[] = [];
  const usage: WeeklyValueInputs['usage'] = [];
  const seenObservations = new Set<string>();
  const fileHistory: CodexQuotaObservation[] = [];
  for (const file of files) {
    const sourceKey = file.fileKey;
    fileHistory.push(...(file.quotaHistory ?? []));
    for (const snapshot of [
      ...Object.values(file.limits ?? {}),
      ...(file.limit ? [file.limit] : []),
    ]) {
      for (const observation of weeklyQuotaObservationsFromCodexLimit(
        snapshot,
        sourceKey,
      )) {
        const identity = [
          observation.observedAt,
          observation.resetAt,
          observation.usedPercent,
          observation.sourceKey ?? '',
        ].join('|');
        if (!seenObservations.has(identity)) {
          seenObservations.add(identity);
          currentObservations.push(observation);
        }
      }
    }
  }

  const cachedHistory = appendCodexQuotaHistory(
    persistedHistory,
    fileHistory,
    CODEX_QUOTA_HISTORY_LIMIT,
  );
  const cachedObservations = weeklyQuotaObservationsFromCodexHistory(
    cachedHistory,
  ).filter((cached) => !currentObservations.some((current) =>
    Math.abs(current.resetAt - cached.resetAt) <= CODEX_QUOTA_RESET_CLUSTER_MS &&
    // A delayed line written at/after reset is ineligible for the closed
    // window. It cannot shadow a useful pre-reset observation retained by the
    // durable history.
    current.observedAt < current.resetAt,
  ));
  const observations = [...currentObservations, ...cachedObservations];

  for (const file of files) {
    const sourceKey = file.fileKey;
    const usageReady = isCodexUsageContributionCurrent(file) &&
      !file.lineageReconciliation &&
      (
        !file.lineage ||
        file.lineage.appliedPrefixEvents === file.lineage.desiredPrefixEvents
      );
    if (!usageReady) {
      continue;
    }
    const period = file.aggregate.period;
    const prefixEvents = file.lineage?.desiredPrefixEvents ?? 0;
    if (
      !period ||
      period.timeZone !== timeZone ||
      !isCompatibleCodexPeriodLineage(period, prefixEvents) ||
      !codexPeriodFitsAggregate(period, file.aggregate.total)
    ) {
      // A pre-fix or still-rebuilding period projection may contain copied
      // lineage records. Do not turn the reliable all-time total into a false
      // model-priced weekly estimate; the next bounded refresh will rebuild it.
      continue;
    }
    for (const slice of Object.values(period.days)) {
      const timestamp = slice.lastObservedAt ?? slice.firstObservedAt;
      if (timestamp === undefined) {
        continue;
      }
      const intervalStart = slice.firstObservedAt ?? timestamp;
      const intervalEnd = slice.lastObservedAt ?? timestamp;
      for (const [model, tokens] of Object.entries(slice.byModel)) {
        usage.push(equivalentUsageFromProviderTokens(
          timestamp,
          model,
          tokens,
          sourceKey,
          intervalStart,
          intervalEnd,
        ));
      }
    }
  }
  return { observations, usage };
}

function snapshotFromIndex(
  index: CodexIndexV1,
  sessionTitles: Map<string, string> = new Map(),
  currentManifestVerified = false,
): CodexProviderSnapshot {
  const canonicalFileKeys = classifyCodexSessionDuplicates(
    index.files,
  ).canonicalFileKeys;
  const contributions = [...canonicalFileKeys]
    .map((fileKey) => index.files[fileKey])
    .filter((file): file is CodexIndexV1['files'][string] => file !== undefined);
  const usageContributions = contributions.filter((contribution) =>
    isCodexUsageContributionCurrent(contribution) &&
    !contribution.lineageReconciliation &&
    (
      !contribution.lineage ||
      contribution.lineage.appliedPrefixEvents ===
        contribution.lineage.desiredPrefixEvents
    ),
  );
  const files = usageContributions
    .map((file) => {
      const periodReadable = isReadableCodexPeriod(
        file,
        index.coverage.period.timeZone,
      );
      // Source size/cursor/prefix are independent of the period's own claims.
      // This proves one file only; completeness of the canonical identity
      // census and any withheld usage contributions belongs to the consumer.
      const timeZone = index.coverage.period.timeZone;
      const expectedPrefixEvents = file.lineage ? file.lineage.desiredPrefixEvents : 0;
      const period = file.aggregate.period;
      const witnessed = currentManifestVerified === true && index.coverage.complete &&
        isCodexUsageContributionCurrent(file) && !file.lineageReconciliation &&
        (!file.lineage || file.lineage.appliedPrefixEvents === expectedPrefixEvents) &&
        Number.isSafeInteger(expectedPrefixEvents) && expectedPrefixEvents >= 0 &&
        !file.discardingOversizedLine &&
        Number.isSafeInteger(file.size) && file.size >= 0 &&
        Number.isSafeInteger(file.offset) && file.offset === file.size &&
        file.periodMigration === undefined && periodReadable &&
        isCurrentCodexPeriodLineage(period, expectedPrefixEvents) &&
        period?.timeZone === timeZone && period.indexedThrough === file.offset;
      // Never accept a witness carried by an incoming aggregate or write the
      // projection back to the worker's persistent contribution.
      const { achievementPeriodWitness: _witness, ...aggregate } = file.aggregate;
      return {
        ...aggregate,
        ...(witnessed ? {
          achievementPeriodWitness: { size: file.size, offset: file.offset, expectedPrefixEvents, timeZone },
        } : {}),
        // Keep the trusted all-time aggregate visible, but do not let a
        // rejected or rebuilding period projection reach any period consumer.
        ...(periodReadable ? {} : { period: undefined }),
        session: {
          ...file.aggregate.session,
          sessionTitle: sessionTitles.get(file.aggregate.session.sessionKey),
        },
      };
    })
    .sort(
      (left, right) =>
        (right.session.startedAt ?? 0) - (left.session.startedAt ?? 0),
    );
  const limits = latestLimits(contributions);
  const hourlyCoverage = index.coverage.hourly ?? {
    timeZone: index.coverage.period.timeZone,
    asOfDay: index.coverage.period.asOfDay,
    windowDays: CODEX_ROLLING_HOURLY_DAYS,
    indexedFiles: 0,
    totalFiles: 0,
    indexedBytes: 0,
    totalBytes: 0,
    complete: false,
    days: {},
  };
  return {
    provider: 'codex',
    indexGeneration: index.indexGeneration,
    currentManifestVerified,
    total: aggregateTotal(usageContributions),
    files,
    outputHourProof: currentManifestVerified
      ? codexHourProofSnapshot(index)
      : { ...codexHourProofSnapshot(index), complete: false, hours: [] },
    coverage: index.coverage,
    qualityFlags: qualityCounts(contributions),
    limits,
    limit: limits[0] ?? null,
    weeklyValueInputs: codexWeeklyValueInputs(
      usageContributions,
      index.quotaHistory ?? [],
      index.coverage.period.timeZone,
    ),
    hourlyCoverage,
    todayCoverage: index.coverage.today,
    todayPartial: !index.coverage.today.complete,
  };
}

async function directoryExistsWithoutSymlink(directory: string): Promise<boolean> {
  try {
    const info = await lstat(directory);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

export class CodexProvider {
  private client: CodexIndexClientLike | null = null;
  private currentSnapshot: CodexProviderSnapshot | null = null;
  private lastProgress: CodexIndexProgress | undefined;
  private snapshotGeneration = 0;
  private persistedSnapshotLoad: Promise<CodexProviderSnapshot | null> | null = null;
  private readonly sessionTitleCache = new CodexSessionTitleCache();
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly options: CodexProviderOptions,
    private readonly clientFactory: CodexIndexClientFactory = () =>
      new CodexIndexClient(),
  ) {}

  async isAvailable(): Promise<boolean> {
    if (this.disposed || !this.options.enabled) {
      return false;
    }
    const [sessions, archive] = await Promise.all([
      directoryExistsWithoutSymlink(path.join(this.options.codexHome, 'sessions')),
      directoryExistsWithoutSymlink(
        path.join(this.options.codexHome, 'archived_sessions'),
      ),
    ]);
    return sessions || archive;
  }

  get indexPath(): string { return this.options.indexPath; }

  /**
   * Hydrate the last atomically checkpointed subtotal without starting the
   * worker. This keeps the dashboard useful while a long cold backfill or
   * lineage reconciliation continues in the background.
   */
  async loadPersistedSnapshot(): Promise<CodexProviderSnapshot | null> {
    if (this.disposed) return null;
    if (this.currentSnapshot) {
      return displayOnlySnapshot(this.currentSnapshot);
    }
    if (this.persistedSnapshotLoad) {
      const snapshot = await this.persistedSnapshotLoad;
      return snapshot ? displayOnlySnapshot(snapshot) : null;
    }
    const generation = this.snapshotGeneration;
    const pending = (async (): Promise<CodexProviderSnapshot | null> => {
      if (!(await this.isAvailable())) {
        return null;
      }
      try {
        const [index, sessionTitles] = await Promise.all([
          loadCodexIndex(this.options.indexPath, this.options.timeZone),
          this.sessionTitleCache.load(this.options.codexHome, this.options.salt),
        ]);
        if (this.disposed) {
          this.sessionTitleCache.clear();
          return null;
        }
        if (
          index.coverage.totalFiles === 0 &&
          Object.keys(index.files).length === 0
        ) {
          return null;
        }
        const snapshot = snapshotFromIndex(index, sessionTitles);
        if (generation !== this.snapshotGeneration) {
          return this.currentSnapshot ? displayOnlySnapshot(this.currentSnapshot) : null;
        }
        this.currentSnapshot = snapshot;
        return snapshot;
      } catch {
        return this.currentSnapshot ? displayOnlySnapshot(this.currentSnapshot) : null;
      }
    })();
    this.persistedSnapshotLoad = pending;
    try {
      return await pending;
    } finally {
      if (this.persistedSnapshotLoad === pending) {
        this.persistedSnapshotLoad = null;
      }
    }
  }

  async refresh(
    profile: 'background' | 'foreground' = 'background',
    onProgress?: (progress: CodexIndexProgress) => void,
    allowHistoricalBackfill: boolean = true,
    achievementUsageWindow?: CodexAchievementUsageWindow,
  ): Promise<CodexProviderResult> {
    const usageWindow = copyCodexUsageWindow(achievementUsageWindow);
    if (this.disposed) {
      return {
        outcome: 'unavailable',
        snapshot: this.invalidateCurrentManifestProof(),
      };
    }
    if (!(await this.isAvailable())) {
      return {
        outcome: 'unavailable',
        snapshot: this.invalidateCurrentManifestProof(),
      };
    }
    this.client ??= this.clientFactory();
    const client = this.client;
    this.lastProgress = undefined;
    try {
      const result = await client.refresh(
        {
          codexHome: this.options.codexHome,
          indexPath: this.options.indexPath,
          legacyIndexPath: this.options.legacyIndexPath,
          salt: this.options.salt,
          timeZone: this.options.timeZone,
          profile,
          allowHistoricalBackfill,
          allowAchievementHourProof: this.options.allowAchievementHourProof !== false,
          achievementUsageWindow: usageWindow,
        },
        (progress) => {
          this.lastProgress = progress;
          onProgress?.(progress);
        },
      );
      if (this.disposed || this.client !== client) {
        return { outcome: 'unavailable', snapshot: this.invalidateCurrentManifestProof() };
      }
      const sessionTitles = await this.sessionTitleCache.load(
        this.options.codexHome,
        this.options.salt,
      );
      if (this.disposed || this.client !== client) {
        this.sessionTitleCache.clear();
        return { outcome: 'unavailable', snapshot: this.invalidateCurrentManifestProof() };
      }
      this.snapshotGeneration += 1;
      const snapshot = snapshotFromIndex(result.index, sessionTitles, true);
      if (result.failedFiles === 0 && this.options.allowAchievementHourProof !== false) {
        // Rebuild current census and witnesses above even on zero-body reads.
        // Only full equality against a detached frozen publication allows reuse;
        // indexChanged is persistence metadata, not an achievement revision.
        snapshot.files = immutableCodexAchievementFiles(snapshot.files,
          this.currentSnapshot?.currentManifestVerified ? this.currentSnapshot.files : undefined);
      }
      this.currentSnapshot = snapshot;
      const outcome: ProviderSourceOutcome =
        result.failedFiles > 0 ||
          !result.index.coverage.complete ||
          !result.index.coverage.identity.complete ||
          !result.index.coverage.period.last7Days.complete ||
          !result.index.coverage.period.last30Days.complete ||
          !result.index.coverage.period.allTime.complete ||
          (result.index.coverage.hourly !== undefined &&
            !result.index.coverage.hourly.complete)
          ? 'partial'
          : 'success';
      return {
        outcome,
        snapshot: this.currentSnapshot,
        progress: this.lastProgress,
        achievementUsageDelta: result.failedFiles === 0 && result.index.coverage.complete
          ? copyCodexUsageDelta(result.achievementUsageDelta, usageWindow) : undefined,
        diagnostic: {
          bodyReads: result.bodyReads,
          failedFiles: result.failedFiles,
          metadataMs: result.metadataMs,
          parseMs: result.parseMs,
          migrationPending: result.migration.pending,
          ...(result.indexRecovery
            ? { indexRecovery: result.indexRecovery }
            : {}),
        },
      };
    } catch (error) {
      const snapshot = this.invalidateCurrentManifestProof();
      try {
        await client.dispose();
      } finally {
        if (this.client === client) this.client = null;
      }
      return {
        outcome: 'error',
        failureCode: safeWorkerFailureCode(error),
        snapshot,
        progress: this.lastProgress,
        diagnostic: {
          // A thrown/cancelled worker returns no final per-file diagnostics.
          // Zero here means unavailable, not a fresh successful failure census.
          bodyReads: 0, failedFiles: 0, metadataMs: 0, parseMs: 0,
          migrationPending: false,
          errorCode: safeCodexIndexErrorCode(error instanceof CodexWorkerError ? error.code : undefined),
        },
      };
    }
  }

  /** Apply an achievement toggle without replacing the usage provider or its checkpoint. */
  setAchievementHourProofEnabled(enabled: boolean): void {
    this.options.allowAchievementHourProof = enabled;
  }

  private invalidateCurrentManifestProof(): CodexProviderSnapshot {
    this.snapshotGeneration += 1;
    if (this.currentSnapshot) {
      // Keep the last numeric subtotal useful without pretending a failed or
      // unavailable current scan verified it. Published snapshots stay immutable.
      this.currentSnapshot = displayOnlySnapshot(this.currentSnapshot);
    }
    return this.currentSnapshot ?? emptySnapshot(this.options.timeZone);
  }

  snapshot(): CodexProviderSnapshot | null {
    return this.currentSnapshot;
  }

  cancel(): void {
    this.client?.cancel?.();
  }

  async cancelAndWait(): Promise<void> {
    const client = this.client;
    client?.cancel?.();
    await client?.whenIdle?.();
  }

  async dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.invalidateCurrentManifestProof();
    this.sessionTitleCache.clear();
    const client = this.client;
    this.client = null;
    this.disposal = Promise.resolve()
      .then(() => client?.dispose())
      .then(() => undefined);
    await this.disposal;
  }
}
