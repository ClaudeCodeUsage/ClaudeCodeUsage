import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');

import { createEmptyQuotaObservationStore } from '../quotaObservationStore';

type ExtensionModule = typeof import('../extension');

function loadExtensionModule(): ExtensionModule {
  const originalLoad = (Module as any)._load;
  const vscodeStub: any = new Proxy(function () {}, {
    get: (_target, property) => property === 'then' ? undefined : vscodeStub,
    apply: () => vscodeStub,
    construct: () => vscodeStub,
  });
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return vscodeStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../extension') as ExtensionModule;
  } finally {
    (Module as any)._load = originalLoad;
  }
}

const { ClaudeCodeUsageExtension } = loadExtensionModule();

function memoryGlobalState(initial: Record<string, unknown>) {
  const state = new Map(Object.entries(initial));
  return {
    get<T>(key: string, fallback?: T): T | undefined {
      return (state.has(key) ? state.get(key) : fallback) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) state.delete(key);
      else state.set(key, value);
    },
    keys(): readonly string[] {
      return [...state.keys()];
    },
    state,
  };
}

test('host inventory exposes only value-free location classes and random quota scope tokens', async () => {
  const root = path.join(os.tmpdir(), `ccu-local-inventory-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'codex-index-v1.json'), '{"schemaVersion":3}', 'utf8');
  await writeFile(path.join(root, 'quota-observations-v2.json'), '{"schemaVersion":2}', 'utf8');
  const globalState = memoryGlobalState({
    'ccu.setting.privateCanary': '/Users/private/account/path',
    'ccu.heatmapRepo': 'private-owner/private-repo',
    'ccu.codex.machineSalt': 'machine-salt-canary',
  });
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = {
    globalStorageUri: { fsPath: root },
    globalState,
  };
  extension.outputChannel = { appendLine: () => undefined };
  extension.localDataQuotaScopes = new Map();
  extension.quotaObservationStore = {
    schemaVersion: 2,
    fingerprintAlgorithm: 'hmac-sha256-v1',
    observations: [{
      schemaVersion: 2,
      provider: 'codex',
      accountFingerprint: 'fingerprint-private-canary',
      accountAttribution: 'unattributed',
      observedAt: Date.parse('2026-09-02T00:00:00Z'),
      periodType: 'seven-day',
      usedFraction: 0.25,
      remainingFraction: 0.75,
      resetAt: Date.parse('2026-09-07T00:00:00Z'),
      source: 'codex-local-structured-event',
      windowId: 'window-private-canary',
      providerWindowFingerprint: null,
      confidence: 'low',
      captureReason: 'refresh',
      flags: [],
    }],
  };
  extension.settings = {
    snapshot: () => [{ key: 'advice.apiKey', configured: true, value: '' }],
  };
  extension.webviewProvider = {
    adviceLocalDataInventorySummary: () => ({
      approximateBytes: 80,
      itemCount: 2,
      oldestAt: 1,
      newestAt: 2,
    }),
  };

  const inventory = await extension.buildLocalDataInventory({
    uiPreferenceKeys: 2,
    webviewStateFields: 3,
    sharingPreferenceKeys: 1,
  });
  const serialized = JSON.stringify(inventory);
  assert.equal(inventory.schemaVersion, 1);
  assert.deepEqual(inventory.rows.map((row: any) => row.id), [
    'R1', 'R2', 'P1', 'P2', 'P3-P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11',
  ]);
  assert.doesNotMatch(serialized, /Users\/private|private-owner|private-repo/);
  assert.doesNotMatch(serialized, /fingerprint-private-canary|window-private-canary|machine-salt-canary/);
  assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(inventory.quotaScopes.length >= 2);
  assert.ok(inventory.quotaScopes.every((scope: any) => /^[a-f0-9]{36}$/.test(scope.token)));
  assert.ok(inventory.quotaScopes.every((scope: any) => !('accountFingerprint' in scope)));
  assert.equal(extension.localDataQuotaScopes.size, inventory.quotaScopes.length);
  assert.equal(inventory.rows.find((row: any) => row.id === 'P10')?.itemCount, 5);
  assert.equal(inventory.rows.find((row: any) => row.id === 'P11')?.itemCount, 2);
  assert.equal(inventory.rows.find((row: any) => row.id === 'P7')?.approximateBytes, null);
});

test('derived-file family matching accepts only exact canonical, recovery, and interrupted-write names', async () => {
  const root = path.join(os.tmpdir(), `ccu-local-family-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  const names = [
    'codex-index-v1.json',
    'codex-index-v1.corrupt-100-200.json',
    'codex-index-v1.json.tmp-200-123e4567-e89b-12d3-a456-426614174000',
    'codex-index-v1.corrupt-100-200.json.bak',
    'codex-index-v1.json.lock',
    'codex-index-v1.json.lock.pending-123e4567-e89b-12d3-a456-426614174000',
    'quota-observations-v2.json',
    'quota-observations-v2.json.quarantine-100-deadbeef',
    '.quota-observations-v2.json.200.abcdef123456.tmp',
    'quota-observations-v2.json.quarantine-100-deadbeef.bak',
    'quota-observations-v2.json.lock',
    'unrelated.json',
  ];
  await Promise.all(names.map((name) => writeFile(path.join(root, name), 'fixture', 'utf8')));
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;

  assert.deepEqual(
    (await extension.derivedFileFamilyNames(
      path.join(root, 'codex-index-v1.json'),
      'codex-index',
    )).sort(),
    [
      'codex-index-v1.corrupt-100-200.json',
      'codex-index-v1.json',
      'codex-index-v1.json.tmp-200-123e4567-e89b-12d3-a456-426614174000',
    ].sort(),
  );
  assert.deepEqual(
    (await extension.derivedFileFamilyNames(
      path.join(root, 'quota-observations-v2.json'),
      'quota-observations',
    )).sort(),
    [
      '.quota-observations-v2.json.200.abcdef123456.tmp',
      'quota-observations-v2.json',
      'quota-observations-v2.json.quarantine-100-deadbeef',
    ].sort(),
  );
});

test('provider-wide quota clear removes only matching migration inputs and seals P5 against resurrection', async () => {
  const globalState = memoryGlobalState({
    'ccu.usageLimits.profile-a': { legacy: true },
    'ccu.weeklyQuotaHistory.v1.profile-a': [{ legacy: true }],
    'ccu.unrelated.canary': 'preserve',
  });
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = { globalState };

  await extension.clearLegacyQuotaMigrationInputs({ provider: 'claude' });
  assert.equal(globalState.state.has('ccu.usageLimits.profile-a'), false);
  assert.equal(globalState.state.has('ccu.weeklyQuotaHistory.v1.profile-a'), false);
  assert.equal(globalState.state.has('ccu.quota.migratedCodexIndex.v2'), false);
  assert.equal(globalState.state.get('ccu.unrelated.canary'), 'preserve');

  await extension.clearLegacyQuotaMigrationInputs({
    provider: 'codex',
    accountFingerprint: 'opaque-local-fingerprint',
  });
  assert.equal(globalState.state.get('ccu.quota.migratedCodexIndex.v2'), undefined);
  await extension.clearLegacyQuotaMigrationInputs({ provider: 'codex' });
  assert.equal(globalState.state.get('ccu.quota.migratedCodexIndex.v2'), true);
  assert.equal(globalState.state.get('ccu.unrelated.canary'), 'preserve');
});

test('account-scoped quota clear refuses unresolved Claude and Codex migration inputs', () => {
  const globalState = memoryGlobalState({
    'ccu.usageLimits.profile-a': { legacy: true },
  });
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = { globalState };

  assert.throws(
    () => extension.assertScopedQuotaMigrationIsResolved({
      provider: 'claude',
      accountFingerprint: 'opaque-claude-epoch',
    }),
    /scoped-clear-blocked-by-unresolved-migration/,
  );
  assert.throws(
    () => extension.assertScopedQuotaMigrationIsResolved({
      provider: 'codex',
      accountFingerprint: 'opaque-codex-epoch',
    }),
    /scoped-clear-blocked-by-unresolved-migration/,
  );

  globalState.state.delete('ccu.usageLimits.profile-a');
  globalState.state.set('ccu.quota.migratedCodexIndex.v2', true);
  assert.doesNotThrow(() => extension.assertScopedQuotaMigrationIsResolved({
    provider: 'claude',
    accountFingerprint: 'opaque-claude-epoch',
  }));
  assert.doesNotThrow(() => extension.assertScopedQuotaMigrationIsResolved({
    provider: 'codex',
    accountFingerprint: 'opaque-codex-epoch',
  }));
});

test('pending Webview reset tombstone survives failure and clears only after verified ACK', async () => {
  const globalState = memoryGlobalState({
    'ccu.localData.pendingClientReset.v1': 'clear-all-client-state',
  });
  const acknowledgements = [false, true];
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = { globalState };
  extension.localDataActionWrite = Promise.resolve();
  extension.pendingClientResetReplay = Promise.resolve();
  extension.webviewProvider = {
    requestClientLocalDataAction: async (action: string) => {
      assert.equal(action, 'clear-all-client-state');
      return acknowledgements.shift() ?? false;
    },
  };

  await extension.replayPendingClientReset();
  assert.equal(
    globalState.state.get('ccu.localData.pendingClientReset.v1'),
    'clear-all-client-state',
  );
  await extension.replayPendingClientReset();
  assert.equal(globalState.state.has('ccu.localData.pendingClientReset.v1'), false);
});

test('an acknowledged reset replay cannot clear a newer tombstone revision', async () => {
  const key = 'ccu.localData.pendingClientReset.v1';
  const globalState = memoryGlobalState({
    [key]: 'clear-all-client-state',
  });
  let releaseAck!: (ok: boolean) => void;
  const ack = new Promise<boolean>((resolve) => { releaseAck = resolve; });
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = { globalState };
  extension.localDataActionWrite = Promise.resolve();
  extension.pendingClientResetReplay = Promise.resolve();
  extension.webviewProvider = {
    requestClientLocalDataAction: async () => ack,
  };

  const replay = extension.replayPendingClientReset();
  await new Promise((resolve) => setImmediate(resolve));
  const newer = {
    schemaVersion: 1,
    revision: 2,
    action: 'reset-sharing-preferences',
  };
  await globalState.update(key, newer);
  releaseAck(true);
  await replay;

  assert.deepEqual(globalState.state.get(key), newer);
});

test('reset replay is serialized with newly requested local-data actions', async () => {
  const globalState = memoryGlobalState({
    'ccu.localData.pendingClientReset.v1': 'clear-all-client-state',
  });
  let releaseAck!: (ok: boolean) => void;
  const ack = new Promise<boolean>((resolve) => { releaseAck = resolve; });
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = { globalState };
  extension.localDataActionWrite = Promise.resolve();
  extension.pendingClientResetReplay = Promise.resolve();
  extension.webviewProvider = {
    requestClientLocalDataAction: async () => ack,
  };

  const replay = extension.replayPendingClientReset();
  await new Promise((resolve) => setImmediate(resolve));
  let newerActionStarted = false;
  const newerAction = extension.serializeLocalDataAction(async () => {
    newerActionStarted = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(newerActionStarted, false);

  releaseAck(true);
  await Promise.all([replay, newerAction]);
  assert.equal(newerActionStarted, true);
});

test('clear-all uses the exact allowlist and preserves unrelated state', async () => {
  const globalState = memoryGlobalState({
    'ccu.setting.showCost': true,
    'ccu.setting.unknown-canary': 'must-survive',
    'ccu.lastSeenVersion': '2.3.0',
    'ccu.heatmapRepo': 'owner/repo',
    'ccu.adviceEffectiveness.localState': { schemaVersion: 3 },
    'claudeCodeUsage.adviceEffectiveness.feedback.v1': { schemaVersion: 1 },
    'ccu.unrelated.canary': 'must-survive',
    'provider.credentials.canary': 'must-survive',
  });
  const resetSettings: string[] = [];
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = { globalState, globalStorageUri: { fsPath: '/synthetic/global-storage' } };
  extension.settings = {
    preflightResetAllOwnedData: () => undefined,
    resetAllOwnedData: async () => { resetSettings.push('advice.apiKey'); },
  };
  let releaseInitialization!: () => void;
  extension.initializationWrites = new Promise<void>((resolve) => {
    releaseInitialization = () => {
      globalState.state.set('ccu.codex.machineSalt', 'late-initialization-write');
      resolve();
    };
  });
  extension.initializationWriteFailure = null;
  extension.stopQuotaColdRetry = () => undefined;
  extension.stopAutoRefresh = () => undefined;
  extension.stopFileWatching = () => undefined;
  extension.stopCredentialsWatching = () => undefined;
  extension.cancelAdviceNetworks = async () => undefined;
  extension.cancelQuotaNetworks = async () => undefined;
  let codexClearCalls = 0;
  extension.clearCodexDerivedIndex = async (rebuild: boolean) => {
    assert.equal(rebuild, false);
    codexClearCalls += 1;
  };
  extension.quotaObservationRepository = {
    clear: async () => createEmptyQuotaObservationStore(),
  };
  extension.removeDerivedFileFamilyWithLease = async () => undefined;
  extension.quotaObservationStore = createEmptyQuotaObservationStore();
  let adviceClearCalls = 0;
  extension.webviewProvider = {
    clearAdviceLocalData: async () => { adviceClearCalls += 1; return true; },
    clearSharingRuntimeState: () => undefined,
  };
  extension.claudeWeeklyQuotaHistory = [];
  extension.cache = {
    usageLimits: null,
    usageLimitsLastUpdate: new Date(0),
    records: [{ synthetic: true }],
    contentAnalysis: null,
    claudeIndex: {},
  };
  extension.codexView = null;
  extension.codexInsights = {};
  extension.codexHasData = false;
  extension.refreshQuotaObservationViews = () => undefined;
  extension.syncProviderUi = () => undefined;
  extension.verifyClearAllPostcondition = async () => undefined;

  const pendingResult = extension.clearAllExtensionDerivedData();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resetSettings.length, 0, 'clear waits for the initialization write barrier');
  releaseInitialization();
  const result = await pendingResult;

  assert.equal(result.ok, true);
  assert.equal(result.clientAction, 'clear-all-client-state');
  assert.equal(codexClearCalls, 1);
  assert.equal(adviceClearCalls, 1);
  assert.ok(resetSettings.includes('advice.apiKey'));
  assert.equal(globalState.state.has('ccu.setting.showCost'), false);
  assert.equal(globalState.state.get('ccu.setting.unknown-canary'), 'must-survive');
  assert.equal(globalState.state.has('ccu.lastSeenVersion'), false);
  assert.equal(globalState.state.has('ccu.heatmapRepo'), false);
  assert.equal(globalState.state.has('ccu.adviceEffectiveness.localState'), false);
  assert.equal(globalState.state.has('ccu.codex.machineSalt'), false);
  assert.equal(globalState.state.has('claudeCodeUsage.adviceEffectiveness.feedback.v1'), false);
  assert.equal(globalState.state.get('ccu.unrelated.canary'), 'must-survive');
  assert.equal(globalState.state.get('provider.credentials.canary'), 'must-survive');
});
