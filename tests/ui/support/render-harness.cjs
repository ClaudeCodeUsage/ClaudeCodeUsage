'use strict';

const Module = require('node:module');
const path = require('node:path');
const { freezeClock } = require('./frozen-clock.cjs');
const originalLoad = Module._load;

let latestHarnessPanel;

function createHarnessPanel(nativeResources = false) {
  const webview = {
    html: '',
    ...(nativeResources ? {
      cspSource: "'self'",
      asWebviewUri: (uri) => {
        const route = achievementResourceRoutes.get(uri.fsPath);
        if (!route) throw new Error('Harness resource is not a packaged achievement icon');
        return { toString: () => route };
      },
    } : {}),
    onDidReceiveMessage: () => ({ dispose: () => undefined }),
    postMessage: async () => true,
  };
  const panel = {
    webview,
    reveal: () => undefined,
    onDidDispose: () => ({ dispose: () => undefined }),
  };
  latestHarnessPanel = panel;
  return panel;
}

const vscodeHost = {
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ViewColumn: { One: 1 },
  Uri: { file: (fsPath) => ({ fsPath }) },
  env: { language: 'en', uriScheme: 'vscode' },
  commands: { executeCommand: async () => undefined },
  extensions: { getExtension: () => undefined },
  authentication: { getSession: async () => undefined },
  window: {
    activeColorTheme: { kind: 1 },
    createWebviewPanel: () => createHarnessPanel(),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
    fs: {},
  },
};

Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return vscodeHost;
  return originalLoad.call(this, request, parent, isMain);
};

const { UsageWebviewProvider } = require('../../../out/webview.js');
const { I18n } = require('../../../out/i18n.js');
const { SETTINGS } = require('../../../out/settings.js');
const { ClaudeQuotaPaceSource } = require('../../../out/quotaPaceSource.js');
const { QUOTA_PACE_WEEK_MS } = require('../../../out/quotaPaceAdapters.js');
const { codexModelSignals } = require('../../../out/achievements.js');
const { codexAchievementEffortStatistics } = require('../../../out/achievementEffortStatistics.js');
const { buildCodexUsageView } = require('../../../out/providers/codex/codexUsage.js');
const { buildScopedCodexInsights } = require('../../../out/providers/codex/codexInsights.js');
const { buildProjectUsageMatrixSnapshot } = require('../../../out/projectUsageMatrix.js');
const {
  CODEX_WEBVIEW_NOW,
  codexWebviewFixture,
  unknownModelCodexWebviewFixture,
} = require('../../../out/test/codexWebviewFixtures.js');
const {
  rootedTaskBeyondRecentRowCapFixture,
  rootlessCrossProjectCycleFixture,
} = require('../../../out/test/codexFixtures.js');
const {
  buildAdviceEffectivenessFixture,
} = require('./advice-effectiveness-fixture.cjs');

Module._load = originalLoad;

// Synthetic equivalent of VS Code resource authorization, not native URI
// acceptance. No request-controlled path ever reaches filesystem I/O.
const { ACHIEVEMENT_IMAGE_FILES } = require('../../../out/achievementIcons.js');
const extensionPath = path.resolve(__dirname, '../../..');
const achievementResourceRoutes = new Map([...new Set(Object.values(ACHIEVEMENT_IMAGE_FILES))]
  .map(filename => [path.join(extensionPath, 'assets', 'achievements', filename),
    '/__achievement_icons__/' + filename]));
exports.achievementResourceFiles = new Map([...achievementResourceRoutes]
  .map(([filename, route]) => [route, filename]));

