// Tests for the clean quota status-bar formatter (V2.2 Phase 3.3/3.4). Pure
// module — runs under node:test directly.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  compactReset,
  formatMonthlyReset,
  formatQuotaStatusText,
  formatResetCell,
  formatSharePercent,
  wallClockReset,
  worstShownUtilisation,
} from '../quotaFormat';
import { QuotaWindow } from '../quotaWindows';

const NOW = 1_700_000_000_000;
const at = (ms: number): string => new Date(NOW + ms).toISOString();
const H = 3_600_000;
/** Local "HH:MM", matching what wallClockReset emits for a same-day reset. */
const formatTime = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const live: QuotaWindow[] = [
  { kind: 'session', utilization: 6, resetsAt: at(4.8 * H), isActive: false },
  { kind: 'weekly_all', utilization: 1, resetsAt: at(38.4 * H), isActive: false }, // 1.6 days
  { kind: 'weekly_scoped', scopeLabel: 'Fable', utilization: 12, resetsAt: at(38.4 * H), isActive: true },
];

test('default format is clean: "5h 6% · wk 1%" (no reset, middot)', () => {
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: false, showScopedWeekly: false, now: NOW });
  assert.equal(s, '5h 6% · wk 1%');
});

test('showResetInStatusBar adds compact countdowns with a bar separator', () => {
  const s = formatQuotaStatusText(live, { showReset: true, fiveHourOnly: false, showScopedWeekly: false, now: NOW });
  assert.equal(s, '5h 6% ↻4.8h | wk 1% ↻1.6d');
});

test('quotaFiveHourOnly shows only the 5-hour window', () => {
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: true, showScopedWeekly: false, now: NOW });
  assert.equal(s, '5h 6%');
});

test('showScopedWeekly nests the cap in the weekly segment, named by the API', () => {
  // Lowercased to sit with the "5h" / "wk" segments, and parenthesised because it
  // shares the weekly reset — the retired showOpusWeekly instead appended a
  // separate "opus 12%" segment with its own duplicate countdown.
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: false, showScopedWeekly: true, now: NOW });
  assert.equal(s, '5h 6% · wk 1% (fable 12%)');
});

test('the shared weekly countdown is printed once, not per cap', () => {
  // The reported bug: "wk 9% ↻3d 5h | fable 17% ↻3d 5h" spent the bar's width
  // saying the same countdown twice.
  const s = formatQuotaStatusText(live, { showReset: true, fiveHourOnly: false, showScopedWeekly: true, now: NOW });
  assert.equal(s, '5h 6% ↻4.8h | wk 1% (fable 12%) ↻1.6d');
});

test('showScopedWeekly nests every scoped window that shares the weekly reset', () => {
  const two: QuotaWindow[] = [
    ...live,
    { kind: 'weekly_scoped', scopeLabel: 'Cowork', utilization: 3, resetsAt: at(38.4 * H), isActive: false },
  ];
  const s = formatQuotaStatusText(two, { showReset: false, fiveHourOnly: false, showScopedWeekly: true, now: NOW });
  assert.equal(s, '5h 6% · wk 1% (fable 12% · cowork 3%)');
});

test('a cap on its own schedule stays a separate segment with its own countdown', () => {
  const odd: QuotaWindow[] = [
    live[0],
    live[1],
    { kind: 'weekly_scoped', scopeLabel: 'Cowork', utilization: 3, resetsAt: at(4 * H), isActive: false },
  ];
  const s = formatQuotaStatusText(odd, { showReset: true, fiveHourOnly: false, showScopedWeekly: true, now: NOW });
  assert.equal(s, '5h 6% ↻4.8h | wk 1% ↻1.6d | cowork 3% ↻4.0h');
});

test('a scoped window with no scope name falls back to a generic label', () => {
  const anon: QuotaWindow[] = [{ kind: 'weekly_scoped', utilization: 9, resetsAt: at(H), isActive: false }];
  const s = formatQuotaStatusText(anon, { showReset: false, fiveHourOnly: false, showScopedWeekly: true, now: NOW });
  assert.equal(s, 'wk* 9%');
});

