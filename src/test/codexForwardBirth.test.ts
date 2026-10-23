import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexForwardAccountEstimator, CodexCalibrationState } from '../codexForwardAccountEstimate';
import { OfficialQuotaSample } from '../codexAccountEstimate';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
import { classifyCodexSessionDuplicates } from '../providers/codex/codexDedup';
import { buildCodexForwardCalibration, CodexForwardCalibration } from '../providers/codex/codexForwardCalibration';

const T = Date.parse('2026-10-20T06:00Z'), M = 60_000, R = T + 604_799_000;
const K = '1'.repeat(64), H = '2'.repeat(64), J = '3'.repeat(64);
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] };
const line = (value: unknown) => JSON.stringify(value) + '\n';
const usage = (at: number, p: number, input: number) => line({ type: 'event_msg',
  timestamp: new Date(at).toISOString(), payload: { type: 'token_count',
    info: { last_token_usage: { input_tokens: input, output_tokens: 0 } },
    rate_limits: { limit_id: 'codex', secondary: { used_percent: p, window_minutes: 10080, resets_at: R } } } });
const sample = (proof: CodexForwardCalibration, p: number): OfficialQuotaSample => ({
  accountScopeKey: 'a'.repeat(64), sourceScopeKey: 'b'.repeat(64), requestedAt: proof.verifiedAt + 100,
  observedAt: proof.verifiedAt + 200, usedPercent: p, resetAt: R,
  quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
});

/** Production scanner and producer; all bodies, manifests and disk DTOs are
 * synthetic memory. Worker-equivalent reload strips every runtime witness. */
class Fixture {
  readonly files = new Map<string, { body: string; ino: number }>();
  private disk = createEmptyCodexIndex('UTC');
  private previous?: CodexForwardCalibration;
  readonly reads: Array<{ key: string; start: number }> = [];
  root(key: string, at: number, p: number, input: number, options: { model?: string; parent?: string; id?: string } = {}): void {
    this.files.set(key, { ino: Number(key[0]) + 10, body:
      line({ type: 'session_meta', payload: { id: options.id ?? key,
        ...(options.parent ? { forked_from_id: options.parent } : {}) } }) +
      line({ type: 'turn_context', payload: { model: options.model ?? 'gpt-5' } }) + usage(at, p, input) });
  }
  append(key: string, at: number, p: number, input: number): void { this.files.get(key)!.body += usage(at, p, input); }
  async snapshot(at: number, prior: 'live' | 'serialized' | 'restart' = 'live'): Promise<CodexForwardCalibration> {
    const files = this.files, reads = this.reads;
    const entries = [...this.files].map(([key, file]) => ({ fileKey: key, sourceArea: 'sessions' as const,
      size: Buffer.byteLength(file.body), mtimeMs: T + Buffer.byteLength(file.body), dev: 1, ino: file.ino,
      absolutePath: '/synthetic/not-read/' + key, nonPersisted: true as const }));
    const result = await updateCodexIndex(normalizeCodexIndex(this.disk)!, {
      files: entries, persistable: Object.fromEntries(entries.map(({ absolutePath: _path, nonPersisted: _runtime, ...entry }) =>
        [entry.fileKey, entry])),
    }, { salt: 'synthetic-birth', timeZone: 'UTC', now: () => at, allowHistoricalBackfill: false,
      allowAchievementHourProof: false, io: { async *read(entry, start, end) {
        reads.push({ key: entry.fileKey, start });
        yield Buffer.from(files.get(entry.fileKey)!.body).subarray(start, end);
      } } });
    assert.equal(result.failedFiles, 0);
    this.disk = normalizeCodexIndex(result.index)!;
    assert.ok(Object.values(this.disk.files).every(file => file.calibrationAppend === undefined));
    const transport = structuredClone(result.index), ownership = classifyCodexSessionDuplicates(transport.files);
    const previous = prior === 'restart' ? undefined : prior === 'serialized'
      ? JSON.parse(JSON.stringify(this.previous)) : this.previous;
    const proof = buildCodexForwardCalibration(transport, true, ownership.canonicalFileKeys,
      ownership.ambiguousFileKeys, at, {}, previous);
    assert.ok(proof);
    this.previous = proof;
    return proof;
  }
}

