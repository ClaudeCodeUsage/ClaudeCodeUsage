import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildCodexWindowEstimates } from '../codexWindowEstimate';
import type { CodexQuotaCheckpoint } from '../providers/codex/codexQuotaCheckpoints';
import type { WeeklyValueInputs } from '../weeklyValue';
const T = Date.parse('2026-10-19T02:00Z'), M = 60_000, D = 86_400_000, R = T + 6 * D;
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] };
function point(t: number, p: number, usd: number, segment = 1, resetAt = R, baseline = false): CodexQuotaCheckpoint {
  return { sourceKey: 'a'.repeat(64), segment, from: T, through: t, resetAt, usedPercent: p, baseline,
    complete: true, byModel: { 'gpt-5': { inputTotal: usd * 1000, cachedInput: 0, outputTotal: 0, reasoningOutput: 0, sourceTotal: usd * 1000 } } };
}
function inputs(rows: CodexQuotaCheckpoint[]): WeeklyValueInputs {
  return { usage: [], observations: [], localHistoryComplete: true, calibrationPricebook: book,
    codexQuotaCheckpoints: rows, codexQuotaCheckpointsComplete: true };
}
const run = (rows: CodexQuotaCheckpoint[]) => buildCodexWindowEstimates(inputs(rows), { now: T + 4 * D });
test('A-B-A in one file retains both windows and prices only admitted increments, not the switch gap', () => {
  const rows = [point(T, 20, 0, 1, R, true), point(T + M, 50, 210),
    point(T + 2 * M, 5, 0, 2, R + D, true), point(T + 3 * M, 15, 30, 2, R + D),
    point(T + 4 * M, 53, 0, 3, R, true), point(T + 5 * M, 63, 70, 3)];
  const result = run(rows), a = result.find(x => x.resetAt === R)!;
  assert.equal(result.length, 2); assert.equal(a.fullEquivalentUsd, 700);
  assert.equal(a.windowEvidence?.deltaUsd, 280); assert.equal(a.windowEvidence?.deltaPercent, 40);
  assert.equal(a.windowEvidence?.intervals, 2); assert.equal(a.accountScopeKey, undefined);
});
test('a tiny post-reset sample is pending and cannot become a fourteen-dollar total', () => {
  const [entry] = run([point(T, 15, 0, 1, R, true), point(T + M, 16, 2.31)]);
  assert.equal(entry.fullEquivalentUsd, null); assert.equal(entry.unusedEquivalentUsd, null);
  assert.equal(entry.utilizationPercent, 16); assert.equal(entry.windowEvidence?.deltaUsd, 2.31);
});
test('a same-reset counter drop creates a separate short cycle and retains boundary uncertainty', () => {
  const result = run([point(T, 20, 0, 1, R, true), point(T + M, 50, 210),
    point(T + 2 * M, 2, 0, 2, R, true), point(T + 3 * M, 12, 50, 2)]);
  assert.equal(result.length, 2);
  assert.notEqual(result[0].windowEvidence?.cycle.id, result[1].windowEvidence?.cycle.id);
  assert.equal(result.find(x => x.observedAt === T + M)?.windowEvidence?.cycle.endAt, T + 2 * M);
});
test('time-overlapping contradictory quota witnesses with the same reset cannot be priced as one account', () => {
  const data = [point(T, 20, 0, 1, R, true), point(T + M, 50, 210),
    { ...point(T + M / 2, 80, 0, 1, R, true), sourceKey: 'b'.repeat(64) },
    { ...point(T + 2 * M, 85, 40), sourceKey: 'b'.repeat(64) }];
  assert.ok(run(data).every(x => x.fullEquivalentUsd === null));
});
test('incomplete checkpoint scopes cannot price capacity or turn missing amount into zero', () => {
  const data = inputs([point(T, 20, 0, 1, R, true), point(T + M, 50, 210)]);
  data.codexQuotaCheckpointsComplete = false;
  const [entry] = buildCodexWindowEstimates(data, { now: T + D });
  assert.equal(entry.fullEquivalentUsd, null); assert.equal(entry.windowEvidence?.complete, false);
});
test('receipt amounts retain exact pricebook and fixed fields without source identities', () => {
  const [entry] = run([point(T, 20, 0, 1, R, true), point(T + M, 50, 210)]);
  assert.deepEqual(entry.windowEvidence?.pricebook, book);
  assert.ok(!JSON.stringify(entry.windowEvidence).includes('a'.repeat(64)));
});
test('a concurrent source baseline is not silently omitted from a shared percentage denominator', () => {
  const rows = [point(T, 20, 0, 1, R, true),
    { ...point(T + M, 30, 0, 1, R, true), sourceKey: 'b'.repeat(64) },
    point(T + 2 * M, 40, 100), { ...point(T + 3 * M, 50, 100), sourceKey: 'b'.repeat(64) }];
  const [entry] = run(rows);
  assert.equal(entry.fullEquivalentUsd, null, 'unknown baseline request cost makes the numerator incomplete');
  assert.equal(entry.windowEvidence?.complete, false);
});
test('an admitted concurrent baseline request fills its own numeric numerator gap, but own initial tokens stay excluded', () => {
  const a = point(T, 20, 0, 1, R, true), b = { ...point(T + M, 30, 0, 1, R, true), sourceKey: 'b'.repeat(64),
    baselineByModel: point(T, 20, 100).byModel };
  const [entry] = run([{ ...a, baselineByModel: point(T, 20, 500).byModel }, b,
    point(T + 2 * M, 40, 100), { ...point(T + 3 * M, 50, 100), sourceKey: 'b'.repeat(64) }]);
  assert.equal(entry.windowEvidence?.deltaUsd, 300);
  assert.equal(entry.windowEvidence?.deltaPercent, 30);
  assert.equal(entry.fullEquivalentUsd, 1000);
});
test('overlapping reset brackets from concurrent sources describe one reset, not a phantom extra cycle', () => {
  const rows = [point(T, 20, 0, 1, R, true), point(T + M, 50, 210),
    { ...point(T + M / 2, 20, 0, 1, R, true), sourceKey: 'b'.repeat(64), baselineByModel: {} },
    { ...point(T + M * 1.5, 50, 210), sourceKey: 'b'.repeat(64) },
    point(T + 2 * M, 2, 0, 2, R, true),
    { ...point(T + 3 * M, 3, 0, 2, R, true), sourceKey: 'b'.repeat(64), baselineByModel: {} },
    point(T + 4 * M, 12, 50, 2), { ...point(T + 5 * M, 22, 50, 2), sourceKey: 'b'.repeat(64) }];
  const result = run(rows);
  assert.equal(result.length, 2);
  assert.equal(result[0].windowEvidence?.deltaUsd, 100, 'supplied post-reset request increments are not discarded by a phantom episode');
});
test('an old evidence gap does not poison fresh complete calibration intervals in the same quota window', () => {
  const data: any = inputs([point(T, 20, 0, 1, R, true), point(T + M, 50, 210),
    point(T + 4 * M, 53, 0, 2, R, true), point(T + 5 * M, 63, 70, 2)]);
  data.codexQuotaCheckpointsComplete = false;
  data.codexQuotaIncompleteRanges = [{ from: T + 2 * M, through: T + 3 * M, resetAt: R }];
  const [entry] = buildCodexWindowEstimates(data, { now: T + 10 * M });
  assert.equal(entry.fullEquivalentUsd, 700); assert.equal(entry.windowEvidence?.deltaPercent, 40);
});
test('an affected calibration component removes both its dollars and its percentage delta', () => {
  const data: any = inputs([point(T, 20, 0, 1, R, true), point(T + M, 50, 210),
    point(T + 4 * M, 53, 0, 2, R, true), point(T + 5 * M, 63, 70, 2)]);
  data.codexQuotaCheckpointsComplete = false;
  data.codexQuotaIncompleteRanges = [{ from: T + M / 4, through: T + 3 * M / 4, resetAt: R }];
  const [entry] = buildCodexWindowEstimates(data, { now: T + 10 * M });
  assert.equal(entry.fullEquivalentUsd, 700); assert.equal(entry.windowEvidence?.deltaPercent, 10);
  assert.equal(entry.windowEvidence?.deltaUsd, 70);
  assert.equal((entry.windowEvidence as any)?.skippedUsd, 210);
});
test('a gap inside overlapping sources rejects the entire shared calibration component', () => {
  const data: any = inputs([point(T, 20, 0, 1, R, true),
    { ...point(T, 20, 0, 1, R, true), sourceKey: 'b'.repeat(64), baselineByModel: {} },
    point(T + 2 * M, 40, 100), { ...point(T + 3 * M, 50, 100), sourceKey: 'b'.repeat(64) }]);
  data.codexQuotaIncompleteRanges = [{ from: T + M, through: T + 1.5 * M, resetAt: R }];
  const [entry] = buildCodexWindowEstimates(data, { now: T + 10 * M });
  assert.equal(entry.fullEquivalentUsd, null);
});
test('a minor counter correction breaks calibration compatibility without inventing a new reset cycle', () => {
  const result = run([point(T, 20, 0, 1, R, true), point(T + M, 50, 210),
    point(T + 2 * M, 49, 0, 2, R, true), point(T + 3 * M, 60, 33, 2)]);
  assert.equal(result.length, 1); assert.equal(result[0].fullEquivalentUsd, 700);
  assert.equal(result[0].observedAt, T + M, 'selected amount keeps the quota observation it was calibrated against');
});
test('a concurrent baseline outside the paired percentage span cannot inflate its numerator', () => {
  const result = run([point(T, 20, 0, 1, R, true), point(T + 2 * M, 40, 100),
    { ...point(T + 2 * M, 50, 0, 1, R, true), sourceKey: 'b'.repeat(64), baselineByModel: point(T, 20, 100).byModel }]);
  assert.equal(result[0].fullEquivalentUsd, null);
});
test('an unknown tail begins after the preceding completed checkpoint, not before it', () => {
  const data = inputs([point(T, 20, 0, 1, R, true), point(T + M, 50, 210)]);
  data.codexQuotaIncompleteRanges = [{ from: T + M, through: T + 2 * M }];
  assert.equal(buildCodexWindowEstimates(data, { now: T + 3 * M })[0].fullEquivalentUsd, 700);
});
test('the strongest compatible calibration chain may skip an intervening counter correction', () => {
  const result = run([point(T, 0, 0, 1, R, true), point(T + M, 10, 100),
    point(T + 2 * M, 9, 0, 2, R, true), point(T + 3 * M, 20, 11, 2),
    point(T + 4 * M, 10, 0, 3, R, true), point(T + 5 * M, 20, 100, 3)]);
  assert.equal(result.length, 1); assert.equal(result[0].fullEquivalentUsd, 1000);
  assert.equal(result[0].windowEvidence?.deltaPercent, 20);
});
