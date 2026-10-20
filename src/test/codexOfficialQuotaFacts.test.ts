import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  codexQuotaCaptureFromOfficialSample, createEmptyQuotaObservationStore,
  loadQuotaObservationStore, mergeQuotaCaptures, QuotaObservationRepository,
  saveQuotaObservationStoreAtomic, type QuotaCapture,
} from '../quotaObservationStore';
import {
  copyCodexOfficialQuotaFacts, parseCodexOfficialQuotaFacts, codexOfficialQuotaFactsEvidenceKey,
} from '../codexOfficialQuotaFacts';

const T = Date.parse('2026-10-19T02:00:00Z'), R = T + 6 * 86_400_000;
const salt = 'synthetic-official-facts-salt';
const credit = { creditKey: 'c'.repeat(64), status: 'available', resetType: 'codexRateLimits', grantedAt: T - 1000 };
function sample(extra: object = {}, at = T, key = 'a'.repeat(64)) {
  return { accountScopeKey: key, requestedAt: at - 1, observedAt: at, resetAt: R, usedPercent: 12, ...extra };
}
function capture(extra: object = {}, at = T, key?: string): QuotaCapture {
  return codexQuotaCaptureFromOfficialSample(sample(extra, at, key))!;
}
function facts(value: unknown): unknown { return (value as { officialFacts?: unknown }).officialFacts; }
function merge(captures: QuotaCapture[], limitPerSeries = 512) {
  return mergeQuotaCaptures(createEmptyQuotaObservationStore(), captures, { salt, now: T + 100_000, limitPerSeries });
}

test('official capture copies only sanitized facts and legacy samples still work', () => {
  const windows = {
    primary: { windowDurationMins: 300, usedPercent: 0, resetAt: null },
  };
  const input = sample({ ordinaryUsageAllowed: false, windows,
    rateLimitResetCredits: { availableCount: 0, credits: [{ ...credit, expiresAt: null, id: 'RAW-ID' }] },
  planType: 'PRIVATE-PLAN', accountName: 'PRIVATE-NAME', title: 'PRIVATE-TITLE' });
  const result = codexQuotaCaptureFromOfficialSample(input)!;
  assert.deepEqual(facts(result), { schemaVersion: 1, requestedAt: T - 1,
    ordinaryUsageAllowed: false, windows,
    rateLimitResetCredits: { availableCount: 0, credits: [{ ...credit, expiresAt: null }] } });
  assert.doesNotMatch(JSON.stringify(result), /RAW-ID|PRIVATE-/);
  const { requestedAt: _unused, ...legacy } = sample();
  assert.ok(codexQuotaCaptureFromOfficialSample(legacy));
  assert.equal(facts(codexQuotaCaptureFromOfficialSample(legacy)), undefined);
});

test('missing, null, zero and empty optional evidence stay distinct through merge', () => {
  for (const optional of [{}, { ordinaryUsageAllowed: null }, { ordinaryUsageAllowed: true },
    { rateLimitResetCredits: null }, { rateLimitResetCredits: { availableCount: 0 } },
    { rateLimitResetCredits: { availableCount: 0, credits: null } },
    { rateLimitResetCredits: { availableCount: 0, credits: [] } }]) {
    const result = merge([capture(optional)]);
    assert.deepEqual(facts(result.observations[0]), { schemaVersion: 1, requestedAt: T - 1, ...optional });
    assert.equal((result as { schemaRevision?: number }).schemaRevision, 1);
  }
});

test('same-point facts changes survive dedup while exact replay is idempotent', () => {
  const a = capture({ ordinaryUsageAllowed: true });
  const b = capture({ ordinaryUsageAllowed: false });
  const result = merge([a, b, a]);
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.observations.map(facts), [facts(a), facts(b)]);
});

test('compaction retains first/latest and optional-evidence transitions before routine polls', () => {
  const inputs = Array.from({ length: 20 }, (_, i) => capture({ ordinaryUsageAllowed: i < 7,
    windows: { primary: { windowDurationMins: 300, usedPercent: i, resetAt: R } },
  }, T + i * 1000));
  const result = merge(inputs, 4);
  assert.equal(result.observations.length, 4);
  assert.deepEqual(result.observations.map(row => row.observedAt), [T, T + 6000, T + 7000, T + 19000]);
  assert.equal(new Set(result.observations.map(row => row.windowId)).size, 1);
});

test('facts are admitted only on verified official Codex observations', () => {
  for (const override of [
    { source: 'codex-local-structured-event' as const },
    { provider: 'claude' as const, source: 'claude-official-api' as const },
    { accountAttribution: 'profile-continuity' as const },
  ]) {
    assert.equal(facts(merge([{ ...capture({ ordinaryUsageAllowed: true }), ...override }]).observations[0]), undefined);
  }
});

