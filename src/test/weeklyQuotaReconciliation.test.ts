import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
import type { WeeklyValuePoint } from '../weeklyValue';

// Exercise the production renderer without constructing a VS Code host or
// reading logs, archives, daemon state, or account credentials.
const loader = require('node:module'), original = loader._load;
loader._load = function (name: string, ...args: unknown[]) {
  return name === 'vscode' ? {} : original.call(this, name, ...args);
};
let Provider: typeof import('../webview').UsageWebviewProvider;
try { Provider = require('../webview').UsageWebviewProvider; }
finally { loader._load = original; }

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-19T12:00:00Z'), RESET = NOW + DAY;
const ACTUAL = 953.87, USED = 860.87, FULL = 1212.49, UNUSED = 351.62;
const locales: SupportedLanguage[] = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];

function fixture() {
  const point: WeeklyValuePoint = {
    provider: 'codex', seriesKey: 'fixture-local-series', windowStart: RESET - 7 * DAY,
    resetAt: RESET, current: true, usedEquivalentUsd: ACTUAL,
    fullEquivalentUsd: null, unusedEquivalentUsd: null, utilizationPercent: null,
    pricingCoverage: 1, observationGapMs: null, confidence: 'usage-only',
    basis: 'reset-aligned-usage', usageAvailable: true,
  };
  const snapshot: LocalWeeklyEstimate = {
    provider: 'codex', windowStart: point.windowStart, resetAt: RESET,
    observedAt: NOW - 3_600_000, estimatedAt: NOW,
    usedEquivalentUsd: USED, fullEquivalentUsd: FULL, unusedEquivalentUsd: UNUSED,
    utilizationPercent: 71, pricingCoverage: 1, method: 'series-prefix-v1',
    flags: ['account-unattributed'],
  };
  // A competing older snapshot detects accidental mixing of observations.
  const older: LocalWeeklyEstimate = {
    ...snapshot, observedAt: NOW - 2 * 3_600_000, estimatedAt: NOW - 3_600_000,
    usedEquivalentUsd: 200, fullEquivalentUsd: 500, unusedEquivalentUsd: 300,
    utilizationPercent: 40,
  };
  const projection = { status: 'ready' as const, entries: [older, snapshot] };
  const owner: any = Object.create(Provider.prototype);
  let projectionReads = 0;
  owner.setting = (_key: string, fallback: unknown) => fallback;
  owner.weeklyValuePoints = () => [point];
  owner.weeklyEstimateProjection = () => { projectionReads++; return projection; };
  // Complete local indexing is deliberately not account-ownership proof.
  owner.codexView = { periodCoverage: { allTime: { complete: true } } };
  return { owner, point, projection, projectionReads: () => projectionReads };
}

function display(run: () => void) {
  const language = I18n.getCurrentLanguage(), currency = I18n.getCurrencyDisplay().code;
  const clock = Date.now;
  Date.now = () => NOW; I18n.setLanguage('en'); I18n.setCurrencyDisplay('USD');
  try { run(); }
  finally { Date.now = clock; I18n.setLanguage(language); I18n.setCurrencyDisplay(currency); }
}

function details(html: string, className: string): string {
  const start = new RegExp('<details class="' + className + '"[^>]*>').exec(html);
  assert.ok(start, `${className} must remain independently inspectable`);
  // Each summary row now nests its own native evidence disclosure. Match the
  // outer closing tag rather than truncating the table at the first inner one.
  const section = html.slice(start.index);
  let depth = 0;
  for (const tag of section.matchAll(/<\/?details\b[^>]*>/g)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return section.slice(start[0].length, tag.index!);
  }
  assert.fail(`${className} must have a complete outer disclosure`);
}

function rows(html: string): string[][] {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  assert.ok(body, 'the details must contain a table body');
  return [...body[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]));
}

function barLabels(html: string): string[] {
  return [...html.matchAll(/<div class="stack-bar"[^>]*aria-label="([^"]*)"[^>]*>/g)].map(bar => bar[1]);
}

