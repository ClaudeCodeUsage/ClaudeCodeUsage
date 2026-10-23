import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';

const loader = require('node:module'), original = loader._load;
const vscodeHost: any = { ViewColumn: { One: 1 }, window: {} };
loader._load = function (name: string, ...args: unknown[]) {
  return name === 'vscode' ? vscodeHost : original.call(this, name, ...args);
};
let Provider: typeof import('../webview').UsageWebviewProvider;
let settings: typeof import('../settings');
try { Provider = require('../webview').UsageWebviewProvider; settings = require('../settings'); }
finally { loader._load = original; }

const R = Date.parse('2026-10-26T12:00:00Z'), T = R - 86_400_000;
const locales: SupportedLanguage[] = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
const titles = ['Official quota', 'Offizielles Kontingent', '官方額度', '官方额度', '公式クォータ', '공식 할당량', 'Cota oficial', 'Kuota resmi'];
const collecting = ['Collecting samples', 'Stichproben werden gesammelt', '正在累積樣本', '正在积累样本', 'サンプル収集中', '표본 수집 중', 'Coletando amostras', 'Mengumpulkan sampel'];
const accounts = ['Account 2', 'Konto 2', '帳號 2', '账号 2', 'アカウント 2', '계정 2', 'Conta 2', 'Akun 2'];
const unassigned = ['Unassigned', 'Nicht zugeordnet', '未歸屬', '未归属', '未割り当て', '미할당', 'Sem atribuição', 'Belum ditetapkan'];

function entry(method = 'account-delta-v1', accountNumber: unknown = 2): any {
  return { provider: 'codex', windowStart: R - 7 * 86_400_000, resetAt: R, observedAt: T, estimatedAt: T + 1,
    usedEquivalentUsd: 25, fullEquivalentUsd: 100, unusedEquivalentUsd: 75, utilizationPercent: 25,
    pricingCoverage: 1, flags: [], method, accountNumber,
    ...(method === 'account-delta-v1' ? { quotaEpoch: { startedAt: T - 120_000,
      resetAnchorAt: R, startLowerAt: null, reason: 'initial' }, quotaCycle: {
      id: T - 120_000, startAt: null, startLowerAt: null, endAt: R, endLowerAt: null,
      closed: false, scheduledResetAt: R, boundaryUncertain: true } } : {}),
    sourceKey: 'raw-private-id', accountScopeKey: 'private-hmac-must-not-render' };
}
function owner(enabled = true, entries: any[] = []) {
  const p: any = Object.create(Provider.prototype);
  const projection: any = { status: 'ready', entries, activeAccountNumber: 2,
    officialQuota: { status: 'ready', accountNumber: 2, usedPercent: 25, resetAt: R, observedAt: T } };
  p.setting = (key: string, fallback: unknown) => key === 'codex.officialQuota.enabled' ? enabled : fallback;
  p.weeklyEstimateProjection = () => projection;
  p.weeklyValuePoints = () => [{ provider: 'codex', seriesKey: 'raw-private-id', windowStart: R - 7 * 86_400_000,
    resetAt: R, current: true, usedEquivalentUsd: 400, fullEquivalentUsd: null, unusedEquivalentUsd: null,
    utilizationPercent: 25, observedAt: T, pricingCoverage: 1, observationGapMs: 1,
    confidence: 'usage-only', basis: 'calendar-usage' }];
  p.codexView = { periodCoverage: { allTime: { complete: true } } };
  return { p, projection };
}
function english(run: () => void) {
  const old = I18n.getCurrentLanguage(), clock = Date.now;
  Date.now = () => T + 1; I18n.setLanguage('en');
  try { run(); } finally { Date.now = clock; I18n.setLanguage(old); }
}
function status(html: string): string {
  return html.match(/<p class="table-hint weekly-official-quota"[^>]*>[\s\S]*?<\/p>/)?.[0] ?? '';
}

