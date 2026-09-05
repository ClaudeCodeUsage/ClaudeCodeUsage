import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  appendWeeklyQuotaObservations,
  buildWeeklyUsageHistory,
  buildWeeklyValueTimeline,
  buildWeeklyValueTrend,
  equivalentCostBreakdownFromProviderTokens,
  equivalentUsageFromProviderTokens,
  mergeWeeklyValuePoints,
  summarizeEquivalentCostBreakdowns,
  summarizeEquivalentUsage,
  WeeklyEquivalentUsage,
  WeeklyQuotaObservation,
} from '../weeklyValue';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RESET = Date.parse('2026-08-21T12:00:00.000Z');

function observation(overrides: Partial<WeeklyQuotaObservation> = {}): WeeklyQuotaObservation {
  return {
    provider: 'codex',
    seriesKey: 'codex',
    observedAt: RESET - HOUR,
    resetAt: RESET,
    usedPercent: 75,
    ...overrides,
  };
}

function usage(
  equivalentUsd: number,
  timestamp: number,
  sourceKey?: string,
  interval?: { start: number; end: number },
): WeeklyEquivalentUsage {
  return {
    timestamp,
    equivalentUsd,
    pricedTokens: 1_000,
    totalTokens: 1_000,
    sourceKey,
    ...(interval ? { intervalStart: interval.start, intervalEnd: interval.end } : {}),
  };
}

test('completed reset window reports used, inferred full, and unused API-equivalent value', () => {
  const points = buildWeeklyValueTrend({
    observations: [observation()],
    usage: [
      usage(45, RESET - 2 * HOUR),
      usage(5, RESET - 30 * 60 * 1000),
    ],
  }, RESET + HOUR);

  assert.equal(points.length, 1);
  assert.equal(points[0].usedEquivalentUsd, 50);
  assert.equal(points[0].fullEquivalentUsd, 60);
  assert.equal(points[0].unusedEquivalentUsd, 10);
  assert.equal(points[0].utilizationPercent, 75);
  assert.equal(points[0].confidence, 'high');
});

test('current window is provisional and never presents unused allowance as final', () => {
  const points = buildWeeklyValueTrend({
    observations: [observation({ resetAt: RESET + DAY, observedAt: RESET, usedPercent: 50 })],
    usage: [usage(20, RESET - HOUR)],
  }, RESET + HOUR);

  assert.equal(points[0].current, true);
  assert.equal(points[0].fullEquivalentUsd, 40);
  assert.equal(points[0].unusedEquivalentUsd, null);
});

test('usage observed after a stale quota sample cannot exceed the displayed full allowance', () => {
  const points = buildWeeklyValueTrend({
    observations: [observation({ usedPercent: 50 })],
    usage: [
      usage(20, RESET - 2 * HOUR),
      usage(25, RESET - 30 * 60 * 1000),
    ],
  }, RESET + HOUR);

  assert.equal(points[0].usedEquivalentUsd, 45);
  assert.equal(points[0].fullEquivalentUsd, 45);
  assert.equal(points[0].unusedEquivalentUsd, 0);
  assert.equal(points[0].confidence, 'low');
});

test('tiny utilization and poor price coverage do not manufacture a full allowance value', () => {
  const lowUtilization = buildWeeklyValueTrend({
    observations: [observation({ usedPercent: 2 })],
    usage: [usage(20, RESET - 2 * HOUR)],
  }, RESET + HOUR);
  assert.equal(lowUtilization[0].fullEquivalentUsd, null);
  assert.equal(lowUtilization[0].confidence, 'usage-only');

  const partialPricing = buildWeeklyValueTrend({
    observations: [observation()],
    usage: [{
      timestamp: RESET - 2 * HOUR,
      equivalentUsd: 20,
      pricedTokens: 700,
      totalTokens: 1_000,
    }],
  }, RESET + HOUR);
  assert.equal(partialPricing[0].fullEquivalentUsd, null);
});

test('source keys keep overlapping Codex account windows from sharing usage', () => {
  const points = buildWeeklyValueTrend({
    observations: [
      observation({ resetAt: RESET, sourceKey: 'account-a-file', usedPercent: 50 }),
      observation({ resetAt: RESET + DAY, observedAt: RESET, sourceKey: 'account-b-file', usedPercent: 25 }),
    ],
    usage: [
      usage(40, RESET - 2 * HOUR, 'account-a-file'),
      usage(10, RESET - 2 * HOUR, 'account-b-file'),
    ],
  }, RESET + 2 * DAY);

  const accountA = points.find((point) => point.resetAt === RESET);
  const accountB = points.find((point) => point.resetAt === RESET + DAY);
  assert.equal(accountA?.usedEquivalentUsd, 40);
  assert.equal(accountB?.usedEquivalentUsd, 10);
});

