import type { QuotaObservationV2 } from './quotaObservationStore';

/** Optional nested `quotaEpoch` metadata. No account/window identifiers leave
 * P2. startedAt is the earliest retained observation, NOT a proven reset time.
 * The caller must retain the first/last official observation of each window. */
export interface CodexQuotaEpoch {
  startedAt: number;
  resetAnchorAt: number;
  /** Previous same-account observation, or an observed scheduled reset boundary.
   * Null means unknown. Do not reconstruct it as resetAnchorAt - one week. */
  startLowerAt: number | null;
  reason: 'initial' | 'scheduled-reset' | 'reset-change' | 'counter-drop';
}

const WEEK = 604_800_000, RESET_TOLERANCE = 300_000;
const ACCOUNT = /^acct_[a-f0-9]{32}$/, WINDOW = /^win_[a-f0-9]{32}$/;
const REASONS = new Set(['initial', 'scheduled-reset', 'reset-change', 'counter-drop']);
const CAPTURE_REASONS = new Set(['refresh', 'reset-at-change', 'window-id-change',
  'usage-drop', 'profile-change', 'migration']);
function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
}
function fraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function close(left: number, right: number): boolean { return Math.abs(left - right) <= 1e-12; }

/** Fixed-field copy for future estimator/coordinator/archive boundaries. An
 * absent legacy field and invalid metadata both return undefined; callers must
 * distinguish field absence before accepting a legacy record. */
export function copyCodexQuotaEpoch(value: unknown): CodexQuotaEpoch | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (!time(item.startedAt) || !time(item.resetAnchorAt) || item.startedAt >= item.resetAnchorAt ||
    item.resetAnchorAt - item.startedAt > WEEK || typeof item.reason !== 'string' || !REASONS.has(item.reason) ||
    (item.startLowerAt !== null && (!time(item.startLowerAt) || item.startLowerAt > item.startedAt)) ||
    (item.reason === 'initial' && item.startLowerAt !== null) ||
    (item.reason === 'scheduled-reset' && item.startLowerAt === null)) return undefined;
  return { startedAt: item.startedAt, resetAnchorAt: item.resetAnchorAt,
    startLowerAt: item.startLowerAt as number | null,
    reason: item.reason as CodexQuotaEpoch['reason'] };
}

/** Shared numeric context guard; ownership/provider/method guards stay with the
 * DTO owner. The fixed anchor must not roll forward during calibration. */
export function codexQuotaEpochFitsObservation(epoch: CodexQuotaEpoch, observedAt: number, resetAt: number,
  windowStart?: number, calibrationStart?: number): boolean {
  return epoch.startedAt <= observedAt && observedAt < epoch.resetAnchorAt &&
    resetAt > observedAt && Math.abs(resetAt - epoch.resetAnchorAt) <= RESET_TOLERANCE &&
    (windowStart === undefined || windowStart <= epoch.startedAt) &&
    (calibrationStart === undefined || calibrationStart >= epoch.startedAt);
}

function official(row: QuotaObservationV2, account: string, asOf: number): boolean {
  return row.schemaVersion === 2 && row.provider === 'codex' && row.source === 'codex-official-api' &&
    row.periodType === 'seven-day' && row.accountFingerprint === account &&
    row.accountAttribution === 'verified-local-signal' && time(row.observedAt) && row.observedAt <= asOf &&
    time(row.resetAt) && row.resetAt > row.observedAt && row.resetAt - row.observedAt <= WEEK &&
    fraction(row.usedFraction) && fraction(row.remainingFraction) &&
    close(row.remainingFraction, 1 - row.usedFraction) && WINDOW.test(row.windowId) &&
    CAPTURE_REASONS.has(row.captureReason) && Array.isArray(row.flags) && !row.flags.includes('clock-anomaly');
}
function samePoint(left: QuotaObservationV2, right: QuotaObservationV2): boolean {
  return left.windowId === right.windowId && left.resetAt === right.resetAt && close(left.usedFraction, right.usedFraction);
}

/** Pure projection of an ALREADY APPENDED official P2 sample. It neither
 * allocates windows nor merges captures nor reads/writes any store. Account
 * switches, sampling gaps, blur and restart are not themselves reset evidence.
 * A numeric discontinuity does not establish use of a manual reset credit. */
export function codexQuotaEpochFromObservations(
  records: readonly QuotaObservationV2[],
  accountFingerprint: string,
  currentObservedAt: number,
  currentResetAt: number,
): CodexQuotaEpoch | undefined {
  if (!ACCOUNT.test(accountFingerprint) || !time(currentObservedAt) || !time(currentResetAt) ||
    currentResetAt <= currentObservedAt || currentResetAt - currentObservedAt > WEEK) return undefined;
  const rows = records.filter(row => official(row, accountFingerprint, currentObservedAt))
    .sort((a, b) => a.observedAt - b.observedAt);
  // Contradictory same-time official facts cannot be ordered into an epoch.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].observedAt === rows[i - 1].observedAt && !samePoint(rows[i], rows[i - 1])) return undefined;
  }
  const matches = rows.filter(row => row.observedAt === currentObservedAt);
  const point = matches[0];
  if (!point || point.resetAt !== currentResetAt) return undefined;
  const first = rows.find(row => row.windowId === point.windowId)!;
  const previous = rows.filter(row => row.windowId !== point.windowId && row.observedAt < first.observedAt).pop();
  let reason: CodexQuotaEpoch['reason'] = 'initial';
  let startLowerAt: number | null = null;
  if (previous) {
    const oldReset = previous.resetAt!;
    const scheduled = previous.observedAt < oldReset && first.observedAt >= oldReset &&
      Math.abs(first.resetAt! - oldReset - WEEK) <= RESET_TOLERANCE;
    if (scheduled) {
      reason = 'scheduled-reset'; startLowerAt = oldReset;
    } else {
      startLowerAt = previous.observedAt;
      reason = first.resetAt !== previous.resetAt && first.captureReason !== 'usage-drop'
        ? 'reset-change' : 'counter-drop';
    }
  } else if (first.captureReason === 'usage-drop') reason = 'counter-drop';
  else if (first.captureReason === 'reset-at-change' || first.captureReason === 'window-id-change') reason = 'reset-change';
  return copyCodexQuotaEpoch({ startedAt: first.observedAt, resetAnchorAt: first.resetAt, reason, startLowerAt });
}
