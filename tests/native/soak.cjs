'use strict';

// Opt-in native resource diagnostic. All activity is synthetic and writes only
// two exact fresh-root fixture files. Simulated focus invokes the production
// handler without bringing the app forward; it is not an OS-focus/notice test.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { nativeLaunchArguments } = require(path.basename(__filename) === 'native-soak.cjs'
  ? './native-isolation.cjs' : './isolation.cjs');
const failureReasons = new WeakMap();
const allowedFailureReasons = new Set(['invalid-options', 'invalid-activity', 'nonregular-target', 'activity-budget',
  'invalid-sample', 'resource-budget', 'sample-budget', 'operation-timeout', 'wait-timeout',
  'setup-claude-watch-setting', 'setup-codex-watch-setting', 'setup-watchers']);
function failureError(reason) {
  const error = new Error('native-soak:' + reason);
  if (allowedFailureReasons.has(reason)) failureReasons.set(error, reason);
  return error;
}
const fail = reason => { throw failureError(reason); };
function diagnosticFailureReason(error) {
  // Identity-only provenance: never inspect an arbitrary exception's code,
  // name, message, stack, getters or proxy properties to classify the report.
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? failureReasons.get(error) ?? 'assertion-or-stage-failure' : 'assertion-or-stage-failure';
}
const kinds = ['timer', 'watcher', 'worker', 'network', 'backfill'];
const finiteCount = value => Number.isSafeInteger(value) && value >= 0;
const limits = Object.freeze({ hostRssBytes: 2 * 1024 ** 3, hostHeapBytes: 512 * 1024 ** 2,
  hostExternalBytes: 256 * 1024 ** 2, sampleCount: 1024, timer: 8, watcher: 2,
  worker: 1, network: 0, backfill: 1, panelCacheEntries: 24, pendingNoticeEntries: 2,
  sampleEveryMs: 5000, cycleEveryMs: 60000, minimumLongMs: 1800000 });
