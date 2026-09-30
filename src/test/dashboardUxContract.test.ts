import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

let handler: (message: Record<string, unknown>) => Promise<void>;
let saveDialogs = 0;
const writes: string[] = [];
const posted: Record<string, any>[] = [];
const vscode = {
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ViewColumn: { One: 1 },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  env: { language: 'en', uriScheme: 'vscode' },
  commands: { executeCommand: async () => undefined },
  extensions: { getExtension: () => undefined },
  window: {
    activeColorTheme: { kind: 1 },
    createWebviewPanel: () => ({
      webview: {
        html: '',
        onDidReceiveMessage: (value: typeof handler) => { handler = value; return { dispose() {} }; },
        postMessage: async (message: Record<string, unknown>) => { posted.push(message); return true; },
      },
      reveal() {}, onDidDispose: () => ({ dispose() {} }),
    }),
    showSaveDialog: async () => { saveDialogs++; return { fsPath: '/synthetic/export.svg' }; },
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback, update: async () => undefined }),
    fs: { writeFile: async (_uri: unknown, bytes: Uint8Array) => { writes.push(Buffer.from(bytes).toString('utf8')); } },
  },
};
const originalLoad = (Module as any)._load;
(Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
  return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
};
const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
const { SETTINGS, settingAppliesToProvider } = require('../settings') as typeof import('../settings');
const { I18n } = require('../i18n') as typeof import('../i18n');
const { getPricingBackend, setPricingBackend } = require('../pricing') as typeof import('../pricing');
(Module as any)._load = originalLoad;

function provider(): any {
  posted.length = 0; writes.length = 0; saveDialogs = 0;
  const value = new UsageWebviewProvider({ globalState: { get: () => undefined, update: async () => undefined } } as any) as any;
  value.show();
  value.allRecords = [{ timestamp: '2026-09-01T12:00:00Z' }];
  return value;
}

test('share export rejects an unpreviewed configuration before opening a save dialog', async () => {
  const p = provider();
  p.buildShareCardSvgFor = () => '<svg>accepted</svg>';
  await handler({ command: 'buildShareCard', range: 'last30', scope: 'all', sections: { projectName: false } });
  const preview = posted.find((m) => m.command === 'shareCardResult');
  await handler({ command: 'exportShareCard', previewId: preview!.previewId, range: 'last30', scope: 'all', sections: { projectName: true } });
  assert.equal(saveDialogs, 0);
});

test('share export writes the accepted immutable SVG, not a newly calculated artifact', async () => {
  const p = provider();
  let builds = 0;
  p.buildShareCardSvgFor = () => '<svg>build-' + (++builds) + '</svg>';
  const cfg = { range: 'last30', scope: 'all', sections: { projectName: false } };
  await handler({ command: 'buildShareCard', ...cfg });
  const preview = posted.find((m) => m.command === 'shareCardResult');
  assert.equal(typeof preview!.previewId, 'string');
  await handler({ command: 'exportShareCard', previewId: preview!.previewId, ...cfg });
  assert.deepEqual(writes, [preview!.svg]);
  assert.equal(builds, 1);
  await handler({ command: 'buildShareCard', ...cfg });
  await handler({ command: 'exportShareCard', previewId: preview!.previewId, ...cfg });
  assert.equal(saveDialogs, 1, 'superseded previews cannot export');
});

test('ordinary reset-all preserves secrets even if the client explicitly includes their keys', async () => {
  const p = provider();
  const reset: string[] = [];
  p.settings = { reset: async (key: string) => { reset.push(key); } };
  await handler({ command: 'resetAllSettings', keys: ['dashboardAutoRefresh', 'advice.apiKey'] });
  assert.deepEqual(reset, ['dashboardAutoRefresh']);
});

test('Codex directory recovery remains visible to both providers after unavailable fallback', () => {
  const directory = SETTINGS.find((d) => d.key === 'codex.dataDirectory')!;
  assert.equal(settingAppliesToProvider(directory, 'claude'), true);
  assert.equal(settingAppliesToProvider(directory, 'codex'), true);
  const p = provider();
  p.settings = { snapshot: () => [{ ...directory, value: '/synthetic/missing' }], get: (_k: string, fallback: unknown) => fallback };
  p.currentProvider = 'codex';
  p.providerSelectionInitialized = true;
  p.updateProviderData(null, {}, { claude: true, codex: false });
  assert.equal(p.currentProvider, 'claude');
  assert.match(p.renderSettingsPanel('claude'), /codex\.dataDirectory/);
});

test('unchanged dashboard renders reuse hidden data panels, but record and display changes invalidate them', () => {
  const p = provider();
  p.todayData = { totalInputTokens: 1 };
  p.panel = undefined;
  for (const name of ['renderTodayData', 'renderMonthData', 'renderSessionData', 'renderProjectData', 'renderBranchData', 'renderWorkflowData']) p[name] = () => '';
  let allTimeRenders = 0;
  p.renderAllTimeData = () => '<p>history-' + (++allTimeRenders) + '</p>';
  p.getMainContent();
  p.getMainContent();
  assert.equal(allTimeRenders, 1);
  p.allRecords = [...p.allRecords];
  p.getMainContent();
  assert.equal(allTimeRenders, 2);
  p.settings = { get: (_k: string, fallback: unknown) => fallback, snapshot: () => [{ key: 'displayCurrency', value: 'EUR' }] };
  p.getMainContent();
  assert.equal(allTimeRenders, 3);
});

