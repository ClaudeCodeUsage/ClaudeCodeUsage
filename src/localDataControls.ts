import type { QuotaObservationStoreV2 } from './quotaObservationStore';
import type { UsageProvider } from './providers/providerTypes';
import { GITHUB_HEATMAP_DESTINATION_KEY } from './githubHeatmapPublish';

/**
 * Public, value-free description of one class of local data. Inventory rows
 * deliberately contain no path, account fingerprint, setting value, or raw
 * provider payload.
 */
export interface LocalDataInventoryRow {
  id: string;
  category: string;
  locationClass: string;
  schema: string;
  approximateBytes: number | null;
  itemCount: number | null;
  oldestAt: number | null;
  newestAt: number | null;
  networkInteraction: string;
  clearability: string;
}

export interface LocalDataClientSummary {
  uiPreferenceKeys: number;
  webviewStateFields: number;
  sharingPreferenceKeys: number;
}

export interface LocalDataQuotaScopeOption {
  token: string;
  label: string;
  provider: UsageProvider | 'all';
  itemCount: number;
  oldestAt: number | null;
  newestAt: number | null;
}

export interface LocalDataInventory {
  schemaVersion: 1;
  generatedAt: number;
  rows: LocalDataInventoryRow[];
  quotaScopes: LocalDataQuotaScopeOption[];
  exclusions: string[];
}

export type LocalDataAction =
  | 'rebuild-codex-index'
  | 'clear-quota-history'
  | 'clear-advice-data'
  | 'reset-ui-state'
  | 'reset-sharing-preferences'
  | 'clear-byok-secret'
  | 'clear-all-derived-data';

const LOCAL_DATA_ACTIONS: readonly LocalDataAction[] = [
  'rebuild-codex-index',
  'clear-quota-history',
  'clear-advice-data',
  'reset-ui-state',
  'reset-sharing-preferences',
  'clear-byok-secret',
  'clear-all-derived-data',
];

export function isLocalDataAction(value: unknown): value is LocalDataAction {
  return typeof value === 'string' &&
    (LOCAL_DATA_ACTIONS as readonly string[]).includes(value);
}

export type LocalDataClientAction =
  | 'reset-ui-state'
  | 'reset-sharing-preferences'
  | 'clear-all-client-state';

export interface LocalDataClientResetTombstone {
  schemaVersion: 1;
  revision: number;
  action: LocalDataClientAction;
}

export interface LocalDataActionResult {
  ok: boolean;
  cancelled?: boolean;
  message: string;
  clientAction?: LocalDataClientAction;
}

export interface ResolvedQuotaScope {
  provider?: UsageProvider;
  accountFingerprint?: string;
}

export const LOCAL_DATA_SOURCE_EXCLUSIONS = [
  'Claude provider-owned source logs',
  'Codex provider-owned source logs',
  'provider-owned OAuth credentials and cookies',
  'external account quotas and subscription state',
] as const;

/** Exact globalState prefixes owned by this extension and eligible for clear-all. */
export const LOCAL_DATA_GLOBAL_STATE_PREFIXES = [
  'ccu.usageLimits.',
  'ccu.weeklyQuotaHistory.v1.',
] as const;

export const LOCAL_DATA_PENDING_CLIENT_RESET_KEY =
  'ccu.localData.pendingClientReset.v1' as const;

/** Exact non-setting globalState keys eligible for clear-all. */
export const LOCAL_DATA_GLOBAL_STATE_KEYS = [
  'ccu.adviceEffectiveness.localState',
  'ccu.codex.backgroundWork.v1',
  'ccu.codex.machineSalt',
  'ccu.heatmapPath',
  'ccu.heatmapRepo',
  GITHUB_HEATMAP_DESTINATION_KEY,
  'ccu.lastSeenVersion',
  LOCAL_DATA_PENDING_CLIENT_RESET_KEY,
  'ccu.migrated.dashboardAutoRefresh',
  'ccu.migrated.showScopedWeekly',
  'ccu.quota.fingerprintSalt.v1',
  'ccu.quota.migratedCodexIndex.v2',
  'ccu.settingsMigrated.v1',
] as const;

/** Known, released advice-ledger keys retired by the versioned v3 ledger. */
export const LEGACY_ADVICE_LOCAL_STATE_KEYS: readonly string[] = [
  'claudeCodeUsage.adviceEffectiveness.feedback.v1',
];

