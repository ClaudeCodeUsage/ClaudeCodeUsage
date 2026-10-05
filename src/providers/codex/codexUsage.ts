import { CodexProviderSnapshot } from './codexProvider';
import {
  CodexFileAggregate,
  CodexHourlyCoverage,
  CodexIndexCoverage,
  CodexPeriodCoverage,
  CodexRangeCoverage,
  CodexStructuralSummary,
  CodexTodayCoverage,
} from './codexIndex';
import { formatHourLabel, rollingDayKeysFromDayKey } from '../../dateKeys';
import {
  CODEX_ROLLING_HOURLY_DAYS,
  CodexDailySlice,
  CODEX_PERIOD_LINEAGE_VERSION,
  codexPeriodFitsAggregate,
} from './codexPeriodIndex';
import {
  freshInputPlusOutput,
  processedTokens,
  ProviderLimitSnapshot,
  ProviderThreadRole,
  ProviderTokenCounts,
} from '../providerTypes';
import { buildCodexLimitViews, CodexLimitView } from './codexLimits';
import {
  NEUTRAL_CODEX_PROJECT_KEY,
  NEUTRAL_CODEX_SESSION_KEY,
  parsePseudonymousIdentityKey,
  PseudonymousIdentityKey,
  stableCodexViewKey,
} from './codexIdentity';
import {
  EquivalentCostBreakdown,
  equivalentCostBreakdownFromProviderTokens,
  summarizeEquivalentCostBreakdowns,
  WeeklyValueInputs,
} from '../../weeklyValue';
import {
  buildProjectUsageMatrixSnapshot,
  ProjectMatrixCoverage,
  ProjectUsageMatrixSnapshot,
} from '../../projectUsageMatrix';

export interface CodexMetricTotals {
  processed: number;
  fresh: number;
  input: number;
  cachedInput: number;
  output: number;
  reasoning: number;
}

export interface CodexUsageScopeView {
  total: CodexMetricTotals;
  rootTasks: number;
  threads: number;
  childThreads: number;
  childProcessedShare: number;
  childFreshShare: number;
  approvalReviewerThreads: number;
  approvalReviewerFreshShare: number;
  cacheShare: number;
  durationMs: number;
  structural: CodexStructuralSummary;
  models: Array<{ key: string; totals: CodexMetricTotals }>;
  efforts: Array<{ key: string; totals: CodexMetricTotals }>;
  periodCoverage?: CodexRangeCoverage;
  /** Visible values are a current, conservative subtotal while indexing continues. */
  indexedSubtotal?: boolean;
}

export interface CodexDailyUsageView {
  day: string;
  total: CodexMetricTotals;
  apiEquivalent: EquivalentCostBreakdown;
  threads: number;
  childThreads: number;
  approvalReviewerThreads: number;
}

export interface CodexThreadUsageView {
  /** Safe, stable key for DOM, client state, and declarative actions. */
  viewKey: string;
  parentViewKey?: string;
  rootTaskViewKey: string;
  depth: number;
  parentStatus: 'none' | 'available' | 'missing' | 'cycle';
  sessionKey: string;
  parentSessionKey?: string;
  title?: string;
  parentTitle?: string;
  agentNickname?: string;
  observedAt: number;
  role: ProviderThreadRole;
  projectViewKey: string;
  projectKey: string;
  projectName?: string;
  projectDirectoryName?: string;
  models: string[];
  efforts: string[];
  periodMembership: Array<'recent' | '7d' | '30d' | 'all'>;
  /** Exact indexed local days from the provider period data. */
  dayMembership: string[];
  total: CodexMetricTotals;
  durationMs: number;
  structural: CodexStructuralSummary;
}

export interface CodexProjectUsageView {
  /** Safe, stable key for DOM, client state, and declarative actions. */
  viewKey: string;
  projectKey: string;
  name?: string;
  directoryName?: string;
  lastActiveAt: number;
  threadCount: number;
  recentThreads: CodexThreadUsageView[];
  scope: CodexUsageScopeView;
}

export interface CodexExploreSessionsView {
  defaultLayout: 'tree';
  filteredLayout: 'flat';
}

export interface CodexTaskIdentityView {
  taskKey: string;
  projectKey: string;
  title?: string;
  projectName?: string;
  projectDirectoryName?: string;
  lastActiveAt: number;
  /** @deprecated Use lastActiveAt. Kept while existing view consumers migrate. */
  observedAt: number;
}

export interface CodexPeriodUsageView {
  period: string;
  total: CodexMetricTotals;
  apiEquivalent: EquivalentCostBreakdown;
  threads: number;
}

export interface CodexHourlyUsageView {
  hour: string;
  label: string;
  total: CodexMetricTotals;
  apiEquivalent: EquivalentCostBreakdown;
  threads: number;
}

export interface CodexTokenComposition {
  /** Uncached input plus output. Kept outside the stack because output is already a segment. */
  uncachedUsage: number;
  freshInput: number;
  cachedInput: number;
  output: number;
  reasoningWithinOutput: number;
}

export interface CodexBehaviorView {
  childThreadsPerRootTask: number;
  childFreshShare: number;
  approvalReviewerFreshShare: number;
  highEffortFreshShare: number;
  processedToFreshRatio: number;
  cacheShare: number;
  reasoningOutputShare: number;
  postPatchToolCallsPerPatchCall: number;
  patchCalls: number;
  compactCount: number;
}

export interface CodexBehaviorScopesView {
  recent: CodexBehaviorView | null;
  last7Days: CodexBehaviorView;
  last30Days: CodexBehaviorView;
  allTime: CodexBehaviorView;
}

