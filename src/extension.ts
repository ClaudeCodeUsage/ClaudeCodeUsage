import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomBytes } from 'crypto';
import { renderHeatmapSvg } from './heatmapSvg';
import { DEFAULT_SECTIONS, ShareRange, buildShareCardData, shareCardFilename } from './shareCard';
import { renderShareCardSvg } from './shareCardSvg';
import * as vscode from 'vscode';
import { ClaudeDataLoader } from './dataLoader';
import {
  ClaudeUsageIndex,
  claudeUsageDashboardSnapshot,
  createClaudeUsageIndex,
  updateClaudeUsageIndex,
} from './claudeIncrementalIndex';
import { StatusBarManager } from './statusBar';
import { UsageWebviewProvider } from './webview';
import { I18n } from './i18n';
import { dayKeyInZone, resolveTimeZone } from './dateKeys';
import {
  GITHUB_PUBLIC_REPO_SCOPE,
  createGitHubPublishPlan,
  githubPublishConfirmationDetail,
  probePublicGitHubPublishTarget,
  publishPublicGitHubFile,
} from './githubHeatmapPublish';
import { fetchLatestPricing, setPricingBackend } from './pricing';
import { ClaudeApiClient } from './claudeApiClient';
import {
  buildOptimizerSystemPrompt,
} from './advisor';
import { ClaudeApiUsageResponse, ContentAnalysis, ExtensionConfig } from './types';
import {
  KNOWN_CONFIGURATION_SETTING_KEYS,
  OWNED_SETTING_GLOBAL_STATE_KEYS,
  REGISTERED_CONFIGURATION_SETTING_KEYS,
  SettingsLocalDataClearError,
  SettingsStore,
} from './settings';
import { normalizeQuotaWindows } from './quotaWindows';
import {
  WeeklyQuotaObservation,
} from './weeklyValue';
import {
  claudeQuotaCapturesFromUsage,
  codexQuotaCapturesFromWeeklyObservations,
  createEmptyQuotaObservationStore,
  fingerprintForStableIdentity,
  loadQuotaObservationStore,
  mergeQuotaCaptures,
  QUOTA_OBSERVATION_FILE,
  QuotaCapture,
  QuotaObservationRepository,
  QuotaObservationScopedClearBlockedError,
  QuotaObservationStoreV2,
  quotaStoreWeeklyObservations,
} from './quotaObservationStore';
import {
  diffUsageManifests,
  scanUsageManifest,
  UsageManifest,
} from './claudeUsageFiles';
import {
  commitRefreshSnapshot,
  codexRefreshProfileForTrigger,
  pollIntervalMs,
  quotaFailureBackoffMs,
  QuietDebounce,
  RefreshRequest,
  RefreshSingleFlight,
  RefreshTrigger,
  reportColdRefreshFailure,
  shouldCommitUsageLoad,
  shouldReloadUsage,
  watcherFailureBackoffMs,
  WindowActivityGate,
} from './refreshPolicy';
import {
  formatCodexIndexDiagnostic,
  formatRefreshDiagnostic,
} from './refreshDiagnostics';
import {
  CodexProvider,
  CodexProviderSnapshot,
} from './providers/codex/codexProvider';
import {
  CodexIndexProgress,
  loadCodexIndex,
} from './providers/codex/codexIndex';
import { acquireCodexIndexLease } from './providers/codex/codexIndexLease';
import { weeklyQuotaObservationsFromCodexHistory } from './providers/codex/codexQuotaHistory';
import { resolveCodexHome } from './providers/codex/codexManifest';
import { buildCodexUsageView, CodexUsageView } from './providers/codex/codexUsage';
import {
  buildScopedCodexInsights,
  CodexScopedInsights,
  emptyCodexScopedInsights,
} from './providers/codex/codexInsights';
import {
  announcementForUpgrade,
  latestAnnouncementVersion,
  ReleaseAnnouncementCatalog,
} from './releaseAnnouncements';
import {
  adaptClaudeAdvice,
  adaptCodexLocalAdvice,
} from './adviceEffectiveness/adapters';
import {
  AdviceEffectivenessProviderStates,
  selectAdvicePromptSamples,
} from './adviceEffectiveness/integration';
import { buildAdviceAggregateSnapshot } from './adviceEffectiveness/payload';
import {
  prepareStructuredAdviceInvocation,
  requestStructuredAdvice,
} from './adviceEffectiveness/remoteAdvice';
import {
  prepareOptimizerInvocation,
  requestPreparedOptimizer,
} from './optimizerRequest';
import {
  BackgroundWorkReason,
  BackgroundWorkState,
  beginBackgroundWork,
  createBackgroundWorkState,
  interruptBackgroundWork,
  recordBackgroundWorkFailure,
  recordBackgroundWorkProgress,
  restoreBackgroundWorkState,
} from './backgroundWorkState';
import {
  ResourceLease,
  ResourceOwnershipRegistry,
  ResourceStopCondition,
} from './resourceOwnership';
import {
  LOCAL_DATA_ACTION_TARGETS,
  LOCAL_DATA_GLOBAL_STATE_KEYS,
  LOCAL_DATA_GLOBAL_STATE_PREFIXES,
  LOCAL_DATA_PENDING_CLIENT_RESET_KEY,
  LOCAL_DATA_SOURCE_EXCLUSIONS,
  LEGACY_ADVICE_LOCAL_STATE_KEYS,
  LocalDataAction,
  LocalDataActionResult,
  LocalDataClientAction,
  LocalDataClientSummary,
  LocalDataInventory,
  LocalDataInventoryRow,
  LocalDataQuotaScopeOption,
  ResolvedQuotaScope,
  approximateJsonBytes,
  finiteTimestampRange,
  groupQuotaAccountEpochs,
  localDataActionTitle,
} from './localDataControls';

interface LocalizedReleaseAnnouncement {
  version: string;
  body: () => string;
}

interface ActiveNetworkOperation {
  readonly lease: ResourceLease;
  /** Resolves only after the request promise has reached its own terminal path. */
  readonly settled: Promise<void>;
}

interface QuotaObservationRuntime {
  repository: QuotaObservationRepository;
  store: QuotaObservationStoreV2;
  salt: string;
}

interface WatcherRecoveryState {
  timer: NodeJS.Timeout | undefined;
  timerLease: ResourceLease | undefined;
  failureStreak: number;
  lastFailureAt: number;
}

type WatcherProvider = 'claude' | 'codex' | 'credentials';
type WatcherStopCondition = Extract<
  ResourceStopCondition,
  | 'settled'
  | 'cancelled'
  | 'window-blur'
  | 'feature-disabled'
  | 'extension-dispose'
  | 'settings-change'
  | 'profile-change'
>;

function createWatcherRecoveryState(): WatcherRecoveryState {
  return {
    timer: undefined,
    timerLease: undefined,
    failureStreak: 0,
    lastFailureAt: 0,
  };
}

interface CodexRefreshDiagnosticContext {
  watcherEvents: number;
  coalescedTriggers: number;
}

const QUOTA_FINGERPRINT_SALT_KEY = 'ccu.quota.fingerprintSalt.v1';
const QUOTA_P5_MIGRATION_KEY = 'ccu.quota.migratedCodexIndex.v2';
const LEGACY_QUOTA_PREFIX = 'ccu.usageLimits.';
const LEGACY_WEEKLY_PREFIX = 'ccu.weeklyQuotaHistory.v1.';
const LOCAL_DATA_QUOTA_SCOPE_TTL_MS = 5 * 60_000;
const WATCHER_FAILURE_STREAK_RESET_MS = 5 * 60_000;
const LOCAL_DATA_EXACT_GLOBAL_STATE_KEYS = [
  ...new Set([
    ...LOCAL_DATA_GLOBAL_STATE_KEYS,
    ...OWNED_SETTING_GLOBAL_STATE_KEYS,
  ]),
] as const;

class QuotaObservationScopedMigrationBlockedError extends Error {
  constructor() {
    super('quota-observation-clear:scoped-clear-blocked-by-unresolved-migration');
    this.name = 'QuotaObservationScopedMigrationBlockedError';
  }
}

function legacyProfileSuffix(credentialsPath: string): string {
  return createHash('sha256').update(credentialsPath).digest('hex').slice(0, 16);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function legacyWeeklyCaptures(
  value: unknown,
  identitySignal: string,
): QuotaCapture[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = objectRecord(entry);
    if (
      !item ||
      item.provider !== 'claude' ||
      typeof item.observedAt !== 'number' ||
      !Number.isFinite(item.observedAt) ||
      typeof item.resetAt !== 'number' ||
      !Number.isFinite(item.resetAt) ||
      typeof item.usedPercent !== 'number' ||
      !Number.isFinite(item.usedPercent)
    ) return [];
    return [{
      provider: 'claude' as const,
      stableIdentitySignal: identitySignal,
      accountAttribution: 'profile-continuity' as const,
      observedAt: item.observedAt,
      periodType: 'seven-day' as const,
      usedFraction: Math.max(0, Math.min(1, item.usedPercent / 100)),
      resetAt: item.resetAt,
      source: 'claude-official-api' as const,
      confidence: 'low' as const,
      captureReason: 'migration' as const,
      flags: ['account-ambiguous' as const],
    }];
  });
}

/** Load and transactionally migrate quota facts before any provider refresh
 * starts. Legacy values are removed only after the schema-2 file is durable. */
export async function initializeQuotaObservationRuntime(
  context: vscode.ExtensionContext,
  settings: SettingsStore,
): Promise<QuotaObservationRuntime> {
  let salt = context.globalState.get<string>(QUOTA_FINGERPRINT_SALT_KEY);
  if (!salt) {
    salt = randomBytes(32).toString('hex');
    await context.globalState.update(QUOTA_FINGERPRINT_SALT_KEY, salt);
  }
  const repository = new QuotaObservationRepository(
    path.join(context.globalStorageUri.fsPath, QUOTA_OBSERVATION_FILE),
    salt,
  );
  let store = await repository.load();
  const migrationCaptures: QuotaCapture[] = [];
  const removableLegacyKeys: string[] = [];
  let codexLegacyMigrationReady = context.globalState.get<boolean>(
    QUOTA_P5_MIGRATION_KEY,
  ) === true;
  const profileClient = new ClaudeApiClient(
    null,
    settings.get<string>('dataDirectory'),
    salt,
  );
  const currentCredentialsPath = profileClient.getCredentialsPath();
  const currentSuffix = legacyProfileSuffix(currentCredentialsPath);
  const keys = typeof context.globalState.keys === 'function'
    ? context.globalState.keys()
    : [];
  for (const key of keys) {
    if (key.startsWith(LEGACY_QUOTA_PREFIX)) {
      const suffix = key.slice(LEGACY_QUOTA_PREFIX.length);
      const saved = objectRecord(context.globalState.get<unknown>(key));
      const data = saved ? saved.data as ClaudeApiUsageResponse | undefined : undefined;
      const ts = saved?.ts;
      if (data && typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
        const identitySignal = suffix === currentSuffix
          ? `profile-path-v1|${currentCredentialsPath}`
          : `legacy-profile-v1|${suffix}`;
        const additions = claudeQuotaCapturesFromUsage(
          data,
          identitySignal,
          'profile-continuity',
          ts,
          'migration',
        );
        if (additions.length > 0) {
          migrationCaptures.push(...additions.map((item) => ({
            ...item,
            confidence: 'low' as const,
            flags: [...(item.flags ?? []), 'account-ambiguous' as const],
          })));
          removableLegacyKeys.push(key);
        }
      }
      continue;
    }
    if (key.startsWith(LEGACY_WEEKLY_PREFIX)) {
      const suffix = key.slice(LEGACY_WEEKLY_PREFIX.length);
      const identitySignal = suffix === currentSuffix
        ? `profile-path-v1|${currentCredentialsPath}`
        : `legacy-profile-v1|${suffix}`;
      const additions = legacyWeeklyCaptures(
        context.globalState.get<unknown>(key),
        identitySignal,
      );
      if (additions.length > 0) {
        migrationCaptures.push(...additions);
        removableLegacyKeys.push(key);
      }
    }
  }

  if (!codexLegacyMigrationReady) {
    try {
      const index = await loadCodexIndex(
        path.join(context.globalStorageUri.fsPath, 'codex-index-v1.json'),
        resolveTimeZone(settings.get<string>('timezone')),
      );
      const legacyHistory = [
        ...(index.quotaHistory ?? []),
        ...Object.values(index.files).flatMap((file) => file.quotaHistory ?? []),
      ];
      migrationCaptures.push(...codexQuotaCapturesFromWeeklyObservations(
        weeklyQuotaObservationsFromCodexHistory(legacyHistory),
        'migration',
      ));
      codexLegacyMigrationReady = true;
      // Set only after the P2 append below succeeds.
    } catch {
      // A corrupt/absent P1 cannot block activation or destroy its only copy.
    }
  }

  if (migrationCaptures.length > 0) {
    store = await repository.append(migrationCaptures);
  }
  for (const key of removableLegacyKeys) {
    await context.globalState.update(key, undefined);
  }
  if (
    codexLegacyMigrationReady &&
    !context.globalState.get<boolean>(QUOTA_P5_MIGRATION_KEY)
  ) {
    await context.globalState.update(QUOTA_P5_MIGRATION_KEY, true);
  }
  return { repository, store, salt };
}

// Full-version entries only: an installed patch must never inherit stale notes
// from an older major/minor release.
const WHATS_NEW: ReleaseAnnouncementCatalog<LocalizedReleaseAnnouncement> = {
  '2.3.0': {
    version: '2.3.0',
    body: () => I18n.t.releaseAnnouncement.v230,
  },
  '2.3.1': {
    version: '2.3.1',
    body: () => I18n.t.releaseAnnouncement.v231,
  },
  '2.3.2': {
    version: '2.3.2',
    body: () => I18n.t.releaseAnnouncement.v232,
  },
};

export class ClaudeCodeUsageExtension {
  private static readonly CODEX_BACKGROUND_WORK_STATE_KEY =
    'ccu.codex.backgroundWork.v1';
  private static readonly CODEX_BACKGROUND_MEASUREMENT_VERSION = 1;
  private static readonly CODEX_FIRST_BACKFILL_BLUR_DEADLINE_MS = 10_000;
  private statusBar: StatusBarManager;
  private webviewProvider: UsageWebviewProvider;
  private apiClient: ClaudeApiClient;
  private settings: SettingsStore;
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshTimerLease: ResourceLease | undefined;
  private fileWatcher: fs.FSWatcher | undefined;
  private fileWatcherLease: ResourceLease | undefined;
  private claudeWatcherRecovery = createWatcherRecoveryState();
  private codexWatchers: fs.FSWatcher[] = [];
  private readonly codexWatcherLeases = new Map<fs.FSWatcher, ResourceLease>();
  private codexWatcherRecovery = createWatcherRecoveryState();
  private credentialsWatcherRecovery = createWatcherRecoveryState();
  private readonly debounceTimerLeases = new Map<NodeJS.Timeout, ResourceLease>();
  private readonly codexWatchDebounce = this.createOwnedRefreshDebounce('codex');
  private codexWatchedHome: string | null = null;
  private readonly watchDebounce = this.createOwnedRefreshDebounce('claude');
  private readonly refreshGate = new RefreshSingleFlight();
  private readonly codexRefreshGate = new RefreshSingleFlight();
  private codexRefreshDrain: Promise<void> | null = null;
  private codexRefreshSuspensionDepth = 0;
  private readonly windowActivity =
    new WindowActivityGate(vscode.window.state.focused);
  private watcherEventsSinceRefresh = 0;
  private coalescedTriggersSinceRefresh = 0;
  private credentialsWatcherMissingFilenameEventsSinceRefresh = 0;
  private codexWatcherEventsSinceRefresh = 0;
  private codexCoalescedTriggersSinceRefresh = 0;
  private codexWatchDebouncePending = false;
  private watchedDir: string | null = null;
  // Watches ~/.claude/.credentials.json so an account switch is reflected
  // promptly instead of after a full quota TTL (#45).
  private credsWatcher: fs.FSWatcher | undefined;
  private credsWatcherLease: ResourceLease | undefined;
  private credsDebounceTimer: NodeJS.Timeout | undefined;
  private credsDebounceTimerLease: ResourceLease | undefined;
  private cache: {
    records: any[];
    contentAnalysis: ContentAnalysis | null;
    claudeIndex: ClaudeUsageIndex;
    manifest: UsageManifest | null;
    lastUpdate: Date;
    dataDirectory: string | null;
    usageLimits: ClaudeApiUsageResponse | null;
    usageLimitsLastUpdate: Date;
    usageLimitsBackoffUntil: Date;
    usageLimitsFailStreak: number;
  } = {
    records: [],
    contentAnalysis: null,
    claudeIndex: createClaudeUsageIndex(),
    manifest: null,
    lastUpdate: new Date(0),
    dataDirectory: null,
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 0
  };

