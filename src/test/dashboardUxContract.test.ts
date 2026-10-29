import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { freezeClock } = require(path.resolve(__dirname, '../../tests/ui/support/frozen-clock.cjs')) as {
  freezeClock: (now: number) => () => void;
};

let handler: (message: Record<string, unknown>) => Promise<void>;
let saveDialogs = 0;
const writes: string[] = [];
const writtenFiles = new Map<unknown, Uint8Array>();
const readUris: unknown[] = [];
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
    fs: {
      writeFile: async (uri: unknown, bytes: Uint8Array) => {
        writes.push(Buffer.from(bytes).toString('utf8')); writtenFiles.set(uri, Uint8Array.from(bytes));
      },
      readFile: async (uri: unknown): Promise<Uint8Array> => {
        readUris.push(uri);
        const bytes = writtenFiles.get(uri);
        if (!bytes) throw new Error('synthetic-file-not-written');
        return Uint8Array.from(bytes);
      },
    },
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
const { ClaudeCodeUsageExtension } = require('../extension') as typeof import('../extension');
const { createClaudeUsageIndex } = require('../claudeIncrementalIndex') as typeof import('../claudeIncrementalIndex');
const { RefreshSingleFlight } = require('../refreshPolicy') as typeof import('../refreshPolicy');
const { ClaudeDataLoader } = require('../dataLoader') as typeof import('../dataLoader');
(Module as any)._load = originalLoad;

function provider(): any {
  posted.length = 0; writes.length = 0; saveDialogs = 0; writtenFiles.clear(); readUris.length = 0;
  const value = new UsageWebviewProvider({ globalState: { get: () => undefined, update: async () => undefined } } as any) as any;
  value.show();
  value.allRecords = [{ timestamp: '2026-09-01T12:00:00Z' }];
  return value;
}

test('ready handshake synchronizes a valid restored tab without recording an achievement action', async () => {
  const p = provider();
  await new Promise<void>(resolve => setImmediate(resolve));
  p.providerAvailability = { claude: true, codex: true, codexData: true };
  p.currentProvider = 'codex';
  let actions = 0, ready = 0;
  p.recordAchievementFeature = () => { actions++; };
  p.onLocalDataClientReady = () => { ready++; };
  await handler({ command: 'localDataClientReady', provider: 'codex', activeTab: 'achievements', documentId: p.dashboardDocumentId });
  assert.equal(p.currentTab, 'achievements');
  assert.equal(p.webviewClientReady, true);
  assert.equal(actions, 0, 'restoring UI is not a fresh gallery visit');
  await handler({ command: 'localDataClientReady', provider: 'codex', activeTab: 'month', documentId: p.dashboardDocumentId });
  assert.equal(p.currentTab, 'month');
  assert.equal(actions, 0);
  assert.equal(ready, 2);
});

test('ready and tab messages reject unknown tabs, a different provider and disabled achievements', async () => {
  const p = provider();
  await new Promise<void>(resolve => setImmediate(resolve));
  p.currentProvider = 'codex';
  p.webviewClientReady = false;
  let ready = 0, actions = 0;
  p.onLocalDataClientReady = () => { ready++; };
  p.recordAchievementFeature = () => { actions++; };
  for (const message of [
    { command: 'localDataClientReady', provider: 'claude', activeTab: 'achievements' },
    { command: 'localDataClientReady', provider: 'codex', activeTab: '../private-path' },
    { command: 'localDataClientReady', provider: 'codex', activeTab: 'branches' },
    { command: 'localDataClientReady', provider: 'codex' },
    { command: 'localDataClientReady', activeTab: 'today' },
    { command: 'tabChanged', tab: '../private-path' },
    { command: 'tabChanged', tab: 'branches' },
  ]) await handler({ ...message, documentId: p.dashboardDocumentId });
  assert.equal(p.webviewClientReady, false);
  assert.equal(p.currentTab, 'today');
  assert.equal(ready, 0);
  p.settings = { get: (key: string, fallback: unknown) => key === 'enableAchievements' ? false : fallback };
  await handler({ command: 'localDataClientReady', provider: 'codex', activeTab: 'achievements', documentId: p.dashboardDocumentId });
  await handler({ command: 'tabChanged', tab: 'achievements', documentId: p.dashboardDocumentId });
  assert.equal(p.currentTab, 'today');
  assert.equal(p.webviewClientReady, false);
  assert.equal(actions, 0);
});