test('quota history keeps the latest observation for each percentage step', () => {
  const compacted = appendWeeklyQuotaObservations([
    observation({ observedAt: RESET - 3 * HOUR }),
  ], [
    observation({ observedAt: RESET - HOUR }),
    observation({ observedAt: RESET - 30 * 60 * 1000, usedPercent: 80 }),
  ]);
  assert.equal(compacted.length, 2);
  assert.equal(compacted[0].observedAt, RESET - HOUR);
  assert.equal(compacted[1].usedPercent, 80);
});

test('known Codex models use exact current API prices and unknown models stay unpriced', () => {
  const tokens = {
    inputTotal: 2_000_000,
    cachedInput: 1_000_000,
    outputTotal: 1_000_000,
  };
  const sol = equivalentUsageFromProviderTokens(RESET, 'gpt-5.6-sol', tokens);
  // 1M uncached * $5 + 1M cached * $0.50 + 1M output * $30.
  assert.equal(sol.equivalentUsd, 35.5);
  assert.equal(sol.pricedTokens, 3_000_000);

  const unknown = equivalentUsageFromProviderTokens(RESET, 'codex-auto-review', tokens);
  assert.equal(unknown.equivalentUsd, 0);
  assert.equal(unknown.pricedTokens, 0);
  assert.equal(unknown.totalTokens, 3_000_000);

  const summary = summarizeEquivalentUsage([sol, unknown]);
  assert.equal(summary.equivalentUsd, 35.5);
  assert.equal(summary.pricedTokens, 3_000_000);
  assert.equal(summary.totalTokens, 6_000_000);
  assert.equal(summary.pricingCoverage, 0.5);

  const unattributedRemainder = summarizeEquivalentUsage([sol], 6_000_000);
  assert.equal(unattributedRemainder.equivalentUsd, 35.5);
  assert.equal(unattributedRemainder.totalTokens, 6_000_000);
  assert.equal(unattributedRemainder.pricingCoverage, 0.5);
});

test('Codex API-equivalent cost breakdown prices fresh cache-read and output buckets without charging reasoning twice', () => {
  const tokens = {
    inputTotal: 2_000_000,
    cachedInput: 1_000_000,
    outputTotal: 1_000_000,
    reasoningOutput: 750_000,
  };
  const priced = equivalentCostBreakdownFromProviderTokens(
    'gpt-5.6-sol',
    tokens,
  );

  assert.deepEqual(priced, {
    equivalentUsd: 35.5,
    freshInputUsd: 5,
    cachedInputUsd: 0.5,
    outputUsd: 30,
    pricedTokens: 3_000_000,
    totalTokens: 3_000_000,
    pricingCoverage: 1,
  });

  const unknown = equivalentCostBreakdownFromProviderTokens(
    'codex-auto-review',
    tokens,
  );
  const aggregate = summarizeEquivalentCostBreakdowns(
    [priced, unknown],
    6_000_000,
  );
  assert.deepEqual(aggregate, {
    equivalentUsd: 35.5,
    freshInputUsd: 5,
    cachedInputUsd: 0.5,
    outputUsd: 30,
    pricedTokens: 3_000_000,
    totalTokens: 6_000_000,
    pricingCoverage: 0.5,
  });
});

test('historical token logs still produce usage-only weekly values without quota observations', () => {
  const points = buildWeeklyUsageHistory('claude', [
    usage(12, Date.parse('2026-08-03T12:00:00.000Z')),
    usage(8, Date.parse('2026-08-04T12:00:00.000Z')),
    usage(30, Date.parse('2026-08-11T12:00:00.000Z')),
  ], {
    now: Date.parse('2026-08-22T12:00:00.000Z'),
  });

  assert.equal(points.length, 2);
  assert.deepEqual(
    points.map((point) => point.usedEquivalentUsd).sort((left, right) => left - right),
    [20, 30],
  );
  assert.ok(points.every((point) => point.fullEquivalentUsd === null));
  assert.ok(points.every((point) => point.unusedEquivalentUsd === null));
  assert.ok(points.every((point) => point.utilizationPercent === null));
  assert.ok(points.every((point) => point.confidence === 'usage-only'));
  assert.ok(points.every((point) => point.basis === 'calendar-usage'));
});

