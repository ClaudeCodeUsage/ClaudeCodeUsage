import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  appendCodexQuotaHistory,
  CODEX_QUOTA_HISTORY_LIMIT,
  codexQuotaObservationsFromLimit,
  weeklyQuotaObservationsFromCodexHistory,
} from '../providers/codex/codexQuotaHistory';
import { ProviderLimitSnapshot } from '../providers/providerTypes';

function limit(
  observedAt: number,
  resetAt: number,
  usedPercent: number,
  options: {
    limitId?: string;
    limitName?: string;
    windowMinutes?: number;
  } = {},
): ProviderLimitSnapshot {
  return {
    provider: 'codex',
    ...(options.limitId ? { limitId: options.limitId } : {}),
    ...(options.limitName ? { limitName: options.limitName } : {}),
    observedAt,
    source: 'local-log',
    confidence: 'last-observed',
    windows: [{
      label: 'secondary',
      usedPercent,
      windowMinutes: options.windowMinutes ?? 7 * 24 * 60,
      resetsAt: resetAt,
    }],
  };
}

test('only account-wide weekly Codex windows become neutral reset evidence', () => {
  const resetAt = Date.parse('2026-08-30T00:00:00.000Z');
  const observedAt = resetAt - 60 * 60 * 1000;

  assert.deepEqual(
    codexQuotaObservationsFromLimit(limit(observedAt, resetAt, 42)),
    [{
      provider: 'codex',
      seriesKey: 'codex',
      observedAt,
      resetAt,
      usedPercent: 42,
    }],
  );
  assert.deepEqual(
    codexQuotaObservationsFromLimit(
      limit(observedAt, resetAt, 42, { windowMinutes: 300 }),
    ),
    [],
  );
  assert.deepEqual(
    codexQuotaObservationsFromLimit(
      limit(observedAt, resetAt, 42, { limitId: 'codex-spark' }),
    ),
    [],
  );
  assert.deepEqual(
    codexQuotaObservationsFromLimit(
      limit(observedAt, resetAt, 42, {
        limitId: 'codex-spark',
        limitName: 'Codex',
      }),
    ),
    [],
  );
});

test('irregular reset boundaries survive polling compaction', () => {
  const firstReset = Date.parse('2026-08-28T11:00:00.000Z');
  const secondReset = Date.parse('2026-08-30T07:00:00.000Z');
  const history = appendCodexQuotaHistory([], [
    {
      provider: 'codex',
      seriesKey: 'codex',
      observedAt: firstReset - 3 * 60 * 60 * 1000,
      resetAt: firstReset,
      usedPercent: 12,
    },
    {
      provider: 'codex',
      seriesKey: 'codex',
      observedAt: firstReset - 30 * 60 * 1000,
      resetAt: firstReset,
      usedPercent: 38,
    },
    {
      provider: 'codex',
      seriesKey: 'codex',
      observedAt: secondReset - 2 * 60 * 60 * 1000,
      resetAt: secondReset,
      usedPercent: 7,
    },
  ]);

  assert.deepEqual(history, [
    {
      provider: 'codex',
      seriesKey: 'codex',
      observedAt: firstReset - 30 * 60 * 1000,
      resetAt: firstReset,
      usedPercent: 38,
    },
    {
      provider: 'codex',
      seriesKey: 'codex',
      observedAt: secondReset - 2 * 60 * 60 * 1000,
      resetAt: secondReset,
      usedPercent: 7,
    },
  ]);

  const weekly = weeklyQuotaObservationsFromCodexHistory(history);
  assert.equal(weekly.length, 2);
  assert.equal(weekly.every((item) => item.sourceKey === undefined), true);
  assert.equal(Object.prototype.hasOwnProperty.call(weekly[0], 'account'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(weekly[0], 'sourceKey'), false);
});

test('quota history remains bounded even when resets are numerous', () => {
  const additions = Array.from({ length: CODEX_QUOTA_HISTORY_LIMIT + 17 }, (_, index) => ({
    provider: 'codex' as const,
    seriesKey: 'codex' as const,
    observedAt: 1_700_000_000_000 + index * 7 * 24 * 60 * 60 * 1000,
    resetAt: 1_700_000_100_000 + index * 7 * 24 * 60 * 60 * 1000,
    usedPercent: index % 101,
  }));

  const history = appendCodexQuotaHistory([], additions);
  assert.equal(history.length, CODEX_QUOTA_HISTORY_LIMIT);
  assert.equal(history[0].resetAt < history[history.length - 1].resetAt, true);
});
test('malformed percentages are rejected rather than persisted as zero or full usage', () => {
  const RESET = Date.parse('2026-10-19T12:00:00Z');
  const NOW = RESET - 1000;
  for (const usedPercent of [-1, 101, NaN, Infinity]) {
    const row = { provider: 'codex' as const, seriesKey: 'codex' as const,
      observedAt: NOW, resetAt: RESET, usedPercent };
    assert.deepEqual(appendCodexQuotaHistory([], [row]), []);
    assert.deepEqual(codexQuotaObservationsFromLimit(limit(NOW, RESET, usedPercent)), []);
  }
});