export interface CodexUsageView {
  /** Cached display data cannot prove new awards before source verification. */
  currentManifestVerified?: boolean;
  /** Calendar day in the configured provider timezone. */
  today: CodexUsageScopeView;
  /** Exact, sparse current-day hours from the independently resumable sidecar. */
  todayHourly: CodexHourlyUsageView[];
  todayCoverage: CodexTodayCoverage;
  /** Sparse data-day -> exact hour rows for the configured rolling window. */
  last30DaysHourlyByDay: Record<string, CodexHourlyUsageView[]>;
  hourlyCoverage: CodexHourlyCoverage;
  /** Canonical, complete-only positive-output UTC hours for achievements. */
  outputHourProof?: CodexProviderSnapshot['outputHourProof'];
  lastTask: CodexUsageScopeView | null;
  lastTaskIdentity: CodexTaskIdentityView | null;
  last7Days: CodexUsageScopeView;
  last30Days: CodexUsageScopeView;
  allTime: CodexUsageScopeView;
  projects: CodexProjectUsageView[];
  projectUsageMatrix: ProjectUsageMatrixSnapshot;
  /** Complete derived day series retained in host memory for month drill-downs. */
  allTimeDaily: CodexDailyUsageView[];
  /** Bounded recent day series used by the share heatmap payload. */
  daily: CodexDailyUsageView[];
  last7DaysDaily: CodexDailyUsageView[];
  last30DaysDaily: CodexDailyUsageView[];
  monthly: CodexPeriodUsageView[];
  recentThreads: CodexThreadUsageView[];
  sessionPeriodAvailability: Record<'recent' | '7d' | '30d' | 'all', boolean>;
  exploreSessions: CodexExploreSessionsView;
  totalThreadCount: number;
  behaviorScopes: CodexBehaviorScopesView;
  /** Backward-compatible all-time behavior aggregate. */
  behavior: CodexBehaviorView;
  periodCoverage: CodexPeriodCoverage;
  coverage: CodexIndexCoverage;
  qualityFlags: Array<{ flag: string; count: number }>;
  limits: CodexLimitView[];
  /** Status-bar compatibility; Overview uses the classified limits field. */
  limit: ProviderLimitSnapshot | null;
  weeklyValueInputs?: WeeklyValueInputs;
}

// Keep one complete GitHub-style share-card year plus a small boundary margin.
// The existing table can scroll this bounded view, while Compare reuses it
// directly instead of rescanning source logs or creating a second cache.
const MAX_DAILY_ROWS = 370;
const MAX_RECENT_THREAD_ROWS = 1_000;
const MAX_PROJECT_RECENT_THREADS = 20;
const HIGH_EFFORTS = new Set(['high', 'xhigh', 'max', 'ultra']);

function zeroTokens(): ProviderTokenCounts {
  return {
    inputTotal: 0,
    cachedInput: 0,
    outputTotal: 0,
    reasoningOutput: 0,
  };
}

function addTokens(target: ProviderTokenCounts, source: ProviderTokenCounts): void {
  target.inputTotal += Math.max(0, source.inputTotal);
  target.cachedInput =
    (target.cachedInput ?? 0) + Math.max(0, source.cachedInput ?? 0);
  target.outputTotal += Math.max(0, source.outputTotal);
  target.reasoningOutput =
    (target.reasoningOutput ?? 0) + Math.max(0, source.reasoningOutput ?? 0);
}

function metrics(tokens: ProviderTokenCounts): CodexMetricTotals {
  return {
    processed: processedTokens(tokens),
    fresh: freshInputPlusOutput(tokens),
    input: Math.max(0, tokens.inputTotal),
    cachedInput: Math.max(0, tokens.cachedInput ?? 0),
    output: Math.max(0, tokens.outputTotal),
    reasoning: Math.max(0, tokens.reasoningOutput ?? 0),
  };
}

export function tokenComposition(
  total: CodexMetricTotals,
): CodexTokenComposition {
  const input = Math.max(0, total.input);
  const cachedInput = Math.min(input, Math.max(0, total.cachedInput));
  const output = Math.max(0, total.output);
  const freshInput = Math.max(0, input - cachedInput);
  return {
    uncachedUsage: freshInput + output,
    freshInput,
    cachedInput,
    output,
    reasoningWithinOutput: Math.min(output, Math.max(0, total.reasoning)),
  };
}

function zeroStructural(): CodexStructuralSummary {
  return {
    patchCalls: 0,
    toolCalls: 0,
    postPatchToolCalls: 0,
    compactCount: 0,
    taskCompleteCount: 0,
  };
}

function addStructural(
  target: CodexStructuralSummary,
  source: CodexStructuralSummary,
): void {
  target.patchCalls += source.patchCalls;
  target.toolCalls += source.toolCalls;
  target.postPatchToolCalls += source.postPatchToolCalls;
  target.compactCount += source.compactCount;
  target.taskCompleteCount += source.taskCompleteCount;
}