test('quota observations replace the matching fallback week without hiding older usage history', () => {
  const rows = [
    usage(10, RESET - 8 * DAY),
    usage(40, RESET - 2 * HOUR),
  ];
  const observed = buildWeeklyValueTrend({
    observations: [observation({ usedPercent: 50 })],
    usage: rows,
  }, RESET + HOUR);
  const history = buildWeeklyUsageHistory('codex', rows, {
    now: RESET + HOUR,
    anchorResetAt: RESET,
  });
  const merged = mergeWeeklyValuePoints(observed, history);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].resetAt, RESET);
  assert.equal(merged[0].basis, 'quota-observation');
  assert.equal(merged[0].fullEquivalentUsd, 80);
  assert.equal(merged[1].resetAt, RESET - 7 * DAY);
  assert.equal(merged[1].basis, 'reset-aligned-usage');
  assert.equal(merged[1].fullEquivalentUsd, null);
});

test('weekly timeline keeps only the latest current reset for one anonymous Codex series', () => {
  const now = Date.parse('2026-08-27T04:00:00.000Z');
  const olderReset = Date.parse('2026-08-31T00:00:00.000Z');
  const latestReset = Date.parse('2026-09-01T00:00:00.000Z');
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({ observedAt: now - 2 * DAY, resetAt: olderReset, usedPercent: 30 }),
      observation({ observedAt: now - HOUR, resetAt: latestReset, usedPercent: 43 }),
    ],
    usage: [
      usage(25, Date.parse('2026-08-24T12:00:00.000Z')),
      usage(40, Date.parse('2026-08-26T12:00:00.000Z')),
    ],
  }, { now });

  assert.equal(points.filter((point) => point.current).length, 1);
  assert.equal(points.find((point) => point.current)?.resetAt, latestReset);
  assert.equal(points.some((point) => point.resetAt === olderReset), false);
  assert.equal(points.reduce((sum, point) => sum + point.usedEquivalentUsd, 0), 65);
});

test('ambiguous overlapping Codex reset observations do not invent a combined allowance', () => {
  const now = Date.parse('2026-08-27T04:00:00.000Z');
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({
        observedAt: now - 2 * DAY,
        resetAt: Date.parse('2026-08-31T00:00:00.000Z'),
        usedPercent: 30,
        sourceKey: 'older-login',
      }),
      observation({
        observedAt: now - HOUR,
        resetAt: Date.parse('2026-09-01T00:00:00.000Z'),
        usedPercent: 43,
        sourceKey: 'latest-login',
      }),
    ],
    usage: [usage(40, now - 2 * HOUR, 'latest-login')],
  }, { now });

  const current = points.find((point) => point.current);
  assert.equal(current?.utilizationPercent, 43);
  assert.equal(current?.fullEquivalentUsd, null);
  assert.equal(current?.unusedEquivalentUsd, null);
  assert.equal(current?.confidence, 'usage-only');
});

test('different anonymous Codex series with overlapping current resets are still ambiguous', () => {
  const now = Date.parse('2026-08-27T04:00:00.000Z');
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({
        seriesKey: 'codex',
        observedAt: now - 2 * DAY,
        resetAt: Date.parse('2026-08-31T00:00:00.000Z'),
        usedPercent: 30,
      }),
      observation({
        seriesKey: 'main',
        observedAt: now - HOUR,
        resetAt: Date.parse('2026-09-01T00:00:00.000Z'),
        usedPercent: 43,
      }),
    ],
    usage: [usage(40, now - 2 * HOUR)],
  }, { now });

  const current = points.find((point) => point.current);
  assert.equal(current?.utilizationPercent, 43);
  assert.equal(current?.fullEquivalentUsd, null);
  assert.equal(current?.confidence, 'usage-only');
});

test('Codex allowance inference is withheld when combined usage has multiple log sources', () => {
  const now = RESET - HOUR;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({
      observedAt: now - HOUR,
      usedPercent: 50,
      sourceKey: 'observed-file',
    })],
    usage: [
      usage(20, now - 3 * HOUR, 'observed-file'),
      usage(30, now - 2 * HOUR, 'other-login-file'),
    ],
  }, { now });

  assert.equal(points[0].usedEquivalentUsd, 50);
  assert.equal(points[0].utilizationPercent, 50);
  assert.equal(points[0].fullEquivalentUsd, null);
  assert.equal(points[0].confidence, 'usage-only');
});

