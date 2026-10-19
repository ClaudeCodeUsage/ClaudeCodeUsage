import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWeeklyValueTimeline, buildWeeklyValueTrend, WeeklyValueInputs } from '../weeklyValue';

const DAY = 86_400_000;
const RESET = Date.parse('2026-10-19T12:00:00Z');
const NOW = RESET - DAY;

function mixedHistory(): WeeklyValueInputs {
  return {
    observations: [{ provider: 'codex', seriesKey: 'local-window',
      accountAttribution: 'unattributed', observedAt: NOW, resetAt: RESET, usedPercent: 25 }],
    usage: [{ timestamp: NOW - DAY, equivalentUsd: 50, pricedTokens: 100, totalTokens: 100 }],
  };
}

test('both weekly entry points withhold account allowance for unattributed local history', () => {
  for (const points of [buildWeeklyValueTimeline('codex', mixedHistory(), { now: NOW }),
    buildWeeklyValueTrend(mixedHistory(), NOW)]) {
    assert.equal(points[0].usedEquivalentUsd, 50);
    assert.equal(points[0].utilizationPercent, 25);
    assert.equal(points[0].fullEquivalentUsd, null);
    assert.equal(points[0].unusedEquivalentUsd, null);
  }
});

test('a verified quota account alone does not assign unowned usage to that account', () => {
  const inputs = mixedHistory();
  inputs.observations[0].accountAttribution = 'verified-local-signal';
  const [point] = buildWeeklyValueTimeline('codex', inputs, { now: NOW });
  assert.equal(point.fullEquivalentUsd, null);
});

test('a counter drop within the same reset cannot support a blended estimate', () => {
  const inputs = mixedHistory();
  inputs.observations.unshift({ ...inputs.observations[0], observedAt: NOW - 1000, usedPercent: 80 });
  const [point] = buildWeeklyValueTimeline('codex', inputs, { now: NOW });
  assert.equal(point.fullEquivalentUsd, null);
  assert.equal(point.utilizationPercent, 25);
});

test('invalid quota percentages do not become fabricated zero/full observations or anchors', () => {
  for (const usedPercent of [-1, 101, NaN, Infinity]) {
    const inputs = mixedHistory();
    inputs.observations[0].usedPercent = usedPercent;
    const [point] = buildWeeklyValueTimeline('codex', inputs, { now: NOW });
    assert.equal(point.utilizationPercent, null);
    assert.equal(point.basis, 'calendar-usage');
  }
});

test('irregular earlier reset observations never decorate a different seven-day window', () => {
  const inputs = mixedHistory();
  inputs.observations.push({ ...inputs.observations[0], resetAt: RESET + DAY, observedAt: NOW + 1 });
  const points = buildWeeklyValueTimeline('codex', inputs, { now: NOW + 1 });
  assert.equal(points.reduce((sum, point) => sum + point.usedEquivalentUsd, 0), 50);
  for (const point of points) assert.equal(point.fullEquivalentUsd, null);
});

function ownedHistory(): WeeklyValueInputs {
  const inputs = mixedHistory();
  inputs.observations[0] = { ...inputs.observations[0], seriesKey: 'verified-epoch',
    accountAttribution: 'verified-local-signal', windowId: 'weekly-window' };
  inputs.usage[0].accountSeriesKey = 'verified-epoch';
  inputs.accountUsageCoverage = [{ seriesKey: 'verified-epoch', resetAt: RESET,
    from: RESET - 7 * DAY, through: NOW }];
  return inputs;
}

test('explicit complete same-account window proof retains the estimate arithmetic', () => {
  for (const points of [buildWeeklyValueTimeline('codex', ownedHistory(), { now: NOW }),
    buildWeeklyValueTrend(ownedHistory(), NOW)]) {
    assert.equal(points[0].fullEquivalentUsd, 200);
    assert.equal(points[0].unusedEquivalentUsd, 150);
    assert.equal(points[0].observedAt, NOW);
    assert.equal(points[0].observedResetAt, RESET);
  }
});

test('ownership, completeness, reset, pricing and counter regressions independently revoke inference', () => {
  const changes: Array<(inputs: WeeklyValueInputs) => void> = [
    (inputs) => { inputs.usage[0].accountSeriesKey = 'another-account'; },
    (inputs) => { inputs.accountUsageCoverage![0].through = NOW - 1; },
    (inputs) => { inputs.accountUsageCoverage![0].from += 1; },
    (inputs) => { inputs.accountUsageCoverage![0].resetAt += DAY; },
    (inputs) => { inputs.observations[0].flags = ['account-ambiguous']; },
    (inputs) => { inputs.observations[0].usedPercent = 1; },
    (inputs) => { inputs.observations[0].usedPercent = 100; },
    (inputs) => { inputs.usage[0].pricedTokens = 20; },
    (inputs) => { inputs.usage[0].pricedTokens = 99; },
    (inputs) => { inputs.usage[0].intervalStart = NOW - 1;
      inputs.usage[0].intervalEnd = NOW + 1; },
    (inputs) => { inputs.observations.unshift({ ...inputs.observations[0],
      observedAt: NOW - 1, usedPercent: 80 }); },
    (inputs) => { inputs.observations.unshift({ ...inputs.observations[0],
      observedAt: NOW - 1, resetAt: RESET - DAY, usedPercent: 80 }); },
  ];
  for (const change of changes) {
    const inputs = ownedHistory();
    change(inputs);
    for (const points of [buildWeeklyValueTimeline('codex', inputs, { now: NOW }),
      buildWeeklyValueTrend(inputs, NOW)]) {
      assert.equal(points[0].fullEquivalentUsd, null);
      assert.equal(points[0].unusedEquivalentUsd, null);
    }
  }
});

test('one sample at or after expiry never masquerades as an observed next cycle', () => {
  const inputs = mixedHistory();
  inputs.usage.push({ ...inputs.usage[0], timestamp: RESET, equivalentUsd: 7 });
  const points = buildWeeklyValueTimeline('codex', inputs, { now: RESET + 1 });
  assert.equal(points.reduce((sum, point) => sum + point.usedEquivalentUsd, 0), 57);
  const current = points.find((point) => point.current)!;
  assert.equal(current.utilizationPercent, null);
  assert.equal(current.fullEquivalentUsd, null);
});
