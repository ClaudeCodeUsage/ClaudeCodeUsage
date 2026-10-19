import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mergeQuotaCaptures, codexQuotaCaptureFromOfficialSample, type QuotaObservationStoreV2 } from '../quotaObservationStore';
import { codexQuotaEpochFromObservations } from '../codexQuotaEpoch';

const T = Date.parse('2026-10-19T02:00:00Z'), R = T + 6 * 86_400_000;
const salt = 'synthetic-epoch-store-salt';
function capture(at: number, usedPercent: number, resetAt = R, key = 'a'.repeat(64)) {
  return codexQuotaCaptureFromOfficialSample({ accountScopeKey: key, observedAt: at, resetAt, usedPercent })!;
}
function merged(...captures: ReturnType<typeof capture>[]) {
  const empty: QuotaObservationStoreV2 = { schemaVersion: 2, fingerprintAlgorithm: 'hmac-sha256-v1', observations: [] };
  return mergeQuotaCaptures(empty, captures, { salt, now: T + 10 * 60_000 });
}

test('official same-reset counter decrease below the legacy 15pp threshold starts a retained quota epoch', () => {
  const result = merged(capture(T, 12), capture(T + 60_000, 3), capture(T + 120_000, 4));
  assert.equal(result.observations.length, 3);
  const [before, after, next] = result.observations;
  assert.notEqual(after.windowId, before.windowId);
  assert.equal(after.captureReason, 'usage-drop');
  assert.equal(next.windowId, after.windowId);
  assert.equal(before.usedFraction, .12);
});

test('official reset changes returning to an earlier reset cannot reuse its old epoch identity', () => {
  const result = merged(capture(T, 20), capture(T + 60_000, 5, R + 3_600_000), capture(T + 120_000, 6));
  assert.equal(new Set(result.observations.map(row => row.windowId)).size, 3);
});

test('same-reset A to B to A retains account-separated observations without inventing a reset', () => {
  const result = merged(capture(T, 20), capture(T + 60_000, 5, R, 'b'.repeat(64)), capture(T + 120_000, 25));
  const a = result.observations.filter(row => row.usedFraction === .2 || row.usedFraction === .25);
  assert.equal(a.length, 2);
  assert.equal(a[0].windowId, a[1].windowId);
  assert.equal(new Set(result.observations.map(row => row.accountFingerprint)).size, 2);
});

test('official compaction retains the current epoch first observation ahead of frequent flagged samples', () => {
  const post = R + 60_000, nextReset = R + 604_800_000;
  const captures = [capture(R - 60_000, 90), ...Array.from({ length: 521 }, (_, i) => ({
    ...capture(post + i * 60_000, i / 100, nextReset), flags: ['account-ambiguous' as const],
  }))];
  const empty: QuotaObservationStoreV2 = { schemaVersion: 2, fingerprintAlgorithm: 'hmac-sha256-v1', observations: [] };
  const currentAt = post + 520 * 60_000;
  let store = mergeQuotaCaptures(empty, captures, { salt, now: currentAt });
  assert.equal(store.observations.length, 512);
  const account = store.observations[store.observations.length - 1].accountFingerprint;
  assert.equal(codexQuotaEpochFromObservations(store.observations, account, currentAt, nextReset)?.startedAt, post);
  store = mergeQuotaCaptures(store, [{ ...capture(currentAt + 60_000, 5.21, nextReset),
    flags: ['account-ambiguous'] }], { salt, now: currentAt + 60_000 });
  assert.equal(codexQuotaEpochFromObservations(store.observations, account, currentAt + 60_000, nextReset)?.startedAt, post);
});
