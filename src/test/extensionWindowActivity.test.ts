import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ClaudeDataLoader } from '../dataLoader';
import {
  RefreshSingleFlight,
  WindowActivityGate,
} from '../refreshPolicy';
import { createClaudeUsageIndex } from '../claudeIncrementalIndex';
import {
  beginBackgroundWork,
  createBackgroundWorkState,
  pauseBackgroundWork,
  recordBackgroundWorkFailure,
  recordBackgroundWorkProgress,
} from '../backgroundWorkState';
import { ResourceOwnershipRegistry } from '../resourceOwnership';
import { snapshotFixture } from './codexFixtures';
import {
  createEmptyQuotaObservationStore,
  mergeQuotaCaptures,
} from '../quotaObservationStore';
import { I18n } from '../i18n';
import { getPricingBackend, setPricingBackend } from '../pricing';

type ExtensionModule = typeof import('../extension');

function loadExtensionModule(): ExtensionModule {
  const moduleLoader = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const vscodeStub: any = new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === 'then' || property === 'workspaceFolders') return undefined;
      return vscodeStub;
    },
    apply: () => vscodeStub,
    construct: () => vscodeStub,
  });
  moduleLoader._load = function (request, parent, isMain): unknown {
    if (request === 'vscode') {
      return vscodeStub;
    }
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try {
    return require('../extension') as ExtensionModule;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

const {
  ClaudeCodeUsageExtension,
  initializeQuotaObservationRuntime,
} = loadExtensionModule();

function bareExtension(): any {
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  const quotaSalt = 'extension-window-activity-test-salt';
  extension.resourceOwnership = new ResourceOwnershipRegistry();
  extension.codexWatcherLeases = new Map();
  extension.debounceTimerLeases = new Map();
  extension.activeAdviceNetworks = new Map();
  extension.activeQuotaNetworks = new Map();
  extension.codexProviderRetirements = new Set();
  extension.activeCodexRefreshes = new Set();
  extension.pendingResourceStops = new Set();
  extension.resourceStopFailure = null;
  extension.codexProviderRetirementFailure = null;
  extension.codexBackgroundStateWrite = Promise.resolve();
  extension.configurationGeneration = 0;
  extension.claudeIndexGeneration = 0;
  extension.fileWatcherGeneration = 0;
  extension.codexWatcherGeneration = 0;
  extension.credentialsWatcherGeneration = 0;
  extension.credentialsWatcherMissingFilenameEventsSinceRefresh = 0;
  extension.codexWatcherEventsSinceRefresh = 0;
  extension.codexCoalescedTriggersSinceRefresh = 0;
  extension.codexRefreshGate = new RefreshSingleFlight();
  extension.codexRefreshDrain = null;
  extension.codexRefreshSuspensionDepth = 0;
  extension.codexWatchDebouncePending = false;
  extension.disposed = false;
  extension.codexBackgroundState = createBackgroundWorkState({
    measurementVersion: 1,
    reason: 'first-index',
    now: 0,
  });
  extension.codexFirstBackfillActive = false;
  extension.codexWorkerCancellationRequested = false;
  extension.providerRefreshStates = { claude: { failed: false }, codex: { failed: false } };
  extension.deliveredRefreshStates = {};
  extension.claudeDashboardHydrated = false;
  extension.codexDashboardHydrated = false;
  extension.context = {
    globalState: {
      update: async () => undefined,
    },
  };
  extension.outputChannel = { appendLine: () => undefined };
  extension.settings = { get: () => undefined };
  extension.quotaFingerprintSalt = quotaSalt;
  extension.quotaObservationStore = createEmptyQuotaObservationStore();
  extension.quotaObservationRepository = {
    append: async (captures: any[]) => {
      extension.quotaObservationStore = mergeQuotaCaptures(
        extension.quotaObservationStore,
        captures,
        { salt: quotaSalt, now: Date.now() },
      );
      return extension.quotaObservationStore;
    },
  };
  extension.webviewProvider = {
    updateQuota: () => undefined,
    updateWeeklyQuotaHistory: () => undefined,
  };
  return extension;
}

function completeCoordinatorSnapshot(): ReturnType<typeof snapshotFixture> {
  const snapshot = snapshotFixture();
  snapshot.coverage.complete = true;
  snapshot.coverage.indexedFiles = snapshot.coverage.totalFiles;
  snapshot.coverage.indexedBytes = snapshot.coverage.totalBytes;
  for (const range of Object.values(snapshot.coverage.period).filter(
    (value): value is typeof snapshot.coverage.period.allTime => typeof value === 'object',
  )) {
    Object.assign(range, { migratedFiles: 5, totalFiles: 5, migratedBytes: 1_500,
      totalBytes: 1_500, complete: true });
  }
  snapshot.hourlyCoverage = {
    timeZone: 'UTC', asOfDay: '2026-07-20', windowDays: 30,
    indexedFiles: 3, totalFiles: 3, indexedBytes: 900, totalBytes: 900,
    complete: true, days: {},
  };
  snapshot.coverage.hourly = snapshot.hourlyCoverage;
  return snapshot;
}

function coordinatorHarness(dashboardAutoRefresh = false): {
  extension: any;
  deliveries: Array<{ kind: string; value: any }>;
  statuses: Array<{ kind: string; value: any; error?: string }>;
  config: any;
  snapshot: ReturnType<typeof completeCoordinatorSnapshot>;
} {
  const extension = bareExtension();
  const deliveries: Array<{ kind: string; value: any }> = [];
  const statuses: Array<{ kind: string; value: any; error?: string }> = [];
  const config = {
    dashboardAutoRefresh, codexEnabled: true, statusBarProvider: 'codex',
    codexStatusMetric: 'processed', enableContentAnalysis: false,
    advicePromptWindowDays: 30, projectGroupingMode: 'flat', contextWindowOverride: 0,
    dataDirectory: '',
  };
  extension.getConfiguration = () => config;
  extension.settings = { get: () => false };
  extension.windowActivity = new WindowActivityGate(false);
  extension.refreshGate = new RefreshSingleFlight();
  extension.cache = { records: [], contentAnalysis: null, manifest: null,
    claudeIndex: createClaudeUsageIndex(), lastUpdate: new Date(0), dataDirectory: null,
    usageLimits: null };
  extension.quotaColdRetryDone = true;
  extension.maybeFetchUsageLimits = async () => null;
  extension.codexView = null;
  extension.codexAvailable = true;
  extension.codexHasData = false;
  extension.codexInsights = {};
  extension.codexRefreshing = false;
  extension.codexProgress = null;
  extension.codexProgressLastRenderedAt = 0;
  extension.statusBar = {
    setLoading: () => statuses.push({ kind: 'loading', value: true }),
    setProvider: (value: unknown) => statuses.push({ kind: 'provider', value }),
    updateQuota: () => undefined,
    updateContext: () => undefined,
    updateCodex: (value: unknown) => statuses.push({ kind: 'codex', value }),
    updateUsageData: (value: unknown, _workspace: unknown, error?: string) =>
      statuses.push({ kind: 'claude', value, error }),
  };
  extension.webviewProvider = {
    setLoading: () => deliveries.push({ kind: 'loading', value: true }),
    clearClaudeSource: () => deliveries.push({ kind: 'claude', value: { today: null, allTime: null } }),
    updateQuota: () => undefined,
    updateWeeklyQuotaHistory: () => undefined,
    updateAdviceEffectivenessData: (value: unknown) => deliveries.push({ kind: 'advice-state', value }),
    updateProviderData: (_view: unknown, _insights: unknown, value: unknown) =>
      deliveries.push({ kind: 'provider', value }),
    updateCodexProgress: (value: unknown) => deliveries.push({ kind: 'progress', value }),
    updateRefreshState: (provider: string, value: unknown) =>
      deliveries.push({ kind: `refresh:${provider}`, value }),
    updateData: (_session: unknown, today: unknown, _month: unknown, allTime: unknown,
      _daily: unknown, _monthly: unknown, _hourly: unknown, error?: string) =>
      deliveries.push({ kind: 'claude', value: { today, allTime, error } }),
  };
  const snapshot = completeCoordinatorSnapshot();
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => snapshot,
    refresh: async (_profile: unknown, onProgress: (value: unknown) => void) => {
      onProgress({ scannedFiles: snapshot.coverage.indexedFiles,
        totalFiles: snapshot.coverage.totalFiles, indexedBytes: snapshot.coverage.indexedBytes,
        totalBytes: snapshot.coverage.totalBytes, period: snapshot.coverage.period,
        hourly: snapshot.hourlyCoverage });
      return { outcome: 'success', snapshot };
    },
    cancel: () => undefined,
  };
  return { extension, deliveries, statuses, config, snapshot };
}

test('coordinator paused refresh still invalidates prepared advice source revisions without delivering panels', () => {
  const { extension, deliveries } = coordinatorHarness();
  const sourceRevision = 'current-verified-source';
  let preparedHandleValid = true;
  extension.buildAdviceEffectivenessProviderStates = () => ({ codex: { sourceRevision } });
  extension.webviewProvider.updateAdviceEffectivenessData = (states: any) => {
    if (states.codex.sourceRevision !== 'previous-verified-source') preparedHandleValid = false;
  };
  extension.syncProviderUi('watch');
  assert.equal(preparedHandleValid, false);
  assert.equal(deliveries.filter(value => value.kind === 'provider').length, 0);
});

test('coordinator dashboard pause suppresses automatic Codex data, insights and progress but keeps indexing and status', async () => {
  for (const trigger of ['watch', 'poll', 'focus', 'workspace', 'credentials'] as const) {
    const { extension, deliveries, statuses } = coordinatorHarness();
    let refreshes = 0;
    const originalRefresh = extension.codexProvider.refresh;
    extension.codexProvider.refresh = (...args: unknown[]) => {
      refreshes += 1;
      return originalRefresh(...args);
    };
    await extension.runCodexRefresh(trigger);
    assert.equal(refreshes, 1, trigger);
    assert.ok(extension.codexView.allTime.total.processed > 0, trigger);
    assert.ok(statuses.some(value => value.kind === 'codex'), trigger);
    assert.deepEqual(deliveries.filter(value => ['provider', 'progress', 'claude', 'loading'].includes(value.kind)), [], trigger);
    assert.ok(deliveries.some(value => value.kind === 'advice-state'), trigger);
  }
});

test('coordinator manual and settings feedback deliver Codex dashboards while paused', async () => {
  const { extension, deliveries, snapshot } = coordinatorHarness();
  Object.assign(snapshot.hourlyCoverage!, { indexedFiles: 1, indexedBytes: 300, complete: false });
  await extension.runCodexRefresh('manual');
  assert.ok(deliveries.some(value => value.kind === 'provider'));
  assert.ok(deliveries.some(value => value.kind === 'progress'));
  deliveries.length = 0;
  extension.onSettingsChangedFromPanel('showWeeklyEquivalentValue');
  assert.ok(deliveries.some(value => value.kind === 'provider'));
  deliveries.length = 0;
  await extension.runCodexRefresh('settings');
  assert.ok(deliveries.some(value => value.kind === 'provider'));
});

test('coordinator dashboard pause control updates presentation without retiring providers or restarting background work', () => {
  const { extension, deliveries } = coordinatorHarness();
  let lifecycleRestarts = 0;
  extension.onConfigurationChanged = () => { lifecycleRestarts += 1; };
  extension.onSettingsChangedFromPanel('dashboardAutoRefresh');
  assert.equal(lifecycleRestarts, 0);
  assert.ok(deliveries.some(value => value.kind === 'provider'));
});

test('coordinator a manual historical pass continues as background work so a paused dashboard does not keep repainting', async () => {
  const { extension, deliveries } = coordinatorHarness();
  const snapshot = completeCoordinatorSnapshot();
  Object.assign(snapshot.hourlyCoverage!, { indexedFiles: 1, indexedBytes: 300, complete: false });
  extension.windowActivity = new WindowActivityGate(true);
  extension.codexProvider.loadPersistedSnapshot = async () => snapshot;
  extension.codexProvider.refresh = async () => ({ outcome: 'partial', snapshot,
    diagnostic: { bodyReads: 1, failedFiles: 0 } });
  const continuations: string[] = [];
  extension.refreshCodexData = async (trigger: string) => { continuations.push(trigger); };
  await extension.runCodexRefresh('manual');
  await Promise.resolve();
  assert.ok(deliveries.some(value => value.kind === 'provider'));
  assert.deepEqual(continuations, ['poll']);
});

test('coordinator a restored failed-history cooldown cannot be mistaken for a fresh successful checkpoint', async () => {
  const { extension, deliveries } = coordinatorHarness(true);
  const snapshot = completeCoordinatorSnapshot();
  Object.assign(snapshot.hourlyCoverage!, { indexedFiles: 1, indexedBytes: 300, complete: false });
  const seed = createBackgroundWorkState({ measurementVersion: 1, reason: 'hourly-history',
    now: Date.now(), progress: extension.codexBackgroundProgress(snapshot) });
  extension.codexBackgroundState = recordBackgroundWorkFailure(beginBackgroundWork(seed,
    { trigger: 'automatic', now: Date.now() }).state, { now: Date.now() });
  extension.codexProvider.loadPersistedSnapshot = async () => snapshot;
  extension.codexProvider.refresh = async () => ({ outcome: 'partial', snapshot,
    diagnostic: { bodyReads: 0, failedFiles: 0 } });
  await extension.runCodexRefresh('poll');
  assert.deepEqual(extension.providerRefreshStates.codex, { failed: true });
  assert.deepEqual(deliveries.filter(value => value.kind === 'refresh:codex').map(value => value.value),
    [{ failed: true }]);
});

test('coordinator manual refresh reports a failed provider retirement without losing data or wedging the drain', async () => {
  const { extension, deliveries } = coordinatorHarness();
  extension.applyCodexSnapshot(completeCoordinatorSnapshot());
  const verified = extension.codexView;
  extension.waitForCodexProviderRetirements = async () => { throw new Error('/private/fixture/retirement'); };
  await assert.doesNotReject(extension.refreshCodexData('manual'));
  assert.equal(extension.codexView, verified);
  assert.deepEqual(deliveries.filter(value => value.kind === 'refresh:codex').map(value => value.value),
    [{ failed: true }]);
  assert.equal(extension.codexRefreshDrain, null);
});

test('coordinator paused startup permits one verified Codex hydration without repeated background panels', async () => {
  const { extension, deliveries } = coordinatorHarness();
  await extension.runCodexRefresh('startup');
  assert.equal(deliveries.filter(value => value.kind === 'provider').length, 1);
  assert.equal(deliveries.filter(value => value.kind === 'progress').length, 0);
  deliveries.length = 0;
  await extension.runCodexRefresh('startup');
  await extension.runCodexRefresh('watch');
  assert.equal(deliveries.filter(value => ['provider', 'progress'].includes(value.kind)).length, 0);
});

test('coordinator automatic Codex delivery remains active when dashboard refresh is enabled', async () => {
  const { extension, deliveries, snapshot } = coordinatorHarness(true);
  Object.assign(snapshot.hourlyCoverage!, { indexedFiles: 1, indexedBytes: 300, complete: false });
  await extension.runCodexRefresh('watch');
  assert.ok(deliveries.some(value => value.kind === 'provider'));
  assert.ok(deliveries.some(value => value.kind === 'advice-state'));
  assert.ok(deliveries.some(value => value.kind === 'progress'));
});

test('coordinator Codex progress selects actual main, period and hourly counters with anonymous work state', () => {
  const { extension, deliveries } = coordinatorHarness(true);
  const snapshot = completeCoordinatorSnapshot();
  extension.codexBackgroundState = beginBackgroundWork(extension.codexBackgroundState,
    { trigger: 'automatic', now: Date.now() }).state;
  const progress: any = { scannedFiles: 4, totalFiles: 5, indexedBytes: 1_200, totalBytes: 1_500,
    period: structuredClone(snapshot.coverage.period), hourly: structuredClone(snapshot.hourlyCoverage),
    rawError: '/private/fixture/not-for-webview' };
  Object.assign(progress.period.allTime, { migratedFiles: 2, migratedBytes: 600, complete: false });
  Object.assign(progress.hourly, { indexedFiles: 1, indexedBytes: 300, complete: false });
  const publish = () => {
    extension.codexProgressLastRenderedAt = 0;
    extension.onCodexIndexProgress(progress);
    return deliveries.filter(value => value.kind === 'progress').slice(-1)[0]?.value;
  };
  const main = publish();
  assert.deepEqual([main.phase, main.scannedFiles, main.totalFiles, main.indexedBytes, main.totalBytes],
    ['main', 4, 5, 1_200, 1_500]);
  progress.scannedFiles = 5;
  progress.indexedBytes = 1_500;
  const period = publish();
  assert.deepEqual([period.phase, period.scannedFiles, period.totalFiles, period.indexedBytes, period.totalBytes],
    ['period', 2, 5, 600, 1_500]);
  Object.assign(progress.period.allTime, { migratedFiles: 5, migratedBytes: 1_500, complete: true });
  const hourly = publish();
  assert.deepEqual([hourly.phase, hourly.scannedFiles, hourly.totalFiles, hourly.indexedBytes, hourly.totalBytes],
    ['hourly', 1, 3, 300, 900]);
  assert.deepEqual(hourly.workState, { status: 'running', pausedReason: null, nextEligibleAt: null });
  assert.equal(JSON.stringify(deliveries).includes('/private/fixture'), false);
});

test('coordinator Codex cooldown and user pause retain exact hourly phase after the worker settles', async () => {
  for (const pausedReason of ['failure-backoff', 'user'] as const) {
    const { extension, deliveries } = coordinatorHarness(true);
    const snapshot = completeCoordinatorSnapshot();
    Object.assign(snapshot.hourlyCoverage!, { indexedFiles: 1, indexedBytes: 300, complete: false });
    const seed = createBackgroundWorkState({ measurementVersion: 1, reason: 'hourly-history',
      now: Date.now(), progress: extension.codexBackgroundProgress(snapshot) });
    extension.codexBackgroundState = pausedReason === 'user'
      ? pauseBackgroundWork(seed, { now: Date.now() })
      : recordBackgroundWorkFailure(beginBackgroundWork(seed,
        { trigger: 'automatic', now: Date.now() }).state, { now: Date.now() });
    extension.codexProvider.loadPersistedSnapshot = async () => snapshot;
    extension.codexProvider.refresh = async (_profile: unknown, _progress: unknown, allowed: boolean) => {
      assert.equal(allowed, false);
      return { outcome: 'partial', snapshot, diagnostic: { failedFiles: 0, bodyReads: 0 } };
    };
    await extension.runCodexRefresh('poll');
    const value = deliveries.filter(value => value.kind === 'provider').slice(-1)[0]?.value;
    assert.equal(value.codexLoading, false);
    assert.equal(value.codexProgress?.phase, 'hourly');
    assert.equal(value.codexProgress.scannedFiles, 1);
    assert.equal(value.codexProgress.totalFiles, 3);
    assert.deepEqual(value.codexProgress.workState, {
      status: pausedReason === 'user' ? 'paused' : 'cooldown', pausedReason,
      nextEligibleAt: extension.codexBackgroundState.nextEligibleAt,
    });
  }
});

test('coordinator warm Codex exceptions preserve verified view and manual failures always send compact state', async () => {
  const { extension, deliveries } = coordinatorHarness();
  extension.applyCodexSnapshot(completeCoordinatorSnapshot());
  extension.providerRefreshStates.codex = { failed: false, lastSuccessfulAt: 1_234 };
  const verifiedView = extension.codexView;
  const verifiedInsights = extension.codexInsights;
  extension.codexProvider.isAvailable = async () => { throw new Error('/private/fixture/raw failure'); };
  await extension.refreshCodexData('manual');
  assert.equal(extension.codexView, verifiedView);
  assert.equal(extension.codexInsights, verifiedInsights);
  assert.equal(extension.codexHasData, true);
  assert.deepEqual(deliveries.filter(value => value.kind === 'refresh:codex').map(value => value.value),
    [{ failed: true, lastSuccessfulAt: 1_234 }]);
  deliveries.length = 0;
  await extension.refreshCodexData('poll');
  await extension.refreshCodexData('watch');
  assert.equal(deliveries.filter(value => value.kind !== 'advice-state').length, 0,
    'paused automatic retries cannot replace panels or repeat notifications');
  await extension.refreshCodexData('manual');
  assert.deepEqual(deliveries.filter(value => value.kind === 'refresh:codex').map(value => value.value),
    [{ failed: true, lastSuccessfulAt: 1_234 }]);
  assert.equal(JSON.stringify(deliveries).includes('/private/fixture'), false);
  assert.equal(extension.codexRefreshDrain, null);
});

test('coordinator same-home unavailability keeps verified Codex data navigable', async () => {
  for (const source of ['discovery', 'worker']) {
    const { extension, deliveries, config } = coordinatorHarness(true);
    config.codexDataDirectory = '/synthetic/home-a';
    extension.applyCodexSnapshot(completeCoordinatorSnapshot());
    const verified = extension.codexView;
    if (source === 'discovery') extension.codexProvider.isAvailable = async () => false;
    else extension.codexProvider.refresh = async () => ({ outcome: 'unavailable' });
    await extension.runCodexRefresh('manual');
    assert.equal(extension.codexView, verified);
    assert.equal(extension.codexAvailable, true, source);
    assert.equal(deliveries.filter(value => value.kind === 'provider').slice(-1)[0]?.value.codex, true, source);
  }
});

test('coordinator different-home failure cannot retain the old view, insights or success timestamp', async () => {
  for (const source of ['discovery', 'worker']) {
    const { extension, deliveries, config } = coordinatorHarness(true);
    config.codexDataDirectory = '/synthetic/home-a';
    extension.applyCodexSnapshot(completeCoordinatorSnapshot());
    extension.providerRefreshStates.codex = { failed: false, lastSuccessfulAt: 1_234 };
    const oldSnapshot = completeCoordinatorSnapshot();
    let hydrationReads = 0;
    let statusClears = 0;
    extension.statusBar.clearCodex = () => { statusClears++; };
    config.codexDataDirectory = '/synthetic/home-b';
    extension.codexProvider = {
      isAvailable: async () => source !== 'discovery',
      loadPersistedSnapshot: async () => { hydrationReads++; return oldSnapshot; },
      refresh: async () => ({ outcome: 'error', snapshot: oldSnapshot }),
    };
    await extension.runCodexRefresh('manual');
    assert.equal(extension.codexView, null, source);
    assert.equal(extension.codexHasData, false, source);
    assert.notEqual(extension.codexInsights, undefined);
    assert.equal(extension.providerRefreshStates.codex.lastSuccessfulAt, undefined, source);
    assert.equal(hydrationReads, 0, 'the shared checkpoint is not proof of a new home');
    assert.ok(statusClears >= 1, 'the old home cannot remain cached in the status bar');
    assert.ok(deliveries.some(value => value.kind === 'provider'));
  }
});

test('coordinator late discovery or failure from a retired provider cannot mutate a replacement', async () => {
  for (const result of ['unavailable', 'reject']) {
    const { extension, deliveries } = coordinatorHarness(true);
    let resolve!: (value: boolean) => void;
    let reject!: (error: Error) => void;
    extension.codexProvider.isAvailable = () => new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
    const pending = extension.refreshCodexData('manual');
    await new Promise(done => setImmediate(done));
    extension.configurationGeneration++;
    extension.codexProvider = { isAvailable: async () => true };
    extension.codexView = { owner: 'replacement' };
    extension.codexAvailable = true;
    extension.codexRefreshing = true;
    extension.providerRefreshStates.codex = { failed: false, lastSuccessfulAt: 7_777 };
    deliveries.length = 0;
    if (result === 'reject') reject(new Error('retired source'));
    else resolve(false);
    await pending;
    assert.deepEqual(extension.codexView, { owner: 'replacement' });
    assert.equal(extension.codexAvailable, true, result);
    assert.equal(extension.codexRefreshing, true, result);
    assert.deepEqual(extension.providerRefreshStates.codex, { failed: false, lastSuccessfulAt: 7_777 });
    assert.deepEqual(deliveries, [], result);
  }
});

test('coordinator identical verified Codex snapshots retain view and insight identity', () => {
  const { extension } = coordinatorHarness(true);
  const snapshot = completeCoordinatorSnapshot();
  extension.applyCodexSnapshot(snapshot);
  const verified = extension.codexView;
  const insights = extension.codexInsights;
  extension.applyCodexSnapshot(structuredClone(snapshot));
  assert.equal(extension.codexView, verified);
  assert.equal(extension.codexInsights, insights);
  const renamed = structuredClone(snapshot);
  renamed.files[0].session.sessionTitle = 'A changed safe title';
  extension.applyCodexSnapshot(renamed);
  assert.notEqual(extension.codexView, verified, 'titles are part of the render revision');
});

test('coordinator retirement during preflight state persistence cannot start a retired worker', async () => {
  const { extension, deliveries } = coordinatorHarness(true);
  let resume!: () => void;
  let workerStarts = 0;
  extension.codexProvider.loadPersistedSnapshot = async () => null;
  extension.codexProvider.refresh = async () => { workerStarts++; return { outcome: 'unavailable' }; };
  extension.saveCodexBackgroundState = () => new Promise<void>(resolve => { resume = resolve; });
  const pending = extension.refreshCodexData('manual');
  await new Promise(done => setImmediate(done));
  extension.configurationGeneration++;
  extension.codexProvider = { isAvailable: async () => true };
  extension.codexView = { owner: 'replacement' };
  const replacementState = createBackgroundWorkState({ measurementVersion: 1, reason: 'first-index', now: 7_777 });
  extension.codexBackgroundState = replacementState;
  extension.codexRefreshing = true;
  deliveries.length = 0;
  resume();
  await pending;
  assert.equal(workerStarts, 0);
  assert.equal(extension.codexBackgroundState, replacementState);
  assert.equal(extension.codexRefreshing, true);
  assert.deepEqual(deliveries, []);
});

test('coordinator repeated complete metadata polls retain verified render revisions without fake backfill', async () => {
  const { extension } = coordinatorHarness(true);
  await extension.runCodexRefresh('poll');
  const view = extension.codexView;
  const insights = extension.codexInsights;
  assert.equal(extension.codexDashboardProgress(), null);
  await extension.runCodexRefresh('poll');
  assert.equal(extension.codexView, view);
  assert.equal(extension.codexInsights, insights);
  assert.equal(extension.codexDashboardProgress(), null);
});

test('coordinator checkpoint hydration cannot outlive disposal or its configuration generation', async () => {
  for (const boundary of ['dispose', 'configuration']) {
    const { extension, deliveries, snapshot } = coordinatorHarness(true);
    let resolve!: (value: typeof snapshot) => void;
    extension.codexRefreshing = true;
    extension.codexProvider.loadPersistedSnapshot = () => new Promise<typeof snapshot>(done => { resolve = done; });
    extension.scheduleCodexCheckpointHydration('manual');
    const pending = extension.codexCheckpointHydration;
    if (boundary === 'dispose') extension.disposed = true;
    else extension.configurationGeneration++;
    resolve(snapshot);
    await pending;
    assert.equal(extension.codexView, null, boundary);
    assert.deepEqual(deliveries, [], boundary);
  }
});

test('coordinator Codex worker errors and failed-file results cannot replace a warm verified subtotal', async () => {
  for (const outcome of ['error', 'partial']) {
    const { extension, deliveries } = coordinatorHarness();
    const verified = completeCoordinatorSnapshot();
    extension.applyCodexSnapshot(verified);
    const verifiedView = extension.codexView;
    extension.providerRefreshStates.codex = { failed: false, lastSuccessfulAt: 1_234 };
    const failed = completeCoordinatorSnapshot();
    failed.total.inputTotal = 999_999;
    extension.codexProvider.refresh = async () => ({ outcome, snapshot: failed,
      diagnostic: { failedFiles: 1, bodyReads: 1 } });
    extension.codexProvider.loadPersistedSnapshot = async () => null;
    await extension.runCodexRefresh('manual');
    assert.equal(extension.codexView, verifiedView, outcome);
    assert.deepEqual(deliveries.filter(value => value.kind === 'refresh:codex').slice(-1)[0]?.value,
      { failed: true, lastSuccessfulAt: 1_234 }, outcome);
  }
});

test('coordinator a resumed failure cooldown is not a successful checkpoint but clean manual progress clears failure', async () => {
  const { extension, deliveries } = coordinatorHarness();
  const snapshot = completeCoordinatorSnapshot();
  Object.assign(snapshot.hourlyCoverage!, { indexedFiles: 1, indexedBytes: 300, complete: false });
  extension.applyCodexSnapshot(snapshot);
  extension.providerRefreshStates.codex = { failed: true, lastSuccessfulAt: 1_234 };
  const seed = createBackgroundWorkState({ measurementVersion: 1, reason: 'hourly-history',
    now: Date.now(), progress: extension.codexBackgroundProgress(snapshot) });
  extension.codexBackgroundState = recordBackgroundWorkFailure(beginBackgroundWork(seed,
    { trigger: 'automatic', now: Date.now() }).state, { now: Date.now() });
  extension.codexProvider.loadPersistedSnapshot = async () => snapshot;
  extension.codexProvider.refresh = async () => ({ outcome: 'partial', snapshot,
    diagnostic: { failedFiles: 0, bodyReads: 0 } });
  await extension.runCodexRefresh('poll');
  assert.deepEqual(extension.providerRefreshStates.codex, { failed: true, lastSuccessfulAt: 1_234 });
  assert.deepEqual(deliveries.filter(value => value.kind === 'refresh:codex'), []);
  const advanced = structuredClone(snapshot);
  Object.assign(advanced.hourlyCoverage!, { indexedFiles: 2, indexedBytes: 600 });
  extension.codexProvider.refresh = async () => ({ outcome: 'partial', snapshot: advanced,
    diagnostic: { failedFiles: 0, bodyReads: 1 } });
  await extension.runCodexRefresh('manual');
  assert.equal(extension.providerRefreshStates.codex.failed, false);
  assert.ok(extension.providerRefreshStates.codex.lastSuccessfulAt > 1_234);
  assert.equal(deliveries.filter(value => value.kind === 'refresh:codex').slice(-1)[0]?.value.failed, false);
});

test('coordinator refresh-state UI exceptions cannot strand Codex provider work or its single-flight drain', async () => {
  const { extension } = coordinatorHarness();
  const diagnostics: string[] = [];
  let refreshes = 0;
  extension.outputChannel.appendLine = (value: string) => diagnostics.push(value);
  extension.webviewProvider.updateRefreshState = () => { throw new Error('/private/fixture/renderer'); };
  extension.codexProvider.refresh = async () => { refreshes += 1; throw new Error('/private/fixture/worker'); };
  await assert.doesNotReject(extension.refreshCodexData('manual'));
  await assert.doesNotReject(extension.refreshCodexData('manual'));
  assert.equal(refreshes, 2);
  assert.equal(extension.activeCodexRefreshes.size, 0);
  assert.equal(extension.codexRefreshDrain, null);
  assert.equal(extension.codexRefreshing, false);
  assert.equal(diagnostics.filter(value => value.includes('provider-ui-sync-failed')).length, 1);
  assert.equal(diagnostics.join('\n').includes('/private/fixture'), false);
});

test('coordinator Claude pause keeps append indexing and status active while manual unchanged-manifest refresh delivers current data', async (t) => {
  const { extension, deliveries, statuses, config } = coordinatorHarness();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-coordinator-claude-pause-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, 'session.jsonl');
  const row = (id: string) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
    requestId: id, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } });
  fs.writeFileSync(file, row('cold') + '\n');
  config.dataDirectory = root;
  config.statusBarProvider = 'claude';
  extension.refreshCodexData = async () => undefined;
  await extension.refreshData(true, 'manual');
  deliveries.length = 0;
  statuses.length = 0;
  fs.appendFileSync(file, row('tail') + '\n');
  await extension.refreshData(false, 'watch');
  await extension.refreshData(false, 'poll');
  assert.equal(extension.cache.records.length, 2);
  assert.equal(extension.cache.claudeIndex.aggregates.allTime.totalInputTokens, 20);
  assert.ok(statuses.some(value => value.kind === 'claude'));
  assert.deepEqual(deliveries.filter(value => ['provider', 'progress', 'claude', 'loading'].includes(value.kind)), []);
  await extension.refreshData(false, 'manual');
  assert.equal(deliveries.filter(value => value.kind === 'claude').slice(-1)[0]?.value.allTime.totalInputTokens, 20);
});

