import { ClaudeApiUsageResponse, ClaudeUsageLimitEntry } from './types';
import { ProviderLimitSnapshot } from './providers/providerTypes';
import {
  QUOTA_PACE_MAX_WINDOWS, QUOTA_PACE_WEEK_MS,
  QuotaPaceAdapterSnapshot, QuotaPaceAdapterWindow,
} from './quotaPaceAdapters';

export interface ClaudeQuotaPaceSourceInput {
  readonly enabled: boolean;
  /** Existing raw successful response, BEFORE normalization/live reset zeros. */
  readonly usage: ClaudeApiUsageResponse | null;
  /** ORIGINAL successful fetch time, never the dashboard repaint time. */
  readonly observedAt: number | null;
  /** Owner supplies fingerprintForStableIdentity ONLY when the request had a
   * verified account signal. Profile continuity, raw IDs and tokens do not qualify.
   * Shape validation below is not verification of the caller's attribution.
   */
  readonly verifiedAccountFingerprint: string | null;
}

interface SourceRow {
  readonly rank: number;
  readonly key: string | null;
  readonly window: QuotaPaceAdapterWindow;
}
interface Projection {
  readonly source: 'generic' | 'legacy';
  readonly rows: readonly SourceRow[];
  readonly ambiguous: boolean;
}
interface Anchor {
  readonly account: string;
  readonly source: Projection['source'];
  readonly observedAt: number;
  readonly rows: readonly SourceRow[];
}

const MAX_TIME = 8_640_000_000_000_000;
function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TIME ? value : null;
}
function percent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : NaN;
}
function reset(value: unknown): number | null {
  // Do not coerce numbers/null or interpret timezone-less dates in local time.
  if (typeof value !== 'string' || value.length > 64 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  return timestamp(Date.parse(value));
}
function fingerprint(value: unknown): string | null {
  return typeof value === 'string' && /^acct_[a-f0-9]{32}$/.test(value) ? value : null;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function scopePart(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 256 && value.trim().length > 0 ? value : null;
}
function scopeKey(entry: ClaudeUsageLimitEntry): string | null {
  const scope = entry.scope;
  if (!record(scope)) return null;
  const model = scope.model;
  const id = record(model) ? scopePart(model.id) : null;
  const name = record(model) ? scopePart(model.display_name) : null;
  const surface = scopePart(scope.surface);
  // A rename of a verified model id is harmless; matching display labels never
  // conceal a changed id. Surface remains part of the window identity.
  return id || name || surface ? JSON.stringify([id, id ? null : name, surface]) : null;
}

function projectClaude(usage: ClaudeApiUsageResponse): Projection {
  const rows: SourceRow[] = [];
  const entries = usage.limits;
  let ambiguous = false;
  // Never fall through from a nonempty generic payload to legacy authority.
  // Reject oversize BEFORE item getters, normalization or sorting can scan it.
  if (Array.isArray(entries) && entries.length > 0) {
    if (entries.length > QUOTA_PACE_MAX_WINDOWS) return { source: 'generic', rows, ambiguous: true };
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!record(entry)) { ambiguous = true; continue; }
      const rawKind = entry.kind;
      // Mirror the display normalizer's recognized-row ordering, including its
      // group fallback, WITHOUT granting that fallback weekly semantics.
      const displayKind = rawKind === 'session' || rawKind === 'weekly_all' || rawKind === 'weekly_scoped'
        ? rawKind : entry.group === 'session' ? 'session' : entry.group === 'weekly' ? 'weekly_scoped' : null;
      if (displayKind === null) { ambiguous = true; continue; }
      const weekly = rawKind === 'weekly_all' || rawKind === 'weekly_scoped';
      const kind = weekly ? rawKind : 'other';
      const key = rawKind === 'weekly_all' ? 'all' : rawKind === 'weekly_scoped' ? scopeKey(entry) : null;
      if (rawKind !== 'session' && !weekly) ambiguous = true;
      rows.push({
        rank: displayKind === 'session' ? 0 : displayKind === 'weekly_all' ? 1 : 2,
        key,
        window: { slot: index, kind, usedPercent: percent(entry.percent), resetAt: reset(entry.resets_at),
          periodMs: weekly ? QUOTA_PACE_WEEK_MS : rawKind === 'session' ? 5 * 60 * 60_000 : null },
      });
    }
    // Stable bounded ordering matches normalizeQuotaWindows; slots are assigned
    // before adapters filter session/unknown rows or liveQuotaWindows drops them.
    rows.sort((a, b) => a.rank - b.rank || a.window.slot - b.window.slot);
    return { source: 'generic', rows: rows.map((row, slot) => ({ ...row, window: { ...row.window, slot } })), ambiguous };
  }
  if (entries !== null && entries !== undefined && !Array.isArray(entries)) {
    return { source: 'generic', rows, ambiguous: true };
  }
  const legacy = [
    ['five_hour', 'other', null], ['seven_day', 'weekly_all', 'all'],
    ['seven_day_opus', 'weekly_scoped', 'legacy-opus'], ['seven_day_sonnet', 'weekly_scoped', 'legacy-sonnet'],
  ] as const;
  for (const [field, kind, key] of legacy) {
    const limit = usage[field];
    if (limit === null || limit === undefined) continue;
    if (!record(limit)) { ambiguous = true; continue; }
    rows.push({ rank: 0, key, window: {
      slot: rows.length, kind, usedPercent: percent(limit.utilization), resetAt: reset(limit.resets_at),
      periodMs: kind === 'other' ? 5 * 60 * 60_000 : QUOTA_PACE_WEEK_MS,
    } });
  }
  return { source: 'legacy', rows, ambiguous };
}

