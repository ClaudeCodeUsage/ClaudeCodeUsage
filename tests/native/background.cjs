'use strict';

// Test-only actual background-window resource observation. Never calls the
// production focus handler, reveals panels, or suppresses native focus events.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const kinds = ['timer', 'watcher', 'worker', 'network', 'backfill'];
const count = n => Number.isSafeInteger(n) && n >= 0;
const failures = new WeakMap();
function fail(reason) {
  const error = new Error('native-background:' + reason);
  failures.set(error, reason);
  throw error;
}
function assertBackgroundIdle(nativeFocused, logicalFocused, sample) {
  if (typeof nativeFocused !== 'boolean' || typeof logicalFocused !== 'boolean' ||
    nativeFocused !== logicalFocused) fail('focus');
  if (nativeFocused) return false;
  if (sample.ownedActive !== 0 || kinds.some(k => sample.ownedByKind[k] !== 0)) fail('not-idle');
  return true;
}
function assertBackgroundComplete(report) {
  if (!count(report.elapsedMs) || !count(report.requestedMs) || report.requestedMs < 100 ||
    report.elapsedMs < report.requestedMs || !count(report.idleSamples) || report.idleSamples < 20 ||
    report.stopCompleted !== true) fail('incomplete');
  const { assertZeroBodyWarmRefreshes } = require(path.basename(__filename) === 'native-background.cjs'
    ? './native-runner.cjs' : './runner.cjs');
  for (const mode of ['on', 'off']) assertZeroBodyWarmRefreshes(report.warmIo[mode], 20);
}
async function run(plan, rawOptions) {
  const vscode = require('vscode');
  const staged = path.basename(__filename) === 'native-background.cjs';
  const { validateSoakOptions, bounded, sampleOwnedResources, assertResourceBudget, appendBoundedSample } =
    require(staged ? './native-soak.cjs' : './soak.cjs');
  const { settle, createRefreshIoProbe } = require(staged ? './native-runner.cjs' : './runner.cjs');
  const { nativeLaunchArguments } = require(staged ? './native-isolation.cjs' : './isolation.cjs');
  const options = validateSoakOptions(rawOptions);
  nativeLaunchArguments(plan);
  const manifest = JSON.parse(await fs.readFile(path.join(plan.root, 'native-stage-manifest.json'), 'utf8'));
  const started = performance.now(), samples = [], warmIo = {};
  let api, outputAppend, observer, stage = 'activation', failureStage = null, failureReason = null;
  let stopCompleted = false, idleSamples = 0, nativeWindowTransitions = 0, completedMs = 0;
  const elapsed = () => Math.floor(performance.now() - started);
  const deadline = () => { if (elapsed() > options.durationMs + 180000) fail('deadline'); };
  const mark = async next => {
    stage = next;
    await fs.writeFile(path.join(plan.root, 'native-background-progress.json'),
      JSON.stringify({ stage, elapsedMs: elapsed(), idleSamples, nativeWindowTransitions }) + '\n');
  };
  const sample = () => {
    deadline();
    const instance = api.instance, view = instance.webviewProvider;
    const value = sampleOwnedResources(process.memoryUsage(), instance.resourceOwnership.snapshotForTests(),
      elapsed(), instance.getConfiguration().enableAchievements, !!view.panel,
      view.dataPanelCache.size, view.pendingAchievementNotice.size);
    assertResourceBudget(value);
    const nativeFocused = vscode.window.state.focused, logicalFocused = instance.windowActivity.focused;
    if (assertBackgroundIdle(nativeFocused, logicalFocused, value)) idleSamples++;
    appendBoundedSample(samples, { ...value, nativeFocused, logicalFocused });
  };
  try {
    await mark('activation');
    const extension = vscode.extensions.getExtension('GrowthJack.claude-code-usage');
    assert.ok(extension);
    api = await bounded(extension.activate());
    assert.equal(api.plan.root, plan.root);
    assert.ok(Object.values(api.isolation).every(v => v === true));
    const instance = api.instance;
    assert.equal(instance.getConfiguration().usageLimitTracking, false);
    assert.equal(instance.settings.get('advice.apiKey'), '');
    observer = vscode.window.onDidChangeWindowState(state => {
      if (typeof state.focused === 'boolean') nativeWindowTransitions++;
    });
    await mark('cold-refresh');
    await bounded(instance.refreshData(false, 'manual')); await bounded(settle(instance), 65000);
    await mark('enable-watch-settings');
    await instance.settings.set('fileWatchSeconds', '1');
    await instance.settings.set('codex.fileWatchSeconds', '10');
    instance.onSettingsChangedFromPanel('fileWatchSeconds');
    await bounded(settle(instance), 65000);
    for (const enabled of [false, true]) {
      const mode = enabled ? 'on' : 'off';
      await mark('warm-' + mode);
      const provider = instance.codexProvider;
      await instance.settings.set('enableAchievements', enabled);
      instance.onSettingsChangedFromPanel('enableAchievements');
      assert.equal(instance.codexProvider, provider);
      const probe = createRefreshIoProbe();
      outputAppend = instance.outputChannel.appendLine;
      instance.outputChannel.appendLine = line => {
        probe.observe(line); outputAppend.call(instance.outputChannel, line);
      };
      for (let i = 0; i < 20; i++) {
        deadline();
        await bounded(instance.refreshData(false, 'manual')); await bounded(settle(instance), 65000);
      }
      instance.outputChannel.appendLine = outputAppend; outputAppend = undefined;
      warmIo[mode] = probe.snapshot();
    }
    await mark('actual-background-resources');
    const monitorStarted = performance.now();
    while (performance.now() - monitorStarted < options.durationMs) {
      await bounded(settle(instance), 65000); sample();
      await new Promise(resolve => setTimeout(resolve,
        Math.max(1, Math.min(2000, options.durationMs - (performance.now() - monitorStarted)))));
    }
    completedMs = Math.floor(performance.now() - monitorStarted);
    sample();
  } catch (error) {
    failureStage = stage;
    failureReason = error && typeof error === 'object' ? failures.get(error) ?? 'assertion-or-stage-failure'
      : 'assertion-or-stage-failure';
  } finally {
    observer?.dispose();
    if (api) {
      if (outputAppend) api.instance.outputChannel.appendLine = outputAppend;
      try {
        await bounded(api.stop());
        assert.equal(api.instance.resourceOwnership.snapshotForTests().activeCount, 0);
        assert.equal(api.instance.webviewProvider.panel, undefined);
        stopCompleted = true;
      } catch { failureStage ??= 'dispose'; failureReason ??= 'stop-failure'; }
    }
    if (!failureStage) {
      try { assertBackgroundComplete({ elapsedMs: completedMs, requestedMs: options.durationMs,
        idleSamples, stopCompleted, warmIo }); }
      catch { failureStage = 'acceptance'; failureReason = 'incomplete'; }
    }
    const report = { kind: 'actual-native-background-resource-observation-not-final-vsix',
      sourceHead: manifest.sourceHead, vscodeVersion: vscode.version, platform: process.platform,
      outcome: failureStage ? 'fail' : 'pass', failureStage, failureReason,
      elapsedMs: elapsed(), completedMs, requestedMs: options.durationMs, idleSamples,
      nativeWindowTransitions, samples, warmIo, stopCompleted,
      simulatedFocusUsed: false, nativeEventsSuppressed: false, panelsOpened: 0,
      longSoakDurationPassed: false, nativeOsFocusAcceptancePassed: false,
      noticeDeliveryOrAckTested: false, sameProfileConcurrentWriteTested: false,
      finalInstallF5Passed: false, heapLeakConclusionEstablished: false };
    await fs.writeFile(path.join(plan.root, 'native-background-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (failureStage) fail('failed-' + failureStage);
}
module.exports = { run, assertBackgroundIdle, assertBackgroundComplete };
