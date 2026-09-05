import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  buildAchievementEvidence,
  buildCommunityBenchmarkCandidate,
} from '../achievementSnapshot';

function assertCarriesNoIdentity(value: unknown): void {
  const forbidden = /(?:^|_)(?:id|name|title|path|directory|project|user|repo|url|cost|timestamp)(?:$|_)/i;
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    for (const [key, child] of Object.entries(candidate)) {
      assert.doesNotMatch(key, forbidden);
      visit(child);
    }
  };
  visit(value);
}

test('achievement evidence keeps provider-native local aggregates without identity or cost', () => {
  const evidence = buildAchievementEvidence({
    provider: 'codex',
    period: '30d',
    processedTokens: 12_345_678,
    freshTokens: 3_456_789,
    outputTokens: 456_789,
    sessions: 42,
    activeDays: 18,
    cacheShare: 0.7234,
    childFreshShare: 0.271,
    highEffortFreshShare: 1.2,
  });

  assert.deepEqual(evidence, {
    schemaVersion: 1,
    provider: 'codex',
    period: '30d',
    metrics: {
      processedTokens: 12_345_678,
      freshTokens: 3_456_789,
      outputTokens: 456_789,
      sessions: 42,
      activeDays: 18,
      cacheShareBps: 7_234,
      childFreshShareBps: 2_710,
      highEffortFreshShareBps: 10_000,
    },
  });
  assertCarriesNoIdentity(evidence);
});

test('community candidate coarsens local evidence and carries no stable identity', () => {
  const candidate = buildCommunityBenchmarkCandidate(
    buildAchievementEvidence({
      provider: 'claude',
      period: '7d',
      processedTokens: 12_345_678,
      freshTokens: 3_456_789,
      outputTokens: 456_789,
      sessions: 42,
      activeDays: 6,
      cacheShare: 0.7234,
    }),
  );

  assert.deepEqual(candidate, {
    schemaVersion: 1,
    provider: 'claude',
    period: '7d',
    bands: {
      processedTokens: '10m-50m',
      freshTokens: '1m-5m',
      outputTokens: '100k-500k',
      sessions: '25-49',
      activeDays: '5-6',
      cacheSharePct: 70,
    },
  });
  assertCarriesNoIdentity(candidate);
});

test('invalid and unavailable metrics are normalized without inventing evidence', () => {
  const evidence = buildAchievementEvidence({
    provider: 'codex',
    period: 'all',
    processedTokens: -1,
    freshTokens: Number.NaN,
    outputTokens: Number.POSITIVE_INFINITY,
    sessions: -4,
    activeDays: 0,
  });

  assert.deepEqual(evidence.metrics, {
    processedTokens: 0,
    freshTokens: 0,
    outputTokens: 0,
    sessions: 0,
    activeDays: 0,
  });
  assert.deepEqual(buildCommunityBenchmarkCandidate(evidence).bands, {
    processedTokens: '0',
    freshTokens: '0',
    outputTokens: '0',
    sessions: '0',
    activeDays: '0',
  });
});
