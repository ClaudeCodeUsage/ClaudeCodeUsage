import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCodexWindowEstimates } from '../codexWindowEstimate';
import { codexCalibrationPricingVersion } from '../codexWindowEvidence';
import { WeeklyEstimateArchive } from '../weeklyEstimateArchive';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { codexQuotaCaptureFromOfficialSample, createEmptyQuotaObservationStore, mergeQuotaCaptures } from '../quotaObservationStore';
const T = Date.now() - 600_000, R = T + 6 * 86_400_000, A = 'a'.repeat(64);
const book = { schemaVersion: 1 as const, parserVersion: 5, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .001, cachedInput: 0, output: .002 }] };
function estimate() {
  const [entry] = buildCodexWindowEstimates({ usage: [], observations: [], calibrationPricebook: book,
    codexQuotaCheckpointsComplete: true, codexQuotaCheckpoints: [
      { sourceKey: 'source-private-canary', segment: 1, from: T, through: T, resetAt: R, usedPercent: 20, baseline: true, byModel: {}, complete: true },
      { sourceKey: 'source-private-canary', segment: 1, from: T, through: T + 60_000, resetAt: R, usedPercent: 50,
        baseline: false, byModel: { 'gpt-5': { inputTotal: 210000, outputTotal: 0 } }, complete: true },
    ] }, { now: T + 60_000, windowKey: () => A });
  return { ...entry, pricingVersion: 'openai-v1' };
}
test('paired evidence survives leased archive reload and never persists raw source keys', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-window-archive-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json'), archive = new WeeklyEstimateArchive(file, 'salt', 'source');
  const entry = estimate(); assert.equal((await archive.record(entry)).outcome, 'recorded');
  const [loaded] = (await archive.load()).entries; assert.deepEqual(loaded.windowEvidence, entry.windowEvidence);
  assert.ok(!(await readFile(file, 'utf8')).includes('source-private-canary'));
  const c = new WeeklyEstimateCoordinator(file, 'salt'); t.after(() => c.dispose());
  c.project('codex', { usage: [], observations: [] }, { sourceNamespace: 'source', pricingVersion: 'openai-v1', now: T + 120000 });
  await c.flush();
  const view = c.project('codex', { usage: [], observations: [] }, { sourceNamespace: 'source', pricingVersion: 'openai-v1', now: T + 120000 });
  assert.ok(!JSON.stringify(view).includes(A)); assert.equal(view.entries[0].fullEquivalentUsd, 700);
});
test('a clear fence also retires the beginning of a paired local-window calibration', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-window-clear-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const archive = new WeeklyEstimateArchive(path.join(root, 'weekly-estimates-v1.json'), 'salt', 'source');
  const e = estimate(); await archive.record(e); const cleared = await archive.clear({ provider: 'codex' });
  const newer = cleared.clearedThrough.codex! + 1000;
  const stale = { ...e, observedAt: newer, estimatedAt: newer, windowEvidence: { ...e.windowEvidence!, through: newer } };
  assert.equal((await archive.record(stale)).outcome, 'cleared-observation');
});
test('official identity checkpoints reserve a cycle and stable ordinal without any monetary fit', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-pending-cycle-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const salt = 'salt', capture = codexQuotaCaptureFromOfficialSample({ accountScopeKey: A, observedAt: T, resetAt: R, usedPercent: 2 })!;
  const p2 = mergeQuotaCaptures(createEmptyQuotaObservationStore(), [capture], { salt, now: T + 1 });
  const c = new WeeklyEstimateCoordinator(path.join(root, 'weekly-estimates-v1.json'), salt); t.after(() => c.dispose());
  const options = { sourceNamespace: 'source', pricingVersion: 'openai-v1', now: T + 1,
    quotaObservations: p2.observations, activeAccountScopeKey: A, activeQuotaEpochStartedAt: T };
  let view = c.project('codex', { usage: [], observations: [] }, options); await c.flush();
  view = c.project('codex', { usage: [], observations: [] }, options);
  assert.equal(view.entries.length, 1); assert.equal(view.entries[0].fullEquivalentUsd, null);
  assert.equal(view.activeAccountNumber, 1); assert.equal(view.entries[0].accountNumber, 1);
  assert.ok(!JSON.stringify(view).includes(A));
});
test('pricing revision follows actual normalized rates, not fetch metadata', () => {
  const first = codexCalibrationPricingVersion(book);
  assert.equal(codexCalibrationPricingVersion({ ...book, fetchedAt: Date.now() }), first);
  assert.notEqual(codexCalibrationPricingVersion({ ...book, rates: [{ ...book.rates[0], input: .002 }] }), first);
});
