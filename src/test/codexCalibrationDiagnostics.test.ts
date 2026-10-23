import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexForwardAccountEstimator } from '../codexForwardAccountEstimate';
import { CodexAccountEstimator, OfficialQuotaSample } from '../codexAccountEstimate';
import { createEmptyCodexIndex } from '../providers/codex/codexIndex';
import type { CodexFileContribution } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { buildCodexForwardCalibration } from '../providers/codex/codexForwardCalibration';
import { formatCodexCalibrationDiagnostic } from '../refreshDiagnostics';

const T = Date.parse('2026-10-21T02:00Z'), M = 60000, R = T + 6 * 86400000, K = '1'.repeat(64);
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] };
function sample(n: number, p = 20 + n): OfficialQuotaSample {
  return { accountScopeKey: 'a'.repeat(64), sourceScopeKey: 'b'.repeat(64),
    requestedAt: T + n * M - 100, observedAt: T + n * M, resetAt: R, usedPercent: p,
    quotaEpoch: { startedAt: T - M, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } };
}
function proof(n: number, verifiedAt = T + n * M - 500, p = 20 + n, patch?: (file: CodexFileContribution) => void) {
  const i = createEmptyCodexIndex('UTC'), at = T + n * M - 1000, total = (n + 1) * 100;
  const tokens = { inputTotal: total, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 };
  i.files[K] = { fileKey: K, sourceArea: 'sessions', size: 100 * (n + 1), offset: 100 * (n + 1), mtimeMs: at,
    dev: 1, ino: 2, identityChecked: true, discardingOversizedLine: false, qualityFlags: [],
    parserState: { ...createCodexParserState(K), identityLocked: true, model: 'gpt-5' },
    lineage: { fingerprintBlocks: [], pendingFingerprints: Array.from({ length: n + 1 }, (_, k) => k.toString(16).padStart(32, '0')),
      tokenEvents: n + 1, desiredPrefixEvents: 0, appliedPrefixEvents: 0 },
    aggregate: { total: tokens, byModel: { 'gpt-5': tokens }, byDay: {}, byEffort: {},
      session: { sessionKey: K, role: 'root', startedAt: T - M, endedAt: at },
      structural: { toolCalls: 0, patchCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } },
    quotaHistory: [{ provider: 'codex', seriesKey: 'codex', observedAt: at, resetAt: R, usedPercent: p }],
    ...(n ? { calibrationAppend: { beforeOffset: 100 * n, throughOffset: 100 * (n + 1),
      minUsageAt: at, maxUsageAt: at, complete: true } } : {}) };
  i.coverage.totalFiles = i.coverage.indexedFiles = 1;
  patch?.(i.files[K]);
  return buildCodexForwardCalibration(i, true, new Set([K]), new Set(), verifiedAt)!;
}
test('append rejection diagnostics separate source validity, missing evidence and official timing edges', () => {
  const cases = [
    ['source-ineligible', (f: CodexFileContribution) => { f.qualityFlags.push('stale-file'); }],
    ['append-window-missing', (f: CodexFileContribution) => { delete f.calibrationAppend; }],
    ['append-window-incomplete', (f: CodexFileContribution) => { f.calibrationAppend!.complete = false; }],
    ['usage-before-baseline', (f: CodexFileContribution) => { f.calibrationAppend!.minUsageAt = T; }],
    ['usage-after-request', (f: CodexFileContribution) => { f.calibrationAppend!.maxUsageAt = sample(1).requestedAt + 1; }],
  ] as const;
  for (const [reason, patch] of cases) {
    const e = new CodexForwardAccountEstimator(); e.observe(sample(0), proof(0), book);
    assert.equal(e.observe(sample(1), proof(1, T + M - 500, 21, patch), book), undefined);
    assert.equal(e.calibrationStatus().state, 'append-incomplete');
    assert.equal(e.calibrationDiagnostics().reason, reason);
  }
});
function statusShape(e: CodexForwardAccountEstimator | CodexAccountEstimator) {
  assert.deepEqual(Object.keys(e.calibrationStatus()).sort(), ['deltaPercent', 'intervals', 'state']);
}

