import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';

const loader = require('node:module'), original = loader._load;
loader._load = function(name: string, ...args: unknown[]) {
  return name === 'vscode' ? {} : original.call(this, name, ...args);
};
let Provider: typeof import('../webview').UsageWebviewProvider;
try { Provider = require('../webview').UsageWebviewProvider; } finally { loader._load = original; }

const day = 86_400_000, reset = Date.parse('2026-10-26T12:00:00Z'), now = reset - day;
function entry(id = 1, accountNumber = 1): any {
  return { provider: 'codex', method: 'account-delta-v1', accountNumber, sourceKey: 'private-source',
    accountScopeKey: 'private-account-' + accountNumber, windowStart: reset - 7 * day, resetAt: reset,
    observedAt: now - 60_000, estimatedAt: now, usedEquivalentUsd: 7,
    fullEquivalentUsd: 100, unusedEquivalentUsd: 60, utilizationPercent: 40, pricingCoverage: 1, flags: [],
    quotaEpoch: { startedAt: reset - 2 * day, resetAnchorAt: reset, startLowerAt: null, reason: 'initial' },
    quotaCycle: { id: reset - 2 * day + (id - 1) * 1000, startAt: reset - 10 * day, startLowerAt: reset - 10 * day,
      endAt: reset, endLowerAt: null, closed: false, scheduledResetAt: reset, boundaryUncertain: false } };
}
function owner(entries: any[]): any {
  const p: any = Object.create(Provider.prototype);
  p.setting = (_key: string, fallback: unknown) => fallback;
  p.weeklyEstimateProjection = () => ({ entries, status: 'ready' });
  p.weeklyValuePoints = () => [];
  p.codexView = { periodCoverage: { allTime: { complete: true } } };
  return p;
}
function run(body: () => void) {
  const clock = Date.now, locale = I18n.getCurrentLanguage(), zone = I18n.getTimezone();
  Date.now = () => now; I18n.setLanguage('en'); I18n.setTimezone('UTC');
  try { body(); } finally { Date.now = clock; I18n.setLanguage(locale); I18n.setTimezone(zone); }
}
function labels(html: string): string[] {
  return [...html.matchAll(/<div class="hc-xlabel"[^>]*>([\s\S]*?)<\/div>/g)].map(match => match[1]);
}

test('Codex compares ten-day reset cycles with short two-line account labels and complete accessible bounds', () => run(() => {
  const html = owner([entry()]).renderWeeklyValuePanel('codex');
  assert.match(html, /Cycle allowance · API-equivalent estimate/);
  assert.doesNotMatch(html, /Weekly subscription allowance/);
  const axis = labels(html); assert.equal(axis.length, 1);
  assert.match(axis[0], /^<span[^>]*>10\/26<\/span><span[^>]*>#1<\/span>$/);
  const title = html.match(/role="img" aria-label="([^"]*)"/)?.[1] ?? '';
  assert.match(title, /Cycle start: Oct 16, 2026/);
  assert.match(title, /Scheduled reset: Oct 26, 2026/);
  assert.match(title, /As of observation: Oct 25, 2026/);
  assert.match(title, /Inferred used \(estimate\): \$40\.00/);
  assert.match(title, /Unused estimate: \$60\.00/);
  assert.doesNotMatch(title, /Oct 19|Oct 24|private-/);
  const records = owner([entry()]).renderWeeklyEstimateRecords('codex');
  assert.match(records, /<th>Period<\/th>/); assert.match(records, /Cycle start: Oct 16, 2026/);
}));

