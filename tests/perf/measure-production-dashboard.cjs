'use strict';

// Synthetic coordinator + renderer, not native VS Code/F5 or Windows OOM proof.
// Unlike the renderer-only benchmark, each poll discovers a real temporary
// manifest and rematerializes the production Claude dashboard contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { freezeClock } = require('../ui/support/frozen-clock.cjs');
const posted = [];
let documentWrites = 0;
const webview = {
  get html() { return ''; },
  set html(_value) { documentWrites++; },
  onDidReceiveMessage: () => ({ dispose() {} }),
  postMessage: async message => { posted.push(message); return true; },
};
const vscode = {
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ViewColumn: { One: 1 }, Uri: { file: fsPath => ({ fsPath }) },
  env: { language: 'en', uriScheme: 'vscode' },
  commands: { executeCommand: async () => undefined },
  extensions: { getExtension: () => undefined },
  window: { activeColorTheme: { kind: 2 }, createWebviewPanel: () => ({
    webview, reveal() {}, onDidDispose: () => ({ dispose() {} }),
  }) },
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
};
const load = Module._load;
Module._load = function (name, parent, isMain) {
  return name === 'vscode' ? vscode : load.call(this, name, parent, isMain);
};
const { UsageWebviewProvider } = require('../../out/webview.js');
const { ClaudeCodeUsageExtension } = require('../../out/extension.js');
const { SETTINGS } = require('../../out/settings.js');
const { I18n } = require('../../out/i18n.js');
const { createClaudeUsageIndex } = require('../../out/claudeIncrementalIndex.js');
const { RefreshSingleFlight } = require('../../out/refreshPolicy.js');
const { ClaudeDataLoader } = require('../../out/dataLoader.js');
const { buildCodexUsageView } = require('../../out/providers/codex/codexUsage.js');
const { buildScopedCodexInsights } = require('../../out/providers/codex/codexInsights.js');
const { CODEX_WEBVIEW_NOW, codexWebviewFixture } = require('../../out/test/codexWebviewFixtures.js');
Module._load = load;