test('coordinator Claude warm manual failures retain data, disclose anonymous state, and clear it on unchanged success', async (t) => {
  const { extension, deliveries, statuses, config } = coordinatorHarness();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-coordinator-claude-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant',
    timestamp: new Date().toISOString(), requestId: 'warm', message: { id: 'warm', model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 1 } } }) + '\n');
  config.dataDirectory = root;
  config.statusBarProvider = 'claude';
  extension.refreshCodexData = async () => undefined;
  await extension.refreshData(true, 'manual');
  const verifiedManifest = extension.cache.manifest;
  const verifiedIndex = extension.cache.claudeIndex;
  const previousSuccess = extension.providerRefreshStates.claude.lastSuccessfulAt;
  assert.ok(previousSuccess > 0);
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  deliveries.length = 0;
  (ClaudeDataLoader as any).findClaudeDataDirectory = async () => { throw new Error('/private/fixture/raw secret'); };
  try {
    await extension.refreshData(false, 'manual');
    assert.equal(extension.cache.manifest, verifiedManifest);
    assert.equal(extension.cache.claudeIndex, verifiedIndex);
    assert.equal(deliveries.filter(value => value.kind === 'claude').length, 0);
    assert.deepEqual(deliveries.filter(value => value.kind === 'refresh:claude').map(value => value.value),
      [{ failed: true, lastSuccessfulAt: previousSuccess }]);
    assert.ok(statuses.some(value => value.kind === 'claude' && value.error === I18n.t.statusBar.refreshFailed));
    deliveries.length = 0;
    await extension.refreshData(false, 'watch');
    await extension.refreshData(false, 'poll');
    assert.equal(deliveries.filter(value => value.kind !== 'advice-state').length, 0);
    await extension.refreshData(false, 'manual');
    assert.equal(deliveries.filter(value => value.kind === 'refresh:claude').length, 1);
    assert.equal(JSON.stringify(deliveries).includes('/private/fixture'), false);
  } finally {
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
  }
  deliveries.length = 0;
  await extension.refreshData(false, 'manual');
  assert.equal(extension.providerRefreshStates.claude.failed, false);
  assert.ok(extension.providerRefreshStates.claude.lastSuccessfulAt >= previousSuccess);
  assert.equal(deliveries.filter(value => value.kind === 'refresh:claude').slice(-1)[0]?.value.failed, false);
  assert.ok(deliveries.some(value => value.kind === 'claude'));
});