// Resolve Light+/Dark+ overrides against VS Code's registered color defaults.
// Font variables use VS Code's macOS defaults. input.border is registered with
// a null theme value, so `initial` preserves the real webview fallback path.
const THEMES = {
  light: ':root{' +
    '--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    '--vscode-font-size:13px;' +
    '--vscode-editor-font-family:Menlo,Monaco,"Courier New",monospace;' +
    '--vscode-editor-background:#ffffff;' +
    '--vscode-foreground:#616161;' +
    '--vscode-descriptionForeground:#717171;' +
    '--vscode-errorForeground:#A1260D;' +
    '--vscode-textLink-foreground:#006AB1;' +
    '--vscode-textCodeBlock-background:#dcdcdc66;' +
    '--vscode-textBlockQuote-background:#f2f2f2;' +
    '--vscode-textBlockQuote-border:#007acc80;' +
    '--vscode-panel-border:rgba(128,128,128,0.35);' +
    '--vscode-toolbar-hoverBackground:#b8b8b850;' +
    '--vscode-input-background:#ffffff;' +
    '--vscode-input-foreground:#616161;' +
    '--vscode-input-border:initial;' +
    '--vscode-inputValidation-warningBackground:#F6F5D2;' +
    '--vscode-inputValidation-warningBorder:#B89500;' +
    '--vscode-dropdown-background:#FFFFFF;' +
    '--vscode-dropdown-foreground:#616161;' +
    '--vscode-dropdown-border:#CECECE;' +
    '--vscode-button-background:#007ACC;' +
    '--vscode-button-foreground:#ffffff;' +
    '--vscode-button-hoverBackground:#0062A3;' +
    '--vscode-button-secondaryBackground:#E8E8E8;' +
    '--vscode-button-secondaryForeground:#616161;' +
    '--vscode-button-secondaryHoverBackground:#FFFFFF;' +
    '--vscode-badge-background:#C4C4C4;' +
    '--vscode-badge-foreground:#333333;' +
    '--vscode-focusBorder:#0090F1;' +
    '--vscode-list-hoverBackground:#E8E8E8;' +
    '--vscode-progressBar-background:#0E70C0;' +
    '--vscode-editorWidget-background:#F3F3F3;' +
    '--vscode-testing-iconPassed:#73c991;' +
    '--vscode-symbolIcon-functionForeground:#652D90;' +
    '--vscode-charts-foreground:#616161;' +
    '--vscode-charts-lines:rgba(97,97,97,0.5);' +
    '--vscode-charts-blue:#0063D3;' +
    '--vscode-charts-orange:#EA5C0055;' +
    '--vscode-charts-red:#E51400;' +
    '--vscode-charts-green:#388A34;' +
    '--vscode-charts-purple:#652D90;' +
    '--vscode-charts-yellow:#BF8803;' +
    '--vscode-list-inactiveSelectionBackground:#E4E6F1;' +
    '--vscode-sideBar-background:#F3F3F3;' +
    '--vscode-editor-foreground:#000000;' +
    '--vscode-editorWidget-foreground:#616161;' +
    '--vscode-widget-shadow:rgba(0,0,0,0.16);' +
    '}*,*::before,*::after{animation:none!important;transition:none!important}',
  dark: ':root{' +
    '--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    '--vscode-font-size:13px;' +
    '--vscode-editor-font-family:Menlo,Monaco,"Courier New",monospace;' +
    '--vscode-editor-background:#1e1e1e;' +
    '--vscode-foreground:#CCCCCC;' +
    '--vscode-descriptionForeground:rgba(204,204,204,0.7);' +
    '--vscode-errorForeground:#F48771;' +
    '--vscode-textLink-foreground:#3794FF;' +
    '--vscode-textCodeBlock-background:#0a0a0a66;' +
    '--vscode-textBlockQuote-background:#222222;' +
    '--vscode-textBlockQuote-border:#007acc80;' +
    '--vscode-panel-border:rgba(128,128,128,0.35);' +
    '--vscode-toolbar-hoverBackground:#5a5d5e50;' +
    '--vscode-input-background:#3C3C3C;' +
    '--vscode-input-foreground:#CCCCCC;' +
    '--vscode-input-border:initial;' +
    '--vscode-inputValidation-warningBackground:#352A05;' +
    '--vscode-inputValidation-warningBorder:#B89500;' +
    '--vscode-dropdown-background:#3C3C3C;' +
    '--vscode-dropdown-foreground:#F0F0F0;' +
    '--vscode-dropdown-border:#3C3C3C;' +
    '--vscode-button-background:#0e639c;' +
    '--vscode-button-foreground:#ffffff;' +
    '--vscode-button-hoverBackground:#1177BB;' +
    '--vscode-button-secondaryBackground:#2A2D2E;' +
    '--vscode-button-secondaryForeground:#CCCCCC;' +
    '--vscode-button-secondaryHoverBackground:#333637;' +
    '--vscode-badge-background:#4D4D4D;' +
    '--vscode-badge-foreground:#FFFFFF;' +
    '--vscode-focusBorder:#007FD4;' +
    '--vscode-list-hoverBackground:#2A2D2E;' +
    '--vscode-progressBar-background:#0E70C0;' +
    '--vscode-editorWidget-background:#252526;' +
    '--vscode-testing-iconPassed:#73c991;' +
    '--vscode-symbolIcon-functionForeground:#B180D7;' +
    '--vscode-charts-foreground:#CCCCCC;' +
    '--vscode-charts-lines:rgba(204,204,204,0.5);' +
    '--vscode-charts-blue:#59A4F9;' +
    '--vscode-charts-orange:#EA5C0055;' +
    '--vscode-charts-red:#F14C4C;' +
    '--vscode-charts-green:#89D185;' +
    '--vscode-charts-purple:#B180D7;' +
    '--vscode-charts-yellow:#CCA700;' +
    '--vscode-list-inactiveSelectionBackground:#37373D;' +
    '--vscode-sideBar-background:#252526;' +
    '--vscode-editor-foreground:#D4D4D4;' +
    '--vscode-editorWidget-foreground:#CCCCCC;' +
    '--vscode-widget-shadow:rgba(0,0,0,0.36);' +
    '}*,*::before,*::after{animation:none!important;transition:none!important}',
};

// VS Code built-in Dark High Contrast (hc_black.json) and registered hcDark
// defaults, resolved from the installed workbench color registry. Null color
// registrations use `initial`, matching the existing Light+/Dark+ harness.
THEMES.highContrast = ':root{' + Object.entries({
  'font-family': '-apple-system,BlinkMacSystemFont,sans-serif',
  'font-size': '13px',
  'editor-font-family': 'Menlo,Monaco,"Courier New",monospace',
  'editor-background': '#000000', 'foreground': '#FFFFFF',
  'descriptionForeground': 'rgba(255,255,255,0.7)', 'errorForeground': '#F48771',
  'textLink-foreground': '#21A6FF', 'textCodeBlock-background': '#000000',
  'textBlockQuote-background': 'initial', 'textBlockQuote-border': '#FFFFFF',
  'panel-border': '#6FC3DF', 'toolbar-hoverBackground': 'initial',
  'input-background': '#000000', 'input-foreground': '#FFFFFF', 'input-border': '#6FC3DF',
  'inputValidation-warningBackground': '#000000', 'inputValidation-warningBorder': '#6FC3DF',
  'dropdown-background': '#000000', 'dropdown-foreground': '#FFFFFF', 'dropdown-border': '#6FC3DF',
  'button-background': '#000000', 'button-foreground': '#FFFFFF', 'button-hoverBackground': '#000000',
  'button-secondaryBackground': 'initial', 'button-secondaryForeground': '#FFFFFF',
  'button-secondaryHoverBackground': 'initial', 'badge-background': '#000000', 'badge-foreground': '#FFFFFF',
  'focusBorder': '#F38518', 'list-hoverBackground': 'rgba(255,255,255,0.1)',
  'progressBar-background': '#6FC3DF', 'editorWidget-background': '#0C141F',
  'testing-iconPassed': '#73c991', 'symbolIcon-functionForeground': '#B180D7',
  'charts-foreground': '#FFFFFF', 'charts-lines': 'rgba(255,255,255,0.5)',
  'charts-blue': '#59A4F9', 'charts-orange': 'initial', 'charts-red': '#F48771',
  'charts-green': '#89D185', 'charts-purple': '#B180D7', 'charts-yellow': '#FFD370',
  'list-inactiveSelectionBackground': 'initial', 'sideBar-background': '#000000',
  'editor-foreground': '#FFFFFF', 'editorWidget-foreground': '#FFFFFF', 'widget-shadow': 'initial',
}).map(([name, value]) => `--vscode-${name}:${value};`).join('') +
  '}*,*::before,*::after{animation:none!important;transition:none!important}';

function settingsStore({
  autoRefresh = false,
  weeklyValue = true,
  shareStudio = true,
  adviceEffectiveness = false,
  adviceOptimizer = false,
  displayCurrency = 'USD',
  projectMatrix = true,
  achievementsEnabled = true,
  achievementNotices = true,
  quotaPace = false,
} = {}) {
  const values = new Map(SETTINGS.map((definition) => [definition.key, definition.default]));
  values.set('codex.optimization.enabled', true);
  values.set('dashboardAutoRefresh', autoRefresh);
  values.set('showWeeklyEquivalentValue', weeklyValue);
  values.set('enableShareCard', shareStudio);
  values.set('advice.effectiveness.enabled', adviceEffectiveness);
  values.set('advice.optimizer.enabled', adviceOptimizer);
  values.set('displayCurrency', displayCurrency);
  values.set('showProjectUsageMatrix', projectMatrix);
  values.set('enableAchievements', achievementsEnabled);
  values.set('showAchievementNotices', achievementNotices);
  if (quotaPace) values.set('showWeeklyQuotaPace', true);
  return {
    get: (key) => values.get(key),
    snapshot: () => SETTINGS.map((definition) => ({
      ...definition,
      value: values.get(definition.key),
      isDefault: values.get(definition.key) === definition.default,
    })),
  };
}

