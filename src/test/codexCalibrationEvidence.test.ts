import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexAccountEstimator, OfficialQuotaSample } from '../codexAccountEstimate';
import { WeeklyEstimateArchive } from '../weeklyEstimateArchive';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import type { WeeklyValueInputs } from '../weeklyValue';
import { captureCodexCalibrationPricebook, copyCodexCalibrationEvidence } from '../codexCalibrationEvidence';

const T = Date.parse('2026-10-19T02:00Z'), R = T + 6 * 86_400_000, M = 60_000;
const A = 'a'.repeat(64), B = 'b'.repeat(64), S = 'c'.repeat(64);
const pricebook = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .00000125, cachedInput: .000000125, output: .00001 }] };
function sample(t: number, p: number, accountScopeKey = A, startedAt = T): OfficialQuotaSample {
  return { accountScopeKey, sourceScopeKey: S, requestedAt: t - 100, observedAt: t, resetAt: R,
    usedPercent: p, quotaEpoch: { startedAt, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } };
}
function inputs(t: number, p: number, usd: number): WeeklyValueInputs {
  return { localHistoryComplete: true, calibrationPricebook: pricebook,
    usage: [{ sourceKey: 'synthetic-source-canary', timestamp: t - 1, intervalStart: T - M,
      intervalEnd: t - 1, equivalentUsd: usd, pricedTokens: usd * 10, totalTokens: usd * 10 }],
    observations: [{ provider: 'codex', seriesKey: 'codex', sourceKey: 'synthetic-source-canary',
      observedAt: t - 1, usedPercent: p, resetAt: R }] } as WeeklyValueInputs;
}
function evidence(value: unknown): any { return (value as any)?.calibrationEvidence; }
test('rate capture uses exact materialized model rates and numeric semantics, never prices unknown models', () => {
  const book = captureCodexCalibrationPricebook(['gpt-5', 'gpt-5', 'unknown-private-canary']);
  assert.ok(book); assert.equal(book.parserVersion, 4); assert.equal(book.periodVersion, 1);
  assert.equal(book.rates.length, 1); assert.equal(book.rates[0].model, 'gpt-5');
  assert.ok(!JSON.stringify(book).includes('unknown-private-canary'));
});
test('account calibration retains a frozen numeric receipt and actual rate snapshot for each admitted interval', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  const first = e.observe(sample(T + M, 30), inputs(T + M, 30, 120), 'api-v1')!;
  const receipt = evidence(first);
  assert.ok(receipt, 'a monetary calibration must retain its measurement evidence');
  assert.deepEqual(receipt.interval, { from: T, through: T + M, requestedFrom: T - 100,
    requestedThrough: T + M - 100, percentFrom: 20, percentThrough: 30, deltaUsd: 20,
    pricedTokens: 200, totalTokens: 200, linkedSources: 1, excludedSources: 0, continuityGap: false });
  assert.deepEqual(receipt.accumulated, { intervals: 1, deltaPercent: 10, deltaUsd: 20,
    pricedTokens: 200, totalTokens: 200 });
  assert.deepEqual(receipt.pricebook, pricebook);
  const saved = JSON.stringify(receipt);
  const next = e.observe(sample(T + 2 * M, 40), inputs(T + 2 * M, 40, 150), 'api-v1')!;
  assert.equal(evidence(next).accumulated.deltaUsd, 50);
  assert.equal(evidence(next).accumulated.deltaPercent, 20);
  assert.equal(evidence(next).accumulated.intervals, 2);
  assert.equal(JSON.stringify(receipt), saved);
  assert.ok(!saved.includes('synthetic-source-canary'));
  const copy = copyCodexCalibrationEvidence({ ...receipt, privateCanary: 'must-not-persist',
    interval: { ...receipt.interval, sourceKey: 'must-not-persist' },
    pricebook: { ...receipt.pricebook, access_token: 'must-not-persist' } });
  assert.ok(copy); assert.ok(!JSON.stringify(copy).includes('must-not-persist'));
  const { excludedSources: _excluded, ...olderInterval } = receipt.interval;
  assert.equal(copyCodexCalibrationEvidence({ ...receipt, interval: olderInterval })?.interval.excludedSources, 0);
});
test('A-B-A and same-reset drops retain isolated admitted evidence, never the transition gap', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  e.observe(sample(T + M, 30), inputs(T + M, 30, 120), 'api-v1');
  assert.equal(e.observe(sample(T + 2 * M, 40, B), inputs(T + 2 * M, 40, 500), 'api-v1'), undefined);
  assert.equal(e.observe(sample(T + 3 * M, 35), inputs(T + 3 * M, 35, 800), 'api-v1'), undefined);
  const returned = e.observe(sample(T + 4 * M, 40), inputs(T + 4 * M, 40, 810), 'api-v1')!;
  assert.equal(evidence(returned).interval.deltaUsd, 10);
  assert.equal(evidence(returned).accumulated.deltaUsd, 30);
  assert.equal(evidence(returned).accumulated.deltaPercent, 15);
  assert.equal(e.observe(sample(T + 5 * M, 5, A, T + 5 * M), inputs(T + 5 * M, 5, 900), 'api-v1'), undefined);
  const reset = e.observe(sample(T + 6 * M, 15, A, T + 5 * M), inputs(T + 6 * M, 15, 920), 'api-v1')!;
  assert.equal(evidence(reset).accumulated.deltaUsd, 20);
  assert.equal(evidence(reset).accumulated.intervals, 1);
});
test('changed actual rates break the calibration baseline even with the same public pricing label', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  const changed = { ...inputs(T + M, 30, 150), calibrationPricebook: {
    ...pricebook, rates: [{ ...pricebook.rates[0], input: .000002 }] } };
  assert.equal(e.observe(sample(T + M, 30), changed, 'api-v1'), undefined);
});
test('same-source late historical additions cannot masquerade as a new calibration increment', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  const late = inputs(T + M, 30, 120);
  late.usage.push({ ...late.usage[0], timestamp: T - 2 * M, intervalStart: T - 3 * M,
    intervalEnd: T - 2 * M, equivalentUsd: 900, pricedTokens: 9000, totalTokens: 9000 });
  assert.equal(e.observe(sample(T + M, 30), late, 'api-v1'), undefined);
});
test('verified calibration scope excludes ambiguous sources without dropping unrelated current increments', () => {
  const e = new CodexAccountEstimator();
  const scoped = (t: number, p: number, usd: number) => ({ ...inputs(t, p, usd),
    calibrationSourceScope: { verified: true, excludedSourceKeys: ['ambiguous-canary'] },
    usage: [...inputs(t, p, usd).usage, { sourceKey: 'ambiguous-canary', timestamp: t - 1,
      intervalStart: T - M, intervalEnd: t - 1, equivalentUsd: usd * 10, pricedTokens: usd * 100, totalTokens: usd * 100 }],
    observations: [...inputs(t, p, usd).observations, { provider: 'codex' as const, seriesKey: 'codex',
      sourceKey: 'ambiguous-canary', observedAt: t - 1, resetAt: R, usedPercent: p }] });
  e.observe(sample(T, 20), scoped(T, 20, 100), 'api-v1');
  const x = e.observe(sample(T + M, 30), scoped(T + M, 30, 120), 'api-v1')!;
  assert.equal(x.fullEquivalentUsd, 200);
  assert.equal(evidence(x).interval.excludedSources, 1);
  assert.ok(x.flags.includes('partial-history'));
  assert.ok(!JSON.stringify(evidence(x)).includes('ambiguous-canary'));
});
test('a durable clear retires only the affected account calibration before a fresh baseline', () => {
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  e.observe(sample(T + M, 30), inputs(T + M, 30, 120), 'api-v1');
  (e as any).invalidateThrough(A, T + M + 1000);
  assert.equal(e.observe(sample(T + 2 * M, 40), inputs(T + 2 * M, 40, 150), 'api-v1'), undefined);
  const next = e.observe(sample(T + 3 * M, 50), inputs(T + 3 * M, 50, 160), 'api-v1')!;
  assert.equal(evidence(next).accumulated.deltaUsd, 10);
  assert.equal(evidence(next).accumulated.intervals, 1);
});
test('source eligibility S-T-S never restores a withdrawn calibration run', () => {
  const e = new CodexAccountEstimator();
  const scoped = (t: number, p: number, usd: number, exclude = false) => ({ ...inputs(t, p, usd),
    calibrationSourceScope: { verified: true, excludedSourceKeys: exclude ? ['synthetic-source-canary'] : [] } });
  e.observe(sample(T, 20), scoped(T, 20, 100), 'api-v1');
  e.observe(sample(T + M, 30), scoped(T + M, 30, 120), 'api-v1');
  assert.equal(e.observe(sample(T + 2 * M, 35), scoped(T + 2 * M, 35, 500, true), 'api-v1'), undefined);
  assert.equal(e.observe(sample(T + 3 * M, 40), scoped(T + 3 * M, 40, 800), 'api-v1'), undefined);
  const next = e.observe(sample(T + 4 * M, 45), scoped(T + 4 * M, 45, 810), 'api-v1')!;
  assert.equal(evidence(next).accumulated.deltaUsd, 10);
  assert.equal(evidence(next).accumulated.intervals, 1);
});
test('archive load refuses a stale cumulative receipt just like record rather than presenting it as valid', async t => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-calibration-read-clear-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'weekly-estimates-v1.json');
  const archive = new WeeklyEstimateArchive(file, 'salt', 'source');
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  const x = e.observe(sample(T + M, 30), inputs(T + M, 30, 120), 'api-v1')!;
  await archive.record({ ...x, pricingVersion: 'api-v1' });
  const doc = JSON.parse(await readFile(file, 'utf8'));
  doc.clearFences = [{ provider: 'codex', observedThrough: T + 1 }];
  // Emulate an older preview writer which checked only the later observedAt.
  await writeFile(file, JSON.stringify(doc));
  const loaded = await archive.load();
  assert.equal(loaded.status, 'invalid'); assert.equal(loaded.entries.length, 0);
});
test('newer observations cannot rearchive pre-clear accumulated calibration evidence', async t => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-calibration-clear-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = new WeeklyEstimateArchive(path.join(dir, 'weekly-estimates-v1.json'), 'salt', 'source');
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  const first = e.observe(sample(T + M, 30), inputs(T + M, 30, 120), 'api-v1')!;
  await archive.record({ ...first, pricingVersion: 'api-v1' });
  const clock = Date.now;
  try { Date.now = () => T + M + 1000; await archive.clear({ provider: 'codex' }); }
  finally { Date.now = clock; }
  const stale = e.observe(sample(T + 2 * M, 40), inputs(T + 2 * M, 40, 150), 'api-v1')!;
  assert.equal((await archive.record({ ...stale, pricingVersion: 'api-v1' })).outcome, 'cleared-observation');
});
test('receipts survive archive/coordinator reload, reject inconsistent math, and follow account clear fences', async t => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-calibration-evidence-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'weekly-estimates-v1.json');
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'api-v1');
  const result = e.observe(sample(T + M, 30), inputs(T + M, 30, 120), 'api-v1')!;
  const archive = new WeeklyEstimateArchive(file, 'synthetic-salt', 'synthetic-home');
  assert.equal((await archive.record({ ...result, pricingVersion: 'api-v1' })).outcome, 'recorded');
  const loaded = (await archive.load()).entries[0];
  assert.ok(evidence(loaded));
  assert.deepEqual(evidence(loaded), evidence(result));
  const invalid = { ...loaded, calibrationEvidence: { ...evidence(loaded),
    accumulated: { ...evidence(loaded).accumulated, deltaUsd: 999 } } };
  assert.equal((await archive.record(invalid)).outcome, 'invalid');
  const coordinator = new WeeklyEstimateCoordinator(file, 'synthetic-salt');
  coordinator.project('codex', { observations: [], usage: [] }, {
    sourceNamespace: 'synthetic-home', pricingVersion: 'api-v1', now: T + 2 * M });
  await coordinator.flush();
  const projected = coordinator.project('codex', { observations: [], usage: [] }, {
    sourceNamespace: 'synthetic-home', pricingVersion: 'api-v1', now: T + 2 * M });
  assert.ok(evidence(projected.entries[0]));
  assert.ok(!JSON.stringify(projected).includes(A));
  coordinator.dispose();
  await archive.clear({ provider: 'codex' });
  assert.equal((await archive.load()).entries.length, 0);
  assert.equal((await archive.record({ ...result, pricingVersion: 'api-v1' })).outcome, 'cleared-observation');
});
