import { calculateCostFromPricing, getExactModelPricing } from './pricing';
import { ClaudeApiUsageResponse, ClaudeUsageRecord } from './types';
import { normalizeQuotaWindows } from './quotaWindows';
import { ProviderTokenCounts, UsageProvider } from './providers/providerTypes';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_CLUSTER_MS = 5 * 60 * 1000;
const MIN_EXTRAPOLATION_PERCENT = 5;
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
}

export interface WeeklyEquivalentUsage {
  timestamp: number;
  equivalentUsd: number;
  pricedTokens: number;
  totalTokens: number;
  sourceKey?: string;
  /** Inclusive bounds of an aggregate represented by this row. Request-level
   * rows omit them; Codex daily rows use them to expose reset-boundary
   * uncertainty without inventing a proportional split. */
  intervalStart?: number;
  intervalEnd?: number;
}

export interface WeeklyValueInputs {
  observations: WeeklyQuotaObservation[];
  usage: WeeklyEquivalentUsage[];
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
      item.resetAt <= 0
    ) {
      continue;
    }
    const normalized: WeeklyQuotaObservation = {
      ...item,
      usedPercent: Math.min(100, Math.max(0, item.usedPercent)),
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
    if (
      previous &&
      previous.provider === observation.provider &&
      previous.seriesKey === observation.seriesKey &&
      Math.abs(previous.resetAt - observation.resetAt) <= RESET_CLUSTER_MS
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

function alignedResetAt(resetAt: number, anchorResetAt: number): number | null {
  const periods = Math.round((resetAt - anchorResetAt) / WEEK_MS);
  const aligned = anchorResetAt + periods * WEEK_MS;
  return Math.abs(aligned - resetAt) <= RESET_CLUSTER_MS ? aligned : null;
}

/**
 * Builds the dashboard's one authoritative weekly timeline. Token-log usage is
 * first assigned to non-overlapping [start, reset) buckets exactly once. Quota
 * observations may then decorate their matching bucket with utilization and a
 * conservative allowance estimate; they never add a second usage row.
 *
 * Codex logs do not expose a reliable account identity. Any overlapping,
 * non-aligned future reset makes the current allowance ambiguous regardless of
 * its label. Historical Codex periods and source-mixed current periods remain
 * usage-only rather than manufacturing an account split.
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
      Number.isFinite(item.usedPercent),
    )
    .map((item) => ({
      ...item,
      usedPercent: Math.min(100, Math.max(0, item.usedPercent)),
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
  const anchorResetAt = anchorEntry?.cluster.resetAt ?? options.anchorResetAt;
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

  const alignedClusters = new Map<number, typeof validClusters[number]>();
  for (const entry of validClusters) {
    if (entry.cluster.seriesKey !== anchorEntry.cluster.seriesKey) {
      continue;
    }
    const resetAt = alignedResetAt(entry.cluster.resetAt, anchorResetAt);
    if (resetAt === null) {
      continue;
    }
    const previous = alignedClusters.get(resetAt);
    if (!previous || entry.latest.observedAt > previous.latest.observedAt) {
      alignedClusters.set(resetAt, entry);
    }
  }
  const ambiguousCurrentCodexReset = provider === 'codex' && validClusters.some((entry) => {
    if (
      entry === anchorEntry ||
      entry.cluster.resetAt <= now ||
      alignedResetAt(entry.cluster.resetAt, anchorResetAt) !== null
    ) {
      return false;
    }
    const entryStart = entry.cluster.resetAt - WEEK_MS;
    const anchorStart = anchorResetAt - WEEK_MS;
    return entryStart < anchorResetAt && anchorStart < entry.cluster.resetAt;
  });

  return history.map((point): WeeklyValuePoint => {
    const entry = alignedClusters.get(point.resetAt);
    if (!entry) {
      return point;
    }
    const latest = entry.latest;
    const sourceKeys = new Set(
      entry.cluster.observations.flatMap((item) => item.sourceKey ? [item.sourceKey] : []),
    );
    const bucketRows = inputs.usage.filter((row) =>
      Number.isFinite(row.timestamp) &&
      row.timestamp <= now &&
      row.timestamp >= point.windowStart &&
      row.timestamp < point.resetAt,
    );
    const seriesRows = sourceKeys.size === 0
      ? bucketRows
      : bucketRows.filter((row) =>
          row.sourceKey !== undefined && sourceKeys.has(row.sourceKey),
        );
    const bucketSourceKeys = new Set(
      bucketRows.flatMap((row) => row.sourceKey ? [row.sourceKey] : []),
    );
    const hasMixedMissingObservationSource = sourceKeys.size > 0 &&
      entry.cluster.observations.some((item) => !item.sourceKey);
    const hasMixedMissingUsageSource = bucketSourceKeys.size > 0 &&
      bucketRows.some((row) => !row.sourceKey && finiteNonNegative(row.totalTokens) > 0);
    const codexSourceAttributionSafe = provider !== 'codex' || (
      (sourceKeys.size === 0 && bucketSourceKeys.size === 0) ||
      (
        !hasMixedMissingObservationSource &&
        !hasMixedMissingUsageSource &&
        sourceKeys.size === 1 &&
        bucketSourceKeys.size === 1 &&
        [...bucketSourceKeys].every((sourceKey) => sourceKeys.has(sourceKey))
      )
    );
    const observed = totals(seriesRows.filter((row) => row.timestamp <= latest.observedAt));
    const seriesTotal = totals(seriesRows);
    const seriesPricingCoverage = seriesTotal.totalTokens > 0
      ? Math.min(1, seriesTotal.pricedTokens / seriesTotal.totalTokens)
      : 0;
    const observationGapMs = Math.max(
      0,
      (point.current ? now : point.resetAt) - latest.observedAt,
    );
    const withholdInference = provider === 'codex' && (
      !point.current ||
      Math.abs(point.resetAt - anchorResetAt) > RESET_CLUSTER_MS ||
      ambiguousCurrentCodexReset ||
      !codexSourceAttributionSafe ||
      point.boundaryUncertain === true
    );
    let fullEquivalentUsd: number | null = null;
    let observationOverrun = false;
    if (
      !withholdInference &&
      point.usageAvailable !== false &&
      latest.usedPercent >= MIN_EXTRAPOLATION_PERCENT &&
      observed.equivalentUsd > 0 &&
      seriesPricingCoverage >= MIN_PRICED_SHARE
    ) {
      fullEquivalentUsd = observed.equivalentUsd / (latest.usedPercent / 100);
      if (!Number.isFinite(fullEquivalentUsd) || fullEquivalentUsd <= 0) {
        fullEquivalentUsd = null;
      } else if (point.usedEquivalentUsd > fullEquivalentUsd) {
        fullEquivalentUsd = point.usedEquivalentUsd;
        observationOverrun = true;
      }
    }
    return {
      ...point,
      seriesKey: entry.cluster.seriesKey,
      seriesLabel: entry.cluster.seriesLabel,
      utilizationPercent: latest.usedPercent,
      fullEquivalentUsd,
      unusedEquivalentUsd:
        !point.current && fullEquivalentUsd !== null
          ? Math.max(0, fullEquivalentUsd - point.usedEquivalentUsd)
          : null,
      observationGapMs,
      confidence: fullEquivalentUsd === null
        ? 'usage-only'
        : observationOverrun
          ? 'low'
          : confidenceFor(point.current, observationGapMs, point.pricingCoverage),
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
  for (const cluster of clusterObservations(inputs.observations)) {
    const windowStart = cluster.resetAt - WEEK_MS;
    const periodEnd = Math.min(now, cluster.resetAt);
    const eligibleObservations = cluster.observations
      .filter((item) => item.observedAt >= windowStart && item.observedAt <= periodEnd)
      .sort((left, right) => left.observedAt - right.observedAt);
    const latest = eligibleObservations[eligibleObservations.length - 1];
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
      latest.usedPercent >= MIN_EXTRAPOLATION_PERCENT &&
      observed.equivalentUsd > 0 &&
      pricingCoverage >= MIN_PRICED_SHARE
    ) {
      fullEquivalentUsd = observed.equivalentUsd / (latest.usedPercent / 100);
      if (!Number.isFinite(fullEquivalentUsd) || fullEquivalentUsd <= 0) {
        fullEquivalentUsd = null;
      } else if (used.equivalentUsd > fullEquivalentUsd) {
        // A quota sample can be older than the newest local usage. Never show a
        // total allowance below usage already observed, and surface the stale
        // inference through low confidence instead of implying false precision.
        fullEquivalentUsd = used.equivalentUsd;
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
        !current && fullEquivalentUsd !== null
          ? Math.max(0, fullEquivalentUsd - used.equivalentUsd)
          : null,
      utilizationPercent: latest.usedPercent,
      pricingCoverage,
      observationGapMs,
      confidence: fullEquivalentUsd === null
        ? 'usage-only'
        : observationOverrun
          ? 'low'
          : confidenceFor(current, observationGapMs, pricingCoverage),
      basis: 'quota-observation',
    });
  }
  return points.sort((left, right) => right.resetAt - left.resetAt).slice(0, 12);
}
