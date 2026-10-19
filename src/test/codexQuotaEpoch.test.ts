import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { copyCodexQuotaEpoch, codexQuotaEpochFromObservations } from '../codexQuotaEpoch';
import type { CodexQuotaEpoch } from '../codexQuotaEpoch';
import { WeeklyEstimateArchive } from '../weeklyEstimateArchive';
import {
  codexQuotaCaptureFromOfficialSample, createEmptyQuotaObservationStore,
  mergeQuotaCaptures,
} from '../quotaObservationStore';
import type { QuotaObservationV2 } from '../quotaObservationStore';

const T = Date.parse('2026-10-19T02:00:00Z'), WEEK = 604_800_000, R = T + 6 * 86_400_000;
const A = 'acct_' + 'a'.repeat(32), B = 'acct_' + 'b'.repeat(32);
const W1 = 'win_' + '1'.repeat(32), W2 = 'win_' + '2'.repeat(32);
function row(observedAt = T, overrides: Partial<QuotaObservationV2> = {}): QuotaObservationV2 {
  return { schemaVersion: 2, provider: 'codex', accountFingerprint: A,
    accountAttribution: 'verified-local-signal', observedAt, periodType: 'seven-day',
    usedFraction: .4, resetAt: R, source: 'codex-official-api',
    windowId: W1, providerWindowFingerprint: null, confidence: 'high', captureReason: 'refresh',
    flags: [], ...overrides, remainingFraction: overrides.remainingFraction ?? 1 - (overrides.usedFraction ?? .4) };
}
function derive(records: readonly QuotaObservationV2[], current: QuotaObservationV2) {
  return codexQuotaEpochFromObservations(records, current.accountFingerprint, current.observedAt, current.resetAt!);
}

test('initial epoch has only fixed public numeric/enum fields; first observation is not a known reset', () => {
  const first = row(), current = row(T + 60_000, { usedFraction: .5 });
  assert.deepEqual(derive([current, first], current), {
    startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial',
  });
  assert.deepEqual(Object.keys(derive([first], first)!).sort(), ['reason', 'resetAnchorAt', 'startLowerAt', 'startedAt']);
});