function weeklyRows(projection: Projection): readonly SourceRow[] {
  return projection.rows.filter(row => row.window.kind !== 'other');
}
function validRows(rows: readonly SourceRow[], observedAt: number | null): boolean {
  if (observedAt === null || rows.length === 0) return false;
  const identities = new Set<string>();
  return rows.every(({ key, window }) => {
    if (key === null || identities.has(key)) return false;
    identities.add(key);
    return Number.isFinite(window.usedPercent) && window.resetAt !== null &&
      window.resetAt >= QUOTA_PACE_WEEK_MS && observedAt >= window.resetAt - QUOTA_PACE_WEEK_MS && observedAt < window.resetAt;
  });
}
function sameIdentity(anchor: Anchor, next: Anchor): boolean {
  return next.account === anchor.account && next.source === anchor.source && next.rows.length === anchor.rows.length &&
    next.rows.every((row, index) => row.key === anchor.rows[index].key &&
      row.window.slot === anchor.rows[index].window.slot && row.window.kind === anchor.rows[index].window.kind);
}
function continuous(anchor: Anchor, next: Anchor, requireRollover: boolean): boolean {
  if (!sameIdentity(anchor, next) || next.observedAt < anchor.observedAt) return false;
  return next.rows.every((row, index) => {
    const prior = anchor.rows[index];
    const current = row.window;
    const previous = prior.window;
    if (row.key !== prior.key || current.slot !== previous.slot || current.kind !== previous.kind) return false;
    if (current.resetAt === previous.resetAt) {
      return !requireRollover && current.usedPercent >= previous.usedPercent &&
        (next.observedAt !== anchor.observedAt || current.usedPercent === previous.usedPercent);
    }
    return current.resetAt === previous.resetAt! + QUOTA_PACE_WEEK_MS && next.observedAt >= previous.resetAt!;
  });
}

/** One owner per runtime, retained across settings toggles and account changes.
 * project() consumes only existing successful snapshots; no I/O, subscriptions,
 * persistence, scan, timers or clock. Work/state per window is bounded by 16.
 * Weak keys retain original fetch metadata without retaining raw responses.
 * Do not recreate this owner on repaint or use persisted quota history as input.
 */
export class ClaudeQuotaPaceSource {
  private readonly original = new WeakMap<ClaudeApiUsageResponse, { observedAt: number | null; account: string | null }>();
  private anchor: Anchor | null = null;
  // At most one separately verified changed identity, each with at most 16
  // rows. It cannot confer trust until its own ordinary seven-day rollover.
  private pending: Anchor | null = null;
  private latched = false;

