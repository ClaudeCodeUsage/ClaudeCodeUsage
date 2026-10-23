import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { codexQuotaEpochFromObservations } from '../codexQuotaEpoch';
import { createEmptyQuotaObservationStore, mergeQuotaCaptures, deriveQuotaResetEvents,
  QuotaCapture } from '../quotaObservationStore';

const T = Date.parse('2026-10-19T02:00Z'), M = 60_000, R = T + 6 * 86_400_000;
const options = { salt: 'source-isolation-fixture', now: T + 10 * M };
function official(t: number, p: number, account = 'A', resetAt = R): QuotaCapture {
  return { provider: 'codex', source: 'codex-official-api', accountAttribution: 'verified-local-signal',
    stableIdentitySignal: account, observedAt: t, periodType: 'seven-day', usedFraction: p,
    resetAt, confidence: 'high', captureReason: 'refresh' };
}
function local(t: number, resetAt = R): QuotaCapture {
  return { ...official(t, .9), source: 'codex-local-structured-event',
    accountAttribution: 'unattributed', stableIdentitySignal: undefined,
    unattributedEpochSignal: String(t), resetAt };
}
test('anonymous local history cannot change the first official epoch reason or ambiguity', () => {
  for (const captures of [[local(T, R + M * 60), official(T + M, .2)],
    [official(T, .2), local(T + M, R + M * 60)]]) {
    const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), captures, options);
    const row = store.observations.find(row => row.source === 'codex-official-api')!;
    assert.equal(row.captureReason, 'refresh');
    assert.ok(!row.flags.includes('account-ambiguous'));
    assert.deepEqual(codexQuotaEpochFromObservations(store.observations, row.accountFingerprint,
      row.observedAt, R), { startedAt: row.observedAt, resetAnchorAt: R, startLowerAt: null, reason: 'initial' });
    assert.deepEqual(deriveQuotaResetEvents(store), []);
  }
});
test('official A-B-A retains each account epoch and does not invent resets across accounts', () => {
  const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), [official(T, .4),
    official(T + M, .8, 'B', R + 60 * M), official(T + 2 * M, .45)], options);
  assert.deepEqual(store.observations.map(row => row.captureReason), ['refresh', 'refresh', 'refresh']);
  assert.equal(store.observations[0].windowId, store.observations[2].windowId);
  assert.deepEqual(deriveQuotaResetEvents(store), []);
});
test('a small same-account official drop creates a new epoch even across interleaved local or account rows', () => {
  const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), [official(T, .4),
    official(T + M, .9, 'B'), local(T + 2 * M), official(T + 3 * M, .39)], options);
  const last = store.observations.find(row => row.observedAt === T + 3 * M)!;
  assert.equal(last.captureReason, 'usage-drop');
  assert.notEqual(last.windowId, store.observations[0].windowId);
  const events = deriveQuotaResetEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].previousAccountFingerprint, last.accountFingerprint);
  assert.equal(events[0].evidence, 'usage-drop');
});
test('anonymous reset epochs compare within their local channel while ignoring official checkpoints', () => {
  const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), [local(T),
    official(T + M, .2, 'A', R + 120 * M), local(T + 2 * M, R + 60 * M)], options);
  const rows = store.observations.filter(row => row.source === 'codex-local-structured-event');
  assert.equal(rows[1].captureReason, 'reset-at-change');
  const events = deriveQuotaResetEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].previousAccountFingerprint, rows[0].accountFingerprint);
  assert.equal(events[0].nextAccountFingerprint, rows[1].accountFingerprint);
});
