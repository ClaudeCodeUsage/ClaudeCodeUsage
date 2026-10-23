import { dayKeyInZone, hourKeyInZone } from '../../dateKeys';
import {
  NormalizedUsageEvent,
  ProviderTokenCounts,
} from '../providerTypes';
import { CodexJsonlCursor } from './codexJsonlScanner';
import { CodexParserState, CodexStructuralEvent } from './codexParser';

export interface CodexStructuralSummary {
  patchCalls: number;
  toolCalls: number;
  postPatchToolCalls: number;
  compactCount: number;
  taskCompleteCount: number;
}

export interface CodexDailySlice {
  total: ProviderTokenCounts;
  byModel: Record<string, ProviderTokenCounts>;
  byEffort: Record<string, ProviderTokenCounts>;
  structural: CodexStructuralSummary;
  firstObservedAt?: number;
  lastObservedAt?: number;
}

export interface CodexFilePeriodIndex {
  timeZone: string;
  indexedThrough: number;
  days: Record<string, CodexDailySlice>;
  /** Semantic marker for period data produced after lineage filtering. */
  lineageVersion?: number;
  /** The lineage prefix excluded while this period was built. */
  lineagePrefixEvents?: number;
}

export interface CodexHourlySlice {
  total: ProviderTokenCounts;
  byModel: Record<string, ProviderTokenCounts>;
}

export const CODEX_ROLLING_HOURLY_DAYS = 30;

/** Sparse local civil-day -> hour buckets. Empty dates and hours are omitted. */
export type CodexHourlyDays = Record<
  string,
  Record<string, CodexHourlySlice>
>;

/**
 * The historic `day` / `hours` fields remain as the current-day compatibility
 * projection. New indexes also persist `days`, a sparse rolling window whose
 * semantic width is identified by `windowDays`.
 */
export interface CodexFileTodayIndex {
  day: string;
  timeZone: string;
  indexedThrough: number;
  hours: Record<string, CodexHourlySlice>;
  /** Missing on v2.3.0 one-day sidecars and therefore migration-required. */
  windowDays?: number;
  /** Missing on v2.3.0 one-day sidecars and therefore migration-required. */
  days?: CodexHourlyDays;
}

export interface CodexTodayMigrationState extends CodexJsonlCursor {
  day: string;
  timeZone: string;
  prefixEvents: number;
  tokenEventsSeen: number;
  parserState: CodexParserState;
  hours: Record<string, CodexHourlySlice>;
  /** Missing on v2.3.0 drafts; a missing value restarts the bounded pass. */
  windowDays?: number;
  /** Sparse rolling buckets checkpointed with the existing file cursor. */
  days?: CodexHourlyDays;
  qualityFlags: string[];
}

export interface CodexPeriodMigrationState extends CodexJsonlCursor {
  quotaCheckpoints?: import('./codexQuotaCheckpoints').CodexQuotaCheckpointState;
  timeZone: string;
  /** Missing on pre-fix drafts; those drafts must restart from byte zero. */
  prefixEvents?: number;
  /** Number of lineage token events consumed by the resumable cursor. */
  tokenEventsSeen?: number;
  parserState: CodexParserState;
  days: Record<string, CodexDailySlice>;
  qualityFlags: string[];
}

/** Increment when the period lineage filtering algorithm changes. */
export const CODEX_PERIOD_LINEAGE_VERSION = 1;

export function isCurrentCodexPeriodLineage(
  period: CodexFilePeriodIndex | undefined,
  prefixEvents: number,
): boolean {
  return Boolean(
    period &&
    period.lineageVersion === CODEX_PERIOD_LINEAGE_VERSION &&
    period.lineagePrefixEvents === Math.max(0, Math.floor(prefixEvents)),
  );
}

/**
 * Pre-fix schema-3 indexes did not carry a lineage marker. A bounded
 * aggregate-size check can still safely read those legacy slices; once a
 * marker exists, it must match the current filtering algorithm exactly.
 */
