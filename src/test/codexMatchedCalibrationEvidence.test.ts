import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { copyCodexCalibrationEvidence, codexCalibrationEvidenceFitsEstimate } from '../codexCalibrationEvidence';
import { WeeklyEstimateArchive, WeeklyEstimateInput, weeklyEstimateAccountFingerprint } from '../weeklyEstimateArchive';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';

const T = Date.parse('2026-10-19T02:00Z'), M = 60_000, R = T + 6 * 86_400_000;
const A = 'a'.repeat(64), B = 'b'.repeat(64);
function receipt() {
  return { schemaVersion: 1, methodVersion: 2, collectionMode: 'forward-matched-cut-v1',
    pricebook: { schemaVersion: 1, parserVersion: 4, periodVersion: 1,
      rates: [{ model: 'gpt-5', input: .00000125, cachedInput: .000000125, output: .00001 }] },
    interval: { from: T, through: T + 10 * M, requestedFrom: T - 100, requestedThrough: T + 10 * M - 100,
      percentFrom: 36, percentThrough: 40, deltaUsd: 20, pricedTokens: 200, totalTokens: 200,
      linkedSources: 1, excludedSources: 0, continuityGap: false },
    matchedCut: { from: T + M, through: T + 9 * M, percentFrom: 37, percentThrough: 39 },
    accumulated: { intervals: 1, deltaPercent: 2, deltaUsd: 20, pricedTokens: 200, totalTokens: 200 } };
}
function legacyReceipt() {
  const { matchedCut: _cut, ...value } = receipt();
  return { ...value, methodVersion: 1, collectionMode: 'forward-append-v1',
    accumulated: { ...value.accumulated, deltaPercent: 4 } };
}
function estimate(): WeeklyEstimateInput {
  const calibrationEvidence = copyCodexCalibrationEvidence(receipt());
  assert.ok(calibrationEvidence);
  return { provider: 'codex', method: 'account-delta-v1', pricingVersion: 'api-v1', accountScopeKey: A,
    windowStart: T, resetAt: R, observedAt: T + 10 * M, estimatedAt: T + 10 * M,
    calibrationStart: T + M, quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
    usedEquivalentUsd: 20, fullEquivalentUsd: 1000, unusedEquivalentUsd: 600,
    utilizationPercent: 40, pricingCoverage: 1, flags: [], calibrationEvidence };
}

test('v1 keeps legacy envelope math, absent mode/exclusions, partial pricing and continuity semantics', () => {
  const value = legacyReceipt();
  const copied = copyCodexCalibrationEvidence(value);
  assert.deepEqual(copied, value);
  const { collectionMode: _mode, ...historical } = value;
  const { excludedSources: _excluded, ...interval } = historical.interval;
  assert.deepEqual(copyCodexCalibrationEvidence({ ...historical, interval }), historical);
  const partial = copyCodexCalibrationEvidence({ ...value,
    interval: { ...value.interval, excludedSources: 2, continuityGap: true, pricedTokens: 100 },
    accumulated: { ...value.accumulated, pricedTokens: 100 } });
  assert.ok(partial);
  const fit = { observedAt: value.interval.through, utilizationPercent: 40, usedEquivalentUsd: 20,
    fullEquivalentUsd: 500, unusedEquivalentUsd: 300, pricingCoverage: .5,
    calibrationStart: T, quotaEpoch: { startedAt: T, resetAnchorAt: R } };
  assert.equal(codexCalibrationEvidenceFitsEstimate(partial, fit), true);
  assert.equal(codexCalibrationEvidenceFitsEstimate(partial, { ...fit, calibrationStart: T + 1 }), false);
  assert.equal(copyCodexCalibrationEvidence({ ...value, collectionMode: 'forward-matched-cut-v1' }), undefined);
});

test('v2 admits the matched 2pp numerator within a real 4pp official envelope without a total five-minute cap', () => {
  assert.deepEqual(copyCodexCalibrationEvidence(receipt()), receipt());
  const value = receipt();
  assert.deepEqual(copyCodexCalibrationEvidence({ ...value, matchedCut: { ...value.matchedCut,
    through: value.interval.requestedThrough } })?.interval, value.interval);
  assert.ok(copyCodexCalibrationEvidence({ ...value, matchedCut: { ...value.matchedCut,
    percentFrom: 36, percentThrough: 40 }, accumulated: { ...value.accumulated, deltaPercent: 4 } }));
});

