import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import * as path from 'node:path';

const { freezeClock } = require(path.resolve(__dirname, '../../tests/ui/support/frozen-clock.cjs'));
let receive: (message: Record<string, unknown>) => Promise<void>;
let save: () => Promise<unknown>;
const messages: any[] = [], writes: string[] = [];
let dialogs = 0;
const vscode = {
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 }, ViewColumn: { One: 1 },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  env: { language: 'en', uriScheme: 'vscode', clipboard: { writeText: async () => undefined } },
  commands: { executeCommand: async () => undefined }, extensions: { getExtension: () => undefined },
  window: { activeColorTheme: { kind: 1 },
    createWebviewPanel: () => ({ visible: true, webview: { html: '',
      onDidReceiveMessage: (handler: typeof receive) => { receive = handler; return { dispose() {} }; },
      postMessage: async (message: unknown) => { messages.push(message); return true; } },
      reveal() {}, onDidDispose: () => ({ dispose() {} }) }),
    showSaveDialog: async () => { dialogs++; return save(); },
    showWarningMessage: async () => undefined, showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined },
  workspace: { workspaceFolders: [],
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback, update: async () => undefined }),
    fs: { writeFile: async (_uri: unknown, bytes: Uint8Array) => { writes.push(Buffer.from(bytes).toString('utf8')); } } },
};
const loader = (Module as any)._load;
(Module as any)._load = function(name: string, parent: unknown, main: boolean) {
  return name === 'vscode' ? vscode : loader.call(this, name, parent, main);
};
const { UsageWebviewProvider } = require('../webview');
const { I18n } = require('../i18n');
(Module as any)._load = loader;

async function owner(run: (host: any) => Promise<void>) {
  const restoreClock = freezeClock(Date.parse('2026-10-05T12:00:00Z'));
  const language = I18n.getLocale(), zone = I18n.getTimezone(), currency = I18n.getCurrencyDisplay().code;
  messages.length = 0; writes.length = 0; dialogs = 0;
  save = async () => ({ fsPath: '/synthetic/api-heatmap.svg' });
  try {
    I18n.setLanguage('en'); I18n.setTimezone('UTC'); I18n.setCurrencyDisplay('USD');
    const host = new UsageWebviewProvider({ globalState: { get: () => undefined, update: async () => undefined } });
    host.show(); host.webviewClientReady = true;
    // Protocol/renderer owner test, not a second full Codex dashboard fixture.
    // Settle constructor-ledger callbacks without repainting partial view data.
    host.updateWebview = () => undefined;
    host.settings = { get: (key: string) => key === 'enableShareCard' };
    host.providerAvailability = { claude: true, codex: true, codexData: true };
    host.dailyDataForEveryDay = [{ date: '2026-10-05', data: {
      totalInputTokens: 100, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheCreationTokens: 0,
      totalCost: 17, messageCount: 1, modelBreakdown: { 'claude-opus-5-5': {
        inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cost: 17, count: 1 } },
    } }];
    host.achievementCalendarTimeZone = 'UTC';
    host.codexView = { daily: [{ day: '2026-10-05', total: { processed: 200 },
      apiEquivalent: { equivalentUsd: 27, totalTokens: 200, pricedTokens: 200 } }],
      periodCoverage: { timeZone: 'UTC' } };
    host.allRecords = new Proxy([], { get(_target, property) { throw new Error('No source corpus access: ' + String(property)); } });
    await run(host);
  } finally { restoreClock(); I18n.setLanguage(language); I18n.setTimezone(zone); I18n.setCurrencyDisplay(currency); }
}
const config = { range: '30d', title: 'Resource history', palette: 'custom', customAccent: '#0f766e',
  intensityMode: 'linear', provider: 'both', metric: 'apiEquivalent', showAmounts: true };
async function preview(host: any, requestId = 1, options: any = config) {
  await receive({ command: 'previewCombinedHeatmap', ...options, requestId, documentId: host.dashboardDocumentId });
  const results = messages.filter(row => row.command === 'combinedHeatmapResult');
  const result = results[results.length-1];
  assert.ok(result); assert.equal(result.requestId, requestId);
  assert.match(result.previewId, /^[a-f0-9]{48}$/); assert.equal(result.documentId, host.dashboardDocumentId);
  return result;
}

