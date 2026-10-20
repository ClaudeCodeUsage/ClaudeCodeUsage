import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { selectCodexCycleEstimates } from '../codexQuotaCycles';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';

const T = Date.parse('2026-10-19T02:00Z'), M = 60_000, R = T + 6 * 86_400_000;
function entry(extra: Partial<LocalWeeklyEstimate> = {}): LocalWeeklyEstimate {
  return { provider: 'codex', windowStart: R - 7 * 86_400_000, resetAt: R,
    observedAt: T + 30 * M, estimatedAt: T + 30 * M, usedEquivalentUsd: 210,
    fullEquivalentUsd: 700, unusedEquivalentUsd: 350, utilizationPercent: 50,
    pricingCoverage: 1, method: 'account-delta-v1', accountNumber: 1,
    quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
    quotaCycle: { id: T, startAt: null, startLowerAt: null, endAt: R, endLowerAt: R,
      closed: false, scheduledResetAt: R, boundaryUncertain: true }, flags: ['account-unattributed'], ...extra };
}
function measured(delta: number, observedAt: number, full: number): LocalWeeklyEstimate {
  return entry({ observedAt, estimatedAt: observedAt, fullEquivalentUsd: full,
    unusedEquivalentUsd: full * .47, utilizationPercent: 53,
    calibrationEvidence: { accumulated: { deltaPercent: delta, intervals: delta, deltaUsd: full * delta / 100,
      pricedTokens: 100, totalTokens: 100 } } as LocalWeeklyEstimate['calibrationEvidence'] });
}
test('a short fresh calibration cannot silently replace a better supported same-cycle estimate', () => {
  const old = measured(30, T + 30 * M, 700), fresh = measured(1, T + 101 * M, 60);
  const [selected] = selectCodexCycleEstimates([fresh, old]);
  assert.equal(selected.fullEquivalentUsd, 700);
  assert.equal(selected.observedAt, old.observedAt, 'amount and quota percentage remain at the selected evidence time');
});
test('a real new reset cycle exists before it has enough monetary calibration', () => {
  const start = T + 2 * 86_400_000;
  const next = entry({ observedAt: start, estimatedAt: start, usedEquivalentUsd: 0,
    fullEquivalentUsd: null, unusedEquivalentUsd: null, utilizationPercent: 2,
    quotaEpoch: { startedAt: start, resetAnchorAt: R, startLowerAt: T + M, reason: 'counter-drop' },
    quotaCycle: { id: start, startAt: start, startLowerAt: T + M, endAt: R, endLowerAt: R,
      closed: false, scheduledResetAt: R, boundaryUncertain: true } });
  const rows = selectCodexCycleEstimates([entry(), next]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(x => x.quotaCycle?.id === start)?.fullEquivalentUsd, null);
});
test('one cycle produces one summary even with multiple failed or zero-sample observations', () => {
  const missing = entry({ observedAt: T + 40 * M, fullEquivalentUsd: null, unusedEquivalentUsd: null, usedEquivalentUsd: 0 });
  assert.equal(selectCodexCycleEstimates([entry(), missing, { ...missing, observedAt: T + 41 * M }]).length, 1);
  assert.equal(selectCodexCycleEstimates([missing, { ...missing, observedAt: T + 41 * M }]).length, 1);
});
test('an incomplete numerator is withheld, not promoted to a capacity of fourteen dollars', () => {
  const bad = entry({ method: 'series-prefix-v1', accountNumber: undefined, quotaEpoch: undefined,
    quotaCycle: undefined, usedEquivalentUsd: 2.31, fullEquivalentUsd: 14.4375,
    unusedEquivalentUsd: 12.1275, utilizationPercent: 16, unlinkedEquivalentUsd: 300,
    flags: ['account-unattributed', 'partial-history'] });
  const [selected] = selectCodexCycleEstimates([bad]);
  assert.equal(selected.fullEquivalentUsd, null);
  assert.equal(selected.unusedEquivalentUsd, null);
  assert.equal(bad.fullEquivalentUsd, 14.4375, 'frozen archive data is never rewritten');
});
test('learning a real boundary replaces old reference metadata instead of duplicating an archived episode', () => {
  const key = 'a'.repeat(64), old = entry({ accountNumber: undefined, quotaEpoch: undefined, localWindowKey: key,
    quotaCycle: { id: T - 2 * 3600000, startAt: T - 2 * 3600000, startLowerAt: null,
      endAt: T - 2 * 3600000 + 604800000, endLowerAt: null, closed: false, scheduledResetAt: R,
      boundaryUncertain: true, referenceOnly: true, fallbackDays: 7 } });
  const known = entry({ accountNumber: undefined, quotaEpoch: undefined, localWindowKey: key, estimatedAt: T + 2 * 3600000 });
  const next = entry({ accountNumber: undefined, quotaEpoch: undefined, localWindowKey: 'b'.repeat(64),
    quotaCycle: { ...known.quotaCycle!, id: T + 3600000, startAt: T + 3600000 } });
  assert.equal(selectCodexCycleEstimates([old, known, next]).length, 2);
});
