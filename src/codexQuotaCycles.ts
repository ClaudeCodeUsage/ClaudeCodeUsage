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
  /** Explicit synthetic grouping, not an observed subscription/reset boundary. */
  fallbackDays?: 7;
}

const WEEK = 604_800_000, TOLERANCE = 300_000;
const time = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 8.64e15;
export function copyCodexQuotaCycle(value: unknown): CodexQuotaCycle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as CodexQuotaCycle;
  if ((v.fallbackDays !== undefined && (v.fallbackDays !== 7 || v.referenceOnly !== true ||
      v.startAt === null || v.endAt - v.startAt !== WEEK || v.id !== v.startAt)) ||
    !time(v.id) || !time(v.endAt) || !time(v.scheduledResetAt) || v.endAt <= v.id ||
    v.scheduledResetAt <= v.id || typeof v.closed !== 'boolean' || typeof v.boundaryUncertain !== 'boolean' ||
    (v.startAt !== null && (!time(v.startAt) || v.startAt > v.id)) ||
    (v.startLowerAt !== null && (!time(v.startLowerAt) || v.startAt === null || v.startLowerAt > v.startAt)) ||
    (v.endLowerAt !== null && (!time(v.endLowerAt) || v.endLowerAt > v.endAt))) return undefined;
  return { id: v.id, startAt: v.startAt, startLowerAt: v.startLowerAt, endAt: v.endAt,
    endLowerAt: v.endLowerAt, closed: v.closed, scheduledResetAt: v.scheduledResetAt,
    boundaryUncertain: v.boundaryUncertain, referenceOnly: v.referenceOnly === true,
    ...(v.fallbackDays === 7 ? { fallbackDays: 7 as const } : {}) };
}
/** UTC Monday calendar buckets are a stable, explicitly synthetic fallback.
 * Group measurements by observation time, never their drifting future resets. */
