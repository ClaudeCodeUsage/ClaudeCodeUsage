import type { LocalWeeklyEstimate } from './weeklyEstimate';
import type { QuotaObservationV2 } from './quotaObservationStore';
import { copyCodexQuotaEpoch, codexQuotaEpochFromObservations, CodexQuotaEpoch } from './codexQuotaEpoch';

/** Display-only reset-to-reset bounds. At is an observed upper bound when the
 * corresponding lower bound differs; null start means unknown, never minus 7d.
 * Calibration start/price changes/account switches do not define new cycles. */
export interface CodexQuotaCycle {
  id: number;
  startAt: number | null;
  startLowerAt: number | null;
  endAt: number;
  endLowerAt: number | null;
  closed: boolean;
  scheduledResetAt: number;
  boundaryUncertain: boolean;
  /** Legacy references without a recoverable account/reset episode. */
  referenceOnly?: boolean;
}

const WEEK = 604_800_000, TOLERANCE = 300_000;
const time = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 8.64e15;
export function copyCodexQuotaCycle(value: unknown): CodexQuotaCycle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as CodexQuotaCycle;
  if (!time(v.id) || !time(v.endAt) || !time(v.scheduledResetAt) || v.endAt <= v.id ||
    v.scheduledResetAt <= v.id || typeof v.closed !== 'boolean' || typeof v.boundaryUncertain !== 'boolean' ||
    (v.startAt !== null && (!time(v.startAt) || v.startAt > v.id)) ||
    (v.startLowerAt !== null && (!time(v.startLowerAt) || v.startAt === null || v.startLowerAt > v.startAt)) ||
    (v.endLowerAt !== null && (!time(v.endLowerAt) || v.endLowerAt > v.endAt))) return undefined;
  return { id: v.id, startAt: v.startAt, startLowerAt: v.startLowerAt, endAt: v.endAt,
    endLowerAt: v.endLowerAt, closed: v.closed, scheduledResetAt: v.scheduledResetAt,
    boundaryUncertain: v.boundaryUncertain, referenceOnly: v.referenceOnly === true };
}
interface Checkpoint { epoch: CodexQuotaEpoch; lastObservedAt: number }
export function withCodexQuotaCycles(
  entries: readonly LocalWeeklyEstimate[], observations: readonly QuotaObservationV2[],
  fingerprint: (key: string) => string | undefined, now = Date.now(),
): LocalWeeklyEstimate[] {
  const books = new Map<string, Map<number, CodexQuotaCycle>>();
  const aliases = new Map<LocalWeeklyEstimate, number>();
  const accounts = new Set(entries.flatMap(e => e.provider === 'codex' && e.accountScopeKey ? [e.accountScopeKey] : []));
  for (const account of accounts) {
    const checkpoints = new Map<number, Checkpoint>();
    const scoped = entries.filter(e => e.provider === 'codex' && e.accountScopeKey === account);
    for (const entry of scoped) {
      const epoch = copyCodexQuotaEpoch(entry.quotaEpoch);
      if (!epoch) continue;
      const old = checkpoints.get(epoch.startedAt);
      checkpoints.set(epoch.startedAt, { epoch, lastObservedAt: Math.max(old?.lastObservedAt ?? 0, entry.observedAt) });
    }
    const fp = fingerprint(account);
    const rows = fp === undefined ? [] : observations.filter(row => row.provider === 'codex' && row.source === 'codex-official-api' &&
      row.periodType === 'seven-day' && row.accountAttribution === 'verified-local-signal' && row.accountFingerprint === fp &&
      time(row.observedAt) && row.observedAt <= now && time(row.resetAt) && row.resetAt > row.observedAt &&
      Array.isArray(row.flags) && !row.flags.includes('clock-anomaly')).sort((a, b) => a.observedAt - b.observedAt);
    const windows = new Map<string, QuotaObservationV2[]>();
    for (const row of rows) { const list = windows.get(row.windowId) ?? []; list.push(row); windows.set(row.windowId, list); }
    for (const window of windows.values()) {
      const first = window[0], last = window[window.length - 1];
      const epoch = codexQuotaEpochFromObservations(rows, fp!, first.observedAt, first.resetAt!);
      if (!epoch) continue;
      const matching = scoped.filter(entry => entry.observedAt >= first.observedAt && entry.observedAt <= last.observedAt &&
        Math.abs(entry.resetAt - epoch.resetAnchorAt) <= TOLERANCE);
      const retained = matching.map(entry => copyCodexQuotaEpoch(entry.quotaEpoch))
        .filter((q): q is CodexQuotaEpoch => q !== undefined && q.startedAt <= epoch.startedAt)
        .sort((a, b) => a.startedAt - b.startedAt)[0];
      const explicitReset = first.captureReason === 'usage-drop' || first.captureReason === 'reset-at-change' ||
        first.captureReason === 'window-id-change';
      const anchor = retained && retained.startedAt < epoch.startedAt && !explicitReset ? retained : epoch;
      checkpoints.set(anchor.startedAt, { epoch: anchor,
        lastObservedAt: Math.max(last.observedAt, checkpoints.get(anchor.startedAt)?.lastObservedAt ?? 0) });
      // Compaction may remove an old first observation. Bind an archived sample
      // only to the official window actually containing it, never by reset alone.
      for (const entry of matching) aliases.set(entry, anchor.startedAt);
    }
    const canonical = new Map<number, number>(), ordered: Checkpoint[] = [];
    for (const point of [...checkpoints.values()].sort((a, b) => a.epoch.startedAt - b.epoch.startedAt)) {
      const previous = ordered[ordered.length - 1];
      // A retained/restarted first observation is not evidence of another reset.
      // Compaction must not create an extra cycle in an unchanged official window.
      if (previous && Math.abs(point.epoch.resetAnchorAt - previous.epoch.resetAnchorAt) <= TOLERANCE &&
        (point.epoch.reason === 'initial' || (point.epoch.reason === previous.epoch.reason &&
          point.epoch.startLowerAt !== null && point.epoch.startLowerAt === previous.epoch.startLowerAt))) {
        canonical.set(point.epoch.startedAt, previous.epoch.startedAt);
        previous.lastObservedAt = Math.max(previous.lastObservedAt, point.lastObservedAt);
      } else { ordered.push(point); canonical.set(point.epoch.startedAt, point.epoch.startedAt); }
    }
    for (const entry of scoped) {
      const id = aliases.get(entry) ?? entry.quotaEpoch?.startedAt;
      if (id !== undefined && canonical.has(id)) aliases.set(entry, canonical.get(id)!);
    }
    const starts = ordered.map((point, index) => {
      const q = point.epoch, previous = ordered[index - 1];
      if (q.reason === 'scheduled-reset' && q.startLowerAt !== null) return { at: q.startLowerAt, lower: q.startLowerAt };
      if (previous && previous.epoch.resetAnchorAt <= q.startedAt &&
        Math.abs(q.resetAnchorAt - previous.epoch.resetAnchorAt - WEEK) <= TOLERANCE) {
        return { at: previous.epoch.resetAnchorAt, lower: previous.epoch.resetAnchorAt };
      }
      if (q.reason === 'reset-change' || q.reason === 'counter-drop') return {
        at: q.startedAt, lower: q.startLowerAt ?? previous?.lastObservedAt ?? null };
      return { at: null, lower: null };
    });
    const cycles = new Map<number, CodexQuotaCycle>();
    for (let i = 0; i < ordered.length; i++) {
      const current = ordered[i], next = ordered[i + 1], start = starts[i], nextStart = starts[i + 1];
      let endAt = current.epoch.resetAnchorAt, endLowerAt: number | null = endAt;
      if (next && nextStart.at !== null && nextStart.at <= endAt) {
        endAt = nextStart.at; endLowerAt = nextStart.lower;
      } else if (next && next.epoch.startedAt < endAt) {
        endAt = next.epoch.startedAt; endLowerAt = current.lastObservedAt;
      }
      if (endAt <= current.epoch.startedAt) continue;
      cycles.set(current.epoch.startedAt, { id: current.epoch.startedAt, startAt: start.at, startLowerAt: start.lower,
        endAt, endLowerAt, closed: next !== undefined || endAt <= now,
        scheduledResetAt: current.epoch.resetAnchorAt,
        boundaryUncertain: start.at === null || start.lower === null || start.at !== start.lower || endLowerAt !== endAt });
    }
    books.set(account, cycles);
  }
  return entries.map(entry => {
    if (entry.provider !== 'codex') return { ...entry };
    const id = aliases.get(entry) ?? entry.quotaEpoch?.startedAt;
    const cycle = entry.accountScopeKey && id !== undefined
      ? books.get(entry.accountScopeKey)?.get(id) : undefined;
    return { ...entry, quotaCycle: cycle ?? { id: entry.quotaEpoch?.startedAt ?? entry.observedAt,
      startAt: null, startLowerAt: null, endAt: entry.resetAt, endLowerAt: entry.resetAt,
      closed: entry.resetAt <= now, scheduledResetAt: entry.resetAt, boundaryUncertain: true, referenceOnly: true } };
  });
}

