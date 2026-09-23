import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

import { SharingCommandIntentLedger } from '../sharingCommandIntent';

test('consumed sharing command intent stays one-shot while revision history remains monotonic', () => {
  const ledger = new SharingCommandIntentLedger();

  const first = ledger.issue('claudeHeatmap');
  assert.deepEqual(first, { revision: 1, template: 'claudeHeatmap' });
  assert.deepEqual(ledger.pending(), first);
  assert.equal(ledger.acknowledge(0), false, 'a stale ACK cannot consume live intent');
  assert.deepEqual(ledger.pending(), first);

  assert.equal(ledger.acknowledge(first.revision), true);
  assert.equal(ledger.pending(), undefined, 'ordinary rerenders have no consumed intent to replay');
  assert.equal(ledger.acknowledge(first.revision), false, 'consumption is idempotent');

  ledger.clearPending();
  assert.equal(ledger.pending(), undefined, 'reset and dispose/reopen keep consumed intent absent');
  assert.equal(ledger.latestRevision(), 1, 'reset must not reuse an old command revision');

  const second = ledger.issue('claudeShareCard');
  assert.deepEqual(second, { revision: 2, template: 'claudeShareCard' });
  ledger.clearPending();
  assert.equal(ledger.pending(), undefined);
  assert.equal(ledger.latestRevision(), 2);

  assert.deepEqual(ledger.issue('claudeHeatmap'), {
    revision: 3,
    template: 'claudeHeatmap',
  });
});

test('a delayed ACK cannot consume a newer sharing command', () => {
  const ledger = new SharingCommandIntentLedger();
  const first = ledger.issue('claudeHeatmap');
  const second = ledger.issue('claudeShareCard');

  assert.equal(ledger.acknowledge(first.revision), false);
  assert.deepEqual(ledger.pending(), second);
  assert.equal(ledger.acknowledge(second.revision), true);
  assert.equal(ledger.pending(), undefined);
});

test('the provider consumes an acknowledged command across rerender, reset, and panel reopen', async () => {
  const originalLoad = (Module as any)._load;
  let messageHandler: ((message: Record<string, unknown>) => Promise<void>) | undefined;
  let disposeHandler: (() => void) | undefined;
  const panels: Array<{ webview: { html: string } }> = [];
  const vscode = {
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    ViewColumn: { One: 1 },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    env: { language: 'en', uriScheme: 'vscode' },
    commands: { executeCommand: async () => undefined },
    extensions: { getExtension: () => undefined },
    window: {
      activeColorTheme: { kind: 1 },
      createWebviewPanel: () => {
        const webview = {
          html: '',
          onDidReceiveMessage: (handler: typeof messageHandler) => {
            messageHandler = handler;
            return { dispose: () => undefined };
          },
          postMessage: async () => true,
        };
        const panel = {
          webview,
          reveal: () => undefined,
          onDidDispose: (handler: () => void) => {
            disposeHandler = handler;
            return { dispose: () => undefined };
          },
        };
        panels.push(panel);
        return panel;
      },
      showWarningMessage: async () => undefined,
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
      fs: {},
    },
  };
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
    const provider = new UsageWebviewProvider({
      globalState: { get: () => undefined, update: async () => undefined },
    } as any) as any;
    provider.allRecords = [{ timestamp: '2026-09-01T00:00:00.000Z' }];

    provider.showSharingWorkspace('claudeHeatmap');
    assert.match(panels[panels.length - 1].webview.html, /__sharingTemplateCommand = \{"revision":1,"template":"claudeHeatmap"\}/);
    assert.ok(messageHandler);
    await messageHandler!({ command: 'sharingTemplateCommandAck', revision: 1 });

    provider.updateWebview();
    assert.match(panels[panels.length - 1].webview.html, /__sharingTemplateCommand = null/);
    provider.clearSharingRuntimeState();
    provider.updateWebview();
    assert.match(panels[panels.length - 1].webview.html, /__sharingTemplateCommand = null/);

    assert.ok(disposeHandler);
    disposeHandler!();
    provider.show();
    assert.equal(panels.length, 2);
    assert.match(panels[panels.length - 1].webview.html, /__sharingTemplateCommand = null/);

    provider.showSharingWorkspace('claudeShareCard');
    assert.match(panels[panels.length - 1].webview.html, /__sharingTemplateCommand = \{"revision":2,"template":"claudeShareCard"\}/);
  } finally {
    (Module as any)._load = originalLoad;
  }
});
