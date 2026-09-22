// Wiring test for the fill thresholds. quotaFormat.test.ts pins the pairs
// themselves; this pins which indicator gets which, because the interesting
// failure is a correct pair handed to the wrong bar. statusBar.ts imports
// vscode, so the module is loaded against a stub (see extensionWindowActivity).

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { CONTEXT_FILL_THRESHOLDS, QUOTA_FILL_THRESHOLDS, fillLevel } from '../quotaFormat';
import { I18n } from '../i18n';

const GREEN = '#4caf50';
const AMBER = '#ff9800';
const RED = '#f44336';

type StatusBarModule = typeof import('../statusBar');

/** Records the id it was constructed with, so a background assertion can name
 * the theme colour rather than compare opaque stubs. */
class RecordingThemeColor {
  constructor(public readonly id: string) {}
}

class RecordingMarkdownString {
  value = '';
  supportThemeIcons = false;
  supportHtml = false;

  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }
}

function loadStatusBarModule(): StatusBarModule {
  const moduleLoader = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const vscodeStub: any = new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === 'then') {
        return undefined;
      }
      if (property === 'ThemeColor') {
        return RecordingThemeColor;
      }
      if (property === 'MarkdownString') {
        return RecordingMarkdownString;
      }
      return vscodeStub;
    },
    apply: () => vscodeStub,
    construct: () => vscodeStub,
  });
  moduleLoader._load = function (request, parent, isMain): unknown {
    if (request === 'vscode') {
      return vscodeStub;
    }
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try {
    return require('../statusBar') as StatusBarModule;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

const { StatusBarManager } = loadStatusBarModule();

/** The prototype alone — the real constructor builds live status-bar items. */
function bareStatusBar(): any {
  return Object.create(StatusBarManager.prototype) as any;
}

function statusItem(): any {
  return {
    text: '',
    tooltip: undefined,
    backgroundColor: undefined,
    visible: false,
    show(): void { this.visible = true; },
    hide(): void { this.visible = false; },
  };
}

function codexScope(): any {
  return {
    total: {
      processed: 5_000_000,
      fresh: 1_000_000,
      input: 4_500_000,
      cachedInput: 3_500_000,
      output: 500_000,
      reasoning: 100_000,
    },
    rootTasks: 1,
    threads: 1,
    childThreads: 0,
    childProcessedShare: 0,
    childFreshShare: 0,
    approvalReviewerThreads: 0,
    approvalReviewerFreshShare: 0,
    cacheShare: 0.7,
    durationMs: 1_000,
    structural: {
      patchCalls: 0,
      toolCalls: 0,
      postPatchToolCalls: 0,
      compactCount: 0,
      taskCompleteCount: 0,
    },
    models: [],
    efforts: [],
  };
}

/** The fill colour the bar paints, read back off the rendered spans. The inner
 * span carries the fill; the outer track is always #bbbbbb. */
function barColor(pct: number, thresholds?: unknown): string {
  const html: string =
    thresholds === undefined
      ? bareStatusBar().progressBarSvg(pct)
      : bareStatusBar().progressBarSvg(pct, 24, thresholds);
  const fills = [GREEN, AMBER, RED].filter((c) => html.includes(c));
  assert.equal(fills.length, 1, `expected exactly one fill colour in ${html}`);
  return fills[0];
}

test('a quota bar defaults to the quota thresholds', () => {
  // The default matters: every quota row and the credits row rely on it.
  assert.equal(barColor(74), GREEN);
  assert.equal(barColor(75), AMBER);
  assert.equal(barColor(89), AMBER);
  assert.equal(barColor(90), RED);
});

test('the context bar is explicitly given the later thresholds', () => {
  assert.equal(barColor(79, CONTEXT_FILL_THRESHOLDS), GREEN);
  assert.equal(barColor(80, CONTEXT_FILL_THRESHOLDS), AMBER);
  assert.equal(barColor(94, CONTEXT_FILL_THRESHOLDS), AMBER);
  assert.equal(barColor(95, CONTEXT_FILL_THRESHOLDS), RED);
});

test('the two bars disagree in the bands the split created', () => {
  // 77% is the whole point of the change: quota warns, context stays quiet.
  assert.equal(barColor(77, QUOTA_FILL_THRESHOLDS), AMBER);
  assert.equal(barColor(77, CONTEXT_FILL_THRESHOLDS), GREEN);
  assert.equal(barColor(92, QUOTA_FILL_THRESHOLDS), RED);
  assert.equal(barColor(92, CONTEXT_FILL_THRESHOLDS), AMBER);
});

test('the track is drawn even when the fill is empty', () => {
  const html: string = bareStatusBar().progressBarSvg(0);
  assert.ok(html.includes('#bbbbbb'), 'the gray track must survive a 0% fill');
});

test('item background follows the same level as the bar', () => {
  const bg = (pct: number, thresholds: unknown): string | undefined =>
    bareStatusBar().fillBackground(fillLevel(pct, thresholds as any))?.id;

  assert.equal(bg(74, QUOTA_FILL_THRESHOLDS), undefined);
  assert.equal(bg(75, QUOTA_FILL_THRESHOLDS), 'statusBarItem.warningBackground');
  assert.equal(bg(90, QUOTA_FILL_THRESHOLDS), 'statusBarItem.errorBackground');
  // Context keeps 80 / 95, so at 77 the item stays uncoloured.
  assert.equal(bg(77, CONTEXT_FILL_THRESHOLDS), undefined);
  assert.equal(bg(80, CONTEXT_FILL_THRESHOLDS), 'statusBarItem.warningBackground');
  assert.equal(bg(95, CONTEXT_FILL_THRESHOLDS), 'statusBarItem.errorBackground');
});

test('provider money bypasses the display-currency estimate conversion', () => {
  I18n.setCurrencyDisplay('EUR');
  try {
    assert.equal(bareStatusBar().formatCreditAmount(12.34, 'USD'), '$12.34');
    assert.equal(bareStatusBar().formatCreditAmount(12.34, 'GBP'), '12.34 GBP');
  } finally {
    I18n.setCurrencyDisplay('USD');
  }
});

test('Codex quota tooltip reuses the Claude table, progress bar, and line-broken notes', () => {
  const now = Date.parse('2026-09-02T12:00:00.000Z');
  const tooltip = bareStatusBar().createCodexQuotaTooltip({
    provider: 'codex',
    observedAt: now - 60_000,
    source: 'local-log',
    confidence: 'last-observed',
    windows: [{
      label: 'primary',
      usedPercent: 36,
      windowMinutes: 7 * 24 * 60,
      resetsAt: now + 5 * 24 * 60 * 60 * 1000,
    }],
  }, now) as RecordingMarkdownString;

  assert.match(tooltip.value, /<table>/);
  assert.match(tooltip.value, /Weekly/);
  assert.match(tooltip.value, /36%/);
  assert.match(tooltip.value, /#4caf50/);
  assert.doesNotMatch(tooltip.value, /Codex home · limits/);
  assert.equal(tooltip.supportHtml, true);
});

test('Claude quota visibility follows usage-limit tracking and keeps the all-off navigation icon', () => {
  const manager = bareStatusBar();
  manager.statusBarItem = statusItem();
  manager.quotaItem = statusItem();
  manager.contextItem = statusItem();
  manager.provider = 'claude';
  manager.showCost = true;
  manager.showContext = true;
  manager.usageLimitTracking = true;
  manager.quotaFiveHourOnly = false;
  manager.showResetInBar = false;
  manager.showScopedWeekly = false;
  manager.resetCountdownFormat = 'decimal';
  const resetsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const quota = {
    five_hour: { utilization: 25, resets_at: resetsAt },
    seven_day: { utilization: 40, resets_at: resetsAt },
  };

  manager.setVisibility(true, true, true);
  manager.updateQuota(quota);
  assert.equal(manager.quotaItem.visible, true);
  assert.ok(manager.quotaItem.tooltip);

  manager.setVisibility(false, false, false);
  manager.updateQuota(quota);
  assert.equal(manager.quotaItem.visible, false);
  assert.equal(manager.statusBarItem.visible, true);
  assert.equal(manager.statusBarItem.text, '$(graph)');
});

test('Codex quota visibility follows usage-limit tracking and keeps its navigation icon', () => {
  const manager = bareStatusBar();
  manager.statusBarItem = statusItem();
  manager.quotaItem = statusItem();
  manager.contextItem = statusItem();
  manager.provider = 'codex';
  manager.showCost = true;
  manager.showContext = true;
  manager.usageLimitTracking = true;
  manager.quotaFiveHourOnly = false;
  manager.showResetInBar = false;
  manager.showScopedWeekly = false;
  manager.resetCountdownFormat = 'decimal';
  const resetsAt = Date.now() + 24 * 60 * 60 * 1_000;
  const limit = {
    provider: 'codex',
    observedAt: Date.now() - 60_000,
    source: 'local-log',
    confidence: 'last-observed',
    windows: [
      { label: 'primary', usedPercent: 25, windowMinutes: 300, resetsAt },
      { label: 'secondary', usedPercent: 40, windowMinutes: 10_080, resetsAt },
    ],
  };

  manager.setVisibility(true, true, true);
  manager.renderCodex(codexScope(), 'fresh', limit);
  assert.equal(manager.quotaItem.visible, true);
  assert.ok(manager.quotaItem.tooltip);

  manager.setVisibility(false, true, false);
  manager.renderCodex(codexScope(), 'fresh', limit);
  assert.equal(manager.quotaItem.visible, false);
  assert.equal(manager.statusBarItem.visible, true);
  assert.equal(manager.statusBarItem.text, '$(graph)');
});

test('Codex item warns for the worst rendered window while keeping weekly compact text', () => {
  const manager = bareStatusBar();
  manager.statusBarItem = statusItem();
  manager.quotaItem = statusItem();
  manager.contextItem = statusItem();
  manager.showCost = true;
  manager.showContext = true;
  manager.usageLimitTracking = true;
  manager.quotaFiveHourOnly = false;
  manager.resetCountdownFormat = 'decimal';

  const resetsAt = Date.now() + 24 * 60 * 60 * 1000;
  manager.renderCodex(codexScope(), 'fresh', {
    provider: 'codex',
    observedAt: Date.now() - 60_000,
    source: 'local-log',
    confidence: 'last-observed',
    windows: [
      { label: 'primary', usedPercent: 96, windowMinutes: 300, resetsAt },
      { label: 'secondary', usedPercent: 40, windowMinutes: 10_080, resetsAt },
    ],
  });

  assert.equal(manager.quotaItem.text, '$(dashboard) wk 60%');
  assert.equal(manager.quotaItem.backgroundColor?.id, 'statusBarItem.errorBackground');
  assert.match(manager.quotaItem.tooltip.value, /96%/);
  assert.match(manager.quotaItem.tooltip.value, /#f44336/);
});

test('Codex quota tooltip escapes provider labels', () => {
  const now = Date.parse('2026-09-02T12:00:00.000Z');
  const manager = bareStatusBar();
  manager.quotaFiveHourOnly = false;
  manager.resetCountdownFormat = 'decimal';
  const tooltip = manager.createCodexQuotaTooltip({
    provider: 'codex',
    observedAt: now,
    source: 'local-log',
    confidence: 'last-observed',
    windows: [{
      label: '<unsafe & label>',
      usedPercent: 12,
      resetsAt: now + 60_000,
    }],
  }, now) as RecordingMarkdownString;

  assert.match(tooltip.value, /&lt;unsafe &amp; label&gt;/);
  assert.doesNotMatch(tooltip.value, /<unsafe/);
});

test('the quota format setting reaches the bar text, and its colour follows suit', () => {
  // quotaFormat.test.ts pins the rendering; this pins the half you would
  // otherwise only see in the Extension Development Host — that the template
  // argument setVisibility receives is what the bar ends up drawing.
  const manager = bareStatusBar();
  manager.statusBarItem = statusItem();
  manager.quotaItem = statusItem();
  manager.contextItem = statusItem();
  manager.provider = 'claude';
  const resetsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const quota = {
    five_hour: { utilization: 6, resets_at: resetsAt },
    seven_day: { utilization: 1, resets_at: resetsAt },
    limits: [
      { kind: 'session', group: 'session', percent: 6, resets_at: resetsAt, scope: null, is_active: true },
      { kind: 'weekly_all', group: 'weekly', percent: 1, resets_at: resetsAt, scope: null, is_active: true },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 92,
        resets_at: resetsAt,
        scope: { model: { id: null, display_name: 'Fable' } },
        is_active: true,
      },
    ],
  };

  // Empty template, scoped weeklies off: the built-in layout, and the loud
  // per-model cap it does not draw must not colour the item either.
  manager.setVisibility(true, true, true, 'cost', false, false, false, 'decimal', '');
  manager.updateQuota(quota);
  assert.equal(manager.quotaItem.text, '$(dashboard) 5h 6% · wk 1%');
  assert.equal(manager.quotaItem.backgroundColor, undefined);

  // Same data, same toggles: naming that cap in a template both shows it and
  // hands it the colour.
  manager.setVisibility(true, true, true, 'cost', false, false, false, 'decimal', '{5h.pct} | {7d.pct} · {model:Fable.pct}');
  manager.updateQuota(quota);
  assert.equal(manager.quotaItem.text, '$(dashboard) 6% | 1% · 92%');
  assert.equal(manager.quotaItem.backgroundColor?.id, 'statusBarItem.errorBackground');
  assert.equal(manager.quotaItem.visible, true);
});
