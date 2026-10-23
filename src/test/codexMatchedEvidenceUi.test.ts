import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';
import { captureCodexCalibrationPricebook, CodexCalibrationEvidence } from '../codexCalibrationEvidence';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';

const { freezeClock } = require('../../tests/ui/support/frozen-clock.cjs') as {
  freezeClock(now: number): () => void;
};
const loader = require('node:module'), original = loader._load;
loader._load = function(name: string, ...args: unknown[]) {
  return name === 'vscode' ? {} : original.call(this, name, ...args);
};
let Provider: typeof import('../webview').UsageWebviewProvider;
try { Provider = require('../webview').UsageWebviewProvider; } finally { loader._load = original; }

const T = Date.parse('2026-10-19T02:00:00Z'), M = 60_000, R = T + 6 * 86_400_000;
const locales: SupportedLanguage[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'pt-BR', 'de-DE', 'id'];
const keys = ['calibrationMeasuredRange', 'calibrationMatchedInterval', 'calibrationOfficialEnvelope'] as const;
function entry(): LocalWeeklyEstimate {
  const calibrationEvidence: CodexCalibrationEvidence = {
    schemaVersion: 1, methodVersion: 2, collectionMode: 'forward-matched-cut-v1',
    pricebook: captureCodexCalibrationPricebook(['gpt-5'])!,
    interval: { from: T, through: T + 10 * M, requestedFrom: T - 100, requestedThrough: T + 10 * M - 100,
      percentFrom: 36, percentThrough: 40, deltaUsd: 20, pricedTokens: 200, totalTokens: 200,
      linkedSources: 1, excludedSources: 0, continuityGap: false },
    matchedCut: { from: T + M, through: T + 9 * M, percentFrom: 37, percentThrough: 39 },
    accumulated: { intervals: 3, deltaPercent: 6, deltaUsd: 60, pricedTokens: 600, totalTokens: 600 },
  };
  return { provider: 'codex', method: 'account-delta-v1', accountNumber: 1,
    windowStart: T - 86_400_000, resetAt: R, observedAt: T + 10 * M, estimatedAt: T + 10 * M,
    calibrationStart: T - 30 * M, quotaEpoch: { startedAt: T - 31 * M, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
    usedEquivalentUsd: 60, fullEquivalentUsd: 1000, unusedEquivalentUsd: 600,
    utilizationPercent: 40, pricingCoverage: 1, flags: [], calibrationEvidence };
}
function owner(sample: LocalWeeklyEstimate): any {
  const p: any = Object.create(Provider.prototype);
  p.setting = (_key: string, fallback: unknown) => fallback;
  p.weeklyEstimateProjection = () => ({ entries: [sample], status: 'ready' });
  return p;
}
function run(body: () => void): void {
  const restoreClock = freezeClock(T + 11 * M), language = I18n.getCurrentLanguage(), zone = I18n.getTimezone();
  I18n.setLanguage('en'); I18n.setTimezone('UTC');
  try { body(); } finally { restoreClock(); I18n.setLanguage(language); I18n.setTimezone(zone); }
}
function facts(html: string): string {
  const match = html.match(/<dl data-cycle-evidence-facts>([\s\S]*?)<\/dl>/);
  assert.ok(match); return match[1];
}
function fact(html: string, attribute: string): { label: string; value: string } {
  const match = html.match(new RegExp('<dt>([^<]+)</dt><dd ' + attribute + '>([^<]+)</dd>'));
  assert.ok(match, attribute + ' is a distinct evidence fact');
  return { label: match[1], value: match[2] };
}

test('V2 renderer separates the matched 2pp cut from its real 4pp official envelope without leaking identities', () => run(() => {
  const sample = entry(), receipt = sample.calibrationEvidence!;
  const privateFields = ['hmac', 'sourceKey', 'accountScopeKey', 'sourceScopeKey', 'rawSourceKeys'];
  for (const key of privateFields) Object.defineProperty(sample, key, { enumerable: true, value: 'private-canary-' + key });
  for (const object of [receipt, receipt.interval, receipt.matchedCut!, receipt.accumulated]) {
    for (const key of privateFields) Object.defineProperty(object, key, { enumerable: true,
      get() { throw new Error('Renderer read private field: ' + key); } });
  }
  const html = owner(sample).renderWeeklyEstimateRecords('codex'), details = facts(html);
  assert.deepEqual(fact(details, 'data-calibration-measured-range'), {
    label: 'Cumulative calibration time range', value: 'Oct 19, 2026, 01:30 AM – Oct 19, 2026, 02:09 AM',
  });
  assert.deepEqual(fact(details, 'data-calibration-matched-interval'), {
    label: 'Latest measured interval', value: 'Oct 19, 2026, 02:01 AM – Oct 19, 2026, 02:09 AM · 37% → 39%',
  });
  assert.deepEqual(fact(details, 'data-calibration-official-envelope'), {
    label: 'Official observation interval', value: 'Oct 19, 2026, 02:00 AM – Oct 19, 2026, 02:10 AM · 36% → 40%',
  });
  assert.match(html, /<summary>Δp=6 · n=3<\/summary>/);
  assert.ok(details.includes('<dt>' + I18n.t.weeklyValue.estimateUsed + '</dt><dd>$60.00</dd>'));
  assert.ok(details.includes('<dt>' + I18n.t.weeklyValue.calibrationChange + '</dt><dd>Δp=6</dd>'));
  assert.ok(!details.includes('<dt>' + I18n.t.weeklyValue.estimateAsOf + '</dt>'));
  assert.match(html, /<td class="date-cell">Oct 19, 2026, 02:10 AM<span class="model-details" data-cycle-state>40%<\/span><\/td>/);
  assert.match(html, /<details data-cycle-evidence data-persist="quota-evidence-codex-1-[^"]+">/);
  assert.match(html, /data-persist="weekly-estimate-codex"/);
  assert.doesNotMatch(html, /private-canary|hmac|sourceKey|accountScopeKey|sourceScopeKey|rawSourceKeys|requestedFrom|requestedThrough/);
}));

test('V2 cumulative bounds retain earlier cuts without describing the span as continuous measurement', () => run(() => {
  const sample = entry(), receipt = sample.calibrationEvidence!;
  // An earlier accepted cut precedes this envelope; an intervening blur gap is not measured.
  sample.calibrationStart = T - 60 * M; sample.quotaEpoch!.startedAt = T - 61 * M;
  sample.usedEquivalentUsd = 100; sample.fullEquivalentUsd = 1250; sample.unusedEquivalentUsd = 750;
  receipt.accumulated = { intervals: 4, deltaPercent: 8, deltaUsd: 100, pricedTokens: 1000, totalTokens: 1000 };
  const before = owner(sample).renderWeeklyEstimateRecords('codex'), details = facts(before);
  assert.equal(fact(details, 'data-calibration-measured-range').value,
    'Oct 19, 2026, 01:00 AM – Oct 19, 2026, 02:09 AM');
  assert.equal(fact(details, 'data-calibration-matched-interval').value,
    'Oct 19, 2026, 02:01 AM – Oct 19, 2026, 02:09 AM · 37% → 39%');
  assert.match(before, /<summary>Δp=8 · n=4<\/summary>/);
  assert.ok(details.includes('<dt>' + I18n.t.weeklyValue.estimateUsed + '</dt><dd>$100.00</dd>'));
  assert.doesNotMatch(details, /continuous|contiguous|uninterrupted/i);
  const key = before.match(/data-persist="(quota-evidence-[^"]+)"/)![1];
  sample.observedAt += M; receipt.interval.through += M;
  assert.ok(owner(sample).renderWeeklyEstimateRecords('codex').includes('data-persist="' + key + '"'));
}));