export function codexFallbackQuotaCycle(entry: Pick<LocalWeeklyEstimate, 'observedAt' | 'resetAt'>,
  now = Date.now()): CodexQuotaCycle {
  const day = new Date(entry.observedAt);
  const startAt = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) -
    ((day.getUTCDay() + 6) % 7) * 86_400_000;
  return { id: startAt, startAt, startLowerAt: null, endAt: startAt + WEEK, endLowerAt: null,
    closed: startAt + WEEK <= now, scheduledResetAt: entry.resetAt,
    boundaryUncertain: true, referenceOnly: true, fallbackDays: 7 };
}
interface Checkpoint { epoch: CodexQuotaEpoch; lastObservedAt: number; displayResetAt?: number }
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
    const officialWindows = new Map<number, QuotaObservationV2[]>();
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
      if (first.observedAt === anchor.startedAt) officialWindows.set(anchor.startedAt, window);
      // Compaction may remove an old first observation. Bind an archived sample
      // only to the official window actually containing it, never by reset alone.
      for (const entry of matching) aliases.set(entry, anchor.startedAt);
    }
    const canonical = new Map<number, number>();
    let ordered: Checkpoint[] = [];
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
    // A moving deadline while the official counter still reports zero does not
    // prove another reset. Alias only this provisional display history; raw P2,
    // calibration epochs, anchors and frozen amounts are never changed.
    const snapshots = new Map<number, LocalWeeklyEstimate[]>();
    for (const entry of scoped) {
      const raw = aliases.get(entry) ?? entry.quotaEpoch?.startedAt;
      const id = raw === undefined ? undefined : canonical.get(raw);
      if (id !== undefined) { const list = snapshots.get(id) ?? []; list.push(entry); snapshots.set(id, list); }
    }
    const proof = (point: Checkpoint) => {
      // The official source, verified attribution and matching fingerprint gate
      // above is authoritative here, as in epoch derivation. A retained legacy
      // account-ambiguous annotation does not negate that explicit evidence.
      // Preserve every flag; this display alias grants no local-usage ownership.
      const observed = officialWindows.get(point.epoch.startedAt);
      if (!observed?.length || observed[0].observedAt !== point.epoch.startedAt ||
        observed[observed.length - 1].observedAt !== point.lastObservedAt || !observed.every((row, index) =>
          row.schemaVersion === 2 && Number.isFinite(row.usedFraction) && row.usedFraction >= 0 && row.usedFraction <= 1 &&
          Number.isFinite(row.remainingFraction) && Math.abs(row.remainingFraction - (1 - row.usedFraction)) <= 1e-12 &&
          Math.abs(row.resetAt! - point.epoch.resetAnchorAt) <= TOLERANCE && row.resetAt! - row.observedAt <= WEEK &&
          (index === 0 || row.usedFraction >= observed[index - 1].usedFraction))) return undefined;
      const positiveAt = observed.find(row => row.usedFraction > 0)?.observedAt ?? Infinity;
      if ((snapshots.get(point.epoch.startedAt) ?? []).some(entry => entry.observedAt < positiveAt &&
        (entry.utilizationPercent !== 0 || entry.usedEquivalentUsd !== 0 || entry.fullEquivalentUsd !== null ||
          entry.unusedEquivalentUsd !== null || (entry.unlinkedEquivalentUsd ?? 0) !== 0 ||
          entry.calibrationEvidence !== undefined || entry.windowEvidence !== undefined))) return undefined;
      return { first: observed[0], last: observed[observed.length - 1], zero: positiveAt === Infinity };
    };
    const display: Checkpoint[] = [], displayIds = new Map<number, number>();
    let previousProof: ReturnType<typeof proof>;
    for (const point of ordered) {
      const currentProof = proof(point), previous = display[display.length - 1];
      if (previous && previousProof?.zero && currentProof && point.epoch.reason === 'reset-change' &&
        currentProof.first.captureReason === 'reset-at-change' &&
        currentProof.first.providerWindowFingerprint === previousProof.last.providerWindowFingerprint &&
        currentProof.first.observedAt > previousProof.last.observedAt &&
        point.epoch.startLowerAt === previousProof.last.observedAt &&
        currentProof.first.observedAt < previousProof.last.resetAt!) {
        displayIds.set(point.epoch.startedAt, previous.epoch.startedAt);
        previous.lastObservedAt = point.lastObservedAt;
        previous.displayResetAt = currentProof.zero ? currentProof.last.resetAt! : point.epoch.resetAnchorAt;
      } else { display.push(point); displayIds.set(point.epoch.startedAt, point.epoch.startedAt); }
      previousProof = currentProof;
    }
    for (const [raw, id] of canonical) canonical.set(raw, displayIds.get(id) ?? id);
    ordered = display;
    for (const entry of scoped) {
      const id = aliases.get(entry) ?? entry.quotaEpoch?.startedAt;
      if (id !== undefined && canonical.has(id)) aliases.set(entry, canonical.get(id)!);
    }
    const starts = ordered.map((point, index) => {
      const q = point.epoch, previous = ordered[index - 1];
      const previousReset = previous?.displayResetAt ?? previous?.epoch.resetAnchorAt;
      if (q.reason === 'scheduled-reset' && q.startLowerAt !== null) return { at: q.startLowerAt, lower: q.startLowerAt };
      if (previousReset !== undefined && previousReset <= q.startedAt &&
        Math.abs(q.resetAnchorAt - previousReset - WEEK) <= TOLERANCE) {
        return { at: previousReset, lower: previousReset };
      }
      if (q.reason === 'reset-change' || q.reason === 'counter-drop') return {
        at: q.startedAt, lower: q.startLowerAt ?? previous?.lastObservedAt ?? null };
      return { at: null, lower: null };
    });
    const cycles = new Map<number, CodexQuotaCycle>();
    for (let i = 0; i < ordered.length; i++) {
      const current = ordered[i], next = ordered[i + 1], start = starts[i], nextStart = starts[i + 1];
      const scheduledResetAt = current.displayResetAt ?? current.epoch.resetAnchorAt;
      let endAt = scheduledResetAt, endLowerAt: number | null = endAt;
      if (next && nextStart.at !== null && nextStart.at <= endAt) {
        endAt = nextStart.at; endLowerAt = nextStart.lower;
      } else if (next && next.epoch.startedAt < endAt) {
        endAt = next.epoch.startedAt; endLowerAt = current.lastObservedAt;
      }
      if (endAt <= current.epoch.startedAt) continue;
      cycles.set(current.epoch.startedAt, { id: current.epoch.startedAt, startAt: start.at, startLowerAt: start.lower,
        endAt, endLowerAt, closed: next !== undefined || endAt <= now,
        scheduledResetAt,
        boundaryUncertain: current.displayResetAt !== undefined || start.at === null || start.lower === null || start.at !== start.lower || endLowerAt !== endAt });
    }
    books.set(account, cycles);
  }
  return entries.map(entry => {
    if (entry.provider !== 'codex') return { ...entry };
    if (entry.windowEvidence) return { ...entry, quotaCycle: { ...entry.windowEvidence.cycle } };
    const id = aliases.get(entry) ?? entry.quotaEpoch?.startedAt;
    const cycle = entry.accountScopeKey && id !== undefined
      ? books.get(entry.accountScopeKey)?.get(id) : undefined;
    return { ...entry, quotaCycle: cycle ?? codexFallbackQuotaCycle(entry, now) };
  });
}

