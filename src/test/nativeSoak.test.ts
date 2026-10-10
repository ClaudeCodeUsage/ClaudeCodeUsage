import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');

const helper = (): any => require(path.resolve(__dirname, '../../tests/native/soak.cjs'));
const isolation = (): any => require(path.resolve(__dirname, '../../tests/native/isolation.cjs'));
const memory = { rss: 300 * 1024 ** 2, heapUsed: 30 * 1024 ** 2,
  external: 5 * 1024 ** 2, arrayBuffers: 1024 };
const owned = { activeCount: 3, byKind: { timer: 1, watcher: 2, worker: 0, network: 0, backfill: 0 } };

test('native driver checks watched append before focus-changing panel creation', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../../tests/native/soak.cjs'), 'utf8');
  const cycle = source.slice(source.indexOf('while (performance.now() - soakStarted < options.durationMs'));
  const append = cycle.indexOf('await appendSyntheticActivity(');
  const verified = cycle.indexOf('assert.equal(instance.codexView.allTime.total.processed, processedBefore + 1100)');
  const panel = cycle.indexOf("view.show('achievements')");
  const warm = cycle.indexOf("markStage('warm-refresh')");
  assert.ok(append >= 0 && verified > append);
  assert.ok(panel > verified, 'do not provoke a native focus transition while awaiting watched source evidence');
  assert.ok(warm > panel, 'actual panel remains open during the twenty manual warm refreshes');
});

test('native soak options are explicit, finite and never turn a short preflight into a long-soak pass', () => {
  assert.deepEqual(helper().validateSoakOptions({ durationMs: 1800000 }), { durationMs: 1800000 });
  for (const value of [null, {}, { durationMs: -1 }, { durationMs: NaN }, { durationMs: 3600001 },
    { durationMs: 1800000, root: '/' }, { durationMs: '1800000' }]) {
    assert.throws(() => helper().validateSoakOptions(value), /^Error: native-soak:invalid-options$/);
  }
  assert.equal(helper().longSoakDurationPassed(500), false);
  assert.equal(helper().longSoakDurationPassed(1799999), false);
  assert.equal(helper().longSoakDurationPassed(1800000), true);
});

test('native soak samples keep only fixed anonymous numbers and copied ownership counts', () => {
  const input: any = { ...memory, arbitrary: 'must not be retained' };
  const resources: any = { ...owned, byKind: { ...owned.byKind }, active: ['must not be retained'] };
  const sample = helper().sampleOwnedResources(input, resources, 123, true, true, 2, 1);
  resources.byKind.watcher = 99;
  assert.deepEqual(sample, { elapsedMs: 123, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external, arrayBufferBytes: memory.arrayBuffers, ownedActive: 3,
    ownedByKind: owned.byKind, achievementsEnabled: true, panelOpen: true, panelCacheEntries: 2,
    pendingNoticeEntries: 1 });
  assert.ok(!JSON.stringify(sample).includes('retained'));
});

test('native soak resource guard rejects owned network, excess watchers and incomplete samples', () => {
  const sample = helper().sampleOwnedResources(memory, owned, 0, false, false, 0, 0);
  helper().assertResourceBudget(sample);
  for (const [kind, count] of [['network', 1], ['watcher', 3], ['worker', 2], ['timer', 9]]) {
    const changed = { ...sample, ownedByKind: { ...sample.ownedByKind, [kind]: count } };
    assert.throws(() => helper().assertResourceBudget(changed), /native-soak:resource-budget/);
  }
  assert.throws(() => helper().sampleOwnedResources({ ...memory, rss: undefined }, owned, 0, false, false, 0, 0),
    /native-soak:invalid-sample/);
  assert.throws(() => helper().assertResourceBudget({ ...sample, rssBytes: 2 * 1024 ** 3 }),
    /native-soak:resource-budget/);
});

