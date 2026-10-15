import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, codexModelSignals, evaluateAchievements } from '../achievements';
import { ACHIEVEMENT_RECORD_FILE, AchievementRecordRepository, loadAchievementRecords } from '../achievementRecordStore';
import { RECALIBRATED_ACHIEVEMENT_IDS_V2 } from '../achievementRuleVersions';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
const rules = require('../achievements') as any;

test('calibrated volume ladders leave sustained high-use milestones beyond entry tiers', () => {
  const expected: Record<string, number[]> = {
    'sol-regular': [1e9, 1e10, 1e11], 'astra-regular': [5e8, 5e9, 5e10], 'luna-regular': [1e8, 1e9, 1e10],
    'sonnet-main': [1e8, 1e9, 1e10], 'opus-cannon': [1e8, 1e9, 1e10], 'haiku-worker': [1e7, 1e8, 1e9],
    'fable-volume': [5e7, 5e8, 5e9], 'cache-wizard': [1e8, 1e9, 1e10],
    'claude-cache-creation': [1e7, 1e8, 1e9], 'claude-output': [2e6, 2e7, 2e8],
    'codex-output': [5e6, 5e7, 5e8], 'codex-cache-read': [1e9, 1e10, 1e11],
    'weekly-volume': [5e8, 2e9, 1e10], 'weekly-average': [5e8, 2e9, 5e9], 'model-rainbow': [2, 5, 7],
  };
  for (const [series, targets] of Object.entries(expected)) {
    assert.deepEqual(ACHIEVEMENT_SERIES[series].slice(0,targets.length).map(id => ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)!.target), targets, series);
  }
});

test('candidate calibration remaps only volume proof, never carries a changed calendar condition', () => {
  assert.equal(typeof rules.migrateCalibratedAchievementGrants, 'function');
  const migrated = rules.migrateCalibratedAchievementGrants([
    'sol-regular-gold', 'astra-regular-gold', 'sonnet-main-gold', 'haiku-worker-gold',
    'codex-output-bronze', 'claude-cache-creation-silver', 'active-weeks-gold',
    'fable-days-gold', 'three-family-day', 'local-share-export', 'hundred-billion-token-club', 'unknown',
  ]);
  assert.deepEqual(migrated, [
    'astra-regular', 'astra-regular-silver', 'claude-cache-creation-bronze',
    'claude-cache-creation-gold', 'claude-cache-creation-silver',
    'haiku-worker', 'haiku-worker-silver', 'hundred-billion-token-club',
    'local-share-export', 'sol-regular', 'sol-regular-silver', 'sonnet-main', 'sonnet-main-silver',
  ].sort());
  assert.deepEqual(rules.migrateCalibratedAchievementGrants(null), []);
});

test('Fable completes the seven-family rainbow without proxy-name or output-day fallback', () => {
  const codexFiles = ['astra', 'sol', 'luna'].map(family => {
    const tokens = { inputTotal: 9_980_000, outputTotal: 20_000 };
    return { session: { sessionKey: family, role: 'root' }, total: tokens,
      byModel: { [`gpt-6-${family}`]: tokens }, byEffort: {}, byDay: {}, structural: {} } as CodexFileAggregate;
  });
  const facts: any = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    claudeFamilyTokens: { sonnet: 10_000_000, opus: 10_000_000, haiku: 10_000_000 },
    claudeFamilyOutputTokens: { sonnet: 20_000, opus: 20_000, haiku: 20_000 },
    fable: { processedTokens: 10_000_000, outputTokens: 20_000, activeDays: 200 },
    calendar: { familyDays: { fable: 6 } },
    codex: codexModelSignals(codexFiles),
  };
  const read = () => new Map(evaluateAchievements(facts).map(row => [row.id, row]));
  assert.equal(read().get('model-rainbow-gold')!.unlocked, true);
  assert.equal(read().get('fable-days-bronze')!.unlocked, false, 'unqualified old output days cannot substitute calendar proof');
  facts.calendar.familyDays.fable = 7;
  assert.equal(read().get('fable-days-bronze')!.unlocked, true);
  facts.fable.processedTokens = 9_999_999;
  assert.equal(read().get('model-rainbow-gold')!.unlocked, false);
  assert.equal(read().get('model-rainbow-gold')!.progress, 6);
  facts.fable.processedTokens = 10_000_000;
  facts.fable.outputTokens = 19_999;
  assert.equal(read().get('model-rainbow-gold')!.unlocked, false);
  facts.fable.outputTokens = 20_000;
  assert.equal(read().get('model-rainbow-gold')!.unlocked, true);
  for (const family of ['sonnet', 'opus', 'haiku']) {
    facts.claudeFamilyTokens[family]--;
    assert.equal(read().get('model-rainbow-gold')!.progress, 6, `${family}: processed floor`);
    facts.claudeFamilyTokens[family]++;
    facts.claudeFamilyOutputTokens[family]--;
    assert.equal(read().get('model-rainbow-gold')!.progress, 6, `${family}: output floor`);
    facts.claudeFamilyOutputTokens[family]++;
  }
});

test('calibration rechecks every changed joint condition instead of inheriting its old grant', () => {
  assert.equal(RECALIBRATED_ACHIEVEMENT_IDS_V2.length, 21);
  assert.deepEqual(rules.migrateCalibratedAchievementGrants([
    ...RECALIBRATED_ACHIEVEMENT_IDS_V2, 'local-share-export', 'hundred-billion-token-club',
  ]), ['hundred-billion-token-club', 'local-share-export']);
});