test('completed Codex periods remain usage-only because account attribution is unavailable', () => {
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({ sourceKey: 'one-file' })],
    usage: [usage(40, RESET - 2 * HOUR, 'one-file')],
  }, { now: RESET + HOUR });

  assert.equal(points[0].current, false);
  assert.equal(points[0].usedEquivalentUsd, 40);
  assert.equal(points[0].utilizationPercent, 75);
  assert.equal(points[0].fullEquivalentUsd, null);
  assert.equal(points[0].unusedEquivalentUsd, null);
  assert.equal(points[0].confidence, 'usage-only');
});

test('a daily Codex aggregate crossing a reset is marked approximate and cannot infer allowance', () => {
  const now = RESET + HOUR;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({
      resetAt: RESET + 7 * DAY,
      observedAt: now - 15 * 60 * 1000,
      usedPercent: 50,
      sourceKey: 'one-file',
    })],
    usage: [usage(40, now - 30 * 60 * 1000, 'one-file', {
      start: RESET - HOUR,
      end: now - 30 * 60 * 1000,
    })],
  }, { now, anchorResetAt: RESET });

  const affected = points.find((point) => point.resetAt === RESET + 7 * DAY);
  assert.equal(affected?.boundaryUncertain, true);
  assert.equal(affected?.fullEquivalentUsd, null);
  assert.equal(affected?.confidence, 'usage-only');
});

test('quota observations at the reset boundary do not decorate the closed period', () => {
  const points = buildWeeklyValueTimeline('claude', {
    observations: [observation({
      provider: 'claude',
      seriesKey: 'profile',
      observedAt: RESET,
      resetAt: RESET,
      usedPercent: 50,
    })],
    usage: [usage(20, RESET - HOUR)],
  }, { now: RESET + HOUR });

  assert.equal(points[0].basis, 'calendar-usage');
  assert.equal(points[0].utilizationPercent, null);
  assert.equal(points[0].fullEquivalentUsd, null);
});

test('timeline clamps finite utilization and ignores non-finite observations', () => {
  const now = RESET - HOUR;
  const clamped = buildWeeklyValueTimeline('claude', {
    observations: [observation({
      provider: 'claude',
      seriesKey: 'profile',
      observedAt: now - HOUR,
      usedPercent: 150,
    })],
    usage: [usage(20, now - 2 * HOUR)],
  }, { now });
  assert.equal(clamped[0].utilizationPercent, 100);
  assert.equal(clamped[0].fullEquivalentUsd, 20);

  const ignored = buildWeeklyValueTimeline('claude', {
    observations: [observation({
      provider: 'claude',
      seriesKey: 'profile',
      observedAt: now - HOUR,
      usedPercent: Number.NaN,
    })],
    usage: [usage(20, now - 2 * HOUR)],
  }, { now });
  assert.equal(ignored[0].basis, 'calendar-usage');
  assert.equal(ignored[0].utilizationPercent, null);
});

test('a current quota observation remains visible before any usage is indexed', () => {
  const now = RESET - HOUR;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({ observedAt: now - HOUR, usedPercent: 25 })],
    usage: [],
  }, { now });

  assert.equal(points.length, 1);
  assert.equal(points[0].current, true);
  assert.equal(points[0].usageAvailable, false);
  assert.equal(points[0].utilizationPercent, 25);
  assert.equal(points[0].fullEquivalentUsd, null);
});

test('weekly timeline assigns a reset-boundary usage row to the following period exactly once', () => {
  const now = RESET + DAY;
  const points = buildWeeklyValueTimeline('claude', {
    observations: [observation({
      provider: 'claude',
      seriesKey: 'profile',
      observedAt: RESET - HOUR,
    })],
    usage: [
      usage(10, RESET - HOUR),
      usage(20, RESET),
    ],
  }, { now });

  assert.equal(points.length, 2);
  assert.equal(points.find((point) => point.resetAt === RESET)?.usedEquivalentUsd, 10);
  assert.equal(points.find((point) => point.resetAt === RESET + 7 * DAY)?.usedEquivalentUsd, 20);
  assert.equal(points.reduce((sum, point) => sum + point.usedEquivalentUsd, 0), 30);
});

test('future-dated quota observations cannot anchor weekly history', () => {
  const now = RESET - DAY;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({
      observedAt: now + HOUR,
      resetAt: RESET + 7 * DAY,
      usedPercent: 50,
    })],
    usage: [usage(12, now - HOUR)],
  }, { now });

  assert.equal(points.length, 1);
  assert.equal(points[0].basis, 'calendar-usage');
  assert.equal(points[0].utilizationPercent, null);
  assert.equal(points[0].fullEquivalentUsd, null);
});
