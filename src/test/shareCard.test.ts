// Tests for the Usage Share Card pure logic (V2.2 Phase 5.8) — aggregation,
// privacy redaction, optional sections, badge selection, filename.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { UsageData } from '../types';
import {
  DEFAULT_SECTIONS,
  ShareInput,
  ShareSections,
  buildShareCardData,
  cacheSharePct,
  modelFamily,
  selectShareBadge,
  shareCardFilename,
  totalTokens,
} from '../shareCard';

const u = (o: Partial<UsageData>): UsageData => ({
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  totalCost: 0,
  costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  messageCount: 0,
  modelBreakdown: {},
  ...o,
});

const input = (o: Partial<ShareInput> = {}): ShareInput => ({
  range: 'month',
  rangeData: u({ totalInputTokens: 100, totalOutputTokens: 50, totalCacheCreationTokens: 50, totalCacheReadTokens: 800, totalCost: 1.23 }),
  daily: [1, 2, 3, 4],
  sessionCount: 5,
  topModel: 'claude-opus-4-8',
  ...o,
});

test('totalTokens sums the four buckets; cacheSharePct is read/input-side', () => {
  const d = u({ totalInputTokens: 100, totalOutputTokens: 50, totalCacheCreationTokens: 50, totalCacheReadTokens: 800 });
  assert.equal(totalTokens(d), 1000);
  assert.equal(cacheSharePct(d), Math.round((800 / 950) * 100)); // 84
  assert.equal(cacheSharePct(u({})), 0); // no divide-by-zero
});

test('modelFamily reduces Claude to a family, keeps third-party', () => {
  assert.equal(modelFamily('claude-opus-4-8'), 'Opus');
  assert.equal(modelFamily('claude-sonnet-4-6'), 'Sonnet');
  assert.equal(modelFamily('claude-haiku-4-5'), 'Haiku');
  assert.equal(modelFamily('claude-fable-5'), 'Fable');
  assert.equal(modelFamily('deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.equal(modelFamily(undefined), undefined);
});

test('DEFAULT_SECTIONS redacts project name / workflow / peak / composition', () => {
  const out = buildShareCardData(input({ projectName: 'Secret-Project', workflowShare: 0.4, peakContextTokens: 700000 }), DEFAULT_SECTIONS);
  // privacy-safe fields present
  assert.ok('totalTokens' in out && 'estimatedCost' in out && 'cacheSharePct' in out && 'badge' in out);
  // default-off / private fields ABSENT
  assert.ok(!('projectName' in out), 'project name must be hidden by default');
  assert.ok(!('workflowSharePct' in out));
  assert.ok(!('peakContextTokens' in out));
  // structurally impossible to leak ids / paths / prompts (no such keys exist;
  // "sessions" is a non-identifying count and is allowed)
  assert.deepEqual(
    Object.keys(out).filter((k) => /sessionid|path|prompt|cwd|username|directory|filename/i.test(k)),
    []
  );
});

test('project name only appears when explicitly enabled', () => {
  const on: ShareSections = { ...DEFAULT_SECTIONS, projectName: true };
  const out = buildShareCardData(input({ projectName: 'My-Repo' }), on);
  assert.equal(out.projectName, 'My-Repo');
});

test('toggling sections off omits those fields', () => {
  const out = buildShareCardData(input(), { ...DEFAULT_SECTIONS, estimatedCost: false, cacheEfficiency: false, badge: false });
  assert.ok(!('estimatedCost' in out));
  assert.ok(!('cacheSharePct' in out));
  assert.ok(!('badge' in out));
  assert.equal(out.totalTokens, 1000);
});

test('badge selection is deterministic and prioritised', () => {
  // peak context wins over cache
  assert.equal(selectShareBadge(input({ peakContextTokens: 600000, rangeData: u({ totalCacheReadTokens: 900, totalInputTokens: 100 }) })).id, 'context-marathoner');
  // cache saver
  assert.equal(selectShareBadge(input({ rangeData: u({ totalCacheReadTokens: 900, totalInputTokens: 100 }) })).id, 'cache-saver');
  // token sprinter (big single day)
  assert.equal(selectShareBadge(input({ daily: [6_000_000], rangeData: u({ totalOutputTokens: 10 }) })).id, 'token-sprinter');
  // workflow pilot (many sessions)
  assert.equal(selectShareBadge(input({ sessionCount: 40, daily: [1], rangeData: u({ totalOutputTokens: 10 }) })).id, 'workflow-pilot');
  // fallback
  assert.equal(selectShareBadge(input({ sessionCount: 1, daily: [1], rangeData: u({ totalOutputTokens: 10 }) })).id, 'steady-builder');
});

test('filename follows the documented pattern', () => {
  assert.equal(shareCardFilename('week', new Date(2026, 5, 27)), 'claude-code-usage-2026-06-week.png');
  assert.equal(shareCardFilename('month', new Date(2026, 5, 27)), 'claude-code-usage-2026-06-month.png');
  assert.equal(shareCardFilename('today', new Date(2026, 5, 27)), 'claude-code-usage-2026-06-27-day.png');
});
