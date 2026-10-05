/** Minimal, local evidence of deliberate dashboard actions. Never store values. */
export interface AchievementActivity {
  schemaVersion: 2;
  settingKeys: string[];
  features: AchievementFeature[];
}

export type AchievementFeature =
  'achievementGalleryViewed' | 'achievementSharePreview' |
  'localShareExport' | 'localAdviceFeedback';

// Public, low-risk dashboard controls only. Paths, secrets, network/consent and
// provider collection switches must never become an achievement requirement.
export const ACHIEVEMENT_SETTING_KEYS = [
  'compactNumbers', 'dashboardAutoRefresh', 'decimalPlaces', 'displayCurrency',
  'enableShareCard', 'fileWatchSeconds', 'language', 'projectGroupingMode',
  'quotaFiveHourOnly', 'refreshInterval', 'releaseAnnouncements',
  'resetCountdownFormat', 'showContext', 'showCost', 'showCostliestMessages',
  'showEfficiency', 'showHeatmap', 'showInsights', 'showProjectUsageMatrix',
  'showResetInStatusBar', 'showScopedWeekly', 'showWeeklyEquivalentValue',
  'statusBarMetric', 'statusBarProvider', 'statusBarQuotaFormat', 'timezone',
  'tokenDecimalPlaces', 'workflowQuotaWarnPercent', 'codex.statusMetric',
] as const;

const SETTING_KEYS = new Set<string>(ACHIEVEMENT_SETTING_KEYS);
export const SAFE_EXPLORATION_FEATURES: readonly AchievementFeature[] = [
  'achievementGalleryViewed', 'achievementSharePreview', 'localShareExport',
];
const FEATURES = new Set<AchievementFeature>([
  ...SAFE_EXPLORATION_FEATURES, 'localAdviceFeedback',
]);

export function emptyAchievementActivity(): AchievementActivity {
  return { schemaVersion: 2, settingKeys: [], features: [] };
}

export function isAchievementSettingKey(key: string): boolean {
  return SETTING_KEYS.has(key);
}

function normalizeAchievementActivity(raw: unknown, version: 1 | 2): AchievementActivity {
  if (!raw || typeof raw !== 'object' || (raw as { schemaVersion?: unknown }).schemaVersion !== version) {
    return emptyAchievementActivity();
  }
  const state = raw as { settingKeys?: unknown; features?: unknown };
  return {
    schemaVersion: 2,
    settingKeys: Array.isArray(state.settingKeys)
      ? [...new Set(state.settingKeys.filter((key): key is string =>
        typeof key === 'string' && SETTING_KEYS.has(key)))].sort()
      : [],
    features: Array.isArray(state.features)
      ? [...new Set(state.features.filter((feature): feature is AchievementFeature =>
        typeof feature === 'string' && FEATURES.has(feature as AchievementFeature) &&
        (version === 2 || feature !== 'achievementSharePreview')))].sort()
      : [],
  };
}

export function parseAchievementActivity(raw: unknown): AchievementActivity {
  return normalizeAchievementActivity(raw, 2);
}

/** v1 could record a restored preview as a deliberate action. Drop only that fact. */
export function migrateAchievementActivityV1(raw: unknown): AchievementActivity {
  return normalizeAchievementActivity(raw, 1);
}

export function recordAchievementSettingChange(
  state: AchievementActivity, key: string, changed: boolean,
): AchievementActivity {
  if (!changed || !SETTING_KEYS.has(key) || state.settingKeys.includes(key)) return state;
  return { ...state, settingKeys: [...state.settingKeys, key].sort() };
}

export function recordAchievementFeature(
  state: AchievementActivity, feature: AchievementFeature,
): AchievementActivity {
  if (!FEATURES.has(feature) || state.features.includes(feature)) return state;
  return { ...state, features: [...state.features, feature].sort() };
}