  private outputChannel: vscode.OutputChannel;
  // Epoch ms of the last observed .jsonl change. It only tunes quota-cache TTL;
  // local polling always follows the configured refreshInterval.
  private lastActivityAt: number = 0;
  // Generation token for the self-rescheduling refresh timer. Bumped each time
  // startAutoRefresh runs so any older timer chain (e.g. left mid-flight by a
  // config change) stops instead of running concurrently with the new one.
  private refreshGen: number = 0;
  // One-shot cold-start retry for the quota fetch: when a window opens on a
  // flaky network and the very first /usage fetch fails, try once more shortly
  // after so the indicator appears without waiting for the next regular tick.
  private quotaColdRetryDone: boolean = false;
  private quotaColdRetryTimer: NodeJS.Timeout | undefined;
  private quotaColdRetryTimerLease: ResourceLease | undefined;
  private claudeProfileGeneration: number = 0;
  private claudeWeeklyQuotaHistory: WeeklyQuotaObservation[] = [];
  private readonly quotaObservationRepository: QuotaObservationRepository;
  private quotaObservationStore: QuotaObservationStoreV2;
  private readonly quotaFingerprintSalt: string;
  private activeClaudeQuotaFingerprint: string | undefined;
  private activePricingBackend: ExtensionConfig['pricingBackend'] = 'anthropic';
  private codexProvider: CodexProvider;
  private readonly codexSalt: string;
  private codexView: CodexUsageView | null = null;
  private codexInsights: CodexScopedInsights = emptyCodexScopedInsights();
  private codexAvailable = false;
  private codexHasData = false;
  private codexRefreshing = false;
  private codexProgress: CodexIndexProgress | null = null;
  private codexProgressLastRenderedAt = 0;
  private codexCheckpointHydration: Promise<void> | null = null;
  private codexCheckpointHydrationLastAttemptAt = 0;
  private codexBackgroundState: BackgroundWorkState;
  private readonly resourceOwnership = new ResourceOwnershipRegistry();
  private codexBackfillLease: ResourceLease | undefined;
  private codexWorkerLease: ResourceLease | undefined;
  private codexFirstBackfillActive = false;
  private codexFirstBackfillBlurTimer: NodeJS.Timeout | undefined;
  private codexFirstBackfillBlurTimerLease: ResourceLease | undefined;
  private codexWorkerCancellationRequested = false;
  private readonly activeAdviceNetworks = new Map<
    AbortController,
    ActiveNetworkOperation & { surface: 'advice' | 'optimizer' }
  >();
  private readonly activeQuotaNetworks = new Map<AbortController, ActiveNetworkOperation>();
  private readonly codexProviderRetirements = new Set<Promise<void>>();
  private codexProviderRetirementFailure: unknown = null;
  private readonly activeCodexRefreshes = new Set<Promise<void>>();
  private readonly pendingResourceStops = new Set<Promise<void>>();
  private resourceStopFailure: unknown = null;
  private codexBackgroundStateWrite: Promise<void> = Promise.resolve();
  private initializationWrites: Promise<void> = Promise.resolve();
  private initializationWriteFailure: unknown = null;
  private localDataActionWrite: Promise<void> = Promise.resolve();
  private pendingClientResetReplay: Promise<void> = Promise.resolve();
  private clearingAllLocalData = false;
  private localDataClearedRequiresReload = false;
  private readonly localDataQuotaScopes = new Map<
    string,
    {
      scope: ResolvedQuotaScope;
      label: string;
      createdAt: number;
      revision: string;
    }
  >();
  private configurationGeneration = 0;
  private fileWatcherGeneration = 0;
  private codexWatcherGeneration = 0;
  private credentialsWatcherGeneration = 0;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    settings?: SettingsStore,
    quotaRuntime?: QuotaObservationRuntime,
  ) {
    console.log('Claude Code Usage Extension: Constructor called');
    this.outputChannel = vscode.window.createOutputChannel('Claude Code Usage');
    context.subscriptions.push(this.outputChannel);
    this.statusBar = new StatusBarManager();
    this.settings = settings ?? new SettingsStore(context);
    const backgroundRestore = restoreBackgroundWorkState(
      context.globalState.get<unknown>(
        ClaudeCodeUsageExtension.CODEX_BACKGROUND_WORK_STATE_KEY,
      ),
      {
        measurementVersion:
          ClaudeCodeUsageExtension.CODEX_BACKGROUND_MEASUREMENT_VERSION,
        reason: 'history-backfill',
        now: Date.now(),
      },
    );
    this.codexBackgroundState = backgroundRestore.state;
    if (this.codexBackgroundState.status === 'running') {
      this.codexBackgroundState = interruptBackgroundWork(
        this.codexBackgroundState,
        { now: Date.now() },
      );
    }
    if (
      backgroundRestore.disposition !== 'valid' ||
      backgroundRestore.state.status === 'running'
    ) {
      this.queueInitializationWrite(() => this.saveCodexBackgroundState());
    }
    this.webviewProvider = new UsageWebviewProvider(context);
    const existingQuotaSalt = context.globalState.get<string>(
      'ccu.quota.fingerprintSalt.v1',
    );
    this.quotaFingerprintSalt = quotaRuntime?.salt ??
      existingQuotaSalt ?? randomBytes(32).toString('hex');
    if (!existingQuotaSalt && !quotaRuntime) {
      this.queueInitializationWrite(() => context.globalState.update(
        'ccu.quota.fingerprintSalt.v1',
        this.quotaFingerprintSalt,
      ));
    }
    this.quotaObservationRepository = quotaRuntime?.repository ??
      new QuotaObservationRepository(
        path.join(context.globalStorageUri.fsPath, QUOTA_OBSERVATION_FILE),
        this.quotaFingerprintSalt,
      );
    this.quotaObservationStore = quotaRuntime?.store ??
      createEmptyQuotaObservationStore();
    this.apiClient = new ClaudeApiClient(
      this.outputChannel,
      this.settings.get<string>('dataDirectory'),
      this.quotaFingerprintSalt,
    );
    this.activeClaudeQuotaFingerprint = fingerprintForStableIdentity(
      this.quotaFingerprintSalt,
      'claude',
      this.claudeProfileContinuitySignal(),
    );
    const existingCodexSalt = context.globalState.get<string>('ccu.codex.machineSalt');
    this.codexSalt = existingCodexSalt ?? randomBytes(32).toString('hex');
    if (!existingCodexSalt) {
      this.queueInitializationWrite(() =>
        context.globalState.update('ccu.codex.machineSalt', this.codexSalt),
      );
    }
    this.codexProvider = this.createCodexProvider(this.getConfiguration());
    // Migrate any pre-2.1 settings.json values for the keys that have moved out
    // of the VS Code Settings UI into the dashboard-managed store. Runs once.
    this.queueInitializationWrite(() => this.settings.migrateOnce());
    // V2.2: convert the old pauseDashboardRefresh to the positive
    // dashboardAutoRefresh (inverted). Runs once.
    this.queueInitializationWrite(() => this.settings.migrateDashboardAutoRefresh());
    // Rename showOpusWeekly -> showScopedWeekly (the API stopped naming Opus).
    // Runs once.
    this.queueInitializationWrite(() => this.settings.migrateScopedWeekly());
    // Collapse the early 2.3.2 free-form currency/rate pair into one preset.
    this.queueInitializationWrite(() => this.settings.migrateCurrencyPreset());
    // Usage Optimizer (Phase 9c): the webview posts a draft prompt; we run it
    // through the same model backend as the advice feature and post back a
    // tightened prompt + a settings recommendation. Consent gate lives here.
    this.webviewProvider.onPrepareOptimizerInvocation = (
      draft,
      options,
      sourceRevision,
      consentGeneration,
    ) => this.prepareOptimizerRequest(
      draft,
      options,
      sourceRevision,
      consentGeneration,
    );
    this.webviewProvider.onSendOptimizerInvocation = (
      prepared,
      expectedSourceRevision,
      expectedConsentGeneration,
    ) => {
      const config = this.getConfiguration();
      return this.runAdviceNetwork((signal) =>
        requestPreparedOptimizer(prepared, {
          apiKey: config.adviceApiKey,
          expectedSourceRevision,
          expectedConsentGeneration,
          signal,
        }),
        'optimizer',
      );
    };
    this.webviewProvider.onAiSurfaceClosed = () => {
      void this.cancelAdviceNetworks('cancelled');
    };
    this.webviewProvider.onAdviceDataCleared = () =>
      this.cancelAdviceNetworks('cancelled');
    this.webviewProvider.onAdviceConsentWithdrawn = () =>
      this.cancelAdviceNetworks('cancelled', 'advice');
    this.webviewProvider.onPrepareAdviceInvocation = (
      snapshot,
      sourceRevision,
      consentGeneration,
    ) => {
      const config = this.getConfiguration();
      return prepareStructuredAdviceInvocation(snapshot.prepared, {
        apiFormat: config.adviceApiFormat,
        apiUrl: config.adviceApiUrl,
        model: config.adviceModel,
        reasoningEffort: config.adviceReasoningEffort,
        sourceRevision,
        consentGeneration,
        createdAtEpochMs: Date.now(),
      });
    };
    this.webviewProvider.onSendAdviceInvocation = (
      prepared,
      references,
      expectedSourceRevision,
      expectedConsentGeneration,
    ) => {
      const config = this.getConfiguration();
      return this.runAdviceNetwork((signal) =>
        requestStructuredAdvice(prepared, references, {
          apiKey: config.adviceApiKey,
          expectedSourceRevision,
          expectedConsentGeneration,
          signal,
        }),
      );
    };
    // Share the settings store with the dashboard's ⚙ Settings panel, and have
    // it tell us when the user changes a setting there so we re-apply config
    // (globalState changes don't fire onDidChangeConfiguration).
    this.webviewProvider.settings = this.settings;
    this.webviewProvider.onSettingsChanged = (key) => this.onSettingsChangedFromPanel(key);
    this.webviewProvider.onRequestLocalDataInventory = (client) =>
      this.buildLocalDataInventory(client);
    this.webviewProvider.onRunLocalDataAction = (action, quotaScopeToken) =>
      this.runLocalDataActionInteractive(action, quotaScopeToken);
    this.webviewProvider.onResetSharingPreferences = () =>
      this.resetSharingPreferencesHost();
    this.webviewProvider.onLocalDataClientReady = () => {
      void this.replayPendingClientReset();
    };

    this.setupCommands();
    this.loadConfiguration();
    this.refreshQuotaObservationViews();
    if (this.windowActivity.focused) {
      this.startAutoRefresh();
      const startupGeneration = this.configurationGeneration;
      void this.refreshData(false, 'startup').then(() => {
        if (
          this.disposed ||
          startupGeneration !== this.configurationGeneration
        ) {
          return;
        }
        void this.startFileWatching();
        this.startCodexWatching();
      });
      this.startCredentialsWatching();
    }
    this.startWindowFocusRefresh();
    this.maybeAnnounceWhatsNew();
    console.log('Claude Code Usage Extension: Initialization complete');
  }

  private queueInitializationWrite(
    operation: () => PromiseLike<void>,
  ): void {
    const run = this.initializationWrites
      .catch(() => undefined)
      .then(async () => {
        if (this.disposed || this.localDataClearedRequiresReload) return;
        await operation();
      });
    this.initializationWrites = run.catch((error) => {
      this.initializationWriteFailure ??= error;
    });
  }

  private async drainInitializationWritesForClear(): Promise<void> {
    await this.initializationWrites;
    // An initialization failure is non-fatal for normal activation, but a
    // destructive clear cannot claim a verified postcondition while an owned
    // initialization write failed or remains unknown.
    if (this.initializationWriteFailure !== null) {
      throw new Error('initialization-write-barrier-failed');
    }
  }

  /** After an upgrade, show a single "what's new" notification pointing at the
   * dashboard — so users discover new features (including opt-in, default-off
   * ones they'd never find otherwise). Shown once per version; skipped on a
   * fresh install (no nagging new users). */
  private maybeAnnounceWhatsNew(): void {
    const current = (this.context.extension?.packageJSON?.version as string) || '';
    const last = this.context.globalState.get<string>('ccu.lastSeenVersion');
    if (!current) {
      return;
    }
    const announcement = announcementForUpgrade(
      current,
      last,
      this.getConfiguration().releaseAnnouncements,
      WHATS_NEW,
    );
    this.queueInitializationWrite(() =>
      this.context.globalState.update('ccu.lastSeenVersion', current),
    );
    if (announcement) {
      this.showWhatsNew(announcement.version);
    }
  }

  /** Show the what's-new toast for one exact release, if it is catalogued. */
  private showWhatsNew(version: string): void {
    const announcement = WHATS_NEW[version];
    if (!announcement) {
      return;
    }
    const open = I18n.t.popup.title; // "Show details" entry point label
    void vscode.window.showInformationMessage(`Claude Code Usage ${version}: ${announcement.body()}`, open).then((pick) => {
      if (pick === open) {
        vscode.commands.executeCommand('claudeCodeUsage.showDetails');
      }
    });
  }

  /** Force-show the newest what's-new entry, ignoring the once-per-version
   * guard — for re-reading the announcement or testing it during development
   * (a fresh F5 install otherwise just sets the baseline and shows nothing). */
  private previewWhatsNew(): void {
    const latest = latestAnnouncementVersion(WHATS_NEW);
    if (latest) {
      this.showWhatsNew(latest);
    } else {
      void vscode.window.showInformationMessage('No what’s-new entry yet.');
    }
  }

  private setupCommands(): void {
    const commands = [
      vscode.commands.registerCommand('claudeCodeUsage.refresh', () => {
        // Manual refresh always updates the dashboard even when
        // dashboardAutoRefresh is off.
        void this.refreshData(true, 'manual');
      }),
      vscode.commands.registerCommand('claudeCodeUsage.showDetails', () => {
        this.webviewProvider.show();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCodeUsage');
      }),
      vscode.commands.registerCommand('claudeCodeUsage.refreshPricing', () => {
        this.refreshPricing();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.getAdvice', () => {
        this.getAdvice();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.showLogs', () => {
        this.outputChannel.show();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.exportHeatmap', () => {
        this.exportHeatmap();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.publishHeatmapToGitHub', () => {
        this.publishHeatmapToGitHub();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.exportShareCard', () => {
        this.exportShareCard();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.previewWhatsNew', () => {
        this.previewWhatsNew();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.manageLocalData', () => {
        this.webviewProvider.show('settings');
        queueMicrotask(() => this.webviewProvider.requestLocalDataInventoryRefresh());
      }),
      vscode.commands.registerCommand('claudeCodeUsage.rebuildCodexIndex', () => {
        void this.runLocalDataActionInteractive('rebuild-codex-index');
      }),
      vscode.commands.registerCommand('claudeCodeUsage.clearQuotaHistory', () => {
        void this.clearQuotaHistoryFromCommandPalette();
      }),
      vscode.commands.registerCommand('claudeCodeUsage.clearAdviceData', () => {
        void this.runLocalDataActionInteractive('clear-advice-data');
      }),
      vscode.commands.registerCommand('claudeCodeUsage.resetUiState', () => {
        this.webviewProvider.show('settings');
        void this.runLocalDataActionInteractive('reset-ui-state');
      }),
      vscode.commands.registerCommand('claudeCodeUsage.resetSharingPreferences', () => {
        this.webviewProvider.show('settings');
        void this.runLocalDataActionInteractive('reset-sharing-preferences');
      }),
      vscode.commands.registerCommand('claudeCodeUsage.clearByokSecret', () => {
        void this.runLocalDataActionInteractive('clear-byok-secret');
      }),
      vscode.commands.registerCommand('claudeCodeUsage.clearAllDerivedData', () => {
        this.webviewProvider.show('settings');
        void this.runLocalDataActionInteractive('clear-all-derived-data');
      })
    ];

    commands.forEach(command => this.context.subscriptions.push(command));
  }

  private async derivedFileFamilyNames(
    filePath: string,
    family: 'codex-index' | 'quota-observations',
  ): Promise<string[]> {
    const directory = path.dirname(filePath);
    const canonical = path.basename(filePath);
    let names: string[];
    try {
      names = await fs.promises.readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return names.filter((name) => {
      if (name === canonical) return true;
      if (family === 'codex-index') {
        return /^codex-index-v1\.corrupt-\d+-\d+\.json$/.test(name) ||
          /^codex-index-v1\.json\.tmp-\d+-[a-f0-9-]{36}$/.test(name);
      }
      return /^quota-observations-v2\.json\.quarantine-\d+-[a-f0-9]{8}$/.test(name) ||
        /^\.quota-observations-v2\.json\.\d+\.[a-f0-9]{12}\.tmp$/.test(name);
    });
  }

  private async localFileFamilyInventory(
    filePath: string,
    family: 'codex-index' | 'quota-observations',
  ): Promise<{
    approximateBytes: number | null;
    itemCount: number;
    oldestAt: number | null;
    newestAt: number | null;
  }> {
    try {
      const names = await this.derivedFileFamilyNames(filePath, family);
      const stats = await Promise.all(names.map((name) =>
        fs.promises.lstat(path.join(path.dirname(filePath), name)),
      ));
      const files = stats.filter((stat) => stat.isFile() || stat.isSymbolicLink());
      if (files.length === 0) {
        return { approximateBytes: 0, itemCount: 0, oldestAt: null, newestAt: null };
      }
      const range = finiteTimestampRange(files.flatMap((stat) => [
        stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs,
        stat.mtimeMs,
      ]));
      return {
        approximateBytes: files.reduce((sum, stat) => sum + stat.size, 0),
        itemCount: files.length,
        ...range,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.outputChannel.appendLine('local-data inventory: one derived file is unreadable');
      }
      return { approximateBytes: null, itemCount: 0, oldestAt: null, newestAt: null };
    }
  }

  private async removeDerivedFileFamily(
    filePath: string,
    family: 'codex-index' | 'quota-observations',
  ): Promise<void> {
    const directory = path.dirname(filePath);
    const names = await this.derivedFileFamilyNames(filePath, family);
    for (const name of names) {
      // `name` came from an exact allowlisted family matcher in this one
      // directory. unlink never follows a symlink target.
      await fs.promises.unlink(path.join(directory, name)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }

  private async removeDerivedFileFamilyWithLease(
    filePath: string,
    family: 'codex-index' | 'quota-observations',
  ): Promise<void> {
    const lease = await acquireCodexIndexLease(filePath);
    try {
      await this.removeDerivedFileFamily(filePath, family);
    } finally {
      await lease.release();
    }
  }

  private extensionGlobalStateKeys(): readonly string[] {
    const keys = this.context.globalState.keys;
    return typeof keys === 'function' ? keys.call(this.context.globalState) : [];
  }

  private globalStateAggregate(keys: readonly string[]): {
    approximateBytes: number | null;
    itemCount: number;
  } {
    let bytes = 0;
    let knownBytes = true;
    for (const key of keys) {
      const valueBytes = approximateJsonBytes(this.context.globalState.get<unknown>(key));
      if (valueBytes === null) knownBytes = false;
      else bytes += valueBytes;
    }
    return {
      approximateBytes: knownBytes ? bytes : null,
      itemCount: keys.length,
    };
  }

  private buildQuotaScopeOptions(): LocalDataQuotaScopeOption[] {
    this.localDataQuotaScopes.clear();
    const locale = I18n.getLocale();
    const zh = locale === 'zh-CN';
    const observations = this.quotaObservationStore.observations;
    const revision = this.quotaObservationRevision();
    const createdAt = Date.now();
    const result: LocalDataQuotaScopeOption[] = [];
    const add = (
      label: string,
      scope: ResolvedQuotaScope,
      itemCount: number,
      oldestAt: number | null,
      newestAt: number | null,
      provider: 'claude' | 'codex' | 'all',
    ): void => {
      const token = randomBytes(18).toString('hex');
      this.localDataQuotaScopes.set(token, {
        scope,
        label,
        createdAt,
        revision,
      });
      result.push({ token, label, provider, itemCount, oldestAt, newestAt });
    };
    const allRange = finiteTimestampRange(observations.map((item) => item.observedAt));
    add(
      zh ? `全部额度观测（${observations.length} 项）` : `All quota observations (${observations.length})`,
      {},
      observations.length,
      allRange.oldestAt,
      allRange.newestAt,
      'all',
    );
    for (const provider of ['claude', 'codex'] as const) {
      const selected = observations.filter((item) => item.provider === provider);
      if (selected.length === 0) continue;
      const range = finiteTimestampRange(selected.map((item) => item.observedAt));
      add(
        zh
          ? `${provider === 'claude' ? 'Claude' : 'Codex'} 全部观测（${selected.length} 项）`
          : `${provider === 'claude' ? 'Claude' : 'Codex'} observations (${selected.length})`,
        { provider },
        selected.length,
        range.oldestAt,
        range.newestAt,
        provider,
      );
    }
    const epochNumber = new Map<'claude' | 'codex', number>([['claude', 0], ['codex', 0]]);
    for (const epoch of groupQuotaAccountEpochs(this.quotaObservationStore)) {
      const index = (epochNumber.get(epoch.provider) ?? 0) + 1;
      epochNumber.set(epoch.provider, index);
      const providerLabel = epoch.provider === 'claude' ? 'Claude' : 'Codex';
      add(
        zh
          ? `${providerLabel} 本地匿名账号周期 ${index}（${epoch.itemCount} 项）`
          : `${providerLabel} local anonymous account epoch ${index} (${epoch.itemCount})`,
        {
          provider: epoch.provider,
          accountFingerprint: epoch.accountFingerprint,
        },
        epoch.itemCount,
        epoch.oldestAt,
        epoch.newestAt,
        epoch.provider,
      );
    }
    return result;
  }

  private quotaObservationRevision(): string {
    return createHash('sha256')
      .update(JSON.stringify(this.quotaObservationStore.observations))
      .digest('hex');
  }

  private async buildLocalDataInventory(
    client: LocalDataClientSummary,
  ): Promise<LocalDataInventory> {
    const zh = I18n.getLocale() === 'zh-CN';
    const local = (english: string, chinese: string): string =>
      zh ? chinese : english;
    const indexPath = path.join(this.context.globalStorageUri.fsPath, 'codex-index-v1.json');
    const quotaPath = path.join(this.context.globalStorageUri.fsPath, QUOTA_OBSERVATION_FILE);
    const [indexFile, quotaFile] = await Promise.all([
      this.localFileFamilyInventory(indexPath, 'codex-index'),
      this.localFileFamilyInventory(quotaPath, 'quota-observations'),
    ]);
    const stateKeys = this.extensionGlobalStateKeys();
    const legacyQuotaKeys = stateKeys.filter((key) =>
      key.startsWith(LEGACY_QUOTA_PREFIX) || key.startsWith(LEGACY_WEEKLY_PREFIX),
    );
    const sharingSettingKeys = new Set([
      'ccu.setting.showHeatmap',
      'ccu.setting.enableShareCard',
    ]);
    const ownedSettingKeys = new Set(OWNED_SETTING_GLOBAL_STATE_KEYS);
    const preferenceKeys = stateKeys.filter((key) =>
      (ownedSettingKeys.has(key) &&
        !sharingSettingKeys.has(key) &&
        key !== 'ccu.setting.advice.apiKey') ||
      [
        'ccu.lastSeenVersion',
        'ccu.codex.backgroundWork.v1',
        'ccu.migrated.dashboardAutoRefresh',
        'ccu.migrated.showScopedWeekly',
        LOCAL_DATA_PENDING_CLIENT_RESET_KEY,
        'ccu.quota.migratedCodexIndex.v2',
        'ccu.settingsMigrated.v1',
      ].includes(key),
    );
    const saltKeys = stateKeys.filter((key) =>
      key === QUOTA_FINGERPRINT_SALT_KEY || key === 'ccu.codex.machineSalt',
    );
    const sharingKeys = stateKeys.filter((key) =>
      key === 'ccu.heatmapRepo' ||
      key === 'ccu.heatmapPath' ||
      sharingSettingKeys.has(key),
    );
    const adviceSummary = this.webviewProvider.adviceLocalDataInventorySummary();
    const quotaRange = finiteTimestampRange(
      this.quotaObservationStore.observations.map((item) => item.observedAt),
    );
    const byokConfigured = this.settings.snapshot().some((item) =>
      item.key === 'advice.apiKey' && item.configured === true,
    );
    const rows: LocalDataInventoryRow[] = [
      {
        id: 'R1',
        category: local('R1 · Claude provider-owned source logs', 'R1 · Claude 自有源日志'),
        locationClass: local('Claude Code data directory (read-only source)', 'Claude Code 数据目录（只读源）'),
        schema: 'provider-owned JSONL',
        approximateBytes: null,
        itemCount: null,
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('None by default; exact preview only for separately consented advice', '默认无；仅另行同意的建议会发送精确预览内容'),
        clearability: local('Never touched by these controls; opt-in Session Actions is separate', '这些控制绝不触碰；另行启用的会话操作相互独立'),
      },
      {
        id: 'R2',
        category: local('R2 · Codex provider-owned source logs', 'R2 · Codex 自有源日志'),
        locationClass: local('Codex home sessions/archives (read-only source)', 'Codex home 会话/归档（只读源）'),
        schema: 'provider-owned JSONL',
        approximateBytes: null,
        itemCount: null,
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('None', '无'),
        clearability: local('Never cleared by this extension', '插件绝不清除'),
      },
      {
        id: 'P1',
        category: local('P1 · Codex incremental index', 'P1 · Codex 增量索引'),
        locationClass: local('Extension global storage / codex index', '插件全局存储 / Codex 索引'),
        schema: 'internal schema 3',
        ...indexFile,
        networkInteraction: local('None', '无'),
        clearability: local('Clear and rebuild from R2', '清除后从 R2 重建'),
      },
      {
        id: 'P2',
        category: local('P2 · Quota observation history', 'P2 · 额度观测历史'),
        locationClass: local('Extension global storage / quota observations', '插件全局存储 / 额度观测'),
        schema: 'schema 2',
        approximateBytes: quotaFile.approximateBytes,
        itemCount: this.quotaObservationStore.observations.length,
        ...quotaRange,
        networkInteraction: local('Claude official quota request; Codex local structured events', 'Claude 官方额度请求；Codex 本地结构化事件'),
        clearability: local('Clear by provider, anonymous account epoch, or all', '按供应商、匿名账号 epoch 或全部清除'),
      },
      {
        id: 'P3-P4',
        category: local('P3/P4 · Legacy quota migration inputs', 'P3/P4 · 旧版额度迁移输入'),
        locationClass: local('Extension globalState (legacy, migration-only)', '插件 globalState（旧版，仅迁移）'),
        schema: 'legacy',
        ...this.globalStateAggregate(legacyQuotaKeys),
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('None', '无'),
        clearability: local('Imported transactionally, then removed; included in clear-all', '事务导入后删除；纳入清除全部'),
      },
      {
        id: 'P5',
        category: local('P5 · Codex legacy quota migration input', 'P5 · Codex 旧额度迁移输入'),
        locationClass: local('Embedded in the P1 Codex index (migration-only)', '嵌入 P1 Codex 索引（仅迁移）'),
        schema: 'legacy quotaHistory + exact migration marker',
        approximateBytes: null,
        itemCount: this.context.globalState.get<boolean>(QUOTA_P5_MIGRATION_KEY) === true
          ? 0
          : null,
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('None', '无'),
        clearability: local('Migrated once into P2; P1 rebuild never deletes migrated P2 history', '一次性迁入 P2；重建 P1 不删除已迁移的 P2 历史'),
      },
      {
        id: 'P6',
        category: local('P6 · Extension preferences and migration state', 'P6 · 插件偏好与迁移状态'),
        locationClass: local('VS Code configuration + extension globalState', 'VS Code 配置 + 插件 globalState'),
        schema: 'typed settings + versioned flags',
        ...this.globalStateAggregate(preferenceKeys),
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('VS Code Settings Sync may apply to configuration', '配置可能参与 VS Code Settings Sync'),
        clearability: local('Reset settings or clear all extension-derived data', '重置设置或清除全部插件派生数据'),
      },
      {
        id: 'P7',
        category: local('P7 · Machine-local pseudonymization material', 'P7 · 本机匿名化材料'),
        locationClass: local('Extension globalState', '插件 globalState'),
        schema: 'random salts / HMAC v1',
        approximateBytes: null,
        itemCount: saltKeys.length,
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('Never', '永不'),
        clearability: local('Included in clear-all; invalidates prior local fingerprints', '纳入清除全部；旧本机 fingerprint 随即失效'),
      },
      {
        id: 'P8',
        category: local('P8 · BYOK advice credential', 'P8 · BYOK 建议凭证'),
        locationClass: 'VS Code SecretStorage',
        schema: 'host SecretStorage',
        approximateBytes: null,
        itemCount: byokConfigured ? 1 : 0,
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('Only to the configured endpoint after explicit Send', '仅在明确点击发送后用于所配置端点'),
        clearability: local('Clear BYOK secret or clear all; value is never inventoried', '清除 BYOK 密钥或清除全部；清单绝不读取值'),
      },
      {
        id: 'P9',
        category: local('P9 · Advice-effectiveness ledger', 'P9 · 建议效果台账'),
        locationClass: local('Extension globalState', '插件 globalState'),
        schema: 'schema 3',
        ...adviceSummary,
        networkInteraction: local('Only exact previewed payload after explicit Send', '仅在明确点击发送后发送精确预览载荷'),
        clearability: local('Clear Advice Data', '清除建议数据'),
      },
      {
        id: 'P10',
        category: local('P10 · Dashboard UI preferences', 'P10 · 仪表板界面偏好'),
        locationClass: local('Webview state + allowlisted localStorage keys', 'Webview 状态 + 白名单 localStorage 键'),
        schema: 'ephemeral UI state',
        approximateBytes: null,
        itemCount: client.uiPreferenceKeys + client.webviewStateFields,
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('Never', '永不'),
        clearability: local('Reset UI State', '重置界面状态'),
      },
      {
        id: 'P11',
        category: local('P11 · Heatmap/share preferences', 'P11 · 热力图/分享偏好'),
        locationClass: local('Webview localStorage + extension globalState', 'Webview localStorage + 插件 globalState'),
        schema: 'bounded title/range/privacy + destination strings',
        approximateBytes: this.globalStateAggregate(sharingKeys).approximateBytes,
        itemCount: sharingKeys.length + client.sharingPreferenceKeys,
        oldestAt: null,
        newestAt: null,
        networkInteraction: local('Local export: none; GitHub publish: explicit confirmed action only', '本地导出：无；GitHub 发布：仅明确确认的动作'),
        clearability: local('Reset Sharing Preferences', '重置分享偏好'),
      },
    ];
    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      rows,
      quotaScopes: this.buildQuotaScopeOptions(),
      exclusions: zh
        ? [
            'Claude 自有源日志',
            'Codex 自有源日志',
            '供应商自有 OAuth 凭证与 cookie',
            '外部账号额度与订阅状态',
          ]
        : [...LOCAL_DATA_SOURCE_EXCLUSIONS],
    };
  }

  private async clearQuotaHistoryFromCommandPalette(): Promise<void> {
    const inventory = await this.buildLocalDataInventory({
      uiPreferenceKeys: 0,
      webviewStateFields: 0,
      sharingPreferenceKeys: 0,
    });
    const picked = await vscode.window.showQuickPick(
      inventory.quotaScopes.map((scope) => ({
        label: scope.label,
        description: `${scope.itemCount} observations`,
        token: scope.token,
      })),
      { placeHolder: 'Select the exact quota-history scope to clear' },
    );
    if (!picked) return;
    await this.runLocalDataActionInteractive('clear-quota-history', picked.token);
  }

  private serializeLocalDataAction<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.localDataActionWrite.then(operation, operation);
    this.localDataActionWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Prevent a deliberate P2 clear from being undone by one-shot legacy
   * migration on the next activation. Account-specific Claude legacy inputs
   * cannot be mapped safely from their old path suffix, so they are only
   * removed for a provider-wide/all clear; such inputs normally disappeared
   * immediately after their original durable migration.
   */
  private async clearLegacyQuotaMigrationInputs(
    scope: ResolvedQuotaScope,
  ): Promise<void> {
    const broadScope = scope.accountFingerprint === undefined;
    const clearsClaude = scope.provider === undefined || scope.provider === 'claude';
    const clearsCodex = scope.provider === undefined || scope.provider === 'codex';
    if (broadScope && clearsClaude) {
      const legacyKeys = this.extensionGlobalStateKeys().filter((key) =>
        key.startsWith(LEGACY_QUOTA_PREFIX) ||
        key.startsWith(LEGACY_WEEKLY_PREFIX),
      );
      for (const key of legacyKeys) {
        await this.context.globalState.update(key, undefined);
      }
    }
    if (broadScope && clearsCodex) {
      // A clear is the user's decision to discard legacy P5 quota history too.
      // Keep the marker so a surviving P1 cannot repopulate P2 later.
      await this.context.globalState.update(QUOTA_P5_MIGRATION_KEY, true);
    }
  }

  private assertScopedQuotaMigrationIsResolved(scope: ResolvedQuotaScope): void {
    if (scope.accountFingerprint === undefined) return;
    if (scope.provider === 'claude') {
      const unresolved = this.extensionGlobalStateKeys().some((key) =>
        key.startsWith(LEGACY_QUOTA_PREFIX) ||
        key.startsWith(LEGACY_WEEKLY_PREFIX),
      );
      if (unresolved) throw new QuotaObservationScopedMigrationBlockedError();
    }
    if (
      scope.provider === 'codex' &&
      this.context.globalState.get<boolean>(QUOTA_P5_MIGRATION_KEY) !== true
    ) {
      throw new QuotaObservationScopedMigrationBlockedError();
    }
  }

  private async resetSharingPreferencesHost(): Promise<void> {
    await this.settings.resetSharingOwnedData();
    await this.context.globalState.update('ccu.heatmapRepo', undefined);
    await this.context.globalState.update('ccu.heatmapPath', undefined);
    this.webviewProvider.clearSharingRuntimeState();
  }

  private pendingClientReset(): LocalDataClientAction | undefined {
    const value = this.context.globalState.get<unknown>(
      LOCAL_DATA_PENDING_CLIENT_RESET_KEY,
    );
    return value === 'reset-ui-state' ||
      value === 'reset-sharing-preferences' ||
      value === 'clear-all-client-state'
      ? value
      : undefined;
  }

  private replayPendingClientReset(): Promise<void> {
    const run = this.pendingClientResetReplay
      .catch(() => undefined)
      .then(async () => {
        const pending = this.pendingClientReset();
        if (!pending) return;
        if (await this.webviewProvider.requestClientLocalDataAction(pending)) {
          await this.context.globalState.update(
            LOCAL_DATA_PENDING_CLIENT_RESET_KEY,
            undefined,
          );
        }
      });
    this.pendingClientResetReplay = run;
    return run;
  }

  private async runLocalDataActionInteractive(
    action: LocalDataAction,
    quotaScopeToken?: string,
  ): Promise<LocalDataActionResult> {
    return this.serializeLocalDataAction(async () => {
      const locale = I18n.getLocale();
      const zh = locale === 'zh-CN';
      let quotaSelection: {
        scope: ResolvedQuotaScope;
        label: string;
        createdAt: number;
        revision: string;
        token: string;
      } | undefined;
      if (action === 'clear-quota-history') {
        const selected = quotaScopeToken
          ? this.localDataQuotaScopes.get(quotaScopeToken)
          : undefined;
        if (
          !selected ||
          Date.now() - selected.createdAt > LOCAL_DATA_QUOTA_SCOPE_TTL_MS ||
          selected.revision !== this.quotaObservationRevision()
        ) {
          return {
            ok: false,
            message: zh ? '额度历史范围已过期，请刷新清单后重试。' : 'The quota-history scope expired. Refresh the inventory and try again.',
          };
        }
        quotaSelection = { ...selected, token: quotaScopeToken as string };
      }
      const title = localDataActionTitle(action, locale);
      const targets = LOCAL_DATA_ACTION_TARGETS[action].map((target) => `• ${target}`);
      if (quotaSelection) targets.unshift(`• ${quotaSelection.label}`);
      const preflightNotes: string[] = [];
      if (action === 'clear-all-derived-data') {
        targets.push(...LOCAL_DATA_EXACT_GLOBAL_STATE_KEYS.map((key) =>
          `• globalState/${key}`,
        ));
        targets.push(...REGISTERED_CONFIGURATION_SETTING_KEYS.map((key) =>
          `• configuration/claudeCodeUsage.${key}`,
        ));
        const discoveredMigrationKeys = this.extensionGlobalStateKeys().filter((key) =>
          LOCAL_DATA_GLOBAL_STATE_PREFIXES.some((prefix) => key.startsWith(prefix)),
        );
        targets.push(...discoveredMigrationKeys.map((key) => `• globalState/${key}`));
        const registered = new Set(REGISTERED_CONFIGURATION_SETTING_KEYS);
        const inspectedOnly = KNOWN_CONFIGURATION_SETTING_KEYS.filter((key) =>
          !registered.has(key),
        );
        preflightNotes.push(
          zh
            ? `仅预检（若存在则在任何删除前停止）：${inspectedOnly.map((key) => `claudeCodeUsage.${key}`).join(', ')}`
            : `Preflight only (if present, stop before any deletion): ${inspectedOnly.map((key) => `claudeCodeUsage.${key}`).join(', ')}`,
        );
      }
      const exclusions = LOCAL_DATA_SOURCE_EXCLUSIONS.map((target) => `• ${target}`);
      const proceed = zh ? '继续' : 'Continue';
      const detail = [
        zh ? '精确目标：' : 'Exact targets:',
        ...targets,
        ...(preflightNotes.length > 0 ? ['', ...preflightNotes] : []),
        '',
        zh ? '始终排除：' : 'Always excluded:',
        ...exclusions,
      ].join('\n');
      const picked = await vscode.window.showWarningMessage(
        title,
        { modal: true, detail },
        proceed,
      );
      if (picked !== proceed) {
        return {
          ok: false,
          cancelled: true,
          message: zh ? '已取消；未更改任何本地数据。' : 'Cancelled; no local data was changed.',
        };
      }
      if (quotaSelection) {
        const current = this.localDataQuotaScopes.get(quotaSelection.token);
        this.localDataQuotaScopes.delete(quotaSelection.token);
        if (
          current !== undefined &&
          (
            current.createdAt !== quotaSelection.createdAt ||
            current.revision !== quotaSelection.revision ||
            Date.now() - current.createdAt > LOCAL_DATA_QUOTA_SCOPE_TTL_MS ||
            current.revision !== this.quotaObservationRevision()
          )
        ) {
          return {
            ok: false,
            message: zh ? '额度历史在确认期间发生变化，请刷新清单后重试。' : 'Quota history changed while confirming. Refresh the inventory and try again.',
          };
        }
        if (!current) {
          return {
            ok: false,
            message: zh ? '额度历史范围已使用或过期，请刷新后重试。' : 'The quota-history scope was already used or expired. Refresh and try again.',
          };
        }
      }
      let result: LocalDataActionResult;
      try {
        result = await this.executeLocalDataAction(action, quotaSelection?.scope);
      } catch (error) {
        if (error instanceof SettingsLocalDataClearError) {
          result = {
            ok: false,
            message: zh
              ? '检测到当前清单无法通过 VS Code API 安全删除的旧版 settings.json 项；尚未删除任何设置或密钥，请先手动移除这些旧项后重试。'
              : 'Legacy settings.json entries cannot be removed safely through the current VS Code API. No setting or secret was deleted; remove those legacy entries manually, then retry.',
          };
        } else if (
          error instanceof QuotaObservationScopedClearBlockedError ||
          error instanceof QuotaObservationScopedMigrationBlockedError
        ) {
          result = {
            ok: false,
            message: zh
              ? '所选按账号/供应商范围无法与隔离或待迁移的额度数据安全对应；尚未做范围删除。请选择“全部额度观测”并再次明确确认。'
              : 'The selected account/provider scope cannot be mapped safely while quarantined or pending-migration quota data exists. Nothing was scope-cleared; choose All quota observations and confirm again.',
          };
        } else {
          result = {
            ok: false,
            message: zh ? '操作未完成；源日志和账号数据均未更改。' : 'The action did not complete; source logs and account data were not changed.',
          };
        }
      }
      if (result.clientAction) {
        let tombstoneStored = false;
        try {
          await this.context.globalState.update(
            LOCAL_DATA_PENDING_CLIENT_RESET_KEY,
            result.clientAction,
          );
          tombstoneStored = true;
        } catch {
          // Still attempt the live client clear. A successful verified ACK is
          // sufficient even when the recovery tombstone could not be written.
        }
        const clientResetOk = await this.webviewProvider.requestClientLocalDataAction(
          result.clientAction,
        );
        if (clientResetOk && tombstoneStored) {
          try {
            await this.context.globalState.update(
              LOCAL_DATA_PENDING_CLIENT_RESET_KEY,
              undefined,
            );
          } catch {
            // A stale tombstone only replays the same exact idempotent reset.
          }
        }
        result = clientResetOk
          ? { ...result, clientAction: undefined }
          : {
              ok: false,
              message: zh
                ? tombstoneStored
                  ? '宿主数据已处理，但 Webview 未确认本地状态重置；已记录待处理重置，下次打开面板会自动重试。'
                  : '宿主数据已处理，但 Webview 未确认本地状态重置，且无法写入重试标记；请保持面板打开后重试。'
                : tombstoneStored
                  ? 'Host data was handled, but the Webview did not confirm its local reset. A pending reset was recorded and will retry when the panel next opens.'
                  : 'Host data was handled, but the Webview did not confirm its local reset and a retry marker could not be stored. Keep the panel open and retry.',
            };
      }
      if (result.ok) {
        this.webviewProvider.requestLocalDataInventoryRefresh();
      }
      if (!this.webviewProvider) return result;
      void vscode.window.showInformationMessage(result.message);
      return result;
    });
  }

  private async executeLocalDataAction(
    action: LocalDataAction,
    quotaScope: ResolvedQuotaScope | undefined,
  ): Promise<LocalDataActionResult> {
    const zh = I18n.getLocale() === 'zh-CN';
    switch (action) {
      case 'rebuild-codex-index':
        await this.clearCodexDerivedIndex(true);
        return { ok: true, message: zh ? 'Codex 派生索引已安全重建。' : 'The Codex derived index was safely rebuilt.' };
      case 'clear-quota-history':
        this.stopQuotaColdRetry('settings-change');
        await this.cancelQuotaNetworks('cancelled');
        this.assertScopedQuotaMigrationIsResolved(quotaScope ?? {});
        this.quotaObservationStore = await this.quotaObservationRepository.clear(quotaScope ?? {});
        await this.clearLegacyQuotaMigrationInputs(quotaScope ?? {});
        this.refreshQuotaObservationViews();
        return { ok: true, message: zh ? '所选额度观测历史已清除；官方额度未受影响。' : 'The selected quota observations were cleared; provider quotas were not changed.' };
      case 'clear-advice-data': {
        const cleared = await this.webviewProvider.clearAdviceLocalData();
        if (!cleared) throw new Error('advice-clear-failed');
        for (const key of LEGACY_ADVICE_LOCAL_STATE_KEYS) {
          await this.context.globalState.update(key, undefined);
        }
        return { ok: true, message: zh ? '本地建议台账已清除。' : 'The local advice ledger was cleared.' };
      }
      case 'reset-ui-state':
        return {
          ok: true,
          message: zh ? '仪表板界面状态已重置。' : 'Dashboard UI state was reset.',
          clientAction: 'reset-ui-state',
        };
      case 'reset-sharing-preferences':
        await this.resetSharingPreferencesHost();
        return {
          ok: true,
          message: zh ? '分享偏好和目标字符串已重置。' : 'Sharing preferences and destination strings were reset.',
          clientAction: 'reset-sharing-preferences',
        };
      case 'clear-byok-secret':
        this.webviewProvider.invalidatePreparedAiRequests();
        await this.cancelAdviceNetworks('cancelled');
        await this.settings.clearByokOwnedData();
        return { ok: true, message: zh ? 'BYOK 建议密钥已从 SecretStorage 清除。' : 'The BYOK advice secret was cleared from SecretStorage.' };
      case 'clear-all-derived-data':
        return this.clearAllExtensionDerivedData();
    }
  }

  private async clearCodexDerivedIndex(rebuild: boolean): Promise<void> {
    const generation = ++this.configurationGeneration;
    this.codexRefreshSuspensionDepth += 1;
    try {
      this.stopCodexWatching('settings-change');
      this.codexWorkerCancellationRequested = true;
      await this.waitForCodexProviderRetirements();
      const retiring = this.codexProvider;
      await this.cancelCodexProviderAndWait(retiring);
      while (this.activeCodexRefreshes.size > 0) {
        await Promise.allSettled([...this.activeCodexRefreshes]);
      }
      await retiring.dispose();
      await this.releaseCodexOwnership('settings-change');
      const indexPath = path.join(this.context.globalStorageUri.fsPath, 'codex-index-v1.json');
      await this.removeDerivedFileFamilyWithLease(indexPath, 'codex-index');
      this.codexView = null;
      this.codexInsights = emptyCodexScopedInsights();
      this.codexHasData = false;
      this.codexRefreshing = false;
      this.codexProgress = null;
      this.codexBackgroundState = createBackgroundWorkState({
        measurementVersion: ClaudeCodeUsageExtension.CODEX_BACKGROUND_MEASUREMENT_VERSION,
        reason: 'first-index',
        now: Date.now(),
      });
      await this.saveCodexBackgroundState();
      this.codexProvider = this.createCodexProvider(this.getConfiguration());
      this.syncProviderUi();
    } finally {
      this.codexRefreshSuspensionDepth -= 1;
    }
    if (
      rebuild &&
      !this.disposed &&
      generation === this.configurationGeneration &&
      this.windowActivity.focused &&
      this.getConfiguration().codexEnabled
    ) {
      await this.refreshCodexData('manual');
      if (!this.disposed && generation === this.configurationGeneration) {
        this.startCodexWatching();
      }
    }
  }

  private async clearAllExtensionDerivedData(): Promise<LocalDataActionResult> {
    const zh = I18n.getLocale() === 'zh-CN';
    this.settings.preflightResetAllOwnedData();
    this.clearingAllLocalData = true;
    // The in-memory fingerprint salt and repositories deliberately stay
    // immutable. Fail closed after any clear-all attempt until a reload creates
    // fresh runtime objects from the now-empty stores.
    this.localDataClearedRequiresReload = true;
    try {
      await this.drainInitializationWritesForClear();
      this.stopQuotaColdRetry('settings-change');
      this.stopAutoRefresh('settings-change');
      this.stopFileWatching('settings-change');
      this.stopCredentialsWatching('settings-change');
      await Promise.all([
        this.cancelAdviceNetworks('cancelled'),
        this.cancelQuotaNetworks('cancelled'),
      ]);
      await this.settings.resetAllOwnedData();
      await this.clearCodexDerivedIndex(false);
      this.quotaObservationStore = await this.quotaObservationRepository.clear({});
      await this.webviewProvider.clearAdviceLocalData();
      this.webviewProvider.clearSharingRuntimeState();
      const keys = this.extensionGlobalStateKeys().filter((key) =>
        LOCAL_DATA_EXACT_GLOBAL_STATE_KEYS.includes(key as typeof LOCAL_DATA_EXACT_GLOBAL_STATE_KEYS[number]) ||
        LOCAL_DATA_GLOBAL_STATE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
        LEGACY_ADVICE_LOCAL_STATE_KEYS.includes(key),
      );
      for (const key of keys) {
        await this.context.globalState.update(key, undefined);
      }
      await this.verifyClearAllPostcondition();
      this.quotaObservationStore = createEmptyQuotaObservationStore();
      this.claudeWeeklyQuotaHistory = [];
      this.cache.usageLimits = null;
      this.cache.usageLimitsLastUpdate = new Date(0);
      this.cache.records = [];
      this.cache.contentAnalysis = null;
      this.cache.claudeIndex = createClaudeUsageIndex();
      this.codexView = null;
      this.codexInsights = emptyCodexScopedInsights();
      this.codexHasData = false;
      this.refreshQuotaObservationViews();
      this.syncProviderUi();
      return {
        ok: true,
        message: zh
          ? '插件派生数据已按清单清除；Claude/Codex 源日志和账号凭证未更改。请重载窗口以重新初始化。'
          : 'Extension-derived data was cleared as listed; Claude/Codex source logs and provider credentials were unchanged. Reload the window to reinitialize.',
        clientAction: 'clear-all-client-state',
      };
    } finally {
      this.clearingAllLocalData = false;
    }
  }

  private async verifyClearAllPostcondition(): Promise<void> {
    const residualState = this.extensionGlobalStateKeys().filter((key) =>
      LOCAL_DATA_EXACT_GLOBAL_STATE_KEYS.includes(key as typeof LOCAL_DATA_EXACT_GLOBAL_STATE_KEYS[number]) ||
      LOCAL_DATA_GLOBAL_STATE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
      LEGACY_ADVICE_LOCAL_STATE_KEYS.includes(key),
    );
    if (residualState.length > 0) {
      throw new Error('local-data-clear:global-state-postcondition-failed');
    }
    const indexPath = path.join(this.context.globalStorageUri.fsPath, 'codex-index-v1.json');
    if ((await this.derivedFileFamilyNames(indexPath, 'codex-index')).length > 0) {
      throw new Error('local-data-clear:codex-index-postcondition-failed');
    }
    const quotaPath = path.join(
      this.context.globalStorageUri.fsPath,
      QUOTA_OBSERVATION_FILE,
    );
    const quotaNames = await this.derivedFileFamilyNames(
      quotaPath,
      'quota-observations',
    );
    if (quotaNames.some((name) => name !== QUOTA_OBSERVATION_FILE)) {
      throw new Error('local-data-clear:quota-auxiliary-postcondition-failed');
    }
    const quota = await loadQuotaObservationStore(quotaPath);
    if (quota.disposition !== 'valid' || quota.store.observations.length > 0) {
      throw new Error('local-data-clear:quota-postcondition-failed');
    }
  }

  private async refreshPricing(): Promise<void> {
    try {
      const result = await fetchLatestPricing();
      this.invalidateClaudeUsagePricingCache();
      vscode.window.showInformationMessage(`${I18n.t.popup.pricingUpdated} (${result.updated})`);
      // Force a full recompute so the new prices take effect.
      void this.refreshData(true, 'pricing');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`${I18n.t.popup.pricingUpdateFailed}: ${message}`);
    }
  }

  /** Export the token heatmap as a GitHub-profile-ready SVG (a "contribution
   * graph" of the trailing year, Claude orange). Offers to copy the Markdown
   * embed snippet. */
  private async exportHeatmap(): Promise<void> {
    const records = this.cache.records;
    if (!records || records.length === 0) {
      vscode.window.showWarningMessage(I18n.t.popup.noDataMessage);
      return;
    }
    const timeZone = I18n.getTimezone();
    const daily = ClaudeDataLoader.getDailyUsageMap(records, timeZone);
    const svg = renderHeatmapSvg(daily, {
      endDateISO: dayKeyInZone(new Date(), timeZone),
    });
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'claude-code-heatmap.svg')),
      filters: { 'SVG image': ['svg'] },
      saveLabel: 'Export heatmap',
    });
    if (!uri) {
      return;
    }
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
    } catch (e) {
      vscode.window.showErrorMessage(`Heatmap export failed: ${(e as Error).message}`);
      return;
    }
    const copy = 'Copy Markdown embed';
    const pick = await vscode.window.showInformationMessage('Token heatmap exported.', copy);
    if (pick === copy) {
      await vscode.env.clipboard.writeText(`![Claude Code token heatmap](${path.basename(uri.fsPath)})`);
    }
  }

  /** Minimal GitHub REST call over https (the codebase avoids fetch for
   * older-runtime safety). Returns the status + raw body. */
  private githubApi(
    method: string,
    apiPath: string,
    token: string,
    body?: unknown
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          hostname: 'api.github.com',
          path: apiPath,
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'ClaudeCodeUsage-VSCode',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          },
          timeout: 20000,
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ status: res.statusCode || 0, body: b }));
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('GitHub request timed out')));
      if (data) {
        req.write(data);
      }
      req.end();
    });
  }

  /**
   * Publish one aggregate SVG to a verified public repository. v2.3.1 no
   * longer requests the broad `repo` scope: private targets fail closed and
   * retain the local SVG + Markdown path. A second modal names the exact
   * owner/repo/branch/path and create-vs-overwrite action before any PUT.
   */
  private async publishHeatmapToGitHub(): Promise<void> {
    const records = this.cache.records;
    if (!records || records.length === 0) {
      vscode.window.showWarningMessage(I18n.t.popup.noDataMessage);
      return;
    }

    const proceed = 'Continue with public-only access';
    const ok = await vscode.window.showWarningMessage(
      'Publish the token heatmap to a public GitHub repository?',
      {
        modal: true,
        detail:
          'VS Code will request the narrower public_repo permission. Private repositories are intentionally unsupported; use local SVG export there. The plugin will read repository metadata and then show the exact public repository, branch, path, create/overwrite action, and payload size before writing.',
      },
      proceed
    );
    if (ok !== proceed) {
      return;
    }

    let session: vscode.AuthenticationSession | undefined;
    try {
      session = await vscode.authentication.getSession(
        'github',
        [GITHUB_PUBLIC_REPO_SCOPE],
        { createIfNone: true },
      );
    } catch {
      vscode.window.showErrorMessage('GitHub sign-in was cancelled.');
      return;
    }
    if (!session) {
      return;
    }
    const token = session.accessToken;
    const login = session.account.label.split(/\s/)[0];

    const repo = await vscode.window.showInputBox({
      prompt: 'Public target repository (owner/name). Private repositories use local SVG export.',
      value: this.context.globalState.get<string>('ccu.heatmapRepo') || `${login}/${login}`,
      validateInput: (value) => {
        try {
          createGitHubPublishPlan(value, 'heatmap.svg');
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : 'Use the form owner/name';
        }
      },
    });
    if (!repo) {
      return;
    }
    const filePath =
      (await vscode.window.showInputBox({
        prompt: 'File path in the repo',
        value: this.context.globalState.get<string>('ccu.heatmapPath') || 'claude-code-heatmap.svg',
      })) || '';
    if (!filePath) {
      return;
    }
    let plan;
    try {
      plan = createGitHubPublishPlan(repo, filePath);
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    const timeZone = I18n.getTimezone();
    const svg = renderHeatmapSvg(
      ClaudeDataLoader.getDailyUsageMap(records, timeZone),
      { endDateISO: dayKeyInZone(new Date(), timeZone) },
    );
    const contentB64 = Buffer.from(svg, 'utf8').toString('base64');
    const request = (
      method: 'GET' | 'PUT',
      apiPath: string,
      body?: unknown,
    ) => this.githubApi(method, apiPath, token, body);

    let preview;
    try {
      preview = await probePublicGitHubPublishTarget(plan, request);
    } catch (error) {
      vscode.window.showErrorMessage(`Heatmap publish unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const exactProceed = preview.action === 'update'
      ? 'Overwrite exactly this file'
      : 'Create exactly this file';
    const exact = await vscode.window.showWarningMessage(
      'Confirm the exact GitHub write',
      {
        modal: true,
        detail: githubPublishConfirmationDetail(preview, Buffer.byteLength(svg, 'utf8')),
      },
      exactProceed,
    );
    if (exact !== exactProceed) {
      return;
    }

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Publishing heatmap to GitHub…' },
        () => publishPublicGitHubFile(preview, contentB64, request),
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Heatmap publish failed: ${(e as Error).message}`);
      return;
    }

    // Destination strings are convenience preferences, not credentials. Save
    // them only after the exact, confirmed write succeeds.
    await this.context.globalState.update('ccu.heatmapRepo', `${preview.owner}/${preview.repository}`);
    await this.context.globalState.update('ccu.heatmapPath', preview.filePath);

    const view = 'View on GitHub';
    const pick = await vscode.window.showInformationMessage(
      `Heatmap published to ${preview.owner}/${preview.repository}.`,
      view
    );
    if (pick === view) {
      void vscode.env.openExternal(vscode.Uri.parse(preview.browserUrl));
    }
  }

  /** Export a one-page usage share card as a self-contained SVG. Only aggregate,
   * non-identifying metrics are drawn (privacy is enforced by ShareCardData's
   * shape). The user picks the range; the card opens for review after saving. */
  private async exportShareCard(): Promise<void> {
    const records = this.cache.records;
    if (!records || records.length === 0) {
      vscode.window.showWarningMessage(I18n.t.popup.noDataMessage);
      return;
    }
    const ranges: (vscode.QuickPickItem & { range: ShareRange })[] = [
      { label: 'This month', range: 'month' },
      { label: 'Last 7 days', range: 'week' },
      { label: 'Today', range: 'today' },
    ];
    const picked = await vscode.window.showQuickPick(ranges, {
      placeHolder: 'Share card range',
    });
    if (!picked) {
      return;
    }
    const input = ClaudeDataLoader.buildShareInput(records, picked.range);
    const data = buildShareCardData(input, DEFAULT_SECTIONS);
    const kind = vscode.window.activeColorTheme?.kind;
    const isDark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
    const svg = renderShareCardSvg(data, {
      theme: 'claudeClassic',
      isDark,
      lang: I18n.getLocale(),
      formatCurrency: (amountUsd) => I18n.formatCurrency(amountUsd),
    });
    const defaultName = shareCardFilename(picked.range).replace(/\.png$/, '.svg');
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultName)),
      filters: { 'SVG image': ['svg'] },
      saveLabel: 'Export share card',
    });
    if (!uri) {
      return;
    }
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
    } catch (e) {
      vscode.window.showErrorMessage(`Share card export failed: ${(e as Error).message}`);
      return;
    }
    const open = 'Open';
    const pick = await vscode.window.showInformationMessage('Usage share card exported.', open);
    if (pick === open) {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  private async getAdvice(): Promise<void> {
    // The legacy command now enters the one evidence/preview/send surface. It
    // never constructs or sends an alternate free-form summary.
    this.webviewProvider.show('content');
    if (!this.settings.get<boolean>('advice.effectiveness.enabled')) {
      const picked = await vscode.window.showInformationMessage(
        I18n.t.popup.adviceEffectiveness.description,
        I18n.t.popup.settings,
      );
      if (picked === I18n.t.popup.settings) {
        vscode.commands.executeCommand('claudeCodeUsage.openSettings');
      }
    }
  }

  /**
   * Usage Optimizer round-trip (Phase 9c). Takes the user's rough draft and the
   * three optional lenses, asks the configured model to return a tightened
   * paste-ready prompt plus a settings recommendation, and parses the two
   * sections out. ONLY the pasted draft enters the sealed preview — no
   * filesystem access. A separate Send click is the sole authorization for the
   * prepared bytes to leave the machine.
   */
  /** Distinct models the user actually uses — Claude reduced to family names
   * (haiku/sonnet/opus/fable), third-party models kept as-is — so the optimizer
   * recommends from real options instead of guessing a (possibly stale) name. */
  private usedModelNames(): string[] {
    const family = (m: string): string => {
      const s = m.toLowerCase();
      if (/fable|mythos/.test(s)) {
        return 'fable';
      }
      if (/opus/.test(s)) {
        return 'opus';
      }
      if (/sonnet/.test(s)) {
        return 'sonnet';
      }
      if (/haiku/.test(s)) {
        return 'haiku';
      }
      return m;
    };
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of this.cache.records) {
      const m = r?.message?.model;
      if (!m || typeof m !== 'string') {
        continue;
      }
      const f = family(m);
      if (!seen.has(f)) {
        seen.add(f);
        out.push(f);
      }
    }
    return out.slice(0, 8);
  }

  private async prepareOptimizerRequest(
    draft: string,
    options: { resolve: boolean; distil: boolean; aesthetic: boolean },
    sourceRevision: string,
    consentGeneration: number,
  ): Promise<{ prepared?: ReturnType<typeof prepareOptimizerInvocation>; error?: string }> {
    const text = (draft || '').trim();
    if (text === '') {
      return { error: I18n.t.popup.noDataMessage };
    }

    const config = this.getConfiguration();
    const needsKey =
      config.adviceBackend === 'api' && (!config.adviceApiKey || config.adviceApiKey.trim() === '');
    if (needsKey) {
      return { error: I18n.t.popup.adviceNeedsKey };
    }

    const language = I18n.getLanguageName();
    const systemPrompt = buildOptimizerSystemPrompt(language, options, this.usedModelNames());

    try {
      return { prepared: prepareOptimizerInvocation({
        apiFormat: config.adviceApiFormat,
        apiUrl: config.adviceApiUrl,
        model: config.adviceModel,
        reasoningEffort: config.adviceReasoningEffort,
        systemPrompt,
        draft: text,
        sourceRevision,
        consentGeneration,
        createdAtEpochMs: Date.now(),
        timeoutMs: 90_000,
      }) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `${I18n.t.popup.adviceFailed}: ${message}` };
    }
  }

  private loadConfiguration(): void {
    const config = this.getConfiguration();
    this.activePricingBackend = config.pricingBackend;
    setPricingBackend(config.pricingBackend);
    this.applyFormattingConfiguration(config);
    this.statusBar.setVisibility(config.showCost, config.showContext, config.usageLimitTracking, config.statusBarMetric, config.showScopedWeekly, config.quotaFiveHourOnly, config.showResetInStatusBar, config.resetCountdownFormat, config.statusBarQuotaFormat);

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeCodeUsage')) {
        this.onConfigurationChanged();
      }
    });

    // Switching the open folder in the same window can leave the quota indicator
    // blank (it does not always restart the extension host, and the inherited
    // process state — e.g. the curl spawn cwd — can go stale). Force a fresh
    // quota fetch + refresh so it reappears without needing a new window.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.cache.usageLimitsLastUpdate = new Date(0);
      this.cache.usageLimitsBackoffUntil = new Date(0);
      this.cache.usageLimitsFailStreak = 0;
      this.quotaColdRetryDone = false;
      void this.refreshData(true, 'workspace');
    });
  }

  private applyFormattingConfiguration(config: ExtensionConfig): void {
    I18n.setLanguage(config.language as any);
    I18n.setDecimalPlaces(config.decimalPlaces);
    I18n.setCurrencyDisplay(config.displayCurrency);
    I18n.setTokenDecimalPlaces(config.tokenDecimalPlaces);
    I18n.setCompactNumbers(config.compactNumbers);
    I18n.setTimezone(config.timezone);
  }

  private getConfiguration(): ExtensionConfig {
    // All settings flow through SettingsStore: language and dataDirectory live
    // in VS Code config, BYOK secrets live in SecretStorage, and the rest use
    // the dashboard-managed store. Defaults come from the settings catalog.
    const s = this.settings;
    return {
      refreshInterval: s.get<number>('refreshInterval'),
      dataDirectory: s.get<string>('dataDirectory'),
      pricingBackend: s.get<'anthropic' | 'aws-bedrock-in-region'>('pricingBackend'),
      codexEnabled: s.get<boolean>('codex.enabled'),
      codexDataDirectory: s.get<string>('codex.dataDirectory'),
      codexFileWatchSeconds:
        Number(s.get<string>('codex.fileWatchSeconds') ?? '30') || 0,
      codexOptimizationEnabled: s.get<boolean>('codex.optimization.enabled'),
      statusBarProvider: s.get<'auto' | 'claude' | 'codex'>('statusBarProvider'),
      codexStatusMetric: s.get<'fresh' | 'processed' | 'output'>(
        'codex.statusMetric',
      ),
      language: s.get<string>('language'),
      decimalPlaces: s.get<number>('decimalPlaces'),
      displayCurrency: s.get<string>('displayCurrency'),
      tokenDecimalPlaces: s.get<number>('tokenDecimalPlaces'),
      compactNumbers: s.get<boolean>('compactNumbers'),
      releaseAnnouncements: s.get<boolean>('releaseAnnouncements'),
      timezone: s.get<string>('timezone'),
      showCost: s.get<boolean>('showCost'),
      showContext: s.get<boolean>('showContext'),
      contextWindowOverride: s.get<number>('contextWindowOverride'),
      statusBarMetric: s.get<'cost' | 'monthly-cost' | 'tokens'>('statusBarMetric'),
      showScopedWeekly: s.get<boolean>('showScopedWeekly'),
      showResetInStatusBar: s.get<boolean>('showResetInStatusBar'),
      quotaFiveHourOnly: s.get<boolean>('quotaFiveHourOnly'),
      resetCountdownFormat: s.get<'decimal' | 'units' | 'clock'>('resetCountdownFormat'),
      statusBarQuotaFormat: s.get<string>('statusBarQuotaFormat'),
      usageLimitTracking: s.get<boolean>('usageLimitTracking'),
      adviceApiKey: s.get<string>('advice.apiKey'),
      adviceApiUrl: s.get<string>('advice.apiUrl'),
      adviceModel: s.get<string>('advice.model'),
      adviceReasoningEffort: s.get<string>('advice.reasoningEffort'),
      adviceUserContext: s.get<string>('advice.userContext'),
      // Subscription backend is not shipped this version (Anthropic 403s the
      // OAuth-token direct call) — advice/optimizer are API-only. The dormant
      // subscription transport remains in advisor.ts.
      adviceBackend: 'api',
      adviceApiFormat: s.get<'anthropic' | 'openai'>('advice.apiFormat'),
      advicePromptWindowDays: s.get<number>('advice.promptWindowDays'),
      enableContentAnalysis: s.get<boolean>('enableContentAnalysis'),
      projectGroupingMode: s.get<'git' | 'folder' | 'flat'>('projectGroupingMode'),
      fileWatchSeconds: Number(s.get<string>('fileWatchSeconds') ?? '2') || 0,
      dashboardAutoRefresh: s.get<boolean>('dashboardAutoRefresh')
    };
  }

  private codexHome(config: ExtensionConfig): string {
    return resolveCodexHome(
      config.codexDataDirectory,
      process.env,
      os.homedir(),
    );
  }

  private createCodexProvider(config: ExtensionConfig): CodexProvider {
    return new CodexProvider({
      enabled: config.codexEnabled,
      codexHome: this.codexHome(config),
      indexPath: path.join(
        this.context.globalStorageUri.fsPath,
        'codex-index-v1.json',
      ),
      salt: this.codexSalt,
      timeZone: resolveTimeZone(config.timezone),
    });
  }

  private syncProviderUi(): void {
    const config = this.getConfiguration();
    const claudeHasData = this.cache.records.length > 0;
    this.webviewProvider.updateAdviceEffectivenessData(
      this.buildAdviceEffectivenessProviderStates(config),
    );
    this.webviewProvider.updateProviderData(
      this.codexView,
      this.codexInsights,
      {
        claude: claudeHasData,
        codex: this.codexAvailable,
        codexData: this.codexHasData,
        codexLoading: this.codexRefreshing,
        codexProgress: this.codexProgress
          ? {
              scannedFiles: this.codexProgress.scannedFiles,
              totalFiles: this.codexProgress.totalFiles,
              indexedBytes: this.codexProgress.indexedBytes,
              totalBytes: this.codexProgress.totalBytes,
              reason: this.codexBackgroundState.reason,
            }
          : this.codexRefreshing
            ? {
                scannedFiles: this.codexView?.coverage.indexedFiles ?? 0,
                totalFiles: this.codexView?.coverage.totalFiles ?? 0,
                indexedBytes: this.codexView?.coverage.indexedBytes ?? 0,
                totalBytes: this.codexView?.coverage.totalBytes ?? 0,
                reason: this.codexBackgroundState.reason,
              }
            : null,
      },
    );

    const selected =
      config.statusBarProvider === 'auto'
        ? claudeHasData
          ? 'claude'
          : this.codexHasData
            ? 'codex'
            : 'claude'
        : config.statusBarProvider;
    if (selected === 'codex') {
      if (this.codexView) {
        this.statusBar.updateCodex(
          this.codexView.today,
          config.codexStatusMetric,
          this.codexView.limit,
        );
      }
      this.statusBar.setProvider('codex');
    } else {
      this.statusBar.setProvider('claude');
    }
  }

  /**
   * Build the default-off experimental evidence view from narrow, numeric
   * inputs already materialized by each provider index. Neither provider
   * adapter accepts records, paths, session IDs, or prompt bodies.
   */
  private buildAdviceEffectivenessProviderStates(
    config: ExtensionConfig,
  ): AdviceEffectivenessProviderStates {
    if (!this.settings.get<boolean>('advice.effectiveness.enabled')) {
      return {};
    }
    const states: AdviceEffectivenessProviderStates = {};
    const now = Date.now();
    const generatedAt = new Date(now).toISOString();
    const epochDay = Math.floor(now / 86_400_000);
    const windowDays = Math.max(1, Math.round(config.advicePromptWindowDays));

    try {
      const materialized = claudeUsageDashboardSnapshot(this.cache.claudeIndex, {
        now: new Date(now),
        adviceWindowDays: windowDays,
      });
      const adviceWindow = materialized.adviceWindow;
      if (adviceWindow && adviceWindow.aggregate.messageCount > 0) {
        const aggregate = buildAdviceAggregateSnapshot(
          adviceWindow.aggregate,
          'overall',
          windowDays,
        );
        const framework = this.cache.contentAnalysis?.frameworkOverhead;
        const adapted = adaptClaudeAdvice({
          adviceId: `advice-claude-${windowDays}d-${epochDay}`,
          generatedAt,
          locale: I18n.getLocale(),
          aggregate,
          sessionSummary: {
            scope: 'overall',
            windowDays,
            totalSessions: adviceWindow.totalSessions,
            longSessionCount: adviceWindow.longSessionCount,
            largeContextSessionCount: adviceWindow.largeContextSessionCount,
          },
          ...(framework
            ? {
                frameworkOverhead: {
                  frameworkEstimatedTokens: framework.frameworkEstimatedTokens,
                  observedInputEstimatedTokens: framework.observedInputEstimatedTokens,
                  classifiedEvents: framework.classifiedEvents,
                },
              }
            : {}),
        });
        if (adapted.ok) {
          states.claude = {
            provider: 'claude',
            contract: adapted.value.contract,
            remotePreviewEligible: adapted.value.remoteEvidenceEligible,
            aggregate: adapted.value.aggregate,
            userContext: config.adviceUserContext,
            promptSamples: selectAdvicePromptSamples(
              this.cache.contentAnalysis?.recentPrompts ?? [],
              now,
              windowDays,
            ),
          };
        }
      }
    } catch {
      // Conservative degradation: omit the experimental Claude state.
    }

    try {
      const view = this.codexView;
      if (view) {
        const behavior = view.behaviorScopes.last30Days;
        const adapted = adaptCodexLocalAdvice({
          adviceId: `advice-codex-30d-${epochDay}`,
          generatedAt,
          locale: I18n.getLocale(),
          scope: '30d',
          insights: this.codexInsights.last30Days,
          behavior: {
            childFreshShare: behavior.childFreshShare,
            approvalReviewerFreshShare: behavior.approvalReviewerFreshShare,
            highEffortFreshShare: behavior.highEffortFreshShare,
            processedToFreshRatio: behavior.processedToFreshRatio,
            cacheShare: behavior.cacheShare,
            postPatchToolCallsPerPatchCall: behavior.postPatchToolCallsPerPatchCall,
          },
          quality: {
            indexComplete: view.coverage.complete,
            identityComplete: view.coverage.identity.complete,
            periodComplete: view.periodCoverage.last30Days.complete,
            qualityFlags: view.qualityFlags.map((flag) => flag.flag),
          },
        });
        if (adapted.ok) {
          states.codex = {
            provider: 'codex',
            contract: adapted.value.contract,
            remotePreviewEligible: adapted.value.remoteEvidenceEligible,
            promptSamples: [],
          };
        }
      }
    } catch {
      // Existing Codex local recommendations remain authoritative on failure.
    }
    return states;
  }

  private codexHistoricalWorkPending(snapshot: CodexProviderSnapshot | null): boolean {
    if (!snapshot) return true;
    const coverage = snapshot.coverage;
    return !coverage.complete ||
      !coverage.identity.complete ||
      !coverage.period.allTime.complete ||
      !snapshot.hourlyCoverage?.complete;
  }

  private codexIndexGeneration(snapshot: CodexProviderSnapshot | null): number | null {
    return snapshot?.indexGeneration ?? null;
  }

  private codexBackgroundReason(snapshot: CodexProviderSnapshot | null): BackgroundWorkReason {
    if (!snapshot || snapshot.coverage.totalFiles === 0) return 'first-index';
    if (!snapshot.coverage.period.allTime.complete) return 'period-migration';
    if (!snapshot.hourlyCoverage?.complete) return 'hourly-history';
    return 'history-backfill';
  }

  private codexBackgroundProgress(snapshot: CodexProviderSnapshot): BackgroundWorkState['progress'] {
    const main = snapshot.coverage;
    const period = main.period.allTime;
    const hourly = snapshot.hourlyCoverage;
    return {
      completedUnits: main.indexedFiles + period.migratedFiles + (hourly?.indexedFiles ?? 0),
      totalUnits: main.totalFiles + period.totalFiles + (hourly?.totalFiles ?? 0),
      completedBytes: main.indexedBytes + period.migratedBytes + (hourly?.indexedBytes ?? 0),
      totalBytes: main.totalBytes + period.totalBytes + (hourly?.totalBytes ?? 0),
    };
  }

  private async saveCodexBackgroundState(): Promise<void> {
    const snapshot: BackgroundWorkState = {
      ...this.codexBackgroundState,
      progress: { ...this.codexBackgroundState.progress },
    };
    const previous = this.codexBackgroundStateWrite;
    const write = previous
      .catch(() => undefined)
      .then(() => this.context.globalState.update(
        ClaudeCodeUsageExtension.CODEX_BACKGROUND_WORK_STATE_KEY,
        snapshot,
      ));
    this.codexBackgroundStateWrite = write;
    await write;
  }

  private trackResourceStop(stop: Promise<unknown>): void {
    let tracked!: Promise<void>;
    tracked = stop
      .then(() => undefined)
      .catch((error: unknown) => {
        this.resourceStopFailure ??= error;
        throw error;
      })
      .finally(() => this.pendingResourceStops.delete(tracked));
    this.pendingResourceStops.add(tracked);
    // The owning lifecycle later drains and reports the failure. Attaching a
    // handler here prevents a fire-and-forget watcher close from becoming an
    // unhandled rejection before disposal reaches that drain point.
    void tracked.catch(() => undefined);
  }

  private async drainResourceStops(): Promise<void> {
    while (this.pendingResourceStops.size > 0) {
      await Promise.allSettled([...this.pendingResourceStops]);
    }
    if (this.resourceStopFailure) {
      const failure = this.resourceStopFailure;
      this.resourceStopFailure = null;
      throw failure;
    }
  }

  private async runAdviceNetwork<T>(
    request: (signal: AbortSignal) => Promise<T>,
    surface: 'advice' | 'optimizer' = 'advice',
  ): Promise<T> {
    if (this.disposed) {
      throw new Error('Extension is disposed');
    }
    const controller = new AbortController();
    const lease = this.resourceOwnership.register({
      kind: 'network',
      capability: 'advice-personalization',
      scope: 'advice',
      creator: 'advice-runtime',
      stopConditions: [
        'settled',
        'cancelled',
        'feature-disabled',
        'extension-dispose',
        'settings-change',
      ],
      boundedException: 'none',
    });
    let markSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    this.activeAdviceNetworks.set(controller, { lease, settled, surface });
    try {
      return await request(controller.signal);
    } finally {
      this.activeAdviceNetworks.delete(controller);
      markSettled();
      if (lease.active) {
        await lease.stop(controller.signal.aborted ? 'cancelled' : 'settled', () => undefined);
      }
    }
  }

  private async cancelAdviceNetworks(
    condition: Extract<
      ResourceStopCondition,
      'cancelled' | 'feature-disabled' | 'extension-dispose' | 'settings-change'
    >,
    surface?: 'advice' | 'optimizer',
  ): Promise<void> {
    const active = [...this.activeAdviceNetworks.entries()]
      .filter(([, operation]) => surface === undefined || operation.surface === surface);
    await Promise.all(active.map(async ([controller, operation]) => {
      const { lease, settled } = operation;
      if (lease.active) {
        await lease.stop(condition, async () => {
          controller.abort();
          await settled;
        });
      }
      this.activeAdviceNetworks.delete(controller);
    }));
  }

  private async cancelQuotaNetworks(
    condition: Extract<
      ResourceStopCondition,
      | 'cancelled'
      | 'window-blur'
      | 'feature-disabled'
      | 'extension-dispose'
      | 'settings-change'
      | 'profile-change'
    >,
  ): Promise<void> {
    const active = [...this.activeQuotaNetworks.entries()];
    await Promise.all(active.map(async ([controller, operation]) => {
      const { lease, settled } = operation;
      if (lease.active) {
        await lease.stop(condition, async () => {
          controller.abort();
          await settled;
        });
      }
      this.activeQuotaNetworks.delete(controller);
    }));
  }

  private createOwnedRefreshDebounce(
    scope: 'claude' | 'codex',
  ): QuietDebounce {
    return new QuietDebounce(
      (callback, ms) => {
        if (this.disposed) {
          return undefined as unknown as NodeJS.Timeout;
        }
        let timer!: NodeJS.Timeout;
        timer = setTimeout(() => {
          const lease = this.debounceTimerLeases.get(timer);
          this.debounceTimerLeases.delete(timer);
          if (lease?.active) {
            this.trackResourceStop(lease.stop('settled', () => undefined));
          }
          if (!this.disposed) callback();
        }, ms);
        const lease = this.resourceOwnership.register({
          kind: 'timer',
          capability: 'refresh',
          scope,
          creator: 'refresh-coordinator',
          stopConditions: [
            'settled',
            'cancelled',
            'window-blur',
            'feature-disabled',
            'extension-dispose',
            'settings-change',
          ],
          boundedException: 'none',
        });
        this.debounceTimerLeases.set(timer, lease);
        return timer;
      },
      (timer) => {
        if (!timer) return;
        const lease = this.debounceTimerLeases.get(timer);
        this.debounceTimerLeases.delete(timer);
        if (lease?.active) {
          this.trackResourceStop(lease.stop('cancelled', () => clearTimeout(timer)));
        }
        else clearTimeout(timer);
      },
    );
  }

  private scheduleQuotaColdRetry(): void {
    if (
      this.disposed ||
      this.quotaColdRetryTimer ||
      !this.windowActivity.focused ||
      !this.getConfiguration().usageLimitTracking
    ) {
      return;
    }
    this.quotaColdRetryTimer = setTimeout(() => {
      const lease = this.quotaColdRetryTimerLease;
      this.quotaColdRetryTimer = undefined;
      this.quotaColdRetryTimerLease = undefined;
      if (lease?.active) {
        this.trackResourceStop(lease.stop('settled', () => undefined));
      }
      if (
        this.disposed ||
        !this.windowActivity.focused ||
        !this.getConfiguration().usageLimitTracking
      ) {
        return;
      }
      void this.maybeFetchUsageLimits(this.getConfiguration()).then((retry) => {
        if (retry) {
          this.statusBar.updateQuota(retry);
          this.webviewProvider.updateQuota(retry);
        }
      });
    }, 8_000);
    this.quotaColdRetryTimerLease = this.resourceOwnership.register({
      kind: 'timer',
      capability: 'quota',
      scope: 'claude',
      creator: 'refresh-coordinator',
      stopConditions: [
        'settled',
        'window-blur',
        'feature-disabled',
        'extension-dispose',
        'settings-change',
        'profile-change',
      ],
      boundedException: 'none',
    });
  }

  private stopQuotaColdRetry(
    condition: Extract<
      ResourceStopCondition,
      | 'window-blur'
      | 'feature-disabled'
      | 'extension-dispose'
      | 'settings-change'
      | 'profile-change'
    >,
  ): void {
    const timer = this.quotaColdRetryTimer;
    const lease = this.quotaColdRetryTimerLease;
    this.quotaColdRetryTimer = undefined;
    this.quotaColdRetryTimerLease = undefined;
    if (timer) {
      if (lease?.active) {
        this.trackResourceStop(lease.stop(condition, () => clearTimeout(timer)));
      }
      else clearTimeout(timer);
    }
  }

  private takeCodexRefreshDiagnosticContext(): CodexRefreshDiagnosticContext {
    const context = {
      watcherEvents: this.codexWatcherEventsSinceRefresh ?? 0,
      coalescedTriggers: this.codexCoalescedTriggersSinceRefresh ?? 0,
    };
    this.codexWatcherEventsSinceRefresh = 0;
    this.codexCoalescedTriggersSinceRefresh = 0;
    return context;
  }

  private async refreshCodexData(trigger: RefreshTrigger): Promise<void> {
    if (
      this.disposed ||
      this.localDataClearedRequiresReload ||
      this.codexRefreshSuspensionDepth > 0
    ) return;
    const request = this.codexRefreshGate.request(false, trigger);
    if (request === null) {
      this.codexCoalescedTriggersSinceRefresh += 1;
      await (this.codexRefreshDrain ?? Promise.resolve());
      return;
    }

    const drain = Promise.resolve().then(() => this.drainCodexRefreshes(request));
    this.codexRefreshDrain = drain;
    try {
      await drain;
    } finally {
      if (this.codexRefreshDrain === drain) {
        this.codexRefreshDrain = null;
      }
    }
  }

  private async drainCodexRefreshes(initial: RefreshRequest): Promise<void> {
    let request: RefreshRequest | null = initial;
    try {
      while (request !== null) {
        if (
          this.disposed ||
          this.localDataClearedRequiresReload ||
          this.codexRefreshSuspensionDepth > 0
        ) break;
        await this.runScheduledCodexRefresh(request.trigger);
        request = this.codexRefreshGate.complete();
      }
    } finally {
      // If lifecycle work throws or disposal interrupts a queued follow-up,
      // drain the gate without starting more provider work. A later explicit
      // refresh must always be able to acquire a fresh single-flight.
      while (request !== null) {
        request = this.codexRefreshGate.complete();
      }
    }
  }

  private async runScheduledCodexRefresh(trigger: RefreshTrigger): Promise<void> {
    const generation = this.configurationGeneration;
    try {
      await this.waitForCodexProviderRetirements();
    } catch {
      return;
    }
    if (
      this.disposed ||
      this.localDataClearedRequiresReload ||
      this.codexRefreshSuspensionDepth > 0 ||
      generation !== this.configurationGeneration
    ) return;
    const diagnosticContext = this.takeCodexRefreshDiagnosticContext();
    const operation = this.runCodexRefresh(trigger, diagnosticContext);
    this.activeCodexRefreshes.add(operation);
    try {
      await operation;
    } catch {
      this.codexView = null;
      this.codexInsights = emptyCodexScopedInsights();
      this.codexHasData = false;
      this.codexRefreshing = false;
      this.codexProgress = null;
      this.codexProgressLastRenderedAt = 0;
      if (this.disposed) return;
      this.outputChannel.appendLine(
        formatCodexIndexDiagnostic({
          trigger,
          outcome: 'error',
          watcherEvents: diagnosticContext.watcherEvents,
          coalescedTriggers: diagnosticContext.coalescedTriggers,
          backfillMode: 'unknown',
          workerMode: 'unknown',
          indexedFiles: 0,
          totalFiles: 0,
          indexedBytes: 0,
          totalBytes: 0,
          periodMigratedBytes: 0,
          periodTotalBytes: 0,
          migrationPending: false,
          bodyReads: 0,
          failedFiles: 1,
          metadataMs: 0,
          parseMs: 0,
          qualityFlags: { 'refresh-failed': 1 },
        }),
      );
      this.syncProviderUi();
    } finally {
      this.activeCodexRefreshes.delete(operation);
    }
  }

  private async cancelCodexProviderAndWait(provider = this.codexProvider): Promise<void> {
    const lifecycleProvider = provider as CodexProvider & {
      cancelAndWait?: () => Promise<void>;
    };
    if (typeof lifecycleProvider.cancelAndWait === 'function') {
      await lifecycleProvider.cancelAndWait();
      return;
    }
    // Retains compatibility with narrow provider doubles while production
    // always uses the awaitable Codex provider lifecycle.
    provider.cancel();
  }

  private async runCodexRefresh(
    trigger: RefreshTrigger,
    diagnosticContext = this.takeCodexRefreshDiagnosticContext(),
  ): Promise<void> {
    if (this.disposed) return;
    let ownedBackfillLease: ResourceLease | undefined;
    let ownedWorkerLease: ResourceLease | undefined;
    let workerStoppedSafely = false;
    let continueHistoricalWork = false;
    const workerMode = codexRefreshProfileForTrigger(trigger);
    const config = this.getConfiguration();
    if (!config.codexEnabled) {
      await this.cancelCodexProviderAndWait();
      if (this.codexBackfillLease?.active) {
        await this.codexBackfillLease.stop('feature-disabled', () => undefined);
      }
      this.codexBackfillLease = undefined;
      if (this.codexWorkerLease?.active) {
        await this.codexWorkerLease.stop('feature-disabled', () => undefined);
      }
      this.codexWorkerLease = undefined;
      this.codexView = null;
      this.codexInsights = emptyCodexScopedInsights();
      this.codexAvailable = false;
      this.codexHasData = false;
      this.codexRefreshing = false;
      this.codexProgress = null;
      this.codexProgressLastRenderedAt = 0;
      this.syncProviderUi();
      return;
    }
    this.codexAvailable = await this.codexProvider.isAvailable();
    if (this.disposed) return;
    if (!this.codexAvailable) {
      this.codexView = null;
      this.codexInsights = emptyCodexScopedInsights();
      this.codexHasData = false;
      this.codexRefreshing = false;
      this.codexProgress = null;
      this.codexProgressLastRenderedAt = 0;
      this.syncProviderUi();
      return;
    }
    this.codexRefreshing = true;
    this.codexProgress = null;
    this.codexProgressLastRenderedAt = 0;
    this.syncProviderUi();
    const provider = this.codexProvider;
    this.codexCheckpointHydrationLastAttemptAt = Date.now();
    const persisted = await provider.loadPersistedSnapshot();
    if (this.disposed || provider !== this.codexProvider) {
      return;
    }
    if (persisted) {
      this.applyCodexSnapshot(persisted);
      if (this.codexBackgroundState.indexGeneration !== this.codexIndexGeneration(persisted)) {
        this.codexBackgroundState = createBackgroundWorkState({
          measurementVersion:
            ClaudeCodeUsageExtension.CODEX_BACKGROUND_MEASUREMENT_VERSION,
          reason: this.codexBackgroundReason(persisted),
          now: Date.now(),
          progress: this.codexBackgroundProgress(persisted),
          indexGeneration: this.codexIndexGeneration(persisted),
        });
        await this.saveCodexBackgroundState();
      }
      this.syncProviderUi();
    }
    if (!persisted && this.codexBackgroundState.status === 'complete') {
      this.codexBackgroundState = createBackgroundWorkState({
        measurementVersion:
          ClaudeCodeUsageExtension.CODEX_BACKGROUND_MEASUREMENT_VERSION,
        reason: 'first-index',
        now: Date.now(),
        indexGeneration: null,
      });
      await this.saveCodexBackgroundState();
    }
    const historicalPending = this.codexHistoricalWorkPending(persisted);
    let historicalAttempt = false;
    if (historicalPending) {
      const started = beginBackgroundWork(this.codexBackgroundState, {
        trigger: trigger === 'manual' ? 'manual' : 'automatic',
        now: Date.now(),
        reason: this.codexBackgroundReason(persisted),
      });
      this.codexBackgroundState = started.state;
      historicalAttempt = started.started;
      try {
        await this.saveCodexBackgroundState();
      } catch (error) {
        if (historicalAttempt && this.codexBackgroundState.status === 'running') {
          this.codexBackgroundState = interruptBackgroundWork(
            this.codexBackgroundState,
            { now: Date.now() },
          );
          await this.saveCodexBackgroundState().catch(() => undefined);
        }
        throw error;
      }
      if (historicalAttempt) {
        ownedBackfillLease = this.resourceOwnership.register({
          kind: 'backfill',
          capability: 'codex-history',
          scope: 'codex',
          creator: 'refresh-coordinator',
          stopConditions: [
            'settled',
            'completed',
            'cancelled',
            'feature-disabled',
            'extension-dispose',
            'user-pause',
            'settings-change',
          ],
          boundedException: persisted ? 'none' : 'first-codex-history',
        });
        this.codexBackfillLease = ownedBackfillLease;
        this.codexFirstBackfillActive = !persisted;
      }
    } else if (
      this.codexBackgroundState.status !== 'complete' &&
      this.codexBackgroundState.pausedReason !== 'corrupt-state' &&
      persisted
    ) {
      const fresh = createBackgroundWorkState({
        measurementVersion:
          ClaudeCodeUsageExtension.CODEX_BACKGROUND_MEASUREMENT_VERSION,
        reason: this.codexBackgroundReason(persisted),
        now: Date.now(),
        progress: this.codexBackgroundProgress(persisted),
        indexGeneration: this.codexIndexGeneration(persisted),
      });
      const running = beginBackgroundWork(fresh, {
        trigger: 'automatic',
        now: Date.now(),
      });
      if (running.started) {
        this.codexBackgroundState = recordBackgroundWorkProgress(running.state, {
          now: Date.now(),
          complete: true,
          progress: this.codexBackgroundProgress(persisted),
        });
        await this.saveCodexBackgroundState();
      }
    }
    // The trigger reason is visible while metadata discovery and the first
    // worker progress event are still pending.
    this.syncProviderUi();
    try {
      if (!this.codexWorkerLease?.active) {
        ownedWorkerLease = this.resourceOwnership.register({
          kind: 'worker',
          capability: 'codex-index',
          scope: 'codex',
          creator: 'codex-index-client',
          stopConditions: [
            'settled',
            'cancelled',
            'feature-disabled',
            'extension-dispose',
            'settings-change',
          ],
          boundedException: 'none',
        });
        this.codexWorkerLease = ownedWorkerLease;
        this.codexWorkerCancellationRequested = false;
      }
      const result = await provider.refresh(
        workerMode,
        (progress) => this.onCodexIndexProgress(progress),
        historicalAttempt,
      );
      workerStoppedSafely = true;
      if (this.disposed || provider !== this.codexProvider) {
        return;
      }
      if (result.outcome === 'unavailable') {
        this.codexView = null;
        this.codexInsights = emptyCodexScopedInsights();
        this.codexAvailable = false;
        this.codexHasData = false;
        return;
      }

      this.applyCodexSnapshot(result.snapshot);
      if (this.codexBackgroundState.indexGeneration !== this.codexIndexGeneration(result.snapshot)) {
        this.codexBackgroundState = createBackgroundWorkState({
          measurementVersion:
            ClaudeCodeUsageExtension.CODEX_BACKGROUND_MEASUREMENT_VERSION,
          reason: this.codexBackgroundReason(result.snapshot),
          now: Date.now(),
          progress: this.codexBackgroundProgress(result.snapshot),
          indexGeneration: this.codexIndexGeneration(result.snapshot),
        });
        await this.saveCodexBackgroundState();
      }
      if (historicalAttempt && this.codexBackgroundState.status === 'running') {
        const complete = !this.codexHistoricalWorkPending(result.snapshot);
        if (this.codexWorkerCancellationRequested || provider !== this.codexProvider) {
          this.codexBackgroundState = interruptBackgroundWork(
            this.codexBackgroundState,
            { now: Date.now() },
          );
        } else if (result.outcome === 'error' || (result.diagnostic?.failedFiles ?? 0) > 0) {
          this.codexBackgroundState = recordBackgroundWorkFailure(
            this.codexBackgroundState,
            { now: Date.now() },
          );
        } else {
          this.codexBackgroundState = recordBackgroundWorkProgress(
            this.codexBackgroundState,
            {
              now: Date.now(),
              complete,
              progress: this.codexBackgroundProgress(result.snapshot),
            },
          );
          continueHistoricalWork = this.codexBackgroundState.status === 'eligible';
        }
        await this.saveCodexBackgroundState();
      }
      const diagnostic = result.diagnostic;
      if (
        !historicalAttempt &&
        diagnostic?.indexRecovery &&
        this.codexBackgroundState.status === 'complete' &&
        this.codexHistoricalWorkPending(result.snapshot)
      ) {
        this.codexBackgroundState = createBackgroundWorkState({
          measurementVersion:
            ClaudeCodeUsageExtension.CODEX_BACKGROUND_MEASUREMENT_VERSION,
          reason: this.codexBackgroundReason(result.snapshot),
          now: Date.now(),
          progress: this.codexBackgroundProgress(result.snapshot),
          indexGeneration: this.codexIndexGeneration(result.snapshot),
        });
        await this.saveCodexBackgroundState();
        continueHistoricalWork = true;
      }
      this.outputChannel.appendLine(
        formatCodexIndexDiagnostic({
          trigger,
          outcome: result.outcome,
          watcherEvents: diagnosticContext.watcherEvents,
          coalescedTriggers: diagnosticContext.coalescedTriggers,
          backfillMode: historicalAttempt ? 'historical' : 'steady',
          workerMode,
          indexedFiles: result.snapshot.coverage.indexedFiles,
          totalFiles: result.snapshot.coverage.totalFiles,
          indexedBytes: result.snapshot.coverage.indexedBytes,
          totalBytes: result.snapshot.coverage.totalBytes,
          periodMigratedBytes:
            result.snapshot.coverage.period.allTime.migratedBytes,
          periodTotalBytes: result.snapshot.coverage.period.allTime.totalBytes,
          migrationPending: diagnostic?.migrationPending ?? false,
          indexRecovery: diagnostic?.indexRecovery?.reason,
          bodyReads: diagnostic?.bodyReads ?? 0,
          failedFiles: diagnostic?.failedFiles ?? 0,
          metadataMs: diagnostic?.metadataMs ?? 0,
          parseMs: diagnostic?.parseMs ?? 0,
          qualityFlags: result.snapshot.qualityFlags,
        }),
      );
    } finally {
      this.stopFirstBackfillBlurDeadline('cancelled');
      if (historicalAttempt && this.codexBackgroundState.status === 'running') {
        this.codexBackgroundState =
          this.codexWorkerCancellationRequested || provider !== this.codexProvider
          ? interruptBackgroundWork(this.codexBackgroundState, { now: Date.now() })
          : recordBackgroundWorkFailure(
              this.codexBackgroundState,
              { now: Date.now() },
            );
        await this.saveCodexBackgroundState();
      }
      if (workerStoppedSafely && ownedBackfillLease?.active) {
        const condition = this.codexBackgroundState.status === 'complete'
          ? 'completed'
          : 'settled';
        await ownedBackfillLease.stop(condition, () => undefined);
      }
      if (
        workerStoppedSafely &&
        this.codexBackfillLease === ownedBackfillLease
      ) {
        this.codexBackfillLease = undefined;
      }
      if (workerStoppedSafely && ownedWorkerLease?.active) {
        await ownedWorkerLease.stop(
          this.codexWorkerCancellationRequested || provider !== this.codexProvider
            ? 'cancelled'
            : 'settled',
          () => undefined,
        );
      }
      if (workerStoppedSafely && this.codexWorkerLease === ownedWorkerLease) {
        this.codexWorkerLease = undefined;
      }
      if (workerStoppedSafely && ownedBackfillLease) {
        this.codexFirstBackfillActive = false;
      }
      this.codexRefreshing = false;
      this.codexProgress = null;
      this.codexProgressLastRenderedAt = 0;
      if (!this.disposed) this.syncProviderUi();
      if (
        !this.disposed &&
        continueHistoricalWork &&
        provider === this.codexProvider &&
        this.getConfiguration().codexEnabled &&
        this.windowActivity.focused
      ) {
        queueMicrotask(() => void this.refreshCodexData(trigger));
      }
    }
  }

  private onCodexIndexProgress(progress: CodexIndexProgress): void {
    this.codexProgress = progress;
    this.scheduleCodexCheckpointHydration();
    const now = Date.now();
    if (
      this.codexProgressLastRenderedAt === 0 ||
      now - this.codexProgressLastRenderedAt >= 250
    ) {
      this.codexProgressLastRenderedAt = now;
      this.webviewProvider.updateCodexProgress({
        scannedFiles: progress.scannedFiles,
        totalFiles: progress.totalFiles,
        indexedBytes: progress.indexedBytes,
        totalBytes: progress.totalBytes,
        reason: this.codexBackgroundState.reason,
      });
    }
  }

  private applyCodexSnapshot(snapshot: CodexProviderSnapshot): void {
    this.codexView = buildCodexUsageView(snapshot);
    const capturedObservations = snapshot.weeklyValueInputs?.observations ?? [];
    const capturedQuotaFacts = codexQuotaCapturesFromWeeklyObservations(
      capturedObservations,
    );
    const previewStore = capturedQuotaFacts.length > 0
      ? mergeQuotaCaptures(this.quotaObservationStore, capturedQuotaFacts, {
          salt: this.quotaFingerprintSalt,
          now: capturedQuotaFacts.reduce(
            (latest, item) => Math.max(latest, item.observedAt),
            Date.now(),
          ),
        })
      : this.quotaObservationStore;
    const storedCodexObservations = quotaStoreWeeklyObservations(
      previewStore,
      'codex',
    );
    if (storedCodexObservations.length > 0 && this.codexView.weeklyValueInputs) {
      this.codexView.weeklyValueInputs = {
        ...this.codexView.weeklyValueInputs,
        observations: storedCodexObservations,
      };
    }
    this.codexInsights = buildScopedCodexInsights(this.codexView);
    this.codexAvailable = true;
    this.codexHasData = snapshot.coverage.totalFiles > 0;
    void this.recordCodexQuotaObservations(capturedObservations).catch(() => {
      // P1 remains readable when P2 is temporarily unavailable. The next
      // refresh retries the exact idempotent observation set.
    });
  }

  /** Adopt the first atomic checkpoint during a brand-new cold index. */
  private scheduleCodexCheckpointHydration(): void {
    if (
      this.codexView ||
      !this.codexRefreshing ||
      this.codexCheckpointHydration
    ) {
      return;
    }
    const now = Date.now();
    if (
      this.codexCheckpointHydrationLastAttemptAt > 0 &&
      now - this.codexCheckpointHydrationLastAttemptAt < 1_000
    ) {
      return;
    }
    this.codexCheckpointHydrationLastAttemptAt = now;
    const provider = this.codexProvider;
    const pending = provider.loadPersistedSnapshot()
      .then((snapshot) => {
        if (
          !snapshot ||
          provider !== this.codexProvider ||
          !this.codexRefreshing ||
          this.codexView
        ) {
          return;
        }
        this.applyCodexSnapshot(snapshot);
        this.syncProviderUi();
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.codexCheckpointHydration === pending) {
          this.codexCheckpointHydration = null;
        }
      });
    this.codexCheckpointHydration = pending;
  }

  // Settings whose change only affects the status bar (no dashboard reload).
  private static readonly STATUS_BAR_ONLY_SETTINGS = new Set([
    // usageLimitTracking is intentionally excluded: turning it on must trigger a
    // /usage fetch (the full reload path), else the quota stays empty until the
    // next tick.
    'showCost', 'showContext', 'statusBarMetric',
    'showScopedWeekly', 'quotaFiveHourOnly', 'showResetInStatusBar', 'resetCountdownFormat',
    'statusBarQuotaFormat', 'statusBarProvider', 'codex.statusMetric',
  ]);

  // Presentation-only dashboard toggles must not restart watchers, recreate
  // providers, or trigger a corpus reindex.
  private static readonly DASHBOARD_ONLY_SETTINGS = new Set([
    'showWeeklyEquivalentValue',
    'showProjectUsageMatrix',
  ]);

  // These values only reformat already-materialized USD estimates. They must
  // not restart file watchers, recreate providers, or rescan either corpus.
  private static readonly COST_DISPLAY_SETTINGS = new Set([
    'decimalPlaces', 'displayCurrency',
  ]);

  /** Dashboard Settings change — status-bar-only toggles apply in place, others reload. */
  private onSettingsChangedFromPanel(key?: string): void {
    if (this.disposed) return;
    if (key && ClaudeCodeUsageExtension.COST_DISPLAY_SETTINGS.has(key)) {
      const config = this.getConfiguration();
      this.applyFormattingConfiguration(config);
      this.webviewProvider.invalidateShareCardPreview();
      this.syncProviderUi();
      return;
    }
    if (key && ClaudeCodeUsageExtension.DASHBOARD_ONLY_SETTINGS.has(key)) {
      this.syncProviderUi();
      return;
    }
    if (key && ClaudeCodeUsageExtension.STATUS_BAR_ONLY_SETTINGS.has(key)) {
      const config = this.getConfiguration();
      this.statusBar.setVisibility(config.showCost, config.showContext, config.usageLimitTracking, config.statusBarMetric, config.showScopedWeekly, config.quotaFiveHourOnly, config.showResetInStatusBar, config.resetCountdownFormat, config.statusBarQuotaFormat);
      this.statusBar.updateQuota(this.cache.usageLimits ?? null);
      this.syncProviderUi();
      return;
    }
    this.onConfigurationChanged();
  }

  private trackCodexProviderRetirement(provider: CodexProvider): Promise<void> {
    let tracked!: Promise<void>;
    tracked = Promise.resolve()
      .then(() => provider.dispose())
      .catch((error: unknown) => {
        this.codexProviderRetirementFailure ??= error;
        throw error;
      })
      .finally(() => this.codexProviderRetirements.delete(tracked));
    this.codexProviderRetirements.add(tracked);
    void tracked.catch(() => undefined);
    return tracked;
  }

  private async waitForCodexProviderRetirements(): Promise<void> {
    while (this.codexProviderRetirements.size > 0) {
      await Promise.all([...this.codexProviderRetirements]);
    }
    if (this.codexProviderRetirementFailure) {
      throw this.codexProviderRetirementFailure;
    }
  }

  private async releaseCodexOwnership(
    condition: Extract<
      ResourceStopCondition,
      'cancelled' | 'feature-disabled' | 'extension-dispose' | 'settings-change'
    >,
  ): Promise<void> {
    if (this.codexWorkerLease?.active) {
      await this.codexWorkerLease.stop(condition, () => undefined);
    }
    if (this.codexBackfillLease?.active) {
      await this.codexBackfillLease.stop(condition, () => undefined);
    }
    this.codexWorkerLease = undefined;
    this.codexBackfillLease = undefined;
  }

  private onConfigurationChanged(): void {
    if (
      this.disposed ||
      this.clearingAllLocalData ||
      this.localDataClearedRequiresReload
    ) return;
    const generation = ++this.configurationGeneration;
    // Any endpoint/model/key/consent-affecting configuration change invalidates
    // a visible preview before a later click could send it.
    this.webviewProvider.invalidatePreparedAiRequests();
    void this.cancelAdviceNetworks('settings-change');
    this.stopQuotaColdRetry('settings-change');
    void this.cancelQuotaNetworks('settings-change');
    const config = this.getConfiguration();
    const pricingBackendChanged = this.activePricingBackend !== config.pricingBackend;
    this.activePricingBackend = config.pricingBackend;
    setPricingBackend(config.pricingBackend);
    if (pricingBackendChanged) {
      this.invalidateClaudeUsagePricingCache();
    }
    this.applyFormattingConfiguration(config);
    this.statusBar.setVisibility(config.showCost, config.showContext, config.usageLimitTracking, config.statusBarMetric, config.showScopedWeekly, config.quotaFiveHourOnly, config.showResetInStatusBar, config.resetCountdownFormat, config.statusBarQuotaFormat);

    // Restart auto-refresh with new interval
    this.startAutoRefresh();

    // Apply watcher-delay changes immediately, then refresh and re-attach.
    this.stopFileWatching();
    this.stopCodexWatching();
    this.stopCredentialsWatching();
    this.selectClaudeProfile(config.dataDirectory);
    const retiringCodexProvider = this.codexProvider;
    this.codexWorkerCancellationRequested = true;
    retiringCodexProvider.cancel();
    this.trackCodexProviderRetirement(retiringCodexProvider);
    this.codexProvider = this.createCodexProvider(config);
    if (!this.windowActivity.focused) {
      return;
    }
    void (async () => {
      try {
        await this.waitForCodexProviderRetirements();
        if (this.disposed || generation !== this.configurationGeneration) return;
        await this.releaseCodexOwnership('settings-change');
        await this.refreshData(true, 'settings');
        if (this.disposed || generation !== this.configurationGeneration) return;
        await this.startFileWatching();
        if (this.disposed || generation !== this.configurationGeneration) return;
        this.startCodexWatching();
        this.startCredentialsWatching();
      } catch {
        // A provider that cannot be terminated stays fail-closed. Disposal will
        // surface the retained failure instead of starting an unowned replacement.
      }
    })();
  }

  /**
   * Pricing is part of every cached UsageData aggregate. The incremental
   * loader normally skips unchanged JSONL files, so changing the pricing
   * backend would otherwise update only the displayed rate labels while
   * leaving totalCost/modelBreakdown.cost at the old rates.
   */
  private invalidateClaudeUsagePricingCache(): void {
    this.cache.claudeIndex = createClaudeUsageIndex();
    this.cache.records = [];
    this.cache.contentAnalysis = null;
    this.cache.manifest = null;
    this.cache.dataDirectory = null;
    this.cache.lastUpdate = new Date(0);
  }

  /** Keep quota credentials on the same Claude profile as this window's logs.
   * A profile switch invalidates every in-memory quota/backoff value because it
   * belongs to a different account. */
  private selectClaudeProfile(dataDirectory?: string | null): void {
    const nextClient = new ClaudeApiClient(
      this.outputChannel,
      dataDirectory,
      this.quotaFingerprintSalt,
    );
    if (nextClient.getCredentialsPath() === this.apiClient.getCredentialsPath()) {
      return;
    }
    this.stopQuotaColdRetry('profile-change');
    void this.cancelQuotaNetworks('profile-change');
    this.apiClient = nextClient;
    this.claudeProfileGeneration += 1;
    this.cache.usageLimits = null;
    this.cache.usageLimitsLastUpdate = new Date(0);
    this.cache.usageLimitsBackoffUntil = new Date(0);
    this.cache.usageLimitsFailStreak = 0;
    this.quotaColdRetryDone = false;
    this.statusBar.updateQuota(null);
    this.webviewProvider.updateQuota(null);
    this.claudeWeeklyQuotaHistory = [];
    this.activeClaudeQuotaFingerprint = fingerprintForStableIdentity(
      this.quotaFingerprintSalt,
      'claude',
      this.claudeProfileContinuitySignal(),
    );
    this.webviewProvider.updateWeeklyQuotaHistory([]);
    this.refreshQuotaObservationViews();
  }

  /**
   * Watch the Claude projects directory for new/changed jsonl lines so the
   * status bar reflects new usage within ~1.5 seconds instead of waiting for
   * the polling timer. Polling remains active while a failed watcher is
   * rearmed with bounded exponential backoff.
   */
  private watcherRecoveryState(provider: WatcherProvider): WatcherRecoveryState {
    if (provider === 'claude') {
      this.claudeWatcherRecovery ??= createWatcherRecoveryState();
      return this.claudeWatcherRecovery;
    }
    if (provider === 'codex') {
      this.codexWatcherRecovery ??= createWatcherRecoveryState();
      return this.codexWatcherRecovery;
    }
    this.credentialsWatcherRecovery ??= createWatcherRecoveryState();
    return this.credentialsWatcherRecovery;
  }

  private markWatcherHealthy(provider: WatcherProvider): void {
    const state = this.watcherRecoveryState(provider);
    if (state.timer) return;
    state.failureStreak = 0;
    state.lastFailureAt = 0;
  }

  private resetWatcherRecovery(
    provider: WatcherProvider,
    condition: Exclude<WatcherStopCondition, 'settled'>,
  ): void {
    const state = this.watcherRecoveryState(provider);
    const timer = state.timer;
    const lease = state.timerLease;
    state.timer = undefined;
    state.timerLease = undefined;
    state.failureStreak = 0;
    state.lastFailureAt = 0;
    if (!timer) return;
    if (lease?.active) {
      this.trackResourceStop(lease.stop(condition, () => clearTimeout(timer)));
    } else {
      clearTimeout(timer);
    }
  }

  private scheduleWatcherRecovery(
    provider: WatcherProvider,
    error: unknown,
  ): void {
    if (
      this.disposed ||
      this.localDataClearedRequiresReload ||
      !this.windowActivity.focused ||
      (provider === 'credentials' && !this.getConfiguration().usageLimitTracking)
    ) return;
    const state = this.watcherRecoveryState(provider);
    if (state.timer) return;
    const now = Date.now();
    if (
      state.lastFailureAt <= 0 ||
      now < state.lastFailureAt ||
      now - state.lastFailureAt > WATCHER_FAILURE_STREAK_RESET_MS
    ) {
      state.failureStreak = 0;
    }
    state.failureStreak += 1;
    state.lastFailureAt = now;
    const delayMs = watcherFailureBackoffMs(state.failureStreak);
    const rawCode = (error as NodeJS.ErrnoException | undefined)?.code;
    const code = typeof rawCode === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(rawCode)
      ? rawCode
      : 'watch-error';
    const label = provider === 'claude'
      ? 'Claude'
      : provider === 'codex'
        ? 'Codex'
        : 'Claude credentials';
    this.outputChannel.appendLine(
      `${label} file watcher stopped (${code}); retrying in ${delayMs / 1000}s; polling remains active.`,
    );

    const lease = this.resourceOwnership.register({
      kind: 'timer',
      capability: provider === 'claude'
        ? 'refresh'
        : provider === 'codex'
          ? 'codex-index'
          : 'quota',
      scope: provider === 'credentials' ? 'claude' : provider,
      creator: 'refresh-coordinator',
      stopConditions: [
        'settled',
        'cancelled',
        'window-blur',
        'feature-disabled',
        'extension-dispose',
        'settings-change',
        'profile-change',
      ],
      boundedException: 'none',
    });
    let timer!: NodeJS.Timeout;
    timer = setTimeout(() => {
      if (state.timer !== timer) return;
      state.timer = undefined;
      state.timerLease = undefined;
      if (lease.active) {
        this.trackResourceStop(lease.stop('settled', () => undefined));
      }
      if (
        this.disposed ||
        this.localDataClearedRequiresReload ||
        !this.windowActivity.focused ||
        (provider === 'credentials' && !this.getConfiguration().usageLimitTracking)
      ) return;
      if (provider === 'claude') {
        void this.startFileWatching(true);
      } else if (provider === 'codex') {
        this.startCodexWatching(true);
      } else {
        this.startCredentialsWatching(true);
      }
    }, delayMs);
    state.timer = timer;
    state.timerLease = lease;
  }

  private async startFileWatching(recoveryAttempt = false): Promise<void> {
    if (this.disposed || this.localDataClearedRequiresReload) return;
    if (!recoveryAttempt) {
      this.resetWatcherRecovery('claude', 'cancelled');
    }
    const requestGeneration = ++this.fileWatcherGeneration;
    if (!this.windowActivity.focused) {
      this.stopFileWatching('window-blur');
      return;
    }
    const config = this.getConfiguration();
    if (!(config.fileWatchSeconds > 0)) {
      this.stopFileWatching('feature-disabled'); // "Off"
      return;
    }
    let dataDirectory: string | null;
    try {
      dataDirectory = await ClaudeDataLoader.findClaudeDataDirectory(config.dataDirectory || undefined);
    } catch (error) {
      if (requestGeneration === this.fileWatcherGeneration) {
        this.scheduleWatcherRecovery('claude', error);
      }
      return;
    }
    if (
      this.disposed ||
      requestGeneration !== this.fileWatcherGeneration
    ) {
      return;
    }
    if (!this.windowActivity.focused) {
      this.stopFileWatching('window-blur');
      return;
    }
    const currentConfig = this.getConfiguration();
    if (
      !(currentConfig.fileWatchSeconds > 0) ||
      currentConfig.dataDirectory !== config.dataDirectory
    ) {
      return;
    }
    if (!dataDirectory) {
      return;
    }
    const projectsDir = path.join(dataDirectory, 'projects');
    if (!fs.existsSync(projectsDir) || this.watchedDir === projectsDir) {
      return;
    }
    this.closeFileWatcher('settings-change');
    const activeGeneration = this.fileWatcherGeneration;
    try {
      const watcher = fs.watch(projectsDir, { recursive: true }, (_event, filename) => {
        if (this.disposed || activeGeneration !== this.fileWatcherGeneration) return;
        this.markWatcherHealthy('claude');
        if (!filename || !String(filename).endsWith('.jsonl')) {
          return;
        }
        // Activity remains authoritative for quota TTL only; poll cadence
        // always follows refreshInterval.
        this.lastActivityAt = Date.now();
        this.watcherEventsSinceRefresh += 1;
        const delaySeconds = this.getConfiguration().fileWatchSeconds;
        if (!(delaySeconds > 0)) {
          this.stopFileWatching('feature-disabled');
          return;
        }
        this.watchDebounce.push(delaySeconds * 1000, () => {
          void this.refreshData(false, 'watch');
        });
      });
      this.fileWatcher = watcher;
      this.watchedDir = projectsDir;
      this.fileWatcherLease = this.resourceOwnership.register({
        kind: 'watcher',
        capability: 'refresh',
        scope: 'claude',
        creator: 'extension',
        stopConditions: [
          'window-blur',
          'feature-disabled',
          'extension-dispose',
          'settings-change',
          'profile-change',
          'cancelled',
        ],
        boundedException: 'none',
      });
      watcher.on('error', (error) => {
        if (this.fileWatcher !== watcher || activeGeneration !== this.fileWatcherGeneration) return;
        this.closeFileWatcher('cancelled');
        this.scheduleWatcherRecovery('claude', error);
      });
    } catch (error) {
      this.closeFileWatcher('cancelled');
      this.scheduleWatcherRecovery('claude', error);
    }
  }

  private closeFileWatcher(
    condition: Extract<
      ResourceStopCondition,
      'cancelled' | 'window-blur' | 'feature-disabled' | 'extension-dispose' | 'settings-change' | 'profile-change'
    > = 'settings-change',
  ): void {
    this.fileWatcherGeneration += 1;
    this.watchDebounce.clear();
    const watcher = this.fileWatcher;
    const lease = this.fileWatcherLease;
    this.fileWatcher = undefined;
    this.fileWatcherLease = undefined;
    if (watcher) {
      const close = (): void => {
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      };
      if (lease?.active) this.trackResourceStop(lease.stop(condition, close));
      else close();
    }
    this.watchedDir = null;
  }

  private stopFileWatching(
    condition: Extract<
      ResourceStopCondition,
      'cancelled' | 'window-blur' | 'feature-disabled' | 'extension-dispose' | 'settings-change' | 'profile-change'
    > = 'settings-change',
  ): void {
    this.resetWatcherRecovery('claude', condition);
    this.closeFileWatcher(condition);
  }

  private startCodexWatching(recoveryAttempt = false): void {
    if (this.disposed || this.localDataClearedRequiresReload) return;
    if (!recoveryAttempt) {
      this.resetWatcherRecovery('codex', 'cancelled');
    }
    if (!this.windowActivity.focused) {
      this.stopCodexWatching('window-blur');
      return;
    }
    const config = this.getConfiguration();
    if (!config.codexEnabled || !(config.codexFileWatchSeconds > 0)) {
      this.stopCodexWatching('feature-disabled');
      return;
    }
    const codexHome = this.codexHome(config);
    if (
      !recoveryAttempt &&
      this.codexWatchedHome === codexHome &&
      this.codexWatchers.length > 0
    ) {
      return;
    }
    this.closeCodexWatchers('settings-change');
    const activeGeneration = this.codexWatcherGeneration;
    let watchFailure: unknown;
    for (const child of ['sessions', 'archived_sessions']) {
      const directory = path.join(codexHome, child);
      if (!fs.existsSync(directory)) {
        continue;
      }
      try {
        const watcher = fs.watch(
          directory,
          { recursive: true },
          (_event, filename) => {
            if (this.disposed || activeGeneration !== this.codexWatcherGeneration) return;
            this.markWatcherHealthy('codex');
            if (!filename || !String(filename).endsWith('.jsonl')) {
              return;
            }
            const delaySeconds = this.getConfiguration().codexFileWatchSeconds;
            if (!(delaySeconds > 0)) {
              this.stopCodexWatching('feature-disabled');
              return;
            }
            this.codexWatcherEventsSinceRefresh += 1;
            if (this.codexWatchDebouncePending) {
              this.codexCoalescedTriggersSinceRefresh += 1;
            }
            this.codexWatchDebouncePending = true;
            this.codexWatchDebounce.push(delaySeconds * 1000, () => {
              this.codexWatchDebouncePending = false;
              void this.refreshCodexData('watch');
            });
          },
        );
        this.codexWatchers.push(watcher);
        watcher.on('error', (error) => {
          if (
            activeGeneration !== this.codexWatcherGeneration ||
            !this.codexWatchers.includes(watcher)
          ) return;
          this.closeCodexWatchers('cancelled');
          this.scheduleWatcherRecovery('codex', error);
        });
        this.codexWatcherLeases.set(watcher, this.resourceOwnership.register({
          kind: 'watcher',
          capability: 'codex-index',
          scope: 'codex',
          creator: 'extension',
          stopConditions: [
            'window-blur',
            'feature-disabled',
            'extension-dispose',
            'settings-change',
            'cancelled',
          ],
          boundedException: 'none',
        }));
      } catch (error) {
        watchFailure ??= error;
      }
    }
    this.codexWatchedHome =
      this.codexWatchers.length > 0 ? codexHome : null;
    if (watchFailure) {
      this.scheduleWatcherRecovery('codex', watchFailure);
    }
  }

  private closeCodexWatchers(
    condition: Extract<
      ResourceStopCondition,
      'cancelled' | 'window-blur' | 'feature-disabled' | 'extension-dispose' | 'settings-change'
    > = 'settings-change',
  ): void {
    this.codexWatcherGeneration += 1;
    this.codexWatchDebounce.clear();
    this.codexWatchDebouncePending = false;
    for (const watcher of this.codexWatchers) {
      const close = (): void => {
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      };
      const lease = this.codexWatcherLeases.get(watcher);
      if (lease?.active) this.trackResourceStop(lease.stop(condition, close));
      else close();
    }
    this.codexWatchers = [];
    this.codexWatcherLeases.clear();
    this.codexWatchedHome = null;
  }

  private stopCodexWatching(
    condition: Extract<
      ResourceStopCondition,
      'cancelled' | 'window-blur' | 'feature-disabled' | 'extension-dispose' | 'settings-change'
    > = 'settings-change',
  ): void {
    this.resetWatcherRecovery('codex', condition);
    this.closeCodexWatchers(condition);
  }

  /**
   * Watch the OAuth credentials file so switching Claude accounts updates the
   * quota promptly. Without this, the quota stays on the previous account's
   * numbers for up to a full TTL (120 s) — long enough to read as "stuck on the
   * wrong account, only a window reload fixes it" (#45). On a change we drop the
   * cached quota and refetch; the api client re-reads the new token. Watches the
   * parent dir (the file is rewritten/replaced, which single-file watches miss)
   * and filters by name. macOS Keychain-stored credentials have no file to
   * watch — those still self-correct on the next refresh tick.
   */
  private startCredentialsWatching(recoveryAttempt = false): void {
    if (this.disposed || this.localDataClearedRequiresReload) return;
    if (!recoveryAttempt) {
      this.resetWatcherRecovery('credentials', 'cancelled');
    }
    if (!this.windowActivity.focused) {
      this.stopCredentialsWatching('window-blur');
      return;
    }
    if (!this.getConfiguration().usageLimitTracking) {
      this.stopCredentialsWatching('feature-disabled');
      return;
    }
    this.closeCredentialsWatcher('settings-change');
    const credsPath = this.apiClient.getCredentialsPath();
    const dir = path.dirname(credsPath);
    const name = path.basename(credsPath);
    if (!fs.existsSync(dir)) {
      if (recoveryAttempt) {
        // The profile can disappear briefly during an atomic login/profile
        // replacement. Keep the existing bounded recovery chain alive without
        // logging the private path or adding a second polling mechanism.
        this.scheduleWatcherRecovery('credentials', { code: 'ENOENT' });
      }
      return;
    }
    try {
      const activeGeneration = this.credentialsWatcherGeneration;
      const watcher = fs.watch(dir, (_event, filename) => {
        if (this.disposed || activeGeneration !== this.credentialsWatcherGeneration) return;
        this.markWatcherHealthy('credentials');
        if (!filename) {
          this.credentialsWatcherMissingFilenameEventsSinceRefresh += 1;
        }
        if (filename && String(filename) !== name) {
          return;
        }
        if (this.credsDebounceTimer) {
          const timer = this.credsDebounceTimer;
          const timerLease = this.credsDebounceTimerLease;
          this.credsDebounceTimer = undefined;
          this.credsDebounceTimerLease = undefined;
          if (timerLease?.active) {
            this.trackResourceStop(
              timerLease.stop('cancelled', () => clearTimeout(timer)),
            );
          } else {
            clearTimeout(timer);
          }
        }
        this.credsDebounceTimer = setTimeout(() => {
          const timerLease = this.credsDebounceTimerLease;
          this.credsDebounceTimer = undefined;
          this.credsDebounceTimerLease = undefined;
          if (timerLease?.active) {
            this.trackResourceStop(timerLease.stop('settled', () => undefined));
          }
          if (!this.disposed && activeGeneration === this.credentialsWatcherGeneration) {
            this.handleCredentialsChange();
          }
        }, 800);
        this.credsDebounceTimerLease = this.resourceOwnership.register({
          kind: 'timer',
          capability: 'quota',
          scope: 'claude',
          creator: 'extension',
          stopConditions: [
            'settled',
            'cancelled',
            'window-blur',
            'feature-disabled',
            'extension-dispose',
            'settings-change',
            'profile-change',
          ],
          boundedException: 'none',
        });
      });
      this.credsWatcher = watcher;
      watcher.on('error', (error) => {
        if (
          this.credsWatcher !== watcher ||
          activeGeneration !== this.credentialsWatcherGeneration
        ) return;
        this.closeCredentialsWatcher('cancelled');
        this.scheduleWatcherRecovery('credentials', error);
      });
      this.credsWatcherLease = this.resourceOwnership.register({
        kind: 'watcher',
        capability: 'quota',
        scope: 'claude',
        creator: 'extension',
        stopConditions: [
          'window-blur',
          'feature-disabled',
          'extension-dispose',
          'settings-change',
          'profile-change',
          'cancelled',
        ],
        boundedException: 'none',
      });
    } catch (error) {
      this.closeCredentialsWatcher('cancelled');
      this.scheduleWatcherRecovery('credentials', error);
    }
  }

  private handleCredentialsChange(): void {
    // The cached quota and any failure backoff belong to the previous
    // token/account. Clear both so a successful re-login retries immediately.
    this.cache.usageLimitsLastUpdate = new Date(0);
    this.cache.usageLimitsFailStreak = 0;
    this.cache.usageLimitsBackoffUntil = new Date(0);
    this.claudeProfileGeneration += 1;
    this.activeClaudeQuotaFingerprint = undefined;
    this.claudeWeeklyQuotaHistory = [];
    this.webviewProvider.updateWeeklyQuotaHistory([]);
    void this.refreshData(false, 'credentials');
  }

  private closeCredentialsWatcher(
    condition: Extract<
      ResourceStopCondition,
      | 'cancelled'
      | 'window-blur'
      | 'feature-disabled'
      | 'extension-dispose'
      | 'settings-change'
      | 'profile-change'
    > = 'settings-change',
  ): void {
    this.credentialsWatcherGeneration += 1;
    if (this.credsDebounceTimer) {
      const timer = this.credsDebounceTimer;
      const lease = this.credsDebounceTimerLease;
      this.credsDebounceTimer = undefined;
      this.credsDebounceTimerLease = undefined;
      if (lease?.active) {
        this.trackResourceStop(lease.stop(condition, () => clearTimeout(timer)));
      }
      else clearTimeout(timer);
    }
    const watcher = this.credsWatcher;
    const lease = this.credsWatcherLease;
    this.credsWatcher = undefined;
    this.credsWatcherLease = undefined;
    if (watcher) {
      const close = (): void => {
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      };
      if (lease?.active) this.trackResourceStop(lease.stop(condition, close));
      else close();
    }
  }

  private stopCredentialsWatching(
    condition: Extract<
      ResourceStopCondition,
      | 'window-blur'
      | 'feature-disabled'
      | 'extension-dispose'
      | 'settings-change'
      | 'profile-change'
    > = 'settings-change',
  ): void {
    this.resetWatcherRecovery('credentials', condition);
    this.closeCredentialsWatcher(condition);
  }

  /** True when Claude Code has written a log line in the last 60 s. */
  private isActive(): boolean {
    return Date.now() - this.lastActivityAt < 60000;
  }

  private suspendRecurringWork(): void {
    this.stopAutoRefresh('window-blur');
    this.stopQuotaColdRetry('window-blur');
    void this.cancelQuotaNetworks('window-blur');
    this.stopFileWatching('window-blur');
    this.stopCodexWatching('window-blur');
    this.stopCredentialsWatching('window-blur');
    if (this.codexRefreshing && this.codexFirstBackfillActive) {
      this.scheduleFirstBackfillBlurDeadline();
    } else if (this.codexRefreshing) {
      this.codexWorkerCancellationRequested = true;
      void this.cancelCodexProviderAndWait();
    }
  }

  private resumeRecurringWork(): void {
    if (this.disposed || this.localDataClearedRequiresReload) return;
    this.stopFirstBackfillBlurDeadline('cancelled');
    this.startAutoRefresh();
    void this.startFileWatching();
    this.startCodexWatching();
    this.startCredentialsWatching();
    void this.refreshData(false, 'focus');
  }

  private handleWindowFocusChange(focused: boolean): void {
    if (this.disposed) return;
    const transition = this.windowActivity.update(focused);
    if (transition === 'suspend') {
      this.suspendRecurringWork();
    } else if (transition === 'resume') {
      this.resumeRecurringWork();
    }
  }

  private stopFirstBackfillBlurDeadline(
    condition: Extract<ResourceStopCondition, 'window-blur' | 'cancelled' | 'extension-dispose'> = 'cancelled',
  ): void {
    const timer = this.codexFirstBackfillBlurTimer;
    const lease = this.codexFirstBackfillBlurTimerLease;
    this.codexFirstBackfillBlurTimer = undefined;
    this.codexFirstBackfillBlurTimerLease = undefined;
    if (!timer) return;
    if (lease?.active) {
      this.trackResourceStop(lease.stop(condition, () => clearTimeout(timer)));
    } else {
      clearTimeout(timer);
    }
  }

  private scheduleFirstBackfillBlurDeadline(): void {
    if (
      this.disposed ||
      !this.codexRefreshing ||
      !this.codexFirstBackfillActive ||
      this.codexFirstBackfillBlurTimer
    ) return;
    const lease = this.resourceOwnership.register({
      kind: 'timer',
      capability: 'codex-history',
      scope: 'codex',
      creator: 'refresh-coordinator',
      stopConditions: ['window-blur', 'cancelled', 'extension-dispose'],
      boundedException: 'none',
    });
    const timer = setTimeout(() => {
      this.codexFirstBackfillBlurTimer = undefined;
      this.codexFirstBackfillBlurTimerLease = undefined;
      if (lease.active) {
        this.trackResourceStop(lease.stop('cancelled', () => undefined));
      }
      if (this.disposed || !this.codexRefreshing || !this.codexFirstBackfillActive) return;
      this.codexWorkerCancellationRequested = true;
      void this.cancelCodexProviderAndWait();
    }, ClaudeCodeUsageExtension.CODEX_FIRST_BACKFILL_BLUR_DEADLINE_MS);
    this.codexFirstBackfillBlurTimer = timer;
    this.codexFirstBackfillBlurTimerLease = lease;
  }

  /** Keep recurring work only in the active VS Code window. Each window owns a
   * separate Extension Host, so leaving timers and both provider watchers active
   * in every background window multiplies the same local scans. A focused window
   * catches up immediately; a background window stays idle until then. */
  private startWindowFocusRefresh(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (this.disposed) return;
        this.handleWindowFocusChange(state.focused);
      })
    );
  }

  private stopAutoRefresh(
    condition: Extract<
      ResourceStopCondition,
      'window-blur' | 'extension-dispose' | 'settings-change'
    > = 'settings-change',
  ): void {
    this.refreshGen += 1;
    const timer = this.refreshTimer;
    const lease = this.refreshTimerLease;
    this.refreshTimer = undefined;
    this.refreshTimerLease = undefined;
    if (timer) {
      if (lease?.active) {
        this.trackResourceStop(lease.stop(condition, () => clearTimeout(timer)));
      }
      else clearTimeout(timer);
    }
  }

  private startAutoRefresh(): void {
    if (this.disposed || this.localDataClearedRequiresReload) return;
    this.stopAutoRefresh();
    if (!this.windowActivity.focused) {
      return;
    }
    const gen = this.refreshGen;
    const tick = (): void => {
      if (this.disposed || gen !== this.refreshGen) {
        return; // superseded by a newer startAutoRefresh — stop this chain
      }
      const intervalMs = pollIntervalMs(this.getConfiguration().refreshInterval);
      this.refreshTimer = setTimeout(() => {
        const timerLease = this.refreshTimerLease;
        this.refreshTimer = undefined;
        this.refreshTimerLease = undefined;
        if (timerLease?.active) {
          this.trackResourceStop(timerLease.stop('settled', () => undefined));
        }
        if (this.disposed || gen !== this.refreshGen) return;
        this.refreshData(false, 'poll').finally(() => {
          if (!this.disposed && gen === this.refreshGen) {
            tick();
          }
        });
      }, intervalMs);
      this.refreshTimerLease = this.resourceOwnership.register({
        kind: 'timer',
        capability: 'refresh',
        scope: 'extension',
        creator: 'refresh-coordinator',
        stopConditions: [
          'settled',
          'window-blur',
          'extension-dispose',
          'settings-change',
        ],
        boundedException: 'none',
      });
    };
    tick();
  }

  /** Fetch real usage limits via OAuth, cached in memory for at most two
   * minutes. Durable history contains only schema-2 normalized observations;
   * the raw OAuth response is never retained by the extension. */
  private claudeProfileContinuitySignal(): string {
    return `profile-path-v1|${this.apiClient.getCredentialsPath()}`;
  }

  private refreshQuotaObservationViews(): void {
    this.claudeWeeklyQuotaHistory = this.activeClaudeQuotaFingerprint
      ? quotaStoreWeeklyObservations(
          this.quotaObservationStore,
          'claude',
          this.activeClaudeQuotaFingerprint,
        )
      : [];
    this.webviewProvider.updateWeeklyQuotaHistory(this.claudeWeeklyQuotaHistory);
    if (this.codexView?.weeklyValueInputs) {
      this.codexView.weeklyValueInputs = {
        ...this.codexView.weeklyValueInputs,
        observations: quotaStoreWeeklyObservations(
          this.quotaObservationStore,
          'codex',
        ),
      };
    }
  }

  private async recordClaudeQuotaObservation(
    usage: ClaudeApiUsageResponse,
    observedAt: number,
  ): Promise<void> {
    const verifiedSignal = this.apiClient.getLastQuotaIdentitySignal();
    const identitySignal = verifiedSignal ?? this.claudeProfileContinuitySignal();
    const accountAttribution = verifiedSignal
      ? 'verified-local-signal' as const
      : 'profile-continuity' as const;
    const additions = claudeQuotaCapturesFromUsage(
      usage,
      identitySignal,
      accountAttribution,
      observedAt,
    );
    if (additions.length === 0) return;
    this.quotaObservationStore = await this.quotaObservationRepository.append(
      additions,
    );
    this.activeClaudeQuotaFingerprint = fingerprintForStableIdentity(
      this.quotaFingerprintSalt,
      'claude',
      identitySignal,
    );
    this.refreshQuotaObservationViews();
  }

  private async recordCodexQuotaObservations(
    observations: readonly WeeklyQuotaObservation[],
  ): Promise<void> {
    const additions = codexQuotaCapturesFromWeeklyObservations(observations);
    if (additions.length === 0) {
      this.refreshQuotaObservationViews();
      return;
    }
    this.quotaObservationStore = await this.quotaObservationRepository.append(
      additions,
    );
    this.refreshQuotaObservationViews();
    if (!this.disposed) this.syncProviderUi();
  }

  private async maybeFetchUsageLimits(config: ExtensionConfig): Promise<ClaudeApiUsageResponse | null> {
    if (
      this.disposed ||
      this.localDataClearedRequiresReload ||
      !config.usageLimitTracking
    ) {
      return null;
    }
    const now = Date.now();
    // While backing off after a 429, return the cached value without refetching.
    if (now < this.cache.usageLimitsBackoffUntil.getTime()) {
      return this.cache.usageLimits;
    }
    const age = Date.now() - this.cache.usageLimitsLastUpdate.getTime();
    // Activity-aware cache: 20 s while Claude Code is actively writing (so the
    // quota keeps pace during high-consumption ultracode runs), 120 s when
    // idle (avoids hammering /usage on every file-watch tick). The /usage
    // client has its own 429 cool-down, so 20 s is safe.
    // Quota changes slowly (a coarse %), and /usage is an undocumented
    // endpoint that 429s if hit too often. Keep this well above the local
    // refresh cadence: 60 s while active, 120 s idle. Local cost still updates
    // every ~8 s via the fs watcher — only the quota number is throttled.
    const ttl = this.isActive() ? 60000 : 120000;
    // Bypass the cache when a cached window has already reset — otherwise the
    // status bar would show the rolled-forward 0% estimate for up to a full
    // TTL before the real new-window value arrives.
    if (this.cache.usageLimits && age < ttl && !this.hasExpiredWindow(this.cache.usageLimits)) {
      return this.cache.usageLimits;
    }
    const profileGeneration = this.claudeProfileGeneration;
    const apiClient = this.apiClient;
    const controller = new AbortController();
    const quotaNetworkLease = this.resourceOwnership.register({
      kind: 'network',
      capability: 'quota',
      scope: 'claude',
      creator: 'claude-api-client',
      stopConditions: [
        'settled',
        'cancelled',
        'window-blur',
        'feature-disabled',
        'extension-dispose',
        'settings-change',
        'profile-change',
      ],
      boundedException: 'none',
    });
    let markSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    this.activeQuotaNetworks.set(controller, {
      lease: quotaNetworkLease,
      settled,
    });
    let fetched: ClaudeApiUsageResponse | null;
    try {
      fetched = await apiClient.fetchUsageLimits(controller.signal);
    } finally {
      this.activeQuotaNetworks.delete(controller);
      markSettled();
      if (quotaNetworkLease.active) {
        await quotaNetworkLease.stop(
          controller.signal.aborted ? 'cancelled' : 'settled',
          () => undefined,
        );
      }
    }
    if (controller.signal.aborted) {
      return this.cache.usageLimits;
    }
    if (
      profileGeneration !== this.claudeProfileGeneration ||
      apiClient !== this.apiClient
    ) {
      // A slower request from the previously selected profile must never
      // overwrite the new account's in-memory or persisted quota snapshot.
      return this.cache.usageLimits;
    }
    if (fetched) {
      const observedAt = Date.now();
      this.cache.usageLimits = fetched;
      this.cache.usageLimitsLastUpdate = new Date();
      this.cache.usageLimitsFailStreak = 0;
      // Even on success, hold off /usage for 30s — this floor also covers the
      // expired-window bypass so a just-rolled window can't trigger an immediate
      // refetch.
      this.cache.usageLimitsBackoffUntil = new Date(Date.now() + 30000);
      await this.recordClaudeQuotaObservation(fetched, observedAt);
      return fetched;
    }
    // Failed (usually a 429 or invalid/expired credentials). Exponentially back
    // off to one hour; a credentials-file change clears this immediately.
    this.cache.usageLimitsFailStreak++;
    const backoffMs = quotaFailureBackoffMs(this.cache.usageLimitsFailStreak);
    this.cache.usageLimitsBackoffUntil = new Date(now + backoffMs);
    return this.cache.usageLimits;
  }

  /** True if any usage window's reset time has already passed (so the cached
   * utilisation is stale and a refetch is warranted). */
  private hasExpiredWindow(u: ClaudeApiUsageResponse): boolean {
    const now = Date.now();
    // Via the normalizer so scoped weekly caps count too: those live only in the
    // generic `limits` array, and a stale one is just as much a reason to refetch.
    return normalizeQuotaWindows(u).some((w) => {
      const t = Date.parse(w.resetsAt);
      return !isNaN(t) && t <= now;
    });
  }

  private async refreshData(
    forceReload: boolean = false,
    trigger: RefreshTrigger = 'poll'
  ): Promise<void> {
    if (this.disposed || this.localDataClearedRequiresReload) return;
    // `watch` reaches this shared path only from the Claude projects watcher.
    // Codex has its own watcher and quiet-delay setting, so refreshing it here
    // would bypass codex.fileWatchSeconds whenever Claude writes a JSONL line.
    if (trigger !== 'watch') {
      void this.refreshCodexData(trigger);
    }
    const request = this.refreshGate.request(forceReload, trigger);
    if (request === null) {
      this.coalescedTriggersSinceRefresh += 1;
      return;
    }
    await this.runRefresh(request);
  }

  private handleColdRefreshFailure(updateWebview: boolean): void {
    reportColdRefreshFailure({
      hasLoadedManifest: this.cache.manifest !== null,
      updateWebview,
      error: I18n.t.statusBar.refreshFailed,
      onStatusError: (error) => {
        this.statusBar.updateUsageData(null, null, error);
        this.statusBar.updateContext(null);
      },
      onWebviewError: (error) => {
        this.webviewProvider.updateData(null, null, null, null, [], [], [], error, null);
      },
    });
  }

  private async runRefresh(request: RefreshRequest): Promise<void> {
    const totalStarted = performance.now();
    const watcherEvents = this.watcherEventsSinceRefresh ?? 0;
    const coalescedTriggers = this.coalescedTriggersSinceRefresh ?? 0;
    const quotaWatcherMissingFilenameEvents =
      this.credentialsWatcherMissingFilenameEventsSinceRefresh ?? 0;
    this.watcherEventsSinceRefresh = 0;
    this.coalescedTriggersSinceRefresh = 0;
    this.credentialsWatcherMissingFilenameEventsSinceRefresh = 0;
    let updateWebview = request.trigger === 'manual';
    try {
      if (this.disposed) return;
      const config = this.getConfiguration();
      const snapshotNow = new Date(Date.now());
      updateWebview = updateWebview || config.dashboardAutoRefresh;

      // Account quota is independent from local JSONL. Do not let a slow OAuth
      // request delay the local usage refresh.
      void this.maybeFetchUsageLimits(config).then((limits) => {
        if (this.disposed) return;
        this.statusBar.updateQuota(limits);
        this.webviewProvider.updateQuota(limits);
        if (!limits && !this.cache.usageLimits && !this.quotaColdRetryDone) {
          this.quotaColdRetryDone = true;
          this.scheduleQuotaColdRetry();
        }
      }).catch(() => undefined);

      const dataDirectory = await ClaudeDataLoader.findClaudeDataDirectory(
        config.dataDirectory || undefined
      );
      if (this.disposed) return;
      if (!dataDirectory) {
        const error = 'Claude data directory not found. Please check your configuration.';
        this.statusBar.updateUsageData(null, null, error);
        this.statusBar.updateContext(null);
        if (updateWebview) {
          this.webviewProvider.updateData(null, null, null, null, [], [], [], error, null);
        }
        this.outputChannel.appendLine(formatRefreshDiagnostic({
          trigger: request.trigger,
          filesDiscovered: 0,
          filesChanged: 0,
          filesReused: 0,
          filesRemoved: 0,
          filesFailed: 0,
          bytesRead: 0,
          linesParsed: 0,
          watcherEvents,
          coalescedTriggers,
          quotaWatcherMissingFilenameEvents,
          manifestMs: 0,
          readParseMs: 0,
          aggregateRenderMs: 0,
          totalMs: performance.now() - totalStarted,
        }));
        return;
      }

      const manifestStarted = performance.now();
      const manifest = await scanUsageManifest([dataDirectory]);
      const delta = diffUsageManifests(this.cache.manifest, manifest);
      const manifestMs = performance.now() - manifestStarted;
      const directoryChanged = this.cache.dataDirectory !== dataDirectory;
      const needFullRefresh = shouldReloadUsage({
        forceReload: request.forceReload,
        directoryChanged,
        hasLoadedManifest: this.cache.manifest !== null,
        changedFiles: delta.changed.length,
        removedFiles: delta.removed.length,
      });

      if (!needFullRefresh) {
        const materialized = claudeUsageDashboardSnapshot(this.cache.claudeIndex, {
          workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          projectGroupingMode: config.projectGroupingMode,
          contextWindowOverride: config.contextWindowOverride,
          now: snapshotNow,
        });
        this.statusBar.updateContext(materialized.context);
        const timeZone = this.cache.claudeIndex.timeZone;
        const publishedDay = dayKeyInZone(this.cache.lastUpdate, timeZone);
        const snapshotDay = dayKeyInZone(snapshotNow, timeZone);
        const dayRolledOver =
          this.cache.lastUpdate.getTime() > 0 &&
          publishedDay !== snapshotDay;
        if (dayRolledOver && this.cache.records.length > 0) {
          this.statusBar.updateUsageData(
            materialized.today,
            materialized.workspaceToday,
            undefined,
            undefined,
            materialized.month,
          );
          if (updateWebview) {
            this.webviewProvider.updateData(
              materialized.session,
              materialized.today,
              materialized.last30Days,
              materialized.allTime,
              materialized.dailyForLast30Days,
              materialized.monthlyForAllTime,
              materialized.hourlyForToday,
              undefined,
              dataDirectory,
              this.cache.records,
              materialized.sessions,
              materialized.projects,
              this.cache.contentAnalysis,
              materialized.branches,
              materialized.workflows,
              materialized.costliestMessages,
              materialized.hourlyForLast30DaysByDay,
              materialized.projectUsageMatrix,
            );
          }
          this.cache.lastUpdate = new Date(snapshotNow.getTime());
        }
        this.cache.manifest = manifest;
        this.cache.dataDirectory = dataDirectory;
        this.outputChannel.appendLine(formatRefreshDiagnostic({
          trigger: request.trigger,
          filesDiscovered: manifest.entries.size,
          filesChanged: 0,
          filesReused: delta.reused.length,
          filesRemoved: 0,
          filesFailed: 0,
          bytesRead: 0,
          linesParsed: 0,
          watcherEvents,
          coalescedTriggers,
          quotaWatcherMissingFilenameEvents,
          manifestMs,
          readParseMs: 0,
          aggregateRenderMs: 0,
          totalMs: performance.now() - totalStarted,
        }));
        return;
      }

      // A non-null manifest, not records.length, distinguishes a cold load from
      // a successfully loaded empty corpus.
      if (this.cache.manifest === null) {
        this.statusBar.setLoading(true);
        if (updateWebview) {
          this.webviewProvider.setLoading(true);
        }
      }

      const baseIndex = directoryChanged
        ? createClaudeUsageIndex()
        : this.cache.claudeIndex;
      const loaded = await updateClaudeUsageIndex(baseIndex, dataDirectory, {
        analyzeContent: config.enableContentAnalysis,
        windowDays: config.advicePromptWindowDays,
        manifest,
        log: (line) => this.outputChannel.appendLine(
          `[${new Date().toLocaleTimeString(undefined, { hour12: false })}] ${line}`
        ),
      });
      if (!shouldCommitUsageLoad(loaded.diagnostics.filesFailed)) {
        this.handleColdRefreshFailure(updateWebview);
        this.outputChannel.appendLine(formatRefreshDiagnostic({
          trigger: request.trigger,
          filesDiscovered: manifest.entries.size,
          filesChanged: delta.changed.length,
          filesReused: delta.reused.length,
          filesRemoved: delta.removed.length,
          filesFailed: loaded.diagnostics.filesFailed,
          bytesRead: loaded.diagnostics.bytesRead,
          linesParsed: loaded.diagnostics.linesParsed,
          bodyReads: loaded.diagnostics.bodyReads,
          aggregateMutations: loaded.diagnostics.aggregateMutations,
          watcherEvents,
          coalescedTriggers,
          quotaWatcherMissingFilenameEvents,
          manifestMs,
          readParseMs: loaded.diagnostics.readParseMs,
          aggregateRenderMs: 0,
          totalMs: performance.now() - totalStarted,
        }));
        return;
      }

      const aggregateStarted = performance.now();
      const records = loaded.records;
      const contentAnalysis = loaded.contentAnalysis;

      if (records.length === 0) {
        const error = 'No usage records found. Make sure Claude Code is running.';
        this.statusBar.updateUsageData(null, null, error);
        this.statusBar.updateContext(null);
        if (updateWebview) {
          this.webviewProvider.updateData(null, null, null, null, [], [], [], error, dataDirectory);
        }
      } else {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const materialized = claudeUsageDashboardSnapshot(loaded.index, {
          workspacePath,
          projectGroupingMode: config.projectGroupingMode,
          contextWindowOverride: config.contextWindowOverride,
          now: snapshotNow,
        });
        const sessionData = materialized.session;
        const todayData = materialized.today;
        const workspaceTodayData = materialized.workspaceToday;
        const calendarMonthData = materialized.month;
        const rolling30Data = materialized.last30Days;
        const allTimeData = materialized.allTime;
        const dailyDataForRolling30 = materialized.dailyForLast30Days;
        const dailyDataForAllTime = materialized.monthlyForAllTime;
        const hourlyDataForToday = materialized.hourlyForToday;
        const hourlyDataForRolling30DaysByDay = materialized.hourlyForLast30DaysByDay;
        const sessionBreakdown = materialized.sessions;
        const projectBreakdown = materialized.projects;
        const branchBreakdown = materialized.branches;
        const workflowBreakdown = materialized.workflows;
        const costliestMessages = materialized.costliestMessages;

        // The status bar setting is explicitly "monthly cost" and therefore
        // keeps calendar-month semantics. The dashboard's middle range is the
        // more useful rolling 30-day view and receives a separate aggregate.
        this.statusBar.updateUsageData(todayData, workspaceTodayData, undefined, undefined, calendarMonthData);
        this.statusBar.updateContext(materialized.context);
        if (updateWebview) {
          this.webviewProvider.updateData(sessionData, todayData, rolling30Data, allTimeData, dailyDataForRolling30, dailyDataForAllTime, hourlyDataForToday, undefined, dataDirectory, records, sessionBreakdown, projectBreakdown, contentAnalysis, branchBreakdown, workflowBreakdown, costliestMessages, hourlyDataForRolling30DaysByDay, materialized.projectUsageMatrix);
        }
      }

      const aggregateRenderMs = performance.now() - aggregateStarted;
      commitRefreshSnapshot(
        manifest,
        { records, contentAnalysis },
        loaded.diagnostics.filesFailed,
        (nextManifest, snapshot) => {
          this.cache.records = snapshot.records;
          this.cache.contentAnalysis = snapshot.contentAnalysis;
          this.cache.claudeIndex = loaded.index;
          this.cache.manifest = nextManifest;
          this.cache.dataDirectory = dataDirectory;
          this.cache.lastUpdate = new Date(snapshotNow.getTime());
        }
      );
      this.outputChannel.appendLine(formatRefreshDiagnostic({
        trigger: request.trigger,
        filesDiscovered: manifest.entries.size,
        filesChanged: delta.changed.length,
        filesReused: delta.reused.length,
        filesRemoved: delta.removed.length,
        filesFailed: loaded.diagnostics.filesFailed,
        bytesRead: loaded.diagnostics.bytesRead,
        linesParsed: loaded.diagnostics.linesParsed,
        bodyReads: loaded.diagnostics.bodyReads,
        aggregateMutations: loaded.diagnostics.aggregateMutations,
        watcherEvents,
        coalescedTriggers,
        quotaWatcherMissingFilenameEvents,
        manifestMs,
        readParseMs: loaded.diagnostics.readParseMs,
        aggregateRenderMs,
        totalMs: performance.now() - totalStarted,
      }));
    } catch {
      // Keep the previous records and manifest authoritative. The next trigger
      // retries scanner/reconciliation failures instead of presenting no data.
      this.handleColdRefreshFailure(updateWebview);
      this.outputChannel.appendLine(formatRefreshDiagnostic({
        trigger: request.trigger,
        filesDiscovered: 0,
        filesChanged: 0,
        filesReused: 0,
        filesRemoved: 0,
        filesFailed: 1,
        bytesRead: 0,
        linesParsed: 0,
        watcherEvents,
        coalescedTriggers,
        quotaWatcherMissingFilenameEvents,
        manifestMs: 0,
        readParseMs: 0,
        aggregateRenderMs: 0,
        totalMs: performance.now() - totalStarted,
      }));
    } finally {
      if (!this.disposed) this.syncProviderUi();
      const next = this.refreshGate.complete();
      if (!this.disposed && next !== null) {
        queueMicrotask(() => void this.runRefresh(next));
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.configurationGeneration += 1;
    this.disposal = (async () => {
      const failures: unknown[] = [];
      const capture = async (operation: Promise<unknown>): Promise<boolean> => {
        try {
          await operation;
          return true;
        } catch (error) {
          failures.push(error);
          return false;
        }
      };
      this.stopQuotaColdRetry('extension-dispose');
      this.stopAutoRefresh('extension-dispose');
      this.stopFirstBackfillBlurDeadline('extension-dispose');
      this.stopFileWatching('extension-dispose');
      this.stopCodexWatching('extension-dispose');
      this.stopCredentialsWatching('extension-dispose');
      await capture(Promise.all([
        this.cancelAdviceNetworks('extension-dispose'),
        this.cancelQuotaNetworks('extension-dispose'),
      ]));
      this.codexWorkerCancellationRequested = true;
      this.codexProvider.cancel();
      const providerStopped = await capture(Promise.all([
        this.waitForCodexProviderRetirements(),
        this.codexProvider.dispose(),
      ]));
      while (this.activeCodexRefreshes.size > 0) {
        await Promise.allSettled([...this.activeCodexRefreshes]);
      }
      if (providerStopped) {
        await capture(this.releaseCodexOwnership('extension-dispose'));
      }
      await capture(this.codexBackgroundStateWrite.catch((error) => {
        throw error;
      }));
      await capture(this.drainResourceStops());
      this.statusBar.dispose();
      this.webviewProvider.dispose();
      if (failures.length > 0) {
        const first = failures[0];
        throw first instanceof Error
          ? first
          : new Error('Extension resources could not be stopped safely');
      }
    })();
    return this.disposal;
  }
}

let activeExtension: ClaudeCodeUsageExtension | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Claude Code Usage extension is now active');

  const settings = new SettingsStore(context);
  I18n.setLanguage(settings.get<string>('language') as any);
  const secretMigrationFailure = await settings.initializeSecretsForActivation();
  if (secretMigrationFailure) {
    const needsManualWorkspaceMigration =
      secretMigrationFailure === 'workspace-secret-requires-manual-migration';
    // Do not await the notification: the status bar and dashboard do not
    // require BYOK advice and must still activate in every Extension Host.
    void vscode.window.showWarningMessage(
      needsManualWorkspaceMigration
        ? I18n.t.popup.secretMigrationWorkspace
        : I18n.t.popup.secretMigrationFailed,
    );
  }
  const quotaRuntime = await initializeQuotaObservationRuntime(context, settings);
  const extension = new ClaudeCodeUsageExtension(
    context,
    settings,
    quotaRuntime,
  );
  activeExtension = extension;
  context.subscriptions.push({
    dispose: () => { void extension.dispose(); }
  });
}

export async function deactivate(): Promise<void> {
  console.log('Claude Code Usage extension is now deactivated');
  const extension = activeExtension;
  activeExtension = null;
  await extension?.dispose();
}
