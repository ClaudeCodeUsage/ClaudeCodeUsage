import { calculateCostFromPricing, getExactModelPricing } from './pricing';
import { ClaudeApiUsageResponse, ClaudeUsageRecord } from './types';
import { normalizeQuotaWindows } from './quotaWindows';
import { ProviderTokenCounts, UsageProvider } from './providers/providerTypes';
import type { CodexCalibrationPricebook } from './codexCalibrationEvidence';
import type { CodexQuotaCheckpoint } from './providers/codex/codexQuotaCheckpoints';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_CLUSTER_MS = 5 * 60 * 1000;
const MIN_PRICED_SHARE = 0.8;

export type WeeklyValueConfidence = 'high' | 'medium' | 'low' | 'usage-only';
export type WeeklyValueBasis =
  | 'quota-observation'
  | 'reset-aligned-usage'
  | 'calendar-usage';

export interface WeeklyQuotaObservation {
  provider: UsageProvider;
  seriesKey: string;
  seriesLabel?: string;
  observedAt: number;
  resetAt: number;
  usedPercent: number;
  sourceKey?: string;
  /** Account continuity carried by the schema-2 local observation store. Old
   * fixtures and migration rows may omit these fields and are treated as
   * low-information legacy evidence. */
  accountAttribution?: 'verified-local-signal' | 'profile-continuity' | 'unattributed';
  windowId?: string;
  observationConfidence?: 'high' | 'medium' | 'low';
  /** Optional independently known absolute percentage-point measurement error.
   * Never inferred from decimal formatting or the stored numeric type. */
  percentageErrorBound?: number;
  flags?: Array<
    | 'approximate-boundary'
    | 'low-log-coverage'
    | 'low-price-coverage'
    | 'account-ambiguous'
    | 'clock-anomaly'
  >;
}

export interface WeeklyEquivalentUsage {
  timestamp: number;
  equivalentUsd: number;
  pricedTokens: number;
  totalTokens: number;
  sourceKey?: string;
  /** Verified anonymous account ownership, never a file/profile/reset guess.
   * Current local-log adapters intentionally cannot populate this field. */
  accountSeriesKey?: string;
  /** Inclusive bounds of an aggregate represented by this row. Request-level
   * rows omit them; Codex daily rows use them to expose reset-boundary
   * uncertainty without inventing a proportional split. */
  intervalStart?: number;
  intervalEnd?: number;
}

export interface WeeklyValueInputs {
  /** Runtime file-local paired evidence; never account identity or daily interpolation. */
  codexQuotaCheckpoints?: readonly CodexQuotaCheckpoint[];
  /** Full retained local census: false on pending/evicted/ambiguous evidence.
   * Retained points still carry their independent per-segment completeness. */
  codexQuotaCheckpointsComplete?: boolean;
  /** Runtime-only original reset anchors whose local numerator may be incomplete.
   * Defined (including []) only when every omission can be localized to known
   * windows. Match with the existing reset-cluster tolerance. Undefined retains
   * the global completeness gate. Not account identity. */
  codexQuotaIncompleteResets?: readonly number[];
  /** Numeric uncertainty bounds. 0 is an unknown prefix; MAX_SAFE_INTEGER is
   * an open unknown tail, not an observed timestamp. Undefined fails globally. */
  codexQuotaIncompleteRanges?: readonly import('./providers/codex/codexQuotaCheckpoints').CodexQuotaIncompleteRange[];
  observations: WeeklyQuotaObservation[];
  usage: WeeklyEquivalentUsage[];
  /** Exact current rate snapshot, attached by the existing numeric Codex adapter. */
  calibrationPricebook?: CodexCalibrationPricebook;
  /** Runtime census only. Does not change usage totals or identify an account. */
  calibrationSourceScope?: { verified: boolean; excludedSourceKeys: readonly string[] };
  /** Known local indexing completeness, not complete account/device coverage. */
  localHistoryComplete?: boolean;
  /** Runtime-only proof of complete account-scoped usage for this exact window.
   * Missing proof fails closed; this is not inferred from indexed file counts. */
  accountUsageCoverage?: Array<{
    seriesKey: string;
    resetAt: number;
    from: number;
    through: number;
  }>;
}

export interface EquivalentCostBreakdown extends EquivalentUsageSummary {
  /** API-equivalent value of uncached input tokens. */
  freshInputUsd: number;
  /** API-equivalent value of cached-input reads. */
  cachedInputUsd: number;
  /** API-equivalent value of output tokens; reasoning is already a subset. */
  outputUsd: number;
}

export interface WeeklyValuePoint {
  provider: UsageProvider;
  seriesKey: string;
  seriesLabel?: string;
  windowStart: number;
  resetAt: number;
  current: boolean;
  usedEquivalentUsd: number;
  fullEquivalentUsd: number | null;
  unusedEquivalentUsd: number | null;
  utilizationPercent: number | null;
  pricingCoverage: number;
  observationGapMs: number | null;
  confidence: WeeklyValueConfidence;
  basis: WeeklyValueBasis;
  /** False only for a real quota window shown before any local usage exists. */
  usageAvailable?: boolean;
  /** The source aggregate spans a reset and cannot be split exactly. */
  boundaryUncertain?: boolean;
  /** Original quota sample metadata, not the time the dashboard was rendered. */
  observedAt?: number;
  observedResetAt?: number;
}