test('canonical v2 archives all changed rules and reissues only newly proven qualifications without Memento promotion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-calibration-joint-'));
  try {
    // An old writer remains an explicit v1 fixture, not a production read path.
    const legacyFile = path.join(directory, 'achievements-v1.json');
    await new AchievementRecordRepository(legacyFile).initialize([
      ...RECALIBRATED_ACHIEVEMENT_IDS_V2, 'local-share-export',
    ]);
    const oldBytes = await readFile(legacyFile);
    const currentFile = path.join(directory, ACHIEVEMENT_RECORD_FILE);
    const repository = new AchievementRecordRepository(currentFile);
    let saved = await repository.initialize(RECALIBRATED_ACHIEVEMENT_IDS_V2);
    assert.equal(saved.schemaVersion, 2);
    assert.deepEqual(saved.records.map(row => row.id), ['local-share-export']);
    assert.deepEqual(saved.legacyRecords!.map(row => row.id).sort(), [...RECALIBRATED_ACHIEVEMENT_IDS_V2].sort());
    assert.ok(saved.legacyRecords!.every(row => row.ruleVersion === 1 && !row.unread &&
      row.recordedDay === null && row.timeZone === null));
    assert.deepEqual(await readFile(legacyFile), oldBytes);
    assert.deepEqual(await new AchievementRecordRepository(currentFile).initialize(RECALIBRATED_ACHIEVEMENT_IDS_V2), saved);

    // Current family evidence independently meets bronze and silver, not gold.
    const results = evaluateAchievements({ claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
      claudeFamilyTokens: { sonnet: 10_000_000, opus: 10_000_000, haiku: 10_000_000 },
      claudeFamilyOutputTokens: { sonnet: 20_000, opus: 20_000, haiku: 20_000 },
      fable: { processedTokens: 10_000_000, outputTokens: 20_000, activeDays: 0,
        mixedFamilySession: false, outputSessions: 0, allOutputSessions: 0 },
      codex: codexModelSignals([{
        session: { sessionKey: 'current', role: 'root' }, total: { inputTotal: 9_980_000, outputTotal: 20_000 },
        byModel: { 'gpt-6-astra': { inputTotal: 9_980_000, outputTotal: 20_000 } },
        byEffort: {}, byDay: {}, structural: {} as CodexFileAggregate['structural'],
      }]),
    });
    const proven = results.filter(row => row.unlocked && RECALIBRATED_ACHIEVEMENT_IDS_V2.includes(row.id));
    assert.deepEqual(proven.map(row => row.id).sort(), ['model-rainbow', 'model-rainbow-bronze']);
    saved = (await repository.append(saved.generation, proven.map(row => ({
      id: row.id, origin: 'history' as const, recordedDay: null, timeZone: null,
    })))).store;
    assert.deepEqual(saved.records.filter(row => row.ruleVersion === 2).map(row => row.id).sort(),
      ['model-rainbow', 'model-rainbow-bronze']);
    assert.ok(saved.records.every(row => !row.unread && row.recordedDay === null));
    assert.equal(saved.legacyRecords!.length, 21);
    assert.deepEqual(await loadAchievementRecords(currentFile), saved);
    assert.deepEqual(await new AchievementRecordRepository(currentFile).initialize(RECALIBRATED_ACHIEVEMENT_IDS_V2), saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
import { AchievementCalibrationSingleFlight, AchievementCalibrationOperation, shouldFetchQuotaForRefresh } from '../achievementCalibration';
import { createClaudeUsageIndex } from '../claudeIncrementalIndex';
import { RefreshSingleFlight } from '../refreshPolicy';
import { ClaudeDataLoader } from '../dataLoader';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { snapshotFixture } from './codexFixtures';
import { createBackgroundWorkState } from '../backgroundWorkState';
import { ResourceOwnershipRegistry } from '../resourceOwnership';
import { createEmptyQuotaObservationStore } from '../quotaObservationStore';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let enabled = true, cancelled = false, generation = 0;
  const calls: string[] = [];
  const operation: AchievementCalibrationOperation = {
    enabled: () => enabled,
    cancelled: () => cancelled,
    generation: () => generation,
    refreshLocal: async current => { assert.ok(current()); calls.push('local-refresh'); },
    recalibrate: async () => { calls.push('quiet-recalibration'); },
  };
  return { operation, calls, disable: () => { enabled = false; },
    cancel: () => { cancelled = true; }, change: () => { generation++; } };
}

test('calibration joins duplicate commands and runs one quiet commit after local refresh', async () => {
  const f = fixture(), ready = deferred(), flight = new AchievementCalibrationSingleFlight();
  f.operation.refreshLocal = async current => { f.calls.push('local-refresh'); await ready.promise; assert.ok(current()); };
  const first = flight.run(f.operation), second = flight.run(f.operation);
  assert.equal(first, second);
  await Promise.resolve();
  assert.deepEqual(f.calls, ['local-refresh']);
  ready.resolve();
  assert.equal(await first, 'recalibrated');
  assert.deepEqual(f.calls, ['local-refresh', 'quiet-recalibration']);
  assert.equal(await flight.run(f.operation), 'recalibrated');
});

test('OFF and cancellation before entry perform no reads or writes', async () => {
  for (const mode of ['disabled', 'cancelled'] as const) {
    const f = fixture();
    mode === 'disabled' ? f.disable() : f.cancel();
    assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation), mode);
    assert.deepEqual(f.calls, []);
  }
});

test('failed local refresh cannot recalibrate or change a baseline', async () => {
  const f = fixture();
  f.operation.refreshLocal = async () => { throw new Error('fixture failure'); };
  assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation), 'failed');
  assert.deepEqual(f.calls, []);
});

test('OFF, cancellation and generation changes during refresh retire its commit guard', async () => {
  for (const mode of ['disabled', 'cancelled', 'generation'] as const) {
    const f = fixture();
    f.operation.refreshLocal = async current => {
      assert.ok(current());
      mode === 'disabled' ? f.disable() : mode === 'cancelled' ? f.cancel() : f.change();
      assert.equal(current(), false);
    };
    assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation),
      mode === 'disabled' ? 'disabled' : 'cancelled');
    assert.deepEqual(f.calls, []);
  }
});