test('V2 pending calibration keeps its single matched 2pp sample separate from the official 4pp rise', () => run(() => {
  const sample = entry(), receipt = sample.calibrationEvidence!;
  sample.calibrationStart = receipt.matchedCut!.from; sample.usedEquivalentUsd = 20;
  receipt.accumulated = { intervals: 1, deltaPercent: 2, deltaUsd: 20, pricedTokens: 200, totalTokens: 200 };
  const html = owner(sample).renderWeeklyEstimateRecords('codex'), details = facts(html);
  assert.equal(fact(details, 'data-calibration-measured-range').value,
    'Oct 19, 2026, 02:01 AM – Oct 19, 2026, 02:09 AM');
  assert.equal(fact(details, 'data-calibration-matched-interval').value,
    'Oct 19, 2026, 02:01 AM – Oct 19, 2026, 02:09 AM · 37% → 39%');
  assert.equal(fact(details, 'data-calibration-official-envelope').value,
    'Oct 19, 2026, 02:00 AM – Oct 19, 2026, 02:10 AM · 36% → 40%');
  assert.ok(details.includes('<dt>' + I18n.t.weeklyValue.estimateUsed + '</dt><dd>$20.00</dd>'));
  assert.ok(details.includes('<dt>' + I18n.t.weeklyValue.calibrationChange + '</dt><dd>Δp=2</dd>'));
}));