test('compare readiness accepts only its real all-time panel and does not change provider', async () => {
  const p = provider();
  await new Promise<void>(resolve => setImmediate(resolve));
  p.currentProvider = 'compare'; p.currentTab = 'all'; p.webviewClientReady = false;
  await handler({ command: 'localDataClientReady', provider: 'compare', activeTab: 'achievements', documentId: p.dashboardDocumentId });
  assert.equal(p.webviewClientReady, false);
  await handler({ command: 'localDataClientReady', provider: 'compare', activeTab: 'all', documentId: p.dashboardDocumentId });
  assert.equal(p.webviewClientReady, true);
  assert.equal(p.currentTab, 'all');
  assert.equal(p.currentProvider, 'compare');
});

test('retired document ready and tab messages cannot revive a replacement document', async () => {
  const p = provider();
  await new Promise<void>(resolve => setImmediate(resolve));
  const retiredId = p.dashboardDocumentId;
  p.renewDashboardDocument("<script>var __ccuDocumentId = '" + retiredId + "';</script>");
  p.currentTab = 'today'; p.webviewClientReady = false;
  let actions = 0, ready = 0;
  p.recordAchievementFeature = () => { actions++; };
  p.onLocalDataClientReady = () => { ready++; };
  for (const documentId of [retiredId, undefined]) {
    await handler({ command: 'localDataClientReady', provider: 'claude', activeTab: 'achievements', documentId });
    await handler({ command: 'tabChanged', tab: 'achievements', documentId });
  }
  assert.equal(p.currentTab, 'today');
  assert.equal(p.webviewClientReady, false);
  assert.equal(actions, 0); assert.equal(ready, 0);
  await handler({ command: 'localDataClientReady', provider: 'claude', activeTab: 'achievements', documentId: p.dashboardDocumentId });
  assert.equal(p.currentTab, 'achievements');
  assert.equal(p.webviewClientReady, true); assert.equal(ready, 1);
});

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

test('achievement export captures its exact accepted SVG; restored UI never silently rebuilds it', async () => {
  const p = provider();
  p.earnedAchievements = () => [{ id: 'astra-regular', group: 'codex', progress: 1, target: 1, unlocked: true }];
  let builds = 0;
  p.achievementShareSvg = () => '<svg>achievement-' + (++builds) + '</svg>';
  const request = { ids: ['astra-regular'], clientId: 'synthetic-client', requestId: 1 };
  await handler({ command: 'previewAchievementShare', ...request });
  const preview = posted.find(message => message.command === 'achievementShareResult')!;
  assert.equal(preview.clientId, request.clientId);
  assert.equal(preview.requestId, 1);
  await handler({ command: 'restoreAchievementShare', ...request, requestId: 2 });
  assert.equal(builds, 1, 'auto-refresh display hydration reuses the accepted artifact');
  await handler({ command: 'exportAchievementShare', ids: ['sol-regular'], previewId: preview.previewId });
  assert.equal(saveDialogs, 0, 'unpreviewed selection cannot open the save dialog');
  await handler({ command: 'exportAchievementShare', ids: request.ids, previewId: preview.previewId });
  assert.deepEqual(writes, [preview.svg]);
  assert.equal(builds, 1);
  await handler({ command: 'previewAchievementShare', ...request, requestId: 3 });
  await handler({ command: 'exportAchievementShare', ids: request.ids, previewId: preview.previewId });
  assert.equal(saveDialogs, 1, 'superseded handle stays invalid');
  p.clearSharingRuntimeState();
  const latest = posted.filter(message => message.command === 'achievementShareResult');
  await handler({ command: 'exportAchievementShare', ids: request.ids, previewId: latest[latest.length - 1]!.previewId });
  assert.equal(saveDialogs, 1, 'reset cannot resurrect an accepted preview');
});

test('achievement preview messages require an owned client token and safe request counter', async () => {
  const p = provider();
  p.achievementShareSvg = () => '<svg>unexpected</svg>';
  for (const invalid of [{}, { requestId: 0, clientId: 'client' }, { requestId: 1, clientId: '../path' },
    { requestId: Number.POSITIVE_INFINITY, clientId: 'client' }]) {
    await handler({ command: 'previewAchievementShare', ids: [], ...invalid });
  }
  assert.equal(posted.some(message => message.command === 'achievementShareResult'), false);
});

