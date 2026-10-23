import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { selectCodexCycleEstimates, withCodexQuotaCycles } from '../codexQuotaCycles';
import { projectWeeklyEstimateChart } from '../weeklyEstimateChart';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
const D = 86_400_000, MON = Date.parse('2026-01-05T00:00Z');
function ref(day: number, resetOffset = 3, accountNumber?: number): LocalWeeklyEstimate {
  const observedAt = MON + day * D + 3_600_000, resetAt = observedAt + resetOffset * D;
  return { provider: 'codex', windowStart: resetAt - 7 * D, resetAt, observedAt, estimatedAt: observedAt,
    usedEquivalentUsd: 20 + day, fullEquivalentUsd: 100 + day, unusedEquivalentUsd: 60,
    utilizationPercent: 40, pricingCoverage: 1, method: 'series-prefix-v1',
    flags: ['account-unattributed'], ...(accountNumber === undefined ? {} : { accountNumber }) };
}
test('daily legacy reset references collapse to one latest observation per nonoverlapping seven-day period', () => {
  const original = Array.from({ length: 24 }, (_, i) => ref(i, i % 3 + 1));
  const before = JSON.stringify(original), selected = selectCodexCycleEstimates(original);
  assert.equal(selected.length, 4, '24 daily reset references are four period bars, never 24');
  assert.deepEqual(selected.map(e => e.observedAt), [23, 20, 13, 6].map(day => ref(day).observedAt));
  for (const entry of selected) {
    assert.equal(entry.quotaCycle?.fallbackDays, 7);
    assert.equal(entry.quotaCycle!.endAt - entry.quotaCycle!.startAt!, 7 * D);
    const raw = original.find(x => x.observedAt === entry.observedAt)!;
    assert.equal(entry.fullEquivalentUsd, raw.fullEquivalentUsd);
    assert.equal(entry.unusedEquivalentUsd, raw.unusedEquivalentUsd);
    assert.equal(entry.resetAt, raw.resetAt);
  }
  assert.equal(JSON.stringify(original), before);
});
test('fallback uses observedAt rather than irregular future reset dates and never adds overlapping values', () => {
  const a = ref(0, 6), b = ref(1, 1), c = ref(6, 1);
  const [entry] = selectCodexCycleEstimates([a, b, c]);
  assert.equal(entry.observedAt, c.observedAt); assert.equal(entry.fullEquivalentUsd, c.fullEquivalentUsd);
  assert.equal(entry.quotaCycle?.startAt, MON); assert.equal(entry.quotaCycle?.endAt, MON + 7 * D);
  assert.notEqual(entry.fullEquivalentUsd, a.fullEquivalentUsd! + b.fullEquivalentUsd! + c.fullEquivalentUsd!);
});
test('fallback is fixed Monday UTC, stable on redraw and isolates already known different account numbers', () => {
  const a = ref(1, 3, 1), b = ref(2, 2, 2), c = ref(6, 1);
  assert.equal(selectCodexCycleEstimates([a, b, c]).length, 3);
  const selected = selectCodexCycleEstimates([c, ref(7)]).sort((a, b) => a.observedAt - b.observedAt);
  assert.equal(selected[0].quotaCycle?.endAt, selected[1].quotaCycle?.startAt);
  const projected = withCodexQuotaCycles([c], [], () => undefined, MON + 8 * D);
  const again = withCodexQuotaCycles(projected, [], () => undefined, MON + 20 * D);
  assert.deepEqual(again[0].quotaCycle?.startAt, projected[0].quotaCycle?.startAt);
});
test('actual reset cycles shorter than seven days stay separate while legacy fallback is only a reference', () => {
  const epoch = (start: number) => ({ startedAt: start, resetAnchorAt: MON + 7 * D,
    startLowerAt: start - 1000, reason: 'counter-drop' as const });
  const entries = [ref(1), ref(2)].map((e, i) => ({ ...e, method: 'account-delta-v1' as const,
    accountNumber: 1, accountScopeKey: 'a'.repeat(64), resetAt: MON + 7 * D,
    windowStart: MON, quotaEpoch: epoch(MON + (i + 1) * D), calibrationStart: MON + (i + 1) * D }));
  const projected = withCodexQuotaCycles(entries, [], () => undefined, MON + 4 * D);
  assert.equal(selectCodexCycleEstimates(projected).length, 2);
  assert.ok(projected.every(e => e.quotaCycle?.fallbackDays === undefined));
  const chart = projectWeeklyEstimateChart('codex', [], Array.from({ length: 24 }, (_, i) => ref(i)), { now: MON + 30 * D, limit: 48 });
  assert.equal(chart.length, 4);
  assert.ok(chart.every(p => p.current === false && p.quotaCycle?.referenceOnly));
});
