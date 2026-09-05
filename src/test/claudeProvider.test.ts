import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ClaudeDataLoader } from '../dataLoader';
import { buildClaudeProviderSnapshot } from '../providers/claudeProvider';
import { ClaudeUsageRecord } from '../types';

test('Claude adapter preserves existing token and cost aggregates', () => {
  const records: ClaudeUsageRecord[] = [
    {
      timestamp: '2026-07-19T10:00:00.000Z',
      message: {
        model: 'claude-sonnet-4-5',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 400,
        },
      },
      _sessionId: 'synthetic-session-a',
      _projectName: 'synthetic-project',
    },
    {
      timestamp: '2026-07-20T10:00:00.000Z',
      message: {
        model: 'claude-haiku-4-5',
        usage: {
          input_tokens: 80,
          output_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 200,
        },
      },
      _sessionId: 'synthetic-session-b',
      _projectName: 'synthetic-project',
    },
  ];

  const legacy = ClaudeDataLoader.getAllTimeData(records);
  const snapshot = buildClaudeProviderSnapshot(records);

  assert.deepEqual(snapshot.legacyUsage, legacy);
  assert.equal(snapshot.provider, 'claude');
  assert.equal(snapshot.confidence, 'exact');
});