test('production Claude polls retain all dashboard references until the render contract changes', async (t) => {
  const { extension, config } = coordinatorHarness(true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-render-revision-'));
  const originalNow = Date.now;
  let now = Date.parse('2026-09-30T12:00:20Z');
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; fs.rmSync(root, { recursive: true, force: true }); });
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, 'session.jsonl');
  const row = (id: string) => JSON.stringify({ type: 'assistant', timestamp: new Date(now).toISOString(),
    requestId: id, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } });
  fs.writeFileSync(file, row('first') + '\n');
  config.dataDirectory = root;
  extension.refreshCodexData = async () => undefined;
  const payloads: unknown[][] = [];
  extension.webviewProvider.updateData = (...args: unknown[]) => payloads.push(args);
  await extension.refreshData(true, 'manual');
  const first = payloads[0];
  for (const trigger of ['poll', 'poll', 'poll', 'focus', 'manual'] as const) {
    await extension.refreshData(false, trigger);
    const current = payloads[payloads.length - 1];
    for (const index of [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      assert.equal(current[index], first[index], `${trigger}: dashboard argument ${index} must stay stable`);
    }
  }
  fs.appendFileSync(file, row('next') + '\n');
  await extension.refreshData(false, 'watch');
  const appended = payloads[payloads.length - 1];
  assert.notEqual(appended[3], first[3]);
  assert.equal((appended[3] as any).totalInputTokens, 20);
  now += 6 * 3_600_000;
  await extension.refreshData(false, 'poll');
  assert.equal(payloads[payloads.length - 1][0], null, 'five-hour session expiry still invalidates the snapshot');
});

test('Claude source replacement clears verified data even when the new source fails or presentation is paused', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-source-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceA = path.join(root, 'a');
  const project = path.join(sourceA, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant',
    timestamp: new Date().toISOString(), requestId: 'a', message: { id: 'a', model: 'claude-opus-5-5',
      usage: { input_tokens: 1234, output_tokens: 1 } } }) + '\n');
  for (const paused of [false, true]) {
    const { extension, config, deliveries, statuses } = coordinatorHarness(!paused);
    config.dataDirectory = sourceA;
    extension.refreshCodexData = async () => undefined;
    await extension.refreshData(true, 'manual');
    const oldIndex = extension.cache.claudeIndex;
    config.dataDirectory = path.join(root, 'missing');
    deliveries.length = 0; statuses.length = 0;
    await extension.refreshData(false, 'poll');
    assert.notEqual(extension.cache.claudeIndex, oldIndex);
    assert.equal(extension.cache.records.length, 0);
    assert.equal(extension.cache.dataDirectory, null);
    assert.equal(extension.providerRefreshStates.claude.lastSuccessfulAt, undefined);
    assert.ok(statuses.some((s) => s.kind === 'claude' && s.value === null));
    assert.ok(deliveries.some((d) => d.kind === 'claude' && d.value.allTime === null));
    assert.ok(deliveries.some((d) => d.kind === 'advice-state'));
    config.dataDirectory = sourceA;
    await extension.refreshData(false, 'manual');
    assert.equal(extension.cache.claudeIndex.aggregates.allTime.totalInputTokens, 1234);
    assert.equal(extension.providerRefreshStates.claude.failed, false);
  }
});

test('a late Claude discovery from a retired source cannot restore its data or success time', async (t) => {
  const { extension, config, deliveries } = coordinatorHarness(true);
  extension.refreshCodexData = async () => undefined;
  config.dataDirectory = '/synthetic/source-a';
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  let resume!: (value: string | null) => void;
  (ClaudeDataLoader as any).findClaudeDataDirectory = () => new Promise<string | null>((resolve) => { resume = resolve; });
  t.after(() => { (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind; });
  const pending = extension.refreshData(true, 'manual');
  await new Promise((resolve) => setImmediate(resolve));
  config.dataDirectory = '/synthetic/source-b';
  extension.configurationGeneration++;
  resume('/synthetic/source-a');
  await pending;
  assert.equal(extension.cache.manifest, null);
  assert.equal(extension.cache.records.length, 0);
  assert.equal(extension.providerRefreshStates.claude.lastSuccessfulAt, undefined);
  assert.equal(deliveries.some((d) => d.kind === 'claude' && d.value.allTime !== null), false);
});

test('a Claude discovery finishing after disposal cannot clear or deliver source state', async (t) => {
  const { extension, config, deliveries, statuses } = coordinatorHarness(true);
  extension.refreshCodexData = async () => undefined;
  config.dataDirectory = '/synthetic/source-a';
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  let resume!: (value: string | null) => void;
  (ClaudeDataLoader as any).findClaudeDataDirectory = () => new Promise<string | null>((resolve) => { resume = resolve; });
  t.after(() => { (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind; });
  const pending = extension.refreshData(true, 'manual');
  await new Promise((resolve) => setImmediate(resolve));
  extension.disposed = true;
  config.dataDirectory = '/synthetic/source-b';
  const index = extension.cache.claudeIndex;
  const deliveryCount = deliveries.length;
  const statusCount = statuses.length;
  resume('/synthetic/source-a');
  await pending;
  assert.equal(extension.cache.claudeIndex, index);
  assert.equal(deliveries.length, deliveryCount);
  assert.equal(statuses.length, statusCount);
});

test('Claude replacement read failure cannot retain the old home, and verified replacement recovers', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-replacement-read-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = ['a', 'b'].map((name, i) => {
    const home = path.join(root, name);
    const project = path.join(home, 'projects', '-fixture');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant',
      timestamp: new Date().toISOString(), requestId: name, message: { id: name, model: 'claude-opus-5-5',
        usage: { input_tokens: (i + 1) * 100, output_tokens: 1 } } }) + '\n');
    return home;
  });
  const indexModule = require('../claudeIncrementalIndex') as typeof import('../claudeIncrementalIndex');
  const originalUpdate = indexModule.updateClaudeUsageIndex;
  let fail = true;
  (indexModule as any).updateClaudeUsageIndex = async (...args: Parameters<typeof originalUpdate>) => {
    if (args[1] === sources[1] && fail) throw new Error('synthetic read failure');
    return originalUpdate(...args);
  };
  t.after(() => { (indexModule as any).updateClaudeUsageIndex = originalUpdate; });
  const { extension, config } = coordinatorHarness(true);
  extension.refreshCodexData = async () => undefined;
  config.dataDirectory = sources[0];
  await extension.refreshData(true, 'manual');
  assert.equal(extension.cache.claudeIndex.aggregates.allTime.totalInputTokens, 100);
  config.dataDirectory = sources[1];
  await extension.refreshData(false, 'poll');
  assert.equal(extension.cache.records.length, 0);
  assert.equal(extension.providerRefreshStates.claude.lastSuccessfulAt, undefined);
  fail = false;
  await extension.refreshData(false, 'manual');
  assert.equal(extension.cache.claudeIndex.aggregates.allTime.totalInputTokens, 200);
  assert.equal(extension.cache.dataDirectory, sources[1]);
  assert.equal(extension.providerRefreshStates.claude.failed, false);
});

test('a retired Claude index result cannot publish after an A to B to A configuration change', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-retired-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant',
    timestamp: new Date().toISOString(), requestId: 'a', message: { id: 'a', model: 'claude-opus-5-5',
      usage: { input_tokens: 100, output_tokens: 1 } } }) + '\n');
  const indexModule = require('../claudeIncrementalIndex') as typeof import('../claudeIncrementalIndex');
  const originalUpdate = indexModule.updateClaudeUsageIndex;
  let release!: () => void;
  let ready!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  (indexModule as any).updateClaudeUsageIndex = async (...args: Parameters<typeof originalUpdate>) => {
    const result = await originalUpdate(...args);
    ready();
    await blocked;
    return result;
  };
  t.after(() => { (indexModule as any).updateClaudeUsageIndex = originalUpdate; });
  const { extension, config, deliveries } = coordinatorHarness(true);
  extension.refreshCodexData = async () => undefined;
  config.dataDirectory = root;
  const pending = extension.refreshData(true, 'manual');
  await started;
  config.dataDirectory = path.join(root, 'replacement');
  extension.configurationGeneration++;
  extension.selectClaudeUsageSource(config.dataDirectory);
  config.dataDirectory = root;
  extension.configurationGeneration++;
  extension.selectClaudeUsageSource(config.dataDirectory);
  release();
  await pending;
  assert.equal(extension.cache.manifest, null);
  assert.equal(extension.cache.records.length, 0);
  assert.equal(extension.providerRefreshStates.claude.lastSuccessfulAt, undefined);
  assert.equal(deliveries.some((d) => d.kind === 'claude' && d.value.allTime !== null), false);
});

test('unrelated settings retain completed Claude index work without publishing a retired presentation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-settings-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  const row = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
    requestId: 'same-source', message: { id: 'same-source', model: 'claude-opus-5-5',
      usage: { input_tokens: 100, output_tokens: 1 } } }) + '\n';
  fs.writeFileSync(path.join(project, 'session.jsonl'), row);
  const indexModule = require('../claudeIncrementalIndex') as typeof import('../claudeIncrementalIndex');
  const originalUpdate = indexModule.updateClaudeUsageIndex;
  let release!: () => void, ready!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const reads: number[] = [];
  (indexModule as any).updateClaudeUsageIndex = async (...args: Parameters<typeof originalUpdate>) => {
    const result = await originalUpdate(...args);
    reads.push(result.diagnostics.bytesRead);
    if (reads.length === 1) { ready(); await blocked; }
    return result;
  };
  t.after(() => { release(); (indexModule as any).updateClaudeUsageIndex = originalUpdate; });
  const { extension, config, deliveries } = coordinatorHarness(true);
  config.dataDirectory = root;
  config.enableContentAnalysis = true;
  extension.refreshCodexData = async () => undefined;
  const pending = extension.refreshData(true, 'manual');
  await started;
  config.refreshInterval = 300;
  extension.configurationGeneration++;
  release();
  await pending;
  assert.equal(deliveries.some((d) => d.kind === 'claude' && d.value.allTime !== null), false,
    'retired UI configuration must not deliver panels');
  await extension.refreshData(true, 'settings');
  assert.ok(reads[0] >= Buffer.byteLength(row), 'the cold usage/content passes read the fixture');
  assert.deepEqual(reads.slice(1), [0], 'completed same-source work is reused, not read twice');
  assert.equal(extension.cache.claudeIndex.aggregates.allTime.totalInputTokens, 100);
  assert.ok(deliveries.some((d) => d.kind === 'claude' && d.value.allTime?.totalInputTokens === 100));
});

test('price invalidation rejects an in-flight Claude index before the queued refresh prices unchanged files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-price-epoch-'));
  const backend = getPricingBackend();
  setPricingBackend('anthropic');
  t.after(() => { setPricingBackend(backend); fs.rmSync(root, { recursive: true, force: true }); });
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant',
    timestamp: new Date().toISOString(), requestId: 'prices', message: { id: 'prices', model: 'claude-opus-5-5',
      usage: { input_tokens: 1_000_000, output_tokens: 10_000 } } }) + '\n');
  const { extension, config, deliveries } = coordinatorHarness(true);
  config.dataDirectory = root;
  extension.refreshCodexData = async () => undefined;
  await extension.refreshData(true, 'manual');
  const oldCost = extension.cache.claudeIndex.aggregates.allTime.totalCost;
  deliveries.length = 0;
  const indexModule = require('../claudeIncrementalIndex') as typeof import('../claudeIncrementalIndex');
  const originalUpdate = indexModule.updateClaudeUsageIndex;
  let release!: () => void, ready!: () => void, first = true;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  (indexModule as any).updateClaudeUsageIndex = async (...args: Parameters<typeof originalUpdate>) => {
    const result = await originalUpdate(...args);
    if (first) { first = false; ready(); await blocked; }
    return result;
  };
  t.after(() => { release(); (indexModule as any).updateClaudeUsageIndex = originalUpdate; });
  const pending = extension.refreshData(true, 'poll');
  await started;
  // A local table switch stands in for a successful price fetch; no network or
  // configuration-generation change is needed by the production manual path.
  setPricingBackend('aws-bedrock-in-region');
  extension.invalidateClaudeUsagePricingCache();
  await extension.refreshData(true, 'pricing');
  release();
  await pending;
  const deadline = performance.now() + 3_000;
  while (extension.refreshGate.active && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(extension.refreshGate.active, false, 'queued pricing refresh drained');
  const truth = await originalUpdate(createClaudeUsageIndex(), root, { analyzeContent: false });
  const expected = truth.index.aggregates.allTime.totalCost;
  assert.notEqual(expected, oldCost);
  assert.equal(extension.cache.claudeIndex.aggregates.allTime.totalCost, expected);
  const published = deliveries.filter((d) => d.kind === 'claude' && d.value.allTime !== null);
  assert.ok(published.length > 0);
  assert.ok(published.every((d) => d.value.allTime.totalCost === expected), 'old-priced data never returned to the UI');
});

test('clear-all and disposal cannot retain a completed index through the presentation-only recovery path', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-index-revocation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant',
    timestamp: new Date().toISOString(), message: { id: 'revoked', model: 'claude-opus-5-5',
      usage: { input_tokens: 100, output_tokens: 1 } } }) + '\n');
  const indexModule = require('../claudeIncrementalIndex') as typeof import('../claudeIncrementalIndex');
  const originalUpdate = indexModule.updateClaudeUsageIndex;
  for (const flag of ['clearingAllLocalData', 'localDataClearedRequiresReload', 'disposed']) {
    await t.test(flag, async () => {
      let release!: () => void, ready!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { ready = resolve; });
      (indexModule as any).updateClaudeUsageIndex = async (...args: Parameters<typeof originalUpdate>) => {
        const result = await originalUpdate(...args);
        ready(); await blocked;
        return result;
      };
      try {
        const { extension, config, deliveries } = coordinatorHarness(true);
        config.dataDirectory = root;
        extension.refreshCodexData = async () => undefined;
        const pending = extension.refreshData(true, 'manual');
        await started;
        extension.configurationGeneration++;
        extension[flag] = true;
        release(); await pending;
        assert.equal(extension.cache.manifest, null);
        assert.equal(extension.cache.records.length, 0);
        assert.equal(deliveries.some((d) => d.kind === 'claude' && d.value.allTime !== null), false);
      } finally {
        release(); (indexModule as any).updateClaudeUsageIndex = originalUpdate;
      }
    });
  }
});

