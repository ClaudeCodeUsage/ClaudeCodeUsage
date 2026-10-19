import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CodexAccountEstimator, OfficialQuotaSample } from '../codexAccountEstimate';
import type { CodexQuotaEpoch } from '../codexQuotaEpoch';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
import * as estimateProducer from '../weeklyEstimate';
import { WeeklyEstimateArchive, WeeklyEstimateInput, weeklyEstimateAccountFingerprint } from '../weeklyEstimateArchive';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { projectWeeklyEstimateChart } from '../weeklyEstimateChart';
import type { WeeklyValueInputs } from '../weeklyValue';

const T = Date.parse('2026-10-19T02:00:00Z'), M = 60_000, WEEK = 604_800_000, R = T + 6 * 86_400_000;
const A = 'a'.repeat(64), B = 'b'.repeat(64), S = 'c'.repeat(64), SALT = 'synthetic-epoch-salt';
const epoch = (startedAt = T, resetAnchorAt = R): CodexQuotaEpoch => ({
  startedAt, resetAnchorAt, startLowerAt: startedAt === T ? null : startedAt - M,
  reason: startedAt === T ? 'initial' : 'counter-drop',
});
function sample(t: number, p: number, quotaEpoch = epoch(), accountScopeKey = A): OfficialQuotaSample {
  return { accountScopeKey, sourceScopeKey: S, requestedAt: t - 100, observedAt: t,
    resetAt: quotaEpoch.resetAnchorAt, usedPercent: p, quotaEpoch };
}
function inputs(t: number, p: number, usd: number, resetAt = R): WeeklyValueInputs {
  return { localHistoryComplete: true,
    usage: [{ sourceKey: 'same-client', timestamp: t - 1, equivalentUsd: usd, pricedTokens: usd * 10, totalTokens: usd * 10 }],
    observations: [{ provider: 'codex', sourceKey: 'same-client', seriesKey: 'codex', observedAt: t - 1, usedPercent: p, resetAt }] };
}
function estimate(quotaEpoch = epoch(), overrides: Partial<WeeklyEstimateInput> = {}): WeeklyEstimateInput & LocalWeeklyEstimate {
  return { provider: 'codex', windowStart: quotaEpoch.resetAnchorAt - WEEK, resetAt: quotaEpoch.resetAnchorAt,
    observedAt: quotaEpoch.startedAt + M, estimatedAt: quotaEpoch.startedAt + M, usedEquivalentUsd: 20,
    fullEquivalentUsd: 100, unusedEquivalentUsd: 60, utilizationPercent: 40, pricingCoverage: 1,
    method: 'account-delta-v1', pricingVersion: 'api-v1', accountScopeKey: A, quotaEpoch,
    calibrationStart: quotaEpoch.startedAt, ...overrides, flags: [...(overrides.flags ?? ['account-unattributed'])] };
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-quota-epoch-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json');
  return { file, archive: new WeeklyEstimateArchive(file, SALT, 'synthetic-source') };
}

test('account calibration preserves copied epoch metadata and never bridges a same-reset epoch change', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
  const first = e.observe(sample(T + M, 40), inputs(T + M, 40, 130), 'v1')!;
  assert.deepEqual(first.quotaEpoch, epoch());
  const frozen = JSON.stringify(first), nextEpoch = epoch(T + 2 * M);
  // Percentage can rise after an unseen reset; epoch identity must still break.
  assert.equal(e.observe(sample(T + 2 * M, 45, nextEpoch), inputs(T + 2 * M, 45, 500), 'v1'), undefined);
  const next = e.observe(sample(T + 3 * M, 55, nextEpoch), inputs(T + 3 * M, 55, 520), 'v1')!;
  assert.equal(next.usedEquivalentUsd, 20); assert.equal(next.fullEquivalentUsd, 200);
  assert.deepEqual(next.quotaEpoch, nextEpoch); assert.equal(JSON.stringify(first), frozen);
  nextEpoch.startedAt = T;
  assert.equal(next.quotaEpoch!.startedAt, T + 2 * M);
});

test('A-B-A retains A epoch but starts fresh monetary segments without foreign-account growth', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
  e.observe(sample(T + M, 40), inputs(T + M, 40, 130), 'v1');
  assert.equal(e.observe(sample(T + 2 * M, 30, epoch(), B), inputs(T + 2 * M, 30, 500), 'v1'), undefined);
  assert.equal(e.observe(sample(T + 3 * M, 45), inputs(T + 3 * M, 45, 900), 'v1'), undefined);
  const back = e.observe(sample(T + 4 * M, 55), inputs(T + 4 * M, 55, 920), 'v1')!;
  assert.equal(back.fullEquivalentUsd, 50 / .3); assert.equal(back.usedEquivalentUsd, 50);
  assert.deepEqual(back.quotaEpoch, epoch());
});

