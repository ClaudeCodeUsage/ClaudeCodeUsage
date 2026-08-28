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
  CodexTodayCoverage,
  CodexIndexV1,
  createEmptyCodexIndex,
  isCodexUsageContributionCurrent,
  loadCodexIndex,
} from './codexIndex';
import { CodexIndexClient } from './codexIndexClient';
import {
  CodexWorkerRefreshInput,
  CodexWorkerResult,
} from './codexWorkerProtocol';
import { loadCodexSessionTitles } from './codexIdentity';
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
  dispose(): void;
}

export interface CodexProviderSnapshot {
  provider: 'codex';
  total: ProviderTokenCounts;
  files: CodexFileAggregate[];
  coverage: CodexIndexCoverage;
  qualityFlags: Record<string, number>;
  limits: ProviderLimitSnapshot[];
  limit: ProviderLimitSnapshot | null;
  /** Aggregate-only inputs for reset-aligned API-equivalent value estimates. */
  weeklyValueInputs?: WeeklyValueInputs;
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

function isAccountWideCodexLimit(snapshot: ProviderLimitSnapshot): boolean {
  const id = (snapshot.limitId ?? '').trim().toLowerCase();
  const name = (snapshot.limitName ?? '').trim().toLowerCase();
  return id === 'codex' || name === 'codex' || (!name && id === '');
}

function codexWeeklyValueInputs(
  files: CodexFileContribution[],
): WeeklyValueInputs {
  const observations: WeeklyQuotaObservation[] = [];
  const usage: WeeklyValueInputs['usage'] = [];
  for (const file of files) {
    const sourceKey = file.fileKey;
    const seenSnapshots = new Set<string>();
    for (const snapshot of [
      ...Object.values(file.limits ?? {}),
      ...(file.limit ? [file.limit] : []),
    ]) {
      if (!isAccountWideCodexLimit(snapshot)) {
        continue;
      }
      const seriesKey = snapshot.limitId ?? snapshot.limitName ?? 'codex';
      for (const window of snapshot.windows) {
        if (
          window.windowMinutes !== 7 * 24 * 60 ||
          window.resetsAt === undefined
        ) {
          continue;
        }
        const identity = [
          seriesKey,
          snapshot.observedAt,
          window.resetsAt,
          window.usedPercent,
        ].join('|');
        if (seenSnapshots.has(identity)) {
          continue;
        }
        seenSnapshots.add(identity);
        observations.push({
          provider: 'codex',
          seriesKey,
          ...(snapshot.limitName ? { seriesLabel: snapshot.limitName } : {}),
          observedAt: snapshot.observedAt,
          resetAt: window.resetsAt,
          usedPercent: window.usedPercent,
          sourceKey,
        });
      }
    }
    for (const slice of Object.values(file.aggregate.period?.days ?? {})) {
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
    .map((file) => ({
      ...file.aggregate,
      session: {
        ...file.aggregate.session,
        sessionTitle: sessionTitles.get(file.aggregate.session.sessionKey),
      },
    }))
    .sort(
      (left, right) =>
        (right.session.startedAt ?? 0) - (left.session.startedAt ?? 0),
    );
  const limits = latestLimits(contributions);
  return {
    provider: 'codex',
    total: aggregateTotal(usageContributions),
    files,
    coverage: index.coverage,
    qualityFlags: qualityCounts(contributions),
    limits,
    limit: limits[0] ?? null,
    weeklyValueInputs: codexWeeklyValueInputs(usageContributions),
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

  constructor(
    private readonly options: CodexProviderOptions,
    private readonly clientFactory: CodexIndexClientFactory = () =>
      new CodexIndexClient(),
  ) {}

  async isAvailable(): Promise<boolean> {
    if (!this.options.enabled) {
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

  /**
   * Hydrate the last atomically checkpointed subtotal without starting the
   * worker. This keeps the dashboard useful while a long cold backfill or
   * lineage reconciliation continues in the background.
   */
  async loadPersistedSnapshot(): Promise<CodexProviderSnapshot | null> {
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
          loadCodexSessionTitles(this.options.codexHome, this.options.salt),
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
  ): Promise<CodexProviderResult> {
    if (!(await this.isAvailable())) {
      return {
        outcome: 'unavailable',
        snapshot: this.currentSnapshot ?? emptySnapshot(this.options.timeZone),
      };
    }
    this.client ??= this.clientFactory();
    this.lastProgress = undefined;
    try {
      const result = await this.client.refresh(
        {
          codexHome: this.options.codexHome,
          indexPath: this.options.indexPath,
          salt: this.options.salt,
          timeZone: this.options.timeZone,
          profile,
        },
        (progress) => {
          this.lastProgress = progress;
          onProgress?.(progress);
        },
      );
      const sessionTitles = await loadCodexSessionTitles(
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
          !result.index.coverage.period.allTime.complete
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
    } catch {
      return {
        outcome: 'error',
        snapshot: this.currentSnapshot ?? emptySnapshot(this.options.timeZone),
        progress: this.lastProgress,
      };
    }
  }

  snapshot(): CodexProviderSnapshot | null {
    return this.currentSnapshot;
  }

  dispose(): void {
    this.snapshotGeneration += 1;
    this.client?.dispose();
    this.client = null;
  }
}