test('method versions require their own collection mode and reject future unknown versions', () => {
  const value = receipt();
  const { collectionMode: _mode, ...noMode } = value;
  const { matchedCut: _cut, ...noCut } = value;
  for (const bad of [noMode, noCut, { ...value, matchedCut: null }, { ...value, matchedCut: [] },
    { ...value, collectionMode: 'forward-append-v1' }, { ...value, collectionMode: 'future-mode' },
    { ...value, methodVersion: 3 }, { ...value, methodVersion: '2' }, { ...value, schemaVersion: 2 }]) {
    assert.equal(copyCodexCalibrationEvidence(bad), undefined);
  }
  // A method-one reader must never accept the new mode as method one.
  const legacy = copyCodexCalibrationEvidence({ ...legacyReceipt(), matchedCut: value.matchedCut });
  assert.deepEqual(legacy, legacyReceipt(), 'method one keeps its existing unknown-field stripping');
});

test('v2 rejects invalid cut times and percentages, preserving strict containment and at least 1pp rise', () => {
  const value = receipt(), cut = value.matchedCut;
  for (const patch of [{ from: T }, { from: T - 1 }, { from: cut.through }, { through: cut.from },
    { through: value.interval.requestedThrough + 1 }, { from: NaN }, { through: Infinity },
    { from: cut.from + .5 }, { through: 'later' }, { percentFrom: -1 }, { percentFrom: 35 },
    { percentThrough: 41 }, { percentThrough: 100 }, { percentFrom: NaN }, { percentThrough: Infinity },
    { percentFrom: '37' }, { percentThrough: 37 }, { percentThrough: 37.999 }]) {
    assert.equal(copyCodexCalibrationEvidence({ ...value, matchedCut: { ...cut, ...patch } }), undefined,
      JSON.stringify(patch));
  }
  for (const key of ['from', 'through', 'percentFrom', 'percentThrough'] as const) {
    const missing: Record<string, unknown> = { ...cut }; delete missing[key];
    assert.equal(copyCodexCalibrationEvidence({ ...value, matchedCut: missing }), undefined);
  }
  assert.ok(copyCodexCalibrationEvidence({ ...value, matchedCut: { ...cut, percentThrough: 38 },
    accumulated: { ...value.accumulated, deltaPercent: 1 } }));
});

test('both versions retain individual 30-second RPC limits and real official endpoint validation', () => {
  for (const value of [legacyReceipt(), receipt()]) {
    assert.ok(copyCodexCalibrationEvidence({ ...value, interval: { ...value.interval,
      requestedFrom: value.interval.from - 30_000, requestedThrough: value.interval.through - 30_000 } }));
    for (const patch of [{ requestedFrom: T - 30_001 }, { requestedFrom: T + 1 },
      { requestedThrough: value.interval.through - 30_001 }, { requestedThrough: value.interval.through + 1 },
      { requestedThrough: T }, { percentThrough: 100 }, { percentFrom: 41 }, { through: T }]) {
      assert.equal(copyCodexCalibrationEvidence({ ...value, interval: { ...value.interval, ...patch } }), undefined);
    }
  }
});

test('v2 requires complete all-source continuity and pricing for the interval and accumulated totals', () => {
  const value = receipt();
  for (const interval of [{ ...value.interval, continuityGap: true }, { ...value.interval, excludedSources: 1 },
    { ...value.interval, pricedTokens: 199 }, { ...value.interval, linkedSources: 0 }]) {
    assert.equal(copyCodexCalibrationEvidence({ ...value, interval }), undefined);
  }
  // Accumulation cannot hide a partially priced earlier interval.
  assert.equal(copyCodexCalibrationEvidence({ ...value, accumulated: { intervals: 2,
    deltaPercent: 3, deltaUsd: 30, pricedTokens: 299, totalTokens: 300 } }), undefined);
  assert.ok(copyCodexCalibrationEvidence({ ...value, accumulated: { intervals: 2,
    deltaPercent: 3, deltaUsd: 30, pricedTokens: 300, totalTokens: 300 } }));
});