test('blur breaks the baseline while keeping only previously admitted account-epoch intervals', () => {
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
  const first = e.observe(sample(T + M, 40), inputs(T + M, 40, 130), 'v1')!, frozen = JSON.stringify(first);
  e.breakContinuity();
  assert.equal(e.observe(sample(T + 10 * M, 50), inputs(T + 10 * M, 50, 900), 'v1'), undefined);
  const resumed = e.observe(sample(T + 11 * M, 60), inputs(T + 11 * M, 60, 920), 'v1')!;
  assert.equal(resumed.usedEquivalentUsd, 50); assert.equal(resumed.fullEquivalentUsd, 50 / .3);
  assert.equal(JSON.stringify(first), frozen);
});

test('new early/natural reset epochs calibrate only their post-reset increments', () => {
  for (const natural of [false, true]) {
    const e = new CodexAccountEstimator();
    e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
    e.observe(sample(T + M, 40), inputs(T + M, 40, 130), 'v1');
    const at = natural ? R + M : T + 2 * M, reset = natural ? R + WEEK : R + 3_600_000;
    const next: CodexQuotaEpoch = { startedAt: at, resetAnchorAt: reset,
      startLowerAt: natural ? R : T + M, reason: natural ? 'scheduled-reset' : 'reset-change' };
    assert.equal(e.observe(sample(at, 10, next), inputs(at, 10, 500, reset), 'v1'), undefined);
    const result = e.observe(sample(at + M, 20, next), inputs(at + M, 20, 520, reset), 'v1')!;
    assert.equal(result.fullEquivalentUsd, 200); assert.deepEqual(result.quotaEpoch, next);
  }
});

test('epoch calibration refuses reset-anchor drift, malformed metadata and metadata disappearance', () => {
  for (const mode of ['drift', 'malformed', 'absent', 'expired'] as const) {
    const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
    const next = sample(T + M, 40);
    if (mode === 'drift') next.quotaEpoch!.resetAnchorAt += M;
    if (mode === 'malformed') next.quotaEpoch!.startedAt = next.observedAt + 1;
    if (mode === 'absent') delete next.quotaEpoch;
    if (mode === 'expired') { next.observedAt = R + 1; next.requestedAt = R; next.resetAt = R + M; }
    assert.equal(e.observe(next, inputs(next.observedAt, 40, 130, next.resetAt), 'v1'), undefined);
  }
});

test('epoch metadata keeps the 65-minute cap and explicit reset behavior intact', () => {
  for (const reset of [false, true]) {
    const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
    if (reset) e.reset();
    const at = reset ? T + M : T + 66 * M;
    assert.equal(e.observe(sample(at, 40), inputs(at, 40, 130), 'v1'), undefined);
  }
});

test('ten-minute compatible epoch intervals calibrate with an explicit continuity warning', () => {
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
  const result = e.observe(sample(T + 10 * M, 30), inputs(T + 10 * M, 30, 120), 'v1')!;
  assert.equal(result.fullEquivalentUsd, 200); assert.equal(result.usedEquivalentUsd, 20);
  assert.ok(result.flags.includes('counter-change')); assert.equal(result.fullRange, undefined);
});

test('long-gap calibration excludes a local witness regression even when both official endpoints increase', () => {
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(T, 20, 100), 'v1');
  const next = inputs(T + 10 * M, 30, 120);
  next.observations.push(
    { ...next.observations[0], observedAt: T + 3 * M, usedPercent: 25 },
    { ...next.observations[0], observedAt: T + 4 * M, usedPercent: 22 },
  );
  assert.equal(e.observe(sample(T + 10 * M, 30), next, 'v1'), undefined);
});

test('archive keeps same-reset epochs, legacy keys and stable account ordinals across reload and clear', async t => {
  const { file, archive } = await fixture(t), legacy = { ...estimate(), quotaEpoch: undefined };
  await archive.record(legacy);
  const old = JSON.parse(await readFile(file, 'utf8')).entries[0];
  await archive.record(estimate());
  await archive.record(estimate(epoch(T + 2 * M)));
  await archive.record(estimate(epoch(), { accountScopeKey: B }));
  const loaded = await new WeeklyEstimateArchive(file, SALT, 'synthetic-source').load();
  assert.equal(loaded.status, 'ready'); assert.equal(loaded.entries.length, 4);
  assert.deepEqual(loaded.entries.map(row => row.accountNumber), [1, 1, 1, 2]);
  assert.equal(new Set(loaded.entries.slice(0, 3).map(row => row.windowKey)).size, 3);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).entries[0], old);
  assert.equal((await archive.record(estimate())).outcome, 'unchanged');
  await archive.clear({ provider: 'codex', accountFingerprint: weeklyEstimateAccountFingerprint(SALT, 'codex', A) });
  assert.deepEqual((await archive.load()).entries.map(row => row.accountScopeKey), [B]);
  assert.equal((await archive.record(estimate())).outcome, 'cleared-observation');
});

