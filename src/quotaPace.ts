/** A bounded snapshot contract, deliberately independent of quota I/O and UI.
 * All times are Unix milliseconds; usedFraction is the original 0..1 usage.
 * Supply raw observations, before liveQuotaWindows synthesizes expired zeros.
 */
export interface QuotaPaceObservation {
  readonly observedAt: number;
  readonly resetAt: number | null;
  /** Must be known from provider semantics, never guessed from a display label. */
  readonly periodMs: number | null;
  readonly usedFraction: number;
  readonly source: 'observed' | 'synthetic-reset';
  /** The adapter owns account/window selection. Mark conflicts, unknown
   * identity, unexpected resets, counter drops or source changes as untrusted
   * unless a trustworthy new seven-day window has been established. This
   * single-snapshot function cannot discover those historical facts itself.
   */
  readonly accountWindowTrust: 'trusted' | 'ambiguous' | 'unknown' | 'discontinuous';
}

export interface QuotaPaceInput {
  readonly enabled: boolean;
  /** Explicit clock used only to reject future, stale or expired snapshots. */
  readonly now: number;
  readonly observation: QuotaPaceObservation | null;
}

export type QuotaPaceUnavailableReason =
  | 'missing-observation'
  | 'synthetic-observation'
  | 'untrusted-account-window'
  | 'missing-reset'
  | 'unknown-period'
  | 'invalid-number'
  | 'invalid-time'
  | 'unsupported-period'
  | 'invalid-usage'
  | 'future-observation'
  | 'reset-passed'
  | 'invalid-window'
  | 'stale-observation';

interface QuotaPaceValues {
  readonly observedAt: number;
  readonly resetAt: number;
  /** Inferred from resetAt minus the known seven-day duration. */
  readonly windowStart: number;
  readonly usedPercent: number;
  readonly referencePercent: number;
  /** Signed percentage points, not relative percent. */
  readonly deviationPercentagePoints: number;
}

/** Presentation values retain precision; the consuming UI chooses rounding.
 * Unavailable/off results carry no numeric values. A ready forecast may exceed
 * 100%; it describes account-wide cycle-average use, not local-device speed.
 */
export type QuotaPaceResult =
  | { readonly status: 'off' }
  | { readonly status: 'unavailable'; readonly reason: QuotaPaceUnavailableReason }
  | (QuotaPaceValues & { readonly status: 'insufficient-sample'; readonly forecastPercent: null })
  | (QuotaPaceValues & { readonly status: 'ready'; readonly forecastPercent: number });

export type QuotaPaceStatus = QuotaPaceResult['status'];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE_MS = 6 * 60 * 60 * 1000;
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

function unavailable(reason: QuotaPaceUnavailableReason): QuotaPaceResult {
  return { status: 'unavailable', reason };
}

/** O(1), no I/O, timers, clock reads, history scans or input mutation. */
export function calculateQuotaPace(input: QuotaPaceInput): QuotaPaceResult {
  if (input.enabled !== true) {
    return { status: 'off' };
  }
  const observation = input.observation;
  if (!observation) {
    return unavailable('missing-observation');
  }
  if (observation.source !== 'observed') {
    return unavailable('synthetic-observation');
  }
  if (observation.accountWindowTrust !== 'trusted') {
    return unavailable('untrusted-account-window');
  }
  const { observedAt, resetAt, periodMs, usedFraction } = observation;
  const now = input.now;
  if (resetAt === null) {
    return unavailable('missing-reset');
  }
  if (periodMs === null) {
    return unavailable('unknown-period');
  }
  if (
    !Number.isFinite(now) || !Number.isFinite(observedAt) ||
    !Number.isFinite(resetAt) || !Number.isFinite(periodMs) ||
    !Number.isFinite(usedFraction)
  ) {
    return unavailable('invalid-number');
  }
  if (
    now < 0 || now > MAX_TIMESTAMP ||
    observedAt < 0 || observedAt > MAX_TIMESTAMP ||
    resetAt < 0 || resetAt > MAX_TIMESTAMP
  ) {
    return unavailable('invalid-time');
  }
  if (periodMs !== SEVEN_DAYS_MS) {
    return unavailable('unsupported-period');
  }
  if (usedFraction < 0 || usedFraction > 1) {
    return unavailable('invalid-usage');
  }
  if (observedAt > now) {
    return unavailable('future-observation');
  }
  if (resetAt <= now) {
    return unavailable('reset-passed');
  }
  const windowStart = resetAt - periodMs;
  if (windowStart < 0 || observedAt < windowStart) {
    return unavailable('invalid-window');
  }
  if (now - observedAt > MAX_AGE_MS) {
    return unavailable('stale-observation');
  }

  // The original observation anchors every value. A repaint may only withdraw
  // an expired forecast; it must never make the same usage look slower.
  const elapsedMs = observedAt - windowStart;
  const elapsedFraction = elapsedMs / periodMs;
  const values: QuotaPaceValues = {
    observedAt,
    resetAt,
    windowStart,
    usedPercent: 100 * usedFraction,
    referencePercent: 100 * elapsedFraction,
    deviationPercentagePoints: 100 * (usedFraction - elapsedFraction),
  };
  if (elapsedMs < MIN_SAMPLE_MS) {
    return { status: 'insufficient-sample', ...values, forecastPercent: null };
  }
  return { status: 'ready', ...values, forecastPercent: 100 * usedFraction / elapsedFraction };
}