test('official quota setting is a default-off Codex-only state switch for an already running daemon', () => {
  const def = settings.SETTINGS.find(row => row.key === 'codex.officialQuota.enabled');
  assert.ok(def); assert.equal(def.type, 'boolean'); assert.equal(def.default, false);
  assert.equal(def.storage, 'state'); assert.equal(def.group, 'providers');
  assert.deepEqual(def.providers, ['codex']);
  assert.match(def.help!, /already running official Codex daemon/i);
  assert.match(def.help!, /never starts.*automatically/i);
});

test('default OFF never reads the official projection and Claude never renders official Codex status', () => english(() => {
  const { p, projection } = owner(false);
  Object.defineProperty(projection, 'officialQuota', { get: () => assert.fail('OFF must not read official quota') });
  assert.equal(status(p.renderWeeklyValuePanel('codex')), '');
  assert.equal(status(owner().p.renderWeeklyValuePanel('claude')), '');
}));

for (let index = 0; index < locales.length; index++) {
  const locale = locales[index];
  test(`${locale}: ready quota is inline and says collecting samples until account calibration exists`, () => english(() => {
    I18n.setLanguage(locale);
    const { p } = owner();
    const html = p.renderWeeklyValuePanel('codex'), quota = status(html);
    assert.ok(quota.includes(titles[index])); assert.match(quota, /25%/);
    assert.ok(quota.includes(collecting[index])); assert.match(quota, /2/);
    assert.ok(!html.includes(I18n.t.weeklyValue.calendarFallback), 'an official reset must not be contradicted by a calendar fallback');
    assert.doesNotMatch(html, /raw-private-id|private-hmac-must-not-render|accountScopeKey/);
    const records = owner(true, [entry(), entry('series-prefix-v1', null)]).p.renderWeeklyEstimateRecords('codex');
    assert.ok(records.includes('<td>' + accounts[index] + '</td>'));
    assert.ok(records.includes('<td>' + unassigned[index] + '</td>'));
    for (const cell of records.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)) assert.doesNotMatch(cell[1], /≈/);
    const tr = I18n.settingText('codex.officialQuota.enabled');
    if (locale !== 'en') { assert.ok(tr?.label); assert.ok(tr?.help); }
  }));
}

test('account delta labels its proxy and account alongside unassigned reference estimates', () => english(() => {
  const { p } = owner(true, [entry(), entry('series-prefix-v1', null)]);
  const html = p.renderWeeklyValuePanel('codex');
  assert.doesNotMatch(status(html), /Collecting samples/);
  assert.match(html, /Account quota delta · local usage proxy/);
  assert.match(html, /Local-series estimate \(account unverified\)/);
  assert.doesNotMatch(html, /weekly-value-details|weekly-actual-chart/);
  const records = html.split('<details class="weekly-estimate-details"')[1];
  assert.match(records, /<th>Account<\/th>/); assert.match(records, /<td>Account 2<\/td>/);
  assert.match(records, /<td>Unassigned<\/td>/);
  for (const cell of html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)) assert.doesNotMatch(cell[1], /≈/);
  assert.doesNotMatch(html, /raw-private-id|private-hmac-must-not-render|accountScopeKey/);
}));

test('latest invalid, previous reset or other-account delta does not imply current account calibration', () => english(() => {
  for (const entries of [[entry('paired-delta')], [entry('account-delta-v1', 3)],
    [{ ...entry(), resetAt: R - 7 * 86_400_000 }],
    [entry(), { ...entry(), observedAt: T + 1, fullEquivalentUsd: null, unusedEquivalentUsd: null }]]) {
    assert.match(status(owner(true, entries).p.renderWeeklyValuePanel('codex')), /Collecting samples/);
  }
}));

test('an official quota epoch requires calibration from that same observed segment', () => english(() => {
  const startedAt = T - 120_000;
  for (const epoch of [undefined, { startedAt: startedAt - 60_000 }, { startedAt }]) {
    const sample = { ...entry(), quotaEpoch: epoch ? { ...epoch, resetAnchorAt: R,
      startLowerAt: null, reason: 'counter-drop' } : undefined };
    const { p, projection } = owner(true, [sample]);
    projection.officialQuota.quotaEpochStartedAt = startedAt;
    const quota = status(p.renderWeeklyValuePanel('codex'));
    if (epoch?.startedAt === startedAt) assert.doesNotMatch(quota, /Collecting samples/);
    else assert.match(quota, /Collecting samples/);
  }
}));