(async () => {
  const recordCount = Number(process.env.CCU_PERF_RECORDS ?? 120_000);
  assert.ok(Number.isInteger(recordCount) && recordCount >= 2_000 && recordCount <= 250_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-production-dashboard-'));
  let clockNow = CODEX_WEBVIEW_NOW;
  let restoreClock = freezeClock(clockNow);
  const originalAttribution = ClaudeDataLoader.getUsageAttribution;
  I18n.setTimezone('UTC');
  I18n.setLanguage('en');
  try {
    const project = path.join(root, 'projects', '-synthetic');
    fs.mkdirSync(project, { recursive: true });
    const file = path.join(project, 'fixture.jsonl');
    const row = (i, now = CODEX_WEBVIEW_NOW - i * 10_000) => JSON.stringify({
      type: 'assistant', timestamp: new Date(now).toISOString(), requestId: 'synthetic-' + i,
      message: { id: 'synthetic-' + i, model: 'claude-opus-5-5',
        usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 400 } },
    });
    fs.writeFileSync(file, Array.from({ length: recordCount }, (_, i) => row(i)).join('\n') + '\n');
    const values = new Map(SETTINGS.map(def => [def.key, def.default]));
    values.set('dashboardAutoRefresh', true);
    values.set('advice.effectiveness.enabled', false);
    const settings = { get: key => values.get(key), snapshot: () => SETTINGS.map(def => ({
      ...def, value: values.get(def.key), configured: false,
    })) };
    const p = new UsageWebviewProvider({ globalState: { get: () => undefined, update: async () => undefined } });
    p.settings = settings;
    p.show();
    const diagnostics = [];
    const e = Object.create(ClaudeCodeUsageExtension.prototype);
    Object.assign(e, {
      configurationGeneration: 0, claudeIndexGeneration: 0, disposed: false, quotaColdRetryDone: true,
      settings, refreshGate: new RefreshSingleFlight(),
      providerRefreshStates: { claude: { failed: false }, codex: { failed: false } }, deliveredRefreshStates: {},
      cache: { records: [], contentAnalysis: null, manifest: null, claudeIndex: createClaudeUsageIndex(),
        lastUpdate: new Date(0), dataDirectory: null, usageLimits: null },
      webviewProvider: p, outputChannel: { appendLine: line => diagnostics.push(line) },
      statusBar: { updateContext() {}, updateUsageData() {}, updateQuota() {}, setProvider() {}, setLoading() {} },
      getConfiguration: () => ({ dataDirectory: root, dashboardAutoRefresh: true, statusBarProvider: 'claude',
        enableContentAnalysis: true, advicePromptWindowDays: 30, projectGroupingMode: 'flat', contextWindowOverride: 0 }),
      maybeFetchUsageLimits: async () => null, refreshCodexData: async () => undefined,
    });
    const coldStarted = performance.now();
    await e.refreshData(true, 'manual');
    const coldMs = +(performance.now() - coldStarted).toFixed(2);
    assert.equal(e.cache.records.length, recordCount);
    assert.ok(e.cache.contentAnalysis, 'default-on content analysis must participate');
    let attributionCalculations = 0;
    const attributionScopes = [];
    ClaudeDataLoader.getUsageAttribution = (...args) => {
      attributionCalculations++;
      attributionScopes.push(args[2].kind);
      return originalAttribution.call(ClaudeDataLoader, ...args);
    };
    let renders = 0, todayRenders = 0;
    for (const name of ['renderTodayData', 'renderMonthData', 'renderAllTimeData',
      'renderSessionData', 'renderProjectData', 'renderBranchData', 'renderWorkflowData', 'buildShareCardSvgFor']) {
      const original = p[name];
      p[name] = function (...args) {
        if (name === 'renderTodayData') todayRenders++; else renders++;
        return original.apply(this, args);
      };
    }
    let peakSampledRssBytes = process.memoryUsage().rss;
    async function unchangedPolls(mode) {
      p.currentProvider = mode;
      p.sharingTemplate = 'claudeShareCard';
      p.updateWebview();
      const acceptedPreview = p.shareCardPreviewCache;
      assert.ok(acceptedPreview?.previewId);
      posted.length = 0; diagnostics.length = 0; documentWrites = 0; renders = 0; todayRenders = 0; attributionCalculations = 0;
      const samples = [];
      for (let i = 0; i < 10; i++) {
        restoreClock(); clockNow += 60_000; restoreClock = freezeClock(clockNow);
        const started = performance.now();
        await e.refreshData(false, i === 9 ? 'focus' : 'poll');
        samples.push(+(performance.now() - started).toFixed(2));
        peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
      }
      assert.equal(renders, 0, `${mode}: unchanged history panels/artifacts must not be rebuilt`);
      if (mode === 'claude') assert.ok(todayRenders >= 10, 'Today countdowns must still expire per minute');
      else assert.equal(todayRenders, 0, `${mode}: no hidden Today rebuild`);
      assert.equal(attributionCalculations, 0, `${mode}: minute-spaced polls must not traverse unchanged records`);
      assert.equal(documentWrites, 0, `${mode}: unchanged page must not be replaced`);
      assert.equal(posted.filter(m => m.command === 'dashboardDataPatch').length, 0);
      assert.equal(p.shareCardPreviewCache, acceptedPreview);
      const io = diagnostics.filter(line => line.startsWith('refresh:'));
      assert.equal(io.length, 10);
      assert.ok(io.every(line => /io\(bytes=0 lines=0\)/.test(line)));
      return { mode, polls: samples.length, medianMs: [...samples].sort((a, b) => a - b)[5], samplesMs: samples,
        intervalMs: 60_000, todayCountdownRenders: todayRenders,
        hiddenPanelOrArtifactRenders: renders, attributionCalculations, dataPatches: 0, documentReplacements: documentWrites,
        bodyBytesRead: 0, acceptedPreviewRetained: true };
    }
    const claude = await unchangedPolls('claude');
    restoreClock();
    clockNow = Math.floor(clockNow / 3_600_000) * 3_600_000 + 3_600_000 - 40_000;
    restoreClock = freezeClock(clockNow);
    await e.refreshData(false, 'poll');
    const hourlyPreview = p.shareCardPreviewCache;
    posted.length = 0; diagnostics.length = 0; documentWrites = 0;
    renders = 0; todayRenders = 0; attributionCalculations = 0; attributionScopes.length = 0;
    const hourlySamples = [];
    for (let minute = 0; minute < 2; minute++) {
      restoreClock(); clockNow += 60_000; restoreClock = freezeClock(clockNow);
      const started = performance.now();
      await e.refreshData(false, 'poll');
      hourlySamples.push(+(performance.now() - started).toFixed(2));
      assert.equal(attributionCalculations, 1, 'hourly Content attribution must run only once');
      assert.deepEqual(attributionScopes, ['week'], 'Today attribution stays cached across the hour');
      assert.equal(renders, 6, 'hidden history refreshes only on the hour');
      assert.equal(p.shareCardPreviewCache, hourlyPreview);
      peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
    }
    assert.equal(documentWrites, 0);
    assert.equal(posted.filter(m => m.command === 'dashboardDataPatch').length, 0);
    assert.ok(diagnostics.filter(line => line.startsWith('refresh:')).every(line => /io\(bytes=0 lines=0\)/.test(line)));
    const hourBoundary = { polls: 2, samplesMs: hourlySamples, contentWeekCalculations: 1,
      todayAttributionCalculations: 0, hiddenHistoryRenders: renders, bodyBytesRead: 0,
      acceptedPreviewRetained: true, documentReplacements: 0, dataPatches: 0 };
    const fixture = codexWebviewFixture();
    e.codexView = buildCodexUsageView(fixture);
    e.codexInsights = buildScopedCodexInsights(e.codexView);
    e.codexAvailable = true; e.codexHasData = true;
    e.syncProviderUiSafely('settings');
    const compare = await unchangedPolls('compare');
    fs.appendFileSync(file, row(recordCount, CODEX_WEBVIEW_NOW) + '\n');
    await e.refreshData(false, 'watch');
    assert.equal(e.cache.records.length, recordCount + 1);
    assert.ok(renders > 0, 'a real append still invalidates panels');
    process.stdout.write(JSON.stringify({ kind: 'synthetic-production-coordinator-plus-renderer-not-native-UI-or-OOM-proof',
      records: recordCount, contentAnalysis: true, coldMs, claude, hourBoundary, compare, appendInvalidates: true, peakSampledRssBytes }, null, 2) + '\n');
  } finally {
    ClaudeDataLoader.getUsageAttribution = originalAttribution;
    restoreClock();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
