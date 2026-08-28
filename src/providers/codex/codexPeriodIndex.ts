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
}

export interface CodexHourlySlice {
  total: ProviderTokenCounts;
  byModel: Record<string, ProviderTokenCounts>;
}

/**
 * Deliberately ephemeral across civil days: only one target day is persisted,
 * and empty hours do not consume index space.
 */
export interface CodexFileTodayIndex {
  day: string;
  timeZone: string;
  indexedThrough: number;
  hours: Record<string, CodexHourlySlice>;
}

export interface CodexTodayMigrationState extends CodexJsonlCursor {
  day: string;
  timeZone: string;
  prefixEvents: number;
  tokenEventsSeen: number;
  parserState: CodexParserState;
  hours: Record<string, CodexHourlySlice>;
  qualityFlags: string[];
}

export interface CodexPeriodMigrationState extends CodexJsonlCursor {
  timeZone: string;
  parserState: CodexParserState;
  days: Record<string, CodexDailySlice>;
  qualityFlags: string[];
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