test('reused, future and stale proofs differ from a large official observation gap without changing status shape', () => {
  const repeated = new CodexForwardAccountEstimator(), first = proof(0);
  repeated.observe(sample(0), first, book); repeated.observe(sample(1), first, book);
  assert.equal(repeated.calibrationDiagnostics().reason, 'proof-reused');
  assert.equal(repeated.calibrationDiagnostics().proofAgeMs, M + 500);
  assert.equal(repeated.calibrationStatus().state, 'continuity-gap'); statusShape(repeated);
  const future = new CodexForwardAccountEstimator();
  future.observe(sample(1), proof(1, sample(1).requestedAt + 1), book);
  assert.equal(future.calibrationDiagnostics().reason, 'proof-future'); statusShape(future);
  const stale = new CodexForwardAccountEstimator(); stale.observe(sample(6), proof(0), book);
  assert.equal(stale.calibrationDiagnostics().reason, 'proof-stale'); statusShape(stale);
  const gap = new CodexForwardAccountEstimator(); gap.observe(sample(0), proof(0), book);
  gap.observe(sample(6), proof(6), book);
  assert.equal(gap.calibrationDiagnostics().reason, 'observation-gap');
  assert.equal(gap.calibrationDiagnostics().proofAgeMs, 500);
  assert.equal(gap.calibrationDiagnostics().bracketGapMs, 6 * M); statusShape(gap);
});

test('baseline, invalid sample, epoch/context changes, correction and explicit retirement have separate reasons', () => {
  const e = new CodexForwardAccountEstimator(); e.observe(sample(0), proof(0), book);
  assert.equal(e.calibrationDiagnostics().reason, 'baseline-empty');
  e.breakContinuity(); assert.equal(e.calibrationDiagnostics().reason, 'baseline-retired');
  e.observe(sample(1), proof(1), book); assert.equal(e.calibrationDiagnostics().reason, 'baseline-retired');
  const invalid = new CodexForwardAccountEstimator();
  invalid.observe({ ...sample(0), requestedAt: T + 1 }, proof(0), book);
  assert.equal(invalid.calibrationDiagnostics().reason, 'invalid-sample');
  const epoch = new CodexForwardAccountEstimator(); epoch.observe(sample(0), proof(0), book);
  const changed = sample(1); changed.quotaEpoch = { startedAt: T + 1000, startLowerAt: T,
    resetAnchorAt: R, reason: 'counter-drop' };
  epoch.observe(changed, proof(1), book); assert.equal(epoch.calibrationDiagnostics().reason, 'epoch-change');
  const context = new CodexForwardAccountEstimator(); context.observe(sample(0), proof(0), book);
  context.observe({ ...sample(1), planType: 'pro' }, proof(1), book);
  assert.equal(context.calibrationDiagnostics().reason, 'context-change');
  const correction = new CodexForwardAccountEstimator(); correction.observe(sample(0), proof(0), book);
  correction.observe(sample(1, 19), proof(1, T + M - 500, 19), book);
  assert.equal(correction.calibrationDiagnostics().reason, 'counter-correction');
  const oldProof = new CodexForwardAccountEstimator(); oldProof.observe(sample(0), proof(0), book);
  oldProof.observe(sample(1), proof(1, T - 1), book);
  assert.equal(oldProof.calibrationDiagnostics().reason, 'proof-before-baseline');
  for (const estimator of [e, invalid, epoch, context, correction, oldProof]) statusShape(estimator);
});

test('missing/forged proof accessors confer no diagnostic authority and diagnostic snapshots are detached', () => {
  let gets = 0;
  const forged = Object.defineProperty({}, 'verifiedAt', { get() { gets++; throw new Error('PRIVATE-CANARY'); } });
  for (const bad of [undefined, forged, structuredClone(proof(0))]) {
    const e = new CodexForwardAccountEstimator(); e.observe(sample(0), bad, book);
    assert.equal(e.calibrationDiagnostics().reason, 'proof-missing');
    assert.equal(e.calibrationDiagnostics().proofAgeMs, undefined);
    const snapshot = e.calibrationDiagnostics(); snapshot.reason = 'proof-reused';
    assert.equal(e.calibrationDiagnostics().reason, 'proof-missing');
  }
  assert.equal(gets, 0);
});