test('P2 roundtrip, clones and account/provider/all clears retain only the intended evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-official-facts-'));
  const file = path.join(directory, 'quota-observations-v2.json');
  const repository = new QuotaObservationRepository(file, salt, () => T + 100_000);
  const extra = { rateLimitResetCredits: { availableCount: 1, credits: [{ ...credit }] } };
  const inputs = [capture(extra), capture(extra, T + 1, 'b'.repeat(64))];
  const result = await repository.append(inputs);
  const expected = JSON.stringify(result);
  ((facts(result.observations[0]) as any).rateLimitResetCredits.credits[0]).status = 'redeemed';
  assert.equal(JSON.stringify(await repository.load()), expected);
  assert.equal((await loadQuotaObservationStore(file, { now: T + 100_000 })).disposition, 'valid');
  assert.deepEqual(facts((await repository.load()).observations[0]), facts(inputs[0]));
  const account = result.observations[0].accountFingerprint;
  const remaining = await repository.clear({ provider: 'codex', accountFingerprint: account });
  assert.equal(remaining.observations.length, 1);
  assert.deepEqual(facts(remaining.observations[0]), facts(inputs[1]));
  assert.equal((await repository.clear({ provider: 'codex' })).observations.length, 0);
  await repository.append(inputs);
  assert.equal((await repository.clear()).observations.length, 0);
});

test('strict persisted validation rejects malformed facts without replacing the valid file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-official-facts-invalid-'));
  const file = path.join(directory, 'quota-observations-v2.json');
  const valid = merge([capture({ ordinaryUsageAllowed: true }), capture({}, T + 1, 'b'.repeat(64))]);
  await saveQuotaObservationStoreAtomic(file, valid);
  const before = await readFile(file, 'utf8');
  for (const invalid of [{ schemaVersion: 2, requestedAt: T }, { schemaVersion: 1, requestedAt: T, rawId: 'PRIVATE-ID' },
    { schemaVersion: 1, requestedAt: T, ordinaryUsageAllowed: 0 },
    { schemaVersion: 1, requestedAt: T, rateLimitResetCredits: { availableCount: -1 } }]) {
    const changed = { ...valid, observations: valid.observations.map((row, i) => i ? row : { ...row, officialFacts: invalid }) };
    await assert.rejects(saveQuotaObservationStoreAtomic(file, changed as any), /invalid/);
    assert.equal(await readFile(file, 'utf8'), before);
  }
});

test('future P2 revisions cannot be silently overwritten by append, including after quarantine', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-official-facts-future-'));
  const file = path.join(directory, 'quota-observations-v2.json');
  const future = JSON.stringify({ ...merge([capture()]), schemaRevision: 2 });
  await writeFile(file, future);
  const repository = new QuotaObservationRepository(file, salt, () => T + 100_000);
  await assert.rejects(repository.append([capture({}, T + 1)]));
  await assert.rejects(repository.append([capture({}, T + 2)]));
});

test('copier accepts unknown safely without reading extra fields, inherited values or accessors', () => {
  let reads = 0;
  const input = Object.assign(Object.create({ ordinaryUsageAllowed: true }), {
    requestedAt: T, rateLimitResetCredits: { availableCount: 1, credits: [{ ...credit }] },
  });
  for (const key of ['title', 'path', 'secret', 'ordinaryUsageAllowed']) {
    Object.defineProperty(input, key, { enumerable: true, get() { reads++; throw new Error('must not read'); } });
  }
  const result = copyCodexOfficialQuotaFacts(input)!;
  assert.equal(reads, 0);
  assert.deepEqual(result, { schemaVersion: 1, requestedAt: T,
    rateLimitResetCredits: { availableCount: 1, credits: [{ ...credit }] } });
  input.rateLimitResetCredits.credits[0].status = 'redeemed';
  assert.equal(result.rateLimitResetCredits?.credits?.[0].status, 'available');
  for (const value of [null, [], true, 0, 'private', {}, { requestedAt: NaN },
    { requestedAt: Infinity }, { requestedAt: -1 }, { requestedAt: 0 }, { requestedAt: Number.MAX_SAFE_INTEGER },
    { requestedAt: T + .1 }, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(); } })]) {
    assert.equal(copyCodexOfficialQuotaFacts(value), undefined);
  }
});

