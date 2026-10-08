'use strict';

// Real installed Code Extension Development/Test Host diagnostic. No mocks,
// credentials, ordinary profiles or final-VSIX/visual/F5 claims. The small
// staging wrapper captures only this host's real production instance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(work, milliseconds, reason) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('native-test-runner:' + reason)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
async function disposePanelAndWait(view, milliseconds = 10_000) {
  const panel = view.panel;
  assert.equal(typeof panel?.onDidDispose, 'function', 'real panel disposal event available');
  let subscription;
  const disposed = new Promise(resolve => { subscription = panel.onDidDispose(resolve); });
  try {
    panel.dispose();
    await bounded(disposed, milliseconds, 'panel-dispose-timeout');
    assert.equal(view.panel, undefined);
  } finally { subscription?.dispose(); }
}
function assertNativePanelCachesCleared(view) {
  assert.equal(view.dataPanelCache.size, 0);
  assert.equal(view.pendingAchievementNotice.size, 0);
  // AchievementSharePreview owns one optional current artifact, not a Map.
  // Inspect only its known test-observable empty state, never serialize bytes.
  assert.equal(typeof view.acceptedAchievementPreview?.read, 'function');
  assert.equal(view.acceptedAchievementPreview.current, undefined);
}
function createRefreshIoProbe() {
  const counts = {
    claude: { records: 0, bodyReads: 0, unknownBodyReads: 0, bytesRead: 0, unknownBytesRead: 0 },
    codex: { records: 0, bodyReads: 0, unknownBodyReads: 0 },
  };
  const add = (summary, key, unknownKey, raw) => {
    const value = raw === undefined || raw === 'unknown' ? NaN : Number(raw);
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(summary[key] + value)) {
      summary[unknownKey]++;
    } else summary[key] += value;
  };
  return Object.freeze({
    observe(line) {
      // Never retain raw output, paths, labels, errors or arbitrary objects.
      if (typeof line !== 'string' || line.length > 4096) return;
      if (/^refresh: trigger=(startup|poll|credentials|watch|focus|workspace|settings|pricing|manual) /.test(line)) {
        counts.claude.records++;
        add(counts.claude, 'bodyReads', 'unknownBodyReads', /incremental\(bodies=(unknown|[0-9]+) /.exec(line)?.[1]);
        add(counts.claude, 'bytesRead', 'unknownBytesRead', /io\(bytes=(unknown|[0-9]+) /.exec(line)?.[1]);
      } else if (/^codex-index trigger=(startup|poll|credentials|watch|focus|workspace|settings|pricing|manual) /.test(line)) {
        counts.codex.records++;
        add(counts.codex, 'bodyReads', 'unknownBodyReads', / bodyReads=(unknown|[0-9]+) /.exec(line)?.[1]);
      }
    },
    snapshot: () => ({ claude: { ...counts.claude }, codex: { ...counts.codex } }),
  });
}
function assertZeroBodyWarmRefreshes(io, minimum) {
  for (const provider of ['claude', 'codex']) {
    assert.ok(io[provider].records >= minimum, 'observed warm refreshes');
    assert.equal(io[provider].unknownBodyReads, 0, 'known warm I/O');
    assert.equal(io[provider].bodyReads, 0, 'zero warm body reads');
  }
  assert.equal(io.claude.unknownBytesRead, 0, 'known warm I/O');
  assert.equal(io.claude.bytesRead, 0, 'zero warm body bytes');
}
async function settle(instance) {
  await bounded(instance.initializationWrites, 60_000, 'initialization-timeout');
  const deadline = Date.now() + 60_000;
  while (instance.refreshGate.active || instance.activeCodexRefreshes.size ||
      instance.codexCheckpointHydration || instance.pendingResourceStops.size ||
      instance.codexProviderRetirements.size) {
    if (Date.now() >= deadline) throw new Error('native-test-runner:settle-timeout');
    await delay(25);
  }
  if (instance.initializationWriteFailure) throw new Error('native-test-runner:initialization-write');
  if (instance.codexProviderRetirementFailure) throw new Error('native-test-runner:provider-retirement');
  await bounded(instance.codexBackgroundStateWrite, 60_000, 'background-write-timeout');
}
async function run() {
  const vscode = require('vscode');
  const plan = JSON.parse(await fs.readFile(path.join(__dirname, 'native-plan.json'), 'utf8'));
  let background;
  try { background = await fs.readFile(path.join(__dirname, 'native-background-options.json'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (background !== undefined) {
    assert.ok(background.length <= 128, 'bounded own background options');
    return require('./native-background.cjs').run(plan, JSON.parse(background));
  }
  let soak;
  try { soak = await fs.readFile(path.join(__dirname, 'native-soak-options.json'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (soak !== undefined) {
    assert.ok(soak.length <= 128, 'bounded own soak options');
    return require('./native-soak.cjs').run(plan, JSON.parse(soak));
  }
  const manifest = JSON.parse(await fs.readFile(path.join(plan.root, 'native-stage-manifest.json'), 'utf8'));
  const samples = [], assertions = [], started = Date.now();
  let api, stage = 'activation', failureStage, stopCompleted = false, warmIo = null, outputAppend;
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
    const ioProbe = createRefreshIoProbe();
    outputAppend = api.instance.outputChannel.appendLine;
    api.instance.outputChannel.appendLine = line => {
      ioProbe.observe(line); outputAppend.call(api.instance.outputChannel, line);
    };
    // Explicit own-host refresh avoids mistaking a blurred-window poll no-op
    // for an actual warm refresh in this background diagnostic.
    for (let i = 0; i < 20; i++) { await api.instance.refreshData(false, 'manual'); await settle(api.instance); }
    api.instance.outputChannel.appendLine = outputAppend;
    outputAppend = undefined;
    warmIo = ioProbe.snapshot();
    assertZeroBodyWarmRefreshes(warmIo, 20);
    sample('twenty-warm-refreshes');
    assertions.push('twenty actual host refreshes observe known zero Claude/Codex body reads and Claude body bytes, without owned network or watcher');
    stage = 'panel-lifecycle';
    const view = api.instance.webviewProvider;
    for (let cycle = 1; cycle <= 20; cycle++) {
      view.show('achievements');
      assert.ok(view.panel, 'actual panel created');
      assert.ok(view.panel.webview.html.length > 0, 'actual webview HTML set');
      await delay(100);
      sample('panel-open-' + cycle);
      // Direct synthetic artifact seed exercises lifecycle retirement only.
      // It is not an earned selection, user share consent, preview UI or export.
      view.acceptedAchievementPreview.accept(['astra-regular'], '<svg>synthetic-test-only</svg>', 'en');
      stage = 'panel-lifecycle-dispose';
      await disposePanelAndWait(view);
      assertNativePanelCachesCleared(view);
      stage = 'panel-lifecycle';
    }
    assertions.push('twenty actual WebviewPanel disposal events clear map/set caches and directly seeded synthetic preview artifacts, not share-consent/export acceptance');
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
    stage = 'analysis-provider-retirement';
    for (let cycle = 0; cycle < 20; cycle++) {
      const enabled = cycle % 2 !== 0, priorProvider = api.instance.codexProvider;
      await api.instance.settings.set('enableContentAnalysis', enabled);
      api.instance.onSettingsChangedFromPanel('enableContentAnalysis');
      await settle(api.instance);
      assert.notEqual(api.instance.codexProvider, priorProvider);
      assert.equal(api.instance.codexProviderRetirements.size, 0);
      assert.equal(api.instance.getConfiguration().enableContentAnalysis, enabled);
      await api.instance.refreshData(false, 'manual');
      await settle(api.instance);
      sample('content-analysis-toggle-' + (cycle + 1));
    }
    assertions.push('twenty actual own-state content-analysis toggles await old provider retirement before refreshing the replacement');
  } catch (error) {
    failureStage = stage;
    // Fixed phase only in report. Do not serialize arbitrary errors, stacks,
    // user paths or private instance/context objects.
    console.error('CCU isolated native diagnostic failed at ' + stage);
  } finally {
    if (api) {
      if (outputAppend) api.instance.outputChannel.appendLine = outputAppend;
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
      assertions, samples, warmIo, stopCompleted, elapsedMs: Date.now() - started,
      heapLeakConclusionEstablished: false, pixelVisualAcceptancePassed: false, finalInstallF5Passed: false,
      limits: { sampledHostRssBytes: 2 * 1024 ** 3, panelCycles: 20, warmRefreshes: 20, contentAnalysisToggles: 20 },
    };
    await fs.writeFile(path.join(plan.root, 'native-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (failureStage) throw new Error('native-test-runner:failed-' + failureStage);
}
module.exports = { run, disposePanelAndWait, assertNativePanelCachesCleared, settle,
  createRefreshIoProbe, assertZeroBodyWarmRefreshes };
