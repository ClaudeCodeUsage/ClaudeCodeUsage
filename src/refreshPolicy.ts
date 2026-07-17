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