function addBuckets(
  target: Map<string, ProviderTokenCounts>,
  source: Record<string, ProviderTokenCounts>,
  fallback: ProviderTokenCounts,
): void {
  const entries = Object.entries(source);
  if (entries.length === 0) {
    const current = target.get('unknown') ?? zeroTokens();
    addTokens(current, fallback);
    target.set('unknown', current);
    return;
  }
  for (const [rawKey, tokens] of entries) {
    const key = rawKey || 'unknown';
    const current = target.get(key) ?? zeroTokens();
    addTokens(current, tokens);
    target.set(key, current);
  }
  const attributed = zeroTokens();
  for (const [, tokens] of entries) {
    addTokens(attributed, tokens);
  }
  const inputTotal = Math.max(0, fallback.inputTotal - attributed.inputTotal);
  const outputTotal = Math.max(0, fallback.outputTotal - attributed.outputTotal);
  const residual: ProviderTokenCounts = {
    inputTotal,
    cachedInput: Math.min(
      inputTotal,
      Math.max(0, (fallback.cachedInput ?? 0) - (attributed.cachedInput ?? 0)),
    ),
    outputTotal,
    reasoningOutput: Math.min(
      outputTotal,
      Math.max(
        0,
        (fallback.reasoningOutput ?? 0) - (attributed.reasoningOutput ?? 0),
      ),
    ),
  };
  if (
    residual.inputTotal > 0 ||
    (residual.cachedInput ?? 0) > 0 ||
    residual.outputTotal > 0 ||
    (residual.reasoningOutput ?? 0) > 0
  ) {
    const unknown = target.get('unknown') ?? zeroTokens();
    addTokens(unknown, residual);
    target.set('unknown', unknown);
  }
}

function bucketRows(
  buckets: Map<string, ProviderTokenCounts>,
): Array<{ key: string; totals: CodexMetricTotals }> {
  return [...buckets.entries()]
    .map(([key, tokens]) => ({ key, totals: metrics(tokens) }))
    .filter(({ totals }) =>
      totals.processed > 0 ||
      totals.fresh > 0 ||
      totals.input > 0 ||
      totals.cachedInput > 0 ||
      totals.output > 0 ||
      totals.reasoning > 0,
    )
    .sort(
      (left, right) =>
        right.totals.processed - left.totals.processed ||
        left.key.localeCompare(right.key),
    );
}

function apiEquivalentForBuckets(
  buckets: Map<string, ProviderTokenCounts>,
  expectedTotalTokens: number,
): EquivalentCostBreakdown {
  return summarizeEquivalentCostBreakdowns(
    [...buckets.entries()].map(([model, tokens]) =>
      equivalentCostBreakdownFromProviderTokens(model, tokens),
    ),
    expectedTotalTokens,
  );
}

function fallbackPeriodSlice(total: ProviderTokenCounts): CodexDailySlice {
  return {
    total,
    byModel: {},
    byEffort: {},
    structural: zeroStructural(),
  };
}

/**
 * Period sidecars are a configured-zone, model-aware projection. A legacy or
 * currently rebuilding sidecar must not be allowed to inflate a range beyond
 * the verified per-file all-time aggregate. The UTC-keyed all-time day map is
 * a conservative temporary fallback until the zone-aware sidecar is rebuilt;
 * it preserves totals without pretending to know model/day attribution.
 */
