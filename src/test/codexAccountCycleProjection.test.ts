import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { WeeklyEstimateArchive } from '../weeklyEstimateArchive';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';

const T = Date.parse('2026-10-19T02:00Z'), W = 604_800_000, R = T + W - 1000, A = 'a'.repeat(64), B = 'b'.repeat(64);
function entry(full: number, account?: string, at = T): LocalWeeklyEstimate {
  const resetAt = at + W - 1000;
  return { provider: 'codex', windowStart: at, resetAt, observedAt: at + 60_000, estimatedAt: at + 60_000,
    utilizationPercent: 40, usedEquivalentUsd: full * .4, fullEquivalentUsd: full, unusedEquivalentUsd: full * .6,
    pricingCoverage: 1, method: account ? 'account-delta-v1' : 'rough-prefix-v2', flags: ['account-unattributed'],
    ...(account ? { accountScopeKey: account, quotaEpoch: { startedAt: at, resetAnchorAt: resetAt,
      startLowerAt: null, reason: 'initial' as const } } : {}) };
}
test('identified account cycles take the comparison surface without relabelling overlapping anonymous estimates', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-account-cycle-projection-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json'), salt = 'synthetic-account-cycle-projection';
  const sourceNamespace = 'synthetic-source', coordinator = new WeeklyEstimateCoordinator(file, salt);
  const anonymous = entry(150), past = entry(50, undefined, T - 2 * W);
  const options = { sourceNamespace, now: T + 120_000, pricingVersion: 'api-v1', activeAccountScopeKey: A,
    accountEstimates: [entry(100, A), entry(200, B), anonymous, past] };
  const frozen = JSON.stringify(options.accountEstimates);
  coordinator.project('codex', { usage: [], observations: [] }, options); await coordinator.flush();
  const projection = coordinator.project('codex', { usage: [], observations: [] }, options);
  assert.equal(projection.entries.length, 3);
  assert.equal((projection as any).unassignedCyclesOmitted, 1);
  assert.deepEqual(projection.entries.filter(row => row.accountNumber !== undefined).map(row => row.fullEquivalentUsd).sort(), [100, 200]);
  assert.equal(projection.entries.find(row => row.accountNumber === undefined)?.fullEquivalentUsd, 50);
  assert.equal(JSON.stringify(options.accountEstimates), frozen);
  const archived = await new WeeklyEstimateArchive(file, salt, sourceNamespace).load();
  assert.ok(archived.entries.some(row => row.accountScopeKey === undefined && row.fullEquivalentUsd === 150));
  const reloaded = new WeeklyEstimateCoordinator(file, salt);
  const reloadOptions = { ...options, accountEstimates: [] };
  reloaded.project('codex', { usage: [], observations: [] }, reloadOptions); await reloaded.flush();
  const again = reloaded.project('codex', { usage: [], observations: [] }, reloadOptions);
  assert.equal(again.entries.length, 3); assert.equal((again as any).unassignedCyclesOmitted, 1);
});
test('an identified but pending cycle does not borrow an overlapping anonymous capacity', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-pending-cycle-projection-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const coordinator = new WeeklyEstimateCoordinator(path.join(root, 'weekly-estimates-v1.json'), 'synthetic');
  const pending = { ...entry(100, A), fullEquivalentUsd: null, unusedEquivalentUsd: null, usedEquivalentUsd: 0 };
  const options = { sourceNamespace: 'synthetic', pricingVersion: 'api-v1', now: T + 120_000,
    accountEstimates: [pending, entry(150)], activeAccountScopeKey: A };
  const result = coordinator.project('codex', { usage: [], observations: [] }, options);
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].fullEquivalentUsd, null);
  assert.equal(result.entries[0].resetAt, R);
  await coordinator.flush();
});