function money(amount: number): string { return I18n.formatCurrency(amount).replace(/^≈/, ''); }

function evidence(cell: string): string {
  assert.match(cell, /^<details data-cycle-evidence data-persist="[^"]+">/);
  assert.equal((cell.match(/<details\b/g) ?? []).length, 1);
  const facts = cell.match(/<dl data-cycle-evidence-facts>([\s\S]*?)<\/dl>/);
  assert.ok(facts, 'sample evidence belongs inside the native per-cycle disclosure');
  return facts[1];
}

function sampleAmount(cell: string): string {
  const facts = evidence(cell);
  const values = [...facts.matchAll(/<dd>([\s\S]*?)<\/dd>/g)];
  assert.equal(values.length, 5, 'method, interval/as-of, sample, percentage change and coverage remain auditable');
  assert.ok(facts.includes('<dt>' + I18n.t.weeklyValue.estimateUsed + '</dt>'));
  return values[2][1];
}

// The retained comparison reuses the established composition/stack classes.
function chart(html: string, name: string): string {
  const start = new RegExp('<div\\b[^>]*\\bdata-' + name + '(?=[\\s=>])[^>]*>').exec(html);
  assert.ok(start, `data-${name} must identify a separate chart with its own meaning`);
  const section = html.slice(start.index);
  let depth = 0;
  for (const tag of section.matchAll(/<\/?div\b[^>]*>/g)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return section.slice(0, tag.index! + tag[0].length);
  }
  assert.fail(`data-${name} must have a complete chart wrapper`);
}

test('Codex retains one estimate comparison and removes duplicate local chart and period details', () => display(() => {
  const html = fixture().owner.renderWeeklyValuePanel('codex');
  assert.doesNotMatch(html, /weekly-actual-chart|weekly-value-details/);
  assert.equal((html.match(/class="composition-chart"/g) ?? []).length, 1);
  assert.ok(chart(html, 'weekly-estimate-chart'));
  assert.match(html, /data-persist="weekly-estimate-codex"/);
}));

test('Codex does not compute a duplicate local calendar timeline or display its reset fallback', () => display(() => {
  const f = fixture();
  f.owner.weeklyValuePoints = () => assert.fail('Codex comparison needs only estimate snapshots');
  const html = f.owner.renderWeeklyValuePanel('codex');
  assert.ok(!html.includes(I18n.t.weeklyValue.calendarFallback));
  assert.ok(details(html, 'weekly-estimate-details'));
}));

test('independent estimate chart and table preserve used + unused = total at the same snapshot', () => display(() => {
  const f = fixture(), before = JSON.stringify([f.point, f.projection]);
  const html = f.owner.renderWeeklyValuePanel('codex');
  assert.equal(f.projectionReads(), 1, 'one supplied projection must feed chart and tables');
  assert.equal(JSON.stringify([f.point, f.projection]), before, 'rendering must not rewrite usage or snapshots');
  const estimateRows = rows(details(html, 'weekly-estimate-details'));
  assert.equal(estimateRows.length, 1, 'one selected cycle summary replaces extra raw-sample rows');
  const [selected] = estimateRows;
  assert.equal(selected.length, 7);
  assert.equal(selected[3], money(USED)); assert.equal(selected[2], money(FULL));
  assert.equal(selected[4], money(UNUSED));
  assert.match(selected[5], /71%/);
  assert.equal(sampleAmount(selected[6]), money(USED), 'preserve sample evidence separately from inferred cycle use');
  assert.equal(selected[1], I18n.t.weeklyValue.accountUnassigned);
  const cents = (cell: string) => Math.round(Number(cell.replace(/[^\d.]/g, '')) * 100);
  assert.equal(cents(selected[3]) + cents(selected[4]), cents(selected[2]));
  const estimatedChart = chart(html, 'weekly-estimate-chart');
  const labels = barLabels(estimatedChart);
  assert.equal(labels.length, estimateRows.length, 'chart and table describe the same selected cycle');
  const asOf = new Intl.DateTimeFormat(I18n.getLocale(), { year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: I18n.getTimezone() || undefined })
    .format(new Date(f.projection.entries[1].observedAt));
  assert.ok(selected[5].startsWith(asOf + '<span'), 'the table retains the selected observation time');
  assert.ok(labels.every(label => label.includes(I18n.t.weeklyValue.estimateAsOf + ': ' + asOf)));
  assert.ok(labels.some(label => [USED, UNUSED, FULL].every(value => label.includes(money(value)))),
    'one estimate bar must expose 860.87 used + 351.62 unused = 1212.49 total');
  assert.ok(labels.every(label => !label.includes(money(ACTUAL))), 'local actual is not the estimate numerator');
  assert.match(estimatedChart, /class="stack-seg seg-input" style="height:(?!0\.00)\d+\.\d{2}px"/);
  assert.match(estimatedChart, /class="stack-seg seg-cache-read" style="height:(?!0\.00)\d+\.\d{2}px"/);
}));