export interface WeeklyUsageHistoryOptions {
  now?: number;
  /** A real observed weekly reset used only to align seven-day buckets. */
  anchorResetAt?: number;
  seriesKey?: string;
  limit?: number;
}

export type WeeklyValueTimelineOptions = WeeklyUsageHistoryOptions;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function observationIdentity(observation: WeeklyQuotaObservation): string {
  return [
    observation.provider,
    observation.seriesKey,
    observation.resetAt,
    observation.usedPercent,
    observation.sourceKey ?? '',
    observation.windowId ?? '',
    observation.accountAttribution ?? '',
  ].join('|');
}

/**
 * Keep one latest sample for each percentage step in a reset window. This
 * preserves the observation closest to reset without writing one item per
 * quota poll. The bounded history contains no credentials or account names.
 */
export function appendWeeklyQuotaObservations(
  history: WeeklyQuotaObservation[],
  additions: WeeklyQuotaObservation[],
  limit = 512,
): WeeklyQuotaObservation[] {
  const compacted = new Map<string, WeeklyQuotaObservation>();
  for (const item of [...history, ...additions]) {
    if (
      !Number.isFinite(item.observedAt) ||
      !Number.isFinite(item.resetAt) ||
      !Number.isFinite(item.usedPercent) ||
      item.usedPercent < 0 || item.usedPercent > 100 ||
      item.resetAt <= 0
    ) {
      continue;
    }
    const normalized: WeeklyQuotaObservation = {
      ...item,
      usedPercent: item.usedPercent,
    };
    const key = observationIdentity(normalized);
    const previous = compacted.get(key);
    if (!previous || normalized.observedAt > previous.observedAt) {
      compacted.set(key, normalized);
    }
  }
  return [...compacted.values()]
    .sort((left, right) => left.observedAt - right.observedAt)
    .slice(-Math.max(1, Math.floor(limit)));
}

export function claudeWeeklyQuotaObservations(
  usage: ClaudeApiUsageResponse | null,
  profileKey: string,
  observedAt: number,
): WeeklyQuotaObservation[] {
  return normalizeQuotaWindows(usage)
    .filter((window) => window.kind === 'weekly_all')
    .flatMap((window) => {
      const resetAt = Date.parse(window.resetsAt);
      if (!Number.isFinite(resetAt) || resetAt <= 0) {
        return [];
      }
      return [{
        provider: 'claude' as const,
        seriesKey: profileKey,
        observedAt,
        resetAt,
        usedPercent: window.utilization,
      }];
    });
}

function tokenTotal(tokens: ProviderTokenCounts): number {
  return finiteNonNegative(tokens.inputTotal) + finiteNonNegative(tokens.outputTotal);
}

/** Current official API-equivalent value for a known model. Unknown models are
 * deliberately left unpriced instead of inheriting a family fallback. */
export function equivalentUsageFromProviderTokens(
  timestamp: number,
  model: string,
  tokens: ProviderTokenCounts,
  sourceKey?: string,
  intervalStart?: number,
  intervalEnd?: number,
): WeeklyEquivalentUsage {
  const cost = equivalentCostBreakdownFromProviderTokens(model, tokens);
  const interval = {
    ...(Number.isFinite(intervalStart) ? { intervalStart } : {}),
    ...(Number.isFinite(intervalEnd) ? { intervalEnd } : {}),
  };
  return {
    timestamp,
    equivalentUsd: cost.equivalentUsd,
    pricedTokens: cost.pricedTokens,
    totalTokens: cost.totalTokens,
    sourceKey,
    ...interval,
  };
}

/** Price one exact Codex model bucket into auditable API-equivalent segments.
 * Unknown models remain entirely unpriced. Cached input and reasoning are
 * subsets of input/output respectively, so neither is counted twice. */
export function equivalentCostBreakdownFromProviderTokens(
  model: string,
  tokens: ProviderTokenCounts,
): EquivalentCostBreakdown {
  const totalTokens = tokenTotal(tokens);
  const pricing = getExactModelPricing(model);
  if (!pricing) {
    return {
      equivalentUsd: 0,
      freshInputUsd: 0,
      cachedInputUsd: 0,
      outputUsd: 0,
      pricedTokens: 0,
      totalTokens,
      pricingCoverage: 0,
    };
  }
  const inputTotal = finiteNonNegative(tokens.inputTotal);
  const cachedInput = Math.min(
    inputTotal,
    finiteNonNegative(tokens.cachedInput ?? 0),
  );
  const freshInputUsd = (inputTotal - cachedInput) *
    finiteNonNegative(pricing.input_cost_per_token ?? 0);
  const cachedInputUsd = cachedInput *
    finiteNonNegative(pricing.cache_read_input_token_cost ?? 0);
  const outputUsd = finiteNonNegative(tokens.outputTotal) *
    finiteNonNegative(pricing.output_cost_per_token ?? 0);
  return {
    equivalentUsd: freshInputUsd + cachedInputUsd + outputUsd,
    freshInputUsd,
    cachedInputUsd,
    outputUsd,
    pricedTokens: totalTokens,
    totalTokens,
    pricingCoverage: totalTokens > 0 ? 1 : 0,
  };
}