test('achievement sharing refreshes its language before saving but a started save keeps the captured bytes', async () => {
  const locale = I18n.getLocale();
  const originalDialog = vscode.window.showSaveDialog;
  try {
    I18n.setLanguage('en');
    const p = provider();
    p.earnedAchievements = () => [{ id: 'astra-regular', group: 'codex', progress: 1, target: 1, unlocked: true }];
    p.achievementShareSvg = () => '<svg>' + I18n.getLocale() + '</svg>';
    const request = { ids: ['astra-regular'], clientId: 'client', requestId: 1 };
    await handler({ command: 'previewAchievementShare', ...request });
    const old = posted.find(message => message.command === 'achievementShareResult')!;
    I18n.setLanguage('zh-CN');
    await handler({ command: 'exportAchievementShare', ids: request.ids, previewId: old.previewId });
    assert.equal(saveDialogs, 0);
    await handler({ command: 'restoreAchievementShare', ...request, requestId: 2 });
    const replies = posted.filter(message => message.command === 'achievementShareResult');
    const current = replies[replies.length - 1];
    assert.equal(current.svg, '<svg>zh-CN</svg>');
    let finish: (uri: any) => void = () => undefined;
    vscode.window.showSaveDialog = () => new Promise<any>(resolve => { finish = resolve; });
    const saving = handler({ command: 'exportAchievementShare', ids: request.ids, previewId: current.previewId });
    I18n.setLanguage('en');
    await handler({ command: 'previewAchievementShare', ...request, requestId: 3 });
    assert.equal(posted.filter(message => message.command === 'achievementShareResult').slice(-1)[0].svg, '<svg>en</svg>');
    finish({ fsPath: '/synthetic/export.svg' });
    await saving;
    assert.deepEqual(writes, ['<svg>zh-CN</svg>']);
    assert.equal(readUris.length, 1);
    assert.equal(posted.filter(message => message.command === 'achievementShareExportResult').slice(-1)[0].ok, true,
      'a replacement preview during the dialog does not retire the already captured artifact');
  } finally { I18n.setLanguage(locale as Parameters<typeof I18n.setLanguage>[0]); vscode.window.showSaveDialog = originalDialog; }
});

test('an achievement preview build failure invalidates its old handle and replies without private diagnostics', async () => {
  const p = provider();
  p.earnedAchievements = () => [{ id: 'astra-regular', group: 'codex', progress: 1, target: 1, unlocked: true }];
  p.achievementShareSvg = () => '<svg>accepted</svg>';
  const request = { ids: ['astra-regular'], clientId: 'synthetic-client', requestId: 1 };
  await handler({ command: 'previewAchievementShare', ...request });
  const old = posted.find(message => message.command === 'achievementShareResult')!;
  p.achievementShareSvg = () => { throw new Error('/private/synthetic-path'); };
  await assert.doesNotReject(handler({ command: 'previewAchievementShare', ...request, requestId: 2 }));
  const replies = posted.filter(message => message.command === 'achievementShareResult');
  assert.deepEqual(replies[replies.length - 1], {
    command: 'achievementShareResult', requestId: 2, clientId: request.clientId, ids: [], svg: '', error: true,
  });
  await handler({ command: 'exportAchievementShare', ids: request.ids, previewId: old.previewId });
  assert.equal(saveDialogs, 0);
  assert.equal(JSON.stringify(posted).includes('synthetic-path'), false);
});

test('turning achievements off resolves an already-owned preview request without remaining busy', async () => {
  const p = provider();
  p.settings = { get: (key: string, fallback: unknown) => key === 'enableAchievements' ? false : fallback };
  await handler({ command: 'previewAchievementShare', ids: ['astra-regular'], clientId: 'client', requestId: 1 });
  assert.deepEqual(posted.find(message => message.command === 'achievementShareResult'), {
    command: 'achievementShareResult', ids: [], svg: '', error: true, clientId: 'client', requestId: 1,
  });
});