function installManualTimers(): {
  scheduled: Array<{ id: number; callback: () => void; delayMs: number }>;
  cleared: number[];
  restore: () => void;
} {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled: Array<{ id: number; callback: () => void; delayMs: number }> = [];
  const cleared: number[] = [];
  let nextId = 0;

  globalThis.setTimeout = ((callback: () => void, milliseconds?: number) => {
    nextId += 1;
    scheduled.push({ id: nextId, callback, delayMs: milliseconds ?? 0 });
    return nextId as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: NodeJS.Timeout) => {
    cleared.push(timer as unknown as number);
  }) as typeof clearTimeout;

  return {
    scheduled,
    cleared,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

test('background transition stops every Claude and Codex recurring resource once', () => {
  const extension = bareExtension();
  const calls: string[] = [];
  extension.windowActivity = new WindowActivityGate(true);
  extension.stopAutoRefresh = () => calls.push('timer:stop');
  extension.stopFileWatching = () => calls.push('claude:stop');
  extension.stopCodexWatching = () => calls.push('codex:stop');
  extension.stopCredentialsWatching = () => calls.push('credentials:stop');

  extension.handleWindowFocusChange(false);
  extension.handleWindowFocusChange(false);

  assert.deepEqual(calls, [
    'timer:stop',
    'claude:stop',
    'codex:stop',
    'credentials:stop',
  ]);
});

test('foreground transition resumes both providers and catches up once', () => {
  const extension = bareExtension();
  const calls: string[] = [];
  extension.windowActivity = new WindowActivityGate(false);
  extension.startAutoRefresh = () => calls.push('timer:start');
  extension.startFileWatching = () => {
    calls.push('claude:start');
    return Promise.resolve();
  };
  extension.startCodexWatching = () => calls.push('codex:start');
  extension.startCredentialsWatching = () => calls.push('credentials:start');
  extension.refreshData = (_force: boolean, trigger: string) => {
    calls.push(`refresh:${trigger}`);
    return Promise.resolve();
  };

  extension.handleWindowFocusChange(true);
  extension.handleWindowFocusChange(true);

  assert.deepEqual(calls, [
    'timer:start',
    'claude:start',
    'codex:start',
    'credentials:start',
    'refresh:focus',
  ]);
});

test('blur deadline cooperatively cancels the bounded first Codex backfill', async () => {
  const extension = bareExtension();
  extension.codexRefreshing = true;
  extension.codexFirstBackfillActive = true;
  let cancelCalls = 0;
  extension.codexProvider = { cancelAndWait: async () => { cancelCalls += 1; } };
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let callback: (() => void) | undefined;
  globalThis.setTimeout = ((fn: () => void) => {
    callback = fn;
    return 123 as any;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  try {
    extension.scheduleFirstBackfillBlurDeadline();
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);
    callback?.();
    await Promise.resolve();
    assert.equal(cancelCalls, 1);
    await extension.drainResourceStops();
    assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('background window cannot arm a new polling timer', () => {
  const extension = bareExtension();
  extension.windowActivity = new WindowActivityGate(false);
  extension.refreshGen = 0;
  extension.refreshTimer = undefined;
  extension.getConfiguration = () => ({ refreshInterval: 30 });
  extension.refreshData = () => Promise.resolve();

  try {
    extension.startAutoRefresh();
    assert.equal(extension.refreshTimer, undefined);
  } finally {
    extension.stopAutoRefresh();
  }
});

test('background window does not open a credentials watcher', () => {
  const extension = bareExtension();
  const calls: string[] = [];
  extension.windowActivity = new WindowActivityGate(false);
  extension.stopCredentialsWatching = () => calls.push('credentials:stop');
  extension.apiClient = {
    getCredentialsPath: () => {
      calls.push('credentials:path');
      return '/missing-parent/.credentials.json';
    },
  };

  extension.startCredentialsWatching();

  assert.deepEqual(calls, ['credentials:stop']);
});

test('background window does not inspect either provider log tree', async () => {
  const extension = bareExtension();
  const calls: string[] = [];
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  extension.windowActivity = new WindowActivityGate(false);
  extension.stopFileWatching = () => calls.push('claude:stop');
  extension.stopCodexWatching = () => calls.push('codex:stop');
  extension.getConfiguration = () => ({
    fileWatchSeconds: 30,
    dataDirectory: '',
    codexEnabled: true,
    codexFileWatchSeconds: 30,
  });
  extension.codexHome = () => {
    calls.push('codex:lookup');
    return '/missing-codex-home';
  };
  (ClaudeDataLoader as any).findClaudeDataDirectory = async () => {
    calls.push('claude:lookup');
    return null;
  };

  try {
    await extension.startFileWatching();
    extension.startCodexWatching();
    assert.deepEqual(calls, ['claude:stop', 'codex:stop']);
  } finally {
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
  }
});

test('Codex becomes available in the dashboard before a slow cold index finishes', async () => {
  const extension = bareExtension();
  const states: Array<{
    available: boolean;
    hasData: boolean;
    refreshing: boolean;
    scannedFiles: number | null;
  }> = [];
  let releaseRefresh: ((value: unknown) => void) | undefined;
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.codexAvailable = false;
  extension.codexHasData = false;
  extension.codexRefreshing = false;
  extension.codexProgress = null;
  extension.codexProgressLastRenderedAt = 0;
  extension.codexView = null;
  extension.codexInsights = {};
  const liveProgress: number[] = [];
  extension.webviewProvider = {
    updateCodexProgress: (progress: { scannedFiles: number }) => {
      liveProgress.push(progress.scannedFiles);
    },
  };
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => null,
    refresh: (_profile: string, onProgress?: (progress: unknown) => void) => new Promise((resolve) => {
      releaseRefresh = resolve;
      onProgress?.({
        scannedFiles: 12,
        totalFiles: 40,
        indexedBytes: 1_024,
        totalBytes: 4_096,
        period: {},
      });
    }),
  };
  extension.syncProviderUi = () => states.push({
    available: extension.codexAvailable,
    hasData: extension.codexHasData,
    refreshing: extension.codexRefreshing,
    scannedFiles: extension.codexProgress?.scannedFiles ?? null,
  });

  const pending = extension.runCodexRefresh('startup');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(states[0], {
    available: true,
    hasData: false,
    refreshing: true,
    scannedFiles: null,
  });
  assert.ok(states.every((state) => state.available && state.refreshing));
  assert.deepEqual(liveProgress, [12]);

  releaseRefresh?.({ outcome: 'unavailable' });
  await pending;
});

test('a verified Codex checkpoint stays visible while its index refresh continues', async () => {
  const extension = bareExtension();
  const cached = snapshotFixture();
  cached.coverage.complete = false;
  cached.coverage.indexedFiles = Math.max(1, cached.coverage.totalFiles - 1);
  const states: Array<{
    refreshing: boolean;
    processed: number;
  }> = [];
  let releaseRefresh: ((value: unknown) => void) | undefined;
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.codexAvailable = false;
  extension.codexHasData = false;
  extension.codexRefreshing = false;
  extension.codexProgress = null;
  extension.codexProgressLastRenderedAt = 0;
  extension.codexView = null;
  extension.codexInsights = {};
  extension.webviewProvider = {
    updateCodexProgress: () => undefined,
  };
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => cached,
    refresh: () => new Promise((resolve) => {
      releaseRefresh = resolve;
    }),
  };
  extension.syncProviderUi = () => states.push({
    refreshing: extension.codexRefreshing,
    processed: extension.codexView?.allTime.total.processed ?? 0,
  });

  const pending = extension.runCodexRefresh('startup');
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(releaseRefresh, 'the background worker refresh should still be running');
  assert.ok(
    states.some((state) => state.refreshing && state.processed > 0),
    'the persisted subtotal dashboard should render before the worker resolves',
  );

  releaseRefresh?.({ outcome: 'unavailable' });
  await pending;
});

test('a brand-new cold index adopts its first checkpoint before the worker finishes', async () => {
  const extension = bareExtension();
  const cached = snapshotFixture();
  cached.coverage.complete = false;
  let renders = 0;
  extension.codexView = null;
  extension.codexInsights = {};
  extension.codexRefreshing = true;
  extension.codexProgress = null;
  extension.codexProgressLastRenderedAt = 0;
  extension.codexCheckpointHydration = null;
  extension.codexCheckpointHydrationLastAttemptAt = 0;
  extension.codexProvider = {
    loadPersistedSnapshot: async () => cached,
  };
  extension.webviewProvider = {
    updateCodexProgress: () => undefined,
  };
  extension.syncProviderUi = () => {
    renders += 1;
  };

  extension.onCodexIndexProgress({
    scannedFiles: 1,
    totalFiles: 40,
    indexedBytes: 1_024,
    totalBytes: 4_096,
    period: {},
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(extension.codexView?.allTime.total.processed > 0);
  assert.equal(renders, 1);
});

test('Codex live index progress coalesces dashboard renders', () => {
  const extension = bareExtension();
  const originalNow = Date.now;
  let now = 1_000;
  let renders = 0;
  const reasons: unknown[] = [];
  extension.codexProgress = null;
  extension.codexProgressLastRenderedAt = 0;
  extension.codexBackgroundState = beginBackgroundWork(
    extension.codexBackgroundState,
    { trigger: 'automatic', now, reason: 'first-index' },
  ).state;
  extension.webviewProvider = {
    updateCodexProgress: (rendered: { reason?: unknown }) => {
      renders += 1;
      reasons.push(rendered.reason);
    },
  };
  const progress = (scannedFiles: number) => ({
    scannedFiles,
    totalFiles: 40,
    indexedBytes: scannedFiles * 1_024,
    totalBytes: 40 * 1_024,
    period: {},
  });
  Date.now = () => now;

  try {
    extension.onCodexIndexProgress(progress(1));
    now += 100;
    extension.onCodexIndexProgress(progress(2));
    assert.equal(renders, 1);
    assert.equal(extension.codexProgress.scannedFiles, 2);

    now += 150;
    extension.onCodexIndexProgress(progress(3));
    assert.equal(renders, 2);

    now += 1;
    extension.onCodexIndexProgress(progress(40));
    assert.equal(renders, 2);
    assert.equal(extension.codexProgress.scannedFiles, 40);
    assert.deepEqual(reasons, ['first-index', 'first-index']);
  } finally {
    Date.now = originalNow;
  }
});

test('overlapping Codex refresh triggers enter the provider lifecycle once with one strongest follow-up', async () => {
  const extension = bareExtension();
  const started: string[] = [];
  const coalescedCounts: number[] = [];
  let active = 0;
  let maxActive = 0;
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  extension.codexRefreshGate = new RefreshSingleFlight();
  extension.codexCoalescedTriggersSinceRefresh = 0;
  extension.waitForCodexProviderRetirements = async () => undefined;
  extension.runCodexRefresh = async (
    trigger: string,
    diagnosticContext: { coalescedTriggers: number },
  ) => {
    started.push(trigger);
    coalescedCounts.push(diagnosticContext.coalescedTriggers);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await blocker;
    active -= 1;
  };

  const requests = [
    extension.refreshCodexData('poll'),
    extension.refreshCodexData('watch'),
    extension.refreshCodexData('focus'),
    extension.refreshCodexData('manual'),
  ];
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(started, ['poll']);
  assert.equal(maxActive, 1);

  release();
  await Promise.all(requests);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(started, ['poll', 'manual']);
  assert.equal(
    coalescedCounts.reduce((total, count) => total + count, 0),
    3,
  );
  assert.equal(extension.codexCoalescedTriggersSinceRefresh, 0);
  assert.equal(maxActive, 1);
  assert.equal(extension.activeCodexRefreshes.size, 0);
});

test('Codex refresh single-flight releases the gate after an unexpected scheduler failure', async () => {
  const extension = bareExtension();
  const started: string[] = [];
  let fail = true;
  extension.runScheduledCodexRefresh = async (trigger: string) => {
    started.push(trigger);
    if (fail) {
      fail = false;
      throw new Error('scheduler failed');
    }
  };

  await assert.rejects(
    extension.refreshCodexData('poll'),
    /scheduler failed/,
  );
  await extension.refreshCodexData('manual');

  assert.deepEqual(started, ['poll', 'manual']);
  assert.equal(extension.codexRefreshDrain, null);
});

test('Codex refresh single-flight drops a queued follow-up after disposal begins', async () => {
  const extension = bareExtension();
  const started: string[] = [];
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  extension.runScheduledCodexRefresh = async (trigger: string) => {
    started.push(trigger);
    await blocker;
  };

  const first = extension.refreshCodexData('poll');
  const queued = extension.refreshCodexData('manual');
  await new Promise((resolve) => setImmediate(resolve));
  extension.disposed = true;
  release();
  await Promise.all([first, queued]);
  await extension.refreshCodexData('focus');

  assert.deepEqual(started, ['poll']);
  assert.equal(extension.codexRefreshDrain, null);
});

test('Codex refresh single-flight drops a queued follow-up across index teardown', async () => {
  const extension = bareExtension();
  const started: string[] = [];
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  extension.codexRefreshSuspensionDepth = 0;
  extension.runScheduledCodexRefresh = async (trigger: string) => {
    started.push(trigger);
    if (started.length === 1) await blocker;
  };

  const first = extension.refreshCodexData('poll');
  const queued = extension.refreshCodexData('manual');
  await new Promise((resolve) => setImmediate(resolve));
  extension.codexRefreshSuspensionDepth += 1;
  release();
  await Promise.all([first, queued]);

  assert.deepEqual(started, ['poll']);
  extension.codexRefreshSuspensionDepth -= 1;
  await extension.refreshCodexData('manual');
  assert.deepEqual(started, ['poll', 'manual']);
  assert.equal(extension.codexRefreshDrain, null);
});

test('Codex refresh parked on provider retirement stops when local data clearing begins', async () => {
  const extension = bareExtension();
  let finishRetirement!: () => void;
  const retirement = new Promise<void>((resolve) => {
    finishRetirement = resolve;
  });
  let providerRuns = 0;
  extension.waitForCodexProviderRetirements = async () => {
    await retirement;
  };
  extension.runCodexRefresh = async () => {
    providerRuns += 1;
  };

  const refresh = extension.refreshCodexData('poll');
  await new Promise((resolve) => setImmediate(resolve));
  extension.localDataClearedRequiresReload = true;
  finishRetirement();
  await refresh;

  assert.equal(providerRuns, 0);
  assert.equal(extension.codexRefreshDrain, null);
});

test('Codex refresh parked on provider retirement stops when index teardown begins', async () => {
  const extension = bareExtension();
  let finishRetirement!: () => void;
  const retirement = new Promise<void>((resolve) => {
    finishRetirement = resolve;
  });
  let providerRuns = 0;
  extension.waitForCodexProviderRetirements = async () => {
    await retirement;
  };
  extension.runCodexRefresh = async () => {
    providerRuns += 1;
  };

  const refresh = extension.refreshCodexData('poll');
  await new Promise((resolve) => setImmediate(resolve));
  extension.codexRefreshSuspensionDepth += 1;
  finishRetirement();
  await refresh;
  extension.codexRefreshSuspensionDepth -= 1;

  assert.equal(providerRuns, 0);
  assert.equal(extension.codexRefreshDrain, null);
});

test('Codex index teardown and the real refresh drain cannot revive a queued follow-up', async () => {
  const extension = bareExtension();
  const started: string[] = [];
  let releaseRefresh!: () => void;
  const refreshBlocker = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  extension.runCodexRefresh = async (trigger: string) => {
    started.push(trigger);
    if (started.length === 1) await refreshBlocker;
  };
  extension.waitForCodexProviderRetirements = async () => undefined;
  extension.stopCodexWatching = () => undefined;
  extension.cancelCodexProviderAndWait = async () => undefined;
  extension.releaseCodexOwnership = async () => undefined;
  extension.context.globalStorageUri = { fsPath: '/fixture/storage' };
  extension.removeDerivedFileFamilyWithLease = async () => undefined;
  extension.saveCodexBackgroundState = async () => undefined;
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.createCodexProvider = () => ({ dispose: async () => undefined });
  extension.syncProviderUi = () => undefined;
  extension.codexProvider = { dispose: async () => undefined };

  const first = extension.refreshCodexData('poll');
  await new Promise((resolve) => setImmediate(resolve));
  const queued = extension.refreshCodexData('manual');
  const clearing = extension.clearCodexDerivedIndex(false);
  assert.equal(extension.codexRefreshSuspensionDepth, 1);
  releaseRefresh();
  await Promise.all([first, queued, clearing]);

  assert.deepEqual(started, ['poll']);
  assert.equal(extension.codexRefreshSuspensionDepth, 0);
  assert.equal(extension.codexRefreshDrain, null);
  await extension.refreshCodexData('manual');
  assert.deepEqual(started, ['poll', 'manual']);
});

test('Codex index rebuild suspends refreshes until the replacement provider is installed', async () => {
  const extension = bareExtension();
  const calls: string[] = [];
  let finishRetirement!: () => void;
  const retirement = new Promise<void>((resolve) => {
    finishRetirement = resolve;
  });
  const retiring = {
    dispose: async () => {
      calls.push(`dispose:${extension.codexRefreshSuspensionDepth}`);
    },
  };
  extension.codexProvider = retiring;
  extension.windowActivity = new WindowActivityGate(true);
  extension.stopCodexWatching = () => {
    calls.push(`stop:${extension.codexRefreshSuspensionDepth}`);
  };
  extension.waitForCodexProviderRetirements = async () => {
    calls.push(`retire:${extension.codexRefreshSuspensionDepth}`);
    await retirement;
  };
  extension.cancelCodexProviderAndWait = async () => {
    calls.push(`cancel:${extension.codexRefreshSuspensionDepth}`);
  };
  extension.releaseCodexOwnership = async () => {
    calls.push(`release:${extension.codexRefreshSuspensionDepth}`);
  };
  extension.context.globalStorageUri = { fsPath: '/fixture/storage' };
  extension.removeDerivedFileFamilyWithLease = async () => {
    calls.push(`remove:${extension.codexRefreshSuspensionDepth}`);
  };
  extension.saveCodexBackgroundState = async () => {
    calls.push(`save:${extension.codexRefreshSuspensionDepth}`);
  };
  extension.createCodexProvider = () => {
    calls.push(`replace:${extension.codexRefreshSuspensionDepth}`);
    return { dispose: async () => undefined };
  };
  extension.syncProviderUi = () => {
    calls.push(`sync:${extension.codexRefreshSuspensionDepth}`);
  };
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.refreshCodexData = async (trigger: string) => {
    calls.push(`refresh:${trigger}:${extension.codexRefreshSuspensionDepth}`);
  };
  extension.startCodexWatching = () => {
    calls.push(`start:${extension.codexRefreshSuspensionDepth}`);
  };

  const clearing = extension.clearCodexDerivedIndex(true);
  assert.equal(extension.codexRefreshSuspensionDepth, 1);
  finishRetirement();
  await clearing;

  assert.deepEqual(calls, [
    'stop:1',
    'retire:1',
    'cancel:1',
    'dispose:1',
    'release:1',
    'remove:1',
    'save:1',
    'replace:1',
    'sync:1',
    'refresh:manual:0',
    'start:0',
  ]);
  assert.equal(extension.codexRefreshSuspensionDepth, 0);
});

test('Codex index teardown releases refresh suspension after a lifecycle failure', async () => {
  const extension = bareExtension();
  extension.stopCodexWatching = () => undefined;
  extension.waitForCodexProviderRetirements = async () => {
    throw new Error('retirement failed');
  };

  await assert.rejects(
    extension.clearCodexDerivedIndex(false),
    /retirement failed/,
  );

  assert.equal(extension.codexRefreshSuspensionDepth, 0);
});

test('cooldown, user pause, and completed measurement suppress historical backfill', async () => {
  const originalNow = Date.now;
  Date.now = () => 1_001;
  const snapshot = snapshotFixture();
  snapshot.coverage.complete = false;
  snapshot.coverage.indexedFiles = Math.max(0, snapshot.coverage.totalFiles - 1);
  const progress = {
    completedUnits: 1,
    totalUnits: 2,
    completedBytes: 10,
    totalBytes: 20,
  };
  const seed = createBackgroundWorkState({
    measurementVersion: 1,
    reason: 'history-backfill',
    now: 1_000,
    progress,
  });
  const running = beginBackgroundWork(seed, {
    trigger: 'automatic',
    now: 1_000,
  }).state;
  const states = [
    recordBackgroundWorkFailure(running, { now: 1_000 }),
    pauseBackgroundWork(seed, { now: 1_000 }),
    recordBackgroundWorkProgress(running, {
      now: 1_000,
      complete: true,
      progress,
    }),
  ];
  const allowed: boolean[] = [];

  try {
    for (const state of states) {
      const extension = bareExtension();
      extension.codexBackgroundState = state;
      extension.getConfiguration = () => ({ codexEnabled: true });
      extension.webviewProvider = { updateCodexProgress: () => undefined };
      extension.syncProviderUi = () => undefined;
      extension.codexProvider = {
        isAvailable: async () => true,
        loadPersistedSnapshot: async () => snapshot,
        refresh: async (
          _profile: string,
          _onProgress: unknown,
          allowHistoricalBackfill: boolean,
        ) => {
          allowed.push(allowHistoricalBackfill);
          return {
            outcome: 'partial',
            snapshot,
            diagnostic: {
              bodyReads: 0,
              failedFiles: 0,
              metadataMs: 0,
              parseMs: 0,
              migrationPending: true,
            },
          };
        },
      };

      await extension.runCodexRefresh('poll');
      assert.equal(extension.codexBackgroundState.status, state.status);
    }
  } finally {
    Date.now = originalNow;
  }

  assert.deepEqual(allowed, [false, false, false]);
});

test('a missing persisted index invalidates same-version complete background work', async () => {
  const extension = bareExtension();
  const completeSnapshot = snapshotFixture();
  const seed = createBackgroundWorkState({
    measurementVersion: 1,
    reason: 'history-backfill',
    now: 1,
    progress: {
      completedUnits: 1,
      totalUnits: 1,
      completedBytes: 1,
      totalBytes: 1,
    },
  });
  extension.codexBackgroundState = recordBackgroundWorkProgress(
    beginBackgroundWork(seed, { trigger: 'automatic', now: 1 }).state,
    {
      now: 2,
      complete: true,
      progress: seed.progress,
    },
  );
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.windowActivity = new WindowActivityGate(true);
  extension.webviewProvider = { updateCodexProgress: () => undefined };
  extension.syncProviderUi = () => undefined;
  let historicalAllowed: boolean | undefined;
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => null,
    refresh: async (
      _profile: string,
      _onProgress: unknown,
      allowHistoricalBackfill: boolean,
    ) => {
      historicalAllowed = allowHistoricalBackfill;
      return {
        outcome: 'success',
        snapshot: completeSnapshot,
        diagnostic: {
          bodyReads: 1,
          failedFiles: 0,
          metadataMs: 1,
          parseMs: 1,
          migrationPending: false,
        },
      };
    },
  };

  await extension.runCodexRefresh('startup');

  assert.equal(historicalAllowed, true);
  assert.equal(extension.codexBackgroundState.status, 'eligible');
});

test('a failed preflight state write never strands in-memory background work as running', async () => {
  const extension = bareExtension();
  const snapshot = snapshotFixture();
  snapshot.coverage.complete = false;
  snapshot.coverage.indexedFiles = Math.max(0, snapshot.coverage.totalFiles - 1);
  let writes = 0;
  extension.context.globalState.update = async () => {
    writes += 1;
    if (writes === 1) throw new Error('persistence unavailable');
  };
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.windowActivity = new WindowActivityGate(true);
  extension.webviewProvider = { updateCodexProgress: () => undefined };
  extension.syncProviderUi = () => undefined;
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => snapshot,
    refresh: async () => assert.fail('worker must not start before state is durable'),
  };

  await assert.rejects(extension.runCodexRefresh('poll'), /persistence unavailable/);

  assert.equal(extension.codexBackgroundState.status, 'eligible');
  assert.equal(extension.codexBackgroundState.reason, 'resume');
  assert.ok(writes >= 1);
});

test('background state writes are serialized and preserve their captured order', async () => {
  const extension = bareExtension();
  let finishFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { finishFirst = resolve; });
  const writes: Array<{ status: string; reason: string }> = [];
  extension.context.globalState.update = async (_key: string, value: any) => {
    writes.push({ status: value.status, reason: value.reason });
    if (writes.length === 1) await firstGate;
  };

  const first = extension.saveCodexBackgroundState();
  extension.codexBackgroundState = beginBackgroundWork(
    extension.codexBackgroundState,
    { trigger: 'automatic', now: 1, reason: 'first-index' },
  ).state;
  const second = extension.saveCodexBackgroundState();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [{ status: 'eligible', reason: 'first-index' }]);

  finishFirst();
  await Promise.all([first, second]);
  assert.deepEqual(writes, [
    { status: 'eligible', reason: 'first-index' },
    { status: 'running', reason: 'first-index' },
  ]);
});

test('a recovered index invalidates complete state and queues historical reconciliation', async () => {
  const extension = bareExtension();
  const pending = snapshotFixture();
  pending.coverage.complete = false;
  pending.coverage.indexedFiles = Math.max(0, pending.coverage.totalFiles - 1);
  const seed = createBackgroundWorkState({
    measurementVersion: 1,
    reason: 'history-backfill',
    now: 1,
    progress: {
      completedUnits: 1,
      totalUnits: 1,
      completedBytes: 1,
      totalBytes: 1,
    },
  });
  extension.codexBackgroundState = recordBackgroundWorkProgress(
    beginBackgroundWork(seed, { trigger: 'automatic', now: 1 }).state,
    { now: 2, complete: true, progress: seed.progress },
  );
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.windowActivity = new WindowActivityGate(true);
  extension.webviewProvider = { updateCodexProgress: () => undefined };
  extension.syncProviderUi = () => undefined;
  const continuations: string[] = [];
  extension.refreshCodexData = async (trigger: string) => {
    continuations.push(trigger);
  };
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => pending,
    refresh: async () => ({
      outcome: 'partial',
      snapshot: pending,
      diagnostic: {
        bodyReads: 0,
        failedFiles: 0,
        metadataMs: 1,
        parseMs: 1,
        migrationPending: true,
        indexRecovery: { reason: 'invalid-json' },
      },
    }),
  };

  await extension.runCodexRefresh('poll');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(extension.codexBackgroundState.status, 'eligible');
  assert.deepEqual(continuations, ['poll']);
});

test('successful historical progress queues one immediate continuation without a timer', async () => {
  const extension = bareExtension();
  const before = snapshotFixture();
  const after = structuredClone(before);
  before.coverage.complete = false;
  after.coverage.complete = false;
  before.coverage.indexedFiles = Math.max(0, before.coverage.totalFiles - 2);
  after.coverage.indexedFiles = Math.max(0, after.coverage.totalFiles - 1);
  before.coverage.indexedBytes = Math.max(0, before.coverage.totalBytes - 200);
  after.coverage.indexedBytes = Math.max(0, after.coverage.totalBytes - 100);
  const continuations: string[] = [];
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.windowActivity = new WindowActivityGate(true);
  extension.webviewProvider = { updateCodexProgress: () => undefined };
  extension.syncProviderUi = () => undefined;
  extension.refreshCodexData = async (trigger: string) => {
    continuations.push(trigger);
  };
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => before,
    refresh: async () => ({
      outcome: 'partial',
      snapshot: after,
      diagnostic: {
        bodyReads: 1,
        failedFiles: 0,
        metadataMs: 1,
        parseMs: 1,
        migrationPending: true,
      },
    }),
  };

  await extension.runCodexRefresh('startup');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(extension.codexBackgroundState.status, 'eligible');
  assert.deepEqual(continuations, ['startup']);
  assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
});

