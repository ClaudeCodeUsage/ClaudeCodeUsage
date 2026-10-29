import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { rollingSevenDay, type RollingSevenDayInput, type RollingDayObservation } from '../rollingSevenDay';

const complete = (day: string, units = 1n): RollingDayObservation => ({ day, coverage: 'complete', units });
const january = (count: number, units = 1n): RollingDayObservation[] =>
  Array.from({ length: count }, (_, i) => complete(`2026-01-${String(i + 1).padStart(2, '0')}`, units));
const run = (days: readonly RollingDayObservation[], asOfDay = '2026-01-09', historyStartDay = '2026-01-01') =>
  rollingSevenDay({ days, asOfDay, historyStartDay });

test('live seven civil days cross Monday; closed rolling peak excludes today', () => {
  const result = run([...january(8), complete('2026-01-09', 1000n)]);
  assert.equal(result.recent.phase, 'live');
  assert.equal(result.recent.startDay, '2026-01-03');
  assert.equal(result.recent.endDay, '2026-01-09');
  assert.deepEqual(result.recent.value, { status: 'exact', units: 1006n, knownSubtotal: 1006n });
  assert.equal(result.history.exactWindowPeak?.startDay, '2026-01-01');
  assert.equal(result.history.exactWindowPeak?.endDay, '2026-01-07');
  assert.equal(result.history.exactWindowPeak?.phase, 'closed');
  assert.equal(result.history.globalPeakExact, true);
  assert.equal(result.history.eligibleWindowCount, 2);
});

test('calendar arithmetic crosses leap day and year boundaries', () => {
  assert.equal(run([], '2024-03-03', '2024-02-01').recent.startDay, '2024-02-26');
  assert.equal(run([], '2025-03-03', '2025-02-01').recent.startDay, '2025-02-25');
  assert.equal(run([], '2026-01-03', '2025-12-01').recent.startDay, '2025-12-28');
  const days = ['2024-02-25', '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'].map(d => complete(d));
  assert.equal(run(days, '2024-03-03', '2024-02-25').history.exactWindowPeak?.value.knownSubtotal, 7n);
});

test('missing and explicit unknown days do not become exact zero', () => {
  const result = run([complete('2026-01-03', 4n), { day: '2026-01-04', coverage: 'unknown' }]);
  assert.deepEqual(result.recent.coverage, { completeDays: 1, partialDays: 0, unknownDays: 6 });
  assert.deepEqual(result.recent.value, { status: 'lower-bound', knownSubtotal: 4n });
  assert.equal(result.history.exactWindowPeak, null);
  assert.equal(result.history.globalPeakExact, false);
  assert.equal(result.history.verifiedSubtotalPeak?.endDay, '2026-01-07');
});

test('explicit complete zero is exact; partial zero is a known lower bound', () => {
  assert.deepEqual(run(january(9, 0n)).recent.value, { status: 'exact', units: 0n, knownSubtotal: 0n });
  const result = run([{ day: '2026-01-03', coverage: 'partial', units: 0n }]);
  assert.deepEqual(result.recent.value, { status: 'lower-bound', knownSubtotal: 0n });
  assert.equal(result.recent.coverage.partialDays, 1);
  assert.equal(result.history.verifiedSubtotalPeak?.value.knownSubtotal, 0n);
  assert.equal(result.history.globalPeakExact, false);
});

test('no known observations yields unknown, with no invented subtotal peak', () => {
  for (const days of [[], [{ day: '2026-01-02', coverage: 'unknown' } as const]]) {
    const result = run(days);
    assert.deepEqual(result.recent.value, { status: 'unknown', knownSubtotal: null });
    assert.equal(result.history.verifiedSubtotalPeak, null);
    assert.equal(result.history.exactWindowPeak, null);
    assert.equal(result.history.coverage, 'unknown');
  }
});

test('fewer than seven closed days cannot produce a closed peak', () => {
  const result = run(january(7), '2026-01-07');
  assert.equal(result.history.eligibleWindowCount, 0);
  assert.equal(result.history.exactWindowPeak, null);
  assert.equal(result.history.verifiedSubtotalPeak, null);
  assert.equal(result.history.globalPeakExact, false);
  assert.equal(run([], '2026-01-09', '2026-01-09').history.coverage, 'no-closed-days');
});