export function claudeWeeklyEquivalentUsage(
  records: ClaudeUsageRecord[],
): WeeklyEquivalentUsage[] {
  const rows: WeeklyEquivalentUsage[] = [];
  for (const record of records) {
    if (record._isUserPrompt || record.isApiErrorMessage) {
      continue;
    }
    const model = record.message.model;
    const usage = record.message.usage;
    const timestamp = Date.parse(record.timestamp);
    if (!model || model === '<synthetic>' || !usage || !Number.isFinite(timestamp)) {
      continue;
    }
    const totalTokens =
      finiteNonNegative(usage.input_tokens) +
      finiteNonNegative(usage.output_tokens) +
      finiteNonNegative(usage.cache_creation_input_tokens ?? 0) +
      finiteNonNegative(usage.cache_read_input_tokens ?? 0);
    const pricing = getExactModelPricing(model);
    // Non-Claude proxy models do not consume an Anthropic subscription window.
    if (!pricing || !model.toLowerCase().includes('claude')) {
      rows.push({ timestamp, equivalentUsd: 0, pricedTokens: 0, totalTokens });
      continue;
    }
    rows.push({
      timestamp,
      equivalentUsd: calculateCostFromPricing(usage, pricing),
      pricedTokens: totalTokens,
      totalTokens,
    });
  }
  return rows;
}

interface ObservationCluster {
  provider: UsageProvider;
  seriesKey: string;
  seriesLabel?: string;
  resetAt: number;
  observations: WeeklyQuotaObservation[];
}

