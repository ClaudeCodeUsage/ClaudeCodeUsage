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

test('current window presents a provisional unused API-equivalent estimate', () => {
  const points = buildWeeklyValueTrend({
    observations: [observation({ resetAt: RESET + DAY, observedAt: RESET, usedPercent: 50 })],
    usage: [usage(20, RESET - HOUR)],
  }, RESET + HOUR);

  assert.equal(points[0].current, true);
  assert.equal(points[0].fullEquivalentUsd, 40);
  assert.equal(points[0].unusedEquivalentUsd, 20);
  assert.equal(points[0].confidence, 'medium');
});

test('legacy trend keeps an unattributed or approximate unused value visibly low-confidence', () => {
  for (const overrides of [
    { accountAttribution: 'unattributed' as const },
    { flags: ['account-ambiguous' as const] },
    { flags: ['approximate-boundary' as const] },
  ]) {
    const points = buildWeeklyValueTrend({
      observations: [observation(overrides)],
      usage: [usage(45, RESET - 2 * HOUR)],
    }, RESET + HOUR);
    assert.equal(points[0].fullEquivalentUsd, 60);
    assert.equal(points[0].unusedEquivalentUsd, 15);
    assert.equal(points[0].confidence, 'low');
  }
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
  assert.equal(points[0].unusedEquivalentUsd, null);
  assert.equal(points[0].confidence, 'low');
});

test('valid tiny utilization and partial pricing still produce a low-confidence total estimate', () => {
  const lowUtilization = buildWeeklyValueTrend({
    observations: [observation({ usedPercent: 2 })],
    usage: [usage(20, RESET - 2 * HOUR)],
  }, RESET + HOUR);
  assert.equal(lowUtilization[0].fullEquivalentUsd, 1_000);
  assert.equal(lowUtilization[0].confidence, 'low');

  const partialPricing = buildWeeklyValueTrend({
    observations: [observation()],
    usage: [{
      timestamp: RESET - 2 * HOUR,
      equivalentUsd: 20,
      pricedTokens: 700,
      totalTokens: 1_000,
    }],
  }, RESET + HOUR);
  assert.equal(partialPricing[0].fullEquivalentUsd, 20 / 0.75);
  assert.equal(partialPricing[0].unusedEquivalentUsd, (20 / 0.75) - 20);
  assert.equal(partialPricing[0].confidence, 'low');
});

test('pricing coverage after the observation cannot inflate confidence for an underpriced prefix', () => {
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({ usedPercent: 50 })],
    usage: [
      {
        timestamp: RESET - 2 * HOUR,
        equivalentUsd: 1,
        pricedTokens: 1,
        totalTokens: 1_000,
      },
      {
        timestamp: RESET - 30 * 60 * 1000,
        equivalentUsd: 99,
        pricedTokens: 9_000,
        totalTokens: 9_000,
      },
    ],
  }, { now: RESET + HOUR });

  assert.ok(points[0].pricingCoverage > 0.8);
  assert.equal(points[0].utilizationPercent, 50);
  assert.equal(points[0].fullEquivalentUsd, 100);
  assert.equal(points[0].unusedEquivalentUsd, null);
  assert.equal(points[0].confidence, 'low');
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
  assert.equal(accountA?.fullEquivalentUsd, null);
  assert.equal(accountA?.unusedEquivalentUsd, null);
  assert.equal(accountB?.fullEquivalentUsd, null);
  assert.equal(accountB?.unusedEquivalentUsd, null);
  assert.equal(accountA?.confidence, 'usage-only');
  assert.equal(accountB?.confidence, 'usage-only');
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

test('GPT-6 Astra contributes exact Standard short-context API-equivalent value', () => {
  const astra = equivalentUsageFromProviderTokens(RESET, 'gpt-6-astra', {
    inputTotal: 2_000_000,
    cachedInput: 1_000_000,
    outputTotal: 1_000_000,
  });

  // 1M uncached * $10 + 1M cached * $1 + 1M output * $50.
  assert.equal(astra.equivalentUsd, 61);
  assert.equal(astra.pricedTokens, 3_000_000);
  assert.equal(astra.totalTokens, 3_000_000);
});