test('complete window peak is distinct from a larger partial subtotal peak', () => {
  const result = run([...january(7), { day: '2026-01-08', coverage: 'partial', units: 100n }]);
  assert.equal(result.history.exactWindowPeak?.value.knownSubtotal, 7n);
  assert.equal(result.history.verifiedSubtotalPeak?.value.knownSubtotal, 106n);
  assert.equal(result.history.verifiedSubtotalPeak?.startDay, '2026-01-02');
  assert.equal(result.history.coverage, 'partial');
  assert.equal(result.history.globalPeakExact, false);
});

test('a gap after a complete peak prevents claiming the historical maximum is exact', () => {
  const result = run(january(7), '2026-01-20');
  assert.equal(result.history.exactWindowPeak?.value.knownSubtotal, 7n);
  assert.equal(result.history.globalPeakExact, false);
  assert.equal(result.history.closedDayCount, 19);
});

test('equal maxima retain earliest witness even when its end date is absent', () => {
  const result = run([complete('2026-01-10', 5n), complete('2026-01-02', 5n)], '2026-01-20');
  assert.equal(result.history.verifiedSubtotalPeak?.startDay, '2026-01-01');
  assert.equal(result.history.verifiedSubtotalPeak?.endDay, '2026-01-07');
  assert.equal(result.history.verifiedSubtotalPeak?.value.knownSubtotal, 5n);
});

test('out-of-order frozen inputs are unchanged and bigint sums remain exact', () => {
  const units = 10n ** 45n + 3n;
  const days = Object.freeze(january(9, units).reverse().map(row => Object.freeze(row)));
  const before = days.map(row => ({ ...row }));
  const input = Object.freeze({ days, asOfDay: '2026-01-09', historyStartDay: '2026-01-01' });
  assert.deepEqual(rollingSevenDay(input).recent.value, { status: 'exact', units: units * 7n, knownSubtotal: units * 7n });
  assert.deepEqual(days, before);
  assert.deepEqual(rollingSevenDay(input), run(january(9, units)));
});

test('rejects invalid date labels, including non-leap century and date normalization', () => {
  for (const day of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '0000-01-01', '10000-01-01', '', null]) {
    assert.throws(() => run([complete(day as string)]), /INVALID_DAY/);
    assert.throws(() => run([], day as string), /INVALID_DAY/);
  }
  assert.doesNotThrow(() => run([complete('2000-02-29')], '2000-03-01', '2000-02-01'));
  assert.throws(() => run([], '0001-01-06', '0001-01-01'), /DATE_RANGE/);
  assert.equal(run([], '0001-01-07', '0001-01-01').recent.startDay, '0001-01-01');
});

test('rejects duplicate, future and out-of-scope days deterministically', () => {
  assert.throws(() => run([complete('2026-01-02'), complete('2026-01-01'), complete('2026-01-02')]), /DUPLICATE_DAY/);
  assert.throws(() => run([complete('2026-01-10')]), /FUTURE_DAY/);
  assert.throws(() => run([complete('2025-12-31')]), /BEFORE_HISTORY/);
  assert.throws(() => run([], '2026-01-09', '2026-01-10'), /DATE_RANGE/);
  assert.throws(() => run([], '2026-01-09', 'invalid'), /INVALID_DAY/);
});

test('rejects invalid units and coverage instead of coercing them', () => {
  for (const units of [-1n, 1, 1.5, '1', NaN, Infinity, null, undefined]) {
    for (const coverage of ['complete', 'partial']) {
      assert.throws(() => run([{ day: '2026-01-01', coverage, units } as RollingDayObservation]), /INVALID_UNITS/);
    }
  }
  for (const row of [null, {}, { day: '2026-01-01', coverage: 'bogus', units: 1n },
    { day: '2026-01-01', coverage: 'unknown', units: 0n }]) {
    assert.throws(() => run([row as RollingDayObservation]), /INVALID_/);
  }
  assert.throws(() => rollingSevenDay(null as unknown as RollingSevenDayInput), /INVALID_INPUT/);
  assert.throws(() => run(null as unknown as RollingDayObservation[]), /INVALID_INPUT/);
});

