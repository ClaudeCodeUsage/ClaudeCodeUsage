import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexAccountEstimator, OfficialQuotaSample } from '../codexAccountEstimate';
import type { WeeklyValueInputs } from '../weeklyValue';

const T = Date.parse('2026-10-19T02:00Z'), M = 60_000, R = T + 6 * 86_400_000;
const A = 'a'.repeat(64), B = 'b'.repeat(64), S = 'c'.repeat(64);
const pricebook = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .00000125, cachedInput: .000000125, output: .00001 }] };
function sample(t: number, p: number, accountScopeKey = A): OfficialQuotaSample {
  return { accountScopeKey, sourceScopeKey: S, requestedAt: t - 100, observedAt: t, resetAt: R,
    usedPercent: p, quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } };
}
function inputs(t: number, p: number, usd: number): WeeklyValueInputs {
  return { localHistoryComplete: true, calibrationPricebook: pricebook,
    usage: [{ sourceKey: 'own', timestamp: t - 1, intervalStart: T - M, intervalEnd: t - 1,
      equivalentUsd: usd, pricedTokens: usd * 10, totalTokens: usd * 10 }],
    observations: [{ provider: 'codex', seriesKey: 'codex', sourceKey: 'own',
      observedAt: t - 1, usedPercent: p, resetAt: R }] };
}
function admitted(e: CodexAccountEstimator) {
  e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  return e.observe(sample(T + M, 30), inputs(T + M, 30, 120), 'api-v1')!;
}
test('over-65-minute silence breaks the baseline but preserves only admitted compatible intervals', () => {
  const e = new CodexAccountEstimator(), first = admitted(e), frozen = JSON.stringify(first);
  assert.equal(e.observe(sample(T + 67 * M, 50), inputs(T + 67 * M, 50, 900), 'api-v1'), undefined);
  const resumed = e.observe(sample(T + 68 * M, 55), inputs(T + 68 * M, 55, 910), 'api-v1')!;
  assert.equal(resumed.usedEquivalentUsd, 30);
  assert.equal(resumed.fullEquivalentUsd, 200);
  assert.equal(resumed.calibrationStart, T);
  assert.equal(resumed.calibrationEvidence!.accumulated.intervals, 2);
  assert.equal(resumed.calibrationEvidence!.interval.deltaUsd, 10);
  assert.equal(JSON.stringify(first), frozen);
});
test('unchanged actual pricebook survives fetch-timestamp labels across A-B-A', () => {
  const e = new CodexAccountEstimator(); admitted(e);
  assert.equal(e.observe(sample(T + 2 * M, 35, B), inputs(T + 2 * M, 35, 500), 'api-fetch-2'), undefined);
  assert.equal(e.observe(sample(T + 3 * M, 40), inputs(T + 3 * M, 40, 900), 'api-fetch-3'), undefined);
  const resumed = e.observe(sample(T + 4 * M, 45), inputs(T + 4 * M, 45, 910), 'api-fetch-4')!;
  assert.equal(resumed.usedEquivalentUsd, 30);
  assert.equal(resumed.calibrationEvidence!.accumulated.intervals, 2);
  assert.deepEqual(resumed.calibrationEvidence!.pricebook, pricebook);
});
test('unchanged actual rates allow a new label without breaking an active baseline', () => {
  const e = new CodexAccountEstimator(); admitted(e);
  const next = e.observe(sample(T + 2 * M, 40), inputs(T + 2 * M, 40, 140), 'api-fetch-2')!;
  assert.equal(next.usedEquivalentUsd, 40);
  assert.equal(next.calibrationEvidence!.accumulated.intervals, 2);
});
test('actual rate and source invalidation survive a continuity break and never resurrect S-T-S runs', () => {
  for (const change of ['rates', 'source', 'eligibility'] as const) {
    const e = new CodexAccountEstimator(); admitted(e); e.breakContinuity();
    const changedSample = sample(T + 2 * M, 35), changed = inputs(T + 2 * M, 35, 500);
    if (change === 'rates') changed.calibrationPricebook = { ...pricebook,
      rates: [{ ...pricebook.rates[0], input: .000002 }] };
    if (change === 'source') changedSample.sourceScopeKey = 'd'.repeat(64);
    if (change === 'eligibility') changed.calibrationSourceScope = { verified: true, excludedSourceKeys: ['other'] };
    assert.equal(e.observe(changedSample, changed, 'api-v1'), undefined);
    e.breakContinuity();
    assert.equal(e.observe(sample(T + 3 * M, 40), inputs(T + 3 * M, 40, 900), 'api-v1'), undefined);
    const next = e.observe(sample(T + 4 * M, 45), inputs(T + 4 * M, 45, 910), 'api-v1')!;
    assert.equal(next.usedEquivalentUsd, 10, change);
    assert.equal(next.calibrationEvidence!.accumulated.intervals, 1, change);
  }
});
test('growing excluded, conflicting, unmatched and unpriced sources cannot supply a partial numerator', () => {
  for (const kind of ['excluded', 'conflicting', 'unmatched', 'unkeyed', 'unpriced'] as const) {
    const e = new CodexAccountEstimator();
    const extra = (t: number, p: number, usd: number, missing: number) => {
      const i = inputs(t, p, usd);
      i.usage.push({ sourceKey: kind === 'unkeyed' ? undefined : 'other', timestamp: t - 1,
        intervalStart: T - M, intervalEnd: t - 1, equivalentUsd: kind === 'unpriced' ? 0 : missing,
        pricedTokens: kind === 'unpriced' ? 0 : missing * 10, totalTokens: missing * 10 });
      if (kind === 'excluded') i.calibrationSourceScope = { verified: true, excludedSourceKeys: ['other'] };
      if (kind !== 'unmatched' && kind !== 'unkeyed') i.observations.push({ ...i.observations[0],
        sourceKey: 'other', usedPercent: kind === 'conflicting' ? 10 : p });
      return i;
    };
    e.observe(sample(T, 20), extra(T, 20, 100, 50), 'api-v1');
    assert.equal(e.observe(sample(T + M, 30), extra(T + M, 30, 120, 70), 'api-v1'), undefined, kind);
    const next = e.observe(sample(T + 2 * M, 40), extra(T + 2 * M, 40, 140, 70), 'api-v1')!;
    assert.equal(next.usedEquivalentUsd, 20, 'rejected interval cannot enter admitted sums: ' + kind);
    assert.equal(next.calibrationEvidence!.accumulated.intervals, 1);
  }
});
test('unchanged excluded history does not globally veto a complete current increment', () => {
  const e = new CodexAccountEstimator();
  const scoped = (t: number, p: number, usd: number) => ({ ...inputs(t, p, usd),
    calibrationSourceScope: { verified: true, excludedSourceKeys: ['old-conflict'] },
    usage: [...inputs(t, p, usd).usage, { sourceKey: 'old-conflict', timestamp: T - 2 * M,
      equivalentUsd: 500, pricedTokens: 5000, totalTokens: 5000 }] });
  e.observe(sample(T, 20), scoped(T, 20, 100), 'api-v1');
  const next = e.observe(sample(T + M, 30), scoped(T + M, 30, 120), 'api-v1')!;
  assert.equal(next.fullEquivalentUsd, 200);
  assert.equal(next.calibrationEvidence!.interval.excludedSources, 1);
});