// Explicit synthetic account evidence and raw successful response. This is a
// pure source projection: no credentials, cache, logs or Extension Host I/O.
function quotaPaceFixture(state = 'fresh') {
  const resetAt = CODEX_WEBVIEW_NOW + 3 * QUOTA_PACE_WEEK_MS / 4;
  const usage = { limits: [
    { kind: 'session', percent: 73, resets_at: new Date(CODEX_WEBVIEW_NOW + 3_600_000).toISOString() },
    { kind: 'weekly_all', percent: 29, resets_at: new Date(resetAt).toISOString() },
    { kind: 'weekly_scoped', percent: 40, resets_at: new Date(resetAt).toISOString(),
      scope: { model: { id: 'synthetic-model', display_name: 'Synthetic scoped model' } } },
  ] };
  const snapshot = new ClaudeQuotaPaceSource().project({
    enabled: true, usage, observedAt: CODEX_WEBVIEW_NOW,
    verifiedAccountFingerprint: 'acct_0123456789abcdef0123456789abcdef',
  });
  // Stale/reset fixtures advance the renderer clock below, retaining this
  // original observation and its pure source DTO. A repaint is not a fetch.
  if (state === 'null') return { usage, snapshot: null };
  if (state === 'raw-mismatch') usage.limits[1].percent = 30;
  return { usage, snapshot };
}

function claudeProjectUsageMatrix() {
  const points = [];
  for (let project = 1; project <= 16; project += 1) {
    for (let offset = 0; offset < 10; offset += 1) {
      const day = new Date(Date.UTC(2026, 6, 20 - offset * 3 - (project % 3)))
        .toISOString().slice(0, 10);
      points.push({
        projectKey: `claude:project-${String(project).padStart(2, '0')}`,
        projectName: `Research Project ${String(project).padStart(2, '0')}`,
        day,
        tokens: project * 100_000 + offset * 13_000,
        coverage: 'complete',
      });
    }
  }
  return buildProjectUsageMatrixSnapshot('claude', points, {
    asOfDay: '2026-07-20',
    timeZone: 'Asia/Hong_Kong',
    coverage: 'complete',
  });
}

function memoryGlobalState() {
  const values = new Map();
  return {
    get: (key) => values.get(key),
    update: async (key, value) => {
      values.set(key, structuredClone(value));
    },
  };
}

function claudeUsage(multiplier = 1) {
  const modelBreakdown = {
    'claude-sonnet-4-5-20250929': {
      inputTokens: 38200 * multiplier,
      outputTokens: 6100 * multiplier,
      cacheCreationTokens: 14800 * multiplier,
      cacheReadTokens: 236000 * multiplier,
      cost: 2.74 * multiplier,
      count: 18 * multiplier,
    },
    'claude-haiku-4-5-20251001': {
      inputTokens: 9400 * multiplier,
      outputTokens: 2200 * multiplier,
      cacheCreationTokens: 3100 * multiplier,
      cacheReadTokens: 52000 * multiplier,
      cost: 0.31 * multiplier,
      count: 7 * multiplier,
    },
  };
  return {
    totalInputTokens: 47600 * multiplier,
    totalOutputTokens: 8300 * multiplier,
    totalCacheCreationTokens: 17900 * multiplier,
    totalCacheReadTokens: 288000 * multiplier,
    totalCost: 3.05 * multiplier,
    costBreakdown: {
      input: 0.44 * multiplier,
      output: 1.52 * multiplier,
      cacheWrite: 0.82 * multiplier,
      cacheRead: 0.27 * multiplier,
    },
    messageCount: 25 * multiplier,
    modelBreakdown,
  };
}

