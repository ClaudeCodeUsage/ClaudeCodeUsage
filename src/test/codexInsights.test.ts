import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  buildCodexInsights,
  buildScopedCodexInsights,
  pasteReadyConstraint,
} from '../providers/codex/codexInsights';
import { buildCodexUsageView, CodexUsageScopeView } from '../providers/codex/codexUsage';
import { snapshotFixture } from './codexFixtures';

function scope(
  overrides: Partial<CodexUsageScopeView> = {},
): CodexUsageScopeView {
  return {
    total: {
      processed: 1_200,
      fresh: 400,
      input: 1_000,
      cachedInput: 800,
      output: 200,
      reasoning: 120,
    },
    rootTasks: 1,
    threads: 1,
    childThreads: 0,
    childProcessedShare: 0,
    childFreshShare: 0,
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
    efforts: [{ key: 'high', totals: { processed: 1_200, fresh: 400, input: 1_000, cachedInput: 800, output: 200, reasoning: 120 } }],
    ...overrides,
  };
}

test('multi-agent share uses fresh usage evidence', () => {
  const insights = buildCodexInsights(
    scope({
      childThreads: 5,
      childProcessedShare: 0.8,
      childFreshShare: 0.72,
    }),
  );
  assert.deepEqual(insights[0], {
    kind: 'multi-agent-share',
    severity: 'strong',
    scope: 'recent',
    evidence: {
      taskCount: 1,
      rootSessionFresh: 112,
      subagentFresh: 288,
    },
    proxy: true,
  });
});

test('no evidence produces no recommendation or generic constraint', () => {
  const neutral = scope({
    total: { processed: 0, fresh: 0, input: 0, cachedInput: 0, output: 0, reasoning: 0 },
    structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 },
    efforts: [],
  });
  assert.deepEqual(buildCodexInsights(neutral, '7d'), []);
  assert.equal(pasteReadyConstraint([]), '');
});

test('auto-review is never labelled independent code review', () => {
  const text = JSON.stringify(
    buildCodexInsights(
      scope({
        approvalReviewerThreads: 2,
        approvalReviewerFreshShare: 0.35,
      }),
    ),
  );
  assert.doesNotMatch(text, /independent code review/i);
  assert.match(text, /approval-reviewer/);
});

test('post-patch structural proxies use only approved structural evidence', () => {
  const base = scope();
  const insight = buildCodexInsights({
    ...base,
    structural: {
      ...base.structural,
      postPatchToolCalls: 6,
      patchCalls: 2,
    },
  }, 'recent').find((item) => item.kind === 'post-patch-tool-intensity');

  assert.equal(insight?.proxy, true);
  assert.equal(insight?.evidence.postPatchToolCalls, 6);
  assert.deepEqual(Object.keys(insight?.evidence ?? {}).sort(), [
    'patchCalls', 'postPatchToolCalls', 'toolCalls',
  ]);
});

test('high effort only suggests a representative-task A/B comparison', () => {
  const insight = buildCodexInsights(scope(), 'recent').find(
    (item) => item.kind === 'effort-comparison',
  );

  assert.equal(insight?.evidence.observedEffort, 'high');
  assert.equal(insight?.evidence.highEffortFresh, 400);
  assert.match(pasteReadyConstraint([insight!]), /representative task/i);
  assert.doesNotMatch(pasteReadyConstraint([insight!]), /waste|always|must/i);
});

test('high processed-to-fresh ratio explains cache without premature split advice', () => {
  const insight = buildCodexInsights(scope(), 'recent').find(
    (item) => item.kind === 'cache-context',
  );

  assert.equal(insight?.severity, 'info');
  assert.equal(insight?.evidence.processedToFreshRatio, 3);
  assert.doesNotMatch(pasteReadyConstraint([insight!]), /inefficient|inefficiency/i);
});

test('paste-ready constraints contain only the triggered kind sentences', () => {
  const text = pasteReadyConstraint([{ kind: 'cache-context', severity: 'info', scope: 'all', evidence: { cachedInputShare: 0.8 }, proxy: true }]);

  assert.match(text, /cache/i);
  assert.doesNotMatch(text, /full test|hardening|subagent|representative task/i);
});

test('partial rolling coverage blocks deterministic advice without gating complete or aggregate scopes', () => {
  const partial7Days = Object.assign(scope(), {
    periodCoverage: {
      migratedFiles: 1,
      totalFiles: 2,
      migratedBytes: 100,
      totalBytes: 200,
      complete: false,
    },
  });
  const complete30Days = Object.assign(scope(), {
    periodCoverage: {
      migratedFiles: 2,
      totalFiles: 2,
      migratedBytes: 200,
      totalBytes: 200,
      complete: true,
    },
  });

  const partialInsights = buildCodexInsights(partial7Days, '7d');
  assert.deepEqual(partialInsights, []);
  assert.equal(pasteReadyConstraint(partialInsights), '');
  assert.equal(
    buildCodexInsights(complete30Days, '30d').some((item) => item.kind === 'effort-comparison'),
    true,
  );
  assert.equal(
    buildCodexInsights(scope(), 'recent').some((item) => item.kind === 'effort-comparison'),
    true,
    'recent and aggregate-based all-time scopes have no natural-day coverage gate',
  );
});

test('deprecated one-argument period scopes fail closed even when coverage is complete', () => {
  const complete = Object.assign(scope(), {
    periodCoverage: {
      migratedFiles: 2,
      totalFiles: 2,
      migratedBytes: 200,
      totalBytes: 200,
      complete: true,
    },
  });

  assert.deepEqual(buildCodexInsights(complete), []);
  const sevenDays = buildCodexInsights(complete, '7d');
  assert.ok(sevenDays.length > 0);
  assert.ok(sevenDays.every((insight) => insight.scope === '7d'));
});

test('production scoped helper builds all four explicit recommendation scopes', () => {
  const snapshot = snapshotFixture();
  snapshot.coverage.period.last7Days.complete = true;
  snapshot.coverage.period.last30Days.complete = true;
  const view = buildCodexUsageView(snapshot, Date.parse('2026-07-20T12:00:00.000Z'));
  const insights = buildScopedCodexInsights(view);

  assert.deepEqual({
    recent: insights.recent.length,
    last7Days: insights.last7Days.length,
    last30Days: insights.last30Days.length,
    allTime: insights.allTime.length,
  }, { recent: 1, last7Days: 1, last30Days: 2, allTime: 1 });
  assert.ok(insights.recent.every((item) => item.scope === 'recent'));
  assert.ok(insights.last7Days.every((item) => item.scope === '7d'));
  assert.ok(insights.last30Days.every((item) => item.scope === '30d'));
  assert.ok(insights.allTime.every((item) => item.scope === 'all'));
});
