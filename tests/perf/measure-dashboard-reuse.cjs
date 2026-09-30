'use strict';

// Synthetic renderer benchmark only: no provider logs, UI, network or credentials.
// Compile first: npm run compile && node tests/perf/measure-dashboard-reuse.cjs
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { renderHarness } = require('../ui/support/render-harness.cjs');
const { UsageWebviewProvider } = require('../../out/webview.js');
const { CODEX_WEBVIEW_NOW } = require('../../out/test/codexWebviewFixtures.js');
const prototype = UsageWebviewProvider.prototype;
const originalUpdate = prototype.updateData;
const originalNow = Date.now;
const methods = ['renderTodayData', 'renderMonthData', 'renderAllTimeData',
  'renderSessionData', 'renderProjectData', 'renderBranchData', 'renderWorkflowData'];
const originalMethods = new Map(methods.map((name) => [name, prototype[name]]));
const calls = Object.fromEntries(methods.map((name) => [name, 0]));
let provider;
const records = Array.from({ length: 50_000 }, (_, i) => ({
  type: 'assistant', timestamp: new Date(CODEX_WEBVIEW_NOW - i * 60_000).toISOString(),
  _sessionId: 'synthetic-session-' + i % 100, requestId: 'synthetic-request-' + i,
  message: { id: 'synthetic-message-' + i, model: 'claude-opus-5-5',
    usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 400 } },
}));
prototype.updateData = function (...args) {
  args[9] = records;
  provider = this;
  return originalUpdate.apply(this, args);
};
for (const [name, original] of originalMethods) {
  prototype[name] = function (...args) { calls[name]++; return original.apply(this, args); };
}
function measured(fn) {
  const start = performance.now();
  const html = fn();
  return { ms: +(performance.now() - start).toFixed(2), bytes: Buffer.byteLength(html) };
}

(async () => {
  try {
    await renderHarness({ provider: 'claude', autoRefresh: false });
    Date.now = () => CODEX_WEBVIEW_NOW;
    provider.dataPanelCache.clear();
    provider.weeklyUsageCache = undefined;
    for (const name of methods) calls[name] = 0;
    const cold = measured(() => provider.getMainContent());
    const coldCalls = { ...calls };
    const warm = Array.from({ length: 10 }, () => measured(() => provider.getMainContent()));
    assert.deepEqual(calls, coldCalls, 'unchanged data panels must not render again');
    const initialWeeklyCache = provider.weeklyUsageCache;
    Date.now = () => CODEX_WEBVIEW_NOW + 60_000;
    const minute = measured(() => provider.getMainContent());
    assert.equal(calls.renderAllTimeData, coldCalls.renderAllTimeData);
    Date.now = () => CODEX_WEBVIEW_NOW + 3_600_000;
    const nextHour = measured(() => provider.getMainContent());
    assert.equal(provider.weeklyUsageCache, initialWeeklyCache,
      'time rollover must reuse unchanged record-derived weekly input');
    assert.equal(calls.renderAllTimeData, coldCalls.renderAllTimeData + 1);
    const medianMs = warm.map((row) => row.ms).sort((a, b) => a - b)[5];
    process.stdout.write(JSON.stringify({
      kind: 'synthetic-host-renderer-not-installed-VSIX-or-native-scroll-FPS',
      records: records.length, cold, warmMedianMs: medianMs, warm, minute, nextHour,
      dataPanelCalls: calls, cacheEntries: provider.dataPanelCache.size,
      peakSampledRssBytes: process.memoryUsage().rss,
    }, null, 2) + '\n');
  } finally {
    Date.now = originalNow;
    prototype.updateData = originalUpdate;
    for (const [name, original] of originalMethods) prototype[name] = original;
  }
})().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
