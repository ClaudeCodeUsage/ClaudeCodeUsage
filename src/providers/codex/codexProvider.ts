import { lstat } from 'node:fs/promises';
import * as path from 'node:path';

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
  isReadableCodexPeriod,
  isCodexUsageContributionCurrent,
  loadCodexIndex,
} from './codexIndex';
import {
  CODEX_ROLLING_HOURLY_DAYS,
  codexPeriodFitsAggregate,
  isCompatibleCodexPeriodLineage,
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
  total: ProviderTokenCounts;
  files: CodexFileAggregate[];
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
  snapshot: CodexProviderSnapshot;
  progress?: CodexIndexProgress;
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
      return {
        ...file.aggregate,
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
    total: aggregateTotal(usageContributions),
    files,
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
      return this.currentSnapshot;
    }
    if (this.persistedSnapshotLoad) {
      return this.persistedSnapshotLoad;
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
        if (
          index.coverage.totalFiles === 0 &&
          Object.keys(index.files).length === 0
        ) {
          return null;
        }
        const snapshot = snapshotFromIndex(index, sessionTitles);
        if (generation !== this.snapshotGeneration) {
          return this.currentSnapshot;
        }
        this.currentSnapshot = snapshot;
        return snapshot;
      } catch {
        return this.currentSnapshot;
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
  ): Promise<CodexProviderResult> {
    if (this.disposed) {
      return {
        outcome: 'unavailable',
        snapshot: this.currentSnapshot ?? emptySnapshot(this.options.timeZone),
      };
    }
    if (!(await this.isAvailable())) {
      return {
        outcome: 'unavailable',
        snapshot: this.currentSnapshot ?? emptySnapshot(this.options.timeZone),
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
        },
        (progress) => {
          this.lastProgress = progress;
          onProgress?.(progress);
        },
      );
      const sessionTitles = await this.sessionTitleCache.load(
        this.options.codexHome,
        this.options.salt,
      );
      this.snapshotGeneration += 1;
      this.currentSnapshot = snapshotFromIndex(result.index, sessionTitles);
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
      try {
        await client.dispose();
      } finally {
        if (this.client === client) this.client = null;
      }
      return {
        outcome: 'error',
        snapshot: this.currentSnapshot ?? emptySnapshot(this.options.timeZone),
        progress: this.lastProgress,
        diagnostic: {
          bodyReads: 0, failedFiles: 0, metadataMs: 0, parseMs: 0,
          migrationPending: false,
          errorCode: safeCodexIndexErrorCode(error instanceof CodexWorkerError ? error.code : undefined),
        },
      };
    }
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
    this.snapshotGeneration += 1;
    this.sessionTitleCache.clear();
    const client = this.client;
    this.client = null;
    this.disposal = Promise.resolve()
      .then(() => client?.dispose())
      .then(() => undefined);
    await this.disposal;
  }
}
