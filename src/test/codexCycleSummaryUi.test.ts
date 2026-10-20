import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import { codexQuotaPresentation } from '../codexQuotaPresentation';
const loader = require('node:module'), load = loader._load;
loader._load = function(name: string, ...args: unknown[]) { return name === 'vscode' ? {} : load.call(this, name, ...args); };
let Provider: typeof import('../webview').UsageWebviewProvider;
try { Provider = require('../webview').UsageWebviewProvider; } finally { loader._load = load; }
const N = Date.parse('2026-10-20T03:22Z'), R = N + 6 * 86_400_000;
function entry(extra: any = {}): any {
  return { provider: 'codex', method: 'account-delta-v1', accountNumber: 1, windowStart: R - 604800000,
    resetAt: R, observedAt: N - 60000, estimatedAt: N, usedEquivalentUsd: 20, fullEquivalentUsd: 100,
    unusedEquivalentUsd: 60, utilizationPercent: 40, pricingCoverage: 1, flags: [],
    quotaEpoch: { startedAt: N - 120000, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
    quotaCycle: { id: N - 120000, startAt: null, startLowerAt: null, endAt: R, endLowerAt: R,
      closed: false, scheduledResetAt: R, boundaryUncertain: true }, ...extra };
}
function owner(entries: any[]): any {
  const p: any = Object.create(Provider.prototype); p.setting = (_: string, fallback: unknown) => fallback;
  p.weeklyEstimateProjection = () => ({ entries, status: 'ready' }); p.weeklyValuePoints = () => [];
  p.codexView = { periodCoverage: { allTime: { complete: true } } }; return p;
}
function run(body: () => void) { const now = Date.now, language = I18n.getCurrentLanguage(); Date.now = () => N; I18n.setLanguage('zh-CN');
  try { body(); } finally { Date.now = now; I18n.setLanguage(language); } }
test('cycle table and chart use one identical summary per cycle, not failed observation rows', () => run(() => {
  const p = owner([entry(), entry({ fullEquivalentUsd: null, unusedEquivalentUsd: null, observedAt: N })]);
  const html = p.renderWeeklyValuePanel('codex');
  assert.equal((html.match(/data-codex-cycle-summary-row/g) ?? []).length, 1);
  assert.equal((html.match(/class="hc-xlabel"/g) ?? []).length, 1);
  assert.match(html, /周期明细/); assert.match(html, /校准证据/);
  assert.doesNotMatch(html, /本机七天用量|本機七天用量/);
}));
test('a pending new cycle has a missing-value marker, never a tiny or zero capacity bar', () => run(() => {
  const html = owner([entry({ fullEquivalentUsd: null, unusedEquivalentUsd: null })]).renderWeeklyValuePanel('codex');
  assert.match(html, /data-cycle-pending/); assert.match(html, /待校准/);
  assert.doesNotMatch(html, /class="stack-seg seg-cache-read"/);
}));
test('source conflict presentation is numeric-only and does not infer an account from a reset', () => {
  const local = [{ provider: 'codex' as const, seriesKey: 'codex', sourceKey: 'private-canary', observedAt: N,
    resetAt: R + 18 * 3600000, usedPercent: 16 }];
  const result = codexQuotaPresentation(local, { observedAt: N - 60000, resetAt: R, usedPercent: 100 }, N);
  assert.equal(result.conflict, true); assert.ok(!JSON.stringify(result).includes('private-canary'));
  assert.equal(codexQuotaPresentation(local, { observedAt: N - 60000, resetAt: R, usedPercent: 100 }, N + 1800000).conflict, true,
    'time passage makes observations stale but must not silently align contradictory sources');
  assert.equal(codexQuotaPresentation(local, { observedAt: N - 3600000, resetAt: R, usedPercent: 100 }, N).conflict, false);
});
test('same-stream observed reset stays distinct from account attribution and survives newer local samples', () => {
  const observations = [
    { provider: 'codex' as const, seriesKey: 'codex', sourceKey: 'private-stream', observedAt: N - 3600000, resetAt: R, usedPercent: 42 },
    { provider: 'codex' as const, seriesKey: 'codex', sourceKey: 'private-stream', observedAt: N - 3300000, resetAt: R + 18 * 3600000, usedPercent: 0 },
    { provider: 'codex' as const, seriesKey: 'codex', sourceKey: 'private-stream', observedAt: N, resetAt: R + 18 * 3600000, usedPercent: 5 },
  ];
  const presentation = codexQuotaPresentation(observations, { observedAt: N - 1800000, resetAt: R + 19 * 3600000, usedPercent: 0 }, N);
  assert.equal(presentation.change?.beforePercent, 42); assert.equal(presentation.change?.usedPercent, 0);
  assert.equal(presentation.change?.observedAt, N - 3300000);
  assert.equal(presentation.local?.usedPercent, 5);
  assert.ok(!JSON.stringify(presentation).includes('private-stream'));
});
test('the cycle panel exposes an observed window change without claiming a second official reset', () => run(() => {
  const p = owner([entry({ fullEquivalentUsd: null, unusedEquivalentUsd: null })]);
  p.codexView.weeklyValueInputs = { usage: [], observations: [
    { provider: 'codex', seriesKey: 'codex', sourceKey: 'private-stream', observedAt: N - 120000, resetAt: R, usedPercent: 42 },
    { provider: 'codex', seriesKey: 'codex', sourceKey: 'private-stream', observedAt: N - 60000, resetAt: R + 86400000, usedPercent: 0 },
  ] };
  const html = p.renderWeeklyValuePanel('codex');
  assert.match(html, /data-local-window-change/); assert.match(html, /42% → 0(?:\.0)?%/);
  assert.doesNotMatch(html, /private-stream/);
}));
test('an older cycle evidence disclosure keeps its key when a new cycle is inserted ahead of it', () => run(() => {
  const old = entry(), p = owner([old]);
  const before = p.renderWeeklyEstimateRecords('codex').match(/data-persist="(quota-evidence-[^"]+)"/)![1];
  const next = entry({ resetAt: R + 3600000, observedAt: N - 1,
    quotaEpoch: { ...old.quotaEpoch, startedAt: N - 30000, resetAnchorAt: R + 3600000 },
    quotaCycle: { ...old.quotaCycle, id: N - 30000, endAt: R + 3600000, scheduledResetAt: R + 3600000 } });
  const after = owner([old, next]).renderWeeklyEstimateRecords('codex');
  assert.ok(after.includes('data-persist="' + before + '"'));
}));
