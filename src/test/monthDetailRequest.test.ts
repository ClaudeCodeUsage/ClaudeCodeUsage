import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

test('Claude month drill-down accepts the production first-day key and replies to that exact row', async () => {
  const originalLoad = (Module as any)._load;
  let onMessage: ((message: Record<string, unknown>) => Promise<void>) | undefined;
  const replies: Array<Record<string, unknown>> = [];
  const vscode = {
    ViewColumn: { One: 1 },
    window: {
      createWebviewPanel: () => ({
        webview: {
          onDidReceiveMessage: (handler: typeof onMessage) => { onMessage = handler; },
          postMessage: async (message: Record<string, unknown>) => { replies.push(message); return true; },
        },
        onDidDispose: () => undefined,
      }),
    },
    workspace: { workspaceFolders: [] },
  };
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
    const provider = new UsageWebviewProvider({} as any) as any;
    provider.currentProvider = 'claude';
    provider.allRecords = new Proxy([], {
      get() { throw new Error('month drill-down must not inspect raw records'); },
    });
    provider.dailyDataForEveryDay = [
      { date: '2026-06-30', data: { marker: 'june' } },
      { date: '2026-07-02', data: { marker: 'second' } },
      { date: '2026-07-01', data: { marker: 'first' } },
      { date: '2026-08-01', data: { marker: 'august' } },
    ];
    provider.updateWebview = () => undefined;
    provider.show();
    assert.ok(onMessage);

    await onMessage!({ command: 'getDailyData', month: '2026-07-01', provider: 'claude' });
    assert.deepEqual(replies, [{
      command: 'dailyDataResponse',
      provider: 'claude',
      month: '2026-07-01',
      data: [
        { date: '2026-07-01', data: { marker: 'first' } },
        { date: '2026-07-02', data: { marker: 'second' } },
      ],
    }]);

    await onMessage!({ command: 'getDailyData', month: '2026-07-02', provider: 'claude' });
    assert.equal(replies.length, 1, 'only first-of-month keys are accepted');
    provider.currentProvider = 'codex';
    await onMessage!({ command: 'getDailyData', month: '2026-07-01', provider: 'codex' });
    assert.equal(replies.length, 1, 'Codex still requires its YYYY-MM key');
  } finally {
    (Module as any)._load = originalLoad;
  }
});