test('invalid or inaccessible optional lists preserve the independent authoritative count', () => {
  const badLists: unknown[] = [undefined, {}, Array(1), Array(129).fill(credit),
    [credit, credit], [{ ...credit, creditKey: 'raw-id' }], [{ ...credit, status: 'raw-status' }],
    [{ ...credit, resetType: 'raw-reset' }], [{ ...credit, grantedAt: -1 }],
    [{ ...credit, expiresAt: NaN }],
    new Proxy([], { getOwnPropertyDescriptor() { throw new Error('inaccessible'); } })];
  for (const credits of badLists) {
    assert.deepEqual(copyCodexOfficialQuotaFacts({ requestedAt: T,
      rateLimitResetCredits: { availableCount: 3, credits } }), {
      schemaVersion: 1, requestedAt: T, rateLimitResetCredits: { availableCount: 3 },
    });
  }
  const inaccessibleSummary = new Proxy({ availableCount: 3 }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'credits') throw new Error('inaccessible details');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(copyCodexOfficialQuotaFacts({ requestedAt: T, rateLimitResetCredits: inaccessibleSummary }), {
    schemaVersion: 1, requestedAt: T, rateLimitResetCredits: { availableCount: 3 },
  });
});

test('strict facts reject unknown nested fields and malformed evidence, never coercing null or zero', () => {
  const window = { windowDurationMins: null, usedPercent: 0, resetAt: null };
  const base = { schemaVersion: 1, requestedAt: T };
  const valid = { ...base, ordinaryUsageAllowed: null, windows: { primary: window },
    rateLimitResetCredits: { availableCount: 0, credits: [{ ...credit, expiresAt: 0 }] } };
  assert.deepEqual(parseCodexOfficialQuotaFacts(valid), valid);
  for (const patch of [{ schemaVersion: undefined }, { requestedAt: null }, { secret: 'raw' },
    { ordinaryUsageAllowed: 0 }, { ordinaryUsageAllowed: undefined }, { windows: null },
    { windows: { primary: { ...window, rawId: 'private' } } },
    { windows: { primary: { ...window, resetAt: 0 } } },
    { windows: { primary: { ...window, usedPercent: 101 } } },
    { windows: { primary: { ...window, windowDurationMins: 0 } } },
    { windows: { tertiary: window } }, { rateLimitResetCredits: { availableCount: null } },
    { rateLimitResetCredits: { availableCount: 0, credits: [{ ...credit, expiresAt: undefined }] } },
    { rateLimitResetCredits: { availableCount: 0, credits: [{ ...credit, title: 'private' }] } },
    { rateLimitResetCredits: { availableCount: 0, credits: null, description: 'private' } }]) {
    assert.equal(parseCodexOfficialQuotaFacts({ ...base, ...patch }), null);
  }
  assert.equal(parseCodexOfficialQuotaFacts(Object.defineProperty({ ...base }, 'ordinaryUsageAllowed', {
    get() { throw new Error('must not invoke'); }, enumerable: true,
  })), null);
});

test('credit list order and per-poll request times are not evidence changes', () => {
  const a = { schemaVersion: 1 as const, requestedAt: T,
    rateLimitResetCredits: { availableCount: 2, credits: [
      { ...credit, status: 'available' as const, resetType: 'codexRateLimits' as const },
      { ...credit, creditKey: 'd'.repeat(64), status: 'redeemed' as const, resetType: 'codexRateLimits' as const },
    ] } };
  const b = { ...a, requestedAt: T + 1000, rateLimitResetCredits: {
    ...a.rateLimitResetCredits, credits: [...a.rateLimitResetCredits.credits].reverse(),
  } };
  assert.equal(codexOfficialQuotaFactsEvidenceKey(a), codexOfficialQuotaFactsEvidenceKey(b));
  assert.notEqual(codexOfficialQuotaFactsEvidenceKey(a), codexOfficialQuotaFactsEvidenceKey({ ...a, ordinaryUsageAllowed: null }));
});

test('merge clones existing nested facts and retention removes embedded evidence with its observation', () => {
  const inputs = [capture({ rateLimitResetCredits: { availableCount: 1, credits: [credit] } })];
  const previous = merge(inputs);
  const next = mergeQuotaCaptures(previous, [], { salt, now: T });
  assert.notEqual(next.observations[0].officialFacts, previous.observations[0].officialFacts);
  next.observations[0].officialFacts!.rateLimitResetCredits!.credits![0].status = 'redeemed';
  assert.equal(previous.observations[0].officialFacts!.rateLimitResetCredits!.credits![0].status, 'available');
  assert.equal(mergeQuotaCaptures(previous, [], { salt, now: T + 181 * 86_400_000 }).observations.length, 0);
});

test('persisted same-point changed evidence survives strict dedup and future writes preserve history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-official-facts-dedup-'));
  const file = path.join(directory, 'quota-observations-v2.json');
  const store = merge([capture({ rateLimitResetCredits: null }),
    capture({ rateLimitResetCredits: { availableCount: 0, credits: [] } })]);
  await saveQuotaObservationStoreAtomic(file, store);
  const result = await loadQuotaObservationStore(file, { now: T });
  assert.equal(result.store.observations.length, 2);
  const before = await readFile(file, 'utf8');
  await assert.rejects(saveQuotaObservationStoreAtomic(file, { ...store, schemaRevision: 2 } as any));
  assert.equal(await readFile(file, 'utf8'), before);
});
