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
function officialPanel(extra: any = {}): string {
  const p = owner([entry()]);
  p.setting = (key: string, fallback: unknown) => key === 'codex.officialQuota.enabled' ? true : fallback;
  p.weeklyEstimateProjection = () => ({ entries: [entry()], status: 'ready', activeAccountNumber: 1,
    officialQuota: { status: 'ready', accountNumber: 1, usedPercent: 0, resetAt: R, observedAt: N - 1000, ...extra } });
  return p.renderWeeklyValuePanel('codex');
}
test('official reset credits distinguish zero, one and unknown in all eight locales', () => run(() => {
  for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'] as const) {
    I18n.setLanguage(locale);
    for (const count of [0, 1, null, undefined, -1, NaN, Infinity, 1.5, '1']) {
      const html = officialPanel(count === undefined ? {} : { resetCreditCount: count });
      const header = html.match(/<p class="table-hint weekly-official-quota"[^>]*>(.*?)<\/p>/)![1];
      const copy = I18n.t.weeklyValue;
      assert.equal(typeof copy.resetCreditCount, 'string', locale);
      assert.ok(copy.resetCreditUnknown && copy.resetCreditNextExpiry && copy.ordinaryUsageBlocked, locale);
      const expected = count === 0 || count === 1
        ? new Intl.NumberFormat(I18n.getLocale()).format(count) : copy.resetCreditUnknown;
      assert.ok(header.includes(copy.resetCreditCount + ': ' + expected), locale + ': ' + count);
    }
  }
}));
test('Chinese credit count names available vouchers rather than historical reset events', () => run(() => {
  assert.equal(I18n.t.weeklyValue.resetCreditCount, '可用重置券');
  I18n.setLanguage('zh-TW'); assert.equal(I18n.t.weeklyValue.resetCreditCount, '可用重設券');
}));
test('official reset-credit expiry is explicitly the next known future expiry', () => run(() => {
  const copy = I18n.t.weeklyValue;
  assert.equal(typeof copy.resetCreditNextExpiry, 'string');
  const html = officialPanel({ resetCreditCount: 1, resetCreditNextExpiryAt: N + 60000 });
  assert.ok(html.includes(copy.resetCreditNextExpiry + ': '));
  for (const expiry of [null, undefined, -1, N - 1, N, NaN, Infinity, 8.64e15 + 1, '2026-10-21']) {
    assert.ok(!officialPanel({ resetCreditCount: 1, resetCreditNextExpiryAt: expiry }).includes(copy.resetCreditNextExpiry));
  }
}));
test('official credit and permission facts remain snapshot facts when stale', () => run(() => {
  const copy = I18n.t.weeklyValue;
  assert.equal(typeof copy.ordinaryUsageBlocked, 'string');
  const html = officialPanel({ stale: true, resetCreditCount: 1, resetCreditNextExpiryAt: N + 60000,
    ordinaryUsageAllowed: false });
  const header = html.match(/<p class="table-hint weekly-official-quota"[^>]*>(.*?)<\/p>/)![1];
  assert.ok(header.includes(copy.estimateStale));
  assert.ok(header.includes(copy.resetCreditCount + ': 1'));
  assert.ok(header.includes(copy.ordinaryUsageBlocked), '0% used does not override an explicit blocked state');
  assert.ok(!header.includes(copy.collectingSamples));
  for (const allowed of [null, undefined, true, 0, 'false']) {
    assert.ok(!officialPanel({ ordinaryUsageAllowed: allowed }).includes(copy.ordinaryUsageBlocked));
  }
}));
test('official credit rendering reads only public numeric facts and preserves compact cycle structure', () => run(() => {
  const facts: any = { resetCreditCount: 1, resetCreditNextExpiryAt: N + 60000, ordinaryUsageAllowed: false };
  for (const key of ['creditKey', 'hmac', 'resetCredits', 'accountId', 'sourceKey']) {
    Object.defineProperty(facts, key, { enumerable: true, get() { throw new Error('sensitive field read: ' + key); } });
  }
  const p = owner([entry()]);
  p.setting = (key: string, fallback: unknown) => key === 'codex.officialQuota.enabled' ? true : fallback;
  const quota = Object.assign(Object.create(facts), { status: 'ready', accountNumber: 1, usedPercent: 0,
    resetAt: R, observedAt: N - 1000 });
  p.weeklyEstimateProjection = () => ({ entries: [entry()], status: 'ready', officialQuota: quota });
  const html = p.renderWeeklyValuePanel('codex');
  assert.doesNotMatch(html, /creditKey|hmac|resetCredits|accountId|sourceKey/);
  assert.equal((html.match(/data-codex-cycle-chart/g) ?? []).length, 1);
  assert.equal((html.match(/data-codex-cycle-summary-row/g) ?? []).length, 1);
  assert.equal((html.match(/class="hc-xlabel"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /本机七天用量|本地七天用量/);
}));
test('cycle table and chart use one identical summary per cycle, not failed observation rows', () => run(() => {
  const p = owner([entry(), entry({ fullEquivalentUsd: null, unusedEquivalentUsd: null, observedAt: N })]);
  const html = p.renderWeeklyValuePanel('codex');
  assert.equal((html.match(/data-codex-cycle-summary-row/g) ?? []).length, 1);
  assert.equal((html.match(/class="hc-xlabel"/g) ?? []).length, 1);
  assert.match(html, /周期明细/); assert.match(html, /校准证据/);
  assert.doesNotMatch(html, /本机七天用量|本機七天用量/);
}));
test('overlapping anonymous reference omission is explicit without adding a second chart or assigning dollars', () => run(() => {
  for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'] as const) {
    I18n.setLanguage(locale);
    const p = owner([entry()]);
    p.weeklyEstimateProjection = () => ({ entries: [entry()], status: 'ready', unassignedCyclesOmitted: 1 });
    const html = p.renderWeeklyValuePanel('codex');
    assert.match(html, /data-unassigned-cycle-overlap/);
    assert.ok(html.includes(I18n.t.weeklyValue.unassignedCycleOverlap.replace('{count}', '1')));
    assert.equal((html.match(/data-codex-cycle-chart/g) ?? []).length, 1);
    assert.equal((html.match(/data-codex-cycle-summary-row/g) ?? []).length, 1);
  }
}));
test('a pending new cycle has a missing-value marker, never a tiny or zero capacity bar', () => run(() => {
  const html = owner([entry({ fullEquivalentUsd: null, unusedEquivalentUsd: null })]).renderWeeklyValuePanel('codex');
  assert.match(html, /data-cycle-pending/); assert.match(html, /待校准/);
  assert.doesNotMatch(html, /class="stack-seg seg-cache-read"/);
}));
test('an official identity checkpoint without calibration does not invent a zero-dollar sample', () => run(() => {
  const html = owner([entry({ usedEquivalentUsd: 0, fullEquivalentUsd: null, unusedEquivalentUsd: null })]).renderWeeklyValuePanel('codex');
  assert.doesNotMatch(html, /<dd>\$0\.00<\/dd>/);
  assert.match(html, /样本估值<\/dt><dd>—<\/dd>/);
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
test('cycle rendering never reads or serializes the runtime source census', () => run(() => {
  const p = owner([entry()]);
  const inputs = { usage: [], observations: [] };
  Object.defineProperty(inputs, 'codexCalibrationCensus', { enumerable: true,
    get() { throw new Error('runtime source revisions must stay out of client rendering'); } });
  p.codexView.weeklyValueInputs = inputs;
  const html = p.renderWeeklyValuePanel('codex');
  assert.doesNotMatch(html, /codexCalibrationCensus|sourceKey|revision/);
}));