test('all locales retain unassigned ownership and omit approximation symbols from USD and converted cells', () => display(() => {
  for (const locale of locales) for (const currency of ['USD', 'EUR'] as const) {
    I18n.setLanguage(locale); I18n.setCurrencyDisplay(currency);
    const f = fixture(), html = f.owner.renderWeeklyValuePanel('codex');
    assert.doesNotMatch(html, /fixture-local-series|accountScopeKey|sourceKey/);
    const tables = [details(html, 'weekly-estimate-details')];
    for (const table of tables) for (const row of rows(table)) {
      assert.equal(row.length, 7);
      assert.equal(row[1], I18n.t.weeklyValue.accountUnassigned,
        'complete indexing and source continuity do not identify an account');
      assert.equal(row[2], money(FULL)); assert.equal(row[3], money(USED)); assert.equal(row[4], money(UNUSED));
      assert.equal(sampleAmount(row[6]), money(USED));
      for (const cell of row) assert.doesNotMatch(cell, /[≈~∼]/);
    }
    assert.equal(f.projectionReads(), 1);
  }
}));

test('account delta interval evidence remains separate from inferred whole-cycle use', () => display(() => {
  const f = fixture(), entry = f.projection.entries[1];
  entry.method = 'account-delta-v1'; entry.usedEquivalentUsd = 30;
  entry.fullEquivalentUsd = 150; entry.unusedEquivalentUsd = 90;
  entry.utilizationPercent = 40; entry.calibrationStart = entry.observedAt - 3_600_000;
  f.projection.entries = [entry];
  const html = f.owner.renderWeeklyValuePanel('codex');
  const records = details(html, 'weekly-estimate-details'), [row] = rows(records);
  assert.match(records, /<th>Inferred used \(estimate\)<\/th>/);
  assert.match(records, /<th>Calibration evidence<\/th>/);
  assert.doesNotMatch(records, /<th>Sample estimate<\/th>/);
  assert.equal(row.length, 7);
  assert.equal(row[3], money(60)); assert.equal(row[2], money(150));
  assert.equal(row[4], money(90)); assert.equal(sampleAmount(row[6]), money(30));
  assert.ok(evidence(row[6]).includes(I18n.t.weeklyValue.accountDeltaEstimate));
  assert.ok(barLabels(chart(html, 'weekly-estimate-chart')).some(label =>
    [60, 90, 150].every(amount => label.includes(money(amount)))));
}));