test('archive rejects malformed/context-inconsistent epochs without changing retained bytes', async t => {
  const { file, archive } = await fixture(t); await archive.record(estimate());
  const before = await readFile(file, 'utf8');
  for (const patch of [
    { provider: 'claude' }, { accountScopeKey: undefined }, { method: 'series-prefix-v1' },
    { observedAt: T - 1 }, { calibrationStart: T - 1 }, { resetAt: R + 300_001 },
    { quotaEpoch: null }, { quotaEpoch: { ...epoch(), startLowerAt: undefined } },
    { quotaEpoch: { ...epoch(), reason: 'counter-drop', startLowerAt: T - M } },
  ]) {
    assert.equal((await archive.record({ ...estimate(), ...patch } as WeeklyEstimateInput)).outcome, 'invalid', JSON.stringify(patch));
    assert.equal(await readFile(file, 'utf8'), before);
  }
});

test('coordinator projects both same-reset epochs, notices active epoch-only changes, and reloads metadata', async t => {
  const { file } = await fixture(t), c = new WeeklyEstimateCoordinator(file, SALT), empty = { usage: [], observations: [] };
  const entries = [estimate(), estimate(epoch(T + 2 * M))];
  const opts = { sourceNamespace: 'synthetic-source', pricingVersion: 'api-v1', now: T + 4 * M,
    accountEstimates: entries, activeAccountScopeKey: A, activeQuotaEpochStartedAt: T };
  c.project('codex', empty, opts); await c.flush();
  const view = c.project('codex', empty, { ...opts, activeQuotaEpochStartedAt: T + 2 * M });
  assert.equal(view.activeQuotaEpochStartedAt, T + 2 * M); assert.equal(view.activeAccountNumber, 1);
  assert.equal(view.entries.length, 2); assert.ok(view.entries.every(row => row.accountNumber === 1));
  assert.doesNotMatch(JSON.stringify(view), /accountScopeKey|windowKey|sourceKey/);
  const restarted = new WeeklyEstimateCoordinator(file, SALT);
  restarted.project('codex', empty, { ...opts, accountEstimates: [] }); await restarted.flush();
  assert.deepEqual(restarted.project('codex', empty, { ...opts, accountEstimates: [] }).entries
    .map(row => row.quotaEpoch!.startedAt).sort(), [T, T + 2 * M]);
  c.dispose(); restarted.dispose();
});

test('chart keeps old and new same-reset epochs and uses active account+epoch for current', () => {
  const entries: LocalWeeklyEstimate[] = [estimate(), estimate(epoch(T + 2 * M))].map(row => ({ ...row, flags: [...row.flags], accountNumber: 1 }));
  const points = projectWeeklyEstimateChart('codex', [], entries, { now: T + 4 * M,
    activeAccountNumber: 1, activeQuotaEpochStartedAt: T + 2 * M, accountIdentityAvailable: true });
  assert.equal(points.length, 2);
  assert.equal(points.filter(point => point.current).length, 1);
  assert.equal(points.find(point => point.current)!.quotaEpoch!.startedAt, T + 2 * M);
  const stale = projectWeeklyEstimateChart('codex', [], [entries[0]], { now: T + 4 * M,
    activeAccountNumber: 1, activeQuotaEpochStartedAt: T + 2 * M, accountIdentityAvailable: true });
  assert.equal(stale[0].current, false);
});

test('identified official account never marks an unassigned rough snapshot as current', () => {
  const rough: LocalWeeklyEstimate = { ...estimate(), quotaEpoch: undefined, accountScopeKey: undefined,
    method: 'rough-prefix-v2', flags: [] };
  assert.equal(projectWeeklyEstimateChart('codex', [], [rough], { now: T + 2 * M,
    accountIdentityAvailable: true, activeQuotaEpochStartedAt: T })[0].current, false);
  assert.equal(projectWeeklyEstimateChart('codex', [], [rough], { now: T + 2 * M })[0].current, true);
  assert.equal(projectWeeklyEstimateChart('codex', [], [rough], { now: T + 2 * M,
    accountIdentityAvailable: false })[0].current, false);
});