test('v2 validates single-interval equality and cumulative lower bounds against cut delta, never envelope delta', () => {
  const value = receipt();
  for (const patch of [{ deltaPercent: 4 }, { deltaPercent: 1 }, { deltaUsd: 21 },
    { pricedTokens: 201, totalTokens: 201 }, { deltaPercent: NaN }]) {
    assert.equal(copyCodexCalibrationEvidence({ ...value, accumulated: { ...value.accumulated, ...patch } }), undefined);
  }
  assert.equal(copyCodexCalibrationEvidence({ ...value, accumulated: { ...value.accumulated,
    intervals: 2, deltaPercent: 1.5 } }), undefined);
  assert.ok(copyCodexCalibrationEvidence({ ...value, accumulated: { ...value.accumulated,
    intervals: 2, deltaPercent: 3, deltaUsd: 30, pricedTokens: 300, totalTokens: 300 } }));
});

test('v2 estimate fit uses cut USD/2pp while as-of, utilization and unused capacity use official 40 percent', () => {
  const fit = estimate(), evidence = fit.calibrationEvidence!;
  assert.equal(codexCalibrationEvidenceFitsEstimate(evidence, fit), true);
  for (const patch of [{ observedAt: receipt().matchedCut.through }, { utilizationPercent: 39 },
    { fullEquivalentUsd: 500, unusedEquivalentUsd: 300 }, { unusedEquivalentUsd: 610 },
    { usedEquivalentUsd: 400 }, { pricingCoverage: .9 }, { calibrationStart: T + M + 1 },
    { calibrationStart: T - 1 }, { calibrationStart: undefined }, { quotaEpoch: undefined },
    { quotaEpoch: { ...fit.quotaEpoch!, resetAnchorAt: fit.observedAt } }]) {
    assert.equal(codexCalibrationEvidenceFitsEstimate(evidence, { ...fit, ...patch }), false, JSON.stringify(patch));
  }
  assert.equal(codexCalibrationEvidenceFitsEstimate(evidence, { ...fit, calibrationStart: T }), true);
  assert.equal(codexCalibrationEvidenceFitsEstimate(evidence, { ...fit,
    calibrationStart: T + M, quotaEpoch: { ...fit.quotaEpoch!, startedAt: T + M } }), true);
});

test('v2 fixed-field reconstruction strips raw IDs, text and runtime lifecycle/proof state at every level', () => {
  const value = receipt(), canary = 'raw-private-canary';
  const copied = copyCodexCalibrationEvidence({ ...value, rawAccountId: canary, proof: { id: canary }, lifecycle: canary,
    pricebook: { ...value.pricebook, token: canary, rates: value.pricebook.rates.map(rate => ({ ...rate, path: canary })) },
    interval: { ...value.interval, sourceKey: canary, sessionId: canary },
    matchedCut: { ...value.matchedCut, rawId: canary, text: canary, proof: canary },
    accumulated: { ...value.accumulated, lifecycle: canary } });
  assert.deepEqual(copied, value);
  assert.ok(copied); assert.ok(!JSON.stringify(copied).includes(canary));
  value.matchedCut.percentThrough = 38; value.interval.percentThrough = 41;
  value.accumulated.deltaUsd = 99; value.pricebook.rates[0].input = .5;
  assert.deepEqual(copied, receipt(), 'the validated snapshot must not alias caller-owned nested objects');
});

