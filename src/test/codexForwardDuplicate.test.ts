import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexForwardAccountEstimator } from '../codexForwardAccountEstimate';
import type { OfficialQuotaSample } from '../codexAccountEstimate';
import { createEmptyCodexIndex } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { buildCodexForwardCalibration, CodexForwardCalibration } from '../providers/codex/codexForwardCalibration';

const T = Date.parse('2026-10-20T06:00Z'), M = 60_000, R = T + 604_799_000;
const K = '1'.repeat(64), A = 'a'.repeat(64), B = 'b'.repeat(64), S = 'c'.repeat(64);
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] };
interface Point { sample: OfficialQuotaSample; proof: CodexForwardCalibration }

/** Bounded primary-only fixtures mint actual branded producer proofs. No source
 * bodies, persistence, host applications or exported test hooks are involved. */
function point(n: number, percent: number, total: number): Point {
  const index = createEmptyCodexIndex('UTC'), at = T + (n + 1) * M - 1000;
  const counts = { inputTotal: total, cachedInput: 0, cacheWriteInput: 0,
    outputTotal: 0, reasoningOutput: 0, sourceTotal: total };
  index.files[K] = { fileKey: K, sourceArea: 'sessions', size: 100 * (n + 1), offset: 100 * (n + 1),
    mtimeMs: at, dev: 1, ino: 2, identityChecked: true, discardingOversizedLine: false, qualityFlags: [],
    parserState: { ...createCodexParserState(K), identityLocked: true, model: 'gpt-5' },
    lineage: { fingerprintBlocks: [], pendingFingerprints: Array.from({ length: n + 1 }, (_, i) => i.toString(16).padStart(32, '0')),
      tokenEvents: n + 1, desiredPrefixEvents: 0, appliedPrefixEvents: 0 },
    aggregate: { total: counts, byModel: { 'gpt-5': counts }, byDay: {}, byEffort: {},
      session: { sessionKey: K, role: 'root', startedAt: T - M, endedAt: at },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } },
    quotaHistory: [{ provider: 'codex', seriesKey: 'codex', observedAt: at, resetAt: R, usedPercent: percent }],
    ...(n ? { calibrationAppend: { beforeOffset: 100 * n, throughOffset: 100 * (n + 1),
      minUsageAt: at, maxUsageAt: at, complete: true } } : {}) };
  index.coverage.totalFiles = index.coverage.indexedFiles = 1;
  const proof = buildCodexForwardCalibration(index, true, new Set([K]), new Set(), at + 500)!;
  assert.ok(proof);
  return { proof, sample: { accountScopeKey: A, sourceScopeKey: S, usedPercent: percent, resetAt: R,
    requestedAt: at + 900, observedAt: at + 1000,
    quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } } };
}
const duplicate = (p: Point, delay = 10_000): OfficialQuotaSample => ({ ...p.sample,
  requestedAt: p.sample.requestedAt + delay, observedAt: p.sample.observedAt + delay });
const observe = (estimator: CodexForwardAccountEstimator, p: Point) => estimator.observe(p.sample, p.proof, book);

function harmlessRepeat(estimator: CodexForwardAccountEstimator, p: Point, delay = 10_000): void {
  const status = estimator.calibrationStatus();
  assert.equal(estimator.observe(duplicate(p, delay), p.proof, structuredClone(book)), undefined);
  assert.deepEqual(estimator.calibrationStatus(), status, 'a quota-only duplicate preserves monetary progress');
  assert.equal(estimator.calibrationDiagnostics().reason, 'proof-reused-noop');
}

test('control fits on the third paired sample and counts only post-alignment dollars', () => {
  const estimator = new CodexForwardAccountEstimator();
  assert.equal(observe(estimator, point(0, 20, 1000)), undefined);
  assert.equal(observe(estimator, point(1, 30, 3000)), undefined);
  assert.equal(estimator.calibrationStatus().state, 'first-step-discarded');
  const fit = observe(estimator, point(2, 40, 5000));
  assert.equal(fit?.fullEquivalentUsd, 20);
  assert.deepEqual(fit?.calibrationEvidence?.accumulated,
    { intervals: 1, deltaPercent: 10, deltaUsd: 2, pricedTokens: 2000, totalTokens: 2000 });
});

test('same-proof same-percent visibility reads between every paired sample preserve alignment and never recount USD', () => {
  const estimator = new CodexForwardAccountEstimator();
  const first = point(0, 20, 1000), aligned = point(1, 30, 3000), third = point(2, 40, 5000);
  assert.equal(observe(estimator, first), undefined); harmlessRepeat(estimator, first);
  assert.equal(observe(estimator, aligned), undefined);
  assert.equal(estimator.calibrationStatus().state, 'first-step-discarded');
  harmlessRepeat(estimator, aligned);
  const fit = observe(estimator, third);
  assert.equal(fit?.fullEquivalentUsd, 20);
  assert.equal(fit?.calibrationStart, aligned.sample.observedAt);
  assert.deepEqual(fit?.calibrationEvidence?.accumulated,
    { intervals: 1, deltaPercent: 10, deltaUsd: 2, pricedTokens: 2000, totalTokens: 2000 });
  harmlessRepeat(estimator, third);
  const next = point(3, 50, 8000), combined = observe(estimator, next);
  assert.equal(combined?.fullEquivalentUsd, 25);
  assert.equal(combined?.calibrationEvidence?.interval.deltaUsd, 3);
  assert.equal(combined?.calibrationEvidence?.interval.totalTokens, 3000);
  assert.deepEqual(combined?.calibrationEvidence?.accumulated,
    { intervals: 2, deltaPercent: 20, deltaUsd: 5, pricedTokens: 5000, totalTokens: 5000 });
  harmlessRepeat(estimator, next);
});