test('sparse ancient gaps do not expand into dense history or output', () => {
  const result = run([complete('0001-01-01', 8n), complete('9999-12-30', 9n)], '9999-12-31', '0001-01-01');
  assert.equal(result.history.verifiedSubtotalPeak?.endDay, '9999-12-30');
  assert.equal(result.history.verifiedSubtotalPeak?.value.knownSubtotal, 9n);
  assert.equal(result.history.exactWindowPeak, null);
  assert.equal(result.recent.value.knownSubtotal, 9n);
  assert.ok(JSON.stringify(result, (_, value) => typeof value === 'bigint' ? String(value) : value).length < 2000);
});

test('DST transition labels are pure civil arithmetic without Date or Intl conversion', () => {
  const originalDate = globalThis.Date;
  const originalFormatter = Intl.DateTimeFormat;
  try {
    globalThis.Date = new Proxy(originalDate, { construct() { throw new Error('Date forbidden'); }, get() { throw new Error('Date forbidden'); } });
    Intl.DateTimeFormat = new Proxy(originalFormatter, { construct() { throw new Error('Intl forbidden'); } });
    assert.equal(run([], '2026-03-10', '2026-03-01').recent.startDay, '2026-03-04');
    assert.equal(run([], '2026-11-03', '2026-10-01').recent.startDay, '2026-10-28');
  } finally {
    globalThis.Date = originalDate;
    Intl.DateTimeFormat = originalFormatter;
  }
});

test('changing asOfDay rolls the live window and closes yesterday without a timer', () => {
  const days = january(8);
  assert.equal(run(days, '2026-01-08').history.eligibleWindowCount, 1);
  assert.equal(run(days, '2026-01-09').history.eligibleWindowCount, 2);
  assert.equal(run(days, '2026-01-09').recent.value.status, 'lower-bound');
});

test('array holes are invalid rows with a stable rejection code', () => {
  assert.throws(() => run(new Array<RollingDayObservation>(1)), { name: 'TypeError', message: 'INVALID_ROW' });
});

test('bounded scan agrees with exhaustive windows for every four-state eight-day history', () => {
  // 4^8 histories cover missing, complete zero, complete positive and partial
  // positive days. The reference deliberately enumerates every eligible window
  // in this SMALL fixture; production must not enumerate unobserved history.
  const labels = Array.from({ length: 14 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  for (let pattern = 0; pattern < 4 ** 8; pattern++) {
    let bits = pattern;
    const rows: RollingDayObservation[] = [];
    for (let i = 0; i < 8; i++) {
      const state = bits % 4;
      bits = Math.floor(bits / 4);
      if (state) rows.push({ day: labels[i], coverage: state === 3 ? 'partial' : 'complete', units: state === 1 ? 0n : BigInt(i % 3 + 1) });
    }
    type Witness = { startDay: string; endDay: string; subtotal: bigint };
    let exact: Witness | null = null;
    let subtotal: Witness | null = null;
    for (let end = 6; end < 13; end++) {
      const present = rows.filter(row => row.day >= labels[end - 6] && row.day <= labels[end]);
      const sum = present.reduce((total, row) => total + (row.units ?? 0n), 0n);
      const witness = { startDay: labels[end - 6], endDay: labels[end], subtotal: sum };
      if (present.length && (subtotal === null || sum > subtotal.subtotal)) subtotal = witness;
      if (present.length === 7 && present.every(row => row.coverage === 'complete') && (exact === null || sum > exact.subtotal)) exact = witness;
    }
    const result = run(rows.reverse(), labels[13]);
    for (const [actual, expected] of [[result.history.exactWindowPeak, exact], [result.history.verifiedSubtotalPeak, subtotal]] as const) {
      assert.deepEqual(actual && { startDay: actual.startDay, endDay: actual.endDay, subtotal: actual.value.knownSubtotal }, expected, `pattern ${pattern}`);
    }
    assert.equal(result.history.globalPeakExact, false); // days 9..13 are absent
  }
});