test('timer and watcher ownership clear only after their real handles stop', async () => {
  const extension = bareExtension();
  extension.refreshGen = 0;
  extension.watchDebounce = { clear: () => undefined };
  let fired = false;
  let watcherClosed = 0;
  const timer = setTimeout(() => { fired = true; }, 20);
  extension.refreshTimer = timer;
  extension.refreshTimerLease = extension.resourceOwnership.register({
    kind: 'timer',
    capability: 'refresh',
    scope: 'extension',
    creator: 'refresh-coordinator',
    stopConditions: ['window-blur'],
    boundedException: 'none',
  });
  extension.fileWatcher = {
    close: () => { watcherClosed += 1; },
  };
  extension.fileWatcherLease = extension.resourceOwnership.register({
    kind: 'watcher',
    capability: 'refresh',
    scope: 'claude',
    creator: 'extension',
    stopConditions: ['window-blur'],
    boundedException: 'none',
  });

  extension.stopAutoRefresh('window-blur');
  extension.stopFileWatching('window-blur');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(watcherClosed, 1);
  assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fired, false);
});

test('watch quiet-delay timers are owned and actually cancelled', async () => {
  const extension = bareExtension();
  extension.debounceTimerLeases = new Map();
  const debounce = extension.createOwnedRefreshDebounce('codex');
  let fired = false;

  debounce.push(20, () => { fired = true; });
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);
  debounce.clear();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fired, false);
});

test('backgrounding aborts an active quota network before releasing ownership', async () => {
  const extension = bareExtension();
  let observedSignal: AbortSignal | undefined;
  extension.cache = {
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 0,
  };
  extension.isActive = () => false;
  extension.apiClient = {
    fetchUsageLimits: (signal?: AbortSignal) => new Promise<null>((resolve) => {
      observedSignal = signal;
      assert.ok(signal);
      signal.addEventListener('abort', () => resolve(null), { once: true });
    }),
  };

  const pending = extension.maybeFetchUsageLimits({ usageLimitTracking: true });
  await Promise.resolve();
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 1);

  await extension.cancelQuotaNetworks('window-blur');
  assert.equal(observedSignal?.aborted, true);
  await pending;
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 0);
  assert.equal(extension.cache.usageLimitsFailStreak, 0);
});

test('network ownership remains active until an aborted request actually settles', async () => {
  const extension = bareExtension();
  let releaseRequest!: () => void;
  let aborted = false;
  const pending = extension.runAdviceNetwork((signal: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        releaseRequest = () => reject(new Error('request finally settled'));
      }, { once: true });
    }),
  );
  await Promise.resolve();
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 1);

  let cancellationSettled = false;
  const cancellation = extension.cancelAdviceNetworks('cancelled').then(() => {
    cancellationSettled = true;
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(aborted, true);
  assert.equal(cancellationSettled, false);
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 1);

  releaseRequest();
  await assert.rejects(pending, /finally settled/);
  await cancellation;
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 0);
});

test('advice consent cancellation aborts advice without cancelling a separate optimizer request', async () => {
  const extension = bareExtension();
  let adviceSignal!: AbortSignal;
  let optimizerSignal!: AbortSignal;
  const advice = extension.runAdviceNetwork((signal: AbortSignal) => {
    adviceSignal = signal;
    return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  }, 'advice');
  const optimizer = extension.runAdviceNetwork((signal: AbortSignal) => {
    optimizerSignal = signal;
    return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  }, 'optimizer');
  await extension.cancelAdviceNetworks('cancelled', 'advice');
  await advice;
  assert.equal(adviceSignal.aborted, true);
  assert.equal(optimizerSignal.aborted, false);
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 1);
  await extension.cancelAdviceNetworks('cancelled');
  await optimizer;
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 0);
});

test('quota cold retry timer is owned and cleared on blur', async () => {
  const extension = bareExtension();
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let cleared = 0;
  const fakeTimer = { fake: true } as unknown as NodeJS.Timeout;
  global.setTimeout = ((_callback: () => void, _ms: number) =>
    fakeTimer) as typeof setTimeout;
  global.clearTimeout = ((handle: NodeJS.Timeout) => {
    assert.equal(handle, fakeTimer);
    cleared += 1;
  }) as typeof clearTimeout;
  extension.windowActivity = new WindowActivityGate(true);
  extension.getConfiguration = () => ({ usageLimitTracking: true });
  extension.maybeFetchUsageLimits = async () => null;

  try {
    extension.scheduleQuotaColdRetry();
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);
    extension.stopQuotaColdRetry('window-blur');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(cleared, 1);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('extension disposal releases worker and backfill only after provider termination', async () => {
  const extension = bareExtension();
  let finishProviderDispose!: () => void;
  const providerDisposed = new Promise<void>((resolve) => {
    finishProviderDispose = resolve;
  });
  let providerCancelCalls = 0;
  let hostDisposals = 0;
  extension.stopAutoRefresh = () => undefined;
  extension.stopFileWatching = () => undefined;
  extension.stopCodexWatching = () => undefined;
  extension.stopCredentialsWatching = () => undefined;
  extension.codexProviderRetirements = new Set();
  extension.codexProvider = {
    cancel: () => { providerCancelCalls += 1; },
    dispose: () => providerDisposed,
  };
  extension.statusBar = { dispose: () => { hostDisposals += 1; } };
  extension.webviewProvider = { dispose: () => { hostDisposals += 1; } };
  extension.codexWorkerLease = extension.resourceOwnership.register({
    kind: 'worker',
    capability: 'codex-index',
    scope: 'codex',
    creator: 'codex-index-client',
    stopConditions: ['extension-dispose'],
    boundedException: 'none',
  });
  extension.codexBackfillLease = extension.resourceOwnership.register({
    kind: 'backfill',
    capability: 'codex-history',
    scope: 'codex',
    creator: 'refresh-coordinator',
    stopConditions: ['extension-dispose'],
    boundedException: 'first-codex-history',
  });

  let disposalSettled = false;
  const disposal = extension.dispose().then(() => {
    disposalSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(providerCancelCalls, 1);
  assert.equal(disposalSettled, false);
  assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 2);
  assert.equal(hostDisposals, 0);

  finishProviderDispose();
  await disposal;
  assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
  assert.equal(hostDisposals, 2);
});

test('extension disposal keeps worker ownership active when termination fails', async () => {
  const extension = bareExtension();
  let hostDisposals = 0;
  extension.stopAutoRefresh = () => undefined;
  extension.stopFileWatching = () => undefined;
  extension.stopCodexWatching = () => undefined;
  extension.stopCredentialsWatching = () => undefined;
  extension.codexProvider = {
    cancel: () => undefined,
    dispose: async () => { throw new Error('provider terminate failed'); },
  };
  extension.statusBar = { dispose: () => { hostDisposals += 1; } };
  extension.webviewProvider = { dispose: () => { hostDisposals += 1; } };
  extension.codexWorkerLease = extension.resourceOwnership.register({
    kind: 'worker',
    capability: 'codex-index',
    scope: 'codex',
    creator: 'codex-index-client',
    stopConditions: ['extension-dispose'],
    boundedException: 'none',
  });
  extension.codexBackfillLease = extension.resourceOwnership.register({
    kind: 'backfill',
    capability: 'codex-history',
    scope: 'codex',
    creator: 'refresh-coordinator',
    stopConditions: ['extension-dispose'],
    boundedException: 'first-codex-history',
  });

  await assert.rejects(extension.dispose(), /provider terminate failed/);

  assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 2);
  assert.equal(hostDisposals, 2);
});

test('a refresh termination failure retains its worker and backfill leases for disposal', async () => {
  const extension = bareExtension();
  const snapshot = snapshotFixture();
  snapshot.coverage.complete = false;
  snapshot.coverage.indexedFiles = Math.max(0, snapshot.coverage.totalFiles - 1);
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.windowActivity = new WindowActivityGate(true);
  extension.webviewProvider = { updateCodexProgress: () => undefined };
  extension.syncProviderUi = () => undefined;
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => snapshot,
    refresh: async () => { throw new Error('worker could not terminate'); },
  };

  await assert.rejects(extension.runCodexRefresh('poll'), /could not terminate/);

  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.worker, 1);
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.backfill, 1);
  assert.equal(extension.codexWorkerLease?.active, true);
  assert.equal(extension.codexBackfillLease?.active, true);
});

test('disposal drains every resource kind and stale callbacks cannot recreate work', async () => {
  const extension = bareExtension();
  let releaseNetwork!: () => void;
  let releaseProvider!: () => void;
  let releaseStaleCallbacks!: () => void;
  let watcherClosed = 0;
  let providerCancelled = 0;
  let hostDisposals = 0;
  const providerDisposal = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const staleCallbacks = new Promise<void>((resolve) => {
    releaseStaleCallbacks = resolve;
  });

  extension.windowActivity = new WindowActivityGate(true);
  extension.refreshGen = 0;
  extension.refreshTimer = setTimeout(() => assert.fail('disposed timer fired'), 60_000);
  extension.refreshTimerLease = extension.resourceOwnership.register({
    kind: 'timer',
    capability: 'refresh',
    scope: 'extension',
    creator: 'refresh-coordinator',
    stopConditions: ['extension-dispose'],
    boundedException: 'none',
  });
  extension.watchDebounce = { clear: () => undefined };
  extension.codexWatchDebounce = { clear: () => undefined };
  extension.fileWatcher = { close: () => { watcherClosed += 1; } };
  extension.fileWatcherLease = extension.resourceOwnership.register({
    kind: 'watcher',
    capability: 'refresh',
    scope: 'claude',
    creator: 'extension',
    stopConditions: ['extension-dispose'],
    boundedException: 'none',
  });
  extension.codexWatchers = [];
  extension.codexWorkerLease = extension.resourceOwnership.register({
    kind: 'worker',
    capability: 'codex-index',
    scope: 'codex',
    creator: 'codex-index-client',
    stopConditions: ['extension-dispose'],
    boundedException: 'none',
  });
  extension.codexBackfillLease = extension.resourceOwnership.register({
    kind: 'backfill',
    capability: 'codex-history',
    scope: 'codex',
    creator: 'refresh-coordinator',
    stopConditions: ['extension-dispose'],
    boundedException: 'first-codex-history',
  });
  extension.codexProvider = {
    cancel: () => { providerCancelled += 1; },
    dispose: () => providerDisposal,
  };
  extension.statusBar = { dispose: () => { hostDisposals += 1; } };
  extension.webviewProvider = { dispose: () => { hostDisposals += 1; } };
  extension.stopQuotaColdRetry = ClaudeCodeUsageExtension.prototype['stopQuotaColdRetry'];
  extension.stopAutoRefresh = ClaudeCodeUsageExtension.prototype['stopAutoRefresh'];
  extension.stopFileWatching = ClaudeCodeUsageExtension.prototype['stopFileWatching'];
  extension.stopCodexWatching = ClaudeCodeUsageExtension.prototype['stopCodexWatching'];
  extension.stopCredentialsWatching = () => undefined;

  const network = extension.runAdviceNetwork((signal: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        releaseNetwork = () => reject(new Error('network closed'));
      }, { once: true });
    }),
  ).catch(() => undefined);
  await Promise.resolve();
  assert.deepEqual(extension.resourceOwnership.snapshotForTests().byKind, {
    timer: 1,
    watcher: 1,
    worker: 1,
    network: 1,
    backfill: 1,
  });

  const stale = staleCallbacks.then(async () => {
    extension.startAutoRefresh();
    await extension.startFileWatching();
    extension.startCodexWatching();
    extension.scheduleQuotaColdRetry();
    await extension.refreshData(false, 'poll');
  });
  const disposal = extension.dispose();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(extension.resourceOwnership.snapshotForTests().byKind.network, 1);

  releaseStaleCallbacks();
  releaseNetwork();
  releaseProvider();
  await Promise.all([network, stale, disposal]);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(watcherClosed, 1);
  assert.equal(providerCancelled, 1);
  assert.equal(hostDisposals, 2);
  assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
  await assert.rejects(
    extension.runAdviceNetwork(async () => undefined),
    /disposed/i,
  );
  assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
});

