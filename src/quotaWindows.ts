// Normalizes Anthropic's OAuth usage payload into a flat, ordered list of quota
// windows, plus the usage-credits summary. Pure and dependency-free so it runs
// under node:test without VS Code.
//
// Why this layer exists: the usage endpoint used to expose one field per window
// (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`). As of
// 2026-08 the per-model fields are still present in the JSON but come back
// null, and the real data moved into a generic `limits` array whose scoped
// entries name their model only in scope.model.display_name. Two consequences
// drove this module:
//
//   1. A reader keyed on `seven_day_opus` renders nothing at all now, silently.
//   2. Worse, it understates risk. The scoped weekly cap can be the binding
//      one — observed 16% scoped against 8% all-models, with the API itself
//      setting is_active on the scoped row — so a status bar that only knows
//      about the all-models figure can sit green while the real ceiling is near.
//
// So no model name is hardcoded here or downstream. Whatever the API scopes a
// window to is what gets displayed, and the next rename costs no code change.

import {
  ClaudeApiUsageResponse,
  ClaudeUsageLimit,
  ClaudeUsageLimitEntry,
  ClaudeUsageMoney
} from './types';

export type QuotaWindowKind = 'session' | 'weekly_all' | 'weekly_scoped';

export interface QuotaWindow {
  kind: QuotaWindowKind;
  /** Model or surface the window is scoped to ("Fable"); undefined when global. */
  scopeLabel?: string;
  utilization: number; // 0-100
  /** Decimal places the API's own precision justifies: 0 for the integer
   *  `limits[].percent`, 1 for the legacy float `utilization` (serialized "3.0",
   *  so the field can carry a tenth even when this sample does not). JSON.parse
   *  collapses 3.0 to 3, so the distinction has to be recorded here at the point
   *  the shape is known. */
  decimals: number;
  /** ISO reset time, or '' when the API sends none — a usage-anchored window
   *  that has not started yet. Never null, so callers can Date.parse freely. */
  resetsAt: string;
  /** The API's own flag for the window currently doing the limiting. */
  isActive: boolean;
}

export interface QuotaCredits {
  used: number; // major units, e.g. 12.34
  /** Monthly cap in major units (e.g. 300), or null when there is no finite cap
   *  to report. The cap is user-adjustable and may be unlimited, so this is not
   *  something a display can assume exists. */
  limit: number | null;
  currency: string;
  /** used/limit as 0-100, or null when there is no finite cap to measure
   *  against. Not currently displayed: the credits row shows the amount and no
   *  bar, since a percentage of a cap the user can change at will says little. */
  percent: number | null;
  /** Local midnight on the 1st of next month, when the monthly cap rolls over.
   *  Derived, not reported: the payload carries no reset for credits, but the
   *  Anthropic UI labels this cap "Monthly spend limit" and shows it resetting on
   *  the 1st. Day-granularity only — the exact instant and its billing timezone
   *  are unknown, so callers should render a date and not a countdown. */
  resetsAt: string;
}

/** Local midnight on the 1st of the month following `now`, as an ISO string. */
function firstOfNextMonth(now: number): string {
  const d = new Date(now);
  // Day 1 of month+1; the Date constructor rolls a December month index over.
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).toISOString();
}

const SESSION_PERIOD_MS = 5 * 60 * 60 * 1000;
const WEEKLY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/** Period length a window rolls over on — drives staleness in liveQuotaWindows. */
export function quotaWindowPeriodMs(kind: QuotaWindowKind): number {
  return kind === 'session' ? SESSION_PERIOD_MS : WEEKLY_PERIOD_MS;
}

/** Map a `limits[]` entry's kind/group onto our three window kinds. Unknown
 * kinds inside the weekly group are treated as scoped rather than dropped: the
 * point of this module is to surface caps we have never seen before. */
function kindOf(entry: ClaudeUsageLimitEntry): QuotaWindowKind | null {
  const kind = entry.kind ?? '';
  if (kind === 'session') {
    return 'session';
  }
  if (kind === 'weekly_all') {
    return 'weekly_all';
  }
  if (kind === 'weekly_scoped') {
    return 'weekly_scoped';
  }
  // Unrecognised: fall back to the coarser `group`, which has stayed stable.
  if (entry.group === 'session') {
    return 'session';
  }
  if (entry.group === 'weekly') {
    return 'weekly_scoped';
  }
  return null;
}

/** Human name for a scoped window: the model display name, else the surface. */
function scopeLabelOf(entry: ClaudeUsageLimitEntry): string | undefined {
  const model = entry.scope?.model?.display_name;
  if (model) {
    return model;
  }
  return entry.scope?.surface || undefined;
}

function windowFromEntry(entry: ClaudeUsageLimitEntry): QuotaWindow | null {
  const kind = kindOf(entry);
  if (!kind) {
    return null;
  }
  const pct = Number(entry.percent);
  return {
    kind,
    scopeLabel: kind === 'weekly_scoped' ? scopeLabelOf(entry) : undefined,
    utilization: Number.isFinite(pct) ? pct : 0,
    decimals: 0, // `percent` is an integer field
    resetsAt: entry.resets_at ?? '',
    isActive: entry.is_active === true
  };
}

