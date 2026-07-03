// Tests for estimateCacheChurnCost — the "cache-churn bill" data layer.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ClaudeDataLoader } from '../dataLoader';
import { ClaudeUsageRecord } from '../types';

const min = 60 * 1000;
const rec = (sid: string, model: string, tsMs: number, write: number, read: number): ClaudeUsageRecord => ({
  timestamp: new Date(tsMs).toISOString(),
  message: {
    usage: { input_tokens: 2, output_tokens: 100, cache_creation_input_tokens: write, cache_read_input_tokens: read },
    model,
  },
  _sessionId: sid,
});

test('estimateCacheChurnCost splits idle vs model-switch churn', () => {
  const now = Date.now();
  const records: ClaudeUsageRecord[] = [
    // session a: rewrite 90 min later, same model → idle churn
    rec('a', 'claude-opus-4-8', now - 120 * min, 20000, 0),
    rec('a', 'claude-opus-4-8', now - 30 * min, 20000, 0),
    // session b: rewrite 5 min later but a model switch → switch churn
    rec('b', 'claude-opus-4-8', now - 20 * min, 15000, 5000),
    rec('b', 'claude-sonnet-4-6', now - 15 * min, 15000, 0),
    // session c: another idle rewrite (to clear the min-sample gate)
    rec('c', 'claude-opus-4-8', now - 200 * min, 12000, 0),
    rec('c', 'claude-opus-4-8', now - 100 * min, 12000, 0),
  ];
  const r = ClaudeDataLoader.estimateCacheChurnCost(records, 30, 60);
  assert.ok(r, 'should return a result');
  assert.equal(r!.switchCount, 1);
  assert.equal(r!.idleCount, 2);
  assert.ok(r!.switchUsd > 0 && r!.idleUsd > 0);
  assert.ok(Math.abs(r!.wastedUsd - (r!.switchUsd + r!.idleUsd)) < 1e-9);
});

test('returns null without enough churn signal', () => {
  const now = Date.now();
  // a single warm read (no churn) → nothing to bill
  const records: ClaudeUsageRecord[] = [
    rec('a', 'claude-opus-4-8', now - 20 * min, 10000, 0),
    rec('a', 'claude-opus-4-8', now - 15 * min, 0, 10000), // warm read, not a rewrite
  ];
  assert.equal(ClaudeDataLoader.estimateCacheChurnCost(records, 30, 60), null);
});