/** Admission is separate from archive validity: old snapshots remain frozen,
 * but incomplete numerators and tiny new calibrations cannot price capacity. */
export function codexCycleAmountEligible(entry: LocalWeeklyEstimate): boolean {
  if (entry.fullEquivalentUsd === null || !Number.isFinite(entry.fullEquivalentUsd) || entry.fullEquivalentUsd <= 0 ||
    entry.unusedEquivalentUsd === null || !Number.isFinite(entry.unusedEquivalentUsd) || entry.unusedEquivalentUsd < 0 ||
    entry.unusedEquivalentUsd > entry.fullEquivalentUsd ||
    (entry.method === 'series-prefix-v1' || entry.method === 'account-delta-v1') && (entry.unlinkedEquivalentUsd ?? 0) > 0 ||
    entry.flags.includes('partial-history') || entry.pricingCoverage !== 1) return false;
  if (entry.windowEvidence) return entry.windowEvidence.complete && entry.windowEvidence.excludedUsd === 0 &&
    entry.windowEvidence.deltaPercent >= 5 && entry.windowEvidence.pricedTokens === entry.windowEvidence.totalTokens;
  if (entry.calibrationEvidence) return entry.calibrationEvidence.accumulated.deltaPercent >= 5 &&
    entry.calibrationEvidence.accumulated.pricedTokens === entry.calibrationEvidence.accumulated.totalTokens;
  if (entry.method === 'legacy-prefix-ratio' || entry.method === 'paired-delta' || entry.method === 'owned-window') {
    return !entry.flags.some(flag => flag === 'boundary-uncertain' || flag === 'counter-change' || flag === 'partial-pricing');
  }
  return !entry.flags.includes('partial-pricing');
}
export function compareCodexCycleEvidence(a: LocalWeeklyEstimate, b: LocalWeeklyEstimate): number {
  const strength = (entry: LocalWeeklyEstimate) => entry.windowEvidence?.deltaPercent ??
    entry.calibrationEvidence?.accumulated.deltaPercent ?? 0;
  return Number(codexCycleAmountEligible(b)) - Number(codexCycleAmountEligible(a)) ||
    strength(b) - strength(a) || b.observedAt - a.observedAt || b.estimatedAt - a.estimatedAt;
}
/** One summary per cycle, including pending cycles. Quality precedes recency;
 * a selected amount retains its own percentage and original as-of time. */
