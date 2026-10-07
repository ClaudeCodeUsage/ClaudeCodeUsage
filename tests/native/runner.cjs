'use strict';

// Real installed Code Extension Development/Test Host diagnostic. No mocks,
// credentials, ordinary profiles or final-VSIX/visual/F5 claims. The small
// staging wrapper captures only this host's real production instance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(work, milliseconds, reason) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('native-test-runner:' + reason)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
async function settle(instance) {
  await bounded(instance.initializationWrites, 60_000, 'initialization-timeout');
  const deadline = Date.now() + 60_000;
  while (instance.refreshGate.active || instance.activeCodexRefreshes.size ||
      instance.codexCheckpointHydration || instance.pendingResourceStops.size) {
    if (Date.now() >= deadline) throw new Error('native-test-runner:settle-timeout');
    await delay(25);
  }
  if (instance.initializationWriteFailure) throw new Error('native-test-runner:initialization-write');
  await bounded(instance.codexBackgroundStateWrite, 60_000, 'background-write-timeout');
}
async function run() {
  const plan = JSON.parse(await fs.readFile(path.join(__dirname, 'native-plan.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(plan.root, 'native-stage-manifest.json'), 'utf8'));
  const samples = [], assertions = [], started = Date.now();
  let api, stage = 'activation', failureStage, stopCompleted = false;
  const sample = phase => {
    const owned = api.instance.resourceOwnership.snapshotForTests(), memory = process.memoryUsage();
    samples.push({ phase, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, externalBytes: memory.external,
      arrayBufferBytes: memory.arrayBuffers, ownedActive: owned.activeCount, ownedByKind: owned.byKind,
      panelOpen: !!api.instance.webviewProvider.panel,
      clientReadyObserved: api.instance.webviewProvider.webviewClientReady === true });
    assert.ok(memory.rss < 2 * 1024 ** 3, 'native sampled host RSS budget');
    assert.equal(owned.byKind.network, 0, 'no extension-owned quota or advice network');
    assert.equal(owned.byKind.watcher, 0, 'watchers disabled in this small native diagnostic');
  };
  try {
    const extension = vscode.extensions.getExtension('GrowthJack.claude-code-usage');
    assert.ok(extension, 'isolated development extension found');
    api = await bounded(extension.activate(), 60_000, 'activation-timeout');
    assert.equal(api.plan.root, plan.root);
    assert.ok(Object.values(api.isolation).every(value => value === true));
    assert.equal(api.instance.getConfiguration().usageLimitTracking, false);
    assert.equal(api.instance.settings.get('advice.apiKey'), '');
    assertions.push('real Test-mode context and synthetic sources guarded before activation');
    stage = 'cold-refresh';
    await api.instance.refreshData(false, 'manual');
    await settle(api.instance);
    assert.equal(api.instance.cache.dataDirectory, plan.directories.claudeHome);
    assert.ok(api.instance.cache.manifest);
    assert.equal(api.instance.codexSnapshotHome, plan.directories.codexHome);
    assert.equal(api.instance.codexHasData, true);
    sample('cold-ready');
    assertions.push('real production Claude and Codex indexes loaded the six synthetic files');
    stage = 'warm-refresh';
    // Explicit own-host refresh avoids mistaking a blurred-window poll no-op
    // for an actual warm refresh in this background diagnostic.
    for (let i = 0; i < 20; i++) { await api.instance.refreshData(false, 'manual'); await settle(api.instance); }
    sample('twenty-warm-refreshes');
    assertions.push('twenty actual host refreshes settled without owned network or watcher');
    stage = 'panel-lifecycle';
    const view = api.instance.webviewProvider;
    for (let cycle = 1; cycle <= 20; cycle++) {
      view.show('achievements');
      assert.ok(view.panel, 'actual panel created');
      assert.ok(view.panel.webview.html.length > 0, 'actual webview HTML set');
      await delay(100);
      sample('panel-open-' + cycle);
      view.panel.dispose();
      await delay(100);
      assert.equal(view.panel, undefined);
      assert.equal(view.dataPanelCache.size, 0);
      assert.equal(view.pendingAchievementNotice.size, 0);
      assert.equal(view.acceptedAchievementPreview.size, 0);
    }
    assertions.push('twenty actual WebviewPanel open/dispose cycles clear panel-owned caches');
    stage = 'feature-toggle';
    const originalProvider = api.instance.codexProvider;
    for (const enabled of [false, true]) {
      await api.instance.settings.set('enableAchievements', enabled);
      api.instance.onSettingsChangedFromPanel('enableAchievements');
      await settle(api.instance);
      assert.equal(api.instance.codexProvider, originalProvider);
      assert.equal(api.instance.getConfiguration().enableAchievements, enabled);
      sample(enabled ? 'achievements-on' : 'achievements-off');
    }
    assertions.push('real own-state achievement OFF/ON preserves the provider instance');
  } catch (error) {
    failureStage = stage;
    // Fixed phase only in report. Do not serialize arbitrary errors, stacks,
    // user paths or private instance/context objects.
    console.error('CCU isolated native diagnostic failed at ' + stage);
  } finally {
    if (api) {
      stage = 'dispose';
      try {
        await bounded(api.stop(), 60_000, 'dispose-timeout');
        assert.equal(api.instance.resourceOwnership.snapshotForTests().activeCount, 0);
        assert.equal(api.instance.webviewProvider.panel, undefined);
        stopCompleted = true;
      } catch { failureStage ??= stage; }
    }
    const report = {
      kind: 'actual-native-development-host-api-diagnostic-not-final-install-f5',
      sourceHead: manifest.sourceHead, stagedRuntimeVersion: manifest.packageVersion,
      vscodeVersion: vscode.version, platform: process.platform,
      outcome: failureStage ? 'fail' : 'pass', failureStage: failureStage ?? null,
      assertions, samples, stopCompleted, elapsedMs: Date.now() - started,
      heapLeakConclusionEstablished: false, pixelVisualAcceptancePassed: false, finalInstallF5Passed: false,
      limits: { sampledHostRssBytes: 2 * 1024 ** 3, panelCycles: 20, warmRefreshes: 20 },
    };
    await fs.writeFile(path.join(plan.root, 'native-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (failureStage) throw new Error('native-test-runner:failed-' + failureStage);
}
module.exports = { run };