test('historical estimates remain visible without a second local statistics surface', () => display(() => {
  const f = fixture(), history = { ...f.point, resetAt: RESET - 7 * DAY,
    windowStart: RESET - 14 * DAY, current: false, usedEquivalentUsd: 6059 };
  f.owner.weeklyValuePoints = () => [f.point, history];
  f.projection.entries.push({ ...f.projection.entries[1], resetAt: history.resetAt,
    windowStart: history.windowStart, observedAt: history.resetAt - 3_600_000 });
  const html = f.owner.renderWeeklyValuePanel('codex');
  assert.equal(barLabels(chart(html, 'weekly-estimate-chart')).length, 2);
  const records = rows(details(html, 'weekly-estimate-details'));
  assert.equal(records.length, 2, 'one latest monetary row per cycle, including the historical cycle');
  assert.ok(records.every(row => row[2] === money(FULL) && row[3] === money(USED) && row[4] === money(UNUSED)),
    'the competing older observation must not become a duplicate cycle row');
  for (const row of records) assert.equal(sampleAmount(row[6]), money(USED));
  assert.doesNotMatch(html, /weekly-actual-chart|weekly-value-details/);
}));

test('Codex local seven-day buckets and total stay identical when the quota reset changes', () => display(() => {
  const p: any = Object.create(Provider.prototype);
  const usage = [
    { timestamp: NOW - 1_000, equivalentUsd: ACTUAL, pricedTokens: 100, totalTokens: 100 },
    { timestamp: NOW - 8 * DAY, equivalentUsd: 6059, pricedTokens: 100, totalTokens: 100 },
  ];
  let resetAt = RESET;
  p.weeklyValueInputs = () => ({ usage, localHistoryComplete: true,
    observations: [{ provider: 'codex', seriesKey: 'unassigned', resetAt,
      observedAt: NOW - 3_600_000, usedPercent: 71 }] });
  const before: WeeklyValuePoint[] = p.weeklyValuePoints('codex');
  resetAt += 2 * DAY + 2 * 3_600_000;
  const after: WeeklyValuePoint[] = p.weeklyValuePoints('codex');
  assert.deepEqual(after, before, 'local statistics must not rephase to the latest quota reset');
  assert.equal(Math.round(after.reduce((sum, point) => sum + point.usedEquivalentUsd, 0) * 100), 701287);
  assert.ok(after.every(point => point.basis === 'calendar-usage' && point.utilizationPercent === null &&
    point.fullEquivalentUsd === null && point.unusedEquivalentUsd === null));
}));

test('Codex with local usage but no estimates keeps records and an empty state without local bars', () => display(() => {
  const p: any = Object.create(Provider.prototype);
  p.setting = (_key: string, fallback: unknown) => fallback;
  p.weeklyValueInputs = () => ({ observations: [], localHistoryComplete: true,
    usage: Array.from({ length: 15 }, (_, index) => ({ timestamp: NOW - index * 7 * DAY - 1_000,
      equivalentUsd: 1, pricedTokens: 1, totalTokens: 1 })) });
  p.weeklyEstimateProjection = () => ({ status: 'ready', entries: [] });
  const html = p.renderWeeklyValuePanel('codex');
  assert.doesNotMatch(html, /weekly-actual-chart|weekly-value-details|weekly-estimate-chart/);
  assert.ok(html.includes('data-cycle-monetary-pending') && html.includes(I18n.t.weeklyValue.monetaryPending),
    'no estimates has a visible missing-evidence state, not invented local capacity');
  assert.equal(rows(details(html, 'weekly-estimate-details')).length, 0);
}));

test('unassigned legacy estimates retain numbers with low confidence and no current-account cycle claim in all locales', () => display(() => {
  for (const locale of locales) {
    I18n.setLanguage(locale);
    const html = fixture().owner.renderWeeklyValuePanel('codex'), copy = I18n.t.weeklyValue;
    const labels = barLabels(chart(html, 'weekly-estimate-chart'));
    assert.equal(labels.length, 1);
    assert.ok(labels[0].includes(copy.accountUnassigned));
    assert.ok(labels[0].includes(copy.low));
    assert.ok(!labels[0].includes(copy.currentPeriod));
    assert.ok(!labels[0].includes(copy.currentPeriodShort));
    assert.ok(labels[0].includes(money(FULL)));
    assert.ok(labels[0].includes(copy.estimateReference));
    const [row] = rows(details(html, 'weekly-estimate-details'));
    assert.equal(row[1], copy.accountUnassigned);
    assert.equal(sampleAmount(row[6]), money(USED));
    assert.ok(row[6].includes(copy.estimateAccountUnknown), 'audit evidence must retain the ownership limitation');
  }
}));