test('A-B-A, blur and a long sampling gap keep A first observation and fixed reset anchor', () => {
  const first = row(), b = row(T + 60_000, { accountFingerprint: B, windowId: W2 });
  const current = row(T + 3_600_000, { resetAt: R + 240_000, flags: ['account-ambiguous'] });
  const records = [first, b, current], frozen = JSON.stringify(records);
  assert.deepEqual(derive(records, current), { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' });
  assert.deepEqual(derive(JSON.parse(frozen), current), derive(records, current));
  assert.equal(JSON.stringify(records), frozen);
});

test('same-reset drop uses a distinct P2 window and previous same-account last observation', () => {
  const previous = row(T + 60_000, { usedFraction: .41 });
  const first = row(T + 120_000, { windowId: W2, usedFraction: .409, captureReason: 'usage-drop' });
  const current = row(T + 180_000, { windowId: W2, usedFraction: .5 });
  assert.deepEqual(derive([row(), previous, first, current], current), {
    startedAt: first.observedAt, resetAnchorAt: R, startLowerAt: previous.observedAt, reason: 'counter-drop',
  });
});

test('early reset change is bracketed by observations, even if percentage rises', () => {
  const previous = row(), first = row(T + 60_000, {
    windowId: W2, resetAt: R + 3_600_000, usedFraction: .45, captureReason: 'reset-at-change',
  });
  assert.deepEqual(derive([previous, first], first), {
    startedAt: first.observedAt, resetAnchorAt: first.resetAt, startLowerAt: T, reason: 'reset-change',
  });
});

test('scheduled rollover uses the expired reset boundary and keeps first post-reset observation separate', () => {
  const previous = row(R - 60_000), first = row(R + 60_000, {
    windowId: W2, resetAt: R + WEEK, usedFraction: .45, captureReason: 'reset-at-change',
  });
  assert.deepEqual(derive([previous, first], first), {
    startedAt: first.observedAt, resetAnchorAt: R + WEEK, startLowerAt: R, reason: 'scheduled-reset',
  });
});

test('unknown earlier history never fabricates a lower bound or reconstructs reset minus one week', () => {
  const first = row(T + 120_000, { windowId: W2, captureReason: 'usage-drop' });
  assert.deepEqual(derive([first], first), {
    startedAt: first.observedAt, resetAnchorAt: R, startLowerAt: null, reason: 'counter-drop',
  });
});

test('same-account official weekly records alone determine the predecessor', () => {
  const previous = row(), first = row(T + 120_000, { windowId: W2, captureReason: 'usage-drop', usedFraction: .1 });
  const noise = [
    row(T + 60_000, { accountFingerprint: B }),
    row(T + 70_000, { source: 'codex-local-structured-event' }),
    row(T + 80_000, { provider: 'claude', source: 'claude-official-api' }),
    row(T + 90_000, { periodType: 'five-hour' }),
    row(T + 100_000, { flags: ['clock-anomaly'] }),
    row(T + 110_000, { accountAttribution: 'unattributed' }),
    row(T + 180_000, { windowId: W2 }),
  ];
  assert.deepEqual(derive([previous, ...noise, first], first), {
    startedAt: first.observedAt, resetAnchorAt: R, startLowerAt: T, reason: 'counter-drop',
  });
});

test('current sample must already exist in P2; replay and duplicate records are deterministic', () => {
  const first = row(), current = row(T + 60_000, { usedFraction: .5 });
  assert.equal(derive([first], current), undefined);
  assert.deepEqual(derive([current, first, { ...first }], current), derive([first, current], current));
  const conflicting = row(current.observedAt, { usedFraction: .6 });
  assert.equal(derive([first, current, conflicting], current), undefined);
});

test('a window boundary without same-account reset evidence stays unknown rather than borrowing another account', () => {
  const other = row(T, { accountFingerprint: B });
  const first = row(T + 60_000, { windowId: W2, captureReason: 'reset-at-change' });
  assert.deepEqual(derive([other, first], first), {
    startedAt: first.observedAt, resetAnchorAt: R, startLowerAt: null, reason: 'reset-change',
  });
});

test('metadata copier validates optional lower bounds and drops unlisted fields', () => {
  const valid: CodexQuotaEpoch = { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' };
  assert.equal(copyCodexQuotaEpoch(undefined), undefined);
  assert.deepEqual(copyCodexQuotaEpoch({ ...valid, accountFingerprint: A, windowId: W1 }), valid);
  assert.deepEqual(copyCodexQuotaEpoch({ ...valid, reason: 'counter-drop', startLowerAt: T - 1 }),
    { ...valid, reason: 'counter-drop', startLowerAt: T - 1 });
  for (const patch of [
    { startedAt: NaN }, { startedAt: T + .5 }, { startedAt: 0 }, { resetAnchorAt: T },
    { resetAnchorAt: Infinity }, { reason: 'manual-credit' }, { startLowerAt: undefined },
    { startLowerAt: -1 }, { startLowerAt: T + 1 },
    { reason: 'scheduled-reset' }, { startLowerAt: T - 1 },
  ]) assert.equal(copyCodexQuotaEpoch({ ...valid, ...patch }), undefined, JSON.stringify(patch));
});

test('malformed or unsafe current records do not establish an epoch', () => {
  for (const patch of [
    { resetAt: null }, { resetAt: T }, { usedFraction: NaN }, { usedFraction: 2 },
    { remainingFraction: .9 }, { windowId: 'raw-window' }, { accountFingerprint: 'raw-account' },
    { observedAt: T + .5 }, { flags: ['clock-anomaly'] },
  ] as Partial<QuotaObservationV2>[]) {
    const invalid = row(T, patch);
    assert.equal(derive([invalid], invalid), undefined);
  }
});

// These are executable integration contracts, deliberately TODO until the main
// agent adopts the final contract in existing production files. No disk I/O.
test('P2 official-only: any valid decrease creates a new durable window', () => {
  const first = codexQuotaCaptureFromOfficialSample({ accountScopeKey: 'a'.repeat(64),
    observedAt: T, resetAt: R, usedPercent: 40 })!;
  const second = { ...first, observedAt: T + 60_000, usedFraction: .399 };
  const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), [first, second], { salt: 'synthetic', now: T + 60_000 });
  assert.notEqual(store.observations[0].windowId, store.observations[1].windowId);
  assert.equal(store.observations[1].captureReason, 'usage-drop');
});

const archive = new WeeklyEstimateArchive('/synthetic/never-opened/weekly-estimates-v1.json', 'synthetic-salt', 'synthetic-source');
const sourceKey = 'c'.repeat(64);
const archiveInput = { provider: 'codex', resetAt: R, method: 'account-delta-v1', accountScopeKey: 'a'.repeat(64) };
// Exercise only the existing pure key computation, never load/record/lease.
const windowKey = (value: object): string => (archive as unknown as {
  windowKey(source: string, input: object): string;
}).windowKey(sourceKey, value);

test('archive legacy window-key branch stays byte-for-byte compatible', () => {
  const expected = createHmac('sha256', 'synthetic-salt').update(JSON.stringify([
    'weekly-estimate-window-v1', sourceKey, 'codex', R, 'account-delta-v1', 'a'.repeat(64),
  ])).digest('hex');
  assert.equal(windowKey(archiveInput), expected);
  assert.equal(windowKey({ ...archiveInput, quotaEpoch: undefined }), expected);
});

test('archive epoch key separates same-reset epochs and keeps reset jitter within an epoch', () => {
  const quotaEpoch: CodexQuotaEpoch = { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' };
  const first = { ...archiveInput, quotaEpoch };
  const next = { ...archiveInput, quotaEpoch: { ...quotaEpoch, startedAt: T + 60_000, reason: 'counter-drop' } };
  assert.notEqual(windowKey(first), windowKey(next));
  assert.notEqual(windowKey(first), windowKey(archiveInput));
  assert.equal(windowKey(first), windowKey({ ...first, resetAt: R + 240_000 }));
});