test('the same current guard reaches the durable commit and rejects late OFF, cancel and generation changes', async () => {
  for (const mode of ['disabled', 'cancelled', 'generation'] as const) {
    const f = fixture(), entered = deferred(), ready = deferred();
    let refreshGuard: (() => boolean) | undefined, writes = 0;
    f.operation.refreshLocal = async current => { refreshGuard = current; };
    f.operation.recalibrate = async current => {
      assert.equal(typeof current, 'function');
      assert.equal(current, refreshGuard);
      assert.ok(current());
      entered.resolve();
      await ready.promise;
      if (!current()) throw new Error('fixture retired before append');
      writes++;
    };
    const pending = new AchievementCalibrationSingleFlight().run(f.operation);
    // Do not strand the test if a regression omits the callback guard.
    await Promise.race([entered.promise, pending]);
    mode === 'disabled' ? f.disable() : mode === 'cancelled' ? f.cancel() : f.change();
    ready.resolve();
    assert.equal(await pending, mode === 'disabled' ? 'disabled' : 'cancelled');
    assert.equal(writes, 0);
  }
});

test('local-only quota guard leaves ordinary refresh quota policy intact', () => {
  assert.equal(shouldFetchQuotaForRefresh({ localOnly: true }), false);
  assert.equal(shouldFetchQuotaForRefresh({}), true);
  assert.equal(shouldFetchQuotaForRefresh({ localOnly: false }), true);
});

const calibrationNotifications: string[] = [];
const calibrationWarnings: string[] = [];
let calibrationCancelled = false;
function loadCalibrationExtension(): typeof import('../extension').ClaudeCodeUsageExtension {
  const loader = require('node:module') as { _load: (...args: any[]) => any };
  const original = loader._load;
  const vscode: any = new Proxy(function () {}, {
    get: (_target, key) => key === 'then' ? undefined : key === 'window' ? {
      showInformationMessage: (message: string) => { calibrationNotifications.push(message); },
      showErrorMessage: (message: string) => { calibrationNotifications.push(message); },
      showWarningMessage: (message: string) => { calibrationWarnings.push(message); },
      withProgress: async (_options: unknown, callback: any) => callback({}, {
        get isCancellationRequested() { return calibrationCancelled; },
      }),
    } : key === 'workspace' ? { workspaceFolders: undefined } : vscode,
    apply: () => vscode,
    construct: () => vscode,
  });
  loader._load = function (request, ...args) {
    return request === 'vscode' ? vscode : Reflect.apply(original, this, [request, ...args]);
  };
  let Extension: typeof import('../extension').ClaudeCodeUsageExtension;
  try { Extension = require('../extension').ClaudeCodeUsageExtension; }
  finally { loader._load = original; }
  return Extension!;
}

test('production runRefresh excludes credentials and quota transport only for local-only work', async () => {
  const Extension = loadCalibrationExtension();
  for (const localOnly of [true, false, undefined]) {
    const extension: any = Object.create(Extension!.prototype);
    let quotaCalls = 0, credentialReads = 0;
    Object.assign(extension, {
      disposed: false, configurationGeneration: 0, claudeIndexGeneration: 0,
      getConfiguration: () => ({ dataDirectory: '' }),
      selectClaudeUsageSource: () => undefined,
      claudeUsageSourceKey: () => undefined,
      shouldDeliverDashboard: () => false,
      // Stop before discovery so the fixture cannot inspect real user logs.
      claudeRefreshRecovery: { admit: () => false },
      publishRefreshState: () => undefined,
      syncProviderUiSafely: () => undefined,
      refreshGate: { complete: () => null },
      cache: {},
      statusBar: { updateQuota: () => undefined },
      webviewProvider: { updateQuota: () => undefined },
      getClaudeQuotaPaceSnapshot: () => undefined,
      scheduleQuotaColdRetry: () => undefined,
      maybeFetchUsageLimits: async () => { quotaCalls++; credentialReads++; return {}; },
    });
    await extension.runRefresh({ forceReload: false, trigger: 'manual', localOnly });
    assert.equal(quotaCalls, localOnly === true ? 0 : 1);
    assert.equal(credentialReads, localOnly === true ? 0 : 1);
  }
});

function calibrationExtension(directory: string) {
  const Extension = loadCalibrationExtension();
  const extension: any = Object.create(Extension.prototype);
  const states: Array<[boolean, boolean]> = [], calls: string[] = [];
  const config = { dataDirectory: directory, enableAchievements: true, codexEnabled: false,
    dashboardAutoRefresh: false, enableContentAnalysis: false, advicePromptWindowDays: 30,
    projectGroupingMode: 'flat', contextWindowOverride: 0, pricingBackend: 'anthropic' };
  Object.assign(extension, {
    disposed: false, configurationGeneration: 0, claudeIndexGeneration: 0,
    achievementCalibrationGeneration: 0, achievementCalibration: new AchievementCalibrationSingleFlight(),
    getConfiguration: () => config, codexProvider: {}, codexRefreshSuspensionDepth: 0,
    refreshGate: new RefreshSingleFlight(),
    cache: { records: [], contentAnalysis: null, manifest: null, claudeIndex: createClaudeUsageIndex(),
      lastUpdate: new Date(0), dataDirectory: null, usageLimits: null },
    providerRefreshStates: { claude: { failed: false }, codex: { failed: false } },
    deliveredRefreshStates: {},
    statusBar: { updateUsageData: () => undefined, updateContext: () => undefined, setLoading: () => undefined },
    outputChannel: { appendLine: () => undefined },
    syncProviderUiSafely: () => undefined,
    maybeFetchUsageLimits: () => { throw new Error('credential/transport canary'); },
    webviewProvider: {
      setAchievementCalibrationState: (pending: boolean, failed = false) => { states.push([pending, failed]); },
      recalibrateAchievementsFromCurrentData: async () => { calls.push('recalibrate'); },
      beginClaudeAchievementObservation: async (current: () => boolean) => {
        assert.ok(current()); calls.push('observe'); return {};
      },
      acceptClaudeAchievementSnapshot: () => { calls.push('snapshot'); },
      updateData: () => { calls.push('dashboard'); },
      updateRefreshState: () => undefined,
      invalidateAchievementEvidence: () => undefined,
      setLoading: () => undefined,
    },
  });
  return { extension, states, calls, config };
}

