import { ProviderLimitSnapshot } from '../providerTypes';

export type CodexLimitState = 'current' | 'expired' | 'missing' | 'unlimited';

/** A safe, renderer-ready representation of a locally observed rate-limit window. */
export interface CodexLimitView {
  state: CodexLimitState;
  limitName?: string;
  windowMinutes?: number;
  usedPercent?: number;
  remainingPercent?: number;
  observedAt?: number;
  resetsAt?: number;
  source?: ProviderLimitSnapshot['source'];
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

/**
 * Classify what a local log actually observed. A window without a reset is
 * deliberately stale: a point-in-time log cannot establish it as current.
 */
export function buildCodexLimitViews(
  observed: ProviderLimitSnapshot[],
  now: number,
): CodexLimitView[] {
  if (observed.length === 0) {
    return [{ state: 'missing' }];
  }

  const views: CodexLimitView[] = [];
  for (const snapshot of observed) {
    const name = snapshot.limitName;
    for (const window of snapshot.windows) {
      const usedPercent = percent(window.usedPercent);
      const resetsAt = window.resetsAt;
      views.push({
        state: resetsAt !== undefined && resetsAt > now ? 'current' : 'expired',
        limitName: name,
        windowMinutes: window.windowMinutes,
        usedPercent,
        remainingPercent: 100 - usedPercent,
        observedAt: snapshot.observedAt,
        resetsAt,
        source: snapshot.source,
      });
    }
    if (snapshot.credits?.unlimited) {
      views.push({
        state: 'unlimited',
        limitName: name,
        observedAt: snapshot.observedAt,
        source: snapshot.source,
      });
    }
  }

  return views.length > 0 ? views : [{ state: 'missing' }];
}
