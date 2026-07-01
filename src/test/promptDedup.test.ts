import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isRetryDuplicatePrompt, PROMPT_RETRY_WINDOW_MS } from '../promptDedup';

const t0 = Date.parse('2026-06-11T16:26:38.000Z');

test('first occurrence of a prompt is always counted', () => {
  const seen = new Map<string, number>();
  assert.equal(isRetryDuplicatePrompt('继续', t0, seen), false);
});

test('identical prompt within the window is a retry re-log (skipped)', () => {
  const seen = new Map<string, number>();
  isRetryDuplicatePrompt('继续', t0, seen); // counted
  // ~30 s later (observed retry gap) → skip
  assert.equal(isRetryDuplicatePrompt('继续', t0 + 30_000, seen), true);
});

test('identical prompt well after the window is a genuine re-send (counted)', () => {
  const seen = new Map<string, number>();
  isRetryDuplicatePrompt('继续', t0, seen);
  // 8 minutes later → real repeat, counts
  assert.equal(isRetryDuplicatePrompt('继续', t0 + 8 * 60_000, seen), false);
});

test('a rapid retry chain collapses to a single count', () => {
  const seen = new Map<string, number>();
  const gaps = [0, 20_000, 55_000, 110_000, 160_000]; // each near the previous
  const counted = gaps.filter((g) => !isRetryDuplicatePrompt('spec', t0 + g, seen));
  assert.equal(counted.length, 1);
});

test('different prompts never dedupe each other', () => {
  const seen = new Map<string, number>();
  assert.equal(isRetryDuplicatePrompt('a', t0, seen), false);
  assert.equal(isRetryDuplicatePrompt('b', t0 + 1000, seen), false);
});

test('boundary: exactly at the window edge is still a duplicate', () => {
  const seen = new Map<string, number>();
  isRetryDuplicatePrompt('x', t0, seen);
  assert.equal(isRetryDuplicatePrompt('x', t0 + PROMPT_RETRY_WINDOW_MS, seen), true);
  assert.equal(isRetryDuplicatePrompt('x', t0 + PROMPT_RETRY_WINDOW_MS + 1, new Map([['x', t0]])), false);
});

test('unusable timestamp is counted, never dropped', () => {
  const seen = new Map<string, number>();
  assert.equal(isRetryDuplicatePrompt('x', NaN, seen), false);
});