test('native soak sample count and panel/notice caches cannot grow without bound', () => {
  const sample = helper().sampleOwnedResources(memory, owned, 0, true, false, 0, 0);
  for (const changed of [{ ...sample, panelCacheEntries: 25 }, { ...sample, pendingNoticeEntries: 3 }]) {
    assert.throws(() => helper().assertResourceBudget(changed), /native-soak:resource-budget/);
  }
  const samples: any[] = [];
  for (let i = 0; i < 1024; i++) helper().appendBoundedSample(samples, sample);
  assert.throws(() => helper().appendBoundedSample(samples, sample), /native-soak:sample-budget/);
  assert.equal(samples.length, 1024);
});

test('native soak operation deadlines reject a stuck operation but keep settled results exact', async () => {
  assert.equal(await helper().bounded(Promise.resolve(42), 50), 42);
  await assert.rejects(helper().bounded(new Promise(() => undefined), 10), /native-soak:operation-timeout/);
});

test('native soak failure focus observation retains only exact booleans and a known watcher count', () => {
  assert.deepEqual(helper().failureFocusObservation(false, false, 0), {
    logicalFocused: false, nativeFocused: false, watcherCount: 0,
  });
  assert.deepEqual(helper().failureFocusObservation(true, false, 2), {
    logicalFocused: true, nativeFocused: false, watcherCount: 2,
  });
});

test('native soak failure focus observation never coerces unavailable values to false or zero', () => {
  for (const values of [[undefined, false, 0], [true, undefined, 0], [false, false, undefined],
    [false, false, NaN], [false, false, -1], [false, false, '2'], ['true', false, 2]]) {
    assert.equal(helper().failureFocusObservation(...values), null);
  }
});

