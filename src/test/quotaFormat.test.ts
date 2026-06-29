// Tests for the clean quota status-bar formatter (V2.2 Phase 3.3/3.4). Pure
// module — runs under node:test directly.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { compactReset, formatQuotaStatusText, worstShownUtilisation } from '../quotaFormat';

const NOW = 1_700_000_000_000;
const at = (ms: number): string => new Date(NOW + ms).toISOString();
const H = 3_600_000;

const live = {
  five_hour: { utilization: 6, resets_at: at(4.8 * H) },
  seven_day: { utilization: 1, resets_at: at(38.4 * H) }, // 1.6 days
  seven_day_opus: { utilization: 12, resets_at: at(50 * H) },
};

test('default format is clean: "5h 6% · wk 1%" (no reset, middot)', () => {
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: false, showOpusWeekly: false, now: NOW });
  assert.equal(s, '5h 6% · wk 1%');
});

test('showResetInStatusBar adds compact countdowns with a bar separator', () => {
  const s = formatQuotaStatusText(live, { showReset: true, fiveHourOnly: false, showOpusWeekly: false, now: NOW });
  assert.equal(s, '5h 6% ↻4.8h | wk 1% ↻1.6d');
});

test('quotaFiveHourOnly shows only the 5-hour window', () => {
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: true, showOpusWeekly: false, now: NOW });
  assert.equal(s, '5h 6%');
});

test('showOpusWeekly appends the weekly Opus segment', () => {
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: false, showOpusWeekly: true, now: NOW });
  assert.equal(s, '5h 6% · wk 1% · opus 12%');
});

test('fiveHourOnly suppresses Opus even when showOpusWeekly is on', () => {
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: true, showOpusWeekly: true, now: NOW });
  assert.equal(s, '5h 6%');
});

test('no windows → empty string (caller hides the item)', () => {
  assert.equal(formatQuotaStatusText(null, { showReset: false, fiveHourOnly: false, showOpusWeekly: false }), '');
  assert.equal(formatQuotaStatusText({}, { showReset: true, fiveHourOnly: false, showOpusWeekly: false }), '');
});

test('compactReset: hours under a day, days beyond, 0h past, "" invalid', () => {
  assert.equal(compactReset(at(4.8 * H), NOW), '4.8h');
  assert.equal(compactReset(at(38.4 * H), NOW), '1.6d');
  assert.equal(compactReset(at(-1 * H), NOW), '0h');
  assert.equal(compactReset('not-a-date', NOW), '');
});

test('worstShownUtilisation honours fiveHourOnly and showOpusWeekly', () => {
  assert.equal(worstShownUtilisation(live, { showReset: false, fiveHourOnly: false, showOpusWeekly: false }), 6);
  assert.equal(worstShownUtilisation(live, { showReset: false, fiveHourOnly: false, showOpusWeekly: true }), 12);
  assert.equal(worstShownUtilisation(live, { showReset: false, fiveHourOnly: true, showOpusWeekly: true }), 6);
});