test('real local command refreshes an isolated Claude fixture while paused and keeps warm zero-body reuse', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-manual-calibration-'));
  try {
    await mkdir(path.join(root, 'projects', 'fixture'), { recursive: true });
    await writeFile(path.join(root, 'projects', 'fixture', 'session.jsonl'), JSON.stringify({
      type: 'assistant', timestamp: new Date().toISOString(), requestId: 'fixture',
      message: { id: 'fixture', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 1 } },
    }) + '\n');
    calibrationCancelled = false;
    calibrationNotifications.length = 0;
    const f = calibrationExtension(root);
    const snapshots: any[] = [];
    f.extension.webviewProvider.acceptClaudeAchievementSnapshot = (snapshot: unknown) => {
      snapshots.push(snapshot); f.calls.push('snapshot');
    };
    const diagnostics: string[] = [];
    f.extension.outputChannel.appendLine = (line: string) => diagnostics.push(line);
    const first = f.extension.recalibrateAchievements(), duplicate = f.extension.recalibrateAchievements();
    assert.equal(first, duplicate);
    await first;
    assert.deepEqual(f.states, [[true, false], [false, false]], JSON.stringify({calls:f.calls,diagnostics}));
    assert.equal(f.calls.filter(call => call === 'recalibrate').length, 1);
    assert.ok(f.calls.includes('dashboard'), 'explicit pass delivers while dashboard is paused');
    assert.equal(f.extension.cache.records.length, 1);
    const index = f.extension.cache.claudeIndex;
    f.calls.length = 0;
    diagnostics.length = 0;
    await f.extension.recalibrateAchievements();
    assert.equal(f.extension.cache.claudeIndex, index);
    assert.ok(diagnostics.some(line => /bodies=0/.test(line)), diagnostics.join('\n'));
    assert.equal(f.calls.filter(call => call === 'recalibrate').length, 1);
    const originalRows = [...index.sessionRows.values()];
    assert.ok(originalRows.length > 0);
    f.extension.cache.claudeIndex = createClaudeUsageIndex();
    for (const snapshot of snapshots) {
      assert.equal(typeof snapshot.sessionHistoryEligibility, 'function');
      assert.deepEqual([...snapshot.sessionHistoryEligibility()], originalRows);
      assert.deepEqual([...snapshot.sessionHistoryEligibility()], originalRows, 'eligibility is replayable');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Claude receipt source guard survives UI cancellation but retains source/index/clear/disposal fences', async (t) => {
  const f = calibrationExtension('/fixture');
  let cancelled = false, ioCurrent!: () => boolean, receiptCurrent!: () => boolean, bodyPasses = 0;
  t.mock.method(ClaudeDataLoader, 'findClaudeDataDirectory', async () => '/fixture');
  t.mock.method(require('../claudeUsageFiles'), 'scanUsageManifest', async () =>
    ({ entries: new Map(), scannedAtMs: 0, scanDurationMs: 0 }));
  t.mock.method(require('../claudeIncrementalIndex'), 'updateClaudeUsageIndex', async () => {
    bodyPasses++; throw new Error('body scan must not start after cancellation');
  });
  f.extension.webviewProvider.beginClaudeAchievementObservation = async (current: () => boolean, source: () => boolean) => {
    ioCurrent = current; receiptCurrent = source;
    cancelled = true;
    return {};
  };
  const calibration = { current: () => !cancelled, accepted: false };
  await f.extension.startClaudeRefresh({ ...f.extension.refreshGate.request(false, 'manual'), localOnly: true, calibration });
  assert.equal(ioCurrent(), false);
  assert.equal(typeof receiptCurrent, 'function');
  assert.equal(receiptCurrent(), true);
  assert.equal(bodyPasses, 0);
  assert.equal(calibration.accepted, false);
  f.extension.claudeIndexGeneration++;
  assert.equal(receiptCurrent(), false);
  f.extension.claudeIndexGeneration--;
  f.config.dataDirectory = '/replacement';
  assert.equal(receiptCurrent(), false);
  f.config.dataDirectory = '/fixture';
  for (const field of ['disposed', 'clearingAllLocalData', 'localDataClearedRequiresReload']) {
    f.extension[field] = true;
    assert.equal(receiptCurrent(), false, field);
    f.extension[field] = false;
  }
});

test('Claude UI cancellation during discovery prevents manifest scanning', async (t) => {
  const f = calibrationExtension('/fixture');
  let cancelled = false, scans = 0;
  t.mock.method(ClaudeDataLoader, 'findClaudeDataDirectory', async () => { cancelled = true; return '/fixture'; });
  t.mock.method(require('../claudeUsageFiles'), 'scanUsageManifest', async () => { scans++; throw new Error('unexpected scan'); });
  const calibration = { current: () => !cancelled, accepted: false };
  await f.extension.startClaudeRefresh({ ...f.extension.refreshGate.request(false, 'manual'), localOnly: true, calibration });
  assert.equal(scans, 0);
  assert.equal(calibration.accepted, false);
});