test('same-schedule reset cycles disclose actual bounds, uncertainty and planned reset in eight locales', () => display(() => {
  for (const locale of locales) {
    I18n.setLanguage(locale);
    const f = fixture();
    f.projection.entries = [
      { ...f.projection.entries[0], method: 'account-delta-v1', accountNumber: 2,
        quotaEpoch: { startedAt: NOW - 4 * 3_600_000,
        resetAnchorAt: RESET, startLowerAt: null, reason: 'reset-change' },
        quotaCycle: { id: NOW - 4 * 3_600_000, startAt: null, startLowerAt: null,
          endAt: NOW - 90 * 60_000, endLowerAt: NOW - 2 * 3_600_000,
          closed: true, scheduledResetAt: RESET, boundaryUncertain: true } },
      { ...f.projection.entries[1], method: 'account-delta-v1', accountNumber: 2,
        quotaEpoch: { startedAt: NOW - 90 * 60_000,
        resetAnchorAt: RESET, startLowerAt: NOW - 2 * 3_600_000, reason: 'counter-drop' },
        quotaCycle: { id: NOW - 90 * 60_000, startAt: NOW - 90 * 60_000, startLowerAt: NOW - 2 * 3_600_000,
          endAt: RESET, endLowerAt: null, closed: false, scheduledResetAt: RESET, boundaryUncertain: true } },
    ];
    const html = f.owner.renderWeeklyValuePanel('codex');
    const records = details(html, 'weekly-estimate-details');
    const labels = barLabels(chart(html, 'weekly-estimate-chart'));
    assert.equal(labels.length, 2, 'the same planned reset can contain two distinct actual reset cycles');
    assert.equal(rows(records).length, 2);
    const copy = I18n.t.weeklyValue;
    const date = (at: number) => new Intl.DateTimeFormat(I18n.getLocale(), { year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: I18n.getTimezone() || undefined }).format(new Date(at));
    const bounds = '(' + date(NOW - 2 * 3_600_000) + ' – ' + date(NOW - 90 * 60_000) + ']';
    assert.ok(labels.some(label => label.includes(copy.cycleStartUnknown) && label.includes(copy.cycleEnd + ': ' + bounds)));
    assert.ok(labels.some(label => label.includes(copy.cycleStart + ': ' + bounds) && !label.includes(copy.cycleEnd + ':')));
    for (const label of labels) {
      assert.ok(label.includes(copy.scheduledReset + ': ' + date(RESET)));
      assert.ok(label.includes(copy.cycleBoundaryUncertain));
      assert.ok(label.includes(copy.estimateAsOf + ':'));
      assert.ok(!label.includes(copy.observationSegment));
    }
    for (const text of [copy.cycleStartUnknown, copy.cycleStart + ': ' + bounds, copy.cycleEnd + ': ' + bounds,
      copy.scheduledReset + ': ' + date(RESET), copy.cycleBoundaryUncertain]) assert.ok(records.includes(text));
    const axis = [...chart(html, 'weekly-estimate-chart').matchAll(/<div class="hc-xlabel"[^>]*>([\s\S]*?)<\/div>/g)];
    assert.equal(axis.length, 2);
    for (const [, label] of axis) {
      assert.match(label, /^<span>\d{1,2}\/\d{1,2}<\/span><span>#2<\/span>$/);
    }
    assert.doesNotMatch(records, /manual reset|confirmed reset|手动重置|手動重設/i);
  }
}));