test('API heatmap host renders three providers and both dimensions from daily aggregates only', async () => {
  await owner(async host => {
    for (const provider of ['claude','codex','both']) for (const metric of ['tokens','apiEquivalent']) {
      const result = host.buildCombinedHeatmapArtifact('30d','Resource history','custom','#0f766e','linear',provider,metric,metric==='apiEquivalent');
      assert.equal(result.config.provider, provider); assert.equal(result.config.metric, metric);
      assert.equal(result.hasData, true);
      if (metric==='apiEquivalent') {
        assert.match(result.svg, /API equivalent/);
        assert.equal(result.svg.includes('$17.00'), provider!=='codex');
        assert.equal(result.svg.includes('$27.00'), provider!=='claude');
        assert.doesNotMatch(result.svg, /\$44/);
      } else assert.doesNotMatch(result.svg, /\$17|\$27|Current pricing|Priced subtotal/);
    }
  });
});

test('API heatmap export requires the exact accepted preview and writes identical bytes without rebuilding', async () => {
  await owner(async host => {
    await receive({command:'exportCombinedHeatmap',...config,documentId:host.dashboardDocumentId});
    assert.equal(dialogs,0);
    const accepted = await preview(host);
    host.buildCombinedHeatmapArtifact = () => assert.fail('export must not rebuild accepted SVG');
    await receive({command:'exportCombinedHeatmap',...config,previewId:accepted.previewId,documentId:host.dashboardDocumentId});
    assert.equal(dialogs,1); assert.deepEqual(writes,[accepted.svg]);
  });
});

test('hiding money retires the old handle and token preview removes monetary colors and metadata', async () => {
  await owner(async host => {
    const money = await preview(host);
    await receive({command:'retireCombinedHeatmapPreview',requestId:2,documentId:host.dashboardDocumentId});
    await receive({command:'exportCombinedHeatmap',...config,previewId:money.previewId,documentId:host.dashboardDocumentId});
    assert.equal(dialogs,0);
    const hidden = await preview(host,3,{...config,metric:'tokens',showAmounts:false});
    assert.doesNotMatch(hidden.svg+' '+hidden.markdown,/\$17|\$27|API equivalent|Current pricing|Priced subtotal|Coverage/);
    await receive({command:'exportCombinedHeatmap',...config,previewId:hidden.previewId,documentId:host.dashboardDocumentId});
    assert.equal(dialogs,0,'a token preview cannot be reused for money disclosure');
  });
});

test('source or pricing retirement while the save dialog is open prevents stale amount export', async () => {
  await owner(async host => {
    const accepted = await preview(host);
    let choose!: (value: unknown) => void;
    save = () => new Promise(resolve => { choose = resolve; });
    const pending = receive({command:'exportCombinedHeatmap',...config,previewId:accepted.previewId,documentId:host.dashboardDocumentId});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(dialogs,1);
    host.invalidateShareCardPreview();
    choose({fsPath:'/synthetic/api-heatmap.svg'}); await pending;
    assert.deepEqual(writes,[]);
  });
});

test('a new monetary preview waits for accepted repriced daily data while Token mode stays available', async () => {
  await owner(async host => {
    await preview(host);
    host.invalidateShareCardPreview({pricingChanged:true});
    await receive({command:'previewCombinedHeatmap',...config,requestId:2,documentId:host.dashboardDocumentId});
    const reply=messages.filter(row=>row.command==='combinedHeatmapResult').pop();
    assert.equal(reply.failed,true); assert.equal(reply.previewId,undefined);
    const tokens=host.buildCombinedHeatmapArtifact('30d','Resource history','custom','#0f766e','linear','both','tokens',false);
    assert.equal(tokens.config.metric,'tokens'); assert.doesNotMatch(tokens.svg,/\$17|\$27/);
  });
});
