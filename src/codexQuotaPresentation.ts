import type { WeeklyQuotaObservation } from './weeklyValue';
export interface QuotaPresentationObservation { observedAt: number; resetAt: number; usedPercent: number }
export interface QuotaPresentationChange extends QuotaPresentationObservation { beforeAt: number; beforePercent: number; previousResetAt: number }
export function codexQuotaPresentation(local: readonly WeeklyQuotaObservation[],
  official: Partial<QuotaPresentationObservation> | undefined, now: number): {
    local?: QuotaPresentationObservation; change?: QuotaPresentationChange; conflict: boolean;
  } {
  const rows = local.filter(row => row.provider === 'codex' && row.sourceKey && row.observedAt <= now &&
    row.resetAt > row.observedAt && Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100)
    .slice().sort((a, b) => a.observedAt - b.observedAt);
  const latest = rows[rows.length - 1];
  if (!latest) return { conflict: false };
  const safe = { observedAt: latest.observedAt, resetAt: latest.resetAt, usedPercent: latest.usedPercent };
  const comparison = official && typeof official.observedAt === 'number' ? rows.filter(row => Math.abs(row.observedAt - official.observedAt!) <= 300_000)
    .sort((a, b) => Math.abs(a.observedAt - official.observedAt!) - Math.abs(b.observedAt - official.observedAt!))[0] : undefined;
  const comparable = comparison && official && typeof official.observedAt === 'number' && typeof official.resetAt === 'number' &&
    typeof official.usedPercent === 'number' && official.observedAt <= now && official.resetAt > official.observedAt &&
    Math.abs(comparison.observedAt - official.observedAt) <= 300_000;
  let change: QuotaPresentationChange | undefined;
  const bySource = new Map<string, typeof latest>();
  for (const row of rows) {
    const before = bySource.get(row.sourceKey!);
    if (before && row.observedAt > before.observedAt && Math.abs(row.resetAt - latest.resetAt) <= 300_000 &&
      (Math.abs(row.resetAt - before.resetAt) > 300_000 || before.usedPercent - row.usedPercent >= 15 ||
        row.usedPercent === 0 && before.usedPercent > 0)) {
      change = { beforeAt: before.observedAt, beforePercent: before.usedPercent, previousResetAt: before.resetAt,
        observedAt: row.observedAt, resetAt: row.resetAt, usedPercent: row.usedPercent };
    }
    bySource.set(row.sourceKey!, row);
  }
  return { local: safe, ...(change ? { change } : {}), conflict: !!comparable && (Math.abs(comparison!.resetAt - official!.resetAt!) > 300_000 ||
    comparison!.observedAt >= official!.observedAt! && comparison!.usedPercent < official!.usedPercent!) };
}