test('Claude watcher is not created when the window loses focus during directory lookup', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-watch-focus-'));
  fs.mkdirSync(path.join(root, 'projects'));
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  const originalWatch = fs.watch;
  let resolveDirectory: ((value: string) => void) | undefined;
  let watchCalls = 0;
  extension.windowActivity = new WindowActivityGate(true);
  extension.watchDebounce = { clear: () => undefined };
  extension.fileWatcher = undefined;
  extension.watchedDir = null;
  extension.getConfiguration = () => ({
    fileWatchSeconds: 30,
    dataDirectory: '',
  });
  (ClaudeDataLoader as any).findClaudeDataDirectory = () => new Promise<string>((resolve) => {
    resolveDirectory = resolve;
  });
  (fs as any).watch = () => {
    watchCalls += 1;
    return { close: () => undefined };
  };

  try {
    const pending = extension.startFileWatching();
    extension.windowActivity.update(false);
    resolveDirectory?.(root);
    await pending;
    assert.equal(watchCalls, 0);
    assert.equal(extension.fileWatcher, undefined);
  } finally {
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
    (fs as any).watch = originalWatch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Claude watcher is not created after disposal or a stale settings generation', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-watch-dispose-'));
  fs.mkdirSync(path.join(root, 'projects'));
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  const originalWatch = fs.watch;
  let resolveDirectory!: (value: string) => void;
  let watchCalls = 0;
  extension.windowActivity = new WindowActivityGate(true);
  extension.watchDebounce = { clear: () => undefined };
  extension.fileWatcher = undefined;
  extension.watchedDir = null;
  extension.getConfiguration = () => ({
    fileWatchSeconds: 30,
    dataDirectory: '',
  });
  (ClaudeDataLoader as any).findClaudeDataDirectory = () => new Promise<string>((resolve) => {
    resolveDirectory = resolve;
  });
  (fs as any).watch = () => {
    watchCalls += 1;
    return { close: () => undefined };
  };

  try {
    const pending = extension.startFileWatching();
    extension.disposed = true;
    extension.fileWatcherGeneration += 1;
    resolveDirectory(root);
    await pending;
    assert.equal(watchCalls, 0);
    assert.equal(extension.fileWatcher, undefined);
  } finally {
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
    (fs as any).watch = originalWatch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Claude recursive watcher forwards nested subagent JSONL writes to a watch refresh', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-watch-subagent-'));
  fs.mkdirSync(path.join(root, 'projects'));
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  const originalWatch = fs.watch;
  let listener: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
  let watcherClosed = 0;
  const refreshes: Array<{ forceReload: boolean; trigger: string }> = [];
  extension.windowActivity = new WindowActivityGate(true);
  extension.watchDebounce = {
    clear: () => undefined,
    push: (_delay: number, callback: () => void) => callback(),
  };
  extension.fileWatcher = undefined;
  extension.fileWatcherLease = undefined;
  extension.watchedDir = null;
  extension.getConfiguration = () => ({
    fileWatchSeconds: 1,
    dataDirectory: '',
  });
  extension.refreshData = async (forceReload: boolean, trigger: string) => {
    refreshes.push({ forceReload, trigger });
  };
  (ClaudeDataLoader as any).findClaudeDataDirectory = async () => root;
  (fs as any).watch = (
    directory: string,
    options: { recursive?: boolean },
    callback: (eventType: string, filename: string | Buffer | null) => void,
  ) => {
    assert.equal(directory, path.join(root, 'projects'));
    assert.equal(options.recursive, true);
    listener = callback;
    return {
      close: () => { watcherClosed += 1; },
      on: () => undefined,
    };
  };

  try {
    await extension.startFileWatching();
    assert.ok(listener);
    listener('change', path.join('-fixture', 'session-root', 'subagents', 'agent-review.jsonl'));
    await Promise.resolve();
    assert.deepEqual(refreshes, [{ forceReload: false, trigger: 'watch' }]);

    listener('change', path.join('-fixture', 'session-root', 'subagents', 'agent-review.meta.json'));
    await Promise.resolve();
    assert.equal(refreshes.length, 1, 'non-JSONL metadata must not schedule a usage refresh');
  } finally {
    extension.stopFileWatching();
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
    (fs as any).watch = originalWatch;
    fs.rmSync(root, { recursive: true, force: true });
  }
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(watcherClosed, 1);
});