test('new Sol/Luna models preserve Codex cache/output semantics and exact pricing coverage', () => {
  for (const [model, input, cached, output] of [
    ['gpt-6.1-sol', 2, 0.1, 10],
    ['gpt-6-sol', 2, 0.2, 10],
    ['gpt-6-luna', 0.1, 0.01, 0.5],
  ] as const) {
    const priced = equivalentCostBreakdownFromProviderTokens(model, {
      inputTotal: 2_000_000, cachedInput: 1_000_000,
      outputTotal: 1_000_000, reasoningOutput: 750_000,
    });
    assert.equal(priced.equivalentUsd, input + cached + output, model);
    assert.equal(priced.freshInputUsd, input, model);
    assert.equal(priced.cachedInputUsd, cached, model);
    assert.equal(priced.outputUsd, output, model);
    assert.equal(priced.totalTokens, 3_000_000, model);
    assert.equal(priced.pricedTokens, 3_000_000, model);
    assert.equal(priced.pricingCoverage, 1, model);
  }
  const unknown = equivalentUsageFromProviderTokens(RESET, 'gpt-6.1-sol-20990101', {
    inputTotal: 2_000_000, cachedInput: 1_000_000, outputTotal: 1_000_000,
  });
  assert.equal(unknown.equivalentUsd, 0);
  assert.equal(unknown.pricedTokens, 0);
  assert.equal(unknown.totalTokens, 3_000_000);
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

test('Codex keeps post-reset usage in a new reset-aligned period when the quota sample is stale', () => {
  const now = RESET + HOUR;
  const points = buildWeeklyValueTimeline('codex', {
    // Older than the sample window, but still a trustworthy reset timestamp.
    observations: [observation({
      observedAt: RESET - 8 * DAY,
      resetAt: RESET,
      sourceKey: 'one-file',
    })],
    usage: [
      usage(40, RESET - HOUR, 'one-file'),
      usage(7, RESET + 30 * 60 * 1000, 'one-file'),
    ],
  }, { now });

  const previous = points.find((point) => point.resetAt === RESET);
  const current = points.find((point) => point.resetAt === RESET + 7 * DAY);
  assert.equal(previous?.usedEquivalentUsd, 40);
  assert.equal(current?.usedEquivalentUsd, 7);
  assert.equal(previous?.basis, 'reset-aligned-usage');
  assert.equal(current?.basis, 'reset-aligned-usage');
  assert.equal(current?.utilizationPercent, null);
  assert.equal(current?.fullEquivalentUsd, null);
  assert.equal(points.reduce((sum, point) => sum + point.usedEquivalentUsd, 0), 47);
});

test('conflicting stale Codex reset schedules do not choose an arbitrary alignment', () => {
  const now = RESET + HOUR;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({
        observedAt: RESET - 8 * DAY,
        resetAt: RESET,
        sourceKey: 'older-login',
      }),
      observation({
        observedAt: RESET - 8 * DAY + 1,
        resetAt: RESET + DAY,
        sourceKey: 'other-login',
      }),
    ],
    usage: [usage(7, RESET + 30 * 60 * 1000, 'older-login')],
  }, { now });

  assert.equal(points.some((point) => point.resetAt === RESET + 7 * DAY), false);
  assert.equal(points[0]?.basis, 'calendar-usage');
  assert.equal(points[0]?.fullEquivalentUsd, null);
});

test('a fresh Codex reset starts a new current period and estimates both observed windows', () => {
  const now = RESET + HOUR;
  const nextReset = RESET + 7 * DAY;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({
        observedAt: RESET - HOUR,
        resetAt: RESET,
        usedPercent: 80,
        sourceKey: 'one-file',
      }),
      observation({
        observedAt: RESET + 30 * 60 * 1000,
        resetAt: nextReset,
        usedPercent: 10,
        sourceKey: 'one-file',
      }),
    ],
    usage: [
      usage(40, RESET - 2 * HOUR, 'one-file'),
      usage(7, RESET + 15 * 60 * 1000, 'one-file'),
    ],
  }, { now });

  assert.equal(points.find((point) => point.resetAt === RESET)?.usedEquivalentUsd, 40);
  const current = points.find((point) => point.current);
  assert.equal(current?.resetAt, nextReset);
  assert.equal(current?.usedEquivalentUsd, 7);
  assert.equal(current?.utilizationPercent, 10);
  assert.equal(points.find((point) => point.resetAt === RESET)?.fullEquivalentUsd, 50);
  assert.equal(points.find((point) => point.resetAt === RESET)?.unusedEquivalentUsd, 10);
  assert.equal(current?.fullEquivalentUsd, 70);
});

test('same account-wide Codex series uses the newest coherent observation across stale reset forecasts', () => {
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
  assert.equal(current?.fullEquivalentUsd, 40 / 0.43);
  assert.equal(current?.unusedEquivalentUsd, (40 / 0.43) - 40);
  assert.equal(current?.confidence, 'medium');
});