/** One latest monetary observation per account/reset cycle, not per method,
 * price revision, sampling interval, calendar day or login visit. */
export function selectCodexCycleEstimates(entries: readonly LocalWeeklyEstimate[]): LocalWeeklyEstimate[] {
  const chosen: LocalWeeklyEstimate[] = [];
  const rank = (entry: LocalWeeklyEstimate) => entry.method === 'account-delta-v1' ? 5 : entry.method === 'series-prefix-v1' ? 4 :
    entry.method === 'paired-delta' ? 3 : entry.method === 'rough-prefix-v2' ? 2 : 1;
  const ordered = entries.filter(entry => entry.provider === 'codex' && entry.fullEquivalentUsd !== null &&
    Number.isFinite(entry.fullEquivalentUsd) && entry.fullEquivalentUsd > 0 && entry.unusedEquivalentUsd !== null &&
    Number.isFinite(entry.unusedEquivalentUsd) && entry.unusedEquivalentUsd >= 0 && entry.unusedEquivalentUsd <= entry.fullEquivalentUsd)
    .sort((a, b) => b.observedAt - a.observedAt || rank(b) - rank(a) || b.estimatedAt - a.estimatedAt);
  const account = (entry: LocalWeeklyEstimate) => entry.accountScopeKey ?? entry.accountNumber;
  for (const entry of ordered) {
    if (!chosen.some(old => account(old) === account(entry) &&
      (old.quotaCycle && entry.quotaCycle && !old.quotaCycle.referenceOnly && !entry.quotaCycle.referenceOnly
        ? old.quotaCycle.id === entry.quotaCycle.id : old.quotaEpoch !== undefined || entry.quotaEpoch !== undefined
        ? (old.quotaCycle?.id ?? old.quotaEpoch?.startedAt) === (entry.quotaCycle?.id ?? entry.quotaEpoch?.startedAt)
        : Math.abs(old.resetAt - entry.resetAt) <= TOLERANCE))) chosen.push(entry);
  }
  return chosen;
}