export function isCompatibleCodexPeriodLineage(
  period: CodexFilePeriodIndex | undefined,
  prefixEvents: number,
): boolean {
  if (!period) {
    return false;
  }
  const hasMarker =
    period.lineageVersion !== undefined ||
    period.lineagePrefixEvents !== undefined;
  return !hasMarker || isCurrentCodexPeriodLineage(period, prefixEvents);
}

const TOKEN_FIELDS = [
  'inputTotal',
  'cachedInput',
  'cacheWriteInput',
  'outputTotal',
  'reasoningOutput',
  'sourceTotal',
] as const;

type TokenField = (typeof TOKEN_FIELDS)[number];

function tokenValue(tokens: ProviderTokenCounts, field: TokenField): number {
  const value = tokens[field];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function tokenShapeIsValid(tokens: ProviderTokenCounts): boolean {
  return TOKEN_FIELDS.every((field) => {
    const value = tokens[field];
    return value === undefined ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0);
  });
}

function sumTokenBuckets(
  buckets: readonly ProviderTokenCounts[],
): ProviderTokenCounts {
  const total: ProviderTokenCounts = {
    inputTotal: 0,
    cachedInput: 0,
    cacheWriteInput: 0,
    outputTotal: 0,
    reasoningOutput: 0,
    sourceTotal: 0,
  };
  for (const bucket of buckets) {
    for (const field of TOKEN_FIELDS) {
      total[field] = tokenValue(total, field) + tokenValue(bucket, field);
    }
  }
  return total;
}

function tokensFitWithin(
  actual: ProviderTokenCounts,
  allowed: ProviderTokenCounts,
): boolean {
  if (!tokenShapeIsValid(actual) || !tokenShapeIsValid(allowed)) {
    return false;
  }
  // Older persisted DTOs legitimately omit optional buckets such as
  // reasoningOutput, sourceTotal, or cacheWriteInput. An omitted allowance is
  // unknown, not zero; constraining it to zero would reject otherwise valid
  // legacy period projections and make the reader fall back unnecessarily.
  return TOKEN_FIELDS.every((field) => {
    if (allowed[field] === undefined) {
      return true;
    }
    return tokenValue(actual, field) <= tokenValue(allowed, field);
  });
}

/**
 * A period is a subset of a file's all-time aggregate. This inexpensive
 * invariant lets readers reject old/replayed sidecars immediately, before a
 * background rebuild has finished.
 */