test('overlapping current Codex resets use the latest observation as a low-confidence blended estimate', () => {
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
  assert.equal(current?.fullEquivalentUsd, 40 / 0.43);
  assert.equal(current?.unusedEquivalentUsd, (40 / 0.43) - 40);
  assert.equal(current?.confidence, 'low');
});

test('Codex allowance inference includes multiple local log sources but lowers confidence', () => {
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
  assert.equal(points[0].fullEquivalentUsd, 100);
  assert.equal(points[0].unusedEquivalentUsd, 50);
  assert.equal(points[0].confidence, 'low');
});

test('completed Codex periods estimate total and unused value from an observed window', () => {
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({ sourceKey: 'one-file' })],
    usage: [usage(40, RESET - 2 * HOUR, 'one-file')],
  }, { now: RESET + HOUR });

  assert.equal(points[0].current, false);
  assert.equal(points[0].usedEquivalentUsd, 40);
  assert.equal(points[0].utilizationPercent, 75);
  assert.equal(points[0].fullEquivalentUsd, 40 / 0.75);
  assert.ok(Math.abs((points[0].unusedEquivalentUsd ?? 0) - 40 / 3) < 1e-9);
  assert.equal(points[0].confidence, 'high');
});

test('a daily Codex aggregate crossing a reset keeps a low-confidence allowance estimate', () => {
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
  assert.equal(affected?.fullEquivalentUsd, 80);
  assert.equal(affected?.unusedEquivalentUsd, 40);
  assert.equal(affected?.confidence, 'low');
});

test('an irregular Codex reset is mapped to the fixed period containing its observation', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  const currentReset = Date.parse('2026-09-07T00:00:00.000Z');
  const driftingReset = Date.parse('2026-08-31T02:00:00.000Z');
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({
        observedAt: Date.parse('2026-08-25T12:00:00.000Z'),
        resetAt: driftingReset,
        usedPercent: 40,
        sourceKey: 'older-file',
      }),
      observation({
        observedAt: Date.parse('2026-08-31T11:00:00.000Z'),
        resetAt: currentReset,
        usedPercent: 20,
        sourceKey: 'current-file',
      }),
    ],
    usage: [
      usage(30, Date.parse('2026-08-25T10:00:00.000Z'), 'older-file'),
      usage(40, Date.parse('2026-08-31T10:00:00.000Z'), 'current-file'),
    ],
  }, { now });

  const previous = points.find((point) => point.resetAt === driftingReset - 2 * HOUR);
  const current = points.find((point) => point.resetAt === currentReset);
  assert.equal(previous?.usedEquivalentUsd, 30);
  assert.equal(previous?.utilizationPercent, 40);
  assert.equal(previous?.fullEquivalentUsd, 75);
  assert.equal(previous?.unusedEquivalentUsd, 45);
  assert.equal(previous?.confidence, 'low');
  assert.equal(current?.usedEquivalentUsd, 40);
  assert.equal(current?.utilizationPercent, 20);
  assert.equal(current?.fullEquivalentUsd, 200);
  assert.equal(current?.unusedEquivalentUsd, 160);
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

test('multiple same-window observations use a robust candidate aggregate instead of the latest outlier', () => {
  const points = buildWeeklyValueTimeline('claude', {
    observations: [
      observation({
        provider: 'claude',
        seriesKey: 'active-claude',
        windowId: 'window-one',
        accountAttribution: 'profile-continuity',
        observedAt: RESET - 4 * HOUR,
        usedPercent: 20,
      }),
      observation({
        provider: 'claude',
        seriesKey: 'active-claude',
        windowId: 'window-one',
        accountAttribution: 'profile-continuity',
        observedAt: RESET - 3 * HOUR,
        usedPercent: 40,
      }),
      observation({
        provider: 'claude',
        seriesKey: 'active-claude',
        windowId: 'window-one',
        accountAttribution: 'profile-continuity',
        observedAt: RESET - 2 * HOUR,
        usedPercent: 10,
      }),
    ],
    usage: [
      usage(20, RESET - 5 * HOUR),
      usage(20, RESET - 3.5 * HOUR),
      usage(20, RESET - 2.5 * HOUR),
    ],
  }, { now: RESET + HOUR });

  assert.equal(points[0].fullEquivalentUsd, 100);
  assert.equal(points[0].usedEquivalentUsd, 60);
  assert.equal(points[0].unusedEquivalentUsd, 40);
});

