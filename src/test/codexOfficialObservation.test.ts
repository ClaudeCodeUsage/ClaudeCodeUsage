import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  codexQuotaCaptureFromOfficialSample,
  codexQuotaCapturesFromWeeklyObservations,
  createEmptyQuotaObservationStore,
  fingerprintForStableIdentity,
  loadQuotaObservationStore,
  mergeQuotaCaptures,
  QuotaObservationRepository,
  saveQuotaObservationStoreAtomic,
} from '../quotaObservationStore';

const HOUR = 3_600_000, DAY = 24 * HOUR, WEEK = 7 * DAY;
const NOW = Date.now() - HOUR, RESET = NOW + DAY;
const SALT = 'synthetic-official-observation-salt';
const ACCOUNT_A = 'a'.repeat(64), ACCOUNT_B = 'b'.repeat(64);
const sample = () => ({ accountScopeKey: ACCOUNT_A, observedAt: NOW, resetAt: RESET, usedPercent: 40 });
type OfficialSample = ReturnType<typeof sample>;

function official(overrides: Partial<OfficialSample> = {}) {
  const capture = codexQuotaCaptureFromOfficialSample({ ...sample(), ...overrides });
  assert.ok(capture);
  return capture;
}

test('official capture keeps the original checkpoint and a stable pseudonymous weekly scope', t => {
  t.mock.method(Date, 'now', () => assert.fail('the adapter must not read the current clock'));
  assert.deepEqual(official(), {
    provider: 'codex',
    stableIdentitySignal: 'official-account-scope-v1|' + ACCOUNT_A,
    accountAttribution: 'verified-local-signal',
    observedAt: NOW,
    periodType: 'seven-day',
    usedFraction: 0.4,
    resetAt: RESET,
    source: 'codex-official-api',
    sourceWindowId: 'codex|weekly',
    confidence: 'high',
    captureReason: 'refresh',
    flags: [],
  });
  const later = official({ observedAt: NOW + WEEK, resetAt: RESET + WEEK });
  assert.equal(later.stableIdentitySignal, official().stableIdentitySignal);
  assert.equal(later.sourceWindowId, 'codex|weekly', 'reset time is a separate field');
});

test('official capture validates HMAC, safe timestamps, weekly bounds and percentages without coercion', () => {
  const invalid: Array<Partial<Record<keyof OfficialSample, unknown>>> = [
    ...['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64),
      ' ' + ACCOUNT_A, ACCOUNT_A + '\n', null, 42].map(accountScopeKey => ({ accountScopeKey })),
    ...[0, -1, NaN, Infinity, NOW + 0.5, Number.MAX_SAFE_INTEGER + 1, String(NOW), null]
      .map(observedAt => ({ observedAt })),
    ...[0, -1, NaN, Infinity, RESET + 0.5, Number.MAX_SAFE_INTEGER + 1, String(RESET), null,
      NOW, NOW - 1, NOW + WEEK + 1].map(resetAt => ({ resetAt })),
    ...[-1, 100.01, NaN, Infinity, '40', null].map(usedPercent => ({ usedPercent })),
  ];
  for (const change of invalid) {
    assert.equal(codexQuotaCaptureFromOfficialSample({ ...sample(), ...change } as OfficialSample), null);
  }
  for (const malformed of [null, undefined, [], 42, {}]) {
    assert.equal(codexQuotaCaptureFromOfficialSample(malformed as OfficialSample), null);
  }
  assert.ok(codexQuotaCaptureFromOfficialSample({ ...sample(), observedAt: RESET - WEEK }));
  assert.equal(codexQuotaCaptureFromOfficialSample({ ...sample(), observedAt: RESET - WEEK - 1 }), null);
  assert.equal(official({ usedPercent: 100 }).usedFraction, 1);
});

test('official A and B at one reset stay separate, returning A is stable, and local logs remain unowned', () => {
  const captures = [
    official({ observedAt: NOW - 2 * HOUR, usedPercent: 20 }),
    official({ accountScopeKey: ACCOUNT_B, observedAt: NOW - HOUR, usedPercent: 50 }),
    official({ usedPercent: 30 }),
    ...codexQuotaCapturesFromWeeklyObservations([{
      provider: 'codex', seriesKey: 'official-account-scope-v1|' + ACCOUNT_A,
      observedAt: NOW, resetAt: RESET, usedPercent: 30, windowId: 'codex|weekly',
    }]),
  ];
  const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), captures, { salt: SALT, now: NOW });
  assert.equal(store.observations.length, 4);
  const a = fingerprintForStableIdentity(SALT, 'codex', 'official-account-scope-v1|' + ACCOUNT_A);
  const b = fingerprintForStableIdentity(SALT, 'codex', 'official-account-scope-v1|' + ACCOUNT_B);
  assert.notEqual(a, b);
  const firstA = store.observations.find(row => row.observedAt === NOW - 2 * HOUR)!;
  const secondA = store.observations.find(row => row.observedAt === NOW && row.source === 'codex-official-api')!;
  assert.equal(firstA.accountFingerprint, a);
  assert.equal(secondA.accountFingerprint, a);
  assert.equal(secondA.windowId, firstA.windowId);
  assert.equal(store.observations.find(row => row.observedAt === NOW - HOUR)!.accountFingerprint, b);
  const local = store.observations.find(row => row.source === 'codex-local-structured-event')!;
  assert.equal(local.accountAttribution, 'unattributed');
  assert.match(local.accountFingerprint, /^anon_/);
  assert.notEqual(local.accountFingerprint, a);
  assert.notEqual(local.accountFingerprint, b);
  assert.notEqual(local.windowId, secondA.windowId);
  assert.equal(local.resetAt, secondA.resetAt);
});