async function aligned() {
  const fixture = new Fixture(), estimator = new CodexForwardAccountEstimator();
  fixture.root(K, T + M - 1000, 10, 1000);
  const first = await fixture.snapshot(T + M);
  assert.equal(estimator.observe(sample(first, 10), first, book), undefined);
  fixture.append(K, T + 2 * M - 1000, 20, 1000);
  const before = await fixture.snapshot(T + 2 * M);
  assert.equal(estimator.observe(sample(before, 20), before, book), undefined);
  assert.equal(estimator.calibrationStatus().state, 'first-step-discarded');
  return { fixture, estimator, before };
}

async function metadataBaseline() {
  const fixture = new Fixture(), estimator = new CodexForwardAccountEstimator();
  fixture.root(K, T + M - 1000, 10, 1000);
  const first = await fixture.snapshot(T + M);
  estimator.observe(sample(first, 10), first, book);
  fixture.files.set(H, { ino: 12, body: line({ type: 'session_meta', payload: { id: H } }) +
    line({ type: 'turn_context', payload: { model: 'gpt-5' } }) });
  const before = await fixture.snapshot(T + 2 * M), source = before.sources.find(source => source.sourceKey === H)!;
  assert.equal(source.eligible, true);
  assert.equal(source.usageThrough, null);
  assert.equal(estimator.observe(sample(before, 10), before, book), undefined);
  assert.equal(estimator.calibrationStatus().state, 'percentage-step', 'known-zero birth preserves the flat official baseline');
  return { fixture, estimator, before };
}

test('eligible metadata-only newborn can receive its first timed request, discard the first step and then fit', async () => {
  const { fixture, estimator } = await metadataBaseline();
  fixture.append(H, T + 3 * M - 1000, 20, 1000);
  const firstUsage = await fixture.snapshot(T + 3 * M);
  assert.equal(estimator.observe(sample(firstUsage, 20), firstUsage, book), undefined);
  assert.equal(estimator.calibrationStatus().state, 'first-step-discarded');
  fixture.append(H, T + 4 * M - 1000, 30, 2000);
  const secondUsage = await fixture.snapshot(T + 4 * M);
  const result = estimator.observe(sample(secondUsage, 30), secondUsage, book);
  assert.equal(result?.fullEquivalentUsd, 20);
  assert.equal(result?.calibrationEvidence?.accumulated.deltaPercent, 10);
  assert.equal(result?.calibrationEvidence?.accumulated.totalTokens, 2000);
  assert.equal(result?.calibrationStart, sample(firstUsage, 20).observedAt);
});

test('the first request after a zero metadata baseline still needs the official time bracket and endpoint', async () => {
  for (const kind of ['stale', 'in-flight', 'endpoint'] as const) {
    const { fixture, estimator, before } = await metadataBaseline();
    const at = kind === 'stale' ? sample(before, 10).observedAt : kind === 'in-flight'
      ? T + 3 * M + 101 : T + 3 * M - 1000;
    fixture.append(H, at, kind === 'endpoint' ? 19 : 20, 1000);
    const after = await fixture.snapshot(T + 3 * M);
    assert.equal(estimator.observe(sample(after, 20), after, book), undefined, kind);
    assert.equal(estimator.calibrationStatus().state, kind === 'endpoint' ? 'endpoint-mismatch' : 'append-incomplete', kind);
  }
});

test('root birth plus watcher append and normalized warm reload prices the complete initial vector', async () => {
  const { fixture, estimator } = await aligned();
  fixture.root(H, T + 3 * M - 2100, 25, 2000);
  const born = await fixture.snapshot(T + 3 * M - 2000);
  assert.equal(born.sources.find(source => source.sourceKey === H)!.appendWindows![0].beforeOffset, 0);
  fixture.append(H, T + 3 * M - 1100, 30, 3000);
  await fixture.snapshot(T + 3 * M - 1000);
  const reads = fixture.reads.length, after = await fixture.snapshot(T + 3 * M);
  assert.equal(fixture.reads.length, reads, 'warm official publication reads no source body');
  const result = estimator.observe(sample(after, 30), after, book);
  assert.equal(result?.fullEquivalentUsd, 50);
  assert.equal(result?.calibrationEvidence?.interval.deltaUsd, 5);
  assert.equal(result?.calibrationEvidence?.interval.totalTokens, 5000);
  assert.equal(result?.calibrationEvidence?.interval.linkedSources, 1);
  assert.equal(result?.calibrationEvidence?.accumulated.deltaPercent, 10);
  assert.equal(estimator.calibrationStatus().state, 'calibrated');
  assert.equal(fixture.reads.filter(read => read.key === H && read.start === 0).length, 1);

  fixture.append(H, T + 4 * M - 2000, 35, 1000);
  fixture.root(J, T + 4 * M - 1000, 40, 4000);
  const next = await fixture.snapshot(T + 4 * M);
  const combined = estimator.observe(sample(next, 40), next, book);
  assert.equal(combined?.fullEquivalentUsd, 50, 'old-source delta and new-source full vector share the denominator');
  assert.equal(combined?.calibrationEvidence?.interval.deltaUsd, 5);
  assert.equal(combined?.calibrationEvidence?.interval.linkedSources, 2);
  assert.equal(combined?.calibrationEvidence?.accumulated.deltaPercent, 20);
});