test('low priced coverage lowers confidence but does not hide a mathematically valid total', () => {
  const points = buildWeeklyValueTimeline('claude', {
    observations: [observation({
      provider: 'claude',
      seriesKey: 'active-claude',
      accountAttribution: 'profile-continuity',
      observationConfidence: 'medium',
      usedPercent: 50,
    })],
    usage: [{
      timestamp: RESET - 2 * HOUR,
      equivalentUsd: 20,
      pricedTokens: 100,
      totalTokens: 1_000,
    }],
  }, { now: RESET + HOUR });

  assert.equal(points[0].fullEquivalentUsd, 40);
  assert.equal(points[0].unusedEquivalentUsd, 20);
  assert.equal(points[0].confidence, 'low');
});

test('one unattributed Codex window shows low-confidence total and unused estimates', () => {
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({
      seriesKey: 'codex-epoch-1',
      windowId: 'window-one',
      accountAttribution: 'unattributed',
      usedPercent: 50,
    })],
    usage: [usage(40, RESET - 2 * HOUR)],
  }, { now: RESET + HOUR });

  assert.equal(points[0].fullEquivalentUsd, 80);
  assert.equal(points[0].unusedEquivalentUsd, 40);
  assert.equal(points[0].confidence, 'low');
});

test('one unattributed Claude window also forces a low-confidence estimate', () => {
  const points = buildWeeklyValueTimeline('claude', {
    observations: [observation({
      provider: 'claude',
      seriesKey: 'claude-profile',
      accountAttribution: 'unattributed',
      usedPercent: 50,
    })],
    usage: [usage(40, RESET - 2 * HOUR)],
  }, { now: RESET + HOUR });

  assert.equal(points[0].fullEquivalentUsd, 80);
  assert.equal(points[0].unusedEquivalentUsd, 40);
  assert.equal(points[0].confidence, 'low');
});

test('a current unattributed Codex window after a completed reset still estimates its total', () => {
  const currentReset = RESET + 7 * DAY;
  const now = currentReset - HOUR;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({
        seriesKey: 'codex-epoch-1',
        windowId: 'completed-window',
        accountAttribution: 'unattributed',
        observedAt: RESET - HOUR,
        resetAt: RESET,
        usedPercent: 84,
      }),
      observation({
        seriesKey: 'codex-epoch-2',
        windowId: 'current-window',
        accountAttribution: 'unattributed',
        observedAt: now - HOUR,
        resetAt: currentReset,
        usedPercent: 74,
      }),
    ],
    usage: [
      usage(40, RESET - 2 * HOUR),
      usage(74, now - 2 * HOUR),
    ],
  }, { now });

  const current = points.find((point) => point.current);
  assert.equal(current?.usedEquivalentUsd, 74);
  assert.equal(current?.utilizationPercent, 74);
  assert.equal(current?.fullEquivalentUsd, 100);
  assert.equal(current?.unusedEquivalentUsd, 26);
  assert.equal(current?.confidence, 'low');
});

test('a single Codex window flagged account-ambiguous still exposes a durability estimate', () => {
  const currentReset = RESET + 7 * DAY;
  const now = currentReset - HOUR;
  const points = buildWeeklyValueTimeline('codex', {
    observations: [observation({
      seriesKey: 'codex-local-home',
      windowId: 'current-window',
      accountAttribution: 'unattributed',
      flags: ['account-ambiguous'],
      observedAt: now - HOUR,
      resetAt: currentReset,
      usedPercent: 25,
    })],
    usage: [usage(50, now - 2 * HOUR)],
  }, { now });

  assert.equal(points[0].fullEquivalentUsd, 200);
  assert.equal(points[0].unusedEquivalentUsd, 150);
  assert.equal(points[0].confidence, 'low');
});

test('overlapping unattributed Codex epochs never share usage for an allowance estimate', () => {
  const points = buildWeeklyValueTimeline('codex', {
    observations: [
      observation({
        seriesKey: 'codex-epoch-1',
        windowId: 'window-one',
        accountAttribution: 'unattributed',
        observedAt: RESET - 2 * HOUR,
        usedPercent: 50,
      }),
      observation({
        seriesKey: 'codex-epoch-2',
        windowId: 'window-two',
        accountAttribution: 'unattributed',
        observedAt: RESET - HOUR,
        usedPercent: 25,
      }),
    ],
    usage: [usage(40, RESET - 3 * HOUR)],
  }, { now: RESET + HOUR });

  assert.equal(points[0].fullEquivalentUsd, null);
  assert.equal(points[0].unusedEquivalentUsd, null);
  assert.equal(points[0].confidence, 'usage-only');
});
