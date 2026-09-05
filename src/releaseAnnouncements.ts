export interface ReleaseAnnouncement {
  version: string;
}

export type ReleaseAnnouncementCatalog<
  T extends ReleaseAnnouncement = ReleaseAnnouncement,
> = Record<string, T>;

/** Return an announcement only for a real upgrade to an exactly catalogued version. */
export function announcementForUpgrade<T extends ReleaseAnnouncement>(
  current: string,
  lastSeen: string | undefined,
  enabled: boolean,
  catalog: ReleaseAnnouncementCatalog<T>,
): T | null {
  if (!enabled || !current || !lastSeen || current === lastSeen) {
    return null;
  }
  return catalog[current] ?? null;
}

/** Select the newest full semantic version available for manual preview. */
export function latestAnnouncementVersion(
  catalog: Record<string, unknown>,
): string | undefined {
  const compareVersions = (left: string, right: string): number => {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
      const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  };

  return Object.keys(catalog).sort(compareVersions).pop();
}