test('progress distinguishes hourly backfill and waiting from completed primary log coverage', () => {
  const p = provider();
  const text = p.codexProgressText({ scannedFiles: 30, totalFiles: 30, indexedBytes: 100, totalBytes: 100,
    reason: 'hourly-history', workState: { status: 'cooldown', pausedReason: 'failure-backoff', nextEligibleAt: Date.now() + 60_000 } });
  assert.match(text, /retry|Retry|waiting|Waiting/);
  assert.doesNotMatch(text, /\(100%\)/, 'primary coverage is not overall hourly backfill progress');
});

test('panel caching expires today countdowns by minute while retaining unchanged history', () => {
  const p = provider();
  const originalNow = Date.now;
  let now = Date.parse('2026-09-30T12:00:20Z');
  Date.now = () => now;
  let today = 0, history = 0;
  const render = () => {
    p.cachedDataPanel('today', 'codex', () => String(++today));
    p.cachedDataPanel('all', 'codex', () => String(++history));
  };
  try {
    render(); render();
    assert.equal(today, 1);
    now += 60_000;
    render();
    assert.equal(today, 2, 'relative quota reset countdowns cannot stay stale for an hour');
    assert.equal(history, 1, 'a minute tick cannot force unrelated hidden history work');
    now += 3_600_000;
    render();
    assert.equal(history, 2);
  } finally { Date.now = originalNow; }
});

test('display, pricing, calendar and expired quota boundaries invalidate cached panels', () => {
  const p = provider();
  const originalNow = Date.now;
  const timezone = I18n.getTimezone();
  const currency = I18n.getCurrencyDisplay().code;
  const backend = getPricingBackend();
  I18n.setTimezone('UTC');
  let now = Date.parse('2026-09-30T23:59:40Z');
  Date.now = () => now;
  let renders = 0;
  const render = () => p.cachedDataPanel('all', 'claude', () => String(++renders));
  try {
    render(); render();
    assert.equal(renders, 1);
    now += 60_000; render();
    assert.equal(renders, 2, 'calendar midnight cannot reuse previous-day HTML');
    I18n.setCurrencyDisplay(currency === 'EUR' ? 'USD' : 'EUR'); render();
    assert.equal(renders, 3);
    setPricingBackend(backend === 'anthropic' ? 'aws-bedrock-in-region' : 'anthropic'); render();
    assert.equal(renders, 4);
    p.codexView = { limits: [{ resetsAt: now + 10_000 }] };
    let codexRenders = 0;
    const renderCodex = () => p.cachedDataPanel('all', 'codex', () => String(++codexRenders));
    renderCodex(); now += 20_000; renderCodex();
    assert.equal(codexRenders, 2, 'Codex reset expiry cannot wait for a source-log mutation');
  } finally {
    Date.now = originalNow;
    I18n.setTimezone(timezone);
    I18n.setCurrencyDisplay(currency);
    setPricingBackend(backend);
  }
});

test('refresh-failure feedback is anonymous and does not replace verified usage panels', () => {
  const p = provider();
  let renders = 0;
  p.updateWebview = () => { renders++; };
  p.updateRefreshState('claude', { failed: true, lastSuccessfulAt: 1_000 });
  p.updateRefreshState('claude', { failed: true, lastSuccessfulAt: 1_000 });
  assert.equal(renders, 0);
  const messages = posted.filter((m) => m.command === 'dashboardRefreshState');
  assert.equal(messages.length, 1, 'identical failures are coalesced');
  assert.match(messages[0].text, /last verified|previous data|refresh failed/i);
  assert.doesNotMatch(messages[0].text, /\/synthetic/);
  p.updateRefreshState('claude', { failed: false, lastSuccessfulAt: 2_000 });
  const states = posted.filter((m) => m.command === 'dashboardRefreshState');
  assert.equal(states[states.length - 1].text, '');
});

test('record replacement releases the old weekly corpus even when Claude is hidden', () => {
  const p = provider();
  p.panel = undefined;
  p.allRecords = [{ timestamp: '2026-09-01T12:00:00Z', message: {
    model: 'claude-sonnet-4-5-20250929', usage: {
      input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 50,
    },
  } }];
  p.weeklyValuePoints('claude');
  assert.equal(p.weeklyUsageCache.records, p.allRecords);
  p.currentProvider = 'codex';
  p.updateData(null, null, null, null, [], [], [], undefined, undefined, []);
  assert.equal(p.allRecords.length, 0);
  assert.equal(p.weeklyUsageCache, undefined, 'hidden weekly rendering cannot retain the replaced corpus');
});

test('unchanged data with a new theme invalidates the outer cached Auto share preview', () => {
  const p = provider();
  const theme = vscode.window.activeColorTheme.kind;
  p.lastShareCardConfig = { theme: 'auto' };
  p.buildShareCardSvgFor = () => '<svg>theme-' + vscode.window.activeColorTheme.kind + '</svg>';
  const render = () => p.cachedDataPanel('all', 'claude', () => p.renderShareCardPanel('claudeShareCard'));
  try {
    vscode.window.activeColorTheme.kind = 1;
    assert.match(render(), /<svg>theme-1<\/svg>/);
    vscode.window.activeColorTheme.kind = 2;
    assert.match(render(), /<svg>theme-2<\/svg>/);
  } finally { vscode.window.activeColorTheme.kind = theme; }
});

test('a failed replacement preview cannot expose a previous accepted export ID', () => {
  const p = provider();
  p.buildShareCardSvgFor = () => '<svg>accepted</svg>';
  p.renderShareCardPanel('claudeShareCard');
  assert.ok(p.shareCardPreviewCache.previewId);
  p.lastShareCardConfig = { theme: 'auroraDark' };
  p.buildShareCardSvgFor = () => { throw new Error('synthetic failure'); };
  assert.match(p.renderShareCardPanel('claudeShareCard'), /id="scPreview" data-preview-id=""/);
  assert.equal(p.shareCardPreviewCache, undefined);
});
