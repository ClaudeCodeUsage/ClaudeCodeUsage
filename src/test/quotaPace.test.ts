import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  calculateQuotaPace,
  type QuotaPaceInput,
  type QuotaPaceObservation,
  type QuotaPaceResult,
  type QuotaPaceUnavailableReason,
} from '../quotaPace';

const HOUR = 3_600_000;
const WEEK = 168 * HOUR;
const START = Date.parse('2026-10-05T06:00:00Z');
const RESET = START + WEEK;
const OBSERVED = START + WEEK / 4;

function observation(overrides: Partial<QuotaPaceObservation> = {}): QuotaPaceObservation {
  return {
    observedAt: OBSERVED,
    resetAt: RESET,
    periodMs: WEEK,
    usedFraction: 0.29,
    source: 'observed',
    accountWindowTrust: 'trusted',
    ...overrides,
  };
}

function calculate(overrides: Partial<QuotaPaceObservation> = {}, now = OBSERVED): QuotaPaceResult {
  return calculateQuotaPace({ enabled: true, now, observation: observation(overrides) });
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

function unavailable(result: QuotaPaceResult, reason: QuotaPaceUnavailableReason): void {
  // No numeric presentation fields may leak through a rejected observation.
  assert.deepEqual(result, { status: 'unavailable', reason });
}

test('29% used at 25% elapsed forecasts 116%, with a four percentage-point deviation', () => {
  const result = calculate();
  assert.ok(result.status === 'ready');
  close(result.usedPercent, 29);
  close(result.referencePercent, 25);
  close(result.forecastPercent, 116);
  close(result.deviationPercentagePoints, 4);
  assert.equal(result.windowStart, START);
  assert.equal(result.observedAt, OBSERVED);
  assert.equal(result.resetAt, RESET);
});

test('24% elapsed uses the exact ratio rather than the comment example or integer rounding', () => {
  const observedAt = START + WEEK * 0.24;
  const result = calculate({ observedAt }, observedAt);
  assert.ok(result.status === 'ready');
  close(result.referencePercent, 24);
  close(result.forecastPercent, 120.83333333333333);
  close(result.deviationPercentagePoints, 5);
});

test('fractional usage and signed deviation retain precision for the UI', () => {
  const result = calculate({ usedFraction: 0.123456 });
  assert.ok(result.status === 'ready');
  close(result.usedPercent, 12.3456);
  close(result.forecastPercent, 49.3824);
  close(result.deviationPercentagePoints, -12.6544);
});

test('a cached repaint never replaces observedAt with now in any computed value', () => {
  assert.deepEqual(calculate({}, OBSERVED + 30 * 60_000), calculate());
});

test('first six hours expose reference and deviation but no forecast, including exact start', () => {
  for (const elapsed of [0, 1, HOUR, 6 * HOUR - 1]) {
    const observedAt = START + elapsed;
    const result = calculate({ observedAt, usedFraction: 0.1 }, observedAt);
    assert.ok(result.status === 'insufficient-sample');
    assert.equal(result.forecastPercent, null);
    close(result.referencePercent, elapsed / WEEK * 100);
    close(result.deviationPercentagePoints, 10 - elapsed / WEEK * 100);
  }
});

test('the exact six-hour boundary allows forecasting and does not cap it at 100%', () => {
  const observedAt = START + 6 * HOUR;
  const result = calculate({ observedAt, usedFraction: 0.1 }, observedAt);
  assert.ok(result.status === 'ready');
  close(result.forecastPercent, 280);
});

test('real observed zero and 100% are valid; forecast may exceed 100%', () => {
  for (const usedFraction of [0, 1]) {
    const result = calculate({ usedFraction });
    assert.ok(result.status === 'ready');
    close(result.forecastPercent, usedFraction * 400);
  }
});

test('OFF short circuits before reading the clock or observation', () => {
  const input: QuotaPaceInput = {
    enabled: false,
    get now(): number { throw new Error('clock must not be read'); },
    get observation(): QuotaPaceObservation { throw new Error('snapshot must not be read'); },
  };
  assert.deepEqual(calculateQuotaPace(input), { status: 'off' });
});

test('missing observation has no forecast', () => {
  unavailable(calculateQuotaPace({ enabled: true, now: OBSERVED, observation: null }), 'missing-observation');
});

test('strictly more than thirty minutes is stale; exactly thirty minutes is fresh', () => {
  assert.ok(calculate({}, OBSERVED + 30 * 60_000).status === 'ready');
  unavailable(calculate({}, OBSERVED + 30 * 60_000 + 1), 'stale-observation');
});

test('reset at or before now is expired even with a fresh snapshot', () => {
  for (const now of [RESET, RESET + 1]) {
    unavailable(calculate({ observedAt: RESET - 1 }, now), 'reset-passed');
  }
});

test('future observation fails closed without a clock-skew allowance', () => {
  unavailable(calculate({ observedAt: OBSERVED + 1 }), 'future-observation');
});

test('every non-finite time, duration and usage value fails closed', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    unavailable(calculate({}, value), 'invalid-number');
    for (const key of ['observedAt', 'resetAt', 'periodMs', 'usedFraction'] as const) {
      unavailable(calculate({ [key]: value }), 'invalid-number');
    }
  }
});

