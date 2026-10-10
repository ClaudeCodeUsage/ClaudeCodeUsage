import { calculateQuotaPace, QuotaPaceObservation, QuotaPaceResult } from './quotaPace';

export const QUOTA_PACE_MAX_WINDOWS = 16;
export const QUOTA_PACE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Slot is the index in the owner's RAW normalized windows, before filtering
 * or liveQuotaWindows. It is only a display join, never an account identity.
 * Supply actual numeric percentages; normalization's fallback zero is not an
 * observation. Unknown values must be NaN/null, never synthesized zero.
 */
export interface QuotaPaceAdapterWindow {
  readonly slot: number;
  readonly kind: 'weekly_all' | 'weekly_scoped' | 'other';
  readonly usedPercent: number;
  readonly resetAt: number | null;
  readonly periodMs: number | null;
}

/** Fixed numeric/enum DTO: no account IDs, labels, paths, history or credentials.
 * The owner must establish current account/window trust from existing source
 * evidence. Neither a Codex home, file key, limitId nor label proves an account.
 * Unknown/mixed accounts and source changes without a verified new window must
 * be marked unknown/ambiguous/discontinuous. Missing evidence stays unknown.
 * At most sixteen already-materialized windows, never a log/history scan.
 */
export interface QuotaPaceAdapterSnapshot {
  readonly observedAt: number | null;
  readonly source: QuotaPaceObservation['source'];
  readonly accountWindowTrust: QuotaPaceObservation['accountWindowTrust'];
  readonly windows: readonly QuotaPaceAdapterWindow[];
}

export interface QuotaPaceAdapterInput {
  readonly enabled: boolean;
  readonly now: number;
  readonly snapshot: QuotaPaceAdapterSnapshot | null;
  /** Optional immediately preceding observation from the SAME verified source.
   * Do not replace this with a historical reset-cluster representative. The
   * owner retains any discontinuity until a trustworthy new window is observed.
   * Slots must preserve window identity; otherwise mark trust ambiguous.
   */
  readonly previous?: QuotaPaceAdapterSnapshot | null;
}

export interface QuotaPaceAdapterEntry {
  readonly slot: number;
  readonly kind: 'weekly_all' | 'weekly_scoped';
  readonly result: QuotaPaceResult;
}

function rejected(slot = 0, kind: QuotaPaceAdapterEntry['kind'] = 'weekly_all'): QuotaPaceAdapterEntry {
  return { slot, kind, result: { status: 'unavailable', reason: 'untrusted-account-window' } };
}

function bounded(snapshot: QuotaPaceAdapterSnapshot): boolean {
  return Array.isArray(snapshot.windows) && snapshot.windows.length <= QUOTA_PACE_MAX_WINDOWS &&
    snapshot.windows.every((window) => Number.isInteger(window.slot) && window.slot >= 0 && window.slot < QUOTA_PACE_MAX_WINDOWS);
}

function continuous(current: QuotaPaceAdapterSnapshot, window: QuotaPaceAdapterWindow, previous?: QuotaPaceAdapterSnapshot | null): boolean {
  if (!previous) return true;
  if (!bounded(previous) || previous.accountWindowTrust !== 'trusted' || previous.source !== 'observed') return false;
  if (current.observedAt === null || previous.observedAt === null ||
      !Number.isFinite(previous.observedAt) || current.observedAt < previous.observedAt) return false;
  const matches = previous.windows.filter((prior) => prior.slot === window.slot && prior.kind === window.kind);
  if (matches.length !== 1) return false;
  const prior = matches[0];
  if (!Number.isFinite(prior.usedPercent) || prior.usedPercent < 0 || prior.usedPercent > 100 ||
      prior.periodMs !== QUOTA_PACE_WEEK_MS || prior.resetAt === null || !Number.isFinite(prior.resetAt) ||
      previous.observedAt < prior.resetAt - QUOTA_PACE_WEEK_MS || previous.observedAt >= prior.resetAt) return false;
  if (window.resetAt === prior.resetAt) {
    return window.usedPercent >= prior.usedPercent &&
      (current.observedAt !== previous.observedAt || window.usedPercent === prior.usedPercent);
  }
  // A decrease is allowed only after a verified ordinary rollover. Early reset
  // drift and arbitrary account/window substitution are never extrapolated.
  return window.resetAt !== null && window.resetAt === prior.resetAt + QUOTA_PACE_WEEK_MS &&
    current.observedAt >= prior.resetAt;
}

function adapt(input: QuotaPaceAdapterInput, provider: 'claude' | 'codex'): QuotaPaceAdapterEntry[] {
  if (input.enabled !== true) return [];
  const snapshot = input.snapshot;
  if (!snapshot) return [];
  if (!bounded(snapshot)) return [rejected()];
  const windows = snapshot.windows.filter((window) => window.kind === 'weekly_all' ||
    (provider === 'claude' && window.kind === 'weekly_scoped'));
  if (provider === 'codex' && windows.length > 1) return [rejected()];
  const slots = new Set<number>();
  const duplicateSlot = snapshot.windows.some((window) => {
    if (slots.has(window.slot)) return true;
    slots.add(window.slot);
    return false;
  });
  const duplicateAccount = windows.filter((window) => window.kind === 'weekly_all').length > 1;
  return windows.map((window): QuotaPaceAdapterEntry => {
    const kind = window.kind as QuotaPaceAdapterEntry['kind'];
    if (duplicateSlot || duplicateAccount) return rejected(window.slot, kind);
    const trust = continuous(snapshot, window, input.previous) ? snapshot.accountWindowTrust : 'discontinuous';
    return {
      slot: window.slot,
      kind,
      result: calculateQuotaPace({
        enabled: true,
        now: input.now,
        observation: {
          observedAt: snapshot.observedAt ?? NaN,
          resetAt: window.resetAt,
          periodMs: window.periodMs,
          usedFraction: typeof window.usedPercent === 'number' ? window.usedPercent / 100 : NaN,
          source: snapshot.source,
          accountWindowTrust: trust,
        },
      }),
    };
  });
}

/** Pure bounded adapters. The supplied snapshot is the latest one, even if
 * invalid/stale; never select an older 'better' sample or combine accounts.
 */
export function adaptClaudeQuotaPace(input: QuotaPaceAdapterInput): QuotaPaceAdapterEntry[] {
  return adapt(input, 'claude');
}

export function adaptCodexQuotaPace(input: QuotaPaceAdapterInput): QuotaPaceAdapterEntry[] {
  return adapt(input, 'codex');
}
