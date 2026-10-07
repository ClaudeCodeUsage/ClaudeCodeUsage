export const LIVE_REFRESH_SECONDS = [
  '0', '1', '2', '5', '10', '20', '30', '60', '120', '300',
] as const;

export const CODEX_LIVE_REFRESH_SECONDS = [
  '0', '10', '30', '60', '120', '300',
] as const;

export type RefreshTrigger =
  | 'startup'
  | 'poll'
  | 'credentials'
  | 'watch'
  | 'focus'
  | 'workspace'
  | 'settings'
  | 'pricing'
  | 'manual';

/** Keep recurring Codex work small; a direct user refresh receives the larger
 * steady-state ceiling. First-time/migration backfill is selected by the worker. */
export function codexRefreshProfileForTrigger(
  trigger: RefreshTrigger,
): 'background' | 'foreground' {
  return trigger === 'manual' ? 'foreground' : 'background';
}

export type WindowActivityTransition = 'none' | 'resume' | 'suspend';

export class WindowActivityGate {
  constructor(private active: boolean) {}

  get focused(): boolean {
    return this.active;
  }

  update(nextFocused: boolean): WindowActivityTransition {
    if (nextFocused === this.active) return 'none';
    this.active = nextFocused;
    return nextFocused ? 'resume' : 'suspend';
  }
}

export function quotaFailureBackoffMs(failStreak: number): number {
  if (!Number.isFinite(failStreak) || failStreak <= 0) return 0;
  const exponent = Math.max(0, Math.floor(failStreak) - 1);
  return Math.min(3_600_000, 60_000 * Math.pow(2, exponent));
}

/** Filesystem watchers are only an acceleration path; polling remains active.
 * Retry quickly enough to recover from a transient OS handle failure, but cap
 * the retry cadence so an unsupported or exhausted filesystem cannot hot-loop. */
export function watcherFailureBackoffMs(failStreak: number): number {
  if (!Number.isFinite(failStreak) || failStreak <= 0) return 0;
  const exponent = Math.max(0, Math.floor(failStreak) - 1);
  return Math.min(60_000, 1_000 * Math.pow(2, exponent));
}

/** One runtime revision, not a retry queue or persisted source history. The
 * normal scheduler supplies attempts; this gate never creates another timer.
 * A revision changes only with data/price/parse authority, not presentation. */
export class ClaudeRefreshRecovery {
  private revision: string | undefined;
  private failStreak = 0;
  private automaticRetryAt = 0;
  private manualRetryAt = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  admit(revision: string, trigger: RefreshTrigger): boolean {
    if (revision !== this.revision) {
      this.revision = revision;
      this.reset();
    }
    return this.failStreak === 0 || this.now() >=
      (trigger === 'manual' ? this.manualRetryAt : this.automaticRetryAt);
  }

  fail(revision: string): void {
    if (revision !== this.revision) return;
    this.failStreak = Math.min(6, this.failStreak + 1);
    const now = this.now();
    this.automaticRetryAt = now + Math.min(900_000, 30_000 * 2 ** (this.failStreak - 1));
    this.manualRetryAt = now + 5_000;
  }

  succeed(revision: string): void {
    if (revision === this.revision) this.reset();
  }

  private reset(): void {
    this.failStreak = 0;
    this.automaticRetryAt = 0;
    this.manualRetryAt = 0;
  }
}

const TRIGGER_PRIORITY: Record<RefreshTrigger, number> = {
  startup: 0,
  poll: 1,
  credentials: 2,
  watch: 3,
  focus: 4,
  workspace: 5,
  settings: 6,
  pricing: 7,
  manual: 8,
};

export function pollIntervalMs(refreshIntervalSeconds: number): number {
  const seconds = Number.isFinite(refreshIntervalSeconds)
    ? Math.min(3600, Math.max(30, refreshIntervalSeconds))
    : 60;
  return seconds * 1000;
}

export function mergeRefreshTrigger(
  current: RefreshTrigger | null,
  incoming: RefreshTrigger,
): RefreshTrigger {
  if (current === null) return incoming;
  return TRIGGER_PRIORITY[incoming] > TRIGGER_PRIORITY[current] ? incoming : current;
}

export class QuietDebounce {
  private handle: NodeJS.Timeout | undefined;

  constructor(
    private readonly schedule: (callback: () => void, ms: number) => NodeJS.Timeout = setTimeout,
    private readonly cancel: (handle: NodeJS.Timeout) => void = clearTimeout
  ) {}

  push(ms: number, callback: () => void): void {
    if (this.handle) this.cancel(this.handle);
    this.handle = this.schedule(() => {
      this.handle = undefined;
      callback();
    }, ms);
  }

  clear(): void {
    if (this.handle) this.cancel(this.handle);
    this.handle = undefined;
  }
}

export interface RefreshRequest {
  forceReload: boolean;
  trigger: RefreshTrigger;
}

export function shouldReloadUsage(value: {
  forceReload: boolean;
  directoryChanged: boolean;
  hasLoadedManifest: boolean;
  changedFiles: number;
  removedFiles: number;
}): boolean {
  return value.forceReload || value.directoryChanged || !value.hasLoadedManifest ||
    value.changedFiles > 0 || value.removedFiles > 0;
}

export function shouldCommitUsageLoad(filesFailed: number): boolean {
  return Number.isInteger(filesFailed) && filesFailed === 0;
}

export function commitRefreshSnapshot<TManifest, TRecords>(
  manifest: TManifest,
  records: TRecords,
  filesFailed: number,
  commit: (manifest: TManifest, records: TRecords) => void,
): boolean {
  if (!shouldCommitUsageLoad(filesFailed)) return false;
  commit(manifest, records);
  return true;
}

export function reportColdRefreshFailure(value: {
  hasLoadedManifest: boolean;
  updateWebview: boolean;
  error: string;
  onStatusError: (error: string) => void;
  onWebviewError: (error: string) => void;
}): boolean {
  if (value.hasLoadedManifest) return false;
  value.onStatusError(value.error);
  if (value.updateWebview) value.onWebviewError(value.error);
  return true;
}

export class RefreshSingleFlight {
  private active = false;
  private pendingForceReload = false;
  private pendingTrigger: RefreshTrigger | null = null;

  request(forceReload: boolean, trigger: RefreshTrigger): RefreshRequest | null {
    if (!this.active) {
      this.active = true;
      return { forceReload, trigger };
    }
    this.pendingForceReload ||= forceReload;
    this.pendingTrigger = mergeRefreshTrigger(this.pendingTrigger, trigger);
    return null;
  }

  complete(): RefreshRequest | null {
    if (this.pendingTrigger === null) {
      this.active = false;
      return null;
    }
    const next = {
      forceReload: this.pendingForceReload,
      trigger: this.pendingTrigger,
    };
    this.pendingForceReload = false;
    this.pendingTrigger = null;
    return next;
  }
}