test('command OFF/cancel/lifecycle preflight/failure settles busy state without entering final recalibration', async () => {
  for (const mode of ['off', 'cancel', 'disposed', 'clearing', 'reload', 'failure'] as const) {
    calibrationCancelled = mode === 'cancel';
    const f = calibrationExtension('/fixture/never-read');
    if (mode === 'off') f.config.enableAchievements = false;
    if (mode === 'disposed') f.extension.disposed = true;
    if (mode === 'clearing') f.extension.clearingAllLocalData = true;
    if (mode === 'reload') f.extension.localDataClearedRequiresReload = true;
    f.extension.refreshLocalForAchievementCalibration = async () => { throw new Error('fixture failure'); };
    await f.extension.recalibrateAchievements();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.states, mode === 'failure' ? [[true, false], [false, true]] : [[false, false]]);
  }
  calibrationCancelled = false;
});

test('local configuration avoids BYOK lookups; explicit advice configuration still opts in', () => {
  const Extension = loadCalibrationExtension(), extension: any = Object.create(Extension.prototype);
  let reads = 0;
  extension.settings = { get: (key: string) => { if (key === 'advice.apiKey') { reads++; return 'fixture-key'; } } };
  assert.equal(extension.getConfiguration().adviceApiKey, '');
  assert.equal(reads, 0);
  assert.equal(extension.getConfiguration(true).adviceApiKey, 'fixture-key');
  assert.equal(reads, 1);
});

test('calibration admission cannot enqueue ordinary quota work when discovery races a production refresh', async (t) => {
  const f = calibrationExtension('/fixture');
  const active = deferred();
  t.mock.method(ClaudeDataLoader, 'findClaudeDataDirectory', async () => {
    f.extension.claudeRefreshDrain = active.promise;
    return '/fixture';
  });
  let requests = 0;
  f.extension.refreshGate.request = () => { requests++; return null; };
  await assert.rejects(f.extension.refreshLocalForAchievementCalibration(() => true), /refresh-busy/);
  assert.equal(requests, 0);
  active.resolve();
});

test('ordinary work queued behind a local-only pass retains its own quota request', async (t) => {
  const f = calibrationExtension('/fixture'), discovery = deferred();
  t.mock.method(ClaudeDataLoader, 'findClaudeDataDirectory', async () => { await discovery.promise; return null; });
  let quotaCalls = 0;
  f.extension.maybeFetchUsageLimits = async () => { quotaCalls++; return {}; };
  f.extension.refreshCodexData = async () => undefined;
  f.extension.getClaudeQuotaPaceSnapshot = () => undefined;
  const request = f.extension.refreshGate.request(false, 'manual');
  const local = f.extension.startClaudeRefresh({ ...request, localOnly: true });
  await Promise.resolve();
  await f.extension.refreshData(false, 'poll');
  assert.equal(quotaCalls, 0);
  discovery.resolve();
  await local;
  if (f.extension.claudeRefreshDrain) await f.extension.claudeRefreshDrain;
  assert.equal(quotaCalls, 1);
});

test('source generation changes during discovery cannot commit a calibration', async (t) => {
  const f = calibrationExtension('/fixture');
  calibrationCancelled = false;
  t.mock.method(ClaudeDataLoader, 'findClaudeDataDirectory', async () => {
    f.extension.configurationGeneration++;
    return '/fixture';
  });
  await f.extension.recalibrateAchievements();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.states, [[true, false], [false, false]]);
});

test('command forwards commit guard to Webview and late cancellation/source changes never announce completion', async () => {
  for (const mode of ['cancel', 'source'] as const) {
    const f = calibrationExtension('/fixture'), entered = deferred(), ready = deferred();
    calibrationCancelled = false;
    calibrationNotifications.length = 0;
    let writes = 0;
    f.extension.refreshLocalForAchievementCalibration = async () => undefined;
    f.extension.webviewProvider.recalibrateAchievementsFromCurrentData = async (current: () => boolean) => {
      assert.equal(typeof current, 'function');
      assert.ok(current());
      entered.resolve();
      await ready.promise;
      if (!current()) throw new Error('fixture commit guard retired');
      writes++;
    };
    const pending = f.extension.recalibrateAchievements();
    await Promise.race([entered.promise, pending]);
    if (mode === 'cancel') calibrationCancelled = true;
    else f.extension.configurationGeneration++;
    ready.resolve();
    await pending;
    assert.equal(writes, 0);
    assert.deepEqual(calibrationNotifications, []);
    assert.deepEqual(f.states, [[true, false], [false, false]]);
  }
  calibrationCancelled = false;
});

test('successful durable commit is not relabelled cancelled by a subsequent cancel click', async () => {
  for (const mode of ['cancel', 'generation'] as const) {
    const f = fixture();
    let writes = 0;
    f.operation.recalibrate = async current => {
      assert.ok(current());
      writes++;
      mode === 'cancel' ? f.cancel() : f.change();
      return true;
    };
    assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation), 'recalibrated');
    assert.equal(writes, 1);
  }
});

test('precommit cancellation never invokes a callback capable of confirming a commit', async () => {
  const f = fixture();
  let commitCalls = 0;
  f.operation.refreshLocal = async () => { f.cancel(); };
  f.operation.recalibrate = async () => { commitCalls++; return true; };
  assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation), 'cancelled');
  assert.equal(commitCalls, 0);
});

test('explicit completed result can confirm a no-new-write calibration despite a later cancel', async () => {
  const f = fixture();
  f.operation.recalibrate = async current => {
    assert.ok(current());
    // Existing awards already meet all conditions; the Webview confirms that
    // the calibration itself completed before the subsequent cancellation.
    f.cancel();
    return true;
  };
  assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation), 'recalibrated');
  assert.deepEqual(f.calls, ['local-refresh']);
});

