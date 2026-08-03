// Pure helpers for the quota STATUS-BAR text (not the tooltip). Dependency-free
// and unit-tested. Product requirement: the status bar must stay clean — no
// dense colon-heavy output like "5h:6%:4.8h | wk:1%:1.6d". Reset countdowns are
// opt-in (showResetInStatusBar); the full reset detail lives in the tooltip.

import { QuotaWindow, groupQuotaRows } from './quotaWindows';

// Reset-countdown text style (settings > Quota: reset countdown format, #74):
//   decimal → "4.8h" / "1.6d" (default, most compact)
//   units   → "4h 48m" / "1d 14h" (whole hour/minute or day/hour units)
//   clock   → the actual local time / date the window resets ("18:20" / "2026-07-22")
export type ResetCountdownFormat = 'decimal' | 'units' | 'clock';

export interface QuotaStatusOptions {
  showReset: boolean; // showResetInStatusBar (default false)
  fiveHourOnly: boolean; // quotaFiveHourOnly (default false)
  showScopedWeekly: boolean; // opt-in model-scoped weekly caps (default false)
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
 * The wall-clock moment a window resets, in 24-hour form: "16:59" when that
 * falls later today, "Thu 16:59" when it lands on another day.
 *
 * The weekday appears only when it carries information, which is what lets one
 * helper serve every window. A 5-hour window usually resets today, so the bare
 * time reads cleanest; a weekly one rarely does, so it gets the weekday. Basing
 * that on the actual dates rather than the window length also covers the two
 * awkward cases: a 5-hour window that crosses midnight, and a weekly one whose
 * reset happens to be later today.
 *
 * Rounded to the nearest minute, since the API stamps these to the microsecond:
 * a reset at …T23:59:59.227Z is 17:00 local for every practical purpose, and
 * truncating showed it as 16:59, one minute off its sibling cap. The countdown
 * beside it stays exact, so nothing depends on this rounding.
 *
 * hourCycle 'h23' pins the output to 00-23, suppressing both the AM/PM some
 * locales add and the "24:00" that hour12:false can produce at midnight.
 */
export function wallClockReset(target: Date, now: number = Date.now()): string {
  // Round first, then read the date off the rounded value: 23:59:40 rounds into
  // the next day, and the weekday must follow the time actually printed.
  const rounded = new Date(Math.round(target.getTime() / 60_000) * 60_000);
  const sameDay = new Date(now).toDateString() === rounded.toDateString();
  try {
    return rounded.toLocaleString(undefined, {
      ...(sameDay ? {} : { weekday: 'short' }),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
  } catch {
    return rounded.toISOString();
  }
}

export interface ResetCellOptions {
  format?: ResetCountdownFormat; // resetCountdownFormat (default 'decimal')
  now?: number;
}

/**
 * The quota tooltip's "Resets" cell, as "time left (wall clock)" — e.g.
 * "4h 29m (15:19)" or "3d 6h (Thu 16:59)".
 *
 * Shares compactReset with the status bar so the countdown can no longer
 * disagree with it. It used to: the tooltip hardcoded whole hour/minute units,
 * which matched only the 'units' setting and contradicted the default 'decimal'
 * ("4.5h" in the bar against "4h 29m" in the tooltip for the same window). The
 * wall-clock part is deliberately not governed by that setting: it answers a
 * different question (what time does this actually roll over) that a countdown
 * cannot express.
 */
export function formatResetCell(resetsAt: string, opts: ResetCellOptions = {}): string {
  const t = Date.parse(resetsAt);
  if (!resetsAt || isNaN(t)) {
    return '—';
  }
  const now = opts.now ?? Date.now();
  const format = opts.format ?? 'decimal';
  const wall = wallClockReset(new Date(t), now);
  // Under 'clock' the countdown already IS the wall-clock moment, so pairing the
  // two would print the same instant twice.
  if (format === 'clock') {
    return wall;
  }
  return `${compactReset(resetsAt, now, format)} (${wall})`;
}

/**
 * A utilisation percentage for the tooltip, at the precision the API's own field
 * justifies. `decimals` comes from the window (0 for the integer
 * `limits[].percent`, 1 for the legacy float `utilization`), so a value the
 * endpoint sent as "3.0" reads "3.0%" while one sent as "3" reads "3%". A flat
 * toFixed(1) used to render every window as "8.0% / 16.0% / 0.0%", manufacturing
 * a digit the integer field never reported.
 *
 * A genuinely fractional value always keeps a decimal, whatever `decimals` says,
 * so real precision is never rounded away.
 */
export function formatSharePercent(pct: number, decimals: number = 0): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const places = Number.isInteger(clamped) ? decimals : Math.max(decimals, 1);
  return `${clamped.toFixed(places)}%`;
}

/** A monthly cap's reset as a bare date ("Sep 1"). Deliberately not a countdown:
 * the credits reset is derived from the calendar, not reported, so the day is
 * trustworthy while the exact instant is not. */
export function formatMonthlyReset(resetsAt: string): string {
  const t = Date.parse(resetsAt);
  if (!resetsAt || isNaN(t)) {
    return '—';
  }
  try {
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** Status-bar label for a window. Scoped windows use the name the API gave them,
 * lowercased to sit with the "5h" / "wk" segments, so no model name is baked in
 * here; "wk*" is the fallback for a scoped cap the API declined to name. */
function segmentLabel(w: QuotaWindow): string {
  if (w.kind === 'session') {
    return '5h';
  }
  if (w.kind === 'weekly_all') {
    return 'wk';
  }
  return w.scopeLabel ? w.scopeLabel.toLowerCase() : 'wk*';
}

/** The windows a given set of options actually puts in the status bar. */
function shownWindows(windows: QuotaWindow[] | null, opts: QuotaStatusOptions): QuotaWindow[] {
  if (!windows) {
    return [];
  }
  return windows.filter((w) => {
    if (w.kind === 'session') {
      return true;
    }
    if (opts.fiveHourOnly) {
      return false;
    }
    return w.kind === 'weekly_all' || opts.showScopedWeekly;
  });
}

/**
 * The inner status-bar quota text (no icon prefix). Examples:
 *   default          → "5h 6% · wk 1%"
 *   showReset        → "5h 6% ↻4.8h | wk 1% ↻1.6d"
 *   fiveHourOnly     → "5h 6%"
 *   showScopedWeekly → "5h 6% · wk 1% (fable 12%)"
 * Returns '' when there's nothing to show.
 *
 * Per-model caps that reset alongside the all-models week are nested into its
 * segment in parentheses, so their shared countdown is printed once. Repeating
 * "↻3d 5h" per cap ate the bar's width to say the same thing twice.
 */
export function formatQuotaStatusText(windows: QuotaWindow[] | null, opts: QuotaStatusOptions): string {
  const now = opts.now ?? Date.now();
  const share = (w: QuotaWindow): string => `${segmentLabel(w)} ${Math.round(w.utilization)}%`;
  const parts = groupQuotaRows(shownWindows(windows, opts)).map((row) => {
    let s = share(row.window);
    if (row.scoped.length > 0) {
      s += ` (${row.scoped.map(share).join(' · ')})`;
    }
    if (opts.showReset) {
      const r = compactReset(row.window.resetsAt, now, opts.resetFormat);
      if (r) {
        s += ` ↻${r}`;
      }
    }
    return s;
  });
  if (parts.length === 0) {
    return '';
  }
  // A bar separator reads cleaner once each segment carries a "↻reset" tail;
  // otherwise a middot keeps the default airy.
  return parts.join(opts.showReset ? ' | ' : ' · ');
}

/** Highest utilisation among the windows actually shown — drives the status-bar
 * warning/error background colour. Scoped-only, and therefore hidden, caps are
 * excluded on purpose: a red bar with no visible cause reads as a bug. The
 * tooltip lists every window unconditionally, so the figure stays reachable. */
export function worstShownUtilisation(windows: QuotaWindow[] | null, opts: QuotaStatusOptions): number {
  return shownWindows(windows, opts).reduce((worst, w) => Math.max(worst, w.utilization), 0);
}
