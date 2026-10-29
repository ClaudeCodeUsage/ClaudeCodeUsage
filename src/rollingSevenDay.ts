/** Already-normalized Gregorian civil days, YYYY-MM-DD, years 0001..9999.
 * Complete means exact at the supplied snapshot; partial units are a verified
 * nonnegative subtotal. Unknown carries no numeric evidence. Missing rows are
 * unknown too: only a host adapter with proof may supply complete zero rows.
 */
export type RollingDayObservation =
  | { readonly day: string; readonly coverage: 'complete' | 'partial'; readonly units: bigint }
  | { readonly day: string; readonly coverage: 'unknown'; readonly units?: never };

export interface RollingSevenDayInput {
  readonly asOfDay: string;
  /** Inclusive boundary of the supplied history, not a claim of account inception.
   * All rows must lie in [historyStartDay, asOfDay]. */
  readonly historyStartDay: string;
  readonly days: readonly RollingDayObservation[];
}

export type RollingWindowValue =
  | { readonly status: 'exact'; readonly units: bigint; readonly knownSubtotal: bigint }
  | { readonly status: 'lower-bound'; readonly knownSubtotal: bigint }
  | { readonly status: 'unknown'; readonly knownSubtotal: null };

export interface RollingSevenDayWindow {
  readonly startDay: string;
  readonly endDay: string;
  readonly phase: 'live' | 'closed';
  readonly coverage: {
    readonly completeDays: number;
    readonly partialDays: number;
    /** Includes absent rows, even days preceding historyStartDay in recent. */
    readonly unknownDays: number;
  };
  readonly value: RollingWindowValue;
}

export interface RollingSevenDayResult {
  /** Always [asOfDay - 6 civil days, asOfDay]. Even exact snapshot evidence is
   * live: it does not establish the eventual full-day total for today. */
  readonly recent: RollingSevenDayWindow;
  readonly history: {
    readonly startDay: string;
    /** Exclusive: no window in either peak includes today. */
    readonly endDayExclusive: string;
    readonly closedDayCount: number;
    readonly eligibleWindowCount: number;
    readonly coverage: 'complete' | 'partial' | 'unknown' | 'no-closed-days';
    /** Largest exact sum among windows with seven complete daily observations.
     * Null means no such window, not a zero maximum. */
    readonly exactWindowPeak: RollingSevenDayWindow | null;
    /** Largest known subtotal among eligible windows with at least one complete
     * or partial observation. Its witness locates that subtotal, NOT necessarily
     * the true maximum. May itself be an exact window, but does not certify the
     * global peak. Explicit known zero qualifies; all-unknown windows do not. */
    readonly verifiedSubtotalPeak: RollingSevenDayWindow | null;
    /** True only with >=7 closed days and complete evidence for EVERY day of
     * the supplied interval. Never certifies history outside that interval. */
    readonly globalPeakExact: boolean;
  };
}

type CivilDay = { year: number; month: number; day: number; ordinal: number };
type SortedDay = { ordinal: number; coverage: RollingDayObservation['coverage']; units: bigint };
type Tally = { complete: number; partial: number; subtotal: bigint };
const emptyTally = (): Tally => ({ complete: 0, partial: 0, subtotal: 0n });
const daysBeforeYear = (year: number): number => {
  const prior = year - 1;
  return prior * 365 + Math.floor(prior / 4) - Math.floor(prior / 100) + Math.floor(prior / 400);
};
function monthLength(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function parseDay(value: unknown): CivilDay {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('INVALID_DAY');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthLength(year, month)) {
    throw new RangeError('INVALID_DAY');
  }
  let ordinal = daysBeforeYear(year) + day - 1;
  for (let m = 1; m < month; m++) ordinal += monthLength(year, m);
  return { year, month, day, ordinal };
}
/** Integer civil arithmetic only; no timestamps, host timezone, Date or Intl. */
function dayLabel(ordinal: number): string {
  let low = 1, high = 10000;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (daysBeforeYear(middle) <= ordinal) low = middle;
    else high = middle;
  }
  let remaining = ordinal - daysBeforeYear(low), month = 1;
  while (remaining >= monthLength(low, month)) remaining -= monthLength(low, month++);
  return `${String(low).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(remaining + 1).padStart(2, '0')}`;
}
function add(tally: Tally, row: SortedDay, direction: 1 | -1): void {
  if (row.coverage === 'unknown') return;
  if (row.coverage === 'complete') tally.complete += direction;
  else tally.partial += direction;
  tally.subtotal += BigInt(direction) * row.units;
}
function windowAt(end: number, tally: Tally, phase: 'live' | 'closed'): RollingSevenDayWindow {
  const value: RollingWindowValue = tally.complete === 7
    ? { status: 'exact', units: tally.subtotal, knownSubtotal: tally.subtotal }
    : tally.complete + tally.partial > 0
      ? { status: 'lower-bound', knownSubtotal: tally.subtotal }
      : { status: 'unknown', knownSubtotal: null };
  return {
    startDay: dayLabel(end - 6), endDay: dayLabel(end), phase,
    coverage: { completeDays: tally.complete, partialDays: tally.partial, unknownDays: 7 - tally.complete - tally.partial },
    value,
  };
}