test('facade diagnostics delegate only in forward mode and otherwise return a safe default', () => {
  const e = new CodexAccountEstimator();
  assert.deepEqual(e.calibrationDiagnostics(), { state: 'source-unavailable', deltaPercent: 0, intervals: 0, reason: 'not-forward-mode' });
  e.observe(sample(0), { usage: [], observations: [], calibrationPricebook: book, codexForwardCalibration: proof(0) }, 'v1');
  assert.equal(e.calibrationDiagnostics().reason, 'baseline-empty');
  e.breakContinuity(); assert.equal(e.calibrationDiagnostics().reason, 'baseline-retired'); statusShape(e);
  e.reset(); assert.equal(e.calibrationDiagnostics().reason, 'not-forward-mode');
});

test('exact unchanged metadata proof reuse reports a no-op without changing existing progress', () => {
  const e = new CodexForwardAccountEstimator(), first = proof(0);
  e.observe(sample(0), first, book);
  const status = e.calibrationStatus();
  const metadata = { ...sample(0), requestedAt: T + 900, observedAt: T + 1000 };
  assert.equal(e.observe(metadata, first, book), undefined);
  assert.equal(e.calibrationDiagnostics().reason, 'proof-reused-noop');
  assert.deepEqual(e.calibrationStatus(), status);
  assert.equal(e.calibrationDiagnostics().proofAgeMs, 1500);
  assert.equal(e.observe(sample(1), proof(1), book), undefined);
  assert.equal(e.calibrationStatus().state, 'first-step-discarded', 'the initial monetary baseline survived');
});

test('calibration formatter emits allowlisted enums and numeric fields only, without invoking accessors', () => {
  for (const reason of ['birth-unproven', 'slice-detail-missing', 'slice-order-invalid', 'usage-after-request']) {
    assert.match(formatCodexCalibrationDiagnostic({ state: 'append-incomplete', reason, deltaPercent: 0,
      intervals: 0, privateId: 'PRIVATE-CANARY' }), new RegExp(`reason=${reason} `));
  }
  assert.equal(formatCodexCalibrationDiagnostic({ state: 'continuity-gap', reason: 'proof-reused',
    deltaPercent: 2, intervals: 1, proofAgeMs: 500, bracketGapMs: 60000 }),
  'codex-calibration state=continuity-gap reason=proof-reused deltaPercent=2 intervals=1 proofAgeMs=500 bracketGapMs=60000');
  const forbidden = { toString() { throw new Error('PRIVATE-CANARY'); } };
  const unsafe = formatCodexCalibrationDiagnostic({ state: '/private/path', reason: 'raw-account-id',
    deltaPercent: forbidden, intervals: -1, proofAgeMs: Infinity, bracketGapMs: '60000', privateId: 'PRIVATE-CANARY' });
  assert.doesNotMatch(unsafe, /private|raw-account|PRIVATE-CANARY|Infinity/);
  assert.match(unsafe, /state=unknown reason=unknown deltaPercent=unknown intervals=unknown/);
  let calls = 0;
  const accessors = Object.create({ state: 'baseline', reason: 'baseline-empty' });
  for (const key of ['state', 'reason', 'deltaPercent', 'intervals', 'proofAgeMs', 'bracketGapMs']) {
    Object.defineProperty(accessors, key, { get() { calls++; throw new Error('PRIVATE-CANARY'); } });
  }
  assert.doesNotThrow(() => formatCodexCalibrationDiagnostic(accessors)); assert.equal(calls, 0);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [null, undefined, 'PRIVATE-CANARY', [], revoked.proxy,
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE-CANARY'); } })]) {
    assert.doesNotMatch(formatCodexCalibrationDiagnostic(value), /PRIVATE-CANARY/);
  }
});
