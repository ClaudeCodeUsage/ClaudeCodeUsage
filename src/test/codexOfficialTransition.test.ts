import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyCodexOfficialTransition } from '../codexOfficialTransition';
import { codexQuotaCaptureFromOfficialSample, createEmptyQuotaObservationStore, mergeQuotaCaptures } from '../quotaObservationStore';
import { codexQuotaEpochFromObservations } from '../codexQuotaEpoch';

const T = Date.parse('2026-10-20T06:00Z'), W = 604_800_000;
const point = (at: number, percent: number, resetAt = T + W) => ({ observedAt: at, usedFraction: percent / 100, resetAt });

test('drifting zero-use deadlines and first positive use do not independently establish a reset', () => {
  assert.equal(classifyCodexOfficialTransition(point(T, 0), point(T + 60_000, 0, T + W + 60_000)).boundary, null);
  assert.equal(classifyCodexOfficialTransition(point(T, 0), point(T + 900_000, 0, T + W + 900_000)).boundary, null);
  assert.equal(classifyCodexOfficialTransition(point(T, 0), point(T + 900_000, 2, T + W + 900_000)).boundary, null);
});
test('natural expiry and a genuine early positive-to-zero reset remain separate periods', () => {
  assert.equal(classifyCodexOfficialTransition(point(T, 90), point(T + W + 1, 0, T + 2 * W)).boundary, 'reset-at-change');
  assert.equal(classifyCodexOfficialTransition(point(T, 93), point(T + 60_000, 0, T + W + 60_000)).boundary, 'usage-drop');
});
test('small same-window corrections retire calibration without manufacturing a reset cycle', () => {
  const change = classifyCodexOfficialTransition(point(T, 41), point(T + 60_000, 40));
  assert.equal(change.boundary, null);
  assert.equal(change.breakCalibration, true);
  assert.equal(classifyCodexOfficialTransition(point(T, 12), point(T + 60_000, 3)).boundary, 'usage-drop');
});
test('unexpired positive-use deadline changes remain uncertain reset boundaries', () => {
  assert.equal(classifyCodexOfficialTransition(point(T, 20), point(T + 60_000, 21, T + W + 3_600_000)).boundary, 'reset-at-change');
});
test('only an explicit same-credit redemption, not count reduction or disappearance, proves a zero-to-zero reset', () => {
  const credit = { creditKey: 'b'.repeat(64), status: 'available' as const, resetType: 'codexRateLimits' as const,
    grantedAt: T - 60_000, expiresAt: T + 60_000 };
  const before = { ...point(T, 0), officialFacts: { schemaVersion: 1 as const, requestedAt: T - 1,
    rateLimitResetCredits: { availableCount: 1, credits: [credit] } } };
  for (const credits of [[], null, undefined]) {
    const after = { ...point(T + 120_000, 0, T + W + 120_000), officialFacts: { schemaVersion: 1 as const,
      requestedAt: T + 120_000 - 1, rateLimitResetCredits: { availableCount: 0, credits } } };
    assert.equal(classifyCodexOfficialTransition(before, after).boundary, null);
  }
  const after = { ...point(T + 30_000, 0), officialFacts: { schemaVersion: 1 as const, requestedAt: T + 29_999,
    rateLimitResetCredits: { availableCount: 0, credits: [{ ...credit, status: 'redeemed' as const }] } } };
  assert.equal(classifyCodexOfficialTransition(before, after).boundary, 'usage-drop');
});

test('new official facts keep one provisional P2 cycle across zero deadlines and fix anchor at first use', () => {
  const facts = [[T, 0, T + W], [T + 900_000, 0, T + W + 900_000],
    [T + 1_200_000, 2, T + W + 1_200_000], [T + 1_260_000, 3, T + W + 1_200_000]];
  const captures = facts.map(([at, percent, resetAt]) => codexQuotaCaptureFromOfficialSample({
    accountScopeKey: 'a'.repeat(64), requestedAt: at - 100, observedAt: at, usedPercent: percent, resetAt,
  })!);
  const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), captures, { salt: 'synthetic-forward-cycle', now: T + 1_260_000 });
  assert.equal(new Set(store.observations.map(r => r.windowId)).size, 1);
  const last = store.observations[store.observations.length - 1];
  const epoch = codexQuotaEpochFromObservations(store.observations, last.accountFingerprint, last.observedAt, last.resetAt!);
  assert.equal(epoch?.startedAt, T);
  assert.equal(epoch?.resetAnchorAt, T + W + 1_200_000);
});