function periodSlicesForFile(
  file: CodexFileAggregate,
  timeZone: string,
): Array<[string, CodexDailySlice]> {
  if (
    file.period?.timeZone === timeZone &&
    (file.period.lineageVersion === undefined ||
      file.period.lineageVersion === CODEX_PERIOD_LINEAGE_VERSION) &&
    codexPeriodFitsAggregate(file.period, file.total)
  ) {
    return Object.entries(file.period.days);
  }
  return Object.entries(file.byDay)
    .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .map(([day, total]) => [day, fallbackPeriodSlice(total)]);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function sessionDuration(file: CodexFileAggregate): number {
  const { startedAt, endedAt } = file.session;
  if (startedAt === undefined || endedAt === undefined) {
    return 0;
  }
  return Math.max(0, endedAt - startedAt);
}

function scope(
  files: CodexFileAggregate[],
  indexedSubtotal = false,
): CodexUsageScopeView {
  const totalTokens = zeroTokens();
  const childTokens = zeroTokens();
  const approvalTokens = zeroTokens();
  const structural = zeroStructural();
  const models = new Map<string, ProviderTokenCounts>();
  const efforts = new Map<string, ProviderTokenCounts>();
  let durationMs = 0;
  let rootTasks = 0;
  let childThreads = 0;
  let approvalReviewerThreads = 0;

  for (const file of files) {
    addTokens(totalTokens, file.total);
    addStructural(structural, file.structural);
    addBuckets(models, file.byModel, file.total);
    addBuckets(efforts, file.byEffort, file.total);
    durationMs += sessionDuration(file);
    if (file.session.role === 'root') {
      rootTasks += 1;
    } else if (file.session.role === 'subagent') {
      childThreads += 1;
      addTokens(childTokens, file.total);
    } else if (file.session.role === 'approval-reviewer') {
      approvalReviewerThreads += 1;
      addTokens(approvalTokens, file.total);
    }
  }

  const total = metrics(totalTokens);
  const child = metrics(childTokens);
  const approval = metrics(approvalTokens);
  return {
    total,
    rootTasks,
    threads: files.length,
    childThreads,
    childProcessedShare: ratio(child.processed, total.processed),
    childFreshShare: ratio(child.fresh, total.fresh),
    approvalReviewerThreads,
    approvalReviewerFreshShare: ratio(approval.fresh, total.fresh),
    cacheShare: Math.min(1, ratio(total.cachedInput, total.input)),
    durationMs,
    structural,
    models: bucketRows(models),
    efforts: bucketRows(efforts),
    indexedSubtotal,
  };
}

function scopeFromPeriodDays(
  files: CodexFileAggregate[],
  keys: string[],
  coverage: CodexRangeCoverage,
  timeZone: string,
  indexIncomplete = false,
): CodexUsageScopeView {
  const selectedKeys = new Set(keys);
  const totalTokens = zeroTokens();
  const childTokens = zeroTokens();
  const approvalTokens = zeroTokens();
  const structural = zeroStructural();
  const models = new Map<string, ProviderTokenCounts>();
  const efforts = new Map<string, ProviderTokenCounts>();
  const countedSessions = new Set<string>();
  const sessionRanges = new Map<string, { first: number; last: number }>();
  let rootTasks = 0;
  let childThreads = 0;
  let approvalReviewerThreads = 0;

  for (const file of files) {
    const slices = periodSlicesForFile(file, timeZone)
      .filter(([day]) => selectedKeys.has(day))
      .map(([, slice]) => slice);
    if (slices.length === 0) {
      continue;
    }

    const sessionKey = file.session.sessionKey;
    if (!countedSessions.has(sessionKey)) {
      countedSessions.add(sessionKey);
      if (file.session.role === 'root') {
        rootTasks += 1;
      } else if (file.session.role === 'subagent') {
        childThreads += 1;
      } else if (file.session.role === 'approval-reviewer') {
        approvalReviewerThreads += 1;
      }
    }

    for (const slice of slices) {
      addTokens(totalTokens, slice.total);
      addStructural(structural, slice.structural);
      addBuckets(models, slice.byModel, slice.total);
      addBuckets(efforts, slice.byEffort, slice.total);
      if (file.session.role === 'subagent') {
        addTokens(childTokens, slice.total);
      } else if (file.session.role === 'approval-reviewer') {
        addTokens(approvalTokens, slice.total);
      }

      const first = slice.firstObservedAt;
      const last = slice.lastObservedAt;
      if (first !== undefined || last !== undefined) {
        const observedFirst = first ?? last!;
        const observedLast = last ?? first!;
        const current = sessionRanges.get(sessionKey);
        sessionRanges.set(sessionKey, {
          first: Math.min(current?.first ?? observedFirst, observedFirst),
          last: Math.max(current?.last ?? observedLast, observedLast),
        });
      }
    }
  }

  const total = metrics(totalTokens);
  const child = metrics(childTokens);
  const approval = metrics(approvalTokens);
  const durationMs = [...sessionRanges.values()].reduce(
    (sum, range) => sum + Math.max(0, range.last - range.first),
    0,
  );
  return {
    total,
    rootTasks,
    threads: countedSessions.size,
    childThreads,
    childProcessedShare: ratio(child.processed, total.processed),
    childFreshShare: ratio(child.fresh, total.fresh),
    approvalReviewerThreads,
    approvalReviewerFreshShare: ratio(approval.fresh, total.fresh),
    cacheShare: Math.min(1, ratio(total.cachedInput, total.input)),
    durationMs,
    structural,
    models: bucketRows(models),
    efforts: bucketRows(efforts),
    periodCoverage: coverage,
    indexedSubtotal: indexIncomplete || !coverage.complete,
  };
}

function observedAt(file: CodexFileAggregate): number {
  return file.session.endedAt ?? file.session.startedAt ?? 0;
}

function latestObservedAt(files: readonly CodexFileAggregate[]): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const file of files) {
    latest = Math.max(latest, observedAt(file));
  }
  return latest;
}

function sortedBucketKeys(
  buckets: Record<string, ProviderTokenCounts>,
): string[] {
  const entries = Object.entries(buckets);
  if (entries.length === 0) {
    return ['unknown'];
  }
  const rows = entries.filter(([, tokens]) =>
    processedTokens(tokens) > 0 ||
    (tokens.cachedInput ?? 0) > 0 ||
    (tokens.reasoningOutput ?? 0) > 0,
  );
  return rows
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        processedTokens(right) - processedTokens(left) ||
        leftKey.localeCompare(rightKey),
    )
    .map(([key]) => key || 'unknown');
}

function dailyRows(
  files: CodexFileAggregate[],
  timeZone: string,
): CodexDailyUsageView[] {
  const days = new Map<
    string,
    {
      tokens: ProviderTokenCounts;
      models: Map<string, ProviderTokenCounts>;
      threads: Set<string>;
      childThreads: Set<string>;
      approvalReviewerThreads: Set<string>;
    }
  >();
  for (const file of files) {
    for (const [day, slice] of periodSlicesForFile(file, timeZone)) {
      const row = days.get(day) ?? {
        tokens: zeroTokens(),
        models: new Map<string, ProviderTokenCounts>(),
        threads: new Set<string>(),
        childThreads: new Set<string>(),
        approvalReviewerThreads: new Set<string>(),
      };
      addTokens(row.tokens, slice.total);
      addBuckets(row.models, slice.byModel, slice.total);
      row.threads.add(file.session.sessionKey);
      if (file.session.role === 'subagent') {
        row.childThreads.add(file.session.sessionKey);
      } else if (file.session.role === 'approval-reviewer') {
        row.approvalReviewerThreads.add(file.session.sessionKey);
      }
      days.set(day, row);
    }
  }
  return [...days.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, row]) => {
      const total = metrics(row.tokens);
      return {
        day,
        total,
        apiEquivalent: apiEquivalentForBuckets(
          row.models,
          total.processed,
        ),
        threads: row.threads.size,
        childThreads: row.childThreads.size,
        approvalReviewerThreads: row.approvalReviewerThreads.size,
      };
    });
}

