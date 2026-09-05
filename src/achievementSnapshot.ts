import { UsageProvider } from './providers/providerTypes';

export type AchievementPeriod = '7d' | '30d' | 'all';

export interface AchievementEvidenceInput {
  provider: UsageProvider;
  period: AchievementPeriod;
  processedTokens: number;
  freshTokens: number;
  outputTokens: number;
  sessions: number;
  activeDays: number;
  cacheShare?: number;
  childFreshShare?: number;
  highEffortFreshShare?: number;
}

export interface AchievementEvidence {
  schemaVersion: 1;
  provider: UsageProvider;
  period: AchievementPeriod;
  metrics: {
    processedTokens: number;
    freshTokens: number;
    outputTokens: number;
    sessions: number;
    activeDays: number;
    cacheShareBps?: number;
    childFreshShareBps?: number;
    highEffortFreshShareBps?: number;
  };
}

export interface CommunityBenchmarkCandidate {
  schemaVersion: 1;
  provider: UsageProvider;
  period: AchievementPeriod;
  bands: {
    processedTokens: string;
    freshTokens: string;
    outputTokens: string;
    sessions: string;
    activeDays: string;
    cacheSharePct?: number;
    childFreshSharePct?: number;
    highEffortFreshSharePct?: number;
  };
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function shareBasisPoints(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000);
}

export function buildAchievementEvidence(
  input: AchievementEvidenceInput,
): AchievementEvidence {
  const metrics: AchievementEvidence['metrics'] = {
    processedTokens: nonNegativeInteger(input.processedTokens),
    freshTokens: nonNegativeInteger(input.freshTokens),
    outputTokens: nonNegativeInteger(input.outputTokens),
    sessions: nonNegativeInteger(input.sessions),
    activeDays: nonNegativeInteger(input.activeDays),
  };
  const optionalShares = [
    ['cacheShareBps', input.cacheShare],
    ['childFreshShareBps', input.childFreshShare],
    ['highEffortFreshShareBps', input.highEffortFreshShare],
  ] as const;
  for (const [key, value] of optionalShares) {
    const normalized = shareBasisPoints(value);
    if (normalized !== undefined) metrics[key] = normalized;
  }
  return {
    schemaVersion: 1,
    provider: input.provider,
    period: input.period,
    metrics,
  };
}

function band(value: number, boundaries: Array<[number, string]>, overflow: string): string {
  for (const [upperExclusive, label] of boundaries) {
    if (value < upperExclusive) return label;
  }
  return overflow;
}

function tokenBand(value: number): string {
  if (value === 0) return '0';
  return band(value, [
    [100_000, '1-100k'],
    [500_000, '100k-500k'],
    [1_000_000, '500k-1m'],
    [5_000_000, '1m-5m'],
    [10_000_000, '5m-10m'],
    [50_000_000, '10m-50m'],
  ], '50m+');
}

function sessionBand(value: number): string {
  if (value === 0) return '0';
  return band(value, [
    [5, '1-4'],
    [10, '5-9'],
    [25, '10-24'],
    [50, '25-49'],
  ], '50+');
}

function activeDayBand(value: number): string {
  if (value === 0) return '0';
  return band(value, [
    [3, '1-2'],
    [5, '3-4'],
    [7, '5-6'],
    [14, '7-13'],
    [30, '14-29'],
  ], '30+');
}

function coarsePercent(basisPoints: number | undefined): number | undefined {
  return basisPoints === undefined ? undefined : Math.round(basisPoints / 1_000) * 10;
}

export function buildCommunityBenchmarkCandidate(
  evidence: AchievementEvidence,
): CommunityBenchmarkCandidate {
  const { metrics } = evidence;
  const bands: CommunityBenchmarkCandidate['bands'] = {
    processedTokens: tokenBand(metrics.processedTokens),
    freshTokens: tokenBand(metrics.freshTokens),
    outputTokens: tokenBand(metrics.outputTokens),
    sessions: sessionBand(metrics.sessions),
    activeDays: activeDayBand(metrics.activeDays),
  };
  const optionalShares = [
    ['cacheSharePct', metrics.cacheShareBps],
    ['childFreshSharePct', metrics.childFreshShareBps],
    ['highEffortFreshSharePct', metrics.highEffortFreshShareBps],
  ] as const;
  for (const [key, value] of optionalShares) {
    const normalized = coarsePercent(value);
    if (normalized !== undefined) bands[key] = normalized;
  }
  return {
    schemaVersion: 1,
    provider: evidence.provider,
    period: evidence.period,
    bands,
  };
}
