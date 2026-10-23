import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WeeklyEstimateArchive, WeeklyEstimateInput } from '../weeklyEstimateArchive';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { projectWeeklyEstimateChart } from '../weeklyEstimateChart';
import { codexCycleAmountEligible } from '../codexQuotaCycles';

const D = 86400000, NOW = Date.UTC(2026, 9, 23), RESET = Date.UTC(2026, 9, 15);
const options = { sourceNamespace: 'history-test', pricingVersion: 'api-equivalent-v2', now: NOW };
const empty = { usage: [], observations: [] };
const old = (extra: Partial<WeeklyEstimateInput> = {}): WeeklyEstimateInput => ({
  provider: 'codex', windowStart: RESET - 7 * D, resetAt: RESET,
  observedAt: RESET - 5 * D, estimatedAt: RESET - 4 * D,
  usedEquivalentUsd: 10, fullEquivalentUsd: 200, unusedEquivalentUsd: 80,
  utilizationPercent: 60, pricingCoverage: .8, method: 'series-prefix-v1',
  pricingVersion: 'api-equivalent-v1', unlinkedEquivalentUsd: 7,
  flags: ['account-unattributed', 'partial-pricing', 'partial-history', 'boundary-uncertain'], ...extra,
});
async function setup(t: { after(fn: () => Promise<void>): void }, values: WeeklyEstimateInput[]) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-history-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json');
  const archive = new WeeklyEstimateArchive(file, 'test-salt', options.sourceNamespace);
  for (const value of values) assert.equal((await archive.record(value)).outcome, 'recorded');
  const before = await readFile(file, 'utf8');
  const coordinator = new WeeklyEstimateCoordinator(file, 'test-salt');
  t.after(async () => coordinator.dispose());
  coordinator.project('codex', empty, options); await coordinator.flush();
  return { file, before, coordinator };
}

test('closed archived rough references keep frozen values and provenance without monetary admission or archive changes', async t => {
  const saved = old(), { file, before, coordinator } = await setup(t, [saved]);
  const [entry] = coordinator.project('codex', empty, options).entries;
  assert.equal(entry.fullEquivalentUsd, 200);
  assert.equal(entry.unusedEquivalentUsd, 80);
  assert.equal(entry.usedEquivalentUsd, 10);
  assert.equal(entry.pricingCoverage, .8);
  assert.deepEqual(new Set(entry.flags), new Set(saved.flags));
  assert.deepEqual((entry as any).historicalRoughEstimate,
    { source: 'weekly-estimates-v1', pricingVersion: 'api-equivalent-v1' });
  assert.equal(codexCycleAmountEligible(entry), false);
  assert.equal(entry.accountNumber, undefined);
  assert.equal(entry.quotaCycle?.referenceOnly, true);
  assert.equal(entry.calibrationEvidence, undefined);
  const [bar] = projectWeeklyEstimateChart('codex', [], [entry], { now: NOW });
  assert.equal(bar.fullEquivalentUsd, 200);
  assert.equal(bar.usedEquivalentUsd, 120); // Inferred F-R, never the partial sample's 10.
  assert.equal(bar.unusedEquivalentUsd, 80);
  assert.equal(bar.confidence, 'low'); assert.equal(bar.current, false);
  assert.deepEqual((bar as any).historicalRoughEstimate, (entry as any).historicalRoughEstimate);
  await coordinator.flush(); assert.equal(await readFile(file, 'utf8'), before);
});

test('historical restoration never admits current, account-bound, zero or incoherent archived amounts', async t => {
  const variants = [
    old({ windowStart: NOW - D, resetAt: NOW + 6 * D, observedAt: NOW - 1000, estimatedAt: NOW }),
    old({ accountScopeKey: 'a'.repeat(64), method: 'account-delta-v1' }),
    old({ fullEquivalentUsd: null, unusedEquivalentUsd: null }),
    old({ pricingCoverage: 0 }), old({ unusedEquivalentUsd: 150 }),
  ];
  for (const saved of variants) {
    const { coordinator } = await setup(t, [saved]);
    const [entry] = coordinator.project('codex', empty, options).entries;
    assert.equal(entry.fullEquivalentUsd, null);
    assert.equal((entry as any).historicalRoughEstimate, undefined);
  }
});

test('archive-only restoration does not promote an equivalent live partial estimate or persist a display marker', async t => {
  const { coordinator, file, before } = await setup(t, [old()]);
  const saved = old({ observedAt: RESET - 5 * D - 7 * D, resetAt: RESET - 7 * D, windowStart: RESET - 14 * D });
  const entries = coordinator.project('codex', empty, { ...options, accountEstimates: [{ ...saved, flags: [...saved.flags] }] }).entries;
  assert.equal(entries.find(e => e.resetAt === saved.resetAt)?.fullEquivalentUsd, null);
  await coordinator.flush(); assert.equal(await readFile(file, 'utf8'), before);
  const loaded = JSON.parse(before);
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.entries[0].historicalRoughEstimate, undefined);
});