/** Pure numeric foundation; callers choose one common unit/scale and prove the
 * normalized daily evidence. No price conversion, rounding, I/O, caches or timers.
 * Caller cache keys MUST include asOfDay as well as evidence revision, history
 * boundary, unit/scale and normalization context (including its chosen timezone).
 *
 * Rejects invalid input with stable error codes, never an invented zero result.
 * Validation order: input shape, asOfDay, historyStartDay, range, then each row
 * in input order (shape/date/range/coverage/units), then sorted duplicate dates.
 * asOfDay must be >=0001-01-07 so recent can always contain seven valid labels.
 *
 * O(N log N) sort plus one O(N) sliding scan. Apart from the sorted copy, working
 * state is <=7 daily rows, two peak witnesses and fixed counters. No walk across
 * absent dates. Between observed dates a nonnegative subtotal can only decrease;
 * therefore evaluate the first eligible end and observed ends only. This also
 * preserves the earliest witness on ties, including an absent first end date.
 * Exact windows necessarily end on an observed complete date. */
export function rollingSevenDay(input: RollingSevenDayInput): RollingSevenDayResult {
  if (!input || typeof input !== 'object' || !Array.isArray(input.days)) throw new TypeError('INVALID_INPUT');
  const asOf = parseDay(input.asOfDay).ordinal;
  const start = parseDay(input.historyStartDay).ordinal;
  if (asOf < 6 || start > asOf) throw new RangeError('DATE_RANGE');
  const rows: SortedDay[] = Array.from(input.days, row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('INVALID_ROW');
    const ordinal = parseDay(row.day).ordinal;
    if (ordinal > asOf) throw new RangeError('FUTURE_DAY');
    if (ordinal < start) throw new RangeError('BEFORE_HISTORY');
    if (!['complete', 'partial', 'unknown'].includes(row.coverage)) throw new TypeError('INVALID_COVERAGE');
    if (row.coverage === 'unknown') {
      if ('units' in row) throw new TypeError('INVALID_UNITS');
      // Internal additive identity only; coverage prevents exposing it as evidence.
      return { ordinal, coverage: row.coverage, units: 0n };
    }
    if (typeof row.units !== 'bigint' || row.units < 0n) throw new TypeError('INVALID_UNITS');
    return { ordinal, coverage: row.coverage, units: row.units };
  });
  rows.sort((a, b) => a.ordinal - b.ordinal);

  const recent = emptyTally(), closed = emptyTally();
  const queue: SortedDay[] = [];
  let exactWindowPeak: RollingSevenDayWindow | null = null;
  let verifiedSubtotalPeak: RollingSevenDayWindow | null = null;
  let completeClosedDays = 0, knownClosedDays = 0;
  const firstEnd = start + 6;
  let firstEndEvaluated = false;
  const evict = (end: number): void => {
    while (queue.length && queue[0].ordinal < end - 6) add(closed, queue.shift()!, -1);
  };
  const consider = (end: number): void => {
    evict(end);
    if (closed.complete + closed.partial > 0 &&
        (verifiedSubtotalPeak === null || closed.subtotal > verifiedSubtotalPeak.value.knownSubtotal!)) {
      verifiedSubtotalPeak = windowAt(end, closed, 'closed');
    }
    if (closed.complete === 7 && (exactWindowPeak === null || closed.subtotal > exactWindowPeak.value.knownSubtotal!)) {
      exactWindowPeak = windowAt(end, closed, 'closed');
    }
  };
  let previous = -1;
  for (const row of rows) {
    if (row.ordinal === previous) throw new RangeError('DUPLICATE_DAY');
    previous = row.ordinal;
    if (row.ordinal >= asOf - 6) add(recent, row, 1);
    if (row.ordinal === asOf) continue;
    if (!firstEndEvaluated && row.ordinal > firstEnd) {
      consider(firstEnd);
      firstEndEvaluated = true;
    }
    evict(row.ordinal);
    queue.push(row);
    add(closed, row, 1);
    if (row.coverage === 'complete') completeClosedDays++;
    if (row.coverage !== 'unknown') knownClosedDays++;
    if (row.ordinal >= firstEnd) {
      consider(row.ordinal);
      firstEndEvaluated = true;
    }
  }
  if (!firstEndEvaluated && firstEnd < asOf) consider(firstEnd);
  const closedDayCount = asOf - start;
  const coverage = closedDayCount === 0 ? 'no-closed-days'
    : completeClosedDays === closedDayCount ? 'complete' : knownClosedDays ? 'partial' : 'unknown';
  return {
    recent: windowAt(asOf, recent, 'live'),
    history: {
      startDay: input.historyStartDay, endDayExclusive: input.asOfDay, closedDayCount,
      eligibleWindowCount: Math.max(0, closedDayCount - 6), coverage,
      exactWindowPeak, verifiedSubtotalPeak,
      globalPeakExact: closedDayCount >= 7 && coverage === 'complete',
    },
  };
}
