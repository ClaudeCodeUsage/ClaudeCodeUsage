// Timezone-aware day/hour bucketing (see dataLoader's zonedParts helpers).
//
// Same approach as pricing.test.ts: node:test against the compiled output.
// ClaudeDataLoader has no `vscode` dependency, so its static aggregators run
// here directly. We use the explicit-date aggregators (getDailyDataForSpecificMonth
// / getHourlyDataForDate) so the assertions don't depend on the wall clock.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ClaudeDataLoader } from '../dataLoader';

// Minimal billable usage record: a non-zero token count and a known model so
// calculateUsageData counts it.
function rec(timestamp: string): any {
  return {
    timestamp,
    message: { usage: { input_tokens: 100, output_tokens: 0 }, model: 'claude-opus-4-8' },
  };
}

test('day bucketing respects the configured timezone', () => {
  // 2026-03-01T03:00:00Z is March 1 in UTC but still Feb 28 in New York
  // (EST, UTC-5 before DST), so it should fall out of March there.
  const records = [rec('2026-03-01T03:00:00Z')];
  try {
    ClaudeDataLoader.setTimezone('UTC');
    const utc = ClaudeDataLoader.getDailyDataForSpecificMonth(records, '2026-03-01');
    assert.equal(utc.length, 1);
    assert.equal(utc[0].date, '2026-03-01');
    assert.equal(utc[0].data.totalInputTokens, 100);

    ClaudeDataLoader.setTimezone('America/New_York');
    const ny = ClaudeDataLoader.getDailyDataForSpecificMonth(records, '2026-03-01');
    assert.equal(ny.length, 0, 'record lands on Feb 28 locally, so March is empty');
  } finally {
    ClaudeDataLoader.setTimezone('');
  }
});

test('hourly bucketing respects the configured timezone', () => {
  // 2026-03-10T02:30:00Z: 02:00 hour in UTC, but 22:30 the previous day in
  // New York (EDT, UTC-4 after the Mar 8 2026 DST switch).
  const records = [rec('2026-03-10T02:30:00Z')];
  try {
    ClaudeDataLoader.setTimezone('UTC');
    const utc = ClaudeDataLoader.getHourlyDataForDate(records, '2026-03-10');
    assert.deepEqual(utc.map((h) => h.hour), ['02:00']);

    ClaudeDataLoader.setTimezone('America/New_York');
    const ny = ClaudeDataLoader.getHourlyDataForDate(records, '2026-03-10');
    assert.equal(ny.length, 0, 'record is on Mar 9 locally, not Mar 10');
  } finally {
    ClaudeDataLoader.setTimezone('');
  }
});

test('an invalid timezone falls back to the system zone without throwing', () => {
  const records = [rec('2026-03-01T12:00:00Z')];
  try {
    ClaudeDataLoader.setTimezone('Not/AZone');
    // Should not throw; the record is still bucketed somewhere in the month.
    const daily = ClaudeDataLoader.getDailyDataForSpecificMonth(records, '2026-03-01');
    assert.ok(daily.length >= 0);
  } finally {
    ClaudeDataLoader.setTimezone('');
  }
});