test('achievement export uses one save dialog at a time and acknowledges success, cancellation and write failure', async () => {
  const p = provider();
  p.earnedAchievements = () => [{ id: 'astra-regular', group: 'codex', progress: 1, target: 1, unlocked: true }];
  p.achievementShareSvg = () => '<svg>accepted</svg>';
  await handler({ command: 'previewAchievementShare', ids: ['astra-regular'], clientId: 'client', requestId: 1 });
  const preview = posted.find(message => message.command === 'achievementShareResult')!;
  const message = { command: 'exportAchievementShare', ids: ['astra-regular'], previewId: preview.previewId };
  const originalDialog = vscode.window.showSaveDialog;
  const originalWrite = vscode.workspace.fs.writeFile;
  let finish: (uri: any) => void = () => undefined;
  vscode.window.showSaveDialog = () => { saveDialogs++; return new Promise<any>(resolve => { finish = resolve; }); };
  try {
    const first = handler(message);
    await handler(message);
    assert.equal(saveDialogs, 1);
    finish({ fsPath: '/synthetic/export.svg' });
    await first;
    const exportReplies = posted.filter(reply => reply.command === 'achievementShareExportResult');
    assert.deepEqual(exportReplies[exportReplies.length - 1], {
      command: 'achievementShareExportResult', previewId: preview.previewId, ok: true,
    });
    vscode.window.showSaveDialog = async () => undefined as any;
    await handler(message);
    assert.equal(posted[posted.length - 1]!.cancelled, true);
    vscode.window.showSaveDialog = originalDialog;
    vscode.workspace.fs.writeFile = async () => { throw new Error('/private/synthetic-write-error'); };
    await assert.doesNotReject(handler(message));
    assert.equal(posted[posted.length - 1]!.ok, false);
    assert.equal(posted[posted.length - 1]!.stale, false);
    assert.equal(JSON.stringify(posted).includes('synthetic-write-error'), false);
  } finally {
    vscode.window.showSaveDialog = originalDialog;
    vscode.workspace.fs.writeFile = originalWrite;
  }
});

for (const failure of ['mismatch', 'read-failure'] as const) {
  test(`achievement export verifies saved bytes before success: ${failure}`, async () => {
    const p = provider();
    p.earnedAchievements = () => [{ id: 'astra-regular', group: 'codex', progress: 1, target: 1, unlocked: true }];
    const accepted = '<svg>accepted</svg>';
    p.achievementShareSvg = () => accepted;
    await handler({ command: 'previewAchievementShare', ids: ['astra-regular'], clientId: 'client', requestId: 1 });
    const preview = posted.find(message => message.command === 'achievementShareResult')!;
    const actions: string[] = [];
    p.recordAchievementFeature = (feature: string) => { actions.push(feature); };
    const originalRead = vscode.workspace.fs.readFile;
    vscode.workspace.fs.readFile = async uri => {
      await originalRead(uri); // Also proves the exact written URI is read back.
      if (failure === 'read-failure') throw new Error('/private/synthetic-readback-error');
      const changed = Buffer.from(accepted, 'utf8'); changed[5] ^= 1;
      return changed; // Same length, different bytes.
    };
    const message = { command: 'exportAchievementShare', ids: ['astra-regular'], previewId: preview.previewId };
    try {
      await assert.doesNotReject(handler(message));
      assert.deepEqual(writes, [accepted]);
      assert.equal(readUris.length, 1);
      assert.deepEqual(actions, [], 'unverified bytes cannot grant the local-export milestone');
      assert.deepEqual(posted[posted.length - 1], {
        command: 'achievementShareExportResult', previewId: preview.previewId, ok: false, stale: false,
      });
      assert.equal(p.achievementExportPending, false);
      assert.equal(JSON.stringify(posted).includes('synthetic-readback-error'), false);
      vscode.workspace.fs.readFile = originalRead;
      await handler(message);
      assert.deepEqual(actions, ['localShareExport'], 'a verified retry records exactly one successful export');
      assert.equal(posted[posted.length - 1].ok, true);
    } finally { vscode.workspace.fs.readFile = originalRead; }
  });
}