test('fiveHourOnly suppresses scoped weeklies even when showScopedWeekly is on', () => {
  const s = formatQuotaStatusText(live, { showReset: false, fiveHourOnly: true, showScopedWeekly: true, now: NOW });
  assert.equal(s, '5h 6%');
});

test('no windows → empty string (caller hides the item)', () => {
  assert.equal(formatQuotaStatusText(null, { showReset: false, fiveHourOnly: false, showScopedWeekly: false }), '');
  assert.equal(formatQuotaStatusText([], { showReset: true, fiveHourOnly: false, showScopedWeekly: false }), '');
});

test('a window with no reset time prints its share and no countdown', () => {
  // The session window before the first message of a period: /usage shows
  // "Starts when a message is sent", so there is nothing to count down to.
  const fresh: QuotaWindow[] = [{ kind: 'session', utilization: 0, resetsAt: '', isActive: false }];
  assert.equal(formatQuotaStatusText(fresh, { showReset: true, fiveHourOnly: false, showScopedWeekly: false, now: NOW }), '5h 0%');
});

test('compactReset: hours under a day, days beyond, 0h past, "" invalid', () => {
  assert.equal(compactReset(at(4.8 * H), NOW), '4.8h');
  assert.equal(compactReset(at(38.4 * H), NOW), '1.6d');
  assert.equal(compactReset(at(-1 * H), NOW), '0h');
  assert.equal(compactReset('not-a-date', NOW), '');
});

test('compactReset: "units" format gives whole hour/minute or day/hour', () => {
  assert.equal(compactReset(at(4.8 * H), NOW, 'units'), '4h 48m');
  assert.equal(compactReset(at(38.4 * H), NOW, 'units'), '1d 14h');
  assert.equal(compactReset(at(0.5 * H), NOW, 'units'), '30m');
  assert.equal(compactReset(at(-1 * H), NOW, 'units'), '0m');
  assert.equal(compactReset('not-a-date', NOW, 'units'), '');
});