test('native soak recurring-readiness failures identify the exact fixed assertion without persisting settings', () => {
  const config = { fileWatchSeconds: 1, codexFileWatchSeconds: 10 };
  helper().assertRecurringReady(config, owned);
  for (const [configuration, resources, expected] of [
    [{ ...config, fileWatchSeconds: 2 }, owned, 'setup-claude-watch-setting'],
    [{ ...config, codexFileWatchSeconds: 30 }, owned, 'setup-codex-watch-setting'],
    [config, { ...owned, byKind: { ...owned.byKind, watcher: 1 } }, 'setup-watchers'],
  ]) {
    let caught: unknown;
    try { helper().assertRecurringReady(configuration, resources); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(helper().diagnosticFailureReason(caught), expected);
  }
});

test('native setup requires a stable public readback interval, not one successful sample', () => {
  const probe = helper().createReadbackStability();
  assert.equal(probe.observe(0, true), false);
  assert.equal(probe.observe(499, true), false);
  assert.equal(probe.observe(500, true), true);
  assert.deepEqual(probe.snapshot(), { requiredStableMs: 500, samples: 3, mismatches: 0, convergenceMs: 500 });
});
test('native setup transient regression restarts read-only stability without another write', () => {
  const probe = helper().createReadbackStability();
  for (const [at, expected, complete] of [[0,true,false],[200,false,false],[400,true,false],[899,true,false],[900,true,true]])
    assert.equal(probe.observe(at, expected), complete);
  assert.deepEqual(probe.snapshot(), { requiredStableMs: 500, samples: 5, mismatches: 1, convergenceMs: 900 });
});
test('native setup readback timing and sample budgets fail closed without coercion', () => {
  for (const at of [-1, NaN, Infinity, '0', undefined])
    assert.throws(() => helper().createReadbackStability().observe(at, true));
  for (const expected of [0, 1, 'true', undefined, {}])
    assert.throws(() => helper().createReadbackStability().observe(0, expected));
  const backwards = helper().createReadbackStability();backwards.observe(1, true);
  assert.throws(() => backwards.observe(0, true));
  const capped = helper().createReadbackStability();
  for (let i=0;i<256;i++) capped.observe(i, false);
  assert.throws(() => capped.observe(256, false));
});

test('native soak setup readback projects only fixed phases, equality booleans, types and bounded counters', () => {
  const counts = { claude: { started: 1, completed: 1 }, codex: { started: 1, completed: 0 },
    other: { started: 32, completed: 32 }, private: 'never retain' };
  const projected = helper().projectSetupReadback('after-codex-set', '1', '10', '1', '10', 1, 10, counts);
  assert.deepEqual(projected, {
    phase: 'after-codex-set',
    memento: { claude: { expectedEqual: true, type: 'string' }, codex: { expectedEqual: true, type: 'string' } },
    settings: { claude: { expectedEqual: true, type: 'string' }, codex: { expectedEqual: true, type: 'string' } },
    configuration: { claude: { expectedEqual: true, type: 'number' }, codex: { expectedEqual: true, type: 'number' } },
    updates: { claude: { started: 1, completed: 1 }, codex: { started: 1, completed: 0 },
      other: { started: 32, completed: 32 } },
  });
  counts.claude.started = 9;
  assert.equal(projected.updates.claude.started, 1);
  for (const phase of ['after-cold-settle', 'after-claude-set', 'after-codex-set',
    'after-handler', 'after-settle', 'after-focus']) {
    assert.equal(helper().projectSetupReadback(phase, '1', '10', '1', '10', 1, 10, counts).phase, phase);
  }
  assert.equal(helper().projectSetupReadback('private-phase', '1', '10', '1', '10', 1, 10, counts), null);
  for (const invalid of [-1, NaN, Infinity, 33, '1', undefined]) {
    assert.equal(helper().projectSetupReadback('after-focus', '1', '10', '1', '10', 1, 10,
      { ...counts, claude: { started: invalid, completed: 0 } }), null);
  }
});

test('native soak setup readback never inspects or retains unknown values', () => {
  let inspected = 0;
  const hostile = new Proxy({}, { get() { inspected++; throw new Error('private-proxy-detail'); } });
  const counts = { claude: { started: 0, completed: 0 }, codex: { started: 0, completed: 0 },
    other: { started: 0, completed: 0 } };
  for (const value of [undefined, null, false, 2, NaN, Infinity, 'private-setting-value',
    Symbol('private-symbol'), 123n, () => 'private-function', hostile]) {
    const row = helper().projectSetupReadback('after-focus', value, value, value, value, value, value, counts);
    for (const source of ['memento', 'settings', 'configuration']) {
      assert.deepEqual(row[source].claude, { expectedEqual: false, type: typeof value });
      assert.deepEqual(row[source].codex, { expectedEqual: false, type: typeof value });
    }
    assert.ok(!JSON.stringify(row).includes('private'));
  }
  assert.equal(helper().projectSetupReadback(hostile, hostile, hostile, hostile, hostile, hostile, hostile, counts), null);
  assert.equal(inspected, 0);
});

test('native soak setup update probe preserves receiver, result, rejection and restoration with saturated counters', async () => {
  const values = new Map<string, unknown>();
  const state: any = { get: (key: string) => values.get(key) };
  let returned: Promise<void>;
  const original = function(this: unknown, key: string, value: unknown): Promise<void> {
    assert.equal(this, state);
    values.set(key, value);
    returned = key === 'private-rejected-key'
      ? Promise.reject(new Error('private-update-detail')) : Promise.resolve();
    return returned;
  };
  Object.setPrototypeOf(state, { update: original });
  const probe = helper().createSetupReadbackProbe(state);
  const first = state.update('ccu.setting.fileWatchSeconds', '1');
  assert.equal(first, returned!);
  await first;
  await state.update('ccu.setting.codex.fileWatchSeconds', '10');
  for (let i = 0; i < 40; i++) await state.update('private-other-key', 'private-value');
  await assert.rejects(state.update('private-rejected-key', 'private-value'), /private-update-detail/);
  const settings = { get: (key: string) => values.get('ccu.setting.' + key) };
  const rows: any[] = [];
  assert.equal(probe.capture(rows, 'after-focus', settings, { fileWatchSeconds: 1, codexFileWatchSeconds: 10 }), true);
  assert.deepEqual(rows[0].updates, { claude: { started: 1, completed: 1 },
    codex: { started: 1, completed: 1 }, other: { started: 32, completed: 32 } });
  assert.ok(!JSON.stringify(rows).includes('private'));
  for (let i = 1; i < 32; i++) probe.capture(rows, 'after-focus', settings, { fileWatchSeconds: 1, codexFileWatchSeconds: 10 });
  assert.equal(probe.capture(rows, 'after-focus', settings, { fileWatchSeconds: 1, codexFileWatchSeconds: 10 }), false);
  assert.equal(rows.length, 32);
  probe.restore();
  probe.restore();
  assert.equal(state.update, original);
  assert.equal(Object.prototype.hasOwnProperty.call(state, 'update'), false);
});

test('native soak records setup and final failure readbacks before restoring updates and stopping', async t => {
  const { plan } = await fixtures(t);
  await fs.writeFile(path.join(plan.root, 'native-stage-manifest.json'), JSON.stringify({ sourceHead: 'fea8879' }));
  const values = new Map<string, unknown>([
    ['ccu.setting.fileWatchSeconds', '0'], ['ccu.setting.codex.fileWatchSeconds', '0'],
  ]);
  const state = { get: (key: string) => values.get(key),
    update: async function(key: string, value: unknown) {
      assert.equal(this, state);
      values.set(key, value);
    } };
  const original = state.update;
  const context = { extensionMode: 3, extensionPath: plan.directories.developmentExtension, globalState: state };
  let stopped = false, handlerCalled = false;
  const instance = {
    context, initializationWrites: Promise.resolve(), initializationWriteFailure: null,
    refreshGate: { active: false }, activeCodexRefreshes: new Set(), codexCheckpointHydration: false,
    pendingResourceStops: new Set(), codexProviderRetirements: new Set(), codexProviderRetirementFailure: null,
    codexBackgroundStateWrite: Promise.resolve(),
    cache: { dataDirectory: plan.directories.claudeHome }, codexSnapshotHome: plan.directories.codexHome,
    codexHasData: true, webviewProvider: { panel: undefined }, windowActivity: { focused: false },
    outputChannel: { appendLine() {} },
    resourceOwnership: { snapshotForTests: () => stopped ? { activeCount: 0 } : owned },
    settings: {
      get: (key: string) => key === 'advice.apiKey' ? '' : state.get('ccu.setting.' + key),
      set: (key: string, value: unknown) => state.update('ccu.setting.' + key, value),
    },
    getConfiguration: () => ({ usageLimitTracking: false,
      fileWatchSeconds: Number(state.get('ccu.setting.fileWatchSeconds')),
      codexFileWatchSeconds: Number(state.get('ccu.setting.codex.fileWatchSeconds')) }),
    refreshData: async () => undefined,
    onSettingsChangedFromPanel: () => { handlerCalled = true; },
    handleWindowFocusChange: (focused: boolean) => {
      instance.windowActivity.focused = focused;
      // Synthetic divergence AFTER convergence: the unchanged assertion must
      // still reject it, not rewrite a setting or silently retry the case.
      if (focused) values.set('ccu.setting.fileWatchSeconds', '2');
    },
  };
  const api = { plan, context, instance, isolation: { testModeVerified: true, actualStatePathsVerified: true,
    syntheticHomesVerified: true, ownSafetySeedCompleted: true },
  stop: async () => { assert.equal(state.update, original); stopped = true; } };
  const load = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return { version: 'synthetic-api-not-native', ExtensionMode: { Test: 3 },
      window: { state: { focused: false }, onDidChangeWindowState: () => ({ dispose() {} }) },
      extensions: { getExtension: () => ({ activate: async () => api }) } };
    return load.call(this, request, parent, isMain);
  };
  try {
    await assert.rejects(helper().run(plan, { durationMs: 100 }), /^Error: native-soak:failed-recurring-setup$/);
    const text = await fs.readFile(path.join(plan.root, 'native-soak-result.json'), 'utf8');
    const report = JSON.parse(text), rows = report.setupReadbacks;
    assert.deepEqual(rows.map((row: any) => row.phase), ['after-cold-settle', 'after-claude-set',
      'after-codex-set', 'after-readback-convergence', 'after-handler', 'after-settle', 'after-focus', 'on-failure']);
    assert.equal(rows[7].memento.claude.expectedEqual, false);
    assert.equal(rows[7].configuration.codex.expectedEqual, true);
    assert.equal(rows[0].memento.claude.expectedEqual, false);
    assert.equal(rows[1].memento.claude.expectedEqual, true);
    assert.equal(rows[2].memento.claude.expectedEqual, true);
    assert.equal(rows[3].memento.claude.expectedEqual, true);
    assert.equal(rows[6].memento.claude.expectedEqual, false);
    assert.equal(rows[6].configuration.codex.expectedEqual, true);
    assert.deepEqual(rows[6].updates, { claude: { started: 1, completed: 1 },
      codex: { started: 1, completed: 1 }, other: { started: 0, completed: 0 } });
    assert.equal(report.setupReadbackStability.requiredStableMs, 500);
    assert.ok(report.setupReadbackStability.samples >= 6);
    assert.equal(report.setupReadbackStability.mismatches, 0);
    assert.ok(report.setupReadbackStability.convergenceMs >= 500);
    assert.equal(report.failureReason, 'setup-claude-watch-setting');
    assert.equal(report.stopCompleted, true);
    assert.equal(report.counters.cycles, 0);
    assert.equal(handlerCalled, true);
    assert.equal(state.update, original);
    assert.ok(!text.includes('ccu.setting.') && !text.includes(plan.root));
  } finally { (Module as any)._load = load; }
});