  project(input: ClaudeQuotaPaceSourceInput): QuotaPaceAdapterSnapshot | null {
    if (input.enabled !== true) return null;
    const usage = input.usage;
    if (!record(usage)) return null;
    const suppliedAccount = fingerprint(input.verifiedAccountFingerprint);
    let original = this.original.get(usage);
    if (!original) {
      original = { observedAt: timestamp(input.observedAt), account: suppliedAccount };
      this.original.set(usage, original);
    }
    const { observedAt, account } = original;
    const projection = projectClaude(usage);
    const rows = weeklyRows(projection);
    const valid = !projection.ambiguous && validRows(rows, observedAt);
    const sameAttribution = account === suppliedAccount;
    let trust: QuotaPaceAdapterSnapshot['accountWindowTrust'] = projection.ambiguous ? 'ambiguous' : 'unknown';
    const next: Anchor | null = valid && account !== null && sameAttribution
      ? { account, source: projection.source, observedAt: observedAt!, rows } : null;
    if (this.anchor) {
      let recovered = next && continuous(this.anchor, next, this.latched) ? next : null;
      if (!recovered && next && !sameIdentity(this.anchor, next)) {
        if (this.pending && sameIdentity(this.pending, next)) {
          if (continuous(this.pending, next, true)) {
            recovered = next;
          } else if (continuous(this.pending, next, false) &&
              next.rows.every((row, index) => row.window.resetAt === this.pending!.rows[index].window.resetAt)) {
            // Advance same-window high-water values, but retain the reset basis
            // through drops, early drift and partially rolled scoped rowsets.
            this.pending = next;
          }
        } else if (next.observedAt >= this.anchor.observedAt &&
            (!this.pending || next.observedAt >= this.pending.observedAt)) {
          this.pending = next;
        }
      }
      if (recovered) {
        this.anchor = recovered;
        this.pending = null;
        this.latched = false;
        trust = 'trusted';
      } else {
        // Keep the last good high-water/reset/identity anchor, never the bad row.
        // A later repaint or restored higher counter cannot silently bless it.
        this.latched = true;
        trust = 'discontinuous';
      }
    } else if (next) {
      this.anchor = next;
      trust = 'trusted';
    }
    // Private keys/account evidence never enter the numeric adapter DTO.
    // Copy values so callers cannot mutate the continuity anchor through it.
    return { observedAt, source: 'observed', accountWindowTrust: trust,
      windows: projection.rows.map(row => ({ ...row.window })) };
  }
}

export interface CodexQuotaPaceSourceInput {
  readonly enabled: boolean;
  readonly snapshot: ProviderLimitSnapshot | null;
}

/** Strict display join, before the normalizer's intentionally tolerant zero.
 * Reuses the same bounded raw projection without account/state/clock work.
 */
export function matchesClaudeQuotaPaceWindow(usage: ClaudeApiUsageResponse | null,
  evidence: QuotaPaceAdapterWindow): boolean {
  if (!record(usage) || !Number.isInteger(evidence.slot) || evidence.slot < 0 ||
      evidence.slot >= QUOTA_PACE_MAX_WINDOWS) return false;
  const projection = projectClaude(usage);
  if (projection.ambiguous) return false;
  const actual = projection.rows[evidence.slot]?.window;
  return !!actual && actual.kind !== 'other' && actual.kind === evidence.kind &&
    Number.isFinite(actual.usedPercent) && actual.usedPercent === evidence.usedPercent &&
    actual.resetAt !== null && actual.resetAt === evidence.resetAt && actual.periodMs === evidence.periodMs;
}

/** Existing Codex local-log snapshots carry no verified account signal. Numeric
 * weekly rows are useful display joins but ALWAYS remain unknown account trust.
 * Never infer identity from limitId, path, confidence or single-window count.
 */
export function projectCodexQuotaPaceSource(input: CodexQuotaPaceSourceInput): QuotaPaceAdapterSnapshot | null {
  if (input.enabled !== true) return null;
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.provider !== 'codex' || snapshot.source !== 'local-log') return null;
  const rawWindows = snapshot.windows;
  const windows: QuotaPaceAdapterWindow[] = [];
  if (Array.isArray(rawWindows) && rawWindows.length <= QUOTA_PACE_MAX_WINDOWS) {
    for (let slot = 0; slot < rawWindows.length; slot++) {
      const row = rawWindows[slot];
      if (!record(row)) continue;
      const periodMs = typeof row.windowMinutes === 'number' && Number.isFinite(row.windowMinutes) && row.windowMinutes > 0
        && Number.isFinite(row.windowMinutes * 60_000) ? row.windowMinutes * 60_000 : null;
      windows.push({ slot, kind: periodMs === QUOTA_PACE_WEEK_MS ? 'weekly_all' : 'other',
        usedPercent: percent(row.usedPercent), resetAt: timestamp(row.resetsAt), periodMs });
    }
  }
  return { observedAt: timestamp(snapshot.observedAt), source: 'observed', accountWindowTrust: 'unknown', windows };
}
