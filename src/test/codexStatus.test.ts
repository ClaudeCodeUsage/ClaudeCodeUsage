import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { formatCodexStatus } from '../codexStatus';
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

function limit(resetsAt: number): ProviderLimitSnapshot {
  return {
    provider: 'codex',
    observedAt: NOW - 60_000,
    source: 'local-log',
    confidence: 'last-observed',
    windows: [
      {
        label: 'primary',
        usedPercent: 42,
        windowMinutes: 300,
        resetsAt,
      },
    ],
  };
}

test('Codex status defaults to fresh and labels last-observed limits', () => {
  assert.deepEqual(formatCodexStatus(scope, 'fresh', limit(NOW + 60_000), NOW), {
    text: 'CX 400',
    limitText: '5h 42%',
    stale: false,
  });
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