test('native soak failure reasons distinguish its own resource, sample and operation guards', async () => {
  const sample = helper().sampleOwnedResources(memory, owned, 0, false, false, 0, 0);
  const work = [
    [() => helper().assertResourceBudget({ ...sample, rssBytes: 2 * 1024 ** 3 }), 'resource-budget'],
    [() => helper().sampleOwnedResources({ ...memory, rss: undefined }, owned, 0, false, false, 0, 0), 'invalid-sample'],
    [() => helper().appendBoundedSample(Array(1024).fill(sample), sample), 'sample-budget'],
  ] as const;
  for (const [run, expected] of work) {
    let caught: unknown;
    try { run(); } catch (error) { caught = error; }
    assert.equal(helper().diagnosticFailureReason(caught), expected);
  }
  await assert.rejects(helper().bounded(new Promise(() => undefined), 10), (error: unknown) => {
    assert.equal(helper().diagnosticFailureReason(error), 'operation-timeout');
    return true;
  });
});

test('native soak rejects message-spoofed reason codes instead of parsing untrusted exceptions', () => {
  for (const error of [new Error('native-soak:resource-budget'), new Error('private-file-path'),
    { code: 'resource-budget', reason: 'setup-watchers' }, null, undefined, 'resource-budget']) {
    assert.equal(helper().diagnosticFailureReason(error), 'assertion-or-stage-failure');
  }
});