function monthlyRows(
  files: CodexFileAggregate[],
  timeZone: string,
): CodexPeriodUsageView[] {
  const months = new Map<
    string,
    {
      tokens: ProviderTokenCounts;
      models: Map<string, ProviderTokenCounts>;
      sessions: Set<string>;
    }
  >();
  for (const file of files) {
    for (const [day, slice] of periodSlicesForFile(file, timeZone)) {
      const period = day.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(period)) {
        continue;
      }
      const row = months.get(period) ?? {
        tokens: zeroTokens(),
        models: new Map<string, ProviderTokenCounts>(),
        sessions: new Set<string>(),
      };
      addTokens(row.tokens, slice.total);
      addBuckets(row.models, slice.byModel, slice.total);
      row.sessions.add(file.session.sessionKey);
      months.set(period, row);
    }
  }
  return [...months.entries()]
    // Monthly history is a time series: keep the oldest month first so the
    // chart, table, and screen-reader order all read chronologically.
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, row]) => {
      const total = metrics(row.tokens);
      return {
        period,
        total,
        apiEquivalent: apiEquivalentForBuckets(
          row.models,
          total.processed,
        ),
        threads: row.sessions.size,
      };
    });
}

function hourlyRows(
  files: CodexFileAggregate[],
  day: string,
  timeZone: string,
): CodexHourlyUsageView[] {
  const hours = new Map<
    string,
    {
      tokens: ProviderTokenCounts;
      models: Map<string, ProviderTokenCounts>;
      threads: Set<string>;
    }
  >();
  for (const file of files) {
    if (!file.today || file.today.timeZone !== timeZone) {
      continue;
    }
    const slices =
      file.today.windowDays === CODEX_ROLLING_HOURLY_DAYS && file.today.days
        ? file.today.days[day] ?? {}
        : file.today.day === day
          ? file.today.hours
          : {};
    for (const [hour, slice] of Object.entries(slices)) {
      if (!/^(?:[01]\d|2[0-3])$/.test(hour)) {
        continue;
      }
      const row = hours.get(hour) ?? {
        tokens: zeroTokens(),
        models: new Map<string, ProviderTokenCounts>(),
        threads: new Set<string>(),
      };
      addTokens(row.tokens, slice.total);
      addBuckets(row.models, slice.byModel, slice.total);
      row.threads.add(file.session.sessionKey);
      hours.set(hour, row);
    }
  }
  return [...hours.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hour, row]) => {
      const total = metrics(row.tokens);
      return {
        hour,
        label: formatHourLabel(hour),
        total,
        apiEquivalent: apiEquivalentForBuckets(row.models, total.processed),
        threads: row.threads.size,
      };
    });
}

function rollingDailyRows(
  rows: CodexDailyUsageView[],
  keys: string[],
): CodexDailyUsageView[] {
  const rowsByDay = new Map(rows.map((row) => [row.day, row]));
  return keys.map((day) => rowsByDay.get(day) ?? {
    day,
    total: metrics(zeroTokens()),
    apiEquivalent: summarizeEquivalentCostBreakdowns([]),
    threads: 0,
    childThreads: 0,
    approvalReviewerThreads: 0,
  });
}

function behaviorView(scopeView: CodexUsageScopeView): CodexBehaviorView {
  const highEffortFresh = scopeView.efforts
    .filter((row) => HIGH_EFFORTS.has(row.key.toLowerCase()))
    .reduce((total, row) => total + row.totals.fresh, 0);
  return {
    childThreadsPerRootTask: ratio(
      scopeView.childThreads,
      scopeView.rootTasks,
    ),
    childFreshShare: scopeView.childFreshShare,
    approvalReviewerFreshShare: scopeView.approvalReviewerFreshShare,
    highEffortFreshShare: ratio(highEffortFresh, scopeView.total.fresh),
    processedToFreshRatio: ratio(
      scopeView.total.processed,
      scopeView.total.fresh,
    ),
    cacheShare: scopeView.cacheShare,
    reasoningOutputShare: ratio(
      scopeView.total.reasoning,
      scopeView.total.output,
    ),
    postPatchToolCallsPerPatchCall: ratio(
      scopeView.structural.postPatchToolCalls,
      scopeView.structural.patchCalls,
    ),
    patchCalls: scopeView.structural.patchCalls,
    compactCount: scopeView.structural.compactCount,
  };
}

interface CodexThreadPeriodContext {
  recentSessionKeys: Set<PseudonymousIdentityKey>;
  last7DayKeys: Set<string>;
  last30DayKeys: Set<string>;
  timeZone: string;
}

function sessionIdentityKey(file: CodexFileAggregate): PseudonymousIdentityKey {
  return parsePseudonymousIdentityKey(file.session.sessionKey) ??
    NEUTRAL_CODEX_SESSION_KEY;
}

function projectIdentityKey(file: CodexFileAggregate): PseudonymousIdentityKey {
  return parsePseudonymousIdentityKey(file.session.projectKey) ??
    NEUTRAL_CODEX_PROJECT_KEY;
}

function periodMembership(
  file: CodexFileAggregate,
  context: CodexThreadPeriodContext,
): CodexThreadUsageView['periodMembership'] {
  const result: CodexThreadUsageView['periodMembership'] = [];
  if (context.recentSessionKeys.has(sessionIdentityKey(file))) {
    result.push('recent');
  }
  const days = periodSlicesForFile(file, context.timeZone).map(([day]) => day);
  if (days.some((day) => context.last7DayKeys.has(day))) {
    result.push('7d');
  }
  if (days.some((day) => context.last30DayKeys.has(day))) {
    result.push('30d');
  }
  if (days.length > 0) {
    result.push('all');
  }
  return result;
}

