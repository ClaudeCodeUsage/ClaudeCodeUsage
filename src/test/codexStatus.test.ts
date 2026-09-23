import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  codexQuotaWarningPercent,
  formatCodexStatus,
  visibleCodexQuotaWindows,
} from '../codexStatus';
import { ProviderLimitSnapshot } from '../providers/providerTypes';
import { CodexUsageScopeView } from '../providers/codex/codexUsage';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const scope: CodexUsageScopeView = {
  total: {
    processed: 1_200,
    fresh: 400,
    input: 1_000,
    cachedInput: 800,
    output: 200,
    reasoning: 120,
  },
  rootTasks: 1,
  threads: 2,
  childThreads: 1,
  childProcessedShare: 0.5,
  childFreshShare: 0.5,
  approvalReviewerThreads: 0,
  approvalReviewerFreshShare: 0,
  cacheShare: 0.8,
  durationMs: 600_000,
  structural: {
    patchCalls: 1,
    toolCalls: 2,
    postPatchToolCalls: 1,
    compactCount: 0,
    taskCompleteCount: 1,
  },
  models: [],
  efforts: [],
};

function limit(
  resetsAt: number,
  windows: ProviderLimitSnapshot['windows'] = [
    {
      label: 'primary',
      usedPercent: 42,
      windowMinutes: 300,
      resetsAt,
    },
  ],
): ProviderLimitSnapshot {
  return {
    provider: 'codex',
    observedAt: NOW - 60_000,
    source: 'local-log',
    confidence: 'last-observed',
    windows,
  };
}

test('the explicit uncached Codex metric preserves its value and shows remaining weekly quota', () => {
  const formatted = formatCodexStatus(scope, 'fresh', limit(NOW + 60_000, [
    {
      label: 'primary',
      usedPercent: 42,
      windowMinutes: 300,
      resetsAt: NOW + 60_000,
    },
    {
      label: 'secondary',
      usedPercent: 67,
      windowMinutes: 10_080,
      resetsAt: NOW + 86_400_000,
    },
  ]), NOW);

  assert.deepEqual(formatted, {
    text: 'CX 400',
    limitText: 'wk 33%',
    limit: {
      label: 'wk',
      windowMinutes: 10_080,
      usedPercent: 67,
      remainingPercent: 33,
      observedAt: NOW - 60_000,
      resetsAt: NOW + 86_400_000,
    },
    stale: false,
  });
});

test('the existing five-hour-only preference selects the five-hour remaining quota', () => {
  const formatted = formatCodexStatus(scope, 'fresh', limit(NOW + 60_000, [
    { label: 'primary', usedPercent: 42, windowMinutes: 300, resetsAt: NOW + 60_000 },
    { label: 'secondary', usedPercent: 67, windowMinutes: 10_080, resetsAt: NOW + 86_400_000 },
  ]), NOW, { quotaFiveHourOnly: true });

  assert.equal(formatted.limitText, '5h 58%');
  assert.equal(formatted.limit?.windowMinutes, 300);
  assert.equal(formatted.limit?.remainingPercent, 58);
});

test('the default falls back to a live five-hour window when weekly data is absent', () => {
  const formatted = formatCodexStatus(scope, 'fresh', limit(NOW + 60_000), NOW);
  assert.equal(formatted.limitText, '5h 58%');
  assert.equal(formatted.limit?.remainingPercent, 58);
});

test('quota warning follows the worst live visible window, not the compact weekly choice', () => {
  const snapshot = limit(NOW + 60_000, [
    { label: 'primary', usedPercent: 96, windowMinutes: 300, resetsAt: NOW + 60_000 },
    { label: 'secondary', usedPercent: 40, windowMinutes: 10_080, resetsAt: NOW + 86_400_000 },
    { label: 'expired', usedPercent: 100, windowMinutes: 60, resetsAt: NOW - 1 },
  ]);

  assert.equal(formatCodexStatus(scope, 'fresh', snapshot, NOW).limitText, 'wk 60%');
  assert.equal(codexQuotaWarningPercent(snapshot, NOW), 96);
  assert.equal(codexQuotaWarningPercent(snapshot, NOW, { quotaFiveHourOnly: true }), 96);
  assert.deepEqual(
    visibleCodexQuotaWindows(snapshot, NOW).map((window) => window.usedPercent),
    [96, 40],
  );
});

test('processed and output metrics stay distinct', () => {
  assert.equal(formatCodexStatus(scope, 'processed', null, NOW).text, 'CX 1.2k');
  assert.equal(formatCodexStatus(scope, 'output', null, NOW).text, 'CX 200');
});

test('an indexed subtotal is marked in the compact status text', () => {
  assert.equal(
    formatCodexStatus({ ...scope, indexedSubtotal: true }, 'processed', null, NOW).text,
    'CX 1.2k*',
  );
});

test('expired last-observed limits are omitted', () => {
  const formatted = formatCodexStatus(
    scope,
    'processed',
    limit(NOW - 1),
    NOW,
  );
  assert.equal(formatted.limitText, undefined);
  assert.equal(formatted.stale, true);
});