test('native soak diagnostic classification never reads arbitrary exception getters or proxy properties', () => {
  let reads = 0;
  const error = new Proxy({}, { get() { reads++; throw new Error('private-getter-detail'); } });
  assert.equal(helper().diagnosticFailureReason(error), 'assertion-or-stage-failure');
  assert.equal(reads, 0);
});

test('native soak preserves anonymous entry and failure reports when activation rejects', async t => {
  const { plan } = await fixtures(t);
  await fs.writeFile(path.join(plan.root, 'native-stage-manifest.json'), JSON.stringify({ sourceHead: 'fea8879' }));
  const load = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return { version: 'synthetic-api-not-native', extensions: {
      getExtension: () => ({ activate: async () => { throw new Error('private-activation-detail'); } }),
    } };
    return load.call(this, request, parent, isMain);
  };
  try {
    await assert.rejects(helper().run(plan, { durationMs: 100 }), /^Error: native-soak:failed-activation$/);
    const progress = JSON.parse(await fs.readFile(path.join(plan.root, 'native-soak-progress.json'), 'utf8'));
    const reportText = await fs.readFile(path.join(plan.root, 'native-soak-result.json'), 'utf8');
    const report = JSON.parse(reportText);
    assert.equal(progress.stage, 'activation');
    assert.equal(report.outcome, 'fail');
    assert.equal(report.failureStage, 'activation');
    assert.equal(report.failureReason, 'assertion-or-stage-failure');
    assert.equal(report.stopCompleted, false);
    assert.equal(report.longSoakDurationPassed, false);
    assert.equal(report.failureFocus, null);
    assert.equal(report.counters.nativeWindowTransitions, 0);
    assert.deepEqual(report.samples, []);
    assert.ok(!reportText.includes('private-activation-detail'));
    assert.ok(!reportText.includes(plan.root));
  } finally { (Module as any)._load = load; }
});