test('V2 evidence labels are localized and rendered in all eight locales', () => run(() => {
  const expected = [
    ['Cumulative calibration time range', 'Latest measured interval', 'Official observation interval'],
    ['累计校准时间范围', '末段计量区间', '官方观测区间'],
    ['累計校準時間範圍', '末段計量區間', '官方觀測區間'],
    ['累積校正の時間範囲', '直近の計測区間', '公式の観測区間'],
    ['누적 교정 시간 범위', '최근 측정 구간', '공식 관측 구간'],
    ['Faixa de tempo da calibração acumulada', 'Último intervalo medido', 'Intervalo de observação oficial'],
    ['Zeitraum der kumulierten Kalibrierung', 'Letztes Messintervall', 'Offizielles Beobachtungsintervall'],
    ['Rentang waktu kalibrasi kumulatif', 'Interval pengukuran terakhir', 'Interval pengamatan resmi'],
  ];
  locales.forEach((locale, index) => {
    I18n.setLanguage(locale);
    const html = owner(entry()).renderWeeklyEstimateRecords('codex');
    keys.forEach((key, column) => {
      assert.equal(Reflect.get(I18n.t.weeklyValue, key), expected[index][column], locale + '.' + key);
      assert.ok(html.includes('<dt>' + expected[index][column] + '</dt>'), locale + '.' + key + ' is visible');
    });
  });
}));

test('V1 evidence facts retain their exact original markup for historical and forward-append receipts', () => run(() => {
  for (const mode of [undefined, 'forward-append-v1'] as const) {
    const sample = entry(), receipt = sample.calibrationEvidence!;
    receipt.methodVersion = 1; receipt.collectionMode = mode; delete receipt.matchedCut;
    receipt.accumulated.deltaPercent = 8; sample.calibrationStart = T;
    sample.fullEquivalentUsd = 750; sample.unusedEquivalentUsd = 450;
    const html = owner(sample).renderWeeklyEstimateRecords('codex'), copy = I18n.t.weeklyValue;
    assert.equal(facts(html), '<dt>' + copy.estimateMethod + '</dt><dd>' + copy.accountDeltaEstimate +
      '</dd><dt>' + copy.estimateAsOf + '</dt><dd>Oct 19, 2026, 02:00 AM – Oct 19, 2026, 02:10 AM' +
      '</dd><dt>' + copy.estimateUsed + '</dt><dd>$60.00</dd><dt>' + copy.calibrationChange +
      '</dt><dd>Δp=8</dd><dt>' + copy.pricingCoverage + '</dt><dd>100%</dd>');
    assert.match(html, /<summary>Δp=8 · n=3<\/summary>/);
    assert.doesNotMatch(html, /data-calibration-measured-range|data-calibration-matched-interval|data-calibration-official-envelope/);
    for (const key of keys) {
      const label = Reflect.get(copy, key);
      if (label) assert.ok(!html.includes(label));
    }
  }
}));