test('Claude watcher errors back off, recover, and cannot rearm after disposal', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-watch-error-'));
  fs.mkdirSync(path.join(root, 'projects'));
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  const originalWatch = fs.watch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const errorListeners: Array<(error: Error) => void> = [];
  const retryCallbacks: Array<() => void> = [];
  const retryDelays: number[] = [];
  const clearedTimers: number[] = [];
  let nextTimer = 0;
  let watchCalls = 0;
  let watcherClosed = 0;
  const diagnostics: string[] = [];
  extension.windowActivity = new WindowActivityGate(true);
  extension.watchDebounce = { clear: () => undefined };
  extension.fileWatcher = undefined;
  extension.fileWatcherLease = undefined;
  extension.watchedDir = null;
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  extension.getConfiguration = () => ({
    fileWatchSeconds: 1,
    dataDirectory: '',
  });
  (ClaudeDataLoader as any).findClaudeDataDirectory = async () => root;
  (fs as any).watch = () => {
    watchCalls += 1;
    const watcher = {
      close: () => { watcherClosed += 1; },
      on: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener);
        return watcher;
      },
    };
    return watcher;
  };
  globalThis.setTimeout = ((callback: () => void, milliseconds?: number) => {
    retryCallbacks.push(callback);
    retryDelays.push(milliseconds ?? 0);
    nextTimer += 1;
    return nextTimer as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: NodeJS.Timeout) => {
    clearedTimers.push(timer as unknown as number);
  }) as typeof clearTimeout;

  try {
    await extension.startFileWatching();
    assert.equal(watchCalls, 1);
    assert.equal(errorListeners.length, 1, 'the watcher must handle asynchronous fs.watch errors');

    errorListeners[0](Object.assign(new Error('watch resources exhausted'), { code: 'EMFILE' }));
    await extension.drainResourceStops();
    assert.equal(extension.fileWatcher, undefined);
    assert.equal(extension.watchedDir, null);
    assert.equal(watcherClosed, 1);
    assert.deepEqual(retryDelays, [1_000]);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);

    retryCallbacks[0]();
    await new Promise((resolve) => setImmediate(resolve));
    await extension.drainResourceStops();
    assert.equal(watchCalls, 2, 'the first retry rearms the watcher');
    assert.equal(errorListeners.length, 2);

    errorListeners[1](Object.assign(new Error('watch resources still exhausted'), { code: 'EMFILE' }));
    await extension.drainResourceStops();
    assert.deepEqual(retryDelays, [1_000, 2_000], 'consecutive failures back off instead of hot-looping');
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);

    retryCallbacks[1]();
    await new Promise((resolve) => setImmediate(resolve));
    await extension.drainResourceStops();
    assert.equal(watchCalls, 3, 'a later retry can recover');
    assert.ok(extension.fileWatcher);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 1);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 0);

    errorListeners[2](Object.assign(new Error('watch failed again'), { code: 'ENOSPC' }));
    await extension.drainResourceStops();
    assert.deepEqual(retryDelays, [1_000, 2_000, 4_000]);
    const staleRetry = retryCallbacks[2];
    extension.disposed = true;
    extension.stopFileWatching('extension-dispose');
    await extension.drainResourceStops();
    staleRetry();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(watchCalls, 3, 'a cancelled disposal retry cannot recreate a watcher');
    assert.deepEqual(clearedTimers, [3]);
    assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
    assert.match(diagnostics.join('\n'), /EMFILE/);
    assert.match(diagnostics.join('\n'), /ENOSPC/);
    assert.match(diagnostics.join('\n'), /poll/i);
  } finally {
    extension.stopFileWatching();
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
    (fs as any).watch = originalWatch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex watcher errors close the whole set and recover with bounded backoff', async () => {
  const extension = bareExtension();
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-codex-watch-error-'));
  fs.mkdirSync(path.join(codexHome, 'sessions'));
  fs.mkdirSync(path.join(codexHome, 'archived_sessions'));
  const originalWatch = fs.watch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const errorListeners: Array<(error: Error) => void> = [];
  const retryCallbacks: Array<() => void> = [];
  const retryDelays: number[] = [];
  const clearedTimers: number[] = [];
  const diagnostics: string[] = [];
  let nextTimer = 0;
  let watchCalls = 0;
  let watcherClosed = 0;

  extension.windowActivity = new WindowActivityGate(true);
  extension.codexWatchDebounce = { clear: () => undefined };
  extension.codexWatchers = [];
  extension.codexWatchedHome = null;
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  extension.getConfiguration = () => ({
    codexEnabled: true,
    codexFileWatchSeconds: 30,
  });
  extension.codexHome = () => codexHome;
  (fs as any).watch = () => {
    watchCalls += 1;
    const watcher = {
      close: () => { watcherClosed += 1; },
      on: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener);
        return watcher;
      },
    };
    return watcher;
  };
  globalThis.setTimeout = ((callback: () => void, milliseconds?: number) => {
    retryCallbacks.push(callback);
    retryDelays.push(milliseconds ?? 0);
    nextTimer += 1;
    return nextTimer as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: NodeJS.Timeout) => {
    clearedTimers.push(timer as unknown as number);
  }) as typeof clearTimeout;

  try {
    extension.startCodexWatching();
    assert.equal(watchCalls, 2);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 2);

    errorListeners[0](Object.assign(new Error('watch resources exhausted'), { code: 'EMFILE' }));
    await extension.drainResourceStops();
    assert.equal(watcherClosed, 2, 'one failed child watcher closes the entire Codex watcher set');
    assert.equal(extension.codexWatchers.length, 0);
    assert.deepEqual(retryDelays, [1_000]);

    retryCallbacks[0]();
    await extension.drainResourceStops();
    assert.equal(watchCalls, 4);
    assert.equal(extension.codexWatchers.length, 2);

    errorListeners[2](Object.assign(new Error('watch resources still exhausted'), { code: 'EMFILE' }));
    await extension.drainResourceStops();
    assert.deepEqual(retryDelays, [1_000, 2_000]);

    retryCallbacks[1]();
    await extension.drainResourceStops();
    assert.equal(watchCalls, 6, 'Codex watcher recovery eventually restores both roots');
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 2);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 0);

    errorListeners[4](Object.assign(new Error('watch failed again'), { code: 'ENOSPC' }));
    await extension.drainResourceStops();
    assert.deepEqual(retryDelays, [1_000, 2_000, 4_000]);
    const staleRetry = retryCallbacks[2];
    extension.disposed = true;
    extension.stopCodexWatching('extension-dispose');
    await extension.drainResourceStops();
    staleRetry();
    assert.equal(watchCalls, 6, 'a cancelled disposal retry cannot recreate Codex watchers');
    assert.deepEqual(clearedTimers, [3]);
    assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
    assert.match(diagnostics.join('\n'), /Codex/);
    assert.match(diagnostics.join('\n'), /poll/i);
  } finally {
    extension.stopCodexWatching();
    (fs as any).watch = originalWatch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('unchanged Claude history republishes Today and rolling 30 days at configured-zone midnight', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-midnight-'));
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  const usageLine = (id: string, timestamp: string, input: number): string =>
    JSON.stringify({
      type: 'assistant',
      timestamp,
      cwd: '/fixture/project',
      gitBranch: 'main',
      requestId: `request-${id}`,
      message: {
        id: `message-${id}`,
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: `answer-${id}` }],
        usage: {
          input_tokens: input,
          output_tokens: 1,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
        },
      },
    });
  fs.writeFileSync(
    path.join(project, 'session-root.jsonl'),
    [
      usageLine('rolling-boundary', '2030-02-09T04:00:00.000Z', 100),
      usageLine('today', '2030-03-10T15:30:00.000Z', 10),
    ].join('\n') + '\n',
    'utf8',
  );

  const originalNow = Date.now;
  const originalTimeZone = I18n.getTimezone();
  let now = Date.parse('2030-03-10T15:59:30.000Z');
  Date.now = () => now;
  I18n.setTimezone('Asia/Hong_Kong');
  extension.localDataClearedRequiresReload = false;
  extension.refreshGate = new RefreshSingleFlight();
  extension.quotaColdRetryDone = true;
  extension.cache = {
    records: [],
    contentAnalysis: null,
    claudeIndex: createClaudeUsageIndex(),
    manifest: null,
    lastUpdate: new Date(0),
    dataDirectory: null,
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 0,
  };
  extension.getConfiguration = () => ({
    dataDirectory: root,
    dashboardAutoRefresh: true,
    enableContentAnalysis: false,
    advicePromptWindowDays: 30,
    projectGroupingMode: 'git',
    contextWindowOverride: 0,
    timezone: 'Asia/Hong_Kong',
  });
  extension.refreshCodexData = () => undefined;
  extension.maybeFetchUsageLimits = async () => null;
  extension.syncProviderUi = () => undefined;
  const diagnostics: string[] = [];
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  const statusTodaySnapshots: number[] = [];
  extension.statusBar = {
    setLoading: () => undefined,
    updateQuota: () => undefined,
    updateContext: () => undefined,
    updateUsageData: (
      today: { totalInputTokens?: number } | null,
      _workspaceToday: unknown,
      _error: unknown,
      _limits: unknown,
      _month: unknown,
    ) => statusTodaySnapshots.push(today?.totalInputTokens ?? 0),
  };
  const dashboardSnapshots: Array<{ today: number; rolling30: number }> = [];
  extension.webviewProvider = {
    setLoading: () => undefined,
    updateQuota: () => undefined,
    updateData: (
      _session: unknown,
      today: { totalInputTokens?: number } | null,
      rolling30: { totalInputTokens?: number } | null,
    ) => dashboardSnapshots.push({
      today: today?.totalInputTokens ?? 0,
      rolling30: rolling30?.totalInputTokens ?? 0,
    }),
  };

  try {
    await extension.refreshData(true, 'manual');
    now = Date.parse('2030-03-10T16:00:30.000Z');
    await extension.refreshData(false, 'poll');

    assert.equal(dashboardSnapshots.length, 2);
    assert.equal(statusTodaySnapshots.length, 2);
    assert.deepEqual(dashboardSnapshots, [
      { today: 10, rolling30: 110 },
      { today: 0, rolling30: 10 },
    ]);
    assert.deepEqual(statusTodaySnapshots, [10, 0]);
    assert.equal(extension.cache.records.length, 2);
    assert.match(diagnostics[diagnostics.length - 1], /changed=0/);
    assert.match(diagnostics[diagnostics.length - 1], /io\(bytes=0 lines=0\)/);
  } finally {
    Date.now = originalNow;
    I18n.setTimezone(originalTimeZone);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('credentials watcher counts unnamed events without exposing filenames', async () => {
  const extension = bareExtension();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-credentials-watch-event-'));
  const originalWatch = fs.watch;
  let listener: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
  let watcherClosed = 0;
  extension.windowActivity = new WindowActivityGate(true);
  extension.getConfiguration = () => ({ usageLimitTracking: true });
  extension.apiClient = {
    getCredentialsPath: () => path.join(profile, '.credentials.json'),
  };
  (fs as any).watch = (
    directory: string,
    callback: (eventType: string, filename: string | Buffer | null) => void,
  ) => {
    assert.equal(directory, profile);
    listener = callback;
    const watcher = {
      close: () => { watcherClosed += 1; },
      on: () => watcher,
    };
    return watcher;
  };

  try {
    extension.startCredentialsWatching();
    assert.ok(listener);
    listener('rename', null);
    listener('change', 'unrelated.json');
    assert.equal(extension.credentialsWatcherMissingFilenameEventsSinceRefresh, 1);
  } finally {
    extension.stopCredentialsWatching();
    await extension.drainResourceStops();
    (fs as any).watch = originalWatch;
    fs.rmSync(profile, { recursive: true, force: true });
  }
  assert.equal(watcherClosed, 1);
});

test('credentials watcher errors reuse bounded recovery and cannot rearm after disposal', async () => {
  const extension = bareExtension();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-credentials-watch-error-'));
  const originalWatch = fs.watch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const errorListeners: Array<(error: Error) => void> = [];
  const retryCallbacks: Array<() => void> = [];
  const retryDelays: number[] = [];
  const clearedTimers: number[] = [];
  const diagnostics: string[] = [];
  let nextTimer = 0;
  let watchCalls = 0;
  let watcherClosed = 0;

  extension.windowActivity = new WindowActivityGate(true);
  extension.getConfiguration = () => ({ usageLimitTracking: true });
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  extension.apiClient = {
    getCredentialsPath: () => path.join(profile, '.credentials.json'),
  };
  (fs as any).watch = () => {
    watchCalls += 1;
    const watcher = {
      close: () => { watcherClosed += 1; },
      on: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener);
        return watcher;
      },
    };
    return watcher;
  };
  globalThis.setTimeout = ((callback: () => void, milliseconds?: number) => {
    retryCallbacks.push(callback);
    retryDelays.push(milliseconds ?? 0);
    nextTimer += 1;
    return nextTimer as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: NodeJS.Timeout) => {
    clearedTimers.push(timer as unknown as number);
  }) as typeof clearTimeout;

  try {
    extension.startCredentialsWatching();
    assert.equal(watchCalls, 1);
    assert.equal(errorListeners.length, 1, 'the watcher must handle asynchronous fs.watch errors');

    errorListeners[0](Object.assign(new Error('credentials watch resources exhausted'), { code: 'EMFILE' }));
    await extension.drainResourceStops();
    assert.equal(extension.credsWatcher, undefined);
    assert.equal(watcherClosed, 1);
    assert.deepEqual(retryDelays, [1_000]);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);

    retryCallbacks[0]();
    await extension.drainResourceStops();
    assert.equal(watchCalls, 2, 'the first retry rearms the credentials watcher');
    assert.equal(errorListeners.length, 2);

    errorListeners[1](Object.assign(new Error('credentials watch resources still exhausted'), { code: 'ENOSPC' }));
    await extension.drainResourceStops();
    assert.deepEqual(retryDelays, [1_000, 2_000], 'consecutive failures back off instead of hot-looping');

    const staleRetry = retryCallbacks[1];
    extension.disposed = true;
    extension.stopCredentialsWatching('extension-dispose');
    await extension.drainResourceStops();
    staleRetry();
    assert.equal(watchCalls, 2, 'a cancelled disposal retry cannot recreate the watcher');
    assert.deepEqual(clearedTimers, [2]);
    assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
    assert.match(diagnostics.join('\n'), /Claude credentials/);
    assert.match(diagnostics.join('\n'), /EMFILE/);
    assert.match(diagnostics.join('\n'), /ENOSPC/);
    assert.match(diagnostics.join('\n'), /poll/i);
    assert.doesNotMatch(diagnostics.join('\n'), new RegExp(profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    extension.stopCredentialsWatching();
    (fs as any).watch = originalWatch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('credentials watcher recovery keeps one bounded timer across repeated missing-directory retries', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-credentials-watch-missing-'));
  const profile = path.join(root, 'profile');
  fs.mkdirSync(profile);
  const originalWatch = fs.watch;
  const timers = installManualTimers();
  const errorListeners: Array<(error: Error) => void> = [];
  const diagnostics: string[] = [];
  let watchCalls = 0;
  let watcherClosed = 0;

  extension.windowActivity = new WindowActivityGate(true);
  extension.getConfiguration = () => ({ usageLimitTracking: true });
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  extension.apiClient = {
    getCredentialsPath: () => path.join(profile, '.credentials.json'),
  };
  (fs as any).watch = () => {
    watchCalls += 1;
    const watcher = {
      close: () => { watcherClosed += 1; },
      on: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener);
        return watcher;
      },
    };
    return watcher;
  };

  try {
    extension.startCredentialsWatching();
    errorListeners[0](Object.assign(new Error('watch failed'), { code: 'EMFILE' }));
    errorListeners[0](Object.assign(new Error('duplicate stale error'), { code: 'ENOSPC' }));
    await extension.drainResourceStops();
    fs.rmSync(profile, { recursive: true, force: true });

    assert.deepEqual(timers.scheduled.map((timer) => timer.delayMs), [1_000]);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 0);

    timers.scheduled[0].callback();
    await extension.drainResourceStops();
    assert.deepEqual(timers.scheduled.map((timer) => timer.delayMs), [1_000, 2_000]);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 0);

    timers.scheduled[0].callback();
    timers.scheduled[1].callback();
    await extension.drainResourceStops();
    assert.deepEqual(timers.scheduled.map((timer) => timer.delayMs), [1_000, 2_000, 4_000]);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 1);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 0);
    assert.equal(watchCalls, 1);
    assert.equal(watcherClosed, 1);
    assert.doesNotMatch(
      diagnostics.join('\n'),
      new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  } finally {
    extension.stopCredentialsWatching();
    await extension.drainResourceStops();
    (fs as any).watch = originalWatch;
    timers.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('credentials watcher recovery restores exactly one watcher after the directory returns', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-credentials-watch-return-'));
  const profile = path.join(root, 'profile');
  fs.mkdirSync(profile);
  const originalWatch = fs.watch;
  const timers = installManualTimers();
  const errorListeners: Array<(error: Error) => void> = [];
  let watchCalls = 0;
  let watcherClosed = 0;

  extension.windowActivity = new WindowActivityGate(true);
  extension.getConfiguration = () => ({ usageLimitTracking: true });
  extension.apiClient = {
    getCredentialsPath: () => path.join(profile, '.credentials.json'),
  };
  (fs as any).watch = () => {
    watchCalls += 1;
    const watcher = {
      close: () => { watcherClosed += 1; },
      on: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener);
        return watcher;
      },
    };
    return watcher;
  };

  try {
    extension.startCredentialsWatching();
    errorListeners[0](Object.assign(new Error('watch failed'), { code: 'EMFILE' }));
    await extension.drainResourceStops();
    fs.rmSync(profile, { recursive: true, force: true });

    timers.scheduled[0].callback();
    await extension.drainResourceStops();
    fs.mkdirSync(profile);
    timers.scheduled[1].callback();
    await extension.drainResourceStops();

    assert.equal(watchCalls, 2);
    assert.equal(watcherClosed, 1);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.timer, 0);
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 1);

    timers.scheduled[0].callback();
    timers.scheduled[1].callback();
    await extension.drainResourceStops();
    assert.equal(watchCalls, 2, 'stale retry callbacks cannot create duplicate watchers');
    assert.equal(extension.resourceOwnership.snapshotForTests().byKind.watcher, 1);
  } finally {
    extension.stopCredentialsWatching();
    await extension.drainResourceStops();
    (fs as any).watch = originalWatch;
    timers.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('credentials watcher recovery stops when quota tracking is disabled before retry', async () => {
  const extension = bareExtension();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-credentials-watch-disabled-'));
  const originalWatch = fs.watch;
  const timers = installManualTimers();
  const errorListeners: Array<(error: Error) => void> = [];
  let usageLimitTracking = true;
  let watchCalls = 0;

  extension.windowActivity = new WindowActivityGate(true);
  extension.getConfiguration = () => ({ usageLimitTracking });
  extension.apiClient = {
    getCredentialsPath: () => path.join(profile, '.credentials.json'),
  };
  (fs as any).watch = () => {
    watchCalls += 1;
    const watcher = {
      close: () => undefined,
      on: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener);
        return watcher;
      },
    };
    return watcher;
  };

  try {
    extension.startCredentialsWatching();
    errorListeners[0](Object.assign(new Error('watch failed'), { code: 'EMFILE' }));
    await extension.drainResourceStops();
    usageLimitTracking = false;

    timers.scheduled[0].callback();
    await extension.drainResourceStops();
    assert.equal(watchCalls, 1);
    assert.equal(timers.scheduled.length, 1, 'disabled quota tracking cannot schedule another retry');
    assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
  } finally {
    extension.stopCredentialsWatching();
    await extension.drainResourceStops();
    (fs as any).watch = originalWatch;
    timers.restore();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('credentials watcher recovery callbacks stay cancelled after blur, profile switch, and disposal', async (t) => {
  for (const scenario of [
    { name: 'window blur', condition: 'window-blur', deactivate: (extension: any) => extension.windowActivity.update(false) },
    { name: 'profile switch', condition: 'profile-change', deactivate: () => undefined },
    { name: 'extension disposal', condition: 'extension-dispose', deactivate: (extension: any) => { extension.disposed = true; } },
  ] as const) {
    await t.test(scenario.name, async () => {
      const extension = bareExtension();
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-credentials-watch-cancel-'));
      const originalWatch = fs.watch;
      const timers = installManualTimers();
      const errorListeners: Array<(error: Error) => void> = [];
      let watchCalls = 0;

      extension.windowActivity = new WindowActivityGate(true);
      extension.getConfiguration = () => ({ usageLimitTracking: true });
      extension.apiClient = {
        getCredentialsPath: () => path.join(profile, '.credentials.json'),
      };
      (fs as any).watch = () => {
        watchCalls += 1;
        const watcher = {
          close: () => undefined,
          on: (event: string, listener: (error: Error) => void) => {
            if (event === 'error') errorListeners.push(listener);
            return watcher;
          },
        };
        return watcher;
      };

      try {
        extension.startCredentialsWatching();
        errorListeners[0](Object.assign(new Error('watch failed'), { code: 'EMFILE' }));
        await extension.drainResourceStops();
        const staleRetry = timers.scheduled[0].callback;

        scenario.deactivate(extension);
        extension.stopCredentialsWatching(scenario.condition);
        await extension.drainResourceStops();
        staleRetry();
        await extension.drainResourceStops();

        assert.equal(watchCalls, 1);
        assert.deepEqual(timers.cleared, [1]);
        assert.equal(extension.resourceOwnership.snapshotForTests().activeCount, 0);
      } finally {
        extension.stopCredentialsWatching(
          scenario.condition === 'extension-dispose' ? 'extension-dispose' : 'settings-change',
        );
        await extension.drainResourceStops();
        (fs as any).watch = originalWatch;
        timers.restore();
        fs.rmSync(profile, { recursive: true, force: true });
      }
    });
  }
});

test('Codex diagnostics retain trigger, watcher coalescing, backfill, and worker mode', async () => {
  const extension = bareExtension();
  const snapshot = snapshotFixture();
  const diagnostics: string[] = [];
  extension.codexWatcherEventsSinceRefresh = 7;
  extension.codexCoalescedTriggersSinceRefresh = 5;
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.windowActivity = new WindowActivityGate(true);
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  extension.webviewProvider = { updateCodexProgress: () => undefined };
  extension.syncProviderUi = () => undefined;
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => snapshot,
    refresh: async (workerMode: string, _onProgress: unknown, historical: boolean) => {
      assert.equal(workerMode, 'foreground');
      assert.equal(historical, true);
      return {
        outcome: 'success',
        snapshot,
        diagnostic: {
          bodyReads: 0,
          failedFiles: 0,
          metadataMs: 1,
          parseMs: 2,
          migrationPending: false,
        },
      };
    },
  };

  await extension.runCodexRefresh('manual');

  assert.match(
    diagnostics.join('\n'),
    /codex-index trigger=manual outcome=success mode\(backfill=historical worker=foreground\) events\(watcher=7 coalesced=5\)/,
  );
  assert.equal(extension.codexWatcherEventsSinceRefresh, 0);
  assert.equal(extension.codexCoalescedTriggersSinceRefresh, 0);
});

test('Claude refresh diagnostics drain the unnamed quota-watcher event count', async () => {
  const extension = bareExtension();
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  const diagnostics: string[] = [];
  extension.refreshGate = new RefreshSingleFlight();
  extension.credentialsWatcherMissingFilenameEventsSinceRefresh = 3;
  extension.cache = {
    manifest: null,
    usageLimits: {},
  };
  extension.getConfiguration = () => ({ dashboardAutoRefresh: false });
  extension.maybeFetchUsageLimits = async () => ({});
  extension.refreshCodexData = async () => undefined;
  extension.statusBar = {
    updateQuota: () => undefined,
    updateUsageData: () => undefined,
    updateContext: () => undefined,
  };
  extension.webviewProvider = { updateQuota: () => undefined };
  extension.syncProviderUi = () => undefined;
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  (ClaudeDataLoader as any).findClaudeDataDirectory = async () => null;

  try {
    await extension.refreshData(false, 'credentials');
  } finally {
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
  }

  assert.match(diagnostics.join('\n'), /refresh: trigger=credentials/);
  assert.match(diagnostics.join('\n'), /events\(watcher=0 coalesced=0 quota-unnamed=3\)/);
  assert.equal(extension.credentialsWatcherMissingFilenameEventsSinceRefresh, 0);
});

test('a failing provider UI cannot reject refreshes or strand the pending refresh gate', async () => {
  const extension = bareExtension();
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  let scans = 0;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  extension.refreshGate = new RefreshSingleFlight();
  extension.cache = { manifest: null, usageLimits: {} };
  extension.getConfiguration = () => ({ dashboardAutoRefresh: false });
  extension.maybeFetchUsageLimits = async () => ({});
  extension.refreshCodexData = async () => undefined;
  extension.statusBar = { updateQuota: () => undefined, updateUsageData: () => undefined, updateContext: () => undefined };
  extension.webviewProvider.updateData = () => undefined;
  extension.syncProviderUi = () => { throw new Error('synthetic-only UI failure'); };
  (ClaudeDataLoader as any).findClaudeDataDirectory = async () => {
    scans += 1;
    if (scans === 1) await wait;
    return null;
  };
  try {
    const first = extension.refreshData(false, 'poll');
    await extension.refreshData(false, 'watch');
    release();
    await assert.doesNotReject(first);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(scans, 2, 'the coalesced pending request must still run');
    await extension.refreshData(false, 'manual');
    assert.equal(scans, 3, 'subsequent refreshes must not remain permanently busy');
  } finally {
    release();
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
  }
});

test('Codex refreshes keep provider work and the drain alive despite persistent UI exceptions', async () => {
  const extension = bareExtension();
  const diagnostics: string[] = [];
  let refreshes = 0;
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.syncProviderUi = () => { throw new Error('synthetic-only renderer failure'); };
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  extension.codexProvider = {
    isAvailable: async () => true,
    loadPersistedSnapshot: async () => null,
    refresh: async () => { refreshes += 1; return { outcome: 'unavailable' }; },
  };
  await assert.doesNotReject(extension.refreshCodexData('watch'));
  await assert.doesNotReject(extension.refreshCodexData('manual'));
  assert.equal(refreshes, 2, 'UI errors must not prevent provider work');
  assert.equal(extension.activeCodexRefreshes.size, 0);
  assert.equal(extension.codexRefreshing, false);
  assert.equal(diagnostics.filter(line => line.includes('provider-ui-sync-failed')).length, 1);
  assert.ok(diagnostics.every(line => !line.includes('synthetic-only')));
});

test('Codex provider errors plus a failing error UI cannot create an unhandled rejection', async () => {
  const extension = bareExtension();
  extension.getConfiguration = () => ({ codexEnabled: true });
  extension.syncProviderUi = () => { throw new Error('synthetic-only renderer failure'); };
  extension.codexProvider = { isAvailable: async () => { throw new Error('synthetic-only provider failure'); } };
  await assert.doesNotReject(extension.refreshCodexData('watch'));
  await assert.doesNotReject(extension.refreshCodexData('manual'));
  assert.equal(extension.activeCodexRefreshes.size, 0);
  assert.equal(extension.codexRefreshDrain, null);
});

test('Claude commits a verified index even when rendering its new snapshot throws', async () => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-render-fault-'));
  const project = path.join(root, 'projects', '-fixture');
  const file = path.join(project, 'session.jsonl');
  const row = (id: string) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
    requestId: id, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } });
  const diagnostics: string[] = [];
  extension.refreshGate = new RefreshSingleFlight();
  extension.cache = { records: [], contentAnalysis: null, manifest: null, claudeIndex: createClaudeUsageIndex(),
    lastUpdate: new Date(0), dataDirectory: null, usageLimits: null };
  extension.quotaColdRetryDone = true;
  extension.getConfiguration = () => ({ dataDirectory: root, dashboardAutoRefresh: true,
    enableContentAnalysis: false, advicePromptWindowDays: 30, projectGroupingMode: 'flat', contextWindowOverride: 0 });
  extension.maybeFetchUsageLimits = async () => null;
  extension.refreshCodexData = async () => undefined;
  extension.syncProviderUi = () => { throw new Error('synthetic-only renderer failure'); };
  extension.statusBar = { setLoading: () => undefined, updateQuota: () => undefined,
    updateUsageData: () => undefined, updateContext: () => undefined };
  extension.webviewProvider = { setLoading: () => undefined, updateQuota: () => undefined,
    updateData: () => { throw new Error('synthetic-only new-snapshot render failure'); } };
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  try {
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(file, row('cold') + '\n');
    await assert.doesNotReject(extension.refreshData(false, 'watch'));
    assert.equal(extension.cache.records.length, 1);
    fs.appendFileSync(file, row('tail') + '\n');
    await assert.doesNotReject(extension.refreshData(false, 'watch'));
    assert.equal(extension.cache.records.length, 2);
    assert.equal(extension.cache.claudeIndex.aggregates.allTime.totalInputTokens, 20);
    await assert.doesNotReject(extension.refreshData(false, 'watch'));
    assert.match(diagnostics[diagnostics.length - 1] ?? '', /bytes=0/);
    assert.equal(diagnostics.filter(line => line.includes('provider-ui-sync-failed')).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real Claude filesystem events flow through manifest, index, and dashboard refresh', {
  timeout: 15_000,
}, async (t) => {
  const extension = bareExtension();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-watch-e2e-'));
  const project = path.join(root, 'projects', '-fixture');
  const subagents = path.join(project, 'session-root', 'subagents');
  fs.mkdirSync(subagents, { recursive: true });
  const timestamp = new Date().toISOString();
  const usageLine = (id: string, input: number): string => JSON.stringify({
    type: 'assistant',
    timestamp,
    cwd: '/fixture/project',
    gitBranch: 'main',
    requestId: `request-${id}`,
    message: {
      id: `message-${id}`,
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: `answer-${id}` }],
      usage: {
        input_tokens: input,
        output_tokens: 1,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
    },
  });
  const initialFile = path.join(project, 'session-root.jsonl');
  const nestedFile = path.join(subagents, 'agent-review.jsonl');
  fs.writeFileSync(initialFile, `${usageLine('root', 10)}\n`, 'utf8');

  extension.windowActivity = new WindowActivityGate(true);
  extension.localDataClearedRequiresReload = false;
  extension.refreshGate = new RefreshSingleFlight();
  extension.watchDebounce = {
    clear: () => undefined,
    push: (_delay: number, callback: () => void) => callback(),
  };
  extension.fileWatcher = undefined;
  extension.fileWatcherLease = undefined;
  extension.watchedDir = null;
  extension.quotaColdRetryDone = true;
  extension.cache = {
    records: [],
    contentAnalysis: null,
    claudeIndex: createClaudeUsageIndex(),
    manifest: null,
    lastUpdate: new Date(0),
    dataDirectory: null,
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 0,
  };
  extension.getConfiguration = () => ({
    dataDirectory: root,
    fileWatchSeconds: 1,
    dashboardAutoRefresh: true,
    enableContentAnalysis: false,
    advicePromptWindowDays: 30,
    projectGroupingMode: 'git',
    contextWindowOverride: 0,
  });
  extension.refreshCodexData = () => undefined;
  extension.maybeFetchUsageLimits = async () => null;
  extension.syncProviderUi = () => undefined;
  const diagnostics: string[] = [];
  extension.outputChannel = { appendLine: (line: string) => diagnostics.push(line) };
  extension.statusBar = {
    setLoading: () => undefined,
    updateQuota: () => undefined,
    updateUsageData: () => undefined,
    updateContext: () => undefined,
  };

  let resolveNestedRefresh!: () => void;
  const nestedRefresh = new Promise<void>((resolve) => {
    resolveNestedRefresh = resolve;
  });
  const todayInputs: number[] = [];
  const allTimeInputs: number[] = [];
  extension.webviewProvider = {
    setLoading: () => undefined,
    updateQuota: () => undefined,
    updateData: (
      _session: unknown,
      today: { totalInputTokens?: number } | null,
      _last30Days: unknown,
      allTime: { totalInputTokens?: number } | null,
      _dailyForLast30Days: unknown,
      _monthlyForAllTime: unknown,
      _hourlyForToday: unknown,
      error?: string,
    ) => {
      const input = today?.totalInputTokens ?? 0;
      todayInputs.push(input);
      allTimeInputs.push(allTime?.totalInputTokens ?? 0);
      if (error) diagnostics.push(error);
      if (input === 30) resolveNestedRefresh();
    },
  };

  try {
    await extension.refreshData(true, 'manual');
    assert.equal(
      todayInputs[todayInputs.length - 1],
      10,
      `allTime=${allTimeInputs[allTimeInputs.length - 1]} records=${extension.cache.records.length} diagnostics=${diagnostics.join(' | ')}`,
    );

    await extension.startFileWatching();
    if (!extension.fileWatcher) {
      t.skip('recursive fs.watch is not supported on this platform');
      return;
    }
    const activeWatcher = extension.fileWatcher as fs.FSWatcher;

    // Recursive fs.watch can drop the first event for a just-created nested
    // file while macOS is attaching its directory handle. Rewriting that
    // same test-only file exercises the real watcher path until it observes
    // the change; no synthetic callback or polling-based refresh is used.
    const nestedBody = `${usageLine('subagent', 20)}\n`;
    let rewrite: ReturnType<typeof setInterval> | undefined;
    const outcomePromise = new Promise<'refreshed' | 'watch-error'>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (rewrite) clearInterval(rewrite);
        reject(new Error('timed out waiting for nested Claude refresh'));
      }, 8_000);
      nestedRefresh.then(() => {
        clearTimeout(timeout);
        if (rewrite) clearInterval(rewrite);
        resolve('refreshed');
      });
      activeWatcher.once('error', () => {
        clearTimeout(timeout);
        if (rewrite) clearInterval(rewrite);
        resolve('watch-error');
      });
      fs.writeFileSync(nestedFile, nestedBody, 'utf8');
      rewrite = setInterval(() => fs.writeFileSync(nestedFile, nestedBody, 'utf8'), 250);
    });
    const outcome = await outcomePromise;
    if (outcome === 'watch-error') {
      t.skip('the test host cannot allocate a recursive fs.watch handle');
      return;
    }

    assert.equal(todayInputs[todayInputs.length - 1], 30);
    assert.equal(extension.cache.records.length, 2);
    assert.equal(extension.cache.manifest?.entries.size, 2);
  } finally {
    extension.stopFileWatching();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rapid settings changes wait for every provider retirement and only latest generation restarts', async () => {
  const extension = bareExtension();
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  const firstDisposal = new Promise<void>((resolve) => { finishFirst = resolve; });
  const secondDisposal = new Promise<void>((resolve) => { finishSecond = resolve; });
  const calls: string[] = [];
  const provider = (name: string, disposal: Promise<void>) => ({
    cancel: () => calls.push(`${name}:cancel`),
    dispose: () => disposal,
  });
  const first = provider('first', firstDisposal);
  const second = provider('second', secondDisposal);
  const third = provider('third', Promise.resolve());
  const replacements = [second, third];
  extension.codexProvider = first;
  extension.windowActivity = new WindowActivityGate(true);
  extension.webviewProvider = {
    invalidatePreparedAiRequests: () => undefined,
  };
  extension.statusBar = {
    setVisibility: () => undefined,
  };
  extension.getConfiguration = () => ({
    language: 'en',
    decimalPlaces: 2,
    tokenDecimalPlaces: 0,
    compactNumbers: true,
    timezone: 'UTC',
    showCost: true,
    showContext: true,
    usageLimitTracking: false,
    statusBarMetric: 'tokens',
    showScopedWeekly: false,
    quotaFiveHourOnly: false,
    showResetInStatusBar: false,
    resetCountdownFormat: 'short',
    dataDirectory: '',
  });
  extension.cancelAdviceNetworks = async () => undefined;
  extension.cancelQuotaNetworks = async () => undefined;
  extension.stopQuotaColdRetry = () => undefined;
  extension.startAutoRefresh = () => undefined;
  extension.stopFileWatching = () => undefined;
  extension.stopCodexWatching = () => undefined;
  extension.stopCredentialsWatching = () => undefined;
  extension.selectClaudeProfile = () => undefined;
  extension.createCodexProvider = () => replacements.shift();
  extension.refreshData = async () => { calls.push('refresh'); };
  extension.startFileWatching = async () => { calls.push('claude:start'); };
  extension.startCodexWatching = () => { calls.push('codex:start'); };
  extension.startCredentialsWatching = () => { calls.push('credentials:start'); };

  extension.onConfigurationChanged();
  extension.onConfigurationChanged();
  finishSecond();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls.filter((call) => call === 'refresh'), []);

  finishFirst();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.filter((call) => call === 'refresh'), ['refresh']);
  assert.equal(calls.filter((call) => call === 'claude:start').length, 1);
  assert.equal(calls.filter((call) => call === 'codex:start').length, 1);
  assert.equal(calls.filter((call) => call === 'credentials:start').length, 1);
});

