import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import { SupportedLanguage } from '../types';

class Markdown {
  value = '';
  appendMarkdown(value: string): this { this.value += value; return this; }
}
const loader = require('node:module');
const originalLoad = loader._load;
loader._load = function (name: string, ...args: any[]): any {
  return name === 'vscode' ? { MarkdownString: Markdown } : originalLoad.call(this, name, ...args);
};
let Manager: typeof import('../statusBar').StatusBarManager;
try { Manager = require('../statusBar').StatusBarManager; } finally { loader._load = originalLoad; }

const WEEK = 7 * 24 * 60 * 60_000;
const START = Date.parse('2026-10-01T00:00:00Z');
const T = START + WEEK / 4;
const quota = { seven_day: { utilization: 29, resets_at: new Date(START + WEEK).toISOString() } };
const item = (): any => ({ text: '', show() {}, hide() {} });
function manager(): any {
  const m = Object.create(Manager.prototype);
  Object.assign(m, { provider: 'claude', showCost: true, usageLimitTracking: true, resetCountdownFormat: 'decimal',
    quotaItem: item(), statusBarItem: item(), contextItem: item() });
  return m;
}
const evidence = (): any => ({ observedAt: T, source: 'observed', accountWindowTrust: 'trusted',
  windows: [{ slot: 0, kind: 'weekly_all', periodMs: WEEK, resetAt: START + WEEK, usedPercent: 29 }] });
function at(now: number, run: () => void): void {
  const original = Date.now;
  Date.now = () => now;
  try { run(); } finally { Date.now = original; }
}
function enable(m: any, enabled: boolean): void {
  m.setVisibility(true, true, true, 'cost', false, false, false, 'decimal', '{7d.pct}', enabled);
}

test('pace appends to tooltip only, preserves custom bar text, and turns off immediately', () => at(T, () => {
  I18n.setLanguage('en');
  const m = manager();
  enable(m, false);
  m.updateQuota(quota, evidence());
  const originalTooltip = m.quotaItem.tooltip.value;
  assert.equal(m.quotaItem.text, '$(dashboard) 29%');
  enable(m, true);
  m.updateQuota(quota, evidence());
  assert.match(m.quotaItem.tooltip.value, /116%/);
  assert.match(m.quotaItem.tooltip.value, /25%/);
  assert.equal(m.quotaItem.text, '$(dashboard) 29%');
  enable(m, false);
  assert.equal(m.quotaItem.tooltip.value, originalTooltip);
}));

test('missing raw observation time, stale snapshots and expired synthetic zeros have no forecast', () => at(T, () => {
  const m = manager();
  enable(m, true);
  m.updateQuota(quota);
  assert.doesNotMatch(m.quotaItem.tooltip.value, /116%/);
  m.updateQuota(quota, evidence());
  assert.match(m.quotaItem.tooltip.value, /116%/);
  at(T + 31 * 60_000, () => { m.setProvider('claude'); assert.doesNotMatch(m.quotaItem.tooltip.value, /116%/); });
  at(START + WEEK + 60_000, () => { m.setProvider('claude'); assert.doesNotMatch(m.quotaItem.tooltip.value, /116%/); });
}));

test('tooltip local copy covers all eight locales and explains inferred account-wide cycle', () => at(T, () => {
  const previous = I18n.getLocale() as SupportedLanguage;
  const headings = ['Weekly quota pace', 'Wöchentliches Kontingenttempo', '週額度使用節奏', '周额度使用节奏', '週間クォータの使用ペース', '주간 할당량 사용 속도', 'Ritmo da cota semanal', 'Laju kuota mingguan'];
  try {
    for (const [index, language] of (['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'] as SupportedLanguage[]).entries()) {
      I18n.setLanguage(language);
      const m = manager();
      enable(m, true);
      m.updateQuota(quota, evidence());
      assert.ok(m.quotaItem.tooltip.value.includes(headings[index]), language);
      assert.match(m.quotaItem.tooltip.value, /116%/);
    }
  } finally { I18n.setLanguage(previous); }
}));

test('Codex pace consumes the provided trusted DTO, never infers account identity from a label', () => at(T, () => {
  const m = manager();
  m.showWeeklyQuotaPace = true;
  const limit = { provider: 'codex', observedAt: T, source: 'local-log', confidence: 'last-observed',
    windows: [{ label: 'secondary', windowMinutes: 10080, usedPercent: 29, resetsAt: START + WEEK }] };
  assert.doesNotMatch(m.createCodexQuotaTooltip(limit, T).value, /116%/);
  assert.match(m.createCodexQuotaTooltip(limit, T, evidence()).value, /116%/);
  assert.doesNotMatch(m.createCodexQuotaTooltip(limit, T + 31 * 60_000, evidence()).value, /116%/);
}));