export function selectCodexCycleEstimates(entries: readonly LocalWeeklyEstimate[], now = Number.POSITIVE_INFINITY): LocalWeeklyEstimate[] {
  const chosen: LocalWeeklyEstimate[] = [];
  const localCycles = new Map<string | number, { cycle: CodexQuotaCycle; at: number }>();
  for (const entry of entries) {
    const key = entry.localWindowKey ?? entry.localWindowNumber, cycle = entry.quotaCycle ?? entry.windowEvidence?.cycle;
    if (key === undefined || !cycle) continue;
    const old = localCycles.get(key);
    if (!old || old.cycle.fallbackDays === 7 && cycle.fallbackDays !== 7 ||
      old.cycle.fallbackDays === cycle.fallbackDays && entry.estimatedAt > old.at) localCycles.set(key, { cycle, at: entry.estimatedAt });
  }
  const rank = (entry: LocalWeeklyEstimate) => entry.method === 'account-delta-v1' ? 5 : entry.method === 'series-prefix-v1' ? 4 :
    entry.method === 'paired-delta' ? 3 : entry.method === 'rough-prefix-v2' ? 2 : 1;
  const ordered = entries.filter(entry => entry.provider === 'codex' && time(entry.windowStart) && time(entry.resetAt) &&
    entry.windowStart < entry.resetAt && time(entry.observedAt) && entry.observedAt >= entry.windowStart &&
    entry.observedAt < entry.resetAt && entry.observedAt <= now &&
    (entry.fullEquivalentUsd === null && entry.unusedEquivalentUsd === null ||
      typeof entry.fullEquivalentUsd === 'number' && Number.isFinite(entry.fullEquivalentUsd) && entry.fullEquivalentUsd > 0 &&
      typeof entry.unusedEquivalentUsd === 'number' && Number.isFinite(entry.unusedEquivalentUsd) &&
      entry.unusedEquivalentUsd >= 0 && entry.unusedEquivalentUsd <= entry.fullEquivalentUsd))
    .map(entry => {
      const key = entry.localWindowKey ?? entry.localWindowNumber, cycle = key === undefined ? undefined : localCycles.get(key)?.cycle;
      if (cycle) return { ...entry, quotaCycle: { ...cycle } };
      return !entry.windowEvidence && (entry.quotaCycle?.referenceOnly && entry.quotaCycle.fallbackDays !== 7 || (!entry.quotaCycle && !entry.quotaEpoch))
        ? { ...entry, quotaCycle: codexFallbackQuotaCycle(entry) } : entry;
    })
    .sort((a, b) => compareCodexCycleEvidence(a, b) || rank(b) - rank(a));
  const account = (entry: LocalWeeklyEstimate) => entry.accountScopeKey ?? entry.accountNumber ??
    (entry.quotaCycle?.fallbackDays === 7 ? undefined : entry.localWindowKey ?? entry.localWindowNumber);
  for (const entry of ordered) {
    if (!chosen.some(old => account(old) === account(entry) &&
      (old.quotaCycle?.fallbackDays === 7 && entry.quotaCycle?.fallbackDays === 7
        ? old.quotaCycle.id === entry.quotaCycle.id : old.quotaCycle && entry.quotaCycle && !old.quotaCycle.referenceOnly && !entry.quotaCycle.referenceOnly
        ? old.quotaCycle.id === entry.quotaCycle.id : old.quotaEpoch !== undefined || entry.quotaEpoch !== undefined
        ? (old.quotaCycle?.id ?? old.quotaEpoch?.startedAt) === (entry.quotaCycle?.id ?? entry.quotaEpoch?.startedAt)
        : Math.abs(old.resetAt - entry.resetAt) <= TOLERANCE))) chosen.push(codexCycleAmountEligible(entry) ? entry :
          { ...entry, fullEquivalentUsd: null, unusedEquivalentUsd: null, fullRange: undefined });
  }
  return chosen;
}
