import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildLocalWeeklyEstimates } from '../weeklyEstimate';
import type { WeeklyValueInputs } from '../weeklyValue';

const T = Date.parse('2026-10-19T02:00:00Z'), R = T + 6 * 86_400_000;
const observation = (observedAt: number, usedPercent: number) => ({
  provider: 'codex' as const, seriesKey: 'unassigned', observedAt, resetAt: R, usedPercent,
});
const amount = (timestamp: number, equivalentUsd: number) => ({
  timestamp, equivalentUsd, pricedTokens: equivalentUsd * 10, totalTokens: equivalentUsd * 10,
});

test('a lower-counter segment excludes the unobserved reset gap and uses only post-baseline percentage growth', () => {
  const inputs: WeeklyValueInputs = {
    observations: [observation(T, 70), observation(T + 60_000, 5), observation(T + 120_000, 8)],
    usage: [amount(T - 1, 100), amount(T + 59_999, 400), amount(T + 119_999, 3)],
  };
  const before = JSON.stringify(inputs), [entry] = buildLocalWeeklyEstimates('codex', inputs, { now: T + 120_001 });
  assert.equal(entry.usedEquivalentUsd, 3);
  assert.equal(entry.fullEquivalentUsd, 100);
  assert.equal(entry.unusedEquivalentUsd, 92);
  assert.equal(entry.calibrationStart, T + 60_000);
  assert.ok(entry.flags.includes('account-unattributed'));
  assert.ok(entry.flags.includes('counter-change'));
  assert.equal(JSON.stringify(inputs), before);
});

test('the first lower-counter observation alone cannot divide pre-reset gap usage by the new percentage', () => {
  const [entry] = buildLocalWeeklyEstimates('codex', {
    observations: [observation(T, 70), observation(T + 60_000, 5)],
    usage: [amount(T + 59_999, 400)],
  }, { now: T + 60_001 });
  assert.equal(entry.fullEquivalentUsd, null);
  assert.equal(entry.unusedEquivalentUsd, null);
});
