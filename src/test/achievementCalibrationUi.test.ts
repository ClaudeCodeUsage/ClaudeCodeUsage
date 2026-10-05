import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

async function makeProvider(values: Map<string, unknown>, fail?: (key: string, value: unknown) => boolean): Promise<any> {
  const load = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] } } : load.call(this, request, parent, main);
  };
  try {
    const { UsageWebviewProvider } = require('../webview');
    const provider = new UsageWebviewProvider({ globalState: {
      get: (key: string) => values.get(key), update: async (key: string, value: unknown) => {
        if (fail?.(key, value)) throw new Error('fixture persistence failure');
        if (value === undefined) values.delete(key); else values.set(key, value);
      },
    } }) as any;
    await provider.achievementWrite.catch(() => undefined);
    return provider;
  } finally { (Module as any)._load = load; }
}
const marker = 'ccu.achievements.calibrationAudit.v1';
function state(): Map<string, unknown> {
  return new Map<string, unknown>([
    ...['structural', 'token', 'bucket', 'manifest', 'calendar'].map(name =>
      [`ccu.achievements.${name}Audit.v1`, true] as [string, unknown]),
    ['ccu.achievements.grants.v5', ['sol-regular-gold', 'local-share-export', 'hundred-million-club']],
  ]);
}

test('calibration remaps proven floors once and resumes safely after each persistence boundary fails', async () => {
  for (const failedKey of ['ccu.achievements.calibrationPending.v1', 'ccu.achievements.grants.v5', marker]) {
    const values = state(); let failed = false;
    await makeProvider(values, (key, value) => {
      if (!failed && key === failedKey && value !== undefined) { failed = true; return true; }
      return false;
    });
    assert.equal(failed, true, `exercises ${failedKey}`);
    assert.notEqual(values.get(marker), true, 'failed migration cannot claim completion');
    const resumed = await makeProvider(values);
    assert.equal(resumed.achievementGrants.has('sol-regular-silver'), true,
      'old gold proves 10B, even if grants saved before a failed completion marker');
    assert.equal(resumed.achievementGrants.has('sol-regular-gold'), false, 'old 10B cannot prove new 100B');
    assert.equal(resumed.achievementGrants.has('local-share-export'), true);
    assert.equal(values.get(marker), true);
    assert.equal(values.has('ccu.achievements.calibrationPending.v1'), false);
    const again = await makeProvider(values);
    assert.deepEqual([...again.achievementGrants].sort(), [...resumed.achievementGrants].sort());
    await again.clearAchievementGrants();
    assert.equal(values.has(marker), false);
    assert.equal(values.has('ccu.achievements.calibrationPending.v1'), false);
  }
});

test('recalibration reproof is quiet and cannot discard unrelated local-action history', async () => {
  const values = state(); const provider = await makeProvider(values); const notices: unknown[] = [];
  provider.panel = { visible: true, webview: { postMessage: async (message: unknown) => { notices.push(message); return true; } } };
  provider.webviewClientReady = true;
  provider.allTimeData = { totalInputTokens: 100_000_000, totalOutputTokens: 0,
    totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
    modelBreakdown: { 'claude-sonnet-5': { inputTokens: 100_000_000, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0 } } };
  provider.achievementResults(); await provider.achievementWrite;
  assert.equal(provider.achievementGrants.has('sonnet-main'), true);
  assert.equal(provider.achievementGrants.has('local-share-export'), true);
  assert.deepEqual(notices, [], 'a changed threshold must not announce a backlog on upgrade');
});
