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
const fail = reason => { throw new Error('native-soak:' + reason); };
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
      timer = setTimeout(() => reject(new Error('native-soak:operation-timeout')), milliseconds);
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
  const { settle, disposePanelAndWait, assertNativePanelCachesCleared,
    createRefreshIoProbe, assertZeroBodyWarmRefreshes } = require('./native-runner.cjs');
  const manifest = JSON.parse(await fs.readFile(path.join(plan.root, 'native-stage-manifest.json'), 'utf8'));
  const started = performance.now(), samples = [], assertions = [];
  const warm = { on: createRefreshIoProbe(), off: createRefreshIoProbe() };
  const counters = { cycles: 0, onCycles: 0, offCycles: 0, panelDisposals: 0, settingsToggles: 0,
    syntheticFocusTransitions: 0, appendBytes: 0, claudeWatchRefreshes: 0, codexWatchRefreshes: 0 };
  let api, append, warmMode, timer, failureStage, failureReason, stage = 'activation', stopCompleted = false;
  let soakStarted, completedSoakMs = 0, watchdogFailure = false;
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
  const waitUntil = async (predicate, milliseconds) => {
    const deadline = performance.now() + milliseconds;
    while (!predicate()) {
      if (watchdogFailure) fail('resource-budget');
      if (performance.now() >= deadline) fail('wait-timeout');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const focus = async focused => {
    api.instance.handleWindowFocusChange(focused);
    counters.syntheticFocusTransitions++;
    await bounded(settle(api.instance), 65000);
    if (focused) {
      // Wait for the real handler's async setup, never call setup a second
      // time while the same watcher is already attached.
      await waitUntil(() => api.instance.resourceOwnership.snapshotForTests().byKind.watcher === 2, 5000);
      await bounded(settle(api.instance), 65000);
    }
  };
  try {
    const extension = vscode.extensions.getExtension('GrowthJack.claude-code-usage');
    assert.ok(extension);
    api = await bounded(extension.activate());
    assert.equal(api.plan.root, plan.root);
    assert.ok(Object.values(api.isolation).every(v => v === true));
    assert.equal(api.instance.getConfiguration().usageLimitTracking, false);
    assert.equal(api.instance.settings.get('advice.apiKey'), '');
    assertions.push('actual guarded Test-mode host, own synthetic data, no quota/BYOK');
    stage = 'cold-refresh';
    await bounded(api.instance.refreshData(false, 'manual')); await bounded(settle(api.instance), 65000);
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
    stage = 'recurring-setup';
    await instance.settings.set('fileWatchSeconds', '1');
    await instance.settings.set('codex.fileWatchSeconds', '10');
    instance.onSettingsChangedFromPanel('fileWatchSeconds');
    await bounded(settle(instance), 65000); await focus(true);
    assert.equal(instance.getConfiguration().fileWatchSeconds, 1);
    assert.equal(instance.getConfiguration().codexFileWatchSeconds, 10);
    assert.equal(instance.resourceOwnership.snapshotForTests().byKind.watcher, 2);
    sample();
    timer = setInterval(() => {
      try {
        if (elapsed() > options.durationMs + 240000) fail('operation-timeout');
        sample();
      } catch { watchdogFailure = true; }
    }, limits.sampleEveryMs);
    soakStarted = performance.now();
    while (performance.now() - soakStarted < options.durationMs || counters.cycles < 2) {
      if (watchdogFailure) fail('resource-budget');
      stage = 'feature-toggle';
      const enabled = counters.cycles % 2 === 1, provider = instance.codexProvider;
      await instance.settings.set('enableAchievements', enabled);
      instance.onSettingsChangedFromPanel('enableAchievements');
      await bounded(settle(instance), 65000);
      assert.equal(instance.getConfiguration().enableAchievements, enabled);
      assert.equal(instance.codexProvider, provider);
      counters.settingsToggles++;
      if (enabled) counters.onCycles++; else counters.offCycles++;
      await focus(true);
      view.show('achievements');
      assert.ok(view.panel);
      const recordsBefore = instance.cache.records.length;
      const processedBefore = instance.codexView.allTime.total.processed;
      const claudeWatchBefore = counters.claudeWatchRefreshes, codexWatchBefore = counters.codexWatchRefreshes;
      stage = 'watch-append';
      const result = await appendSyntheticActivity(plan, 201 + counters.cycles, Date.now());
      counters.appendBytes += result.bytes;
      await waitUntil(() => counters.claudeWatchRefreshes > claudeWatchBefore &&
        counters.codexWatchRefreshes > codexWatchBefore, 30000);
      await bounded(settle(instance), 65000);
      assert.equal(instance.cache.records.length, recordsBefore + 1);
      assert.equal(instance.codexView.allTime.total.processed, processedBefore + 1100);
      stage = 'warm-refresh';
      warmMode = enabled ? 'on' : 'off';
      for (let i = 0; i < 20; i++) {
        await bounded(instance.refreshData(false, 'manual')); await bounded(settle(instance), 65000);
      }
      warmMode = undefined;
      assertZeroBodyWarmRefreshes(warm[enabled ? 'on' : 'off'].snapshot(), 20);
      stage = 'panel-disposal';
      await disposePanelAndWait(view); assertNativePanelCachesCleared(view);
      counters.panelDisposals++;
      stage = 'focus-suspend';
      await focus(false);
      const suspended = sample();
      assert.equal(suspended.ownedByKind.watcher, 0);
      assert.equal(suspended.ownedByKind.timer, 0);
      assert.equal(suspended.ownedByKind.worker, 0);
      counters.cycles++;
      await checkpoint();
      stage = 'duration-wait';
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
  } catch {
    failureStage = stage;
    failureReason = watchdogFailure ? 'resource-budget' : 'assertion-or-stage-failure';
    console.error('CCU native resource diagnostic failed at ' + stage);
  } finally {
    if (timer) clearInterval(timer);
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
      failureReason: failureReason ?? null, assertions, counters, samples,
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
  assertResourceBudget, appendBoundedSample, appendSyntheticActivity, bounded };
