import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ClaudeDataLoader } from '../dataLoader';
import { WindowActivityGate } from '../refreshPolicy';
import { snapshotFixture } from './codexFixtures';

type ExtensionModule = typeof import('../extension');

function loadExtensionModule(): ExtensionModule {
  const moduleLoader = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const vscodeStub: any = new Proxy(function () {}, {
    get: (_target, property) => property === 'then' ? undefined : vscodeStub,
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

const { ClaudeCodeUsageExtension } = loadExtensionModule();

function bareExtension(): any {
  return Object.create(ClaudeCodeUsageExtension.prototype) as any;
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
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(states, [{
    available: true,
    hasData: false,
    refreshing: true,
    scannedFiles: null,
  }]);
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
  await Promise.resolve();
  await Promise.resolve();

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
  extension.codexProgress = null;
  extension.codexProgressLastRenderedAt = 0;
  extension.webviewProvider = {
    updateCodexProgress: () => {
      renders += 1;
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
  } finally {
    Date.now = originalNow;
  }
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
    const historyWrite = writes.find((write) => write.key.startsWith('ccu.weeklyQuotaHistory.v1.'));
    assert.ok(historyWrite);
    const history = historyWrite.value as Array<Record<string, unknown>>;
    assert.equal(history.length, 1);
    assert.deepEqual(Object.keys(history[0]).sort(), [
      'observedAt', 'provider', 'resetAt', 'seriesKey', 'usedPercent',
    ]);
    assert.equal(history[0].usedPercent, 40);
    assert.equal(historyUpdates.length, 1);
  } finally {
    Date.now = originalNow;
  }
});