function addClaudeData(provider, { fixture = 'default', enableContent = false } = {}) {
  const today = claudeUsage();
  const now = new Date(CODEX_WEBVIEW_NOW);
  const completedWeeklyFixture = fixture === 'weekly-claude-completed';
  const completedResetAt = CODEX_WEBVIEW_NOW - 24 * 60 * 60_000;
  const combinedHeatmapRecords = fixture === 'combined-heatmap' || fixture === 'achievement-share-resources' || fixture.startsWith('achievement-theme-')
    ? [
        {
          timestamp: '2026-07-19T10:00:00.000Z',
          _sessionId: 'privacy-safe-share-fixture-a',
          message: {
            model: 'claude-sonnet-4-5-20250929',
            usage: {
              input_tokens: 120_000,
              output_tokens: 30_000,
              cache_creation_input_tokens: 40_000,
              cache_read_input_tokens: 310_000,
            },
          },
        },
        {
          timestamp: '2026-07-20T08:00:00.000Z',
          _sessionId: 'privacy-safe-share-fixture-b',
          message: {
            model: 'claude-sonnet-4-5-20250929',
            usage: {
              input_tokens: 180_000,
              output_tokens: 45_000,
              cache_creation_input_tokens: 55_000,
              cache_read_input_tokens: 420_000,
            },
          },
        },
      ]
    : [];
  const weeklyRecords = completedWeeklyFixture
    ? [{
        timestamp: new Date(completedResetAt - 2 * 60 * 60_000).toISOString(),
        message: {
          model: 'claude-sonnet-4-5-20250929',
          usage: {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }]
    : combinedHeatmapRecords;
  const sessionBreakdown = fixture === 'session-timezone-boundaries'
    ? [
        ['honolulu-today', 'Honolulu today', '2026-07-20T10:00:00.000Z'],
        ['honolulu-yesterday', 'Honolulu yesterday', '2026-07-19T10:00:00.000Z'],
        ['week-inside', 'Seven-day boundary inside', '2026-07-14T10:00:00.000Z'],
        ['week-outside', 'Seven-day boundary outside', '2026-07-14T08:00:00.000Z'],
        ['month-inside', 'Thirty-day boundary inside', '2026-06-21T10:00:00.000Z'],
        ['month-outside', 'Thirty-day boundary outside', '2026-06-21T08:00:00.000Z'],
      ].map(([sessionId, title, timestamp]) => ({
        sessionId,
        title,
        projectName: 'Timezone fixture',
        projectPath: '/tmp/timezone-fixture',
        startTime: new Date(timestamp),
        endTime: new Date(Date.parse(timestamp) + 30 * 60_000),
        data: claudeUsage(),
        peakContextTokens: 180_000,
      }))
    : [];
  provider.updateData(
    { ...today, sessionStart: new Date(now.getTime() - 3_600_000), sessionEnd: now },
    today,
    claudeUsage(6),
    claudeUsage(18),
    [
      { date: '2026-07-20', data: claudeUsage(0.6) },
      { date: '2026-07-19', data: claudeUsage(0.4) },
    ],
    [
      { date: '2026-07-01', data: claudeUsage(13) },
      { date: '2026-06-01', data: claudeUsage(5) },
    ],
    [
      { hour: '18:00', data: claudeUsage(0.35) },
      { hour: '19:00', data: claudeUsage(0.65) },
    ],
    undefined,
    undefined,
    weeklyRecords,
    sessionBreakdown,
    [],
    enableContent
      ? {
          categories: [],
          toolResultBreakdown: [],
          totalEstimatedTokens: 0,
          recentPrompts: [],
          thinkingBySession: {},
          thinkingByDay: {},
          skillUses: [],
        }
      : null,
    [],
    [],
    [],
    {
      '2026-07-19': [{ hour: '09:00', data: claudeUsage(0.4) }],
      '2026-07-20': [{ hour: '18:00', data: claudeUsage(0.6) }],
    },
    claudeProjectUsageMatrix(),
    [
      { date: '2026-07-20', data: claudeUsage(0.6) },
      { date: '2026-07-19', data: claudeUsage(0.4) },
      { date: '2026-06-01', data: claudeUsage(5) },
    ],
  );
  if (completedWeeklyFixture) {
    provider.updateWeeklyQuotaHistory([{
      provider: 'claude',
      seriesKey: 'test-profile',
      observedAt: completedResetAt - 60 * 60_000,
      resetAt: completedResetAt,
      usedPercent: 50,
    }]);
  }
}

function withoutInputTokens(tokens) {
  return {
    ...tokens,
    inputTotal: 0,
    cachedInput: 0,
    cacheWriteInput: 0,
    sourceTotal: Math.max(0, tokens.outputTotal ?? 0),
  };
}

function withoutInputBuckets(buckets) {
  return Object.fromEntries(
    Object.entries(buckets ?? {}).map(([key, tokens]) => [key, withoutInputTokens(tokens)]),
  );
}

/** Keep real output/reasoning activity while removing every input-side token.
 * This exercises the dashboard's undefined cache-hit denominator rather than
 * falling into the provider's empty-state path. */
function withoutInputSnapshot(snapshot) {
  const files = snapshot.files.map((file) => ({
    ...file,
    total: withoutInputTokens(file.total),
    byDay: withoutInputBuckets(file.byDay),
    byModel: withoutInputBuckets(file.byModel),
    byEffort: withoutInputBuckets(file.byEffort),
    ...(file.period
      ? {
          period: {
            ...file.period,
            days: Object.fromEntries(
              Object.entries(file.period.days).map(([day, slice]) => [day, {
                ...slice,
                total: withoutInputTokens(slice.total),
                byModel: withoutInputBuckets(slice.byModel),
                byEffort: withoutInputBuckets(slice.byEffort),
              }]),
            ),
          },
        }
      : {}),
  }));
  return {
    ...snapshot,
    total: withoutInputTokens(snapshot.total),
    files,
  };
}

function withoutHourlyRowsForCoveredDay(snapshot, day) {
  for (const file of snapshot.files) {
    if (!file.today?.days) continue;
    delete file.today.days[day];
    if (file.today.day === day) file.today.hours = {};
  }
  return snapshot;
}

function completedHistorySnapshot(snapshot) {
  const main = snapshot.coverage;
  main.totalFiles = main.indexedFiles;
  main.totalBytes = main.indexedBytes;
  main.complete = true;
  for (const range of [main.period.last7Days, main.period.last30Days, main.period.allTime]) {
    range.totalFiles = range.migratedFiles;
    range.totalBytes = range.migratedBytes;
    range.complete = true;
  }
  snapshot.hourlyCoverage.complete = true;
  snapshot.qualityFlags = {};
  return snapshot;
}

function effortStatisticsFixture(empty = false) {
  const t = (inputTotal, outputTotal) => ({ inputTotal, outputTotal, cachedInput: 0, cacheWriteInput: 0 });
  const file = (key, models, efforts, parentSessionKey, role = 'root') => {
    const total = Object.values(models).reduce((sum, row) => t(sum.inputTotal + row.inputTotal,
      sum.outputTotal + row.outputTotal), t(0, 0));
    return { total, byModel: models, byEffort: efforts, byDay: { '2026-07-20': { ...total } },
      session: { sessionKey: 'private-effort-' + key, role, ...(parentSessionKey ? { parentSessionKey } : {}),
        startedAt: CODEX_WEBVIEW_NOW - 60_000, endedAt: CODEX_WEBVIEW_NOW },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } };
  };
  const known = t(100_000_000, 100_000), small = t(0, 1), unknown = t(10, 1);
  const files = empty ? [] : [
    file('known-high', { 'gpt-6.1-sol': known }, { high: known }),
    file('unknown-high', { 'private-custom-model': unknown }, { high: unknown }),
    file('unknown-medium', { 'private-custom-model': unknown }, { medium: unknown }),
    file('small-xhigh', { 'gpt-6-luna': small }, { xhigh: small }),
    file('mixed', { 'gpt-6.1-sol': small, 'gpt-6-astra': small }, { max: small, ultra: small }),
    // Own root × effort output is required; idle input and APR must not inflate rows.
    file('idle-low', { 'gpt-6.1-sol': t(100_000_000, 0) }, { low: t(100_000_000, 0) }),
    file('apr', { 'gpt-6-astra': known }, { high: known }, 'private-effort-known-high', 'approval-reviewer'),
  ];
  const snapshot = codexWebviewFixture();
  snapshot.files = files;
  snapshot.total = files.reduce((sum, row) => t(sum.inputTotal + row.total.inputTotal,
    sum.outputTotal + row.total.outputTotal), t(0, 0));
  // Only current indexed-census authority is supplied. This is not historical
  // calendar, request-money-origin, accepted-receipt or durable badge proof.
  snapshot.currentManifestVerified = true;
  Object.assign(snapshot.coverage, { complete: true, indexedFiles: files.length, totalFiles: files.length,
    indexedBytes: files.length, totalBytes: files.length });
  return snapshot;
}

exports.renderHarness = async function renderHarness({
  provider: selectedProvider = 'codex',
  locale = 'en',
  theme = 'light',
  fixture = 'default',
  autoRefresh = false,
  weeklyValue = true,
  shareStudio = true,
  projectMatrix = true,
  achievementsEnabled = true,
  achievementNotices = true,
  adviceFeedback = 'none',
  timeZone = 'Asia/Hong_Kong',
  codexMonth = '',
  claudeOnly = false,
  codexOnly = false,
  commandTemplate = '',
  commandAfterReset = false,
  quotaPace = false,
  quotaPaceState = 'fresh',
  nativeResources = false,
} = {}) {
  vscodeHost.window.createWebviewPanel = () => createHarnessPanel(nativeResources);
  I18n.setLanguage(locale);
  I18n.setTimezone(timeZone);
  I18n.setDecimalPlaces(2);
  const localCurrencyFixture = fixture === 'local-currency';
  const displayCurrency = localCurrencyFixture ? 'EUR' : 'USD';
  I18n.setCurrencyDisplay(displayCurrency);
  vscodeHost.window.activeColorTheme.kind = theme === 'highContrast' ? 3 : theme === 'dark' ? 2 : 1;
  const paceRenderTime = fixture !== 'weekly-quota-pace' ? CODEX_WEBVIEW_NOW
    : quotaPaceState === 'stale' ? CODEX_WEBVIEW_NOW + 31 * 60_000
    : quotaPaceState === 'reset' ? CODEX_WEBVIEW_NOW + 3 * QUOTA_PACE_WEEK_MS / 4
    : CODEX_WEBVIEW_NOW;
  const restoreClock = freezeClock(paceRenderTime);
  try {
    const effortFixture = fixture.startsWith('achievement-effort-statistics');
    const baseSnapshot = effortFixture ? effortStatisticsFixture(fixture.endsWith('-empty'))
      : fixture === 'rootless-cycle'
      ? rootlessCrossProjectCycleFixture()
      : fixture === 'root-over-limit'
        ? rootedTaskBeyondRecentRowCapFixture()
        : fixture === 'unknown-models'
          ? unknownModelCodexWebviewFixture()
          : codexWebviewFixture();
    const snapshot = fixture === 'weekly-usage-only'
      ? {
          ...baseSnapshot,
          weeklyValueInputs: {
            observations: [],
            usage: [
              { timestamp: CODEX_WEBVIEW_NOW - 2 * 24 * 60 * 60_000, equivalentUsd: 12, pricedTokens: 1_000, totalTokens: 1_000 },
              { timestamp: CODEX_WEBVIEW_NOW - 9 * 24 * 60 * 60_000, equivalentUsd: 8, pricedTokens: 1_000, totalTokens: 1_000 },
            ],
          },
        }
      : fixture === 'zero-input'
        ? withoutInputSnapshot(baseSnapshot)
        : fixture === 'covered-day-without-hourly-rows'
          ? withoutHourlyRowsForCoveredDay(baseSnapshot, '2026-07-19')
        : fixture === 'complete-index'
          ? completedHistorySnapshot(baseSnapshot)
        : baseSnapshot;
    const view = buildCodexUsageView(snapshot, CODEX_WEBVIEW_NOW);
    if (fixture === 'weekly-quota-pace' && view.limit) {
      // Give Codex the same valid 29% weekly numeric sample. Its local-log
      // account attribution remains unknown and must never yield 116%.
      view.limit = { ...view.limit, observedAt: CODEX_WEBVIEW_NOW,
        windows: view.limit.windows.map(row => row.windowMinutes === 10_080
          ? { ...row, usedPercent: 29, resetsAt: CODEX_WEBVIEW_NOW + 3 * QUOTA_PACE_WEEK_MS / 4 }
          : row) };
    }
    const provider = new UsageWebviewProvider({ globalState: memoryGlobalState(),
      ...(nativeResources ? { extensionPath } : {}) });
    // The real extension loads globalState asynchronously before enabling any
    // consent or feedback control. Let that same path settle in the harness.
    await new Promise((resolve) => setImmediate(resolve));
    const persistedDetailsFixture = fixture === 'persisted-details';
    const adviceEffectivenessFixture = fixture === 'advice-effectiveness'
      || fixture === 'advice-effectiveness-snoozed';
    const adviceSnoozedFixture = fixture === 'advice-effectiveness-snoozed';
    const adviceOptimizerFixture = fixture === 'advice-optimizer';
    const adviceContentFixture = adviceEffectivenessFixture
      || adviceOptimizerFixture
      || fixture === 'advice-effectiveness-disabled';
    provider.settings = settingsStore({
      autoRefresh,
      weeklyValue,
      shareStudio,
      adviceEffectiveness: adviceEffectivenessFixture,
      adviceOptimizer: adviceOptimizerFixture,
      displayCurrency,
      projectMatrix,
      achievementsEnabled,
      achievementNotices,
      quotaPace,
    });
    if (!codexOnly && fixture !== 'achievement-calendar-subset') addClaudeData(provider, { fixture, enableContent: adviceContentFixture });
    if (fixture === 'achievement-token-stages') {
      // Synthetic materialized Token history for presentation, not a calendar
      // proof fixture or an injected grant. Run the actual rule evaluator.
      provider.allTimeData = claudeUsage(1000);
    }
    if (adviceEffectivenessFixture) {
      provider.updateAdviceEffectivenessData(
        buildAdviceEffectivenessFixture({ locale }).states,
      );
      if (adviceSnoozedFixture) {
        provider.adviceLocalState = {
          ...provider.adviceLocalState,
          suppression: [{
            provider: 'claude',
            surface: 'advice',
            recommendationId: 'recommendation-claude-clear-between-tasks',
            updatedAtEpochMs: CODEX_WEBVIEW_NOW,
            snoozedUntilEpochMs: CODEX_WEBVIEW_NOW + 7 * 24 * 60 * 60_000,
          }],
        };
      }
    }
    if (adviceOptimizerFixture) {
      provider.optimizerState = {
        draft: 'HOST_ONLY_OPTIMIZER_DRAFT',
        resolve: false,
        distil: false,
        aesthetic: false,
        prompt: 'Paste-ready optimizer result',
        settings: 'Effort: high',
        adviceId: 'advice-optimizer-0123456789abcdef01234567',
      };
    }
    if (adviceFeedback !== 'none') {
      provider.adviceLocalState = {
        ...provider.adviceLocalState,
        featureMode: 'enabled',
        feedback: [{
          adviceId: adviceFeedback === 'optimizer-helpful'
            ? 'advice-optimizer-0123456789abcdef01234567'
            : 'advice-claude-ui-fixture',
          recommendationId: adviceFeedback === 'optimizer-helpful'
            ? 'recommendation-optimizer-result-v1'
            : 'recommendation-claude-clear-between-tasks',
          rating: 'helpful',
          applied: 'not-applied',
          appliedAtEpochMs: null,
          updatedAtEpochMs: CODEX_WEBVIEW_NOW,
        }],
      };
    }
    let effortSignals;
    if (effortFixture) {
      effortSignals = achievementsEnabled ? { ...codexModelSignals(snapshot.files),
        effortStatistics: codexAchievementEffortStatistics(snapshot.files) }
        : { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } };
      if (!achievementsEnabled) Object.defineProperty(effortSignals, 'effortStatistics', {
        get: () => { throw new Error('Achievements OFF must not access effort statistics'); },
      });
    }
    provider.updateProviderData(
      claudeOnly ? null : view,
      buildScopedCodexInsights(view),
      claudeOnly
        ? { claude: true, codex: false, codexData: false }
        : { claude: !codexOnly, codex: true, codexData: true },
      effortSignals,
    );
    provider.currentProvider = selectedProvider;
    if (fixture === 'achievement-calendar-subset') {
      // Synthetic full-census conflict plus one sound dated root. Exercise
      // production projection/evaluation, not injected ready flags or grants.
      const {codexAchievementCalendarProjection}=require('../../../out/achievementCalendar.js');
      const {codexAchievementMoneyScopes}=require('../../../out/achievementMoneyScopes.js');
      const total={inputTotal:500_000_000,outputTotal:4};
      const part={inputTotal:125_000_000,outputTotal:1};
      const good={total,byModel:{'gpt-6.1-sol':total},byEffort:{},byDay:{},structural:{},
        session:{sessionKey:'synthetic-calendar-good',role:'root'},
        achievementPeriodWitness:{size:1,offset:1,expectedPrefixEvents:0,timeZone},
        period:{timeZone,indexedThrough:1,lineageVersion:1,lineagePrefixEvents:0,
          days:Object.fromEntries(['13','14','15','16'].map(d=>[`2026-07-${d}`,
            {total:part,byModel:{'gpt-6.1-sol':part},byEffort:{},structural:{}}]))}};
      const files=[good,{...good,session:{sessionKey:'synthetic-calendar-conflict',role:'root'}},
        {...good,session:{sessionKey:'synthetic-calendar-conflict',role:'root'}}];
      const dayEvidence=codexAchievementCalendarProjection(files,timeZone,true,false).evidence;
      provider.codexView={...view,currentManifestVerified:true,coverage:{...view.coverage,complete:true,
        identity:{...view.coverage.identity,complete:false}},
        allTime:{...view.allTime,total:{...view.allTime.total,processed:1_500_000_012}},
        periodCoverage:{...view.periodCoverage,timeZone,allTime:{...view.periodCoverage.allTime,complete:false}}};
      provider.providerAvailability={claude:false,codex:true,codexData:true};
      provider.codexAchievementSignals={...codexModelSignals(files),dayEvidence,
        money:codexAchievementMoneyScopes({files,complete:true,calendarComplete:false,dayEvidence,
          backend:'openai',asOfDay:'2026-07-20'})};
    }
    if (fixture === 'achievement-effort-statistics-retired') provider.invalidateAchievementEvidence('codex');
    if (fixture === 'weekly-quota-pace') {
      const { usage, snapshot: paceSnapshot } = quotaPaceFixture(quotaPaceState);
      // Set catalog state before supplying the original raw response and the
      // numeric DTO, exactly as the production opt-in renderer expects.
      provider.updateQuotaPace(paceSnapshot, usage);
    }

    if (fixture === 'achievement-share-resources') {
      // More than nine independently earned choices, including unselected
      // thumbnails. Synthetic retained awards; no filesystem record store.
      const { parseAchievementRecordStore } = require('../../../out/achievementRecordStore.js');
      const { achievementRuleVersion } = require('../../../out/achievementRuleVersions.js');
      const ids = ['local-share-export', 'local-advice-feedback', 'settings-explorer-bronze',
        'hundred-million-club', 'sonnet-main', 'opus-cannon', 'haiku-worker',
        'streak-machine', 'dual-provider-day', 'active-day-streak', 'model-rainbow'];
      provider.achievementRecordState = parseAchievementRecordStore({ schemaVersion: 2, catalogVersion: 2,
        generation: 1, sequence: ids.length, lastNoticeAt: 0, pinRevision: 0, showcaseMode: 'automatic',
        legacyBoundary: null, legacyRecords: [], pins: [],
        records: ids.map((id, index) => ({ id, seq: index + 1, ruleVersion: achievementRuleVersion(id),
          origin: 'history', unread: false, recordedDay: null, timeZone: null })),
        auxiliary: { activity: { schemaVersion: 2, settingKeys: [], features: [] },
          hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null } });
      provider.achievementGrants = new Set(ids);
    }
    if (fixture === 'combined-heatmap') {
      // Sharing protocol tests need one explicitly saved award. Their tiny
      // heatmap usage is no longer enough for output-qualified model rainbow.
      const { parseAchievementRecordStore } = require('../../../out/achievementRecordStore.js');
      provider.achievementRecordState = parseAchievementRecordStore({schemaVersion:2,catalogVersion:2,generation:1,
        sequence:1,lastNoticeAt:0,pinRevision:0,showcaseMode:'automatic',legacyBoundary:null,legacyRecords:[],pins:[],
        records:[{id:'local-share-export',seq:1,ruleVersion:1,origin:'history',unread:false,recordedDay:null,timeZone:null}],
        auxiliary:{activity:{schemaVersion:2,settingKeys:[],features:[]},hours:{schemaVersion:3,maxStreak:0},calendarPeak:null}});
      provider.achievementGrants = new Set(['local-share-export']);
    }
    if (['achievement-six-pins', 'achievement-six-pins-reordered', 'achievement-last-pin', 'achievement-last-pin-removed'].includes(fixture)) {
      const { parseAchievementRecordStore } = require('../../../out/achievementRecordStore.js');
      const ids = ['local-share-export','local-advice-feedback','settings-explorer-bronze','hundred-million-club','sonnet-main','opus-cannon'];
      const pins = ['local-share-export','local-advice-feedback','settings-explorer','cumulative-volume','sonnet-main','opus-cannon'];
      if (fixture === 'achievement-six-pins-reordered') [pins[0], pins[1]] = [pins[1], pins[0]];
      if (fixture === 'achievement-last-pin') pins.splice(1);
      if (fixture === 'achievement-last-pin-removed') pins.splice(0);
      provider.achievementRecordState = parseAchievementRecordStore({schemaVersion:2,catalogVersion:2,generation:1,
        sequence:6,lastNoticeAt:0,pinRevision:fixture.endsWith('-reordered') || fixture.endsWith('-removed') ? 1 : 0,
        showcaseMode:'manual',legacyBoundary:null,legacyRecords:[],pins,
        records:ids.map((id,index)=>({id,seq:index+1,ruleVersion:1,origin:'history',unread:false,recordedDay:null,timeZone:null})),
        auxiliary:{activity:{schemaVersion:2,settingKeys:[],features:[]},hours:{schemaVersion:3,maxStreak:0},calendarPeak:null}});
      provider.achievementGrants = new Set(ids);
      // Claude-only focus fixtures include the real sharing presentation so a
      // patch can preserve a deliberate choice independently of showcase pins.
      provider.sharingTemplate = 'achievements';
    }
    if (fixture.startsWith('achievement-long-term-')) {
      const {ACHIEVEMENT_DEFINITIONS,ACHIEVEMENT_SERIES}=require('../../../out/achievements.js');
      const {parseAchievementRecordStore}=require('../../../out/achievementRecordStore.js');
      const rank=['gold','platinum','legendary'].indexOf(fixture.replace('achievement-long-term-',''))+2;
      const ids=ACHIEVEMENT_SERIES['sonnet-main'].slice(0,rank+1);
      const progress=ACHIEVEMENT_DEFINITIONS.find(row=>row.id===ids.at(-1)).target;
      provider.providerAvailability={claude:true,codex:false,codexData:false};
      // Deliberately synthetic renderer facts; domain boundary tests separately
      // exercise the real evaluator and native-receipt qualification.
      provider.achievementResults=()=>ACHIEVEMENT_DEFINITIONS.map(row=>({...row,
        progress:ACHIEVEMENT_SERIES['sonnet-main'].includes(row.id)?progress:0,
        unlocked:ACHIEVEMENT_SERIES['sonnet-main'].includes(row.id)&&progress>=row.target}));
      provider.achievementRecordState=parseAchievementRecordStore({schemaVersion:2,catalogVersion:2,generation:1,
        sequence:ids.length,lastNoticeAt:0,pinRevision:0,showcaseMode:'manual',legacyBoundary:null,
        legacyRecords:[],pins:['sonnet-main'],records:ids.map((id,i)=>({id,seq:i+1,ruleVersion:1,
          origin:'history',unread:false,recordedDay:null,timeZone:null})),
        auxiliary:{activity:{schemaVersion:2,settingKeys:[],features:[]},hours:{schemaVersion:3,maxStreak:0},calendarPeak:null}});
      provider.achievementGrants=new Set(ids);
      provider.sharingTemplate='achievements';
    }
    if (fixture === 'achievement-records' || fixture === 'achievement-records-read' || fixture === 'achievement-history-only' || fixture === 'achievement-pins' || fixture.startsWith('achievement-hidden-pins')) {
      // Validated synthetic local records, not claimed personal achievement dates.
      const { parseAchievementRecordStore } = require('../../../out/achievementRecordStore.js');
      const ids = ['local-share-export', 'settings-explorer-bronze', 'settings-explorer-silver', 'local-advice-feedback', 'hundred-million-club'];
      const hiddenPins = fixture.startsWith('achievement-hidden-pins');
      if (hiddenPins) ids.push('astra-regular', 'sol-regular', 'luna-regular');
      provider.achievementRecordState = parseAchievementRecordStore({ schemaVersion: 1, generation: 1,
        sequence: ids.length, lastNoticeAt: 0, pins: hiddenPins
          ? fixture === 'achievement-hidden-pins-last' ? ['astra-regular']
            : fixture === 'achievement-hidden-pins-released' ? ['sol-regular', 'luna-regular'] : ['astra-regular', 'sol-regular', 'luna-regular']
          : fixture === 'achievement-pins' ? ['local-share-export'] : [],
        records: ids.map((id, index) => {
          const historical = fixture === 'achievement-history-only' || id === 'hundred-million-club';
          return { id, seq: index + 1, ruleVersion: 1, origin: historical ? 'history' : 'activity',
            unread: !historical && fixture !== 'achievement-records-read', recordedDay: historical ? null : '2026-07-20', timeZone: historical ? null : 'Asia/Hong_Kong' };
        }), auxiliary: { activity: { schemaVersion: 2, settingKeys: [], features: [] },
          hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null } });
      provider.achievementGrants = new Set(ids);
    }

    if (fixture.startsWith('achievement-theme-')) {
      const { parseAchievementRecordStore } = require('../../../out/achievementRecordStore.js');
      const milestoneOnly = fixture === 'achievement-theme-milestones';
      const ids = milestoneOnly ? ['streak-machine', 'dual-provider-day']
        : ['active-day-streak', 'streak-machine', 'dual-provider-days-bronze', 'dual-provider-day'];
      provider.achievementRecordState = parseAchievementRecordStore({ schemaVersion: 1, generation: 1,
        sequence: ids.length, lastNoticeAt: 0,
        pins: milestoneOnly ? ['streak-machine', 'dual-provider-day'] : fixture === 'achievement-theme-pins-released'
          ? ['active-day-streak', 'dual-provider-day'] : ['streak-machine', 'active-day-streak', 'dual-provider-day'],
        records: ids.map((id, index) => ({ id, seq: index + 1, ruleVersion: 1,
          origin: 'usage', unread: true, recordedDay: '2026-07-20', timeZone: 'Asia/Hong_Kong' })),
        auxiliary: { activity: { schemaVersion: 2, settingKeys: [], features: [] },
          hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null } });
      provider.achievementGrants = new Set(ids);
    }

    if (fixture.startsWith('achievement-journey-')) {
      const { parseAchievementRecordStore } = require('../../../out/achievementRecordStore.js');
      const complete = fixture === 'achievement-journey-complete';
      const historical = fixture === 'achievement-journey-history';
      provider.achievementRecordState = parseAchievementRecordStore({ schemaVersion: 1, generation: 1,
        sequence: historical ? 2 : 0, lastNoticeAt: 0, pins: [], records: historical
          ? ['safe-feature-explorer', 'local-share-export'].map((id, index) => ({ id, seq: index + 1,
            ruleVersion: 1, origin: 'history', unread: false, recordedDay: null, timeZone: null })) : [],
        auxiliary: { activity: { schemaVersion: 2, settingKeys: [], features: historical ? [] : complete
          ? ['achievementGalleryViewed', 'achievementSharePreview', 'localShareExport']
          : ['achievementGalleryViewed', 'achievementSharePreview', 'localAdviceFeedback'] },
          hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null } });
      provider.achievementActivity = provider.achievementRecordState.auxiliary.activity;
      provider.achievementGrants = new Set(provider.achievementRecordState.records.map(row => row.id));
      if (!complete && !historical) provider.pendingAchievementActivity = { ...provider.achievementActivity,
        features: [...provider.achievementActivity.features, 'localShareExport'] };
    }

    if (fixture === 'achievement-proof-stale') {
      provider.updateRefreshState('codex',{failed:true,lastSuccessfulAt:Date.parse('2026-07-20T11:00:00Z')});
    }
    if (fixture === 'achievement-review-loading' || fixture === 'achievement-review-failure') {
      // Controlled host state only: production renders the complete document.
      // Async initialization/failure is covered by Node host tests; this fixture
      // must not open a filesystem store or start another hydration attempt.
      await provider.achievementWrite;
      provider.achievementRecordState = undefined;
      provider.achievementRecordRepository = {
        initialize: () => { throw new Error('synthetic-review:unexpected-hydration'); },
      };
      provider.achievementRecordLoading = fixture === 'achievement-review-loading';
      provider.achievementRecordLoadFailed = fixture === 'achievement-review-failure';
    }
    if (fixture === 'achievement-management-history' || fixture === 'achievement-management-full' || fixture === 'achievement-management-history-recorded') {
      const {parseAchievementRecordStore}=require('../../../out/achievementRecordStore.js');
      const full=fixture==='achievement-management-full';
      const used=full?[56_000_000_000,4_000_000_000]:[100_000_000,1_000_000_000];
      const usage=n=>({...claudeUsage(),totalInputTokens:n,totalOutputTokens:0,
        totalCacheCreationTokens:0,totalCacheReadTokens:0,
        modelBreakdown:{'claude-sonnet-4-5':{inputTokens:n,outputTokens:0,cacheCreationTokens:0,cacheReadTokens:0,
          cost:0,count:1,referenceUsage:{inputTokens:n,outputTokens:0,cacheReadTokens:0,cacheCreation5mTokens:0,cacheCreation1hTokens:0}}}});
      provider.providerAvailability={claude:true,codex:false,codexData:false};
      provider.allTimeData=usage(used[0]+used[1]);
      provider.dailyDataForEveryDay=[{date:'2026-06-03',data:usage(used[1])},{date:'2026-06-01',data:usage(used[0])}];
      provider.sessionBreakdown=[];provider.achievementCalendarTimeZone=timeZone;
      const ids=full?['sonnet-main','sonnet-main-silver','sonnet-main-gold','sonnet-main-platinum','sonnet-main-legendary']:
        ['sonnet-main','sonnet-main-silver'];
      provider.achievementRecordState=parseAchievementRecordStore({schemaVersion:2,catalogVersion:2,generation:1,
        sequence:ids.length,lastNoticeAt:0,pinRevision:0,showcaseMode:'manual',legacyBoundary:null,legacyRecords:[],pins:[],
        records:ids.map((id,i)=>({id,seq:i+1,ruleVersion:1,origin:fixture==='achievement-management-history-recorded'?'usage':'history',
          unread:false,recordedDay:fixture==='achievement-management-history-recorded'?'2026-07-20':null,
          timeZone:fixture==='achievement-management-history-recorded'?timeZone:null})),
        auxiliary:{activity:{schemaVersion:2,settingKeys:[],features:[]},hours:{schemaVersion:3,maxStreak:0},calendarPeak:null}});
      provider.achievementGrants=new Set(ids);
    }
    if (fixture === 'achievement-review-next-rank') {
      // A retained historical bronze award with a smaller current subtotal.
      // Use the real record validator, evaluator and renderer; do not replace
      // achievementResults or build an overview/gallery HTML fragment here.
      const { parseAchievementRecordStore } = require('../../../out/achievementRecordStore.js');
      provider.providerAvailability = { claude: true, codex: false, codexData: false };
      provider.allTimeData = { ...claudeUsage(), totalInputTokens: 6_000_000,
        totalOutputTokens: 1, totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
        modelBreakdown: {} };
      provider.dailyDataForEveryDay = [];
      provider.sessionBreakdown = [];
      provider.achievementCalendarTimeZone = timeZone;
      provider.achievementRecordState = parseAchievementRecordStore({
        schemaVersion: 2, catalogVersion: 2, generation: 1, sequence: 1,
        lastNoticeAt: 0, pinRevision: 0, showcaseMode: 'automatic',
        legacyBoundary: null, legacyRecords: [], pins: [],
        records: [{ id: 'hundred-million-club', seq: 1, ruleVersion: 1,
          origin: 'history', unread: false, recordedDay: null, timeZone: null }],
        auxiliary: { activity: { schemaVersion: 2, settingKeys: [], features: [] },
          hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null },
      });
      provider.achievementGrants = new Set(['hundred-million-club']);
    }

    if (/^\d{4}-\d{2}$/.test(codexMonth)) {
      const rows = view.allTimeDaily
        .filter((row) => row.day.startsWith(codexMonth + '-'))
        .sort((left, right) => left.day.localeCompare(right.day));
      return provider.renderCodexMonthDailyDetail(codexMonth, rows);
    }

    if (nativeResources && !commandTemplate) provider.panel = createHarnessPanel(true);
    latestHarnessPanel = undefined;
    if (commandTemplate) {
      provider.showSharingWorkspace(commandTemplate);
      if (commandAfterReset) {
        provider.clearSharingRuntimeState();
        provider.showSharingWorkspace(commandTemplate);
      }
    }
    const html = latestHarnessPanel
      ? latestHarnessPanel.webview.html
      : provider.getWebviewContent();
    const fixtureHtml = persistedDetailsFixture
      ? html.replace('<details class="model-item"', '<details class="model-item" data-persist="test-model"')
      : html;
    const bodyClass = theme === 'highContrast' ? 'vscode-high-contrast ' : theme === 'dark' ? 'vscode-dark ' : 'vscode-light ';
    return fixtureHtml
      .replace('</head>', `<style id="test-vscode-theme">${THEMES[theme]}</style></head>`)
      .replace('<body class="', `<body class="${bodyClass}`);
  } finally {
    restoreClock();
  }
};
