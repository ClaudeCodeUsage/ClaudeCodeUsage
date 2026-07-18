export const LIVE_REFRESH_SECONDS = [
  '0', '1', '2', '5', '10', '20', '30', '60', '120', '300',
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