async function bounded(work, milliseconds = 60000) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(failureError('operation-timeout')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
function validateSoakOptions(value) {
  if (!value || Object.keys(value).join('|') !== 'durationMs' ||
    !Number.isSafeInteger(value.durationMs) || value.durationMs < 100 || value.durationMs > 3600000) fail('invalid-options');
  return Object.freeze({ durationMs: value.durationMs });
}
function longSoakDurationPassed(elapsedMs) {
  return Number.isFinite(elapsedMs) && elapsedMs >= limits.minimumLongMs;
}
function failureFocusObservation(logicalFocused, nativeFocused, watcherCount) {
  if (typeof logicalFocused !== 'boolean' || typeof nativeFocused !== 'boolean' ||
    !finiteCount(watcherCount)) return null;
  return { logicalFocused, nativeFocused, watcherCount };
}
function assertRecurringReady(configuration, resources) {
  if (configuration.fileWatchSeconds !== 1) fail('setup-claude-watch-setting');
  if (configuration.codexFileWatchSeconds !== 10) fail('setup-codex-watch-setting');
  if (resources.byKind.watcher !== 2) fail('setup-watchers');
}
function createReadbackStability() {
  const requiredStableMs = 500;
  let previous = -1, since = null, samples = 0, mismatches = 0, convergenceMs = null;
  return Object.freeze({
    observe(elapsedMs, expected) {
      if (!finiteCount(elapsedMs) || elapsedMs < previous || typeof expected !== 'boolean') fail('invalid-sample');
      if (samples >= 256) fail('sample-budget');
      previous = elapsedMs; samples++;
      if (!expected) { since = null; convergenceMs = null; mismatches++; return false; }
      if (since === null) since = elapsedMs;
      if (elapsedMs - since < requiredStableMs) return false;
      convergenceMs = elapsedMs;
      return true;
    },
    snapshot() { return { requiredStableMs, samples, mismatches, convergenceMs }; },
  });
}
const setupReadbackPhases = new Set(['after-cold-settle', 'after-claude-set', 'after-codex-set',
  'after-readback-convergence', 'after-handler', 'after-settle', 'after-focus', 'on-failure']);
const setupReadbackBound = 32;
function projectSetupReadback(phase, mementoClaude, mementoCodex, settingsClaude, settingsCodex,
  configurationClaude, configurationCodex, counts) {
  if (!setupReadbackPhases.has(phase)) return null;
  const updates = {};
  for (const kind of ['claude', 'codex', 'other']) {
    const started = counts?.[kind]?.started, completed = counts?.[kind]?.completed;
    if (!finiteCount(started) || !finiteCount(completed) || completed > started ||
      started > setupReadbackBound) return null;
    updates[kind] = { started, completed };
  }
  // Never stringify, coerce or inspect a value. Unknown objects/proxies and
  // secrets can contribute only a typeof enum and strict expected equality.
  const readback = (value, expected) => ({ expectedEqual: value === expected, type: typeof value });
  return { phase,
    memento: { claude: readback(mementoClaude, '1'), codex: readback(mementoCodex, '10') },
    settings: { claude: readback(settingsClaude, '1'), codex: readback(settingsCodex, '10') },
    configuration: { claude: readback(configurationClaude, 1), codex: readback(configurationCodex, 10) },
    updates };
}
function createSetupReadbackProbe(globalState) {
  const original = globalState.update;
  const descriptor = Object.getOwnPropertyDescriptor(globalState, 'update');
  const counts = { claude: { started: 0, completed: 0 }, codex: { started: 0, completed: 0 },
    other: { started: 0, completed: 0 } };
  const increment = (kind, field) => {
    counts[kind][field] = Math.min(setupReadbackBound, counts[kind][field] + 1);
  };
  globalState.update = function (...args) {
    const kind = args[0] === 'ccu.setting.fileWatchSeconds' ? 'claude'
      : args[0] === 'ccu.setting.codex.fileWatchSeconds' ? 'codex' : 'other';
    increment(kind, 'started');
    const result = original.apply(globalState, args);
    // Observe completion without replacing the original result/rejection or
    // retaining keys, values, IDs or exceptions in diagnostic state.
    void Promise.resolve(result).then(() => increment(kind, 'completed'), () => undefined);
    return result;
  };
  let restored = false;
  return Object.freeze({
    capture(rows, phase, settings, configuration) {
      if (rows.length >= setupReadbackBound || !setupReadbackPhases.has(phase)) return false;
      const row = projectSetupReadback(phase,
        globalState.get('ccu.setting.fileWatchSeconds'), globalState.get('ccu.setting.codex.fileWatchSeconds'),
        settings.get('fileWatchSeconds'), settings.get('codex.fileWatchSeconds'),
        configuration.fileWatchSeconds, configuration.codexFileWatchSeconds, counts);
      if (!row) return false;
      rows.push(row);
      return true;
    },
    restore() {
      if (restored) return;
      if (descriptor) Object.defineProperty(globalState, 'update', descriptor);
      else delete globalState.update;
      restored = true;
    },
  });
}
function sampleOwnedResources(memory, resources, elapsedMs, achievementsEnabled, panelOpen, panelCacheEntries, pendingNoticeEntries) {
  if (![memory.rss, memory.heapUsed, memory.external, memory.arrayBuffers, resources.activeCount,
    elapsedMs, panelCacheEntries, pendingNoticeEntries, ...kinds.map(k => resources.byKind[k])].every(finiteCount) ||
    typeof achievementsEnabled !== 'boolean' || typeof panelOpen !== 'boolean') fail('invalid-sample');
  return { elapsedMs, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external, arrayBufferBytes: memory.arrayBuffers, ownedActive: resources.activeCount,
    ownedByKind: Object.fromEntries(kinds.map(k => [k, resources.byKind[k]])),
    achievementsEnabled, panelOpen, panelCacheEntries, pendingNoticeEntries };
}
function assertResourceBudget(sample) {
  if (sample.rssBytes >= limits.hostRssBytes || sample.heapUsedBytes >= limits.hostHeapBytes ||
    sample.externalBytes >= limits.hostExternalBytes || kinds.some(k => sample.ownedByKind[k] > limits[k]) ||
    sample.ownedActive !== kinds.reduce((sum, k) => sum + sample.ownedByKind[k], 0) ||
    sample.panelCacheEntries > limits.panelCacheEntries || sample.pendingNoticeEntries > limits.pendingNoticeEntries) fail('resource-budget');
}
function appendBoundedSample(samples, sample) {
  if (samples.length >= limits.sampleCount) fail('sample-budget');
  samples.push(sample);
}
async function appendSyntheticActivity(plan, sequence, timestamp) {
  nativeLaunchArguments(plan); // Exact validated source plan, no arbitrary target.
  if (!Number.isSafeInteger(sequence) || sequence <= 200 || sequence >= 300 ||
    !Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime())) fail('invalid-activity');
  const p = plan.directories, targets = [
    path.join(p.claudeHome, 'projects/synthetic-native/synthetic-native-0.jsonl'),
    path.join(p.codexHome, 'sessions/rollout-0.jsonl'),
  ];
  const date = new Date(timestamp).toISOString(), id = 'synthetic-native-0';
  const rows = [
    { type: 'assistant', timestamp: date, cwd: p.workspace, sessionId: id,
      requestId: id + '-request-' + sequence, message: { id: id + '-message-' + sequence, role: 'assistant',
        model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Synthetic native output.' }],
        usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 500 } } },
    { type: 'event_msg', timestamp: date, payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: sequence * 1000, cached_input_tokens: sequence * 500,
        output_tokens: sequence * 100, reasoning_output_tokens: sequence * 25, total_tokens: sequence * 1100 } } } },
  ];
  const handles = [];
  let bytes = 0;
  try {
    // Verify/open both targets before writing either, reject every path symlink.
    for (const target of targets) {
      if (await fs.realpath(target) !== target || !(await fs.lstat(target)).isFile()) fail('nonregular-target');
      const handle = await fs.open(target, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
      handles.push(handle);
      if (!(await handle.stat()).isFile()) fail('nonregular-target');
    }
    for (let i = 0; i < handles.length; i++) {
      const body = Buffer.from(JSON.stringify(rows[i]) + '\n');
      if (body.length > 2048) fail('activity-budget');
      bytes += body.length;
      await handles[i].writeFile(body);
    }
    return { files: 2, bytes };
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}
async function run(plan, rawOptions) {
  const options = validateSoakOptions(rawOptions), vscode = require('vscode');
  nativeLaunchArguments(plan);
  const { settle, disposePanelAndWait, assertNativePanelCachesCleared,
    createRefreshIoProbe, assertZeroBodyWarmRefreshes } = require(path.basename(__filename) === 'native-soak.cjs'
      ? './native-runner.cjs' : './runner.cjs');
  const manifest = JSON.parse(await fs.readFile(path.join(plan.root, 'native-stage-manifest.json'), 'utf8'));
  const started = performance.now(), samples = [], assertions = [], setupReadbacks = [];
  const warm = { on: createRefreshIoProbe(), off: createRefreshIoProbe() };
  const counters = { cycles: 0, onCycles: 0, offCycles: 0, panelDisposals: 0, settingsToggles: 0,
    syntheticFocusTransitions: 0, nativeWindowTransitions: 0,
    appendBytes: 0, claudeWatchRefreshes: 0, codexWatchRefreshes: 0 };
  let api, append, warmMode, timer, focusObserver, setupReadbackProbe, setupStability, failureStage, failureReason,
    failureFocus = null, stage = 'activation', stopCompleted = false;
  let soakStarted, completedSoakMs = 0, watchdogFailure = null;
  const elapsed = () => Math.floor(performance.now() - started);
  const sample = () => {
    const instance = api.instance, view = instance.webviewProvider;
    const value = sampleOwnedResources(process.memoryUsage(), instance.resourceOwnership.snapshotForTests(),
      elapsed(), instance.getConfiguration().enableAchievements, !!view.panel,
      view.dataPanelCache.size, view.pendingAchievementNotice.size);
    assertResourceBudget(value); appendBoundedSample(samples, value);
    return value;
  };
  const checkpoint = async () => {
    const value = sample();
    await fs.writeFile(path.join(plan.root, 'native-soak-progress.json'),
      JSON.stringify({ elapsedMs: elapsed(), stage, counters, sample: value }) + '\n');
  };
  // Write a bounded phase marker before asynchronous work. An interrupted
  // host without a final report is incomplete, never a successful soak.
  const markStage = async next => {
    stage = next;
    await fs.writeFile(path.join(plan.root, 'native-soak-progress.json'),
      JSON.stringify({ elapsedMs: elapsed(), stage, counters }) + '\n');
  };
  const waitUntil = async (predicate, milliseconds, pollMs = 100) => {
    const deadline = performance.now() + milliseconds;
    while (!predicate()) {
      if (watchdogFailure) fail(watchdogFailure);
      if (performance.now() >= deadline) fail('wait-timeout');
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  };
  const focus = async (focused, setupDeadline) => {
    api.instance.handleWindowFocusChange(focused);
    counters.syntheticFocusTransitions++;
    await bounded(settle(api.instance), 65000);
    if (focused) {
      // Wait for the real handler's async setup, never call setup a second
      // time while the same watcher is already attached.
      const remaining = setupDeadline === undefined ? 5000 : setupDeadline - performance.now();
      if (remaining <= 0) fail('wait-timeout');
      await waitUntil(() => api.instance.resourceOwnership.snapshotForTests().byKind.watcher === 2, remaining);
      await bounded(settle(api.instance), 65000);
    }
  };
  try {
    await markStage('activation');
    const extension = vscode.extensions.getExtension('GrowthJack.claude-code-usage');
    assert.ok(extension);
    api = await bounded(extension.activate());
    // Observe only this Test host's real window events. Do not suppress them
    // to make simultaneous background windows pass simulated-focus assertions.
    focusObserver = vscode.window.onDidChangeWindowState(state => {
      if (typeof state.focused === 'boolean') counters.nativeWindowTransitions++;
    });
    assert.equal(api.plan.root, plan.root);
    assert.ok(Object.values(api.isolation).every(v => v === true));
    assert.equal(api.instance.getConfiguration().usageLimitTracking, false);
    assert.equal(api.instance.settings.get('advice.apiKey'), '');
    assertions.push('actual guarded Test-mode host, own synthetic data, no quota/BYOK');
    // Only the already guarded Test host's captured production context may be
    // wrapped. No subscription to private storage notifications is installed.
    assert.equal(api.context.extensionMode, vscode.ExtensionMode.Test);
    assert.equal(api.context.extensionPath, plan.directories.developmentExtension);
    assert.equal(api.instance.context, api.context);
    setupReadbackProbe = createSetupReadbackProbe(api.context.globalState);
    const setupReadback = phase => setupReadbackProbe.capture(setupReadbacks, phase,
      api.instance.settings, api.instance.getConfiguration());
    await markStage('cold-refresh');
    await bounded(api.instance.refreshData(false, 'manual')); await bounded(settle(api.instance), 65000);
    setupReadback('after-cold-settle');
    assert.equal(api.instance.cache.dataDirectory, plan.directories.claudeHome);
    assert.equal(api.instance.codexSnapshotHome, plan.directories.codexHome);
    assert.equal(api.instance.codexHasData, true);
    const instance = api.instance, view = instance.webviewProvider;
    append = instance.outputChannel.appendLine;
    instance.outputChannel.appendLine = line => {
      if (typeof line === 'string' && line.length <= 4096) {
        if (/^refresh: trigger=watch /.test(line)) counters.claudeWatchRefreshes++;
        if (/^codex-index trigger=watch /.test(line)) counters.codexWatchRefreshes++;
        if (warmMode) warm[warmMode].observe(line);
      }
      append.call(instance.outputChannel, line);
    };
    await markStage('recurring-setup');
    // SDK notifications can temporarily regress public readbacks after an
    // awaited write. Observe convergence, never overwrite/retry settings. This
    // consumes the existing five-second readiness budget, not a new deadline.
    const setupDeadline = performance.now() + 5000;
    await instance.settings.set('fileWatchSeconds', '1');
    setupReadback('after-claude-set');
    await instance.settings.set('codex.fileWatchSeconds', '10');
    setupReadback('after-codex-set');
    const stabilityStarted = performance.now();
    setupStability = createReadbackStability();
    await waitUntil(() => {
      const state = api.context.globalState, config = instance.getConfiguration();
      const expected = state.get('ccu.setting.fileWatchSeconds') === '1' &&
        state.get('ccu.setting.codex.fileWatchSeconds') === '10' &&
        instance.settings.get('fileWatchSeconds') === '1' && instance.settings.get('codex.fileWatchSeconds') === '10' &&
        config.fileWatchSeconds === 1 && config.codexFileWatchSeconds === 10;
      return setupStability.observe(Math.floor(performance.now() - stabilityStarted), expected);
    }, Math.max(0, setupDeadline - performance.now()), 25);
    setupReadback('after-readback-convergence');
    instance.onSettingsChangedFromPanel('fileWatchSeconds');
    setupReadback('after-handler');
    await bounded(settle(instance), 65000);
    setupReadback('after-settle');
    await focus(true, setupDeadline);
    setupReadback('after-focus');
    assertRecurringReady(instance.getConfiguration(), instance.resourceOwnership.snapshotForTests());
    sample();
    timer = setInterval(() => {
      try {
        if (elapsed() > options.durationMs + 240000) fail('operation-timeout');
        sample();
      } catch (error) { watchdogFailure = diagnosticFailureReason(error); }
    }, limits.sampleEveryMs);
    soakStarted = performance.now();
    while (performance.now() - soakStarted < options.durationMs || counters.cycles < 2) {
      if (watchdogFailure) fail(watchdogFailure);
      await markStage('feature-toggle');
      const enabled = counters.cycles % 2 === 1, provider = instance.codexProvider;
      await instance.settings.set('enableAchievements', enabled);
      instance.onSettingsChangedFromPanel('enableAchievements');
      await bounded(settle(instance), 65000);
      assert.equal(instance.getConfiguration().enableAchievements, enabled);
      assert.equal(instance.codexProvider, provider);
      counters.settingsToggles++;
      if (enabled) counters.onCycles++; else counters.offCycles++;
      await focus(true);
      const recordsBefore = instance.cache.records.length;
      const processedBefore = instance.codexView.allTime.total.processed;
      const claudeWatchBefore = counters.claudeWatchRefreshes, codexWatchBefore = counters.codexWatchRefreshes;
      await markStage('watch-append');
      const result = await appendSyntheticActivity(plan, 201 + counters.cycles, Date.now());
      counters.appendBytes += result.bytes;
      await waitUntil(() => counters.claudeWatchRefreshes > claudeWatchBefore &&
        counters.codexWatchRefreshes > codexWatchBefore, 30000);
      await bounded(settle(instance), 65000);
      assert.equal(instance.cache.records.length, recordsBefore + 1);
      assert.equal(instance.codexView.allTime.total.processed, processedBefore + 1100);
      // Panel creation can cause real window-state transitions. Complete the
      // critical watched append first; retain an actual open panel for warm
      // refreshes and disposal, without suppressing any native event.
      view.show('achievements');
      assert.ok(view.panel);
      await markStage('warm-refresh');
      warmMode = enabled ? 'on' : 'off';
      for (let i = 0; i < 20; i++) {
        await bounded(instance.refreshData(false, 'manual')); await bounded(settle(instance), 65000);
      }
      warmMode = undefined;
      assertZeroBodyWarmRefreshes(warm[enabled ? 'on' : 'off'].snapshot(), 20);
      await markStage('panel-disposal');
      await disposePanelAndWait(view); assertNativePanelCachesCleared(view);
      counters.panelDisposals++;
      await markStage('focus-suspend');
      await focus(false);
      const suspended = sample();
      assert.equal(suspended.ownedByKind.watcher, 0);
      assert.equal(suspended.ownedByKind.timer, 0);
      assert.equal(suspended.ownedByKind.worker, 0);
      counters.cycles++;
      await checkpoint();
      await markStage('duration-wait');
      // Use short nonblocking waits and the monotonic clock. No clock scaling.
      const nextCycle = soakStarted + counters.cycles * limits.cycleEveryMs;
      await waitUntil(() => performance.now() >= Math.min(nextCycle, soakStarted + options.durationMs), 65000);
    }
    completedSoakMs = Math.floor(performance.now() - soakStarted);
    assertZeroBodyWarmRefreshes(warm.on.snapshot(), 20);
    assertZeroBodyWarmRefreshes(warm.off.snapshot(), 20);
    assertions.push('actual fs.watch refreshes on both providers account for each exact synthetic append',
      'twenty known-zero manual warm refreshes per cycle with whole achievements ON and OFF',
      'actual panel disposal and production focus-handler suspension release panel caches/watchers/timers',
      'achievement presentation toggles do not replace the provider and do not stop basic usage');
  } catch (error) {
    failureStage = stage;
    failureReason = watchdogFailure ?? diagnosticFailureReason(error);
    try {
      if (api && setupReadbackProbe) setupReadbackProbe.capture(setupReadbacks, 'on-failure',
        api.instance.settings, api.instance.getConfiguration());
    } catch { /* Preserve the original fixed failure if readback is unavailable. */ }
    try {
      failureFocus = failureFocusObservation(api?.instance?.windowActivity?.focused,
        vscode.window?.state?.focused, api?.instance?.resourceOwnership.snapshotForTests().byKind.watcher);
    } catch { failureFocus = null; }
    console.error('CCU native resource diagnostic failed at ' + stage);
  } finally {
    if (timer) clearInterval(timer);
    focusObserver?.dispose();
    setupReadbackProbe?.restore();
    if (api) {
      if (append) api.instance.outputChannel.appendLine = append;
      try {
        await bounded(api.stop());
        assert.equal(api.instance.resourceOwnership.snapshotForTests().activeCount, 0);
        assert.equal(api.instance.webviewProvider.panel, undefined);
        stopCompleted = true;
      } catch { failureStage ??= 'dispose'; failureReason ??= 'stop-failure'; }
    }
    const report = { kind: 'actual-native-resource-diagnostic-synthetic-focus-not-final-vsix',
      sourceHead: manifest.sourceHead, vscodeVersion: vscode.version, platform: process.platform,
      outcome: failureStage ? 'fail' : 'pass', failureStage: failureStage ?? null,
      failureReason: failureReason ?? null, failureFocus, assertions, counters, samples, setupReadbacks,
      setupReadbackStability: setupStability?.snapshot() ?? null,
      warmIo: { on: warm.on.snapshot(), off: warm.off.snapshot() }, stopCompleted,
      elapsedMs: elapsed(), completedSoakMs, requestedSoakMs: options.durationMs,
      longSoakDurationPassed: !failureStage && longSoakDurationPassed(completedSoakMs),
      limits, noticeDeliveryTested: false, nativeOsFocusTested: false,
      workerHeapOrMessageBudgetTested: false, heapLeakConclusionEstablished: false,
      pixelVisualAcceptancePassed: false, finalInstallF5Passed: false };
    await fs.writeFile(path.join(plan.root, 'native-soak-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (failureStage) fail('failed-' + failureStage);
}
module.exports = { run, validateSoakOptions, longSoakDurationPassed, sampleOwnedResources,
  assertResourceBudget, appendBoundedSample, appendSyntheticActivity, bounded, failureFocusObservation,
  assertRecurringReady, diagnosticFailureReason, projectSetupReadback, createSetupReadbackProbe, createReadbackStability };