function clusterObservations(observations: WeeklyQuotaObservation[]): ObservationCluster[] {
  const clusters: ObservationCluster[] = [];
  const ordered = observations
    .filter((item) => Number.isFinite(item.resetAt) && item.resetAt > 0)
    .sort((left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.seriesKey.localeCompare(right.seriesKey) ||
      left.resetAt - right.resetAt ||
      left.observedAt - right.observedAt,
    );
  for (const observation of ordered) {
    const previous = clusters[clusters.length - 1];
    const previousWindowId = previous?.observations[0]?.windowId;
    const sameExplicitWindow = previousWindowId !== undefined || observation.windowId !== undefined
      ? previousWindowId !== undefined && previousWindowId === observation.windowId
      : true;
    if (
      previous &&
      previous.provider === observation.provider &&
      previous.seriesKey === observation.seriesKey &&
      sameExplicitWindow &&
      Math.abs(previous.observations[0].resetAt - observation.resetAt) <= RESET_CLUSTER_MS
    ) {
      previous.observations.push(observation);
      // Prefer the reset timestamp carried by the newest observation.
      if (
        observation.observedAt >=
        Math.max(...previous.observations.map((item) => item.observedAt))
      ) {
        previous.resetAt = observation.resetAt;
      }
      previous.seriesLabel ??= observation.seriesLabel;
      continue;
    }
    clusters.push({
      provider: observation.provider,
      seriesKey: observation.seriesKey,
      seriesLabel: observation.seriesLabel,
      resetAt: observation.resetAt,
      observations: [observation],
    });
  }
  return clusters;
}

function totals(rows: WeeklyEquivalentUsage[]): {
  equivalentUsd: number;
  pricedTokens: number;
  totalTokens: number;
} {
  return rows.reduce(
    (sum, row) => ({
      equivalentUsd: sum.equivalentUsd + finiteNonNegative(row.equivalentUsd),
      pricedTokens: sum.pricedTokens + finiteNonNegative(row.pricedTokens),
      totalTokens: sum.totalTokens + finiteNonNegative(row.totalTokens),
    }),
    { equivalentUsd: 0, pricedTokens: 0, totalTokens: 0 },
  );
}

export interface EquivalentUsageSummary {
  equivalentUsd: number;
  pricedTokens: number;
  totalTokens: number;
  pricingCoverage: number;
}

/** Aggregate exact-model API-equivalent rows without pricing unknown models. */
export function summarizeEquivalentUsage(
  rows: WeeklyEquivalentUsage[],
  expectedTotalTokens?: number,
): EquivalentUsageSummary {
  const summary = totals(rows);
  const totalTokens = Math.max(
    summary.totalTokens,
    finiteNonNegative(expectedTotalTokens ?? summary.totalTokens),
  );
  return {
    ...summary,
    totalTokens,
    pricingCoverage: totalTokens > 0
      ? Math.min(1, summary.pricedTokens / totalTokens)
      : 0,
  };
}

/** Aggregate exact-model cost segments while retaining the same conservative
 * pricing-coverage denominator used by weekly value and summary cards. */
export function summarizeEquivalentCostBreakdowns(
  rows: EquivalentCostBreakdown[],
  expectedTotalTokens?: number,
): EquivalentCostBreakdown {
  const summary = rows.reduce(
    (total, row) => ({
      equivalentUsd: total.equivalentUsd + finiteNonNegative(row.equivalentUsd),
      freshInputUsd: total.freshInputUsd + finiteNonNegative(row.freshInputUsd),
      cachedInputUsd: total.cachedInputUsd + finiteNonNegative(row.cachedInputUsd),
      outputUsd: total.outputUsd + finiteNonNegative(row.outputUsd),
      pricedTokens: total.pricedTokens + finiteNonNegative(row.pricedTokens),
      totalTokens: total.totalTokens + finiteNonNegative(row.totalTokens),
    }),
    {
      equivalentUsd: 0,
      freshInputUsd: 0,
      cachedInputUsd: 0,
      outputUsd: 0,
      pricedTokens: 0,
      totalTokens: 0,
    },
  );
  const totalTokens = Math.max(
    summary.totalTokens,
    finiteNonNegative(expectedTotalTokens ?? summary.totalTokens),
  );
  return {
    ...summary,
    totalTokens,
    pricingCoverage: totalTokens > 0
      ? Math.min(1, summary.pricedTokens / totalTokens)
      : 0,
  };
}

function nextCalendarWeekReset(timestamp: number): number {
  const date = new Date(timestamp);
  const dayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return dayStart - daysSinceMonday * 24 * 60 * 60 * 1000 + WEEK_MS;
}

function resetForTimestamp(timestamp: number, anchorResetAt?: number): {
  resetAt: number;
  basis: Extract<WeeklyValueBasis, 'reset-aligned-usage' | 'calendar-usage'>;
} {
  if (anchorResetAt !== undefined && Number.isFinite(anchorResetAt) && anchorResetAt > 0) {
    // Windows are [reset - 7d, reset). An event exactly on a reset therefore
    // belongs to the following window instead of being counted twice.
    const periods = Math.floor((timestamp - anchorResetAt) / WEEK_MS) + 1;
    return {
      resetAt: anchorResetAt + periods * WEEK_MS,
      basis: 'reset-aligned-usage',
    };
  }
  return { resetAt: nextCalendarWeekReset(timestamp), basis: 'calendar-usage' };
}

/**
 * Builds auditable history from token logs even when historical quota samples
 * do not exist. These rows intentionally expose only the API-equivalent value
 * already observed; total and unused allowance remain unknown.
 */
export function buildWeeklyUsageHistory(
  provider: UsageProvider,
  usage: WeeklyEquivalentUsage[],
  options: WeeklyUsageHistoryOptions = {},
): WeeklyValuePoint[] {
  const now = options.now ?? Date.now();
  const grouped = new Map<number, WeeklyEquivalentUsage[]>();
  const boundaryUncertainResets = new Set<number>();
  let basis: Extract<WeeklyValueBasis, 'reset-aligned-usage' | 'calendar-usage'> =
    options.anchorResetAt !== undefined ? 'reset-aligned-usage' : 'calendar-usage';
  for (const row of usage) {
    if (!Number.isFinite(row.timestamp) || row.timestamp > now) {
      continue;
    }
    const bucket = resetForTimestamp(row.timestamp, options.anchorResetAt);
    basis = bucket.basis;
    const rows = grouped.get(bucket.resetAt) ?? [];
    rows.push(row);
    grouped.set(bucket.resetAt, rows);
    if (
      provider === 'codex' &&
      options.anchorResetAt !== undefined &&
      Number.isFinite(row.intervalStart) &&
      Number.isFinite(row.intervalEnd) &&
      (row.intervalStart as number) < (row.intervalEnd as number)
    ) {
      const firstReset = resetForTimestamp(
        row.intervalStart as number,
        options.anchorResetAt,
      ).resetAt;
      const lastReset = resetForTimestamp(
        row.intervalEnd as number,
        options.anchorResetAt,
      ).resetAt;
      if (firstReset !== lastReset) {
        // The aggregate contains events on both sides of this boundary. Mark
        // both adjacent windows; the row remains unique but neither period is
        // presented as precise enough for allowance extrapolation.
        boundaryUncertainResets.add(firstReset);
        boundaryUncertainResets.add(lastReset);
      }
    }
  }
  const points = [...grouped.entries()].map(([resetAt, rows]): WeeklyValuePoint => {
    const used = totals(rows);
    return {
      provider,
      seriesKey: options.seriesKey ?? 'local-usage-history',
      windowStart: resetAt - WEEK_MS,
      resetAt,
      current: resetAt > now,
      usedEquivalentUsd: used.equivalentUsd,
      fullEquivalentUsd: null,
      unusedEquivalentUsd: null,
      utilizationPercent: null,
      pricingCoverage: used.totalTokens > 0
        ? Math.min(1, used.pricedTokens / used.totalTokens)
        : 0,
      observationGapMs: null,
      confidence: 'usage-only',
      basis,
      usageAvailable: true,
      boundaryUncertain: boundaryUncertainResets.has(resetAt),
    };
  });
  return points
    .sort((left, right) => right.resetAt - left.resetAt)
    .slice(0, Math.max(1, Math.floor(options.limit ?? 12)));
}

function latestClusterObservation(
  cluster: ObservationCluster,
  now: number,
): WeeklyQuotaObservation | undefined {
  const windowStart = cluster.resetAt - WEEK_MS;
  const eligible = cluster.observations
    .filter((item) =>
      Number.isFinite(item.observedAt) &&
      item.observedAt <= now &&
      item.observedAt >= windowStart &&
      // Windows are half-open. A sample written at the reset belongs to the
      // next window and must not decorate the one that just closed.
      item.observedAt < cluster.resetAt,
    )
    .sort((left, right) => left.observedAt - right.observedAt);
  return eligible[eligible.length - 1];
}

/** Identity of a quota sample does not prove ownership or completeness of token
 * logs. Both must be supplied independently before dividing by utilization.
 * This intentionally rejects today's unowned Codex and Claude log adapters. */
function canInferAllowance(
  inputs: WeeklyValueInputs,
  cluster: ObservationCluster,
  rows: WeeklyEquivalentUsage[],
  latest: WeeklyQuotaObservation,
  boundaryUncertain: boolean,
): boolean {
  if (boundaryUncertain || latest.usedPercent < 5 || latest.usedPercent >= 100) return false;
  const observations = cluster.observations
    .filter((row) => row.observedAt >= cluster.resetAt - WEEK_MS && row.observedAt <= latest.observedAt)
    .sort((a, b) => a.observedAt - b.observedAt);
  if (observations.some((row, index) =>
    row.accountAttribution !== 'verified-local-signal' ||
    !row.windowId || row.windowId !== latest.windowId ||
    (row.flags?.length ?? 0) > 0 ||
    (index > 0 && row.usedPercent < observations[index - 1].usedPercent)
  )) return false;
  const coverage = inputs.accountUsageCoverage?.find((item) =>
    item.seriesKey === cluster.seriesKey && item.resetAt === cluster.resetAt &&
    Number.isFinite(item.from) && item.from <= cluster.resetAt - WEEK_MS &&
    Number.isFinite(item.through) && item.through >= latest.observedAt
  );
  if (!coverage || rows.some((row) => row.accountSeriesKey !== cluster.seriesKey ||
    !Number.isFinite(row.totalTokens) || row.totalTokens < 0 ||
    !Number.isFinite(row.pricedTokens) || row.pricedTokens !== row.totalTokens ||
    !Number.isFinite(row.equivalentUsd) || row.equivalentUsd < 0 ||
    (row.intervalStart !== undefined && row.intervalEnd !== undefined &&
      row.intervalStart <= latest.observedAt && row.intervalEnd > latest.observedAt)
  )) return false;
  // A reset/identity transition overlapping this sample invalidates an older
  // certificate, including a counter reset that changed the weekly due date.
  if (inputs.observations.some((row) => row.provider === cluster.provider &&
    row.observedAt >= cluster.resetAt - WEEK_MS && row.observedAt <= latest.observedAt &&
    (row.seriesKey !== cluster.seriesKey || row.windowId !== latest.windowId ||
      row.resetAt !== latest.resetAt)
  )) return false;
  const observed = totals(rows.filter((row) => row.timestamp <= latest.observedAt));
  return observed.totalTokens > 0 && observed.pricedTokens === observed.totalTokens;
}

function alignedResetAt(resetAt: number, anchorResetAt: number): number | null {
  const periods = Math.round((resetAt - anchorResetAt) / WEEK_MS);
  const aligned = anchorResetAt + periods * WEEK_MS;
  return Math.abs(aligned - resetAt) <= RESET_CLUSTER_MS ? aligned : null;
}

interface AllowanceCandidateSummary {
  value: number;
  pricingCoverage: number;
  count: number;
  dispersed: boolean;
}

function evidenceWeight(
  observation: WeeklyQuotaObservation,
  pricingCoverage: number,
  boundaryApproximate: boolean,
  windowStart: number,
  periodEnd: number,
): number {
  const confidenceWeight = observation.observationConfidence === 'high'
    ? 1
    : observation.observationConfidence === 'medium'
      ? 0.8
      : observation.observationConfidence === 'low'
        ? 0.55
        : 0.7;
  const attributionWeight = observation.accountAttribution === 'verified-local-signal'
    ? 1
    : observation.accountAttribution === 'profile-continuity'
      ? 0.9
      : observation.accountAttribution === 'unattributed'
        ? 0.55
        : 0.7;
  const flags = new Set(observation.flags ?? []);
  const flagWeight =
    (flags.has('low-log-coverage') ? 0.6 : 1) *
    (flags.has('low-price-coverage') ? 0.7 : 1) *
    (flags.has('account-ambiguous') ? 0.4 : 1) *
    (flags.has('clock-anomaly') ? 0.5 : 1);
  const boundaryWeight = boundaryApproximate || flags.has('approximate-boundary')
    ? 0.55
    : 1;
  const span = Math.max(1, periodEnd - windowStart);
  const progress = Math.max(
    0,
    Math.min(1, (observation.observedAt - windowStart) / span),
  );
  const recencyWeight = 0.65 + 0.35 * progress;
  // Low coverage must lower confidence, not erase a mathematically valid
  // observation. Keep a small non-zero floor for partially priced prefixes.
  const coverageWeight = Math.max(0.05, Math.min(1, pricingCoverage));
  return confidenceWeight * attributionWeight * flagWeight *
    boundaryWeight * recencyWeight * coverageWeight;
}

function robustAllowanceCandidate(
  observations: WeeklyQuotaObservation[],
  rows: WeeklyEquivalentUsage[],
  windowStart: number,
  periodEnd: number,
  boundaryApproximate: boolean,
): AllowanceCandidateSummary | null {
  const candidates = observations.flatMap((observation) => {
    if (
      observation.observedAt < windowStart ||
      observation.observedAt > periodEnd ||
      observation.usedPercent <= 0 ||
      observation.usedPercent > 100
    ) {
      return [];
    }
    const observed = totals(rows.filter((row) => row.timestamp <= observation.observedAt));
    if (observed.equivalentUsd <= 0) {
      return [];
    }
    const pricingCoverage = observed.totalTokens > 0
      ? Math.min(1, observed.pricedTokens / observed.totalTokens)
      : 0;
    const value = observed.equivalentUsd / (observation.usedPercent / 100);
    if (!Number.isFinite(value) || value <= 0) {
      return [];
    }
    return [{
      value,
      pricingCoverage,
      weight: evidenceWeight(
        observation,
        pricingCoverage,
        boundaryApproximate,
        windowStart,
        periodEnd,
      ),
    }];
  }).sort((left, right) => left.value - right.value);
  if (candidates.length === 0) return null;
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  let accumulated = 0;
  let median = candidates[candidates.length - 1].value;
  for (const candidate of candidates) {
    accumulated += candidate.weight;
    if (accumulated >= totalWeight / 2) {
      median = candidate.value;
      break;
    }
  }
  const weightedCoverage = candidates.reduce(
    (sum, item) => sum + item.pricingCoverage * item.weight,
    0,
  ) / Math.max(Number.EPSILON, totalWeight);
  const minimum = candidates[0].value;
  const maximum = candidates[candidates.length - 1].value;
  return {
    value: median,
    pricingCoverage: weightedCoverage,
    count: candidates.length,
    dispersed: minimum > 0 && maximum / minimum > 2,
  };
}

/**
 * A quota sample can outlive the seven-day interval it describes. When that
 * is the only evidence left after a reset, falling back to Monday buckets would
 * put the new usage in a different period from the provider's actual window.
 * Recover the reset as an alignment hint only when every observed Codex reset
 * sits on the same seven-day sequence. This helper never supplies a quota
 * observation, so it cannot enable an allowance estimate on its own.
 */
function latestKnownCodexResetAnchor(
  observations: WeeklyQuotaObservation[],
  now: number,
): number | undefined {
  const candidates = observations
    .filter((item) =>
      item.provider === 'codex' &&
      Number.isFinite(item.observedAt) &&
      item.observedAt <= now &&
      Number.isFinite(item.resetAt) &&
      item.resetAt > 0,
    )
    .sort((left, right) =>
      right.observedAt - left.observedAt || right.resetAt - left.resetAt,
    );
  const latest = candidates[0];
  if (!latest) {
    return undefined;
  }
  return candidates.every((item) =>
    alignedResetAt(item.resetAt, latest.resetAt) !== null,
  )
    ? latest.resetAt
    : undefined;
}

/**
 * Builds the dashboard's one authoritative weekly timeline. Token-log usage is
 * first assigned to non-overlapping [start, reset) buckets exactly once. Quota
 * observations may then decorate their matching bucket with utilization and a
 * conservative allowance estimate; they never add a second usage row.
 *
 * File/profile keys and reset timestamps are not account identities. Local
 * history stays useful even when account ownership is unknown, but division by
 * a quota fraction additionally requires independent complete-window proof.
 * Never convert an unattributed mixed subtotal into a low-confidence balance.
 */
export function buildWeeklyValueTimeline(
  provider: UsageProvider,
  inputs: WeeklyValueInputs,
  options: WeeklyValueTimelineOptions = {},
): WeeklyValuePoint[] {
  const now = options.now ?? Date.now();
  const normalizedObservations = inputs.observations
    .filter((item) =>
      item.provider === provider &&
      Number.isFinite(item.observedAt) &&
      item.observedAt <= now &&
      Number.isFinite(item.resetAt) &&
      item.resetAt > 0 &&
      Number.isFinite(item.usedPercent) && item.usedPercent >= 0 && item.usedPercent <= 100,
    )
    .map((item) => ({
      ...item,
      usedPercent: item.usedPercent,
    }));
  const validClusters = clusterObservations(normalizedObservations)
    .map((cluster) => ({
      cluster,
      latest: latestClusterObservation(cluster, now),
    }))
    .filter((entry): entry is {
      cluster: ObservationCluster;
      latest: WeeklyQuotaObservation;
    } => entry.latest !== undefined);

  const anchorEntry = validClusters
    .slice()
    .sort((left, right) =>
      right.latest.observedAt - left.latest.observedAt ||
      right.cluster.resetAt - left.cluster.resetAt,
    )[0];
  // If the newest reset sample is older than its own seven-day window, it is
  // still useful for grouping usage after a rollover. It remains alignment-only
  // until a valid in-window sample exists, so no allowance is inferred here.
  const staleResetAnchor = !anchorEntry &&
    options.anchorResetAt === undefined &&
    provider === 'codex'
    ? latestKnownCodexResetAnchor(normalizedObservations, now)
    : undefined;
  const anchorResetAt = anchorEntry?.cluster.resetAt ??
    options.anchorResetAt ?? staleResetAnchor;
  const limit = Math.max(1, Math.floor(options.limit ?? 12));
  let history = buildWeeklyUsageHistory(provider, inputs.usage, {
    now,
    ...(anchorResetAt !== undefined ? { anchorResetAt } : {}),
    seriesKey: options.seriesKey ?? anchorEntry?.cluster.seriesKey,
    // Decorate before applying the public result limit.
    limit: Number.MAX_SAFE_INTEGER,
  });
  if (!anchorEntry || anchorResetAt === undefined) {
    return history.slice(0, limit);
  }

  if (
    anchorResetAt > now &&
    !history.some((point) => Math.abs(point.resetAt - anchorResetAt) <= RESET_CLUSTER_MS)
  ) {
    const quotaOnlyPoint: WeeklyValuePoint = {
      provider,
      seriesKey: options.seriesKey ?? anchorEntry.cluster.seriesKey,
      seriesLabel: anchorEntry.cluster.seriesLabel,
      windowStart: anchorResetAt - WEEK_MS,
      resetAt: anchorResetAt,
      current: true,
      usedEquivalentUsd: 0,
      fullEquivalentUsd: null,
      unusedEquivalentUsd: null,
      utilizationPercent: null,
      pricingCoverage: 0,
      observationGapMs: null,
      confidence: 'usage-only',
      basis: 'reset-aligned-usage',
      usageAvailable: false,
      boundaryUncertain: false,
    };
    history = [quotaOnlyPoint, ...history]
      .sort((left, right) => right.resetAt - left.resetAt);
  }

  type MappedObservation = {
    entry: typeof validClusters[number];
    resetAligned: boolean;
  };
  const historyByReset = new Map(history.map((point) => [point.resetAt, point]));
  const mappedObservations = new Map<number, MappedObservation[]>();
  for (const entry of validClusters) {
    const alignedReset = alignedResetAt(entry.cluster.resetAt, anchorResetAt);
    // An early/manual reset or another account's schedule is not an observation
    // of the nearest synthetic bucket. Never relabel it as that bucket's quota.
    const target = alignedReset === null ? undefined : historyByReset.get(alignedReset);
    if (!target) {
      continue;
    }
    const candidate: MappedObservation = {
      entry,
      resetAligned: alignedReset !== null,
    };
    const mapped = mappedObservations.get(target.resetAt) ?? [];
    mapped.push(candidate);
    mappedObservations.set(target.resetAt, mapped);
  }
  return history.map((point): WeeklyValuePoint => {
    const mappedEntries = mappedObservations.get(point.resetAt);
    if (!mappedEntries || mappedEntries.length === 0) {
      return point;
    }
    const mapped = [...mappedEntries].sort((left, right) =>
      left.entry.latest.observedAt - right.entry.latest.observedAt ||
      Number(left.resetAligned) - Number(right.resetAligned),
    )[mappedEntries.length - 1];
    const { entry, resetAligned } = mapped;
    const latest = entry.latest;
    const bucketRows = inputs.usage.filter((row) =>
      Number.isFinite(row.timestamp) &&
      row.timestamp <= now &&
      row.timestamp >= point.windowStart &&
      row.timestamp < point.resetAt,
    );
    // File keys are never an account-ownership filter. Independent per-row
    // proof must cover the entire displayed subtotal, not a convenient subset.
    const eligible = resetAligned && mappedEntries.length === 1 &&
      canInferAllowance(inputs, entry.cluster, bucketRows, latest, point.boundaryUncertain === true);
    const candidateSummary = eligible ? robustAllowanceCandidate(
      entry.cluster.observations,
      bucketRows,
      point.windowStart,
      Math.min(now, point.resetAt),
      !resetAligned || point.boundaryUncertain === true,
    ) : null;
    const observedPricingCoverage = candidateSummary?.pricingCoverage ?? 0;
    const observationGapMs = Math.max(
      0,
      (point.current ? now : point.resetAt) - latest.observedAt,
    );
    let fullEquivalentUsd: number | null = null;
    let observationOverrun = false;
    if (
      point.usageAvailable !== false &&
      candidateSummary !== null
    ) {
      fullEquivalentUsd = candidateSummary.value;
      if (!Number.isFinite(fullEquivalentUsd) || fullEquivalentUsd <= 0) {
        fullEquivalentUsd = null;
      } else if (point.usedEquivalentUsd > fullEquivalentUsd) {
        fullEquivalentUsd = null;
        observationOverrun = true;
      }
    }
    return {
      ...point,
      seriesKey: entry.cluster.seriesKey,
      seriesLabel: entry.cluster.seriesLabel,
      utilizationPercent: latest.usedPercent,
      observedAt: latest.observedAt,
      observedResetAt: latest.resetAt,
      fullEquivalentUsd,
      unusedEquivalentUsd:
        fullEquivalentUsd !== null && !observationOverrun
          ? Math.max(0, fullEquivalentUsd - point.usedEquivalentUsd)
          : null,
      observationGapMs,
      confidence: fullEquivalentUsd === null
        ? 'usage-only'
        : observationOverrun ||
          observedPricingCoverage < MIN_PRICED_SHARE ||
          candidateSummary?.dispersed === true
          ? 'low'
          : confidenceFor(point.current, observationGapMs, observedPricingCoverage),
      basis: 'quota-observation',
    };
  }).slice(0, limit);
}

/** Keep observed quota rows authoritative while filling older gaps from logs. */
export function mergeWeeklyValuePoints(
  observed: WeeklyValuePoint[],
  history: WeeklyValuePoint[],
  limit = 12,
): WeeklyValuePoint[] {
  const fallback = history.filter((candidate) => !observed.some((point) =>
    point.provider === candidate.provider &&
    Math.abs(point.resetAt - candidate.resetAt) <= RESET_CLUSTER_MS,
  ));
  return [...observed, ...fallback]
    .sort((left, right) => right.resetAt - left.resetAt)
    .slice(0, Math.max(1, Math.floor(limit)));
}

function confidenceFor(
  current: boolean,
  observationGapMs: number,
  pricingCoverage: number,
): WeeklyValueConfidence {
  if (pricingCoverage < MIN_PRICED_SHARE) {
    return 'low';
  }
  if (current) {
    return observationGapMs <= 6 * 60 * 60 * 1000 ? 'medium' : 'low';
  }
  if (observationGapMs <= 6 * 60 * 60 * 1000) {
    return 'high';
  }
  return observationGapMs <= 24 * 60 * 60 * 1000 ? 'medium' : 'low';
}

/**
 * Builds reset-aligned weekly points. The full-window figure is an audited
 * extrapolation: API-equivalent value accumulated by the last quota sample,
 * divided by that sample's utilization. It is omitted when utilization or
 * model-price coverage is too small to support the inference.
 */
export function buildWeeklyValueTrend(
  inputs: WeeklyValueInputs,
  now: number = Date.now(),
): WeeklyValuePoint[] {
  const points: WeeklyValuePoint[] = [];
  const clusters = clusterObservations(inputs.observations.filter((row) =>
    Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100));
  for (const cluster of clusters) {
    const windowStart = cluster.resetAt - WEEK_MS;
    const clusterSourceKeys = new Set(
      cluster.observations.flatMap((item) => item.sourceKey ? [item.sourceKey] : []),
    );
    const hasOverlappingCodexSeries = cluster.provider === 'codex' && clusters.some((other) =>
      {
        if (
          other === cluster ||
          other.provider !== cluster.provider ||
          windowStart >= other.resetAt ||
          other.resetAt - WEEK_MS >= cluster.resetAt
        ) {
          return false;
        }
        const otherSourceKeys = new Set(
          other.observations.flatMap((item) => item.sourceKey ? [item.sourceKey] : []),
        );
        const disjointExplicitSources = clusterSourceKeys.size > 0 && otherSourceKeys.size > 0 &&
          [...clusterSourceKeys].every((sourceKey) => !otherSourceKeys.has(sourceKey));
        return other.seriesKey !== cluster.seriesKey || disjointExplicitSources;
      },
    );
    const periodEnd = Math.min(now, cluster.resetAt);
    const latest = latestClusterObservation(cluster, now);
    if (!latest) {
      continue;
    }
    const sourceKeys = new Set(
      cluster.observations.flatMap((item) => item.sourceKey ? [item.sourceKey] : []),
    );
    const matchedUsage = inputs.usage.filter((row) =>
      row.timestamp >= windowStart &&
      row.timestamp <= now &&
      row.timestamp < cluster.resetAt &&
      (sourceKeys.size === 0 || (row.sourceKey !== undefined && sourceKeys.has(row.sourceKey))),
    );
    const used = totals(matchedUsage);
    if (used.totalTokens <= 0 && latest.usedPercent <= 0) {
      continue;
    }
    const observed = totals(matchedUsage.filter((row) => row.timestamp <= latest.observedAt));
    const observedPricingCoverage = observed.totalTokens > 0
      ? Math.min(1, observed.pricedTokens / observed.totalTokens)
      : 0;
    const pricingCoverage = used.totalTokens > 0
      ? Math.min(1, used.pricedTokens / used.totalTokens)
      : 0;
    const current = cluster.resetAt > now;
    const observationGapMs = Math.max(
      0,
      (current ? now : cluster.resetAt) - latest.observedAt,
    );
    let fullEquivalentUsd: number | null = null;
    let observationOverrun = false;
    if (
      !hasOverlappingCodexSeries &&
      canInferAllowance(inputs, cluster, matchedUsage, latest, matchedUsage.some((row) =>
        row.intervalStart !== undefined && row.intervalStart < windowStart)) &&
      latest.usedPercent > 0 &&
      observed.equivalentUsd > 0 &&
      latest.usedPercent <= 100
    ) {
      fullEquivalentUsd = observed.equivalentUsd / (latest.usedPercent / 100);
      if (!Number.isFinite(fullEquivalentUsd) || fullEquivalentUsd <= 0) {
        fullEquivalentUsd = null;
      } else if (used.equivalentUsd > fullEquivalentUsd) {
        // An overrun invalidates the extrapolation. Raising the inferred total
        // to match usage would invent a new capacity unsupported by any sample.
        fullEquivalentUsd = null;
        observationOverrun = true;
      }
    }
    points.push({
      provider: cluster.provider,
      seriesKey: cluster.seriesKey,
      seriesLabel: cluster.seriesLabel,
      windowStart,
      resetAt: cluster.resetAt,
      current,
      usedEquivalentUsd: used.equivalentUsd,
      fullEquivalentUsd,
      unusedEquivalentUsd:
        fullEquivalentUsd !== null && !observationOverrun
          ? Math.max(0, fullEquivalentUsd - used.equivalentUsd)
          : null,
      utilizationPercent: latest.usedPercent,
      observedAt: latest.observedAt,
      observedResetAt: latest.resetAt,
      pricingCoverage,
      observationGapMs,
      confidence: fullEquivalentUsd === null
        ? 'usage-only'
        : observationOverrun ||
          latest.accountAttribution === 'unattributed' ||
          (latest.flags ?? []).some((flag) =>
            flag === 'approximate-boundary' || flag === 'account-ambiguous'
          ) ||
          latest.usedPercent < 5 ||
          observedPricingCoverage < MIN_PRICED_SHARE
          ? 'low'
          : confidenceFor(current, observationGapMs, pricingCoverage),
      basis: 'quota-observation',
    });
  }
  return points.sort((left, right) => right.resetAt - left.resetAt).slice(0, 12);
}