function windowFromLegacy(
  limit: ClaudeUsageLimit | null | undefined,
  kind: QuotaWindowKind,
  scopeLabel?: string
): QuotaWindow | null {
  // Null, not merely absent, is the 2026-08 shape for a retired per-model field.
  // A truthiness slip here would render a permanent "Opus 0%".
  if (!limit) {
    return null;
  }
  const pct = Number(limit.utilization);
  return {
    kind,
    scopeLabel,
    utilization: Number.isFinite(pct) ? pct : 0,
    decimals: 1, // `utilization` is a float field, sent as "3.0"
    resetsAt: limit.resets_at ?? '',
    isActive: false
  };
}

/**
 * Every quota window the payload describes, in display order (session, then
 * all-models weekly, then each scoped weekly).
 *
 * When `limits` is present it wins outright. Both generations are emitted at
 * once today with the same figures in each, so merging them would double-count
 * the session and all-models rows.
 */
export function normalizeQuotaWindows(usage: ClaudeApiUsageResponse | null): QuotaWindow[] {
  if (!usage) {
    return [];
  }
  const entries = Array.isArray(usage.limits) ? usage.limits : null;
  if (entries && entries.length > 0) {
    const windows = entries
      .map(windowFromEntry)
      .filter((w): w is QuotaWindow => w !== null);
    if (windows.length > 0) {
      return sortWindows(windows);
    }
    // An array of nothing we recognise: fall through to the legacy fields
    // rather than reporting "no quota" while usable data sits right there.
  }
  return sortWindows(
    [
      windowFromLegacy(usage.five_hour, 'session'),
      windowFromLegacy(usage.seven_day, 'weekly_all'),
      // The names these fields stood for, for as long as they still carry data.
      windowFromLegacy(usage.seven_day_opus, 'weekly_scoped', 'Opus'),
      windowFromLegacy(usage.seven_day_sonnet, 'weekly_scoped', 'Sonnet')
    ].filter((w): w is QuotaWindow => w !== null)
  );
}

/** Session first, then the all-models weekly, then scoped weeklies in the order
 * the API listed them (stable, so the status bar does not reshuffle mid-week). */
function sortWindows(windows: QuotaWindow[]): QuotaWindow[] {
  const rank: Record<QuotaWindowKind, number> = { session: 0, weekly_all: 1, weekly_scoped: 2 };
  return windows
    .map((w, i) => ({ w, i }))
    .sort((a, b) => rank[a.w.kind] - rank[b.w.kind] || a.i - b.i)
    .map((x) => x.w);
}

/**
 * Drop or reset windows whose period has already rolled over.
 *
 * A utilization figure is a point-in-time snapshot valid only until its
 * resets_at. When the OAuth fetch starts failing the caller keeps handing us the
 * last successful response, so without this a stale "100%" would linger for
 * hours. Behaviour, unchanged from the original statusBar implementation:
 *
 *   - no / unparseable reset time  → keep as-is (nothing to reason about)
 *   - reset still ahead            → keep as-is
 *   - reset passed within 2 periods→ show 0% with no countdown; the window
 *                                    rolled over, and these windows are
 *                                    usage-anchored so the next reset only
 *                                    starts on the next message
 *   - reset passed longer ago      → drop; the fetch has been failing for ages
 *                                    and we have no trustworthy figure
 *
 * Adapted from PR #24 by @nickearnshaw.
 */
export function liveQuotaWindows(windows: QuotaWindow[], now: number = Date.now()): QuotaWindow[] {
  const out: QuotaWindow[] = [];
  for (const w of windows) {
    const t = Date.parse(w.resetsAt);
    if (isNaN(t) || t > now) {
      out.push(w);
      continue;
    }
    if (now - t > 2 * quotaWindowPeriodMs(w.kind)) {
      continue;
    }
    out.push({ ...w, utilization: 0, resetsAt: '', isActive: false });
  }
  return out;
}

/**
 * Hide per-model caps that have no usage yet.
 *
 * A scoped cap at 0% cannot be the binding constraint, which is the only reason
 * it earns space, and at the start of a week every one of them reads 0%. The
 * session and all-models rows always stay: "5h 0%" is the signal that quota
 * tracking is working at all, so suppressing it would look like breakage.
 *
 * Composes with liveQuotaWindows, which zeroes a rolled-over window: after a
 * weekly rollover a scoped cap drops out until usage lands against it again.
 */
export function visibleQuotaWindows(windows: QuotaWindow[]): QuotaWindow[] {
  return windows.filter((w) => w.kind !== 'weekly_scoped' || w.utilization > 0);
}

