import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

import { I18n } from '../i18n';
import { buildCodexUsageView } from '../providers/codex/codexUsage';
import { CODEX_WEBVIEW_NOW, codexWebviewFixture } from './codexWebviewFixtures';

/** Synthetic aggregates only: no transcript, server, or real VS Code host. */
async function withCompareProvider(
  run: (provider: any, values: Map<string, unknown>) => Promise<void>,
): Promise<void> {
  const originalLoad = (Module as any)._load;
  const language = I18n.getCurrentLanguage();
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return {
      ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
      window: { activeColorTheme: { kind: 1 } },
      workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => undefined }) },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  let provider: any;
  try {
    const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
    const { SETTINGS } = require('../settings') as typeof import('../settings');
    const state = new Map<string, unknown>([
      ['ccu.achievements.grants.v5', ['sonnet-main']],
      ['ccu.achievements.structuralAudit.v1', true],
    ]);
    provider = new UsageWebviewProvider({ globalState: {
      get: (key: string) => state.get(key),
      update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key); else state.set(key, value);
      },
    } } as any) as any;
    await new Promise<void>((resolve) => setImmediate(resolve));
    I18n.setLanguage('en');
    const values = new Map<string, unknown>(SETTINGS.map((entry) => [entry.key, entry.default]));
    values.set('showWeeklyEquivalentValue', false);
    values.set('dashboardAutoRefresh', true);
    provider.settings = { get: (key: string) => values.get(key) };
    provider.currentProvider = 'compare';
    provider.currentTab = 'all';
    provider.sharingTemplate = 'achievements';
    provider.achievementShareSelection = ['sonnet-main'];
    provider.providerAvailability = { claude: true, codex: true, codexData: true };
    provider.codexView = buildCodexUsageView(codexWebviewFixture(), CODEX_WEBVIEW_NOW);
    provider.allTimeData = {
      totalInputTokens: 100, totalOutputTokens: 20,
      totalCacheCreationTokens: 30, totalCacheReadTokens: 50,
      totalCost: 1, costBreakdown: { input: 0.1, output: 0.2, cacheWrite: 0.3, cacheRead: 0.4 },
      messageCount: 1, modelBreakdown: {},
    };
    await run(provider, values);
  } finally {
    if (provider) {
      provider.panel = undefined;
      await Promise.all([
        provider.achievementWrite, provider.achievementActivityWrite, provider.achievementHourWrite,
      ].map((write) => Promise.resolve(write).catch(() => undefined)));
    }
    I18n.setLanguage(language);
    (Module as any)._load = originalLoad;
  }
}

function attachWebview(provider: any) {
  const documents: string[] = [];
  const messages: any[] = [];
  const webview = {
    get html() { return documents[documents.length - 1] ?? ''; },
    set html(value: string) { documents.push(value); },
    postMessage: async (message: unknown) => { messages.push(message); return true; },
  };
  provider.panel = { visible: true, webview };
  return { documents, messages };
}

test('Compare sharing renders a script-free live panel with a stable data-patch structure', async () => {
  await withCompareProvider(async (provider) => {
    const firstHtml = provider.getWebviewContent();
    assert.equal(firstHtml.includes('<!-- ccu-live-panel:start -->'), true,
      'Compare must mark its replaceable provider-panel data');
    const first = provider.dashboardLivePatchFor(firstHtml);
    assert.ok(first, 'Compare needs the same patch descriptor as the provider dashboards');
    assert.equal(first.provider, 'compare');
    assert.equal(first.tab, 'all');
    assert.match(first.panelHtml, /id="achievementSharePreview"/);
    assert.doesNotMatch(first.panelHtml, /<script(?:\s|>)/i);
    provider.allTimeData = { ...provider.allTimeData, totalInputTokens: 101 };
    const next = provider.dashboardLivePatchFor(provider.getWebviewContent());
    assert.ok(next);
    assert.notEqual(next.panelHtml, first.panelHtml, 'the changed aggregate must reach the panel');
    assert.equal(next.structureKey, first.structureKey,
      'data-only Compare changes must not invalidate the document shell');
    provider.currentTab = 'today';
    assert.equal(provider.dashboardLivePatchFor(provider.getWebviewContent()).tab, 'all',
      'Compare has one aggregate panel even when navigation retains a provider tab');
  });
});

test('a ready Compare client receives an aggregate patch without a full document reload or share action', async () => {
  await withCompareProvider(async (provider) => {
    const { documents, messages } = attachWebview(provider);
    provider.updateWebview();
    assert.equal(documents.length, 1);
    provider.webviewClientReady = true;
    provider.updateWebview();
    assert.equal(documents.length, 1, 'unchanged Compare data is already a no-op');
    assert.equal(messages.length, 0);

    provider.allTimeData = { ...provider.allTimeData, totalInputTokens: 101 };
    provider.updateWebview();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(documents.length, 1,
      'ordinary Compare data refresh must not assign webview.html again');
    const patches = messages.filter((message) => message.command === 'dashboardDataPatch');
    assert.equal(patches.length, 1);
    assert.equal(patches[0].provider, 'compare');
    assert.equal(patches[0].tab, 'all');
    assert.match(patches[0].html, /<strong>101<\/strong>/);
    assert.doesNotMatch(patches[0].html, /<script(?:\s|>)/i);
    assert.equal(provider.webviewClientReady, true);
    assert.equal(provider.sharingTemplate, 'achievements');
    assert.deepEqual(provider.achievementShareSelection, ['sonnet-main']);
    assert.deepEqual(provider.achievementActivity.features, [], 'rendering is not a preview/export action');
  });
});

test('Compare still replaces the document when a setting changes its outer shell', async () => {
  await withCompareProvider(async (provider, values) => {
    const { documents, messages } = attachWebview(provider);
    provider.updateWebview();
    provider.webviewClientReady = true;
    values.set('dashboardAutoRefresh', false);
    provider.updateWebview();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(documents.length, 2, 'a changed shell is not a safe panel-only patch');
    assert.equal(provider.webviewClientReady, false);
    assert.equal(messages.some((message) => message.command === 'dashboardDataPatch'), false);
    assert.match(documents[1], /<body class="auto-off">/);
  });
});