test('same-cycle observations and calibration segments yield one bar and one latest table row per account', () => run(() => {
  const earlier = entry(), latest = { ...entry(), observedAt: now - 1, estimatedAt: now,
    unusedEquivalentUsd: 55, quotaEpoch: { ...entry().quotaEpoch, startedAt: now - 1000 } };
  const other = entry(1, 2), entries = [earlier, latest, other], before = JSON.stringify(entries);
  const html = owner(entries).renderWeeklyValuePanel('codex');
  assert.equal(labels(html).length, 2);
  const records = html.split('<tbody>')[1].split('</tbody>')[0];
  assert.equal((records.match(/<tr>/g) ?? []).length, 2);
  assert.match(records, /\$45\.00/); assert.doesNotMatch(records, /\$40\.00<\/td>.*Account 1/);
  assert.ok(labels(html).some(label => label.includes('>#1<')));
  assert.ok(labels(html).some(label => label.includes('>#2<')));
  assert.equal(JSON.stringify(entries), before);
}));

test('early reset labels the actual closed boundary, retains its old schedule and brackets uncertain bounds', () => run(() => {
  const sample = entry(); sample.observedAt = reset - 4 * day;
  sample.quotaEpoch.startedAt = reset - 5 * day;
  sample.quotaCycle = { ...sample.quotaCycle, id: sample.quotaEpoch.startedAt,
    startAt: reset - 6 * day, startLowerAt: reset - 6 * day - 60_000,
    endAt: reset - 3 * day, endLowerAt: reset - 3 * day - 60_000, closed: true, boundaryUncertain: true };
  const html = owner([sample]).renderWeeklyValuePanel('codex');
  assert.match(labels(html)[0], />10\/23</);
  const title = html.match(/role="img" aria-label="([^"]*)"/)?.[1] ?? '';
  assert.match(title, /Cycle end: \(Oct 23, 2026/);
  assert.match(title, /Scheduled reset: Oct 26, 2026/);
  assert.match(title, /Boundary uncertain/); assert.match(title, /\]/);
  const table = html.split('<tbody>')[1]; assert.match(table, /Cycle end: \(Oct 23, 2026/);
  assert.match(table, /Boundary uncertain/);
}));

test('unknown cycle start and legacy unassigned references never invent reset-minus-seven-days', () => run(() => {
  const unknown = entry(); unknown.quotaCycle.startAt = null; unknown.quotaCycle.startLowerAt = null;
  const legacy = entry(2); delete legacy.quotaCycle; delete legacy.quotaEpoch; delete legacy.accountNumber;
  legacy.method = 'series-prefix-v1'; legacy.observedAt -= 1000;
  const html = owner([unknown, legacy]).renderWeeklyValuePanel('codex');
  assert.match(html, /Cycle start unknown/); assert.match(html, /Reference estimate · not an account cycle/);
  assert.match(html, /Unassigned/); assert.doesNotMatch(html, /Oct 19, 2026|private-source|private-account/);
}));

test('Codex defaults to at most 48 cycles rather than eight observations or days', () => run(() => {
  const entries = Array.from({ length: 52 }, (_, index) => {
    const sample = entry(index + 1); const shift = index * 11 * day;
    sample.windowStart -= shift; sample.resetAt -= shift; sample.observedAt -= shift; sample.estimatedAt -= shift;
    sample.quotaEpoch.startedAt -= shift; sample.quotaEpoch.resetAnchorAt -= shift;
    sample.quotaCycle = { ...sample.quotaCycle, id: sample.quotaCycle.id - shift, startAt: sample.quotaCycle.startAt - shift,
      startLowerAt: sample.quotaCycle.startLowerAt - shift, endAt: sample.resetAt,
      scheduledResetAt: sample.resetAt, closed: index > 0, endLowerAt: index > 0 ? sample.resetAt : null };
    return sample;
  });
  const html = owner(entries).renderWeeklyValuePanel('codex'); assert.equal(labels(html).length, 48);
  assert.equal((html.split('<tbody>')[1].match(/<tr>/g) ?? []).length, 52);
}));

test('uncalibrated audit rows remain readable without adding another cycle bar', () => run(() => {
  const unavailable = { ...entry(), observedAt: now, fullEquivalentUsd: null, unusedEquivalentUsd: null };
  const html = owner([entry(), unavailable]).renderWeeklyValuePanel('codex');
  assert.equal(labels(html).length, 1);
  const records = html.split('<tbody>')[1].split('</tbody>')[0];
  assert.equal((records.match(/<tr>/g) ?? []).length, 2);
  assert.match(records, /No usable conversion sample/);
  assert.match(records, /<td class="cost-cell">—<\/td>/);
}));

