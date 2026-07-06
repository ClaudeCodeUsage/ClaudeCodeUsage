import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ClaudeDataLoader } from '../dataLoader';
import { ClaudeUsageRecord } from '../types';

function record(model: string): ClaudeUsageRecord {
  return {
    timestamp: new Date().toISOString(),
    message: {
      model,
      usage: { input_tokens: 1_000, output_tokens: 10 },
    },
  };
}

test('getCurrentContextInfo reports a 1M window for Sonnet 5', () => {
  const info = ClaudeDataLoader.getCurrentContextInfo([record('claude-sonnet-5')]);
  assert.ok(info, 'expected context info, got null');
  assert.equal(info!.windowTokens, 1_000_000);
  assert.equal(info!.estimated, false);
});
