import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexAccountEstimator, OfficialQuotaSample } from '../codexAccountEstimate';
import { createEmptyCodexIndex, CodexIndexV1 } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { buildCodexForwardCalibration } from '../providers/codex/codexForwardCalibration';
import type { WeeklyValueInputs } from '../weeklyValue';

const T = Date.parse('2026-10-20T06:00Z'), M = 60_000, R = T + 604_800_000 - 1000;
const K = '1'.repeat(64), A = 'a'.repeat(64), B = 'b'.repeat(64), S = 'c'.repeat(64);
const fixtureIndexes = new WeakMap<object, CodexIndexV1>();
const sample = (n: number, p: number, account = A): OfficialQuotaSample => ({ accountScopeKey: account,
  sourceScopeKey: S, observedAt: T + (n + 1) * M, requestedAt: T + (n + 1) * M - 100, usedPercent: p, resetAt: R,
  quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } });
function inputs(n: number, p: number, total: number, patch: Record<string, unknown> = {},
  previousProof?: WeeklyValueInputs['codexForwardCalibration']): WeeklyValueInputs {
  n += 1;
  const index = createEmptyCodexIndex('UTC');
  const tokens = { inputTotal: total, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 };
  const usageAt = T + n * M - 1000;
  index.files[K] = { fileKey: K, size: 100 * (n + 1), offset: 100 * (n + 1), mtimeMs: usageAt,
    dev: 1, ino: 2, identityChecked: true, discardingOversizedLine: false, qualityFlags: [],
    parserState: { ...createCodexParserState(K), identityLocked: true, model: 'gpt-5' },
    lineage: { fingerprintBlocks: [], pendingFingerprints: Array.from({ length: n + 1 }, (_, i) => i.toString(16).padStart(32, '0')),
      tokenEvents: n + 1, desiredPrefixEvents: 0, appliedPrefixEvents: 0 },
    aggregate: { total: tokens, byModel: { 'gpt-5': tokens }, byDay: {}, byEffort: {},
      session: { sessionKey: K, role: 'root', startedAt: T - M, endedAt: usageAt },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } },
    quotaHistory: [{ provider: 'codex', seriesKey: 'codex', observedAt: usageAt, resetAt: R, usedPercent: p }],
    ...(n ? { calibrationAppend: { beforeOffset: 100 * n, throughOffset: 100 * (n + 1),
      minUsageAt: usageAt, maxUsageAt: usageAt, complete: true } } : {}),
    ...patch,
  };
  index.coverage.totalFiles = index.coverage.indexedFiles = 1;
  index.coverage.period.allTime.complete = false;
  const proof = buildCodexForwardCalibration(index, true, new Set([K]), new Set(), T + n * M - 500, {}, previousProof);
  if (proof) fixtureIndexes.set(proof, index);
  return { usage: [], observations: [], localHistoryComplete: false,
    codexForwardCalibration: proof,
    calibrationPricebook: { schemaVersion: 1, parserVersion: 4, periodVersion: 1,
      rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] } };
}
function createEstimator(): CodexAccountEstimator {
  const estimator = new CodexAccountEstimator();
  estimator.observe(sample(-1, 10), inputs(-1, 10, 0), 'api-v1');
  return estimator;
}
test('forward progress distinguishes a baseline, discarded first step, paired fit and unsafe append', () => {
  const estimator = new CodexAccountEstimator();
  estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
  assert.equal((estimator as any).calibrationStatus().state, 'baseline');
  estimator.observe(sample(1, 22), inputs(1, 22, 3000), 'api-v1');
  assert.equal((estimator as any).calibrationStatus().state, 'first-step-discarded');
  estimator.observe(sample(2, 24), inputs(2, 24, 5000), 'api-v1');
  assert.deepEqual((estimator as any).calibrationStatus(), { state: 'accumulating', deltaPercent: 2, intervals: 1 });
  estimator.observe(sample(3, 30), inputs(3, 30, 7000, { calibrationAppend: undefined }), 'api-v1');
  assert.equal((estimator as any).calibrationStatus().state, 'append-incomplete');
  const publicStatus = (estimator as any).calibrationStatus();
  publicStatus.deltaPercent = 99;
  assert.notEqual((estimator as any).calibrationStatus().deltaPercent, 99);
  assert.doesNotMatch(JSON.stringify(publicStatus), /account|source|key|fingerprint/i);
});
test('forward progress names mismatched endpoints and unpriced changed usage without exposing model or source IDs', () => {
  const mismatched = createEstimator();
  mismatched.observe(sample(0, 20), inputs(0, 19, 1000), 'api-v1');
  assert.equal((mismatched as any).calibrationStatus().state, 'endpoint-mismatch');
  const unpriced = createEstimator(), next = inputs(0, 20, 1000);
  next.calibrationPricebook!.rates = [];
  // Changing a pricebook is itself a new baseline. Its next append establishes
  // that positive usage lacks a price, rather than pretending it costs zero.
  unpriced.observe(sample(0, 20), next, 'api-v1');
  const after = inputs(1, 30, 3000); after.calibrationPricebook!.rates = [];
  unpriced.observe(sample(1, 30), after, 'api-v1');
  assert.equal((unpriced as any).calibrationStatus().state, 'unpriced-usage');
});
test('an arbitrary initial percentage cannot calibrate capacity until the first observed step establishes a fresh start', () => {
  const estimator = new CodexAccountEstimator();
  estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
  assert.equal(estimator.observe(sample(1, 30), inputs(1, 30, 3000), 'api-v1'), undefined);
  const result = estimator.observe(sample(2, 40), inputs(2, 40, 5000), 'api-v1')!;
  assert.equal(result?.fullEquivalentUsd, 20);
  assert.equal(result?.calibrationStart, T + 2 * M);
});
test('floored integer percentages do not fit an arbitrary partial first bin in a constant-rate simulation', () => {
  for (const phase of [.05, .25, .55, .85, .95]) {
    const estimator = new CodexAccountEstimator();
    estimator.observe(sample(0, 20), inputs(0, 20, 0), 'api-v1');
    let firstIncrease = true, fitted = 0;
    for (let n = 1; n <= 20; n++) {
      const percent = Math.floor(20 + phase + n * .2 + 1e-9);
      const result = estimator.observe(sample(n, percent), inputs(n, percent, n * 2000), 'api-v1');
      if (percent > 20 && firstIncrease) { assert.equal(result, undefined); firstIncrease = false; }
      if (result) { assert.ok(Math.abs(result.fullEquivalentUsd! - 1000) < 1e-8); fitted++; }
    }
    assert.ok(fitted > 0);
  }
});
test('forward official capacity needs no historical periods and archives its incremental evidence', () => {
  const estimator = createEstimator();
  assert.equal(estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1'), undefined);
  const result = estimator.observe(sample(1, 30), inputs(1, 30, 3000), 'api-v1')!;
  assert.equal(result?.fullEquivalentUsd, 20);
  assert.equal(result.usedEquivalentUsd, 2);
  assert.equal(result.unusedEquivalentUsd, 14);
  assert.equal(result.calibrationEvidence?.accumulated.deltaPercent, 10);
  assert.equal(result.calibrationEvidence?.collectionMode, 'forward-append-v1');
  assert.ok(result.flags.includes('account-unattributed'));
});
test('unchanged official percentages accumulate exact append dollars until a measurable increment', () => {
  const estimator = createEstimator();
  estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
  assert.equal(estimator.observe(sample(1, 20), inputs(1, 20, 2000), 'api-v1'), undefined);
  const result = estimator.observe(sample(2, 30), inputs(2, 30, 4000), 'api-v1')!;
  assert.equal(result?.fullEquivalentUsd, 30);
  assert.equal(result?.calibrationEvidence?.interval.from, T + M);
});
test('A-B-A never bridges the missing account interval but retains earlier admitted evidence', () => {
  const estimator = createEstimator();
  estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
  estimator.observe(sample(1, 30), inputs(1, 30, 3000), 'api-v1');
  assert.equal(estimator.observe(sample(2, 40, B), inputs(2, 40, 10000), 'api-v1'), undefined);
  assert.equal(estimator.observe(sample(3, 40), inputs(3, 40, 20000), 'api-v1'), undefined);
  assert.equal(estimator.observe(sample(4, 50), inputs(4, 50, 22000), 'api-v1'), undefined);
  const result = estimator.observe(sample(5, 60), inputs(5, 60, 24000), 'api-v1')!;
  assert.equal(result?.fullEquivalentUsd, 20);
  assert.equal(result?.calibrationEvidence?.accumulated.deltaUsd, 4);
});
test('unknown, pre-baseline, in-flight, rewritten and mismatched-source increments withhold the entire fit', () => {
  for (const kind of ['missing', 'early', 'in-flight', 'incomplete', 'rewritten', 'foreign'] as const) {
    const estimator = createEstimator();
    estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
    const append = { beforeOffset: 200, throughOffset: 300, minUsageAt: T + 2 * M - 1000,
      maxUsageAt: T + 2 * M - 1000, complete: true };
    const patch: Record<string, unknown> = { calibrationAppend: append };
    if (kind === 'missing') patch.calibrationAppend = undefined;
    if (kind === 'early') append.minUsageAt = T - 1;
    if (kind === 'in-flight') append.maxUsageAt = T + 2 * M;
    if (kind === 'incomplete') append.complete = false;
    if (kind === 'rewritten') patch.ino = 99;
    if (kind === 'foreign') patch.quotaHistory = [{ provider: 'codex', seriesKey: 'codex', observedAt: T + M - 1000,
      resetAt: R + M * 10, usedPercent: 30 }];
    assert.equal(estimator.observe(sample(1, 30), inputs(1, 30, 3000, patch), 'api-v1'), undefined, kind);
  }
});
test('restart, clearing, price changes and serialization never restore a monetary baseline', () => {
  const estimator = createEstimator();
  const initial = inputs(0, 20, 1000);
  estimator.observe(sample(0, 20), initial, 'api-v1');
  const next = inputs(1, 30, 3000);
  next.codexForwardCalibration = JSON.parse(JSON.stringify(next.codexForwardCalibration));
  assert.equal(estimator.observe(sample(1, 30), next, 'api-v1'), undefined);
  assert.equal(estimator.observe(sample(2, 40), inputs(2, 40, 5000), 'api-v1'), undefined);
  estimator.reset();
  assert.equal(estimator.observe(sample(3, 50), inputs(3, 50, 7000), 'api-v1'), undefined);
});
test('same-cycle downward correction starts a new calibration cohort instead of counting percentage points twice', () => {
  const estimator = createEstimator();
  estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
  estimator.observe(sample(1, 40), inputs(1, 40, 3000), 'api-v1');
  assert.equal(estimator.observe(sample(2, 39), inputs(2, 39, 4000), 'api-v1'), undefined);
  assert.equal(estimator.observe(sample(3, 49), inputs(3, 49, 7000), 'api-v1'), undefined);
  const result = estimator.observe(sample(4, 59), inputs(4, 59, 10000), 'api-v1')!;
  assert.equal(result?.fullEquivalentUsd, 30);
  assert.equal(result?.calibrationEvidence?.accumulated.deltaPercent, 10);
});
test('a downward correction after blur retires the last admitted cohort even without a live baseline', () => {
  const estimator = createEstimator();
  estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
  estimator.observe(sample(1, 40), inputs(1, 40, 3000), 'api-v1');
  estimator.breakContinuity();
  assert.equal(estimator.observe(sample(2, 39), inputs(2, 39, 4000), 'api-v1'), undefined);
  assert.equal(estimator.observe(sample(3, 49), inputs(3, 49, 7000), 'api-v1'), undefined);
  const result = estimator.observe(sample(4, 59), inputs(4, 59, 10000), 'api-v1')!;
  assert.equal(result?.fullEquivalentUsd, 30);
  assert.equal(result?.calibrationEvidence?.accumulated.deltaPercent, 10);
});
test('watcher appends and a normalized warm publication preserve the exact official bracket chain', () => {
  const estimator = createEstimator(), baseline = inputs(0, 20, 1000);
  estimator.observe(sample(0, 20), baseline, 'api-v1');
  const watch1 = inputs(1, 30, 2000, {}, baseline.codexForwardCalibration);
  const watch2 = inputs(2, 40, 3000, {}, watch1.codexForwardCalibration);
  const warm = inputs(2, 40, 3000, { calibrationAppend: undefined }, watch2.codexForwardCalibration);
  const result = estimator.observe(sample(2, 40), warm, 'api-v1')!;
  assert.equal(result?.fullEquivalentUsd, 10);
  assert.equal(result?.calibrationEvidence?.interval.deltaUsd, 2);
  assert.equal(result?.calibrationEvidence?.interval.from, T + M);
});
test('official growth without a matching local endpoint cannot use a partial local numerator', () => {
  const estimator = createEstimator();
  estimator.observe(sample(0, 20), inputs(0, 20, 1000), 'api-v1');
  assert.equal(estimator.observe(sample(1, 30), inputs(1, 29, 3000), 'api-v1'), undefined);
});
test('a fresh quiet verification preserves alignment without inventing a newer local usage event', () => {
  const estimator = createEstimator(), baseline = inputs(0, 20, 1000);
  estimator.observe(sample(0, 20), baseline, 'api-v1');
  const old = baseline.codexForwardCalibration!, index = fixtureIndexes.get(old)!;
  const quiet = { ...baseline, codexForwardCalibration: buildCodexForwardCalibration(index, true, new Set([K]), new Set(),
    T + 2 * M - 500, {}, old) };
  assert.equal(estimator.observe(sample(1, 20), quiet, 'api-v1'), undefined);
  const next = inputs(2, 30, 3000, { calibrationAppend: { beforeOffset: 200, throughOffset: 400,
    minUsageAt: T + 3 * M - 1000, maxUsageAt: T + 3 * M - 1000, complete: true } }, quiet.codexForwardCalibration);
  assert.equal(estimator.observe(sample(2, 30), next, 'api-v1')?.fullEquivalentUsd, 20);
});