test('ordinary reset-all preserves secrets even if the client explicitly includes their keys', async () => {
  const p = provider();
  const reset: string[] = [];
  p.settings = { get: (key: string) => SETTINGS.find(row => row.key === key)?.default,
    reset: async (key: string) => { reset.push(key); } };
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

test('identical quota observations preserve cache references instead of invalidating hidden panels', () => {
  const p = provider();
  p.panel = undefined;
  const quota = { seven_day: { utilization: 25, resets_at: '2026-10-07T12:00:00Z' } };
  const history = [{ provider: 'claude', observedAt: 1_000, usedFraction: 0.25, resetsAt: 2_000 }];
  p.updateQuota(quota);
  p.updateWeeklyQuotaHistory(history);
  const quotaReference = p.usageLimits;
  const historyReference = p.claudeWeeklyQuotaHistory;
  let renders = 0;
  p.cachedDataPanel('all', 'claude', () => String(++renders));
  p.updateQuota(structuredClone(quota));
  p.updateWeeklyQuotaHistory(structuredClone(history));
  p.cachedDataPanel('all', 'claude', () => String(++renders));
  assert.equal(p.usageLimits, quotaReference);
  assert.equal(p.claudeWeeklyQuotaHistory, historyReference);
  assert.equal(renders, 1);
  p.updateQuota({ seven_day: { ...quota.seven_day, utilization: 30 } });
  p.cachedDataPanel('all', 'claude', () => String(++renders));
  assert.equal(renders, 2, 'changed quota still invalidates the render contract');
});

test('unchanged Content attribution is cached without freezing dynamic advice or optimizer controls', () => {
  const p = provider();
  p.panel = undefined;
  const original = ClaudeDataLoader.getUsageAttribution;
  const originalNow = Date.now;
  const timezone = I18n.getTimezone();
  I18n.setTimezone('UTC');
  let now = Date.parse('2026-09-30T23:59:40Z');
  Date.now = () => now;
  let calculations = 0, adviceRevision = 1;
  (ClaudeDataLoader as any).getUsageAttribution = (...args: Parameters<typeof original>) => {
    calculations++;
    return original.call(ClaudeDataLoader, ...args);
  };
  p.renderAdviceCard = () => '<p>advice-' + adviceRevision + '</p>';
  p.renderOptimizerCard = () => '<p>optimizer-' + adviceRevision + '</p>';
  try {
    p.renderContentData('claude');
    adviceRevision++;
    const changed = p.renderContentData('claude');
    assert.match(changed, /advice-2/);
    assert.match(changed, /optimizer-2/);
    assert.equal(calculations, 1, 'unchanged records must not be rescanned');
    p.allRecords = [...p.allRecords]; p.renderContentData('claude');
    assert.equal(calculations, 2);
    now += 60_000; p.renderContentData('claude');
    assert.equal(calculations, 3, 'the calendar week/day scope must update at midnight');
    I18n.setTimezone('America/New_York'); p.renderContentData('claude');
    assert.equal(calculations, 4);
    assert.ok(p.dataPanelCache.size <= 1, 'one attribution entry, not a history of records');
    p.clearClaudeSource();
    assert.equal(p.dataPanelCache.size, 0, 'revocation releases attribution references');
  } finally {
    (ClaudeDataLoader as any).getUsageAttribution = original;
    Date.now = originalNow;
    I18n.setTimezone(timezone);
  }
});

test('Today attribution survives minute ticks but expires with its day, timezone, inputs and pricing', () => {
  const p = provider();
  p.panel = undefined;
  const originalAttribution = ClaudeDataLoader.getUsageAttribution;
  const timezone = I18n.getTimezone();
  const backend = getPricingBackend();
  let now = Date.parse('2026-09-30T23:57:20Z');
  let restoreClock = freezeClock(now);
  const advance = () => { restoreClock(); now += 60_000; restoreClock = freezeClock(now); };
  I18n.setTimezone('UTC');
  p.allRecords = [{ timestamp: new Date(now).toISOString(), _workflowId: 'synthetic-workflow',
    message: { model: 'claude-opus-5-5', usage: { input_tokens: 200, output_tokens: 20 } } }];
  let calculations = 0;
  (ClaudeDataLoader as any).getUsageAttribution = (...args: Parameters<typeof originalAttribution>) => {
    calculations++;
    return originalAttribution.call(ClaudeDataLoader, ...args);
  };
  try {
    const first = p.renderTodayInsights();
    assert.ok(first.length > 0, 'the fixture must render real usage characteristics');
    advance(); assert.equal(p.renderTodayInsights(), first);
    advance(); assert.equal(p.renderTodayInsights(), first);
    assert.equal(calculations, 1, 'minute ticks must not traverse unchanged records');
    advance();
    assert.equal(p.renderTodayInsights(), '', 'configured midnight excludes the previous day');
    assert.equal(calculations, 2);
    I18n.setTimezone('America/New_York');
    assert.equal(p.renderTodayInsights(), first, 'a timezone change restores the matching civil day');
    assert.equal(calculations, 3);
    p.allRecords = [...p.allRecords]; p.renderTodayInsights();
    assert.equal(calculations, 4, 'new record identity invalidates attribution');
    p.contentAnalysis = { skillUses: [] }; p.renderTodayInsights();
    assert.equal(calculations, 5, 'new analysis identity invalidates attribution');
    setPricingBackend(backend === 'anthropic' ? 'aws-bedrock-in-region' : 'anthropic');
    p.renderTodayInsights();
    assert.equal(calculations, 6, 'pricing must never leave stale cost-weighted shares');
    p.invalidateShareCardPreview(); p.renderTodayInsights();
    assert.equal(calculations, 7, 'explicit price/display invalidation releases the cached result');
    assert.equal(p.todayAttributionCache.records, p.allRecords, 'only one current source is retained');
    p.clearClaudeSource();
    assert.equal(p.todayAttributionCache, undefined, 'source revocation releases old references');
    assert.equal(p.renderTodayInsights(), '');
    assert.equal(calculations, 7, 'empty and Codex views do not scan Claude records');
    assert.equal(p.renderTodayInsights('codex'), '');
    p.allRecords = [{ timestamp: new Date(now).toISOString(), _workflowId: 'synthetic-replacement',
      message: { model: 'claude-opus-5-5', usage: { input_tokens: 20, output_tokens: 2 } } }];
    p.renderTodayInsights();
    assert.ok(p.todayAttributionCache);
    p.dispose();
    assert.equal(p.todayAttributionCache, undefined, 'disposal releases the single cached attribution');
  } finally {
    (ClaudeDataLoader as any).getUsageAttribution = originalAttribution;
    restoreClock(); I18n.setTimezone(timezone); setPricingBackend(backend);
  }
});

test('production coordinator minute-spaced polls preserve accepted previews without rescanning unchanged attribution', async (t) => {
  const p = provider();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-production-preview-'));
  let now = Date.parse('2026-09-30T12:00:20Z');
  let restoreClock = freezeClock(now);
  t.after(() => { restoreClock(); fs.rmSync(root, { recursive: true, force: true }); });
  const project = path.join(root, 'projects', '-fixture');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant',
    timestamp: new Date(now).toISOString(), requestId: 'preview', message: { id: 'preview',
      model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } }) + '\n');
  const e = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  Object.assign(e, {
    configurationGeneration: 0, disposed: false, quotaColdRetryDone: true,
    settings: { get: () => false }, refreshGate: new RefreshSingleFlight(),
    providerRefreshStates: { claude: { failed: false }, codex: { failed: false } }, deliveredRefreshStates: {},
    cache: { records: [], contentAnalysis: null, manifest: null, claudeIndex: createClaudeUsageIndex(),
      lastUpdate: new Date(0), dataDirectory: null, usageLimits: null },
    webviewProvider: p, outputChannel: { appendLine: () => undefined },
    statusBar: { updateContext() {}, updateUsageData() {}, updateQuota() {}, setProvider() {}, setLoading() {} },
    getConfiguration: () => ({ dataDirectory: root, dashboardAutoRefresh: true, statusBarProvider: 'claude',
      enableContentAnalysis: true, advicePromptWindowDays: 30, projectGroupingMode: 'flat', contextWindowOverride: 0 }),
    maybeFetchUsageLimits: async () => null, refreshCodexData: async () => undefined,
  });
  await e.refreshData(true, 'manual');
  const cfg = { range: 'last30', scope: 'all', sections: { projectName: false } };
  await handler({ command: 'buildShareCard', ...cfg });
  const preview = posted.find((m) => m.command === 'shareCardResult')!;
  assert.ok(preview.previewId);
  const methods = ['renderTodayData', 'renderMonthData', 'renderAllTimeData',
    'renderSessionData', 'renderProjectData', 'renderBranchData', 'renderWorkflowData', 'buildShareCardSvgFor'];
  let renders = 0, todayRenders = 0;
  for (const name of methods) {
    const original = p[name];
    p[name] = function (...args: unknown[]) {
      if (name === 'renderTodayData') todayRenders++; else renders++;
      return original.apply(this, args);
    };
  }
  p.updateWebview(); // Prime the default presentation after the explicit preview.
  const originalAttribution = ClaudeDataLoader.getUsageAttribution;
  let attributionCalculations = 0;
  const attributionScopes: string[] = [];
  (ClaudeDataLoader as any).getUsageAttribution = (...args: Parameters<typeof originalAttribution>) => {
    attributionCalculations++;
    attributionScopes.push(args[2].kind);
    return originalAttribution.call(ClaudeDataLoader, ...args);
  };
  t.after(() => { (ClaudeDataLoader as any).getUsageAttribution = originalAttribution; });
  renders = 0; todayRenders = 0;
  posted.length = 0;
  for (const trigger of ['poll', 'poll', 'poll', 'focus'] as const) {
    restoreClock(); now += 60_000; restoreClock = freezeClock(now);
    await e.refreshData(false, trigger);
  }
  assert.equal(renders, 0, 'no hidden history panel or artifact rebuild');
  assert.ok(todayRenders >= 4, 'Today countdowns still expire each minute');
  assert.equal(attributionCalculations, 0, 'default content analysis must not scan records on minute-spaced polls');
  assert.equal(posted.filter((m) => m.command === 'dashboardDataPatch').length, 0);
  assert.equal(p.shareCardPreviewCache.previewId, preview.previewId);
  restoreClock(); now = Date.parse('2026-09-30T12:59:20Z'); restoreClock = freezeClock(now);
  await e.refreshData(false, 'poll');
  renders = 0; todayRenders = 0; attributionCalculations = 0; attributionScopes.length = 0;
  for (let minute = 0; minute < 2; minute++) {
    restoreClock(); now += 60_000; restoreClock = freezeClock(now);
    await e.refreshData(false, 'poll');
    assert.equal(attributionCalculations, 1, 'hourly Content expiration runs once, not on every minute');
    assert.deepEqual(attributionScopes, ['week'], 'Today attribution survives the hour boundary');
    assert.equal(renders, 6, 'only the first poll after the hour rebuilds hidden history');
    assert.equal(p.shareCardPreviewCache.previewId, preview.previewId);
  }
  assert.equal(posted.filter((m) => m.command === 'dashboardDataPatch').length, 0);
  await handler({ command: 'exportShareCard', previewId: preview.previewId, ...cfg });
  assert.deepEqual(writes, [preview.svg], 'the accepted artifact remains exportable after unchanged polls');
});