test('compactReset: "clock" format gives local time (< 24h) or local date (>= 24h)', () => {
  const soon = new Date(NOW + 4.8 * H);
  const later = new Date(NOW + 38.4 * H);
  const pad = (n: number) => String(n).padStart(2, '0');
  const expectedTime = `${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  const expectedDate = `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}`;
  assert.equal(compactReset(at(4.8 * H), NOW, 'clock'), expectedTime);
  assert.equal(compactReset(at(38.4 * H), NOW, 'clock'), expectedDate);
  assert.equal(compactReset('not-a-date', NOW, 'clock'), '');
});

test('showResetInStatusBar honours resetFormat', () => {
  const s = formatQuotaStatusText(live, {
    showReset: true,
    fiveHourOnly: false,
    showScopedWeekly: false,
    resetFormat: 'units',
    now: NOW,
  });
  assert.equal(s, '5h 6% ↻4h 48m | wk 1% ↻1d 14h');
});

// The tooltip's "Resets" column. It used to hardcode whole hour/minute units,
// so it disagreed with the status bar under every other resetCountdownFormat —
// including the default 'decimal' ("4.6h" in the bar, "4h 39m" in the tooltip).
// One helper now serves both, so they cannot drift apart again.

test('the tooltip reset countdown follows the countdown format', () => {
  assert.match(formatResetCell(at(4.8 * H), { format: 'decimal', now: NOW }), /^4\.8h \(/);
  assert.match(formatResetCell(at(4.8 * H), { format: 'units', now: NOW }), /^4h 48m \(/);
});

test('the tooltip reset cell defaults to decimal, matching the status bar default', () => {
  assert.match(formatResetCell(at(4.8 * H), { now: NOW }), /^4\.8h \(/);
});

test('every reset cell reads "time left (wall clock)" on one line', () => {
  // Including the 5-hour window: leaving it countdown-only was the odd one out.
  const session = formatResetCell(at(4.8 * H), { format: 'units', now: NOW });
  assert.match(session, /^4h 48m \(\d{2}:\d{2}\)$/);
  const weekly = formatResetCell(at(38.4 * H), { format: 'units', now: NOW });
  assert.match(weekly, /^1d 14h \(.+ \d{2}:\d{2}\)$/);
  assert.equal(/AM|PM/i.test(session + weekly), false);
});

test('the wall clock names the weekday only when the reset is not today', () => {
  const sameDay = new Date(NOW);
  sameDay.setHours(sameDay.getHours() + 1);
  const nextDay = new Date(NOW);
  nextDay.setDate(nextDay.getDate() + 1);
  // A 5-hour window crossing midnight still gets a weekday, and a weekly one
  // resetting later today does not: the rule follows the dates, not the window.
  assert.equal(wallClockReset(sameDay, NOW), formatTime(sameDay));
  assert.match(wallClockReset(nextDay, NOW), /^.+ \d{2}:\d{2}$/);
});

test('the wall clock uses a 24-hour cycle, never "24:00" at midnight', () => {
  const midnight = new Date(NOW);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  assert.match(wallClockReset(midnight, NOW), /00:00$/);
});

test('the clock format shows the wall clock without repeating it as a countdown', () => {
  const weekly = formatResetCell(at(38.4 * H), { format: 'clock', now: NOW });
  assert.equal(weekly.includes('('), false);
  assert.match(weekly, /\d{2}:\d{2}$/);
  assert.equal(formatResetCell(at(4.8 * H), { format: 'clock', now: NOW }), formatTime(new Date(NOW + 4.8 * H)));
});

test('a missing or unparseable reset cell renders an em dash', () => {
  assert.equal(formatResetCell('', { now: NOW }), '—');
  assert.equal(formatResetCell('not-a-date', { now: NOW }), '—');
});

test('the tooltip share shows no decimal for the whole percents the API sends', () => {
  assert.equal(formatSharePercent(8), '8%');
  assert.equal(formatSharePercent(16), '16%');
  assert.equal(formatSharePercent(0), '0%');
});

test('the tooltip share keeps one decimal when the value really has a fraction', () => {
  assert.equal(formatSharePercent(8.42), '8.4%');
  assert.equal(formatSharePercent(0.5), '0.5%');
});

test('the tooltip share clamps to 0-100', () => {
  assert.equal(formatSharePercent(-3), '0%');
  assert.equal(formatSharePercent(140), '100%');
});

test('worstShownUtilisation honours fiveHourOnly and showScopedWeekly', () => {
  assert.equal(worstShownUtilisation(live, { showReset: false, fiveHourOnly: false, showScopedWeekly: false }), 6);
  assert.equal(worstShownUtilisation(live, { showReset: false, fiveHourOnly: false, showScopedWeekly: true }), 12);
  assert.equal(worstShownUtilisation(live, { showReset: false, fiveHourOnly: true, showScopedWeekly: true }), 6);
});





test('the wall clock rounds to the nearest minute', () => {
  // …T23:59:59 is 17:00 local for every practical purpose. Truncating showed it
  // as 16:59, a minute off the sibling cap that resets at the same moment.
  const justBefore = new Date(NOW);
  justBefore.setHours(12, 59, 59, 500);
  assert.match(wallClockReset(justBefore, NOW), /13:00$/);
});

test('rounding up across midnight also moves the weekday', () => {
  const beforeMidnight = new Date(NOW);
  beforeMidnight.setHours(23, 59, 59, 500);
  // Rounds to 00:00 the next day, so the weekday must appear.
  assert.match(wallClockReset(beforeMidnight, NOW), /^.+ 00:00$/);
});

test('a monthly cap reset renders as a bare date, not a countdown', () => {
  const label = formatMonthlyReset(new Date(2026, 8, 1).toISOString());
  assert.equal(/\d{2}:\d{2}/.test(label), false);
  assert.match(label, /1/);
});

test('a missing monthly reset renders an em dash', () => {
  assert.equal(formatMonthlyReset(''), '—');
  assert.equal(formatMonthlyReset('not-a-date'), '—');
});