export function codexPeriodFitsAggregate(
  period: CodexFilePeriodIndex | undefined,
  aggregateTotal: ProviderTokenCounts,
): boolean {
  if (!period || !tokenShapeIsValid(aggregateTotal)) {
    return false;
  }
  const periodTotal = sumTokenBuckets(
    Object.values(period.days).map((slice) => slice.total),
  );
  if (!tokensFitWithin(periodTotal, aggregateTotal)) {
    return false;
  }
  return Object.values(period.days).every((slice) =>
    tokenShapeIsValid(slice.total) &&
    tokensFitWithin(
      sumTokenBuckets(Object.values(slice.byModel)),
      slice.total,
    ) &&
    tokensFitWithin(
      sumTokenBuckets(Object.values(slice.byEffort)),
      slice.total,
    ),
  );
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

function emptyStructural(): CodexStructuralSummary {
  return {
    patchCalls: 0,
    toolCalls: 0,
    postPatchToolCalls: 0,
    compactCount: 0,
    taskCompleteCount: 0,
  };
}

function emptySlice(): CodexDailySlice {
  return {
    total: zeroTokens(),
    byModel: {},
    byEffort: {},
    structural: emptyStructural(),
  };
}

function emptyHourlySlice(): CodexHourlySlice {
  return { total: zeroTokens(), byModel: {} };
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

function tokenBucket(
  buckets: Record<string, ProviderTokenCounts>,
  key: string,
): ProviderTokenCounts {
  return (buckets[key] ??= zeroTokens());
}

function sliceFor(
  days: Record<string, CodexDailySlice>,
  timestamp: number,
  timeZone: string,
): CodexDailySlice | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  const key = dayKeyInZone(new Date(timestamp), timeZone);
  return key ? (days[key] ??= emptySlice()) : undefined;
}

function observe(slice: CodexDailySlice, timestamp: number): void {
  slice.firstObservedAt = Math.min(slice.firstObservedAt ?? timestamp, timestamp);
  slice.lastObservedAt = Math.max(slice.lastObservedAt ?? timestamp, timestamp);
}

export function reduceCodexUsageSlice(
  days: Record<string, CodexDailySlice>,
  event: NormalizedUsageEvent,
  timeZone: string,
): void {
  const slice = sliceFor(days, event.timestamp, timeZone);
  if (!slice) {
    return;
  }
  addTokens(slice.total, event.tokens);
  addTokens(tokenBucket(slice.byModel, event.model ?? 'unknown'), event.tokens);
  addTokens(tokenBucket(slice.byEffort, event.effort ?? 'unknown'), event.tokens);
  observe(slice, event.timestamp);
}

export function reduceCodexHourlySlice(
  hours: Record<string, CodexHourlySlice>,
  event: NormalizedUsageEvent,
  day: string,
  timeZone: string,
): void {
  if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
    return;
  }
  const instant = new Date(event.timestamp);
  if (dayKeyInZone(instant, timeZone) !== day) {
    return;
  }
  const hour = hourKeyInZone(instant, timeZone);
  if (!/^(?:[01]\d|2[0-3])$/.test(hour)) {
    return;
  }
  const slice = (hours[hour] ??= emptyHourlySlice());
  addTokens(slice.total, event.tokens);
  addTokens(tokenBucket(slice.byModel, event.model ?? 'unknown'), event.tokens);
}

/**
 * Add an event to a precomputed rolling civil-day window. Callers construct
 * `allowedDays` once per file pass so multi-gigabyte backfills do not rebuild a
 * 30-day set for every JSONL event.
 */
export function reduceCodexRollingHourlySlice(
  days: CodexHourlyDays,
  event: NormalizedUsageEvent,
  allowedDays: ReadonlySet<string>,
  timeZone: string,
): void {
  if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
    return;
  }
  const day = dayKeyInZone(new Date(event.timestamp), timeZone);
  if (!allowedDays.has(day)) {
    return;
  }
  const hours = (days[day] ??= {});
  reduceCodexHourlySlice(hours, event, day, timeZone);
  if (Object.keys(hours).length === 0) {
    delete days[day];
  }
}

/** Mutate a sparse rolling map in place, discarding every out-of-window day. */
export function pruneCodexHourlyDays(
  days: CodexHourlyDays,
  allowedDays: ReadonlySet<string>,
): void {
  for (const day of Object.keys(days)) {
    if (!allowedDays.has(day)) {
      delete days[day];
    }
  }
}

export function reduceCodexStructuralSlice(
  days: Record<string, CodexDailySlice>,
  event: CodexStructuralEvent,
  timeZone: string,
): void {
  const slice = sliceFor(days, event.timestamp, timeZone);
  if (!slice) {
    return;
  }
  const count = Math.max(0, event.count ?? 1);
  if (event.kind === 'patch') {
    slice.structural.patchCalls += count;
  } else if (event.kind === 'tool') {
    slice.structural.toolCalls += count;
    if (Object.values(days).some((day) => day.structural.patchCalls > 0)) {
      slice.structural.postPatchToolCalls += count;
    }
  } else if (event.kind === 'compaction') {
    slice.structural.compactCount += count;
  } else if (event.kind === 'task-complete') {
    slice.structural.taskCompleteCount += count;
  }
  observe(slice, event.timestamp);
}