test('false or legacy void results without confirmed writes still check retirement after await', async () => {
  for (const committed of [false, undefined]) {
    for (const mode of ['cancel', 'generation', 'off', 'current'] as const) {
      const f = fixture();
      f.operation.recalibrate = async current => {
        assert.ok(current());
        await Promise.resolve();
        if (mode === 'cancel') f.cancel();
        else if (mode === 'generation') f.change();
        else if (mode === 'off') f.disable();
        return committed;
      };
      assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation),
        mode === 'current' ? 'recalibrated' : mode === 'off' ? 'disabled' : 'cancelled');
    }
  }
});

test('command success toast follows confirmed commit despite late cancel or source retirement', async () => {
  for (const committed of [true, false, undefined]) {
    for (const mode of ['cancel', 'source'] as const) {
      const f = calibrationExtension('/fixture');
      calibrationCancelled = false;
      calibrationNotifications.length = 0;
      f.extension.refreshLocalForAchievementCalibration = async () => undefined;
      f.extension.webviewProvider.recalibrateAchievementsFromCurrentData = async (current: () => boolean) => {
        assert.ok(current());
        // true represents a confirmed atomic write made while current() was
        // valid; false/void do not establish that any new award was committed.
        if (mode === 'cancel') calibrationCancelled = true;
        else f.extension.configurationGeneration++;
        return committed;
      };
      await f.extension.recalibrateAchievements();
      assert.deepEqual(calibrationNotifications, committed === true
        ? [require('../i18n').I18n.achievementManagement.recalibrated] : []);
      assert.deepEqual(f.states, [[true, false], [false, false]]);
    }
  }
  calibrationCancelled = false;
});

test('partial completion survives late cancellation/source retirement without becoming failed', async () => {
  for (const mode of ['current', 'cancel', 'generation'] as const) {
    const f = fixture();
    f.operation.recalibrate = async current => {
      assert.ok(current());
      if (mode === 'cancel') f.cancel();
      if (mode === 'generation') f.change();
      return 'partial';
    };
    assert.equal(await new AchievementCalibrationSingleFlight().run(f.operation), 'partial');
  }
});

test('command partial completion uses warning toast even after a late cancellation', async () => {
  for (const cancelled of [false, true]) {
    const f = calibrationExtension('/fixture');
    calibrationCancelled = false;
    calibrationNotifications.length = 0;
    calibrationWarnings.length = 0;
    f.extension.refreshLocalForAchievementCalibration = async () => undefined;
    f.extension.webviewProvider.recalibrateAchievementsFromCurrentData = async (current: () => boolean) => {
      assert.ok(current());
      calibrationCancelled = cancelled;
      return 'partial';
    };
    await f.extension.recalibrateAchievements();
    const copy = require('../i18n').I18n.achievementManagement.recalibratedPartial;
    assert.equal(typeof copy, 'string');
    assert.deepEqual(calibrationWarnings, [copy]);
    assert.deepEqual(calibrationNotifications, []);
    assert.deepEqual(f.states, [[true, false], [false, false]]);
  }
  calibrationCancelled = false;
});

test('a cooled failed production refresh cannot be reported as successful recalibration', async (t) => {
  const f = calibrationExtension('/fixture');
  t.mock.method(ClaudeDataLoader, 'findClaudeDataDirectory', async () => '/fixture');
  f.extension.claudeRefreshRecovery = { admit: () => false };
  await f.extension.recalibrateAchievements();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.states, [[true, false], [false, true]]);
});

test('production Codex calibration performs one bounded pass and admits only a successful result', async () => {
  for (const outcome of ['success', 'error', 'cancel'] as const) {
    const f = calibrationExtension('');
    f.config.codexEnabled = true;
    const snapshot = snapshotFixture();
    let passes = 0;
    Object.assign(f.extension, {
      codexRefreshGate: new RefreshSingleFlight(), codexRefreshDrain: null,
      activeCodexRefreshes: new Set(), resourceOwnership: new ResourceOwnershipRegistry(),
      waitForCodexProviderRetirements: async () => undefined,
      codexHome: () => '/fixture/codex', selectCodexSnapshotHome: () => undefined,
      saveCodexBackgroundState: async () => undefined,
      stopFirstBackfillBlurDeadline: () => undefined,
      codexBackgroundState: createBackgroundWorkState({ measurementVersion: 2, reason: 'history-backfill', now: 0 }),
      windowActivity: { focused: true },
      applyCodexSnapshot: () => { f.extension.codexView = {}; },
      codexHistoricalWorkPending: () => true,
      codexProvider: {
        isAvailable: async () => true,
        loadPersistedSnapshot: async () => snapshot,
        refresh: async () => {
          passes++;
          return { outcome, snapshot, diagnostic: { failedFiles: outcome === 'error' ? 1 : 0 } };
        },
      },
    });
    let cancelled = false, ioCurrent!: () => boolean, receiptCurrent!: () => boolean;
    f.extension.webviewProvider.beginCodexAchievementObservation = async (current: () => boolean, source: () => boolean) => {
      ioCurrent = current; receiptCurrent = source;
      cancelled = outcome === 'cancel';
      return {};
    };
    f.extension.webviewProvider.acceptCodexAchievementSnapshot = () => f.calls.push('codex-snapshot');
    const calibration = { current: () => !cancelled, accepted: false };
    await f.extension.refreshCodexData('manual', calibration);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(passes, outcome === 'cancel' ? 0 : 1);
    assert.equal(calibration.accepted, outcome === 'success');
    assert.equal(f.calls.includes('codex-snapshot'), outcome === 'success');
    assert.equal(f.extension.codexRefreshDrain, null);
    if (outcome === 'cancel') {
      assert.equal(ioCurrent(), false);
      assert.equal(receiptCurrent(), true);
      f.extension.configurationGeneration++;
      assert.equal(receiptCurrent(), false);
      f.extension.configurationGeneration--;
      const provider = f.extension.codexProvider;
      f.extension.codexProvider = {};
      assert.equal(receiptCurrent(), false);
      f.extension.codexProvider = provider;
      f.extension.disposed = true;
      assert.equal(receiptCurrent(), false);
    }
  }
});