// Two weekly windows count as resetting "together" within this slack. The
// account-wide and per-model caps roll over on the same schedule but are stamped
// microseconds apart, and observed values straddle a minute boundary
// (…T23:59:59.227Z against …T00:00:00.227Z), so an equality test would call them
// different. Anything genuinely separate would differ by hours or days.
const SAME_RESET_TOLERANCE_MS = 5 * 60 * 1000;

/** Whether two windows roll over on the same schedule. Two windows that have not
 * started yet (no reset time) also count as together. */
function resetsTogether(a: QuotaWindow, b: QuotaWindow): boolean {
  if (!a.resetsAt && !b.resetsAt) {
    return true;
  }
  const ta = Date.parse(a.resetsAt);
  const tb = Date.parse(b.resetsAt);
  if (isNaN(ta) || isNaN(tb)) {
    return false;
  }
  return Math.abs(ta - tb) <= SAME_RESET_TOLERANCE_MS;
}

/** One tooltip row: a window that owns the label and reset time, plus any
 * per-model caps folded in beside it because they share that reset. */
export interface QuotaRow {
  window: QuotaWindow;
  scoped: QuotaWindow[];
}

/**
 * Collapse the window list into tooltip rows, folding each per-model weekly cap
 * into the all-models weekly row when the two reset together. That is the normal
 * case, and printing the same reset twice wasted a row.
 *
 * A scoped cap that resets on its own schedule keeps its own row, so a future
 * cap with a different cadence cannot end up displayed under the wrong reset.
 */
export function groupQuotaRows(windows: QuotaWindow[]): QuotaRow[] {
  const rows: QuotaRow[] = [];
  const weeklyAll = windows.find((w) => w.kind === 'weekly_all');
  for (const w of windows) {
    if (w.kind === 'weekly_scoped' && weeklyAll && resetsTogether(weeklyAll, w)) {
      const host = rows.find((r) => r.window === weeklyAll);
      if (host) {
        host.scoped.push(w);
        continue;
      }
      // No host row yet (normalize orders weekly_all first, so this is only
      // reachable on an unexpected ordering): fall through to its own row.
    }
    rows.push({ window: w, scoped: [] });
  }
  return rows;
}

/** Major-unit value of a minor-unit money amount (3000 @ exponent 2 → 30). */
function majorUnits(money: ClaudeUsageMoney | null | undefined): number | null {
  const minor = Number(money?.amount_minor);
  if (!Number.isFinite(minor)) {
    return null;
  }
  const exponent = Number.isFinite(Number(money?.exponent)) ? Number(money?.exponent) : 2;
  return minor / Math.pow(10, exponent);
}

/** A finite, positive cap, or null. A missing, zero, or unparseable limit all
 * mean "no cap to measure against": the cap is user-adjustable and may be
 * unlimited, so its absence is normal rather than an error. */
function finiteCap(limit: number | null): number | null {
  return limit !== null && Number.isFinite(limit) && limit > 0 ? limit : null;
}

/**
 * Usage-credit spend, or null when the payload says nothing about credits.
 *
 * Deliberately NOT gated on the credits toggle. Spend already incurred this
 * month stays real after the user switches credits off, and hiding it then would
 * make money disappear from the report. The caller decides what to show; it
 * hides the row when nothing has been spent.
 *
 * Prefers the `spend` block, whose amounts are unambiguous (minor units plus an
 * explicit exponent). `extra_usage` is the older shape and only a fallback: its
 * `used_credits` scale could not be confirmed against live data, since it has
 * only ever been observed at 0, so it is assumed to match `decimal_places` like
 * `monthly_limit` does.
 */
export function creditsFromUsage(
  usage: ClaudeApiUsageResponse | null,
  now: number = Date.now()
): QuotaCredits | null {
  if (!usage) {
    return null;
  }
  const spend = usage.spend;
  if (spend) {
    const used = majorUnits(spend.used);
    if (used !== null) {
      const limit = finiteCap(majorUnits(spend.limit));
      const apiPct = Number(spend.percent);
      return {
        used,
        limit,
        currency: spend.used?.currency || spend.limit?.currency || 'USD',
        percent: limit === null ? null : Number.isFinite(apiPct) ? apiPct : (used / limit) * 100,
        resetsAt: firstOfNextMonth(now)
      };
    }
  }
  const extra = usage.extra_usage;
  if (extra) {
    const scale = Math.pow(10, Number.isFinite(Number(extra.decimal_places)) ? Number(extra.decimal_places) : 2);
    const usedMinor = Number(extra.used_credits);
    if (Number.isFinite(usedMinor)) {
      const limitMinor = Number(extra.monthly_limit);
      const limit = finiteCap(Number.isFinite(limitMinor) ? limitMinor / scale : null);
      const apiPct = Number(extra.utilization);
      return {
        used: usedMinor / scale,
        limit,
        currency: extra.currency || 'USD',
        percent: limit === null ? null : Number.isFinite(apiPct) ? apiPct : (usedMinor / scale / limit) * 100,
        resetsAt: firstOfNextMonth(now)
      };
    }
  }
  return null;
}