function dayMembership(
  file: CodexFileAggregate,
  context: CodexThreadPeriodContext,
): string[] {
  return periodSlicesForFile(file, context.timeZone)
    .map(([day]) => day)
    .sort();
}

function recentThreadRows(
  files: CodexFileAggregate[],
  periodContext: CodexThreadPeriodContext,
  maxRows = MAX_RECENT_THREAD_ROWS,
): CodexThreadUsageView[] {
  const sourceBySessionKey = new Map(
    files.map((file) => [sessionIdentityKey(file), file]),
  );
  const titles = new Map(
    files
      .filter((file) => file.session.sessionTitle)
      .map((file) => [sessionIdentityKey(file), file.session.sessionTitle!]),
  );
  const lineage = (file: CodexFileAggregate): {
    parent?: CodexFileAggregate;
    root: CodexFileAggregate;
    depth: number;
    parentStatus: CodexThreadUsageView['parentStatus'];
  } => {
    const visited = new Set<PseudonymousIdentityKey>([
      sessionIdentityKey(file),
    ]);
    const ancestors: CodexFileAggregate[] = [];
    let current = file;
    while (current.session.parentSessionKey) {
      const parentKey = parsePseudonymousIdentityKey(
        current.session.parentSessionKey,
      );
      if (!parentKey) {
        return { root: file, depth: 0, parentStatus: 'missing' };
      }
      const parent = sourceBySessionKey.get(parentKey);
      if (!parent) {
        return { root: file, depth: 0, parentStatus: 'missing' };
      }
      if (visited.has(parentKey)) {
        return { root: file, depth: 0, parentStatus: 'cycle' };
      }
      ancestors.push(parent);
      visited.add(parentKey);
      current = parent;
    }
    return {
      ...(ancestors[0] ? { parent: ancestors[0] } : {}),
      root: ancestors[ancestors.length - 1] ?? file,
      depth: ancestors.length,
      parentStatus: ancestors.length > 0 ? 'available' : 'none',
    };
  };
  return [...files]
    .sort(
      (left, right) =>
        observedAt(right) - observedAt(left) ||
        sessionIdentityKey(left).localeCompare(sessionIdentityKey(right)),
    )
    .slice(0, maxRows)
    .map((file) => {
      const resolved = lineage(file);
      const sessionKey = sessionIdentityKey(file);
      const projectKey = projectIdentityKey(file);
      return {
        viewKey: stableCodexViewKey(sessionKey),
        ...(resolved.parent
          ? { parentViewKey: stableCodexViewKey(sessionIdentityKey(resolved.parent)) }
          : {}),
        rootTaskViewKey: stableCodexViewKey(sessionIdentityKey(resolved.root)),
        depth: resolved.depth,
        parentStatus: resolved.parentStatus,
        sessionKey,
        ...(resolved.parent
          ? { parentSessionKey: sessionIdentityKey(resolved.parent) }
          : {}),
        title: file.session.sessionTitle,
        parentTitle: resolved.parent
          ? titles.get(sessionIdentityKey(resolved.parent))
          : undefined,
        agentNickname: file.session.agentNickname,
        observedAt: observedAt(file),
        role: file.session.role,
        projectViewKey: stableCodexViewKey(projectKey),
        projectKey,
        projectName: file.session.projectName,
        projectDirectoryName: file.session.projectDirectoryName,
        models: sortedBucketKeys(file.byModel),
        efforts: sortedBucketKeys(file.byEffort),
        periodMembership: periodMembership(file, periodContext),
        dayMembership: dayMembership(file, periodContext),
        total: metrics(file.total),
        durationMs: sessionDuration(file),
        structural: { ...file.structural },
      };
    });
}

function recentTaskFiles(files: CodexFileAggregate[]): CodexFileAggregate[] {
  const latest = [...files].sort((left, right) => observedAt(right) - observedAt(left))[0];
  if (!latest) {
    return [];
  }
  const connections = new Map<string, Set<string>>();
  for (const file of files) {
    const key = file.session.sessionKey;
    const peers = connections.get(key) ?? new Set<string>();
    connections.set(key, peers);
    const parent = file.session.parentSessionKey;
    if (parent) {
      peers.add(parent);
      const parentPeers = connections.get(parent) ?? new Set<string>();
      parentPeers.add(key);
      connections.set(parent, parentPeers);
    }
  }
  const visited = new Set<string>();
  const pending = [latest.session.sessionKey];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    for (const peer of connections.get(key) ?? []) {
      if (!visited.has(peer)) {
        pending.push(peer);
      }
    }
  }
  return files.filter((file) => visited.has(file.session.sessionKey));
}

function identityValue(
  files: CodexFileAggregate[],
  field: 'projectName' | 'projectDirectoryName',
): string | undefined {
  return [...files]
    .filter((file) => Boolean(file.session[field]?.trim()))
    .sort(
      (left, right) =>
        observedAt(right) - observedAt(left) ||
        Number(right.session.role === 'root') -
          Number(left.session.role === 'root') ||
        left.session.sessionKey.localeCompare(right.session.sessionKey),
    )[0]?.session[field];
}

function taskRootFile(
  files: CodexFileAggregate[],
): CodexFileAggregate | undefined {
  return [...files]
    .filter((file) => file.session.role === 'root')
    .sort(
      (left, right) =>
        observedAt(right) - observedAt(left) ||
        left.session.sessionKey.localeCompare(right.session.sessionKey),
    )[0];
}