test('Codex numeric history projection runs only for enabled accepted current-index evidence', async (t) => {
  const historyModule = require('../achievementHistoryDates') as typeof import('../achievementHistoryDates');
  let projections = 0;
  t.mock.method(historyModule, 'codexAchievementHistoryEvidence', (_files: CodexFileAggregate[], zone: string) => {
    projections++;
    return { timeZone: zone, complete: false, days: [] };
  });
  for (const mode of ['accepted', 'off', 'failed', 'unverified'] as const) {
    const f = calibrationExtension('');
    f.config.enableAchievements = mode !== 'off';
    const snapshot = snapshotFixture();
    snapshot.currentManifestVerified = mode !== 'unverified';
    snapshot.coverage.complete = true;
    Object.assign(f.extension, {
      codexHome: () => '/fixture/codex', selectCodexSnapshotHome: () => undefined,
      quotaObservationStore: createEmptyQuotaObservationStore(),
      recordCodexQuotaObservations: async () => undefined,
      codexView: null,
    });
    const before = projections;
    f.extension.applyCodexSnapshot(snapshot, mode !== 'failed');
    assert.equal(projections - before, mode === 'accepted' ? 1 : 0);
    assert.equal(!!f.extension.codexAchievementSignals.historyDayEvidence, mode === 'accepted');
  }
});

test('completed real Claude index hands off its native delta after UI cancellation, but not actual source retirement', async (t) => {
  const indexModule = require('../claudeIncrementalIndex') as typeof import('../claudeIncrementalIndex');
  const update = indexModule.updateClaudeUsageIndex;
  let afterProduced = (_result: Awaited<ReturnType<typeof update>>) => {};
  t.mock.method(indexModule, 'updateClaudeUsageIndex', async (...args: Parameters<typeof update>) => {
    const result = await update(...args);
    afterProduced(result); // Real producer has finalized its index and native delta; host await has not resumed.
    return result;
  });
  for (const mode of ['cancel', 'presentation', 'source', 'clear', 'reload', 'off', 'off-on', 'disposed'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-postcommit-'));
    afterProduced = () => {};
    try {
      const project = path.join(root, 'projects', 'fixture'), file = path.join(project, 'session.jsonl');
      await mkdir(project, { recursive: true });
      const row = (id: string) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
        requestId: id, message: { id, model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 1 } } }) + '\n';
      await writeFile(file, row('baseline'));
      const f = calibrationExtension(root);
      let receiptCurrent!: () => boolean, acceptedDelta: unknown, acceptedSnapshot: any, historyCalls = 0, cancelled = false;
      f.extension.webviewProvider.beginClaudeAchievementObservation = async (_current: () => boolean, source: () => boolean) => {
        receiptCurrent = source;
        return { window: { after: Date.now() - 60_000, through: Date.now() } };
      };
      f.extension.webviewProvider.acceptClaudeAchievementSnapshot = (snapshot: any, _handle: unknown, delta: unknown) => {
        assert.equal(receiptCurrent(), true);
        assert.equal(snapshot.records, f.extension.cache.records);
        acceptedDelta = delta; acceptedSnapshot = snapshot;
      };
      const start = (calibration?: { current(): boolean; accepted: boolean }) => f.extension.startClaudeRefresh({
        ...f.extension.refreshGate.request(false, 'manual'), localOnly: true, calibration,
      });
      await start();
      acceptedSnapshot = undefined; acceptedDelta = undefined;
      await appendFile(file, row('tail'));
      let produced: Awaited<ReturnType<typeof update>> | undefined, producerPasses = 0;
      afterProduced = result => {
        produced = result; producerPasses++;
        assert.equal(result.diagnostics.filesFailed, 0);
        assert.ok((result.achievementUsageDelta?.processed ?? 0) > 0);
        cancelled = true;
        if (mode === 'presentation') f.extension.configurationGeneration++;
        if (mode === 'source') f.extension.claudeIndexGeneration++;
        if (mode === 'clear') f.extension.clearingAllLocalData = true;
        if (mode === 'reload') f.extension.localDataClearedRequiresReload = true;
        if (mode === 'off') f.config.enableAchievements = false;
        if (mode === 'off-on') f.extension.achievementCalibrationGeneration++;
        if (mode === 'disposed') f.extension.disposed = true;
      };
      let calibration!: { current(): boolean; accepted: boolean };
      const result = await new AchievementCalibrationSingleFlight().run({
        enabled: () => f.config.enableAchievements,
        cancelled: () => cancelled,
        generation: () => f.extension.achievementCalibrationGeneration,
        refreshLocal: async current => { calibration = { current, accepted: false }; await start(calibration); },
        recalibrate: async () => { historyCalls++; return true; },
      });
      assert.equal(result, mode === 'off' ? 'disabled' : 'cancelled');
      assert.equal(historyCalls, 0);
      assert.equal(producerPasses, 1);
      assert.equal(calibration.accepted, mode === 'cancel'||mode==='presentation', mode);
      if (mode === 'cancel'||mode==='presentation') {
        assert.equal(f.extension.cache.claudeIndex, produced!.index);
        assert.equal(acceptedDelta, produced!.achievementUsageDelta, 'forward exactly the native delta, never rebuild one');
        assert.ok(acceptedSnapshot);
        assert.equal(receiptCurrent(), true);
        assert.equal(f.extension.providerRefreshStates.claude.failed, false);
      } else assert.equal(acceptedSnapshot, undefined, mode);
    } finally { afterProduced = () => {}; await rm(root, { recursive: true, force: true }); }
  }
});