export const LOCAL_DATA_ACTION_TARGETS: Record<LocalDataAction, readonly string[]> = {
  'rebuild-codex-index': [
    'globalStorageUri/codex-index-v1.json',
    'exact codex-index-v1.corrupt-<timestamp>-<pid>.json recovery files',
    'exact codex-index-v1.json.tmp-<pid>-<uuid> interrupted-write files',
    'runtime Codex derived views (then rebuilt from read-only source logs)',
  ],
  'clear-quota-history': [
    'selected rows in globalStorageUri/quota-observations-v2.json; an all-clear retains one valid empty canonical document',
    'exact quota-observations-v2.json quarantine/interrupted-write recovery files on an all-clear',
    'matching legacy ccu.usageLimits.* and ccu.weeklyQuotaHistory.v1.* migration inputs when clearing all Claude history',
    'ccu.quota.migratedCodexIndex.v2 marker when clearing Codex history',
  ],
  'clear-advice-data': [
    'ccu.adviceEffectiveness.localState',
    'claudeCodeUsage.adviceEffectiveness.feedback.v1',
  ],
  'reset-ui-state': [
    'P10 Webview state and allowlisted UI localStorage keys',
  ],
  'reset-sharing-preferences': [
    'active ccu.setting.enableShareCard and retired compatibility ccu.setting.showHeatmap',
    'ccu.sharing.template presentation selection',
    'ccu.combinedHeatmap.title, .range, .privacyPreview, .intensityMode, .palette, and .customAccent Webview keys',
    'ccu.heatmapDestination.v1 plus legacy ccu.heatmapRepo and ccu.heatmapPath destination strings',
    'in-memory share-card SVG/configuration preview',
  ],
  'clear-byok-secret': [
    'SecretStorage claudeCodeUsage.secret.advice.apiKey',
    'legacy ccu.setting.advice.apiKey and currently inspectable configuration scopes',
  ],
  'clear-all-derived-data': [
    'P1 exact Codex index/recovery/interrupted-write file family',
    'P2 exact quota-observation/quarantine/interrupted-write file family, replaced by one valid empty canonical document',
    'P3/P4 ccu.usageLimits.* and ccu.weeklyQuotaHistory.v1.* migration inputs',
    'P6 exact catalogued ccu.setting.<key> names, worker/release/migration keys, pending client-reset marker, and currently inspectable configuration scopes',
    'P7 ccu.codex.machineSalt and ccu.quota.fingerprintSalt.v1',
    'P8 SecretStorage claudeCodeUsage.secret.advice.apiKey and exact plaintext migration locations',
    'P9 ccu.adviceEffectiveness.localState and claudeCodeUsage.adviceEffectiveness.feedback.v1',
    'P10 four allowlisted UI localStorage keys plus Webview state',
    'P11 one active plus one retired sharing setting, seven sharing localStorage keys, two destination keys, and in-memory preview',
  ],
};

export function finiteTimestampRange(
  values: readonly (number | null | undefined)[],
): { oldestAt: number | null; newestAt: number | null } {
  const timestamps = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
  return {
    oldestAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
    newestAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
  };
}

export function approximateJsonBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : Buffer.byteLength(serialized, 'utf8');
  } catch {
    return null;
  }
}

export interface QuotaEpochGroup {
  provider: UsageProvider;
  accountFingerprint: string;
  itemCount: number;
  oldestAt: number | null;
  newestAt: number | null;
}

/** Internal-only grouping. Callers must replace fingerprints with random tokens. */
export function groupQuotaAccountEpochs(
  store: QuotaObservationStoreV2,
): QuotaEpochGroup[] {
  const groups = new Map<string, QuotaEpochGroup>();
  for (const observation of store.observations) {
    const key = `${observation.provider}\0${observation.accountFingerprint}`;
    const current = groups.get(key) ?? {
      provider: observation.provider,
      accountFingerprint: observation.accountFingerprint,
      itemCount: 0,
      oldestAt: null,
      newestAt: null,
    };
    current.itemCount += 1;
    current.oldestAt = current.oldestAt === null
      ? observation.observedAt
      : Math.min(current.oldestAt, observation.observedAt);
    current.newestAt = current.newestAt === null
      ? observation.observedAt
      : Math.max(current.newestAt, observation.observedAt);
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) =>
    left.provider.localeCompare(right.provider) ||
    left.accountFingerprint.localeCompare(right.accountFingerprint),
  );
}

export function shouldClearQuotaObservation(
  observation: QuotaObservationStoreV2['observations'][number],
  scope: ResolvedQuotaScope,
): boolean {
  return (scope.provider === undefined || observation.provider === scope.provider) &&
    (scope.accountFingerprint === undefined ||
      observation.accountFingerprint === scope.accountFingerprint);
}

export function localDataActionTitle(action: LocalDataAction, locale: string): string {
  const zh = locale === 'zh-CN';
  const labels: Record<LocalDataAction, [string, string]> = {
    'rebuild-codex-index': ['Rebuild Codex derived index', '重建 Codex 派生索引'],
    'clear-quota-history': ['Clear quota observation history', '清除额度观测历史'],
    'clear-advice-data': ['Clear advice data', '清除建议数据'],
    'reset-ui-state': ['Reset dashboard UI state', '重置仪表板界面状态'],
    'reset-sharing-preferences': ['Reset sharing preferences', '重置分享偏好'],
    'clear-byok-secret': ['Clear BYOK advice secret', '清除 BYOK 建议密钥'],
    'clear-all-derived-data': ['Clear all extension-derived data', '清除全部插件派生数据'],
  };
  return labels[action][zh ? 1 : 0];
}
