import { CodexUsageScopeView } from './providers/codex/codexUsage';
import { ProviderLimitSnapshot } from './providers/providerTypes';

export type CodexStatusMetric = 'fresh' | 'processed' | 'output';

export interface CodexStatusText {
  text: string;
  limitText?: string;
  stale: boolean;
}

function compact(value: number): string {
  const safe = Math.max(0, value);
  if (safe >= 1_000_000_000) {
    return `${Number((safe / 1_000_000_000).toFixed(1))}B`;
  }
  if (safe >= 1_000_000) {
    return `${Number((safe / 1_000_000).toFixed(1))}M`;
  }
  if (safe >= 1_000) {
    return `${Number((safe / 1_000).toFixed(1))}k`;
  }
  return String(Math.round(safe));
}

function windowLabel(minutes: number | undefined, fallback: string | undefined): string {
  if (minutes !== undefined && minutes > 0) {
    if (minutes % (24 * 60) === 0) {
      return `${minutes / (24 * 60)}d`;
    }
    if (minutes % 60 === 0) {
      return `${minutes / 60}h`;
    }
    return `${minutes}m`;
  }
  return fallback && fallback !== 'primary' ? fallback : 'limit';
}

export function formatCodexStatus(
  scope: CodexUsageScopeView,
  metric: CodexStatusMetric,
  limit: ProviderLimitSnapshot | null,
  now: number = Date.now(),
): CodexStatusText {
  const value =
    metric === 'processed'
      ? scope.total.processed
      : metric === 'output'
        ? scope.total.output
        : scope.total.fresh;
  const liveWindow = limit?.windows.find(
    (window) => window.resetsAt === undefined || window.resetsAt > now,
  );
  const limitText = liveWindow
    ? `${windowLabel(liveWindow.windowMinutes, liveWindow.label)} ${Math.round(
        Math.max(0, Math.min(100, liveWindow.usedPercent)),
      )}%`
    : undefined;
  return {
    text: `CX ${compact(value)}${scope.indexedSubtotal ? '*' : ''}`,
    limitText,
    stale: Boolean(limit && !liveWindow),
  };
}
