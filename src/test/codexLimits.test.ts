import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildCodexLimitViews } from '../providers/codex/codexLimits';
import { ProviderLimitSnapshot } from '../providers/providerTypes';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');

function snapshot(
  overrides: Partial<ProviderLimitSnapshot> = {},
): ProviderLimitSnapshot {
  return {
    provider: 'codex',
    observedAt: NOW - 60_000,
    source: 'local-log',
    confidence: 'last-observed',
    windows: [{ usedPercent: 31, windowMinutes: 300, resetsAt: NOW + 60_000 }],
    ...overrides,
  };
}

test('limit views keep current zero use distinct from missing and expired observations', () => {
  const currentZero = buildCodexLimitViews([
    snapshot({ windows: [{ usedPercent: 0, windowMinutes: 300, resetsAt: NOW + 60_000 }] }),
  ], NOW);
  const expired = buildCodexLimitViews([
    snapshot({ windows: [{ usedPercent: 31, windowMinutes: 300, resetsAt: NOW - 1 }] }),
  ], NOW);
  const missing = buildCodexLimitViews([], NOW);

  assert.deepEqual(currentZero.map((view) => [view.state, view.usedPercent, view.remainingPercent]), [
    ['current', 0, 100],
  ]);
  assert.equal(expired[0]?.state, 'expired');
  assert.equal(missing[0]?.state, 'missing');
});

test('limit views retain no-reset local observations as stale instead of current forever', () => {
  const views = buildCodexLimitViews([
    snapshot({ windows: [{ usedPercent: 44, windowMinutes: 720 }] }),
  ], NOW);

  assert.equal(views[0]?.state, 'expired');
  assert.equal(views[0]?.resetsAt, undefined);
  assert.equal(views[0]?.usedPercent, 44);
});

test('limit views represent unlimited credit separately from rate windows', () => {
  const views = buildCodexLimitViews([
    snapshot({
      windows: [],
      credits: { hasCredits: true, unlimited: true },
    }),
  ], NOW);

  assert.deepEqual(views.map((view) => view.state), ['unlimited']);
});
