import type {
  ProviderLimitSnapshot,
} from '../providerTypes';
import type {
  WeeklyQuotaObservation,
} from '../../weeklyValue';

/** The Codex secondary window is the only window used for weekly estimates. */
export const CODEX_WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;

/** Reset timestamps from the same provider window may differ by a few minutes. */
export const CODEX_QUOTA_RESET_CLUSTER_MS = 5 * 60 * 1000;

/**
 * Keep the per-file copy small. The index-level history below is the durable
 * cross-file record; the per-file copy lets a changed or newly discovered file
 * contribute its observations again without retaining every quota poll.
 */
export const CODEX_FILE_QUOTA_HISTORY_LIMIT = 16;

/** A few hundred reset events are only a few kilobytes, but remain bounded. */
export const CODEX_QUOTA_HISTORY_LIMIT = 256;

/**
 * Deliberately neutral persisted quota evidence. There is no account name,
 * source key, token, credential, or raw provider label in this shape.
 */
export interface CodexQuotaObservation {
  provider: 'codex';
  seriesKey: 'codex';
  observedAt: number;
  resetAt: number;
  usedPercent: number;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isAccountWideCodexLimit(snapshot: ProviderLimitSnapshot): boolean {
  const id = (snapshot.limitId ?? '').trim().toLowerCase();
  const name = (snapshot.limitName ?? '').trim().toLowerCase();
  // Spark has its own rolling allowance and must never be folded into the
  // account-wide Codex estimate. An explicit ID is authoritative: a generic
  // display name must not broaden a model-specific allowance.
  if (id) {
    return id === 'codex';
  }
  return name === 'codex' || !name;
}

function normalizeObservation(value: unknown): CodexQuotaObservation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const observedAt = finite(record.observedAt);
  const resetAt = finite(record.resetAt);
  const usedPercent = finite(record.usedPercent);
  if (
    observedAt === undefined ||
    resetAt === undefined ||
    usedPercent === undefined ||
    usedPercent < 0 || usedPercent > 100 ||
    observedAt <= 0 ||
    resetAt <= 0
  ) {
    return undefined;
  }
  return {
    provider: 'codex',
    seriesKey: 'codex',
    observedAt,
    resetAt,
    usedPercent,
  };
}

/** Extract only account-wide weekly windows from a parsed local snapshot. */
export function codexQuotaObservationsFromLimit(
  snapshot: ProviderLimitSnapshot,
): CodexQuotaObservation[] {
  if (snapshot.provider !== 'codex' || !isAccountWideCodexLimit(snapshot)) {
    return [];
  }
  return snapshot.windows.flatMap((window) => {
    if (window.windowMinutes !== CODEX_WEEKLY_WINDOW_MINUTES) {
      return [];
    }
    const observation = normalizeObservation({
      observedAt: snapshot.observedAt,
      resetAt: window.resetsAt,
      usedPercent: window.usedPercent,
    });
    return observation ? [observation] : [];
  });
}

function representative(
  items: CodexQuotaObservation[],
): CodexQuotaObservation {
  // Prefer the latest sample that was actually observed before the reset. A
  // delayed log line carrying an old reset must not replace a useful boundary
  // sample with an observation that the weekly timeline will reject.
  const beforeReset = items
    .filter((item) => item.observedAt < item.resetAt)
    .sort((left, right) =>
      left.observedAt - right.observedAt || left.resetAt - right.resetAt,
    );
  if (beforeReset.length > 0) {
    return beforeReset[beforeReset.length - 1];
  }
  return [...items].sort((left, right) =>
    left.observedAt - right.observedAt || left.resetAt - right.resetAt,
  )[items.length - 1];
}

/**
 * Compact quota polls to one useful observation per reset boundary. This is
 * intentionally different from retaining every percentage step: the product
 * needs to know that an irregular reset happened, not to build a second poll
 * database. The result is sorted oldest-first and capped by reset count.
 */
export function appendCodexQuotaHistory(
  history: readonly CodexQuotaObservation[] = [],
  additions: readonly CodexQuotaObservation[] = [],
  limit = CODEX_QUOTA_HISTORY_LIMIT,
): CodexQuotaObservation[] {
  const all = [...history, ...additions]
    .map(normalizeObservation)
    .filter((item): item is CodexQuotaObservation => item !== undefined)
    .sort((left, right) =>
      left.resetAt - right.resetAt || left.observedAt - right.observedAt,
    );
  const groups: CodexQuotaObservation[][] = [];
  for (const item of all) {
    const current = groups[groups.length - 1];
    // Compare with the beginning of the group. Comparing with the previous
    // item would let a chain of small skews merge two genuinely different
    // reset boundaries that are more than the allowed cluster width apart.
    const currentResetAt = current?.[0]?.resetAt;
    if (
      current &&
      currentResetAt !== undefined &&
      item.resetAt - currentResetAt <= CODEX_QUOTA_RESET_CLUSTER_MS
    ) {
      current.push(item);
    } else {
      groups.push([item]);
    }
  }
  const compacted = groups.map(representative).sort((left, right) =>
    left.resetAt - right.resetAt || left.observedAt - right.observedAt,
  );
  return compacted.slice(-Math.max(1, Math.floor(limit)));
}

/** Sanitize untrusted persisted data without carrying through raw fields. */
export function sanitizeCodexQuotaHistory(
  value: unknown,
  limit = CODEX_QUOTA_HISTORY_LIMIT,
): CodexQuotaObservation[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .map(normalizeObservation)
    .filter((item): item is CodexQuotaObservation => item !== undefined);
  return appendCodexQuotaHistory([], normalized, limit);
}

export function weeklyQuotaObservationsFromCodexHistory(
  history: readonly CodexQuotaObservation[],
): WeeklyQuotaObservation[] {
  return history.map((item) => ({
    provider: 'codex' as const,
    seriesKey: 'codex',
    observedAt: item.observedAt,
    resetAt: item.resetAt,
    usedPercent: item.usedPercent,
  }));
}

export function weeklyQuotaObservationsFromCodexLimit(
  snapshot: ProviderLimitSnapshot,
  sourceKey?: string,
): WeeklyQuotaObservation[] {
  return codexQuotaObservationsFromLimit(snapshot).map((item) => ({
    provider: 'codex' as const,
    seriesKey: 'codex',
    observedAt: item.observedAt,
    resetAt: item.resetAt,
    usedPercent: item.usedPercent,
    ...(sourceKey ? { sourceKey } : {}),
  }));
}
