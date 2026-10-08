import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, AchievementId } from './achievements';

export interface AchievementGalleryEntry {
  readonly key: string;
  readonly levelIds: readonly AchievementId[];
  readonly milestoneIds: readonly AchievementId[];
}

// Display ownership only. Award identities, conditions, artwork and saved pin keys stay intact.
const milestoneOwners = new Map<AchievementId, string>([
  ['streak-machine', 'active-day-streak'],
  ['dual-provider-day', 'dual-provider-days'],
]);
const seriesFor = new Map(Object.entries(ACHIEVEMENT_SERIES)
  .flatMap(([key, ids]) => ids.map(id => [id, key] as const)));
export const ACHIEVEMENT_GALLERY: readonly AchievementGalleryEntry[] = Object.freeze(
  [...new Set(ACHIEVEMENT_DEFINITIONS.filter(rule => !milestoneOwners.has(rule.id))
    .map(rule => seriesFor.get(rule.id) ?? rule.id))].map(key => Object.freeze({
      key,
      levelIds: Object.freeze([...(ACHIEVEMENT_SERIES[key] ?? [key as AchievementId])]),
      milestoneIds: Object.freeze([...milestoneOwners].filter(([, owner]) => owner === key).map(([id]) => id)),
    })),
);
const displayKey = new Map<string, string>(ACHIEVEMENT_GALLERY.flatMap(entry =>
  [entry.key, ...entry.levelIds, ...entry.milestoneIds].map(alias => [alias, entry.key] as const)));

/** Resolve a known old disclosure/pin/award key without changing persisted identities. */
export function achievementGalleryKey(key: string): string | undefined {
  return displayKey.get(key);
}