test('duplicates preserve pending flat-percentage dollars, tokens and the original interval start', () => {
  const estimator = new CodexForwardAccountEstimator();
  observe(estimator, point(0, 20, 1000));
  const aligned = point(1, 30, 3000); observe(estimator, aligned);
  const pending = point(2, 30, 3500);
  assert.equal(observe(estimator, pending), undefined);
  assert.equal(estimator.calibrationStatus().state, 'percentage-step');
  for (const delay of [10_000, 20_000, 30_000]) harmlessRepeat(estimator, pending, delay);
  const result = observe(estimator, point(3, 40, 5000));
  assert.equal(result?.fullEquivalentUsd, 20);
  assert.equal(result?.calibrationEvidence?.interval.from, aligned.sample.observedAt);
  assert.equal(result?.calibrationEvidence?.interval.deltaUsd, 2);
  assert.equal(result?.calibrationEvidence?.interval.totalTokens, 2000);
  assert.equal(result?.calibrationEvidence?.accumulated.intervals, 1);
});

test('changed context, unsafe samples and any proof other than the exact live baseline remain closed', async t => {
  const kinds = ['percent-up', 'correction', 'account', 'source', 'epoch', 'reset', 'book', 'plan',
    'spend-context', 'ordinary-context', 'blocked', 'untrusted', 'stale', 'out-of-order', 'slow',
    'future', 'older-proof', 'invalid-book', 'missing-epoch'] as const;
  for (const kind of kinds) {
    await t.test(kind, () => {
      const estimator = new CodexForwardAccountEstimator(), first = point(0, 20, 1000),
        aligned = point(1, 30, 3000), current = point(2, 40, 5000);
      observe(estimator, first); observe(estimator, aligned);
      assert.ok(observe(estimator, current));
      let s = duplicate(current), proof: unknown = current.proof, prices: unknown = structuredClone(book);
      if (kind === 'percent-up') s.usedPercent++;
      if (kind === 'correction') s.usedPercent--;
      if (kind === 'account') s.accountScopeKey = B;
      if (kind === 'source') s.sourceScopeKey = 'd'.repeat(64);
      if (kind === 'epoch') s.quotaEpoch = { ...s.quotaEpoch!, startedAt: T + 1 };
      if (kind === 'reset') s.resetAt += 1000; // Within epoch tolerance, but outside the exact duplicate context.
      if (kind === 'book') prices = { ...book, rates: [{ ...book.rates[0], input: .002 }] };
      if (kind === 'plan') s.planType = 'pro';
      if (kind === 'spend-context') s.spendControlReached = false;
      if (kind === 'ordinary-context') s.ordinaryUsageAllowed = true;
      if (kind === 'blocked') s.ordinaryUsageAllowed = false;
      if (kind === 'untrusted') proof = JSON.parse(JSON.stringify(proof));
      if (kind === 'stale') s = duplicate(current, 300_001);
      if (kind === 'out-of-order') s = { ...s, requestedAt: current.sample.observedAt, observedAt: current.sample.observedAt + 100 };
      if (kind === 'slow') s.requestedAt = s.observedAt - 30_001;
      if (kind === 'future') s = { ...s, requestedAt: current.proof.verifiedAt - 1, observedAt: current.proof.verifiedAt + 1 };
      if (kind === 'older-proof') proof = aligned.proof;
      if (kind === 'invalid-book') prices = { ...book, schemaVersion: 99 };
      if (kind === 'missing-epoch') s.quotaEpoch = undefined;
      assert.equal(estimator.observe(s, proof, prices), undefined, kind);
      assert.notEqual(estimator.calibrationDiagnostics().reason, 'proof-reused-noop', kind);
      assert.equal(observe(estimator, point(3, 50, 7000)), undefined, kind + ': fresh baseline required');
      assert.equal(estimator.calibrationStatus().state, 'baseline', kind);
      assert.equal(observe(estimator, point(4, 60, 9000)), undefined, kind + ': first new span discarded');
      const result = observe(estimator, point(5, 70, 11000));
      assert.deepEqual(result?.calibrationEvidence?.accumulated,
        { intervals: 1, deltaPercent: 10, deltaUsd: 2, pricedTokens: 2000, totalTokens: 2000 }, kind);
    });
  }
});

test('same-proof A-B-A visits never qualify as harmless reuse or bridge intervening account usage', () => {
  const estimator = new CodexForwardAccountEstimator();
  observe(estimator, point(0, 20, 1000)); observe(estimator, point(1, 30, 3000));
  const current = point(2, 40, 5000); assert.ok(observe(estimator, current));
  assert.equal(estimator.observe({ ...duplicate(current), accountScopeKey: B }, current.proof, book), undefined);
  assert.notEqual(estimator.calibrationDiagnostics().reason, 'proof-reused-noop');
  assert.equal(estimator.observe(duplicate(current, 20_000), current.proof, book), undefined);
  assert.notEqual(estimator.calibrationDiagnostics().reason, 'proof-reused-noop');
  assert.equal(observe(estimator, point(3, 50, 25000)), undefined);
  assert.equal(observe(estimator, point(4, 60, 27000)), undefined);
  const result = observe(estimator, point(5, 70, 29000));
  assert.equal(result?.fullEquivalentUsd, 20);
  assert.equal(result?.usedEquivalentUsd, 2);
  assert.equal(result?.calibrationEvidence?.accumulated.deltaPercent, 10);
  assert.equal(result?.calibrationEvidence?.accumulated.intervals, 1);
});
