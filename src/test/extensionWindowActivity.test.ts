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
  extension.context = {
    globalState: {
      update: async () => undefined,
    },
  };
  extension.outputChannel = { appendLine: () => undefined };
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