test('new roots do not bypass arbitrary initial-span discard or global old endpoint evidence', async () => {
  const fixture = new Fixture(), estimator = new CodexForwardAccountEstimator();
  fixture.root(K, T + M - 1000, 10, 1000);
  const first = await fixture.snapshot(T + M);
  estimator.observe(sample(first, 10), first, book);
  fixture.root(H, T + 2 * M - 1000, 20, 2000);
  const second = await fixture.snapshot(T + 2 * M);
  assert.equal(estimator.observe(sample(second, 20), second, book), undefined);
  assert.equal(estimator.calibrationStatus().state, 'first-step-discarded');
  fixture.root(J, T + 3 * M - 1000, 30, 3000);
  const third = await fixture.snapshot(T + 3 * M);
  assert.equal(estimator.observe(sample(third, 30), third, book)?.fullEquivalentUsd, 30);

  const mismatched = new CodexForwardAccountEstimator();
  mismatched.observe(sample(first, 11), first, book);
  assert.equal(mismatched.observe(sample(second, 20), second, book), undefined);
  assert.equal(mismatched.calibrationStatus().state, 'endpoint-mismatch');
});

test('birth denies stale/in-flight dollars, unknown pricing and mismatched current quota endpoints', async () => {
  for (const kind of ['stale', 'in-flight', 'unpriced', 'endpoint'] as const) {
    const { fixture, estimator, before } = await aligned();
    const at = kind === 'stale' ? sample(before, 20).observedAt : kind === 'in-flight'
      ? T + 3 * M + 101 : T + 3 * M - 1000;
    fixture.root(H, at, kind === 'endpoint' ? 29 : 30, 3000,
      kind === 'unpriced' ? { model: 'future-model' } : {});
    const after = await fixture.snapshot(T + 3 * M);
    assert.equal(estimator.observe(sample(after, 30), after, book), undefined, kind);
    const expected: CodexCalibrationState = kind === 'unpriced' ? 'unpriced-usage'
      : kind === 'endpoint' ? 'endpoint-mismatch' : 'append-incomplete';
    assert.equal(estimator.calibrationStatus().state, expected, kind);
  }
});

test('birth never replaces old sources or admits unknown children, ambiguous copies or unsafe initial bytes', async () => {
  for (const kind of ['deleted', 'rewritten', 'child', 'ambiguous', 'unsafe'] as const) {
    const { fixture, estimator } = await aligned();
    fixture.root(H, kind === 'ambiguous' ? T + M - 1000 : T + 3 * M - 1000, 30, 3000,
      kind === 'child' ? { parent: 'missing-synthetic-parent' } : kind === 'ambiguous' ? { id: K } : {});
    if (kind === 'deleted') fixture.files.delete(K);
    if (kind === 'rewritten') fixture.files.get(K)!.ino++;
    if (kind === 'unsafe') fixture.files.get(H)!.body += line({ type: 'future-unknown-event' });
    const after = await fixture.snapshot(T + 3 * M);
    assert.equal(estimator.observe(sample(after, 30), after, book), undefined, kind);
    assert.equal(estimator.calibrationStatus().state, 'source-changed', kind);
  }
});

test('birth provenance cannot be restored by serialized prior proofs, restart or copied current proof', async () => {
  for (const kind of ['serialized', 'restart', 'copied-current'] as const) {
    const { fixture, estimator } = await aligned();
    fixture.root(H, T + 3 * M - 1000, 30, 3000);
    const after = await fixture.snapshot(T + 3 * M, kind === 'copied-current' ? 'live' : kind);
    const proof = kind === 'copied-current' ? JSON.parse(JSON.stringify(after)) : after;
    assert.equal(estimator.observe(sample(after, 30), proof, book), undefined, kind);
    assert.equal(estimator.calibrationStatus().state, kind === 'copied-current' ? 'source-unavailable' : 'source-changed', kind);
  }
});