test('persisted real Codex worker result reaches handoff after cancellation before provider await resumes', async () => {
  const { CodexProvider } = require('../providers/codex/codexProvider') as typeof import('../providers/codex/codexProvider');
  for (const mode of ['cancel', 'provider', 'clear', 'reload', 'off', 'off-on', 'disposed'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-postcommit-'));
    let provider: InstanceType<typeof CodexProvider> | undefined;
    try {
      const home = path.join(root, 'home'), sessions = path.join(home, 'sessions'), file = path.join(sessions, 'session.jsonl');
      const indexPath = path.join(root, 'derived', 'index.json');
      await mkdir(sessions, { recursive: true });
      const token = (input: number) => JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: input / 10,
          cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: input + input / 10 } } } }) + '\n';
      await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: 'fixture-live' } }) + '\n' +
        JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-astra', effort: 'max' } }) + '\n' + token(100));
      const f = calibrationExtension('');
      f.config.codexEnabled = true;
      const logs: string[] = [];
      f.extension.outputChannel.appendLine = (line: string) => logs.push(line);
      provider = new CodexProvider({ enabled: true, codexHome: home, indexPath,
        salt: 'isolated-calibration-fixture', timeZone: 'UTC', allowAchievementHourProof: true });
      Object.assign(f.extension, {
        codexRefreshGate: new RefreshSingleFlight(), codexRefreshDrain: null,
        activeCodexRefreshes: new Set(), resourceOwnership: new ResourceOwnershipRegistry(),
        waitForCodexProviderRetirements: async () => undefined,
        codexHome: () => home, saveCodexBackgroundState: async () => undefined,
        stopFirstBackfillBlurDeadline: () => undefined,
        codexBackgroundState: createBackgroundWorkState({ measurementVersion: 2, reason: 'history-backfill', now: 0 }),
        windowActivity: { focused: true }, codexProvider: provider, codexView: null,
        quotaObservationStore: createEmptyQuotaObservationStore(), recordCodexQuotaObservations: async () => undefined,
      });
      let receiptCurrent!: () => boolean, acceptedDelta: unknown, acceptedView: unknown, cancelled = false, historyCalls = 0;
      f.extension.webviewProvider.beginCodexAchievementObservation = async (_current: () => boolean, source: () => boolean) => {
        receiptCurrent = source;
        return { window: { after: Date.now() - 60_000, through: Date.now() } };
      };
      f.extension.webviewProvider.acceptCodexAchievementSnapshot = (view: unknown, _signals: unknown, _handle: unknown, delta: unknown) => {
        assert.equal(receiptCurrent(), true);
        acceptedView = view; acceptedDelta = delta;
      };
      await f.extension.refreshCodexData('manual', { current: () => true, accepted: false });
      assert.ok(f.extension.codexView?.currentManifestVerified, logs.join('\n'));
      acceptedDelta = undefined; acceptedView = undefined;
      await appendFile(file, token(300));
      const refresh = provider.refresh.bind(provider);
      let produced: Awaited<ReturnType<typeof refresh>> | undefined, producerPasses = 0, persisted = false;
      provider.refresh = async (...args: Parameters<typeof refresh>) => {
        const result = await refresh(...args);
        produced = result; producerPasses++;
        persisted = (await readFile(indexPath)).length > 0;
        cancelled = true; // Persisted real worker result exists, extension await has not resumed.
        if (mode === 'provider') f.extension.codexProvider = {};
        if (mode === 'clear') f.extension.clearingAllLocalData = true;
        if (mode === 'reload') f.extension.localDataClearedRequiresReload = true;
        if (mode === 'off') f.config.enableAchievements = false;
        if (mode === 'off-on') f.extension.achievementCalibrationGeneration++;
        if (mode === 'disposed') f.extension.disposed = true;
        return result;
      };
      let calibration!: { current(): boolean; accepted: boolean };
      const result = await new AchievementCalibrationSingleFlight().run({
        enabled: () => f.config.enableAchievements, cancelled: () => cancelled,
        generation: () => f.extension.achievementCalibrationGeneration,
        refreshLocal: async current => { calibration = { current, accepted: false }; await f.extension.refreshCodexData('manual', calibration); },
        recalibrate: async () => { historyCalls++; return true; },
      });
      assert.equal(producerPasses, 1, logs.join('\n'));
      assert.equal(produced?.diagnostic?.failedFiles, 0, JSON.stringify(produced?.diagnostic));
      assert.ok((produced?.achievementUsageDelta?.processed ?? 0) > 0, JSON.stringify({
        diagnostic: produced?.diagnostic, delta: produced?.achievementUsageDelta,
        complete: produced?.snapshot.coverage.complete, quality: produced?.snapshot.qualityFlags,
      }));
      assert.ok(persisted, 'worker has already persisted the isolated index');
      assert.equal(result, mode === 'off' ? 'disabled' : 'cancelled');
      assert.equal(historyCalls, 0);
      assert.equal(producerPasses, 1);
      assert.equal(calibration.accepted, mode === 'cancel', mode);
      if (mode === 'cancel') {
        assert.equal(acceptedDelta, produced!.achievementUsageDelta);
        assert.equal(acceptedView, f.extension.codexView);
        assert.ok(acceptedView);
        assert.equal(receiptCurrent(), true);
        assert.equal(f.extension.providerRefreshStates.codex.failed, false);
      } else assert.equal(acceptedView, undefined, mode);
    } finally { await provider?.dispose(); await rm(root, { recursive: true, force: true }); }
  }
});