test('unknown accounts use a compact axis marker while full attribution remains in the tooltip', () => run(() => {
  const unknown = entry(); unknown.accountNumber = undefined; unknown.quotaCycle.referenceOnly = true;
  const html = owner([unknown]).renderWeeklyValuePanel('codex');
  assert.match(html, /<span>\d{1,2}\/\d{1,2}<\/span><span>\?<\/span>/);
  assert.ok(html.includes(I18n.t.weeklyValue.accountUnassigned));
}));

test('numbered legacy references remain explicitly low confidence and never claim a current account cycle', () => run(() => {
  for (const epoch of [true, false]) for (const projectedCycle of [true, false]) {
    const sample = entry();
    sample.quotaCycle = { ...sample.quotaCycle, startAt: null, startLowerAt: null, referenceOnly: true };
    if (!epoch) delete sample.quotaEpoch;
    if (!projectedCycle) delete sample.quotaCycle;
    const p = owner([sample]);
    p.setting = (key: string, fallback: unknown) => key === 'codex.officialQuota.enabled' ? true : fallback;
    p.weeklyEstimateProjection = () => ({ entries: [sample], status: 'ready', activeAccountNumber: 1,
      officialQuota: { status: 'ready', accountNumber: 1, observedAt: sample.observedAt, resetAt: reset, usedPercent: 40 } });
    const html = p.renderWeeklyValuePanel('codex');
    const title = html.match(/role="img" aria-label="([^"]*)"/)?.[1] ?? '';
    assert.match(title, /Account 1.*Low · Reference estimate · not an account cycle/);
    assert.match(title, /Cycle start unknown/);
    assert.doesNotMatch(title, /Current period|Oct 19, 2026/);
    assert.doesNotMatch(labels(html).join(''), /Current/);
    const records = html.split('<tbody>')[1];
    assert.match(records, /Low · Reference estimate · not an account cycle/);
    assert.match(html.split('<details')[0], /<p class="table-hint">Low · Reference estimate/);
  }
}));

test('cycle presentation has translated title, boundary and schedule copy in all eight locales; Claude keeps its title', () => run(() => {
  const titles = ['Cycle allowance', 'Zykluskontingent', '週期額度', '周期额度', '周期クォータ', '주기 할당량', 'Cota por ciclo', 'Kuota per siklus'];
  const locales: SupportedLanguage[] = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
  const english = I18n.t.weeklyValue;
  const closed = entry(); closed.quotaCycle.closed = true; closed.quotaCycle.boundaryUncertain = true;
  closed.quotaCycle.endLowerAt = reset - 60_000;
  const unknown = entry(2, 2); unknown.quotaCycle.startAt = null; unknown.quotaCycle.startLowerAt = null;
  locales.forEach((locale, index) => {
    I18n.setLanguage(locale);
    const p = owner([closed, unknown]); p.codexView.periodCoverage.allTime.complete = false;
    const html = p.renderWeeklyValuePanel('codex'); assert.ok(html.includes(titles[index]));
    for (const key of ['cycleStart', 'cycleEnd', 'cycleStartUnknown', 'cycleBoundaryUncertain', 'scheduledReset', 'cycleChartNote', 'cycleIndexedSubtotal']) {
      const value = Reflect.get(I18n.t.weeklyValue, key); assert.equal(typeof value, 'string');
      assert.ok(value.trim()); assert.ok(html.includes(value), `${locale}.${key} is visible`);
      if (locale !== 'en') assert.notEqual(value, Reflect.get(english, key), `${locale}.${key} is translated`);
    }
    assert.ok(owner([]).renderWeeklyValuePanel('claude').includes(I18n.t.weeklyValue.title));
  });
}));