async function fixtures(t: TestContext): Promise<any> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ccu-native-v242-')));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const plan = isolation().buildNativeIsolationPlan(root), p = plan.directories;
  for (const directory of Object.values(p) as string[]) await fs.mkdir(directory);
  await fs.mkdir(path.join(p.claudeHome, 'projects/synthetic-native'), { recursive: true });
  await fs.mkdir(path.join(p.codexHome, 'sessions'));
  const files = [path.join(p.claudeHome, 'projects/synthetic-native/synthetic-native-0.jsonl'),
    path.join(p.codexHome, 'sessions/rollout-0.jsonl')];
  for (const file of files) await fs.writeFile(file, '{}\n');
  return { plan, files };
}

test('native soak appends only bounded anonymous synthetic records to its two exact regular files', async t => {
  const { plan, files } = await fixtures(t);
  const before = await Promise.all(files.map((file: string) => fs.readFile(file, 'utf8')));
  const result = await helper().appendSyntheticActivity(plan, 201, 1767225600000);
  assert.equal(result.files, 2);
  assert.ok(result.bytes > 0 && result.bytes < 4096);
  for (let i = 0; i < 2; i++) {
    const body = await fs.readFile(files[i], 'utf8');
    assert.ok(body.startsWith(before[i]));
    const row = JSON.parse(body.trim().split('\n')[1]);
    assert.equal(row.timestamp, '2026-01-01T00:00:00.000Z');
  }
  const claude = JSON.parse((await fs.readFile(files[0], 'utf8')).trim().split('\n')[1]);
  assert.equal(claude.message.usage.input_tokens, 1000);
  const codex = JSON.parse((await fs.readFile(files[1], 'utf8')).trim().split('\n')[1]);
  assert.equal(codex.payload.info.total_token_usage.input_tokens, 201000);
});

test('native soak refuses malformed sequence, forged source plan and symlink targets before append', async t => {
  const { plan, files } = await fixtures(t);
  const before = await fs.readFile(files[0], 'utf8');
  for (const sequence of [200, 0, 300, NaN, '201']) {
    await assert.rejects(helper().appendSyntheticActivity(plan, sequence, Date.now()), /native-soak:invalid-activity/);
  }
  const forged = structuredClone(plan);
  forged.directories.claudeHome = os.tmpdir();
  await assert.rejects(helper().appendSyntheticActivity(forged, 201, Date.now()), /native-test-isolation:invalid-plan/);
  await fs.unlink(files[1]);
  await fs.symlink(files[0], files[1]);
  await assert.rejects(helper().appendSyntheticActivity(plan, 201, Date.now()), /native-soak:nonregular-target/);
  // Both exact targets are verified before either write begins.
  assert.equal(await fs.readFile(files[0], 'utf8'), before);
});