function compareStableText(left: string | undefined, right: string | undefined): number {
  const leftValue = left ?? '';
  const rightValue = right ?? '';
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function fallbackTaskIdentityFile(
  files: CodexFileAggregate[],
): CodexFileAggregate | undefined {
  return [...files].sort(
    (left, right) =>
      compareStableText(sessionIdentityKey(left), sessionIdentityKey(right)) ||
      compareStableText(projectIdentityKey(left), projectIdentityKey(right)) ||
      observedAt(left) - observedAt(right) ||
      compareStableText(left.session.role, right.session.role) ||
      compareStableText(left.session.projectName, right.session.projectName) ||
      compareStableText(
        left.session.projectDirectoryName,
        right.session.projectDirectoryName,
      ) ||
      compareStableText(left.session.sessionTitle, right.session.sessionTitle) ||
      compareStableText(left.session.agentNickname, right.session.agentNickname),
  )[0];
}

function currentLimit(
  limit: ProviderLimitSnapshot | null,
  now: number,
): ProviderLimitSnapshot | null {
  if (!limit) {
    return null;
  }
  const windows = limit.windows.filter((window) =>
    window.resetsAt !== undefined && window.resetsAt > now,
  );
  return windows.length > 0 ? { ...limit, windows } : null;
}

export function buildCodexUsageView(
  snapshot: CodexProviderSnapshot,
  now: number = Date.now(),
): CodexUsageView {
  const recent = recentTaskFiles(snapshot.files);
  const periodCoverage = snapshot.coverage.period;
  const last7DayKeys = rollingDayKeysFromDayKey(periodCoverage.asOfDay, 7);
  const last30DayKeys = rollingDayKeysFromDayKey(periodCoverage.asOfDay, 30);
  const hourlyCoverage = snapshot.hourlyCoverage ??
    snapshot.coverage.hourly ?? {
      timeZone: periodCoverage.timeZone,
      asOfDay: periodCoverage.asOfDay,
      windowDays: CODEX_ROLLING_HOURLY_DAYS,
      indexedFiles: 0,
      totalFiles: 0,
      indexedBytes: 0,
      totalBytes: 0,
      complete: false,
      days: {},
    };
  const periodContext: CodexThreadPeriodContext = {
    recentSessionKeys: new Set(recent.map(sessionIdentityKey)),
    last7DayKeys: new Set(last7DayKeys),
    last30DayKeys: new Set(last30DayKeys),
    timeZone: periodCoverage.timeZone,
  };
  const allThreadRows = recentThreadRows(
    snapshot.files,
    periodContext,
    Number.POSITIVE_INFINITY,
  );
  const recentThreadsByProject = new Map<string, CodexThreadUsageView[]>();
  for (const thread of allThreadRows) {
    const rows = recentThreadsByProject.get(thread.projectKey) ?? [];
    if (rows.length < MAX_PROJECT_RECENT_THREADS) {
      rows.push(thread);
      recentThreadsByProject.set(thread.projectKey, rows);
    }
  }
  const projects = new Map<PseudonymousIdentityKey, CodexFileAggregate[]>();
  for (const file of snapshot.files) {
    const key = projectIdentityKey(file);
    const group = projects.get(key) ?? [];
    group.push(file);
    projects.set(key, group);
  }
  const exactMatrixPeriods = snapshot.files.every((file) =>
    file.period?.timeZone === periodCoverage.timeZone &&
    (file.period.lineageVersion === undefined ||
      file.period.lineageVersion === CODEX_PERIOD_LINEAGE_VERSION) &&
    codexPeriodFitsAggregate(file.period, file.total),
  );
  const matrixCoverage: ProjectMatrixCoverage =
    snapshot.coverage.complete && periodCoverage.allTime.complete && exactMatrixPeriods
      ? 'complete'
      : 'partial';
  const projectUsageMatrix = buildProjectUsageMatrixSnapshot(
    'codex',
    [...projects.entries()].flatMap(([projectKey, files]) => {
      const projectName = identityValue(files, 'projectName') ??
        identityValue(files, 'projectDirectoryName') ??
        '';
      const viewKey = `codex:${stableCodexViewKey(projectKey)}`;
      return files.flatMap((file) =>
        periodSlicesForFile(file, periodCoverage.timeZone).map(([day, slice]) => ({
          projectKey: viewKey,
          projectName,
          day,
          tokens: processedTokens(slice.total),
          coverage: matrixCoverage,
        })),
      );
    }),
    {
      asOfDay: periodCoverage.asOfDay,
      timeZone: periodCoverage.timeZone,
      coverage: matrixCoverage,
    },
  );
  const aggregateIndexIncomplete =
    !snapshot.coverage.complete ||
    !periodCoverage.last7Days.complete ||
    !periodCoverage.last30Days.complete ||
    !periodCoverage.allTime.complete;
  const recentScope = recent.length > 0
    ? scope(recent, aggregateIndexIncomplete)
    : null;
  const todayScope = scopeFromPeriodDays(
    snapshot.files,
    [periodCoverage.asOfDay],
    periodCoverage.last7Days,
    periodCoverage.timeZone,
    aggregateIndexIncomplete,
  );
  const last7DaysScope = scopeFromPeriodDays(
    snapshot.files,
    last7DayKeys,
    periodCoverage.last7Days,
    periodCoverage.timeZone,
    aggregateIndexIncomplete,
  );
  const last30DaysScope = scopeFromPeriodDays(
    snapshot.files,
    last30DayKeys,
    periodCoverage.last30Days,
    periodCoverage.timeZone,
    aggregateIndexIncomplete,
  );
  const allTime = scope(snapshot.files, aggregateIndexIncomplete);
  const allTimeDaily = dailyRows(snapshot.files, periodCoverage.timeZone);
  const daily = allTimeDaily.slice(0, MAX_DAILY_ROWS);
  const last30DaysHourlyByDay = Object.fromEntries(
    last30DayKeys.flatMap((day) => {
      const rows = hourlyRows(snapshot.files, day, periodCoverage.timeZone);
      return rows.length > 0 || (hourlyCoverage.days[day]?.totalFiles ?? 0) > 0
        ? [[day, rows]]
        : [];
    }),
  );
  const taskRoot = taskRootFile(recent);
  const taskIdentityFile = taskRoot ?? fallbackTaskIdentityFile(recent);
  const sourceLimits = snapshot.limits.length > 0
    ? snapshot.limits
    : snapshot.limit
      ? [snapshot.limit]
      : [];
  const limits = buildCodexLimitViews(sourceLimits, now);
  const lastActiveAt = recent.length > 0 ? latestObservedAt(recent) : 0;
  const recentProjectIdentityKey = taskIdentityFile
    ? projectIdentityKey(taskIdentityFile)
    : NEUTRAL_CODEX_PROJECT_KEY;
  const taskIdentityKey = taskIdentityFile
    ? sessionIdentityKey(taskIdentityFile)
    : NEUTRAL_CODEX_SESSION_KEY;
  const recentProjectFiles = recent.filter((file) =>
    projectIdentityKey(file) === recentProjectIdentityKey
  );
  const qualityFlags = { ...snapshot.qualityFlags };
  const indexBackfillIncomplete =
    !snapshot.coverage.complete ||
    !periodCoverage.last7Days.complete ||
    !periodCoverage.last30Days.complete ||
    !periodCoverage.allTime.complete;
  if (indexBackfillIncomplete) {
    qualityFlags['index-backfill-incomplete'] = 1;
  } else {
    delete qualityFlags['index-backfill-incomplete'];
  }
  if (snapshot.coverage.identity.ambiguousSessionGroups > 0) {
    qualityFlags['ambiguous-session-identity'] =
      snapshot.coverage.identity.ambiguousSessionGroups;
  } else {
    delete qualityFlags['ambiguous-session-identity'];
  }

  return {
    today: todayScope,
    currentManifestVerified: snapshot.currentManifestVerified === true,
    todayHourly: hourlyRows(
      snapshot.files,
      periodCoverage.asOfDay,
      periodCoverage.timeZone,
    ),
    todayCoverage: snapshot.coverage.today,
    last30DaysHourlyByDay,
    hourlyCoverage,
    outputHourProof: snapshot.outputHourProof,
    lastTask: recentScope,
    lastTaskIdentity: recent.length > 0
      ? {
          taskKey: stableCodexViewKey(taskIdentityKey),
          projectKey: stableCodexViewKey(recentProjectIdentityKey),
          title: taskRoot?.session.sessionTitle,
          projectName: identityValue(recentProjectFiles, 'projectName'),
          projectDirectoryName: identityValue(
            recentProjectFiles,
            'projectDirectoryName',
          ),
          lastActiveAt,
          observedAt: lastActiveAt,
        }
      : null,
    last7Days: last7DaysScope,
    last30Days: last30DaysScope,
    allTime,
    projects: [...projects.entries()]
      .map(([projectKey, files]) => {
        return {
          viewKey: stableCodexViewKey(projectKey),
          projectKey,
          name: identityValue(files, 'projectName'),
          directoryName: identityValue(files, 'projectDirectoryName'),
          lastActiveAt: Math.max(0, latestObservedAt(files)),
          threadCount: files.length,
          recentThreads: recentThreadsByProject.get(projectKey) ?? [],
          scope: scope(files, aggregateIndexIncomplete),
        };
      })
      .sort(
        (left, right) =>
          right.lastActiveAt - left.lastActiveAt ||
          left.projectKey.localeCompare(right.projectKey),
      ),
    projectUsageMatrix,
    allTimeDaily,
    daily,
    last7DaysDaily: rollingDailyRows(daily, last7DayKeys),
    last30DaysDaily: rollingDailyRows(daily, last30DayKeys),
    monthly: monthlyRows(snapshot.files, periodCoverage.timeZone),
    recentThreads: allThreadRows.slice(0, MAX_RECENT_THREAD_ROWS),
    sessionPeriodAvailability: {
      recent: recent.length > 0,
      '7d': periodCoverage.last7Days.complete,
      '30d': periodCoverage.last30Days.complete,
      all: periodCoverage.allTime.complete,
    },
    exploreSessions: {
      defaultLayout: 'tree',
      filteredLayout: 'flat',
    },
    totalThreadCount: snapshot.files.length,
    behaviorScopes: {
      recent: recentScope ? behaviorView(recentScope) : null,
      last7Days: behaviorView(last7DaysScope),
      last30Days: behaviorView(last30DaysScope),
      allTime: behaviorView(allTime),
    },
    behavior: behaviorView(allTime),
    periodCoverage,
    coverage: snapshot.coverage,
    qualityFlags: Object.entries(qualityFlags)
      .map(([flag, count]) => ({ flag, count }))
      .sort((left, right) => left.flag.localeCompare(right.flag)),
    limits,
    limit: currentLimit(snapshot.limit, now),
    weeklyValueInputs: snapshot.weeklyValueInputs,
  };
}