test('normalizer fallback zero and unknown weekly kind never acquire forecast authority', () => at(T, () => {
  I18n.setLanguage('en');
  const m = manager();
  enable(m, true);
  const zero = evidence();
  zero.windows[0].usedPercent = 0;
  m.updateQuota({ seven_day: { utilization: NaN, resets_at: quota.seven_day.resets_at } }, zero);
  assert.doesNotMatch(m.quotaItem.tooltip.value, /Weekly quota pace/);
  zero.windows[0].kind = 'weekly_scoped';
  m.updateQuota({ limits: [{ kind: 'unknown_future_kind', group: 'weekly', percent: 0,
    resets_at: quota.seven_day.resets_at, scope: { surface: 'Mystery' } }] }, zero);
  assert.doesNotMatch(m.quotaItem.tooltip.value, /Weekly quota pace/);
}));

test('early sample shows reference only and scoped weekly rows keep their independent names', () => {
  I18n.setLanguage('en');
  const early = START + 60 * 60_000;
  at(early, () => {
    const m = manager();
    enable(m, true);
    const pace = evidence();
    pace.observedAt = early;
    m.updateQuota(quota, pace);
    assert.match(m.quotaItem.tooltip.value, /Insufficient sample/);
    assert.match(m.quotaItem.tooltip.value, /Reference progress 1%/);
    assert.doesNotMatch(m.quotaItem.tooltip.value, /Estimated at reset/);
  });
  at(T, () => {
    const m = manager();
    enable(m, true);
    const pace = evidence();
    pace.windows.push({ ...pace.windows[0], slot: 1, kind: 'weekly_scoped', usedPercent: 40 });
    m.updateQuota({ limits: [
      { kind: 'weekly_all', percent: 29, resets_at: quota.seven_day.resets_at },
      { kind: 'weekly_scoped', percent: 40, resets_at: quota.seven_day.resets_at, scope: { model: { display_name: 'Fable' } } },
    ] }, pace);
    assert.match(m.quotaItem.tooltip.value, /Weekly \(All\): Used 29%/);
    assert.match(m.quotaItem.tooltip.value, /Weekly \(Fable\): Used 40%.*160%/);
  });
});

test('tracking off and pace off retain no pace evidence or predictions', () => at(T, () => {
  const m = manager();
  enable(m, false);
  m.updateQuota(quota, evidence(), evidence());
  assert.equal(m.lastClaudePace, null);
  assert.equal(m.previousClaudePace, null);
  enable(m, true);
  m.updateQuota(quota, evidence());
  m.setVisibility(true, true, false, 'cost', false, false, false, 'decimal', '', true);
  assert.equal(m.lastClaudePace, null);
  assert.equal(m.showWeeklyQuotaPace, false);
}));

test('mismatched pace DTO cannot describe a different rendered Codex snapshot', () => at(T, () => {
  const m = manager();
  m.showWeeklyQuotaPace = true;
  const limit = { provider: 'codex', observedAt: T + 1, source: 'local-log', confidence: 'last-observed',
    windows: [{ windowMinutes: 10080, usedPercent: 29, resetsAt: START + WEEK }] };
  assert.doesNotMatch(m.createCodexQuotaTooltip(limit, T, evidence()).value, /116%/);
  limit.observedAt = T;
  limit.windows[0].usedPercent = 40;
  assert.doesNotMatch(m.createCodexQuotaTooltip(limit, T, evidence()).value, /116%/);
  limit.windows[0].usedPercent = 29;
  assert.doesNotMatch(m.createCodexQuotaTooltip({ ...limit, limitId: 'spark', limitName: 'Codex' }, T, evidence()).value, /116%/);
  assert.doesNotMatch(m.createCodexQuotaTooltip({ ...limit, confidence: 'unknown' }, T, evidence()).value, /116%/);
}));

test('public Codex updates preserve pace across provider changes and remove it immediately on OFF', () => at(T, () => {
  I18n.setLanguage('en');
  const m = manager();
  m.provider = 'codex';
  enable(m, true);
  const scope = { total: { processed: 100, fresh: 75, output: 25, reasoning: 0 }, childThreads: 0 };
  const limit = { provider: 'codex', observedAt: T, source: 'local-log', confidence: 'last-observed',
    windows: [{ windowMinutes: 10080, usedPercent: 29, resetsAt: START + WEEK }] };
  m.updateCodex(scope, 'processed', limit, evidence());
  assert.equal(m.quotaItem.text, '$(dashboard) wk 71%');
  assert.match(m.quotaItem.tooltip.value, /116%/);
  m.setProvider('claude');
  m.setProvider('codex');
  assert.match(m.quotaItem.tooltip.value, /116%/);
  enable(m, false);
  assert.equal(m.lastCodex.pace, null);
  assert.equal(m.lastCodex.previousPace, null);
  assert.equal(m.quotaItem.text, '$(dashboard) wk 71%');
  assert.doesNotMatch(m.quotaItem.tooltip.value, /116%/);
  enable(m, true);
  m.updateCodex(scope, 'processed', limit, evidence());
  at(T + 31 * 60_000, () => {
    m.setProvider('codex');
    assert.doesNotMatch(m.quotaItem.tooltip.value, /116%/);
  });
  m.clearCodex();
  assert.equal(m.lastCodex, null);
}));
