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

// Reset-countdown text style (settings > Quota: reset countdown format, #74):
//   decimal → "4.8h" / "1.6d" (default, most compact)
//   units   → "4h 48m" / "1d 14h" (whole hour/minute or day/hour units)
//   clock   → the actual local time / date the window resets ("18:20" / "2026-07-22")
export type ResetCountdownFormat = 'decimal' | 'units' | 'clock';

export interface QuotaStatusOptions {
  showReset: boolean; // showResetInStatusBar (default false)
  fiveHourOnly: boolean; // quotaFiveHourOnly (default false)
  showOpusWeekly: boolean; // existing opt-in weekly Opus cap
  resetFormat?: ResetCountdownFormat; // resetCountdownFormat (default 'decimal')
  now?: number; // for the countdown; defaults to Date.now()
}

/** Zero-padded "HH:MM" in local time. */
function localTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** "YYYY-MM-DD" in local time (not UTC, so it matches what the user's clock reads). */
function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole hour/minute or day/hour units, e.g. "4h 48m" (< 24h) or "1d 14h" (>= 24h). */
function unitsReset(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Compact time-to-reset in the given format (default 'decimal'):
 *   decimal → "4.8h" (< 24h) or "1.6d" (>= 24h)
 *   units   → "4h 48m" (< 24h) or "1d 14h" (>= 24h)
 *   clock   → "18:20" local time (< 24h) or "2026-07-22" local date (>= 24h)
 * Empty string for an unparseable reset time. */
export function compactReset(
  resetsAt: string,
  now: number = Date.now(),
  format: ResetCountdownFormat = 'decimal'
): string {
  const t = Date.parse(resetsAt);
  if (isNaN(t)) {
    return '';
  }
  const ms = t - now;
  // clock shows the absolute moment the window resets, so it stays meaningful
  // even for an already-passed reset (unlike the relative decimal/units forms).
  if (format === 'clock') {
    const target = new Date(t);
    return ms / 3_600_000 >= 24 ? localDate(target) : localTime(target);
  }
  if (ms <= 0) {
    return format === 'units' ? '0m' : '0h';
  }
  if (format === 'units') {
    return unitsReset(ms);
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
      const r = compactReset(w.resets_at, now, opts.resetFormat);
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