test('Claude source revocation clears previews and source-owned data without clearing Codex', async () => {
  const p = provider();
  p.panel = undefined;
  const codexView = { limits: [] };
  p.codexView = codexView;
  p.usageLimits = { seven_day: { utilization: 20 } };
  p.claudeWeeklyQuotaHistory = [{ observedAt: 1 }];
  p.weeklyUsageCache = { records: p.allRecords };
  p.shareCardPreviewCache = { previewId: 'retired', svg: '<svg>retired</svg>' };
  p.preparedOptimizerRequests.set('retired', {});
  p.todayData = { totalInputTokens: 100 };
  p.sessionBreakdown = [{}];
  p.projectBreakdown = [{}];
  p.contentAnalysis = {};
  p.clearClaudeSource();
  assert.equal(p.codexView, codexView);
  assert.equal(p.todayData, null);
  assert.deepEqual(p.allRecords, []);
  assert.deepEqual(p.sessionBreakdown, []);
  assert.deepEqual(p.projectBreakdown, []);
  assert.equal(p.contentAnalysis, null);
  assert.equal(p.usageLimits, null);
  assert.deepEqual(p.claudeWeeklyQuotaHistory, []);
  assert.equal(p.weeklyUsageCache, undefined);
  assert.equal(p.shareCardPreviewCache, undefined);
  assert.equal(p.preparedOptimizerRequests.size, 0);
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

test('steady Codex refresh loading without backfill does not recalculate hidden verified panels', () => {
  const p = provider();
  p.codexView = { limits: [] };
  let renders = 0;
  const render = () => p.cachedDataPanel('all', 'codex', () => String(++renders));
  render();
  p.codexLoading = true;
  render();
  p.codexLoading = false;
  render();
  assert.equal(renders, 1);
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
