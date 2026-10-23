import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { withCodexQuotaCycles, selectCodexCycleEstimates } from '../codexQuotaCycles';
import { projectWeeklyEstimateChart } from '../weeklyEstimateChart';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
import type { QuotaObservationV2 } from '../quotaObservationStore';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { weeklyEstimateAccountFingerprint } from '../weeklyEstimateArchive';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const D = 86_400_000, T = Date.parse('2026-10-10T02:00Z'), R = T + 7 * D;
const A = 'a'.repeat(64), B = 'b'.repeat(64), FA = 'acct_' + 'a'.repeat(32), FB = 'acct_' + 'b'.repeat(32);
function estimate(start: number, observedAt: number, resetAt: number, key = A, lower: number | null = null): LocalWeeklyEstimate {
  return { provider: 'codex', accountScopeKey: key, accountNumber: key === A ? 1 : 2,
    windowStart: resetAt - 7 * D, resetAt, observedAt, estimatedAt: observedAt,
    usedEquivalentUsd: 20, fullEquivalentUsd: 200, unusedEquivalentUsd: 120, utilizationPercent: 40,
    pricingCoverage: 1, method: 'account-delta-v1', calibrationStart: start,
    quotaEpoch: { startedAt: start, resetAnchorAt: resetAt, startLowerAt: lower,
      reason: lower === null ? 'initial' : 'counter-drop' }, flags: ['account-unattributed'] };
}
function row(at: number, reset: number, window: number, key = FA, used = .4): QuotaObservationV2 {
  return { schemaVersion: 2, provider: 'codex', source: 'codex-official-api', periodType: 'seven-day',
    accountFingerprint: key, accountAttribution: 'verified-local-signal', observedAt: at, resetAt: reset,
    usedFraction: used, remainingFraction: 1 - used, windowId: 'win_' + String(window).repeat(32),
    providerWindowFingerprint: null, confidence: 'high', captureReason: window === 1 ? 'refresh' : 'usage-drop', flags: [] };
}
const fp = (key: string) => key === A ? FA : key === B ? FB : undefined;
test('early reset closes the previous cycle at the observed boundary, not its old seven-day deadline', () => {
  const entries = [estimate(T, T + D, R), estimate(T + 2 * D, T + 3 * D, R + 2 * D, A, T + D)];
  const observations = [row(T, R, 1), row(T + D, R, 1, FA, .8), row(T + 2 * D, R + 2 * D, 2, FA, .1),
    row(T + 3 * D, R + 2 * D, 2)];
  const before = JSON.stringify(entries);
  const projected = withCodexQuotaCycles(entries, observations, fp);
  assert.equal(projected[0].quotaCycle?.endAt, T + 2 * D);
  assert.equal(projected[0].quotaCycle?.endLowerAt, T + D);
  assert.equal(projected[0].quotaCycle?.closed, true);
  assert.equal(projected[1].quotaCycle?.startAt, T + 2 * D);
  assert.equal(projected[1].quotaCycle?.startLowerAt, T + D);
  assert.equal(projected[0].quotaCycle?.scheduledResetAt, R);
  assert.equal(JSON.stringify(entries), before);
  assert.equal(projected[0].fullEquivalentUsd, 200, 'cycle projection does not rewrite frozen money');
});
test('two resets 18 hours apart form an 18-hour cycle; sampling and A-B-A do not add columns', () => {
  const second = T + D, third = second + 18 * D / 24;
  const entries = [estimate(T, T + D / 2, R), estimate(second, second + D / 4, R + D, A, second - 1000),
    estimate(second, second + D / 2, R + D, A, second - 1000),
    estimate(T, T + D / 3, R, B), estimate(third, third + D / 4, third + 7 * D, A, third - 1000)];
  const projected = withCodexQuotaCycles(entries, [], fp);
  const selected = selectCodexCycleEstimates(projected);
  assert.equal(selected.length, 4);
  const short = selected.find(entry => entry.accountScopeKey === A && entry.quotaCycle?.id === second)!;
  assert.equal(short.quotaCycle!.endAt - short.quotaCycle!.startAt!, 18 * D / 24);
  assert.equal(short.observedAt, second + D / 2);
  assert.equal(projectWeeklyEstimateChart('codex', [], projected, { now: third + D / 2 }).length, 4);
});
test('a reset checkpoint closes a historical cycle even before the next cycle has a monetary estimate', () => {
  const observations = [row(T, R, 1), row(T + D, R, 1, FA, .9), row(T + 2 * D, R, 2, FA, .05)];
  const [old] = withCodexQuotaCycles([estimate(T, T + D, R)], observations, fp);
  assert.equal(old.quotaCycle?.closed, true); assert.equal(old.quotaCycle?.endAt, T + 2 * D);
  assert.equal(projectWeeklyEstimateChart('codex', [], [old], { now: T + 2 * D,
    accountIdentityAvailable: true, activeAccountNumber: 1, activeQuotaEpochStartedAt: T })[0].current, false);
});
test('missing historical start stays unknown and never becomes reset minus seven days', () => {
  const [entry] = withCodexQuotaCycles([estimate(T, T + D, R)], [], fp);
  assert.equal(entry.quotaCycle?.startAt, null);
  assert.equal(entry.quotaCycle?.startLowerAt, null);
  assert.equal(entry.quotaCycle?.endAt, R);
  assert.equal(entry.quotaCycle?.boundaryUncertain, true);
});
test('a later initial observation without reset evidence does not manufacture another same-reset cycle', () => {
  const old = estimate(T, T + D, R), resumed = estimate(T + 2 * D, T + 3 * D, R);
  const projected = withCodexQuotaCycles([old, resumed], [], fp);
  assert.equal(selectCodexCycleEstimates(projected).length, 1);
  assert.equal(selectCodexCycleEstimates(projected)[0].observedAt, T + 3 * D);
  assert.equal(projected[0].quotaCycle?.closed, true, 'the fixture deadline has expired, not reset again at resumed observation');
  assert.equal(projected[0].quotaCycle?.endAt, R);
});
test('P2 prefix compaction cannot invent a reset or duplicate one cycle across price revisions', () => {
  const old = estimate(T, T + D, R), later = estimate(T, T + 3 * D, R);
  const observations = [row(T + 2 * D, R, 1), row(T + 3 * D, R, 1, FA, .6)];
  for (const entries of [[old], [old, later]]) {
    const projected = withCodexQuotaCycles(entries, observations, fp, T + 4 * D);
    assert.equal(selectCodexCycleEstimates(projected).length, 1);
    assert.ok(projected.every(entry => entry.quotaCycle?.endAt === R));
    assert.ok(projected.every(entry => entry.quotaCycle?.closed === false));
  }
});
test('an epoch-less keyed legacy estimate joins the official window containing its observation, not another same-reset episode', () => {
  const legacy = estimate(T, T + D, R); delete legacy.quotaEpoch; delete legacy.calibrationStart;
  const current = estimate(T, T + 3 * D, R);
  const observations = [row(T, R, 1), row(T + D, R, 1), row(T + 3 * D, R, 1, FA, .6)];
  const projected = withCodexQuotaCycles([legacy, current], observations, fp, T + 4 * D);
  assert.equal(selectCodexCycleEstimates(projected).length, 1);
  assert.equal(projected[0].quotaCycle?.id, T);
  assert.equal(projected[0].quotaCycle?.referenceOnly, undefined);
});
test('explicit P2 reset evidence overrides a stale archived initial label at the same first-observed time', () => {
  const old = estimate(T, T + D, R), next = estimate(T + 2 * D, T + 3 * D, R);
  const observations = [row(T, R, 1), row(T + D, R, 1, FA, .9),
    row(T + 2 * D, R, 2, FA, .05), row(T + 3 * D, R, 2)];
  const projected = withCodexQuotaCycles([old, next], observations, fp, T + 4 * D);
  assert.equal(projected[0].quotaCycle?.endAt, T + 2 * D);
  assert.equal(selectCodexCycleEstimates(projected).length, 2);
});
test('chart never merges two official reset cycles just because both old estimates lack epoch metadata', () => {
  const old = estimate(T, T + D, R), next = estimate(T + 2 * D, T + 3 * D, R);
  delete old.quotaEpoch; delete next.quotaEpoch; delete old.calibrationStart; delete next.calibrationStart;
  const observations = [row(T, R, 1), row(T + D, R, 1, FA, .9),
    row(T + 2 * D, R, 2, FA, .05), row(T + 3 * D, R, 2)];
  const projected = withCodexQuotaCycles([old, next], observations, fp, T + 4 * D);
  assert.equal(selectCodexCycleEstimates(projected).length, 2);
  assert.equal(projectWeeklyEstimateChart('codex', [], projected, { now: T + 4 * D }).length, 2);
});
test('scheduled rollover preserves the known previous deadline as the next boundary without daily buckets', () => {
  const observations = [row(T, R, 1), row(R - 1000, R, 1, FA, .9),
    { ...row(R + 1000, R + 7 * D, 2, FA, .1), captureReason: 'reset-at-change' as const }];
  const next = estimate(R + 1000, R + D, R + 7 * D, A, R);
  next.quotaEpoch!.reason = 'scheduled-reset';
  const projected = withCodexQuotaCycles([estimate(T, T + D, R), next], observations, fp);
  assert.equal(projected[0].quotaCycle?.endAt, R);
  assert.equal(projected[1].quotaCycle?.startAt, R);
  assert.equal(selectCodexCycleEstimates(projected).length, 2);
});
test('coordinator refreshes boundaries on P2-only changes without rewriting archived monetary snapshots or exporting identity', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-reset-cycles-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json'), salt = 'synthetic-salt';
  const coordinator = new WeeklyEstimateCoordinator(file, salt);
  t.after(() => coordinator.dispose());
  const data = { observations: [], usage: [] }, x = estimate(T, T + D, R);
  const fingerprint = weeklyEstimateAccountFingerprint(salt, 'codex', A)!;
  const options = { sourceNamespace: 'synthetic-home', pricingVersion: 'api-v1', now: T + 3 * D,
    accountEstimates: [x], quotaObservations: [row(T, R, 1, fingerprint), row(T + D, R, 1, fingerprint)] };
  coordinator.project('codex', data, options); await coordinator.flush();
  const before = await readFile(file, 'utf8');
  const initial = coordinator.project('codex', data, options);
  assert.equal(initial.entries[0].quotaCycle?.endAt, R);
  const next = coordinator.project('codex', data, { ...options, quotaObservations: [...options.quotaObservations,
    row(T + 2 * D, R, 2, fingerprint, .05)] });
  const oldCycle = next.entries.find(entry => entry.fullEquivalentUsd === 200)!;
  assert.ok(oldCycle);
  assert.equal(oldCycle.quotaCycle?.endAt, T + 2 * D);
  assert.equal(oldCycle.fullEquivalentUsd, 200);
  const pending = next.entries.find(entry => entry.quotaEpoch?.startedAt === T + 2 * D)!;
  assert.ok(pending, 'P2-only reset checkpoints retain a visible pending cycle');
  assert.equal(pending.fullEquivalentUsd, null);
  assert.equal(pending.unusedEquivalentUsd, null);
  assert.equal(pending.quotaCycle?.startAt, T + 2 * D);
  await coordinator.flush();
  const after = await readFile(file, 'utf8');
  const snapshots = (body: string) => JSON.parse(body).entries.filter((entry: LocalWeeklyEstimate) => entry.fullEquivalentUsd !== null);
  // New nonmonetary checkpoints may append archive bytes. The frozen monetary
  // snapshot itself must retain both its serialized bytes and numeric values.
  assert.deepEqual(snapshots(after), snapshots(before));
  for (const snapshot of snapshots(before)) assert.ok(after.includes(JSON.stringify(snapshot)));
  const savedPending = JSON.parse(after).entries.find((entry: LocalWeeklyEstimate) => entry.quotaEpoch?.startedAt === T + 2 * D);
  assert.ok(savedPending);
  assert.equal(savedPending.fullEquivalentUsd, null);
  assert.equal(savedPending.unusedEquivalentUsd, null);
  assert.ok(!JSON.stringify(next).includes(A)); assert.ok(!JSON.stringify(next).includes(fingerprint));
  assert.ok(!JSON.stringify(next).includes('windowId'));
});
