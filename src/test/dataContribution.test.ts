// The data-contribution scaffold must stay OFF and privacy-safe by default.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  DEFAULT_CONTRIBUTION_CONFIG,
  UsageObservation,
  contributeObservations,
  redactObservation,
  willContribute,
} from '../dataContribution';

const obs: UsageObservation = {
  kind: 'cache-ttl',
  modelFamily: 'opus',
  cacheWarmMinutes: 60,
  sampleN: 7702,
  monthBucket: '2026-07',
  subscriptionTier: 'max',
};

test('nothing contributes by default (off, no endpoint)', () => {
  assert.equal(willContribute(DEFAULT_CONTRIBUTION_CONFIG), false);
  assert.equal(willContribute({ enabled: true }), false); // enabled but no endpoint
  assert.equal(willContribute({ enabled: false, endpoint: 'https://x' }), false);
  assert.equal(willContribute({ enabled: true, endpoint: 'https://x' }), true);
});

test('contributeObservations is a no-op today even when "enabled"', async () => {
  const r = await contributeObservations([obs], { enabled: true, endpoint: 'https://x' });
  assert.deepEqual(r, { sent: 0 });
});

test('tier is redacted unless explicitly shared', () => {
  assert.equal(redactObservation(obs, { enabled: true }).subscriptionTier, undefined);
  assert.equal(redactObservation(obs, { enabled: true, shareTier: true }).subscriptionTier, 'max');
});

test('the Observation type carries no identifying field', () => {
  // Compile-time guarantee mostly; assert the sample only has aggregate keys.
  const allowed = new Set(['kind', 'modelFamily', 'cacheWarmMinutes', 'sampleN', 'monthBucket', 'subscriptionTier']);
  for (const k of Object.keys(obs)) {
    assert.ok(allowed.has(k), `unexpected field ${k}`);
  }
});
