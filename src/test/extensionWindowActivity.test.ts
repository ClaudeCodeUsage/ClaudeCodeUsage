import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ClaudeDataLoader } from '../dataLoader';
import { WindowActivityGate } from '../refreshPolicy';

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

test('background transition stops every recurring resource once', () => {
  const extension = bareExtension();
  const calls: string[] = [];
  extension.windowActivity = new WindowActivityGate(true);
  extension.stopAutoRefresh = () => calls.push('timer:stop');
  extension.stopFileWatching = () => calls.push('claude:stop');
  extension.stopCredentialsWatching = () => calls.push('credentials:stop');

  extension.handleWindowFocusChange(false);
  extension.handleWindowFocusChange(false);

  assert.deepEqual(calls, [
    'timer:stop',
    'claude:stop',
    'credentials:stop',
  ]);
});

test('foreground transition resumes resources and immediately catches up once', () => {
  const extension = bareExtension();
  const calls: string[] = [];
  extension.windowActivity = new WindowActivityGate(false);
  extension.startAutoRefresh = () => calls.push('timer:start');
  extension.startFileWatching = () => {
    calls.push('claude:start');
    return Promise.resolve();
  };
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

test('background window does not inspect or watch the Claude projects tree', async () => {
  const extension = bareExtension();
  const calls: string[] = [];
  const originalFind = ClaudeDataLoader.findClaudeDataDirectory;
  extension.windowActivity = new WindowActivityGate(false);
  extension.stopFileWatching = () => calls.push('claude:stop');
  extension.getConfiguration = () => ({
    fileWatchSeconds: 30,
    dataDirectory: '',
  });
  (ClaudeDataLoader as any).findClaudeDataDirectory = async () => {
    calls.push('claude:lookup');
    return null;
  };

  try {
    await extension.startFileWatching();
    assert.deepEqual(calls, ['claude:stop']);
  } finally {
    (ClaudeDataLoader as any).findClaudeDataDirectory = originalFind;
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