test('archive coalesces unchanged epoch percentages by method and price without rewriting historical as-of values', async t => {
  const { file, archive } = await fixture(t);
  await archive.record(estimate()); const original = await readFile(file, 'utf8');
  for (let i = 2; i <= 4; i++) {
    assert.equal((await archive.record(estimate(epoch(), { observedAt: T + i * M, estimatedAt: T + i * M,
      fullEquivalentUsd: 110, unusedEquivalentUsd: 66 }))).outcome, 'unchanged');
  }
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal((await archive.record(estimate(epoch(), { observedAt: T + 5 * M,
    utilizationPercent: 41 }))).outcome, 'recorded');
  assert.equal((await archive.record(estimate(epoch(), { observedAt: T + 6 * M,
    pricingVersion: 'api-v2' }))).outcome, 'recorded');
  const rows = (await archive.load()).entries;
  assert.equal(rows.length, 3); assert.equal(rows[0].observedAt, T + M); assert.equal(rows[0].fullEquivalentUsd, 100);
});

test('coordinator reduces current-epoch observations before its display cap so old cycles remain visible', async t => {
  const { file } = await fixture(t), coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const current = Array.from({ length: 60 }, (_, i) => estimate(epoch(), {
    observedAt: T + (i + 1) * M, utilizationPercent: 20 + i,
  }));
  const old = estimate(epoch(T - WEEK, R - WEEK));
  const opts = { sourceNamespace: 'synthetic-source', pricingVersion: 'api-v1', now: T + 61 * M,
    accountEstimates: [old, ...current], activeAccountScopeKey: A, activeQuotaEpochStartedAt: T };
  const view = coordinator.project('codex', { usage: [], observations: [] }, opts);
  assert.equal(view.entries.length, 2);
  assert.ok(view.entries.some(row => row.quotaEpoch?.startedAt === T - WEEK));
  assert.equal(view.entries.find(row => row.quotaEpoch?.startedAt === T)!.observedAt, T + 60 * M);
  await coordinator.flush(); coordinator.dispose();
});

test('500 Codex producer renders across 12 weeks retain all cycles with one first-as-of write per percentage', async t => {
  const { file } = await fixture(t), coordinator = new WeeklyEstimateCoordinator(file, SALT);
  let live: LocalWeeklyEstimate;
  t.mock.method(estimateProducer, 'buildLocalWeeklyEstimates', () => [live]);
  const firstTimes = new Map<number, number>();
  for (let i = 0; i < 500; i++) {
    const weeksAgo = i % 12, resetAt = R - weeksAgo * WEEK;
    live = estimate(epoch(), { quotaEpoch: undefined, accountScopeKey: undefined,
      method: 'series-prefix-v1', calibrationStart: undefined,
      windowStart: resetAt - WEEK, resetAt, observedAt: T - weeksAgo * WEEK + i * M,
      fullEquivalentUsd: 100 + i, unusedEquivalentUsd: (100 + i) * .6 });
    if (!firstTimes.has(resetAt)) firstTimes.set(resetAt, live.observedAt);
    coordinator.project('codex', { usage: [], observations: [] }, {
      sourceNamespace: 'synthetic-source', pricingVersion: 'api-v1', now: T + 501 * M,
    });
  }
  await coordinator.flush();
  const stored = (await new WeeklyEstimateArchive(file, SALT, 'synthetic-source').load()).entries;
  assert.equal(stored.length, 12);
  for (const row of stored) assert.equal(row.observedAt, firstTimes.get(row.resetAt));
  const view = coordinator.project('codex', { usage: [], observations: [] }, {
    sourceNamespace: 'synthetic-source', pricingVersion: 'api-v1', now: T + 501 * M,
  });
  assert.equal(view.entries.length, 12); assert.ok(view.entries.every(row => row.accountNumber === undefined));
  coordinator.dispose();
});

test('Codex producer coalescing uses fixed reset representatives, calibration and pricing while Claude keeps revisions', async t => {
  const { archive } = await fixture(t);
  const rough = estimate(epoch(), { quotaEpoch: undefined, accountScopeKey: undefined, method: 'rough-prefix-v2' });
  assert.equal((await archive.record(rough)).outcome, 'recorded');
  assert.equal((await archive.record({ ...rough, resetAt: R + 240_000, observedAt: T + 2 * M })).outcome, 'unchanged');
  assert.equal((await archive.record({ ...rough, resetAt: R + 480_000, observedAt: T + 3 * M })).outcome, 'recorded');
  assert.equal((await archive.record({ ...rough, calibrationStart: T + 1, observedAt: T + 4 * M })).outcome, 'recorded');
  assert.equal((await archive.record({ ...rough, pricingVersion: 'api-v2' })).outcome, 'recorded');
  const claude = { ...rough, provider: 'claude' as const };
  assert.equal((await archive.record(claude)).outcome, 'recorded');
  assert.equal((await archive.record({ ...claude, usedEquivalentUsd: 21 })).outcome, 'recorded');
});