test('unknown reset or period cannot be inferred from a weekly label', () => {
  unavailable(calculate({ resetAt: null }), 'missing-reset');
  unavailable(calculate({ periodMs: null }), 'unknown-period');
});

test('only a known exact seven-day duration is accepted', () => {
  for (const periodMs of [0, -WEEK, 5 * HOUR, WEEK - 1, WEEK + 1]) {
    unavailable(calculate({ periodMs }), 'unsupported-period');
  }
});

test('observations outside their inferred window are rejected', () => {
  unavailable(calculate({ observedAt: START - 1 }, START - 1), 'invalid-window');
  unavailable(calculate({ observedAt: RESET }, RESET), 'reset-passed');
});

test('negative or out-of-Date-range timestamps and negative inferred start fail closed', () => {
  unavailable(calculate({}, -1), 'invalid-time');
  unavailable(calculate({}, 8_640_000_000_000_001), 'invalid-time');
  unavailable(calculate({ observedAt: -1 }), 'invalid-time');
  unavailable(calculate({ resetAt: 8_640_000_000_000_001 }), 'invalid-time');
  unavailable(calculate({ observedAt: 1, resetAt: WEEK - 1 }, 1), 'invalid-window');
});

test('invalid usage is rejected rather than clamped into a believable forecast', () => {
  for (const usedFraction of [-0.01, 1.01]) {
    unavailable(calculate({ usedFraction }), 'invalid-usage');
  }
});

test('ambiguous, unknown or discontinuous account/window evidence cannot forecast', () => {
  for (const accountWindowTrust of ['ambiguous', 'unknown', 'discontinuous'] as const) {
    unavailable(calculate({ accountWindowTrust }), 'untrusted-account-window');
  }
});

test('expired synthetic zero never acquires prediction authority', () => {
  unavailable(calculate({ source: 'synthetic-reset', usedFraction: 0 }), 'synthetic-observation');
});

test('runtime malformed enums, missing trust and coerced numeric strings fail closed', () => {
  unavailable(calculate({ accountWindowTrust: undefined } as unknown as QuotaPaceObservation), 'untrusted-account-window');
  unavailable(calculate({ source: 'cached-redraw' } as unknown as QuotaPaceObservation), 'synthetic-observation');
  unavailable(calculate({ periodMs: String(WEEK) } as unknown as QuotaPaceObservation), 'invalid-number');
  unavailable(calculate({ usedFraction: '0.29' } as unknown as QuotaPaceObservation), 'invalid-number');
});

test('staleness and trust protection also apply during the initial six hours', () => {
  const observedAt = START + HOUR;
  unavailable(calculate({ observedAt }, observedAt + 30 * 60_000 + 1), 'stale-observation');
  unavailable(calculate({ observedAt, accountWindowTrust: 'ambiguous' }, observedAt), 'untrusted-account-window');
});

test('calculation is deterministic, accepts frozen input and does not mutate it', () => {
  const snapshot = Object.freeze(observation());
  const input = Object.freeze({ enabled: true, now: OBSERVED, observation: snapshot });
  const before = { ...snapshot };
  assert.deepEqual(calculateQuotaPace(input), calculateQuotaPace(input));
  assert.deepEqual(snapshot, before);
});
