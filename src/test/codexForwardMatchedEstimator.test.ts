import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createEmptyCodexIndex, normalizeCodexIndex } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { buildCodexForwardCalibration, CodexForwardCalibration } from '../providers/codex/codexForwardCalibration';
import { CodexAccountEstimator } from '../codexAccountEstimate';

const T = Date.parse('2026-10-23T03:00Z'), R = T + 604800000, K = '1'.repeat(64);
const book = { schemaVersion: 1, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] };
const sample = (at: number, p: number) => ({ accountScopeKey: 'a'.repeat(64), sourceScopeKey: 'b'.repeat(64),
  requestedAt: T + at + 100, observedAt: T + at + 7000, usedPercent: p, resetAt: R,
  quotaEpoch: { startedAt: T - 60000, resetAnchorAt: R, startLowerAt: null, reason: 'initial' as const } });
const estimator = () => new (require('../codexForwardMatchedEstimator').CodexForwardMatchedEstimator)();
function source(peer = false) {
  let index = createEmptyCodexIndex('UTC'), previous: CodexForwardCalibration | undefined;
  let resetAt = R;
  const counts = { inputTotal: 100, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 };
  index.files[K] = { fileKey: K, sourceArea: 'sessions', size: 100, offset: 100, mtimeMs: T - 1000,
    dev: 1, ino: 2, identityChecked: true, discardingOversizedLine: false, qualityFlags: [],
    parserState: { ...createCodexParserState(K), identityLocked: true, model: 'gpt-5' },
    lineage: { fingerprintBlocks: [], pendingFingerprints: ['0'.repeat(32)], tokenEvents: 1, desiredPrefixEvents: 0, appliedPrefixEvents: 0 },
    aggregate: { total: counts, byModel: { 'gpt-5': counts }, byDay: {}, byEffort: {},
      session: { sessionKey: K, role: 'root', startedAt: T - 2000, endedAt: T - 1000 },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } } };
  const J = '2'.repeat(64);
  if (peer) {
    const f = structuredClone(index.files[K]); f.fileKey = J; f.ino = 3;
    f.parserState = { ...createCodexParserState(J), identityLocked: true, model: 'gpt-5' };
    f.aggregate.session.sessionKey = J; index.files[J] = f;
  }
  index.coverage.totalFiles = index.coverage.indexedFiles = peer ? 2 : 1;
  const next = (at: number, rows: Array<[number, number, number]> = [], missing = false, peerRows: Array<[number, number, number]> = []) => {
    for (const [key, values] of [[K, rows], [J, peerRows]] as const) {
    const f = index.files[key]; if (!f) continue;
    const beforeOffset = f.offset;
    if (values.length) {
      const slices = values.map(([t, input, p]) => ({ from: T + t, through: T + t, model: 'gpt-5',
        tokens: { inputTotal: input, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 },
        quota: { observedAt: T + t, resetAt, usedPercent: p } }));
      for (const row of slices) { f.aggregate.total.inputTotal += row.tokens.inputTotal;
        f.lineage!.pendingFingerprints.push(f.lineage!.tokenEvents.toString(16).padStart(32, '0')); f.lineage!.tokenEvents++; }
      f.aggregate.byModel = { 'gpt-5': { ...f.aggregate.total } };
      f.offset = f.size = beforeOffset + values.length * 100; f.mtimeMs = slices[slices.length - 1].through;
      f.aggregate.session.endedAt = f.mtimeMs;
      f.calibrationAppend = { beforeOffset, throughOffset: f.offset, minUsageAt: slices[0].from,
        maxUsageAt: f.mtimeMs, complete: true, ...(missing ? {} : { slices }) };
    }
    }
    // Canonicalize the hand-authored primary DTO like a warm worker input,
    // retaining only this pass's runtime append witness alongside it.
    const windows = Object.fromEntries(Object.entries(index.files).map(([key, f]) => [key, f.calibrationAppend]));
    index = normalizeCodexIndex(index)!;
    for (const [key, window] of Object.entries(windows)) if (window) index.files[key].calibrationAppend = window;
    const proof = (buildCodexForwardCalibration as any)(index, true, new Set(Object.keys(index.files)), new Set(), T + at, {}, previous, true);
    assert.ok(proof); previous = proof; index = normalizeCodexIndex(index)!;
    return proof as CodexForwardCalibration;
  };
  return Object.assign(next, { setReset(value: number) { resetAt = value; } });
}
function calibrated() {
  const next = source(), e = estimator();
  e.observe(sample(0, 20), next(0), book);
  e.observe(sample(120000, 22), next(120000, [[20000, 1000, 21], [100000, 1000, 22]]), book);
  const first = e.observe(sample(240000, 24), next(240000, [[200000, 4000, 24]]), book);
  assert.equal(first?.fullEquivalentUsd, 200);
  return { next, e, first };
}
test('busy official RPC edges fit only matched local endpoints and preserve exact repeated-proof progress', () => {
  const next = source(), e = estimator();
  assert.equal(e.observe(sample(0, 20), next(0), book), undefined);
  assert.equal(e.observe(sample(120000, 22), next(120000, [[4000, 1000, 20], [20000, 5000, 21], [100000, 1000, 22]]), book), undefined);
  assert.equal(e.calibrationStatus().state, 'first-step-discarded');
  const proof = next(240000, [[124000, 1000, 22], [150000, 1000, 22], [200000, 2000, 24]]);
  const one = e.observe(sample(240000, 24), proof, book);
  assert.equal(one?.fullEquivalentUsd, 200); assert.equal(one?.usedEquivalentUsd, 4);
  assert.equal(one?.calibrationEvidence.methodVersion, 2);
  assert.equal(one?.calibrationEvidence.accumulated.deltaPercent, 2);
  assert.equal(one?.calibrationEvidence.interval.percentFrom, 20);
  assert.equal(one?.calibrationEvidence.matchedCut.percentFrom, 22);
  assert.equal(e.observe(sample(250000, 24), proof, book), undefined);
  assert.deepEqual(e.calibrationStatus(), { state: 'accumulating', deltaPercent: 2, intervals: 1 });
  assert.equal(e.calibrationDiagnostics().reason, 'proof-reused-noop');
  const two = e.observe(sample(360000, 27), next(360000, [[244000, 1000, 24], [300000, 3000, 27]]), book);
  assert.equal(two?.usedEquivalentUsd, 8); assert.equal(two?.fullEquivalentUsd, 160);
  assert.equal(two?.calibrationEvidence.accumulated.deltaPercent, 5);
  assert.equal(two?.calibrationEvidence.accumulated.intervals, 2);
  assert.equal(two?.calibrationStart, T + 100000);
  assert.equal(e.calibrationStatus().state, 'calibrated');
});
test('unsealed cross-source quota tails are merged before committing global chronological order', () => {
  const next = source(true), e = estimator(); e.observe(sample(0, 20), next(0), book);
  const before = next(120000, [[20000, 1000, 21], [100000, 1000, 22], [120050, 1000, 22]]);
  e.observe(sample(120000, 22), before, book);
  const after = next(240000, [], false, [[120020, 1000, 22], [200000, 1000, 24]]);
  const collect = require('../providers/codex/codexForwardMatchedCuts').collectCodexForwardSliceDelta;
  assert.ok(collect(before, after, book), 'the whole two-source delta reconciles before chronological admission');
  const result = e.observe(sample(240000, 24), after, book);
  assert.equal(result?.usedEquivalentUsd, 3); assert.equal(result?.fullEquivalentUsd, 150);
});
test('a late local quota before an already-known official request cannot exceed that official upper bound', () => {
  const next = source(true), e = estimator(); e.observe(sample(0, 20), next(0), book);
  e.observe(sample(120000, 22), next(120000, [[20000, 1000, 21], [100000, 1000, 22]]), book);
  const result = e.observe(sample(240000, 26), next(240000, [], false, [[120050, 1000, 24], [200000, 1000, 26]]), book);
  assert.equal(result, undefined); assert.equal(e.calibrationStatus().state, 'endpoint-mismatch');
  assert.equal(e.calibrationStatus().deltaPercent, 0);
});
test('flat percentages retain all matched dollars across many polls without resetting the monetary left cut', () => {
  const next = source(), e = estimator(); e.observe(sample(0, 20), next(0), book);
  e.observe(sample(120000, 22), next(120000, [[20000, 1000, 21], [100000, 1000, 22]]), book);
  for (let n = 2; n <= 8; n++) assert.equal(e.observe(sample(n * 120000, 22),
    next(n * 120000, [[n * 120000 - 10000, 1000, 22]]), book), undefined);
  const result = e.observe(sample(1080000, 24), next(1080000, [[1070000, 1000, 24]]), book);
  assert.equal(result?.usedEquivalentUsd, 8); assert.equal(result?.fullEquivalentUsd, 400);
  assert.equal(result?.calibrationEvidence.accumulated.deltaPercent, 2);
});
test('missing append detail, copied proofs, correction and blur cannot resurrect a monetary baseline', () => {
  const next = source(), e = estimator(); e.observe(sample(0, 20), next(0), book);
  e.observe(sample(120000, 22), next(120000, [[20000, 1000, 21], [100000, 1000, 22]]), book);
  assert.equal(e.observe(sample(240000, 24), next(240000, [[200000, 1000, 24]], true), book), undefined);
  assert.equal(e.calibrationStatus().state, 'append-incomplete');
  const proof = next(360000, [[300000, 1000, 26]]);
  assert.equal(e.observe(sample(360000, 26), structuredClone(proof), book), undefined);
  assert.equal(e.calibrationStatus().state, 'source-unavailable');
  e.breakContinuity();
  assert.equal(e.observe(sample(480000, 25), next(480000, [[470000, 1000, 25]]), book), undefined);
  assert.equal(e.calibrationStatus().deltaPercent, 0);
});
test('matched diagnostics distinguish missing numeric detail from usage after the official request', () => {
  for (const kind of ['missing-detail', 'after-request'] as const) {
    const next = source(), e = estimator(); e.observe(sample(0, 20), next(0), book);
    const rows: Array<[number, number, number]> = kind === 'missing-detail'
      ? [[100000, 1000, 22]] : [[120101, 1000, 22]];
    assert.equal(e.observe(sample(120000, 22), next(120000, rows, kind === 'missing-detail'), book), undefined);
    assert.equal(e.calibrationStatus().state, 'append-incomplete');
    assert.equal(e.calibrationDiagnostics().reason,
      kind === 'missing-detail' ? 'slice-detail-missing' : 'usage-after-request');
    assert.equal(e.calibrationStatus().deltaPercent, 0);
  }
});
test('production facade routes declared detailed collection and does not fall back to historical amounts on missing proof', () => {
  const next = source(), e = new CodexAccountEstimator();
  const inputs = (proof: unknown) => ({ codexForwardCollectionVersion: 1, codexForwardCalibration: proof,
    calibrationPricebook: book, usage: [], observations: [], localHistoryComplete: true }) as any;
  e.observe(sample(0, 20), inputs(next(0)), 'api-v1');
  e.observe(sample(120000, 22), inputs(next(120000, [[4000, 1000, 20], [20000, 5000, 21], [100000, 1000, 22]])), 'api-v1');
  assert.equal(e.calibrationStatus().state, 'first-step-discarded');
  const result = e.observe(sample(240000, 24), inputs(next(240000, [[124000, 1000, 22], [200000, 3000, 24]])), 'api-v1');
  assert.equal(result?.fullEquivalentUsd, 200);
  assert.equal(result?.calibrationEvidence?.methodVersion, 2);
  assert.equal(e.observe(sample(360000, 26), inputs(undefined), 'api-v1'), undefined);
  assert.equal(e.calibrationDiagnostics().reason, 'proof-missing');
});
test('A-B-A never includes the switched-account interval in matched USD', () => {
  const { next, e } = calibrated();
  assert.equal(e.observe({ ...sample(360000, 50), accountScopeKey: 'c'.repeat(64) },
    next(360000, [[350000, 100000, 50]]), book), undefined);
  assert.equal(e.observe(sample(480000, 50), next(480000, [[470000, 100000, 50]]), book), undefined);
  assert.equal(e.observe(sample(600000, 52), next(600000, [[590000, 1000, 52]]), book), undefined);
  const resumed = e.observe(sample(720000, 54), next(720000, [[710000, 2000, 54]]), book);
  assert.equal(resumed?.usedEquivalentUsd, 6); assert.equal(resumed?.fullEquivalentUsd, 150);
  assert.equal(resumed?.calibrationEvidence.accumulated.deltaPercent, 4);
});
test('a correction after blur retires the old matched cohort instead of counting its points twice', () => {
  const { next, e } = calibrated(); e.breakContinuity();
  e.observe(sample(360000, 23), next(360000, [[350000, 1000, 23]]), book);
  assert.equal(e.calibrationDiagnostics().reason, 'counter-correction');
  assert.equal(e.observe(sample(480000, 25), next(480000, [[470000, 1000, 25]]), book), undefined);
  const result = e.observe(sample(600000, 27), next(600000, [[590000, 2000, 27]]), book);
  assert.equal(result?.usedEquivalentUsd, 2); assert.equal(result?.calibrationEvidence.accumulated.intervals, 1);
});
test('an early reset starts a separately priced actual epoch without assuming its predecessor lasted seven days', () => {
  const { next, e, first } = calibrated(), resetAt = R + 360000;
  next.setReset(resetAt);
  const changed = (at: number, p: number) => ({ ...sample(at, p), resetAt,
    quotaEpoch: { startedAt: T + 367000, startLowerAt: T + 247000, resetAnchorAt: resetAt, reason: 'reset-change' as const } });
  assert.equal(e.observe(changed(360000, 0), next(360000, [[350000, 1000, 0]]), book), undefined);
  assert.equal(e.observe(changed(480000, 2), next(480000, [[470000, 1000, 2]]), book), undefined);
  const current = e.observe(changed(600000, 7), next(600000, [[590000, 5000, 7]]), book);
  assert.equal(current?.fullEquivalentUsd, 100); assert.equal(current?.usedEquivalentUsd, 5);
  assert.equal(current?.calibrationEvidence.accumulated.deltaPercent, 5);
  assert.equal(current?.calibrationEvidence.accumulated.intervals, 1);
  assert.notEqual(current?.quotaEpoch.startedAt, first.quotaEpoch.startedAt);
  assert.equal(current?.windowStart, T + 247000);
});
test('changed rates with the same public price label cannot reuse the earlier matched cohort', () => {
  const { next, e } = calibrated(), changed = { ...book, rates: [{ ...book.rates[0], input: .002 }] };
  assert.equal(e.observe(sample(360000, 26), next(360000, [[350000, 1000, 26]]), changed), undefined);
  assert.equal(e.observe(sample(480000, 28), next(480000, [[470000, 1000, 28]]), changed), undefined);
  const result = e.observe(sample(600000, 30), next(600000, [[590000, 2000, 30]]), changed);
  assert.equal(result?.usedEquivalentUsd, 4); assert.equal(result?.calibrationEvidence.accumulated.deltaPercent, 2);
});
