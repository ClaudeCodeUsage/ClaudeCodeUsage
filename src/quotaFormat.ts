// Pure helpers for the quota STATUS-BAR text (not the tooltip). Dependency-free
// and unit-tested. Product requirement: the status bar must stay clean — no
// dense colon-heavy output like "5h:6%:4.8h | wk:1%:1.6d". Reset countdowns are
// opt-in (showResetInStatusBar); the full reset detail lives in the tooltip.

export interface QuotaLimitLike {
  utilization: number;
  resets_at: string;
}

export interface LiveQuotaWindows {
  five_hour?: QuotaLimitLike;
  seven_day?: QuotaLimitLike;
  seven_day_opus?: QuotaLimitLike;
}

export interface QuotaStatusOptions {
  showReset: boolean; // showResetInStatusBar (default false)
  fiveHourOnly: boolean; // quotaFiveHourOnly (default false)
  showOpusWeekly: boolean; // existing opt-in weekly Opus cap
  now?: number; // for the countdown; defaults to Date.now()
}

/** Compact single-unit time-to-reset, e.g. "4.8h" (< 24h) or "1.6d" (>= 24h).
 * Empty string for an unparseable reset time. */
export function compactReset(resetsAt: string, now: number = Date.now()): string {
  const t = Date.parse(resetsAt);
  if (isNaN(t)) {
    return '';
  }
  const ms = t - now;
  if (ms <= 0) {
    return '0h';
  }
  const hours = ms / 3_600_000;
  return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
}

/**
 * The inner status-bar quota text (no icon prefix). Examples:
 *   default       → "5h 6% · wk 1%"
 *   showReset     → "5h 6% ↻4.8h | wk 1% ↻1.6d"
 *   fiveHourOnly  → "5h 6%"
 * Returns '' when there's nothing to show.
 */
export function formatQuotaStatusText(live: LiveQuotaWindows | null, opts: QuotaStatusOptions): string {
  if (!live) {
    return '';
  }
  const now = opts.now ?? Date.now();
  const seg = (label: string, w?: QuotaLimitLike): string | null => {
    if (!w) {
      return null;
    }
    let s = `${label} ${Math.round(w.utilization)}%`;
    if (opts.showReset) {
      const r = compactReset(w.resets_at, now);
      if (r) {
        s += ` ↻${r}`;
      }
    }
    return s;
  };
  const parts: string[] = [];
  const five = seg('5h', live.five_hour);
  if (five) {
    parts.push(five);
  }
  if (!opts.fiveHourOnly) {
    const wk = seg('wk', live.seven_day);
    if (wk) {
      parts.push(wk);
    }
    if (opts.showOpusWeekly) {
      const op = seg('opus', live.seven_day_opus);
      if (op) {
        parts.push(op);
      }
    }
  }
  if (parts.length === 0) {
    return '';
  }
  // A bar separator reads cleaner once each segment carries a "↻reset" tail;
  // otherwise a middot keeps the default airy.
  return parts.join(opts.showReset ? ' | ' : ' · ');
}

/** Highest utilisation among the windows actually shown — drives the status-bar
 * warning/error background colour. */
export function worstShownUtilisation(live: LiveQuotaWindows | null, opts: QuotaStatusOptions): number {
  if (!live) {
    return 0;
  }
  let worst = live.five_hour?.utilization ?? 0;
  if (!opts.fiveHourOnly) {
    if (live.seven_day) {
      worst = Math.max(worst, live.seven_day.utilization);
    }
    if (opts.showOpusWeekly && live.seven_day_opus) {
      worst = Math.max(worst, live.seven_day_opus.utilization);
    }
  }
  return worst;
}