test('the estimated chart receives the active quota epoch and never marks a previous segment current', () => english(() => {
  const startedAt = T - 120_000;
  const sample = { ...entry(), quotaEpoch: { startedAt, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } };
  const { p, projection } = owner(true, [sample]);
  p.weeklyValuePoints = () => [];
  projection.activeQuotaEpochStartedAt = T - 60_000;
  projection.officialQuota.quotaEpochStartedAt = T - 60_000;
  assert.doesNotMatch(p.renderWeeklyValuePanel('codex'), /#2 Current/);
  projection.activeQuotaEpochStartedAt = startedAt;
  projection.officialQuota.quotaEpochStartedAt = startedAt;
  assert.match(p.renderWeeklyValuePanel('codex'), /<span>#2 Current<\/span>/);
}));

test('a six-minute-old stale official sample stays visible at its original observation without active calibration claims', () => english(() => {
  const observedAt = T - 6 * 60_000;
  for (const entries of [[], [{ ...entry(), observedAt }]]) {
    const { p, projection } = owner(true, entries);
    p.weeklyValuePoints = () => [];
    projection.officialQuota.stale = true;
    projection.officialQuota.observedAt = observedAt;
    const before = JSON.stringify(projection), html = p.renderWeeklyValuePanel('codex'), quota = status(html);
    assert.match(quota, /Official quota · Account 2 · 25%/);
    const date = new Intl.DateTimeFormat(I18n.getLocale(), { month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: I18n.getTimezone() || undefined }).format(new Date(observedAt));
    assert.ok(quota.includes(date)); assert.ok(quota.includes(I18n.t.weeklyValue.estimateStale));
    assert.doesNotMatch(quota, /Collecting samples/);
    assert.doesNotMatch(html, /#2 Current/);
    assert.equal(JSON.stringify(projection), before, 'stale display must not refresh the sample time or percentage');
    if (entries.length) assert.match(html, /\$100\.00/);
  }
}));

test('loading, unavailable, mismatch and disabled are concise visible states without stale quota numbers', () => english(() => {
  for (const [state, expected] of [['loading', 'Reading official quota'], ['unavailable', 'Official quota unavailable'],
    ['source-mismatch', 'Quota source differs from the official service account'], ['disabled', 'Official quota disabled']]) {
    const { p, projection } = owner(true, [entry()]); projection.officialQuota.status = state;
    const html = status(p.renderWeeklyValuePanel('codex'));
    assert.ok(html.includes(expected)); assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /25%|Collecting samples/);
  }
}));

test('empty weekly history still displays enabled quota state; hiding weekly values hides the whole slice', () => english(() => {
  const { p } = owner(); p.weeklyValuePoints = () => [];
  assert.match(status(p.renderWeeklyValuePanel('codex')), /Official quota/);
  const prior = p.setting; p.setting = (key: string, fallback: unknown) => key === 'showWeeklyEquivalentValue' ? false : prior(key, fallback);
  assert.equal(p.renderWeeklyValuePanel('codex'), '');
}));

const calibrationStates = [
  ['baseline', 'Waiting for the next comparable observation'],
  ['percentage-step', 'Waiting for a quota percentage increase'],
  ['first-step-discarded', 'First percentage step excluded; collecting the next interval'],
  ['accumulating', 'Collecting paired observations'],
  ['calibrated', 'Paired calibration available'],
  ['source-unavailable', 'Local usage source unavailable'],
  ['source-changed', 'Usage source changed; collecting a new baseline'],
  ['append-incomplete', 'New usage evidence is incomplete'],
  ['endpoint-mismatch', 'Usage and quota observation times do not align'],
  ['unpriced-usage', 'New usage includes a model without a price'],
  ['quota-blocked', 'Ordinary usage is blocked; calibration paused'],
  ['continuity-gap', 'Observation continuity interrupted; collecting a new baseline'],
] as const;
const calibrationCopyKeys = ['calibrationBaseline', 'calibrationPercentageStep', 'calibrationFirstStepDiscarded',
  'calibrationAccumulating', 'calibrationCalibrated', 'calibrationSourceUnavailable', 'calibrationSourceChanged',
  'calibrationAppendIncomplete', 'calibrationEndpointMismatch', 'calibrationUnpricedUsage', 'calibrationQuotaBlocked',
  'calibrationContinuityGap'] as const;

test('live calibration reasons use a fixed state allowlist and preserve pending monetary values', () => english(() => {
  for (const [state, reason] of calibrationStates) {
    const { p, projection } = owner();
    projection.officialQuota.calibration = { state, deltaPercent: 5, intervals: 1 };
    const html = p.renderWeeklyValuePanel('codex'), quota = status(html);
    assert.ok(quota.includes(reason), state);
    assert.doesNotMatch(quota, /Collecting samples/);
    assert.doesNotMatch(html, /class="stack-bar"|\$0\.00/);
    if (state === 'accumulating' || state === 'calibrated') assert.match(quota, /Paired quota change: 5 percentage points/);
    else assert.doesNotMatch(quota, /Paired quota change:/);
  }
}));

test('a sub-threshold calibrated state reports progress without claiming a capacity fit', () => english(() => {
  for (const deltaPercent of [0, 1, 4.99]) {
    const { p, projection } = owner();
    projection.officialQuota.calibration = { state: 'calibrated', deltaPercent, intervals: 1 };
    const html = p.renderWeeklyValuePanel('codex'), quota = status(html);
    assert.match(quota, /Collecting paired observations/);
    assert.doesNotMatch(quota, /Paired calibration available/);
    assert.doesNotMatch(html, /class="stack-bar"|\$0\.00/);
    if (deltaPercent > 0) assert.match(quota, /Paired quota change:/);
    else assert.doesNotMatch(quota, /Paired quota change:/);
  }
  for (const intervals of [0, -1, NaN, '1']) {
    const { p, projection } = owner();
    projection.officialQuota.calibration = { state: 'calibrated', deltaPercent: 5, intervals };
    assert.match(status(p.renderWeeklyValuePanel('codex')), /Collecting paired observations/);
    assert.doesNotMatch(status(p.renderWeeklyValuePanel('codex')), /Paired calibration available/);
  }
}));

test('unknown calibration states and invalid progress never render arbitrary values', () => english(() => {
  for (const state of ['__proto__', 'constructor', '<script>private-state</script>', 'unknown-state']) {
    const { p, projection } = owner();
    projection.officialQuota.calibration = { state, deltaPercent: 99, intervals: 99 };
    const html = status(p.renderWeeklyValuePanel('codex'));
    assert.match(html, /Collecting samples/);
    assert.doesNotMatch(html, /private-state|unknown-state|__proto__|constructor|Paired quota change:/);
  }
  for (const deltaPercent of [NaN, Infinity, -1, 101, '5', '<img src=x>']) {
    const { p, projection } = owner();
    projection.officialQuota.calibration = { state: 'accumulating', deltaPercent, intervals: 1 };
    const html = status(p.renderWeeklyValuePanel('codex'));
    assert.match(html, /Collecting paired observations/);
    assert.doesNotMatch(html, /NaN|Infinity|<img|Paired quota change:/);
  }
  const { p, projection } = owner();
  projection.officialQuota.stale = true;
  Object.defineProperty(projection.officialQuota, 'calibration', { get: () => assert.fail('stale observations cannot carry live calibration status') });
  assert.doesNotThrow(() => p.renderWeeklyValuePanel('codex'));
}));

for (const locale of locales) {
  test(`${locale}: calibration and unknown monetary hints are localized in the existing compact layout`, () => english(() => {
    I18n.setLanguage(locale);
    const copy = I18n.t.weeklyValue;
    const { p, projection } = owner();
    for (let index = 0; index < calibrationStates.length; index++) {
      projection.officialQuota.calibration = { state: calibrationStates[index][0], deltaPercent: 5, intervals: 1 };
      const text = status(p.renderWeeklyValuePanel('codex')), reason = copy[calibrationCopyKeys[index]];
      assert.ok(reason.length > 0 && text.includes(reason), calibrationStates[index][0]);
      if (locale !== 'en') assert.ok(!text.includes(calibrationStates[index][1]), calibrationStates[index][0]);
    }
    projection.officialQuota.calibration = { state: 'baseline', deltaPercent: 0, intervals: 0 };
    let html = p.renderWeeklyValuePanel('codex');
    assert.ok(status(html).includes(copy.calibrationBaseline));
    assert.ok(html.includes(copy.monetaryPending));
    assert.match(html, /class="table-hint" data-cycle-monetary-pending role="status"/);
    if (locale !== 'en') {
      assert.ok(!html.includes('Waiting for the next comparable observation'));
      assert.ok(!html.includes('Cycle amounts are not yet available'));
    }
    projection.entries = [{ ...entry(), fullEquivalentUsd: null, unusedEquivalentUsd: null, usedEquivalentUsd: 0 }];
    html = p.renderWeeklyValuePanel('codex');
    assert.match(html, /data-cycle-pending/);
    assert.ok(html.includes(copy.monetaryPending));
    assert.doesNotMatch(html, /class="stack-bar"/);
    projection.entries = [entry()];
    html = p.renderWeeklyValuePanel('codex');
    assert.match(html, /class="stack-bar"/);
    assert.doesNotMatch(html, /data-cycle-monetary-pending/);
    if (locale === 'zh-CN') {
      assert.match(status(html), /等待下一次可比观测/);
      projection.entries = [];
      assert.match(p.renderWeeklyValuePanel('codex'), /— 表示未知，并非零/);
    }
  }));
}

test('malformed account and quota metadata cannot inject HTML or expose raw identity properties', () => english(() => {
  const attack = '<img src=x onerror="globalThis.bad=1">';
  const { p, projection } = owner(true, [entry('series-prefix-v1', attack)]);
  projection.activeAccountNumber = attack; projection.officialQuota.accountNumber = attack;
  projection.officialQuota.usedPercent = attack;
  const html = p.renderWeeklyValuePanel('codex');
  assert.doesNotMatch(html, /<img|onerror|globalThis\.bad|raw-private-id|private-hmac/);
  assert.match(html, /Unassigned/); assert.doesNotMatch(status(html), /25%/);
  assert.doesNotMatch(p.renderWeeklyEstimateRecords('claude', projection), /<th>Account<\/th>/);
}));

test('identified quota before number assignment collects samples without inventing an account number', () => english(() => {
  const { p, projection } = owner(); delete projection.officialQuota.accountNumber;
  const html = status(p.renderWeeklyValuePanel('codex'));
  assert.match(html, /Official service account identified.*Collecting samples/);
  assert.doesNotMatch(html, /Account 2|Unassigned/);
  const scoped = entry(); scoped.flags = ['account-unattributed'];
  const records = owner(true, [scoped]).p.renderWeeklyEstimateRecords('codex');
  assert.match(records, /Local usage ownership unverified/);
  assert.doesNotMatch(records, /Account unverified/);
}));

test('chart current marker follows the identified service account and retires when another account is collecting', () => english(() => {
  const sample = entry(), before = JSON.stringify(sample);
  const { p, projection } = owner(true, [sample]); p.weeklyValuePoints = () => [];
  const chart = () => p.renderWeeklyValuePanel('codex').match(/<div class="hc-xlabels">([\s\S]*?)<\/div><\/div>/)?.[1] ?? '';
  // Identified account/reset equality alone is insufficient: current requires
  // an active raw epoch that maps to this account's displayed quota cycle.
  assert.doesNotMatch(chart(), /Current/);
  projection.officialQuota.quotaEpochStartedAt = sample.quotaEpoch.startedAt;
  assert.doesNotMatch(chart(), /Current/, 'official metadata alone is not the raw-to-display mapping');
  projection.activeQuotaEpochStartedAt = sample.quotaEpoch.startedAt + 60_000;
  assert.doesNotMatch(chart(), /Current/, 'an unmatched raw epoch cannot claim the current cycle');
  projection.activeQuotaEpochStartedAt = sample.quotaEpoch.startedAt;
  assert.match(chart(), /<span>#2 Current<\/span>/);
  projection.activeAccountNumber = 3; projection.officialQuota.accountNumber = 3;
  assert.doesNotMatch(chart(), /Current/);
  assert.match(status(p.renderWeeklyValuePanel('codex')), /Collecting samples/);
  delete projection.activeAccountNumber; delete projection.officialQuota.accountNumber;
  assert.doesNotMatch(chart(), /Current/);
  assert.match(status(p.renderWeeklyValuePanel('codex')), /Official service account identified.*Collecting samples/);
  projection.activeAccountNumber = 2; projection.officialQuota.status = 'unavailable';
  assert.doesNotMatch(chart(), /Current/);
  assert.equal(JSON.stringify(sample), before, 'current-state display cannot retime or rewrite the historical estimate');
}));

test('unassigned historical bars explicitly disclose reference status and low confidence',()=>english(()=>{
  const {p}=owner(false,[{...entry('series-prefix-v1'),accountNumber:undefined}]);
  const html=p.renderWeeklyValuePanel('codex');
  const labels=[...html.matchAll(/aria-label="([^"]*)"/g)].map(row=>row[1]);
  assert.ok(labels.length>0);
  // Cycle bounds, amounts and their own as-of now precede the confidence
  // disclosure. Keep both identity and low-reference claims in every name.
  assert.ok(labels.every(label=>label.startsWith('Unassigned · ')&&
    label.includes('Low · Reference estimate · not an account cycle')));
  assert.ok(labels.every(label=>label.includes('As of observation:')));
  assert.ok(labels.every(label=>!label.includes('Current period')));
  assert.match(html,/<td>Unassigned<\/td>/,'the table still discloses missing ownership');
}));

test('manual estimate refresh bypasses paused auto-refresh but preserves loading and no-panel guards', () => english(() => {
  const { p } = owner(); let renders = 0;
  p.updateWebview = () => { renders++; }; p.panel = { visible: true };
  const prior = p.setting; p.setting = (key: string, fallback: unknown) => key === 'dashboardAutoRefresh' ? false : prior(key, fallback);
  assert.equal(p.isDashboardVisible(), true);
  p.refreshWeeklyEstimates(); assert.equal(renders, 0);
  p.refreshWeeklyEstimates(true); assert.equal(renders, 1);
  p.isLoading = true; p.refreshWeeklyEstimates(true); assert.equal(renders, 1);
  p.isLoading = false; p.panel = undefined;
  assert.equal(p.isDashboardVisible(), false); p.refreshWeeklyEstimates(true); assert.equal(renders, 1);
}));

test('new and newly visible dashboards notify only when enabled and callback failure cannot interrupt show', async () => {
  const { p } = owner(); let calls = 0, paints = 0, listener: any;
  const panel = { visible: true, reveal() {}, onDidDispose() {},
    onDidChangeViewState(callback: any) { listener = callback; },
    webview: { onDidReceiveMessage() {} } };
  vscodeHost.window.createWebviewPanel = () => panel;
  p.updateWebview = () => { paints++; };
  p.onWeeklyQuotaVisible = () => { calls++; throw new Error('synthetic callback failure'); };
  assert.doesNotThrow(() => p.show('all')); assert.equal(paints, 1); assert.equal(calls, 1);
  listener({ webviewPanel: panel }); assert.equal(calls, 1);
  panel.visible = false; listener({ webviewPanel: panel }); assert.equal(p.isDashboardVisible(), false);
  panel.visible = true; listener({ webviewPanel: panel }); assert.equal(calls, 2);
  p.onWeeklyQuotaVisible = () => { calls++; return Promise.reject(new Error('synthetic async failure')); };
  panel.visible = false; listener({ webviewPanel: panel }); panel.visible = true; listener({ webviewPanel: panel });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 3);
  const prior = p.setting; p.setting = (key: string, fallback: unknown) => key === 'codex.officialQuota.enabled' ? false : prior(key, fallback);
  panel.visible = false; listener({ webviewPanel: panel }); panel.visible = true; listener({ webviewPanel: panel });
  assert.equal(calls, 3);
});
