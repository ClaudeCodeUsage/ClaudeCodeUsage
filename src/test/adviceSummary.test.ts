// Tests for the advice-summary window threading (Phase 9d / 11). buildAdviceSummary
// is pure (it only reads ClaudeDataLoader statics, no vscode API), so it runs
// under node:test against the compiled output. We use empty records + a minimal
// ContentAnalysis: the aggregate/attribution sections collapse to nothing, which
// keeps the test focused on the windowDays prose threading.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildAdviceSummary } from '../adviceSummary';
import { ContentAnalysis } from '../types';

const emptyAnalysis: ContentAnalysis = {
  categories: [],
  toolResultBreakdown: [],
  totalEstimatedTokens: 0,
  recentPrompts: [],
  thinkingBySession: {},
  thinkingByDay: {},
  skillUses: [],
};

test('buildAdviceSummary echoes the default 30-day window when none is given', () => {
  const out = buildAdviceSummary([], emptyAnalysis, 'overall', 'overall');
  assert.ok(out.includes('last 30 days'), `expected "last 30 days" in:\n${out}`);
});

test('buildAdviceSummary echoes a custom window in the prose', () => {
  const out = buildAdviceSummary([], emptyAnalysis, 'overall', 'overall', 7);
  assert.ok(out.includes('last 7 days'), `expected "last 7 days" in:\n${out}`);
  assert.ok(!out.includes('last 30 days'), 'stale 30-day text should be gone');
});

test('buildAdviceSummary rounds and floors the window to a sane integer', () => {
  assert.ok(buildAdviceSummary([], emptyAnalysis, 'overall', 'overall', 14.6).includes('last 15 days'));
  // Guard against 0/negative producing nonsense like "last 0 days".
  assert.ok(buildAdviceSummary([], emptyAnalysis, 'overall', 'overall', 0).includes('last 1 days'));
});