test('credentials change clears quota failure backoff before refreshing', async () => {
  const extension = bareExtension();
  const calls: string[] = [];
  extension.cache = {
    usageLimitsLastUpdate: new Date(123_000),
    usageLimitsFailStreak: 6,
    usageLimitsBackoffUntil: new Date(9_999_999),
  };
  extension.refreshData = (_force: boolean, trigger: string) => {
    calls.push(`refresh:${trigger}`);
    return Promise.resolve();
  };
  extension.webviewProvider = {
    updateWeeklyQuotaHistory: () => undefined,
  };

  extension.handleCredentialsChange();
  await Promise.resolve();

  assert.equal(extension.cache.usageLimitsLastUpdate.getTime(), 0);
  assert.equal(extension.cache.usageLimitsFailStreak, 0);
  assert.equal(extension.cache.usageLimitsBackoffUntil.getTime(), 0);
  assert.deepEqual(calls, ['refresh:credentials']);
});

test('changing Claude profiles replaces the quota client and clears account state', () => {
  const extension = bareExtension();
  const oldProfile = path.join(os.tmpdir(), 'ccu-profile-old');
  const newProfile = path.join(os.tmpdir(), 'ccu-profile-new');
  const quotaUpdates: unknown[] = [];
  const weeklyHistoryUpdates: unknown[] = [];
  extension.outputChannel = null;
  extension.apiClient = {
    getCredentialsPath: () => path.join(oldProfile, '.credentials.json'),
  };
  extension.cache = {
    usageLimits: { five_hour: { utilization: 42, resets_at: null } },
    usageLimitsLastUpdate: new Date(123_000),
    usageLimitsBackoffUntil: new Date(456_000),
    usageLimitsFailStreak: 3,
  };
  extension.quotaColdRetryDone = true;
  extension.statusBar = { updateQuota: (value: unknown) => quotaUpdates.push(value) };
  extension.webviewProvider = {
    updateQuota: (value: unknown) => quotaUpdates.push(value),
    updateWeeklyQuotaHistory: (value: unknown) => weeklyHistoryUpdates.push(value),
  };
  extension.context = { globalState: { get: () => undefined } };
  extension.getConfiguration = () => ({ usageLimitTracking: true });

  extension.selectClaudeProfile(newProfile);

  assert.equal(
    extension.apiClient.getCredentialsPath(),
    path.join(newProfile, '.credentials.json'),
  );
  assert.equal(extension.cache.usageLimits, null);
  assert.equal(extension.cache.usageLimitsLastUpdate.getTime(), 0);
  assert.equal(extension.cache.usageLimitsBackoffUntil.getTime(), 0);
  assert.equal(extension.cache.usageLimitsFailStreak, 0);
  assert.equal(extension.quotaColdRetryDone, false);
  assert.deepEqual(quotaUpdates, [null, null]);
  assert.deepEqual(weeklyHistoryUpdates, [[], []]);
});

test('a quota response from the previous profile is discarded after a switch', async () => {
  const extension = bareExtension();
  let releaseOldRequest: ((value: unknown) => void) | undefined;
  const oldClient = {
    fetchUsageLimits: () => new Promise((resolve) => {
      releaseOldRequest = resolve;
    }),
  };
  extension.apiClient = oldClient;
  extension.claudeProfileGeneration = 0;
  extension.cache = {
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 0,
  };
  extension.isActive = () => false;
  extension.context = {
    globalState: {
      update: () => assert.fail('stale quota must not be persisted'),
    },
  };

  const pending = extension.maybeFetchUsageLimits({ usageLimitTracking: true });
  extension.apiClient = { fetchUsageLimits: async () => null };
  extension.claudeProfileGeneration += 1;
  releaseOldRequest?.({ five_hour: { utilization: 77, resets_at: null } });

  assert.equal(await pending, null);
  assert.equal(extension.cache.usageLimits, null);
  assert.equal(extension.cache.usageLimitsLastUpdate.getTime(), 0);
});

test('a same-path credential rotation cannot persist the stale in-flight quota response', async () => {
  const extension = bareExtension();
  let releaseRequest: ((value: unknown) => void) | undefined;
  const client = {
    getCredentialsPath: () => '/private/profile/.credentials.json',
    getLastQuotaIdentitySignal: () => 'stale-continuity-signal',
    fetchUsageLimits: () => new Promise((resolve) => {
      releaseRequest = resolve;
    }),
  };
  extension.apiClient = client;
  extension.claudeProfileGeneration = 0;
  extension.cache = {
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 0,
  };
  extension.isActive = () => false;
  extension.refreshData = async () => undefined;

  const pending = extension.maybeFetchUsageLimits({ usageLimitTracking: true });
  extension.handleCredentialsChange();
  releaseRequest?.({
    limits: [{
      kind: 'weekly_all',
      group: 'weekly',
      percent: 75,
      resets_at: '2026-09-07T03:24:00.000Z',
      scope: null,
      is_active: true,
    }],
  });

  assert.equal(await pending, null);
  assert.equal(extension.quotaObservationStore.observations.length, 0);
  assert.equal(extension.cache.usageLimits, null);
});

test('disabled quota tracking neither calls the provider nor records an observation', async () => {
  const extension = bareExtension();
  let fetches = 0;
  extension.apiClient = {
    fetchUsageLimits: async () => {
      fetches += 1;
      return null;
    },
  };

  assert.equal(
    await extension.maybeFetchUsageLimits({ usageLimitTracking: false }),
    null,
  );
  assert.equal(fetches, 0);
  assert.equal(extension.quotaObservationStore.observations.length, 0);
});

test('repeated quota failures use the one-hour backoff cap', async () => {
  const extension = bareExtension();
  const originalNow = Date.now;
  Date.now = () => 1_000_000;
  extension.cache = {
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 6,
  };
  extension.apiClient = {
    fetchUsageLimits: async () => null,
  };
  extension.isActive = () => false;

  try {
    const result = await extension.maybeFetchUsageLimits({
      usageLimitTracking: true,
    });
    assert.equal(result, null);
    assert.equal(extension.cache.usageLimitsFailStreak, 7);
    assert.equal(extension.cache.usageLimitsBackoffUntil.getTime(), 4_600_000);
  } finally {
    Date.now = originalNow;
  }
});

test('a successful Claude quota fetch persists sanitized weekly observations per profile', async () => {
  const extension = bareExtension();
  const originalNow = Date.now;
  const now = Date.parse('2026-08-22T08:00:00.000Z');
  Date.now = () => now;
  const writes: Array<{ key: string; value: unknown }> = [];
  const historyUpdates: unknown[] = [];
  extension.apiClient = {
    getCredentialsPath: () => '/private/profile-a/.credentials.json',
    getLastQuotaIdentitySignal: () => 'safe-local-continuity-signal',
    fetchUsageLimits: async () => ({
      limits: [{
        kind: 'weekly_all',
        group: 'weekly',
        percent: 40,
        resets_at: '2026-08-25T08:00:00.000Z',
        scope: null,
        is_active: true,
      }],
    }),
  };
  extension.claudeProfileGeneration = 0;
  extension.claudeWeeklyQuotaHistory = [];
  extension.cache = {
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    usageLimitsBackoffUntil: new Date(0),
    usageLimitsFailStreak: 0,
  };
  extension.isActive = () => false;
  extension.webviewProvider = {
    updateWeeklyQuotaHistory: (value: unknown) => historyUpdates.push(value),
  };
  extension.context = {
    globalState: {
      update: (key: string, value: unknown) => {
        writes.push({ key, value });
        return Promise.resolve();
      },
    },
  };

  try {
    const result = await extension.maybeFetchUsageLimits({ usageLimitTracking: true });
    assert.ok(result);
    assert.equal(
      writes.some((write) => write.key.startsWith('ccu.weeklyQuotaHistory.v1.')),
      false,
    );
    const observations = extension.quotaObservationStore.observations;
    assert.equal(observations.length, 1);
    assert.equal(observations[0].provider, 'claude');
    assert.equal(observations[0].usedFraction, 0.4);
    assert.equal(observations[0].accountAttribution, 'verified-local-signal');
    assert.match(observations[0].accountFingerprint, /^acct_[a-f0-9]{32}$/);
    assert.equal(
      JSON.stringify(extension.quotaObservationStore).includes('/private/profile-a'),
      false,
    );
    assert.equal(
      JSON.stringify(extension.quotaObservationStore).includes('safe-local-continuity-signal'),
      false,
    );
    assert.equal(historyUpdates.length, 1);
  } finally {
    Date.now = originalNow;
  }
});

test('legacy quota migration is atomic, private, idempotent, and independent of tracking state', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ccu-quota-migration-'));
  const observedAt = Date.now() - 60_000;
  const resetAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const state = new Map<string, unknown>([
    ['ccu.usageLimits.legacy-profile', {
      ts: observedAt,
      data: {
        limits: [{
          kind: 'weekly_all',
          group: 'weekly',
          percent: 40,
          resets_at: new Date(resetAt).toISOString(),
          scope: null,
          is_active: true,
        }],
        unsafeCredentialCanary: 'oauth-token-canary',
      },
    }],
    ['ccu.weeklyQuotaHistory.v1.legacy-profile', [{
      provider: 'claude',
      seriesKey: '/private/legacy-profile',
      observedAt,
      resetAt,
      usedPercent: 40,
    }]],
  ]);
  const globalState = {
    keys: () => [...state.keys()],
    get: <T>(key: string): T | undefined => state.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      if (value === undefined) state.delete(key);
      else state.set(key, value);
    },
  };
  const context = {
    globalState,
    globalStorageUri: { fsPath: root },
  } as any;
  const settings = {
    get: (key: string) => key === 'dataDirectory'
      ? path.join(root, 'profile-without-credentials')
      : key === 'timezone'
        ? 'UTC'
        : key === 'usageLimitTracking'
          ? false
          : undefined,
  } as any;

  const first = await initializeQuotaObservationRuntime(context, settings);
  assert.equal(first.store.observations.length, 1);
  assert.equal(first.store.observations[0].usedFraction, 0.4);
  assert.equal(first.store.observations[0].captureReason, 'migration');
  assert.ok(first.store.observations[0].flags.includes('account-ambiguous'));
  assert.equal(state.has('ccu.usageLimits.legacy-profile'), false);
  assert.equal(state.has('ccu.weeklyQuotaHistory.v1.legacy-profile'), false);
  assert.equal(state.get('ccu.quota.migratedCodexIndex.v2'), true);

  const file = path.join(root, 'quota-observations-v2.json');
  const persisted = await fs.promises.readFile(file, 'utf8');
  assert.doesNotMatch(persisted, /oauth-token-canary|private\/legacy-profile/);
  const second = await initializeQuotaObservationRuntime(context, settings);
  assert.deepEqual(second.store, first.store);
});

test('a failed P2 migration write preserves every legacy quota source and retry marker', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ccu-quota-migration-failure-'));
  const blockedStorage = path.join(root, 'not-a-directory');
  await fs.promises.writeFile(blockedStorage, 'fixture', 'utf8');
  const observedAt = Date.now() - 60_000;
  const state = new Map<string, unknown>([[
    'ccu.usageLimits.retryable-profile',
    {
      ts: observedAt,
      data: {
        limits: [{
          kind: 'weekly_all',
          group: 'weekly',
          percent: 25,
          resets_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          scope: null,
          is_active: true,
        }],
      },
    },
  ]]);
  const context = {
    globalState: {
      keys: () => [...state.keys()],
      get: <T>(key: string): T | undefined => state.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      },
    },
    globalStorageUri: { fsPath: blockedStorage },
  } as any;
  const settings = {
    get: (key: string) => key === 'timezone' ? 'UTC' : '',
  } as any;

  await assert.rejects(
    initializeQuotaObservationRuntime(context, settings),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EEXIST' &&
      String((error as NodeJS.ErrnoException).path).endsWith('not-a-directory'),
  );
  assert.equal(state.has('ccu.usageLimits.retryable-profile'), true);
  assert.equal(state.has('ccu.quota.migratedCodexIndex.v2'), false);
});