test('zero percent is an official observation and repeated capture does not retime or duplicate it', () => {
  const zero = official({ usedPercent: 0 });
  const store = mergeQuotaCaptures(createEmptyQuotaObservationStore(), [zero, zero], { salt: SALT, now: NOW });
  const repeated = mergeQuotaCaptures(store, [zero], { salt: SALT, now: NOW + HOUR });
  assert.deepEqual(repeated, store);
  assert.equal(store.observations.length, 1);
  assert.equal(store.observations[0].observedAt, NOW);
  assert.equal(store.observations[0].usedFraction, 0);
  assert.equal(store.observations[0].remainingFraction, 1);
});

test('official observations compact and round-trip only fixed fields without inspecting private sample fields', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-official-observation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'quota-observations-v2.json');
  const input = { ...sample(), observedAt: NOW - 12 * HOUR, usedPercent: 0 };
  for (const field of ['accountId', 'email', 'plan', 'planType', 'accessToken', 'refreshToken']) {
    Object.defineProperty(input, field, { get() { assert.fail('must not inspect private sample field ' + field); } });
  }
  const guarded = new Proxy(input, { ownKeys() { assert.fail('must not enumerate sample fields'); } });
  const first = codexQuotaCaptureFromOfficialSample(guarded);
  assert.ok(first);
  assert.deepEqual(Object.keys(first).sort(), Object.keys(official()).sort());
  const captures = [first, ...Array.from({ length: 12 }, (_, index) => official({
    observedAt: NOW - (11 - index) * HOUR, usedPercent: index + 1,
  }))];
  const compacted = mergeQuotaCaptures(createEmptyQuotaObservationStore(), captures, {
    salt: SALT, now: NOW, limitPerSeries: 4,
  });
  assert.equal(compacted.observations.length, 4);
  assert.equal(compacted.observations[0].observedAt, input.observedAt);
  assert.equal(compacted.observations[0].usedFraction, 0);
  assert.equal(compacted.observations[3].observedAt, NOW);
  assert.ok(compacted.observations.every(row => row.source === 'codex-official-api'));
  await saveQuotaObservationStoreAtomic(file, compacted);
  const loaded = await loadQuotaObservationStore(file, { now: NOW });
  assert.equal(loaded.disposition, 'valid');
  assert.deepEqual(loaded.store, compacted);
  const body = await readFile(file, 'utf8');
  for (const secret of [ACCOUNT_A, SALT, 'official-account-scope-v1|', 'codex|weekly']) {
    assert.equal(body.includes(secret), false);
  }
  for (const row of JSON.parse(body).observations) {
    assert.deepEqual(Object.keys(row).sort(), [
      'schemaVersion', 'provider', 'accountFingerprint', 'accountAttribution', 'observedAt',
      'periodType', 'usedFraction', 'remainingFraction', 'resetAt', 'source', 'windowId',
      'providerWindowFingerprint', 'confidence', 'captureReason', 'flags',
    ].sort());
  }
});

test('existing account-scoped clearing removes official A while preserving B and unattributed local history', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-official-clear-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new QuotaObservationRepository(path.join(root, 'quota-observations-v2.json'), SALT, () => NOW);
  const store = await repository.append([
    official(), official({ accountScopeKey: ACCOUNT_B }),
    ...codexQuotaCapturesFromWeeklyObservations([{
      provider: 'codex', seriesKey: 'codex', observedAt: NOW, resetAt: RESET, usedPercent: 40,
    }]),
  ]);
  const a = fingerprintForStableIdentity(SALT, 'codex', 'official-account-scope-v1|' + ACCOUNT_A);
  const cleared = await repository.clear({ provider: 'codex', accountFingerprint: a });
  assert.deepEqual(cleared.observations, store.observations.filter(row => row.accountFingerprint !== a));
  assert.equal(cleared.observations.length, 2);
  assert.deepEqual(await repository.load(), cleared);
});