test('schema-one account-delta archive roundtrip and coordinator retain both receipt versions at official as-of 40%', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-matched-receipt-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json'), archive = new WeeklyEstimateArchive(file, 'salt', 'source');
  const cumulative = receipt();
  cumulative.interval.from = T + 6 * M; cumulative.interval.requestedFrom = T + 6 * M - 100;
  cumulative.matchedCut.from = T + 7 * M;
  cumulative.accumulated = { intervals: 2, deltaPercent: 5, deltaUsd: 50, pricedTokens: 500, totalTokens: 500 };
  const entry = { ...estimate(), usedEquivalentUsd: 50, calibrationEvidence: copyCodexCalibrationEvidence(cumulative)! };
  assert.equal((await archive.record(entry)).outcome, 'recorded');
  const legacy = copyCodexCalibrationEvidence(legacyReceipt()); assert.ok(legacy);
  assert.equal((await archive.record({ ...entry, accountScopeKey: B, calibrationStart: T, usedEquivalentUsd: 20,
    fullEquivalentUsd: 500, unusedEquivalentUsd: 300, calibrationEvidence: legacy })).outcome, 'recorded');
  const loaded = await archive.load(); assert.equal(loaded.status, 'ready'); assert.equal(loaded.entries.length, 2);
  assert.deepEqual(loaded.entries.find(row => row.accountScopeKey === A)?.calibrationEvidence, cumulative);
  const disk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(disk.schemaVersion, 1); assert.ok(disk.entries.every((row: WeeklyEstimateInput) => row.method === 'account-delta-v1'));
  for (const patch of [{ fullEquivalentUsd: 500, unusedEquivalentUsd: 300 }, { utilizationPercent: 39 },
    { unusedEquivalentUsd: 610 }, { observedAt: receipt().matchedCut.through }]) {
    assert.equal((await archive.record({ ...entry, ...patch })).outcome, 'invalid');
  }
  const coordinator = new WeeklyEstimateCoordinator(file, 'salt'); t.after(() => coordinator.dispose());
  const options = { sourceNamespace: 'source', pricingVersion: 'api-v1', now: T + 11 * M, activeAccountScopeKey: A };
  coordinator.project('codex', { observations: [], usage: [] }, options); await coordinator.flush();
  const view = coordinator.project('codex', { observations: [], usage: [] }, options);
  const projected = view.entries.find(row => Number(row.calibrationEvidence?.methodVersion) === 2);
  assert.ok(projected); assert.equal(projected.observedAt, entry.observedAt); assert.equal(projected.utilizationPercent, 40);
  assert.equal(projected.fullEquivalentUsd, 1000); assert.equal(projected.unusedEquivalentUsd, 600);
  assert.deepEqual(projected.calibrationEvidence, cumulative); assert.ok(!JSON.stringify(view).includes(A));
});

test('archive refuses unknown receipt versions on record and load without rewriting the existing document', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-matched-future-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json'), archive = new WeeklyEstimateArchive(file, 'salt', 'source');
  const entry = estimate(); await archive.record(entry);
  const original = await readFile(file, 'utf8');
  const future = { ...entry, calibrationEvidence: { ...receipt(), methodVersion: 3 } };
  assert.equal((await archive.record(future as unknown as WeeklyEstimateInput)).outcome, 'invalid');
  assert.equal(await readFile(file, 'utf8'), original);
  const disk = JSON.parse(original); disk.entries[0].calibrationEvidence.methodVersion = 3;
  await writeFile(file, JSON.stringify(disk));
  assert.equal((await archive.load()).status, 'invalid');
  assert.equal((await archive.record(entry)).outcome, 'invalid');
  assert.equal(await readFile(file, 'utf8'), JSON.stringify(disk));
});

test('account clear fences use calibrationStart, admitting fresh cuts after an older official left sample', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-matched-clear-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json'), archive = new WeeklyEstimateArchive(file, 'salt', 'source');
  const entry = estimate(); await archive.record({ ...entry, accountScopeKey: B });
  const fence = T + M / 2, clock = Date.now;
  try { Date.now = () => fence; await archive.clear({ provider: 'codex', accountFingerprint: weeklyEstimateAccountFingerprint('salt', 'codex', A) }); }
  finally { Date.now = clock; }
  // The official envelope crosses the fence, but this calibration's first matched cut is fresh.
  assert.equal((await archive.record(entry)).outcome, 'recorded');
  const stale = { ...entry, flags: [...entry.flags], calibrationStart: fence };
  assert.equal((await archive.record(stale)).outcome, 'cleared-observation');
  const coordinator = new WeeklyEstimateCoordinator(file, 'salt'); t.after(() => coordinator.dispose());
  const options = { sourceNamespace: 'source', pricingVersion: 'api-v1', now: T + 11 * M, accountEstimates: [stale] };
  coordinator.project('codex', { observations: [], usage: [] }, options); await coordinator.flush();
  const view = coordinator.project('codex', { observations: [], usage: [] }, options);
  assert.equal(view.entries.length, 2);
  assert.ok(view.entries.every(row => row.calibrationStart! > fence));
  assert.equal(coordinator.calibrationCutoff('codex', 'source', A), fence);
  assert.equal((await archive.load()).entries.length, 2, 'other-account data survives the selected-account fence');
  // An older writer retaining pre-clear accumulation must also be refused on read.
  const disk = JSON.parse(await readFile(file, 'utf8'));
  disk.entries.find((row: WeeklyEstimateInput) => row.accountScopeKey === A).calibrationStart = fence;
  await writeFile(file, JSON.stringify(disk));
  const loaded = await archive.load(); assert.equal(loaded.status, 'invalid'); assert.equal(loaded.entries.length, 0);
});
