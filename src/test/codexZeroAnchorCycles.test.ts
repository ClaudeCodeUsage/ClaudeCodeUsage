import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { withCodexQuotaCycles, selectCodexCycleEstimates, copyCodexQuotaCycle } from '../codexQuotaCycles';
import { projectWeeklyEstimateChart } from '../weeklyEstimateChart';
import { codexQuotaEpochFromObservations, copyCodexQuotaEpoch, codexQuotaEpochFitsObservation } from '../codexQuotaEpoch';
import { codexQuotaCaptureFromOfficialSample, createEmptyQuotaObservationStore, mergeQuotaCaptures } from '../quotaObservationStore';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';

const W = 604_800_000, M = 60_000, A = 'a'.repeat(64);
const T = Date.parse('2026-10-20T14:00Z'), Z1 = T + 79 * M, Z2 = T + 120 * M, P = T + 150 * M;
const OLD_RESET = Date.parse('2026-10-26T15:00Z');
type Fact = { at: number; percent: number; reset?: number };
const initial: Fact[] = [{ at: T, percent: 100, reset: OLD_RESET }, { at: Z1, percent: 0 },
  { at: Z2, percent: 0 }, { at: P, percent: 1 }];
function fixture(facts = initial) {
  const now = facts[facts.length - 1].at;
  const observations = mergeQuotaCaptures(createEmptyQuotaObservationStore(), facts.map(fact =>
    codexQuotaCaptureFromOfficialSample({ accountScopeKey: A, observedAt: fact.at,
      resetAt: fact.reset ?? fact.at + W, usedPercent: fact.percent })!), { salt: 'synthetic-zero-anchor', now }).observations;
  const fingerprint = (key: string) => key === A ? observations[0].accountFingerprint : undefined;
  const entries: LocalWeeklyEstimate[] = observations.map(row => ({ provider: 'codex', accountScopeKey: A, accountNumber: 1,
    quotaEpoch: codexQuotaEpochFromObservations(observations, row.accountFingerprint, row.observedAt, row.resetAt!)!,
    windowStart: row.resetAt! - W, resetAt: row.resetAt!, observedAt: row.observedAt, estimatedAt: row.observedAt,
    utilizationPercent: row.usedFraction * 100, usedEquivalentUsd: 0, fullEquivalentUsd: null,
    unusedEquivalentUsd: null, pricingCoverage: 0, method: 'account-delta-v1', flags: ['account-unattributed'] }));
  return { now, observations, fingerprint, entries };
}
function project(f: ReturnType<typeof fixture>, entries = f.entries, observations = f.observations) {
  return withCodexQuotaCycles(entries, observations, f.fingerprint, f.now);
}
const chartOptions = (now: number, active = P) => ({ now, activeAccountNumber: 1,
  accountIdentityAvailable: true, activeQuotaEpochStartedAt: active });

test('100 to shifting zero anchors to first positive use displays two cycles without rewriting source facts', () => {
  for (const length of [2, 3, 4]) {
    const f = fixture(initial.slice(0, length)), frozen = JSON.stringify([f.entries, f.observations]);
    const projected = project(f), selected = selectCodexCycleEstimates(projected, f.now);
    assert.equal(selected.length, 2);
    assert.equal(projected[0].quotaCycle?.endAt, Z1);
    assert.equal(projected[0].quotaCycle?.closed, true);
    const current = selected.find(entry => entry.quotaCycle?.id === Z1)!;
    assert.ok(current); assert.equal(current.quotaCycle!.startAt, Z1);
    assert.equal(current.quotaCycle!.startLowerAt, T);
    assert.equal(current.quotaCycle!.endAt, f.entries[f.entries.length - 1].resetAt);
    assert.equal(current.quotaCycle!.closed, false);
    assert.equal(current.observedAt, f.now);
    for (let i = 0; i < projected.length; i++) {
      assert.deepEqual(projected[i].quotaEpoch, f.entries[i].quotaEpoch);
      assert.equal(projected[i].resetAt, f.entries[i].resetAt);
      assert.equal(projected[i].observedAt, f.entries[i].observedAt);
      assert.ok(copyCodexQuotaCycle(projected[i].quotaCycle));
      assert.ok(copyCodexQuotaEpoch(projected[i].quotaEpoch));
      assert.ok(codexQuotaEpochFitsObservation(projected[i].quotaEpoch!, projected[i].observedAt, projected[i].resetAt));
    }
    assert.equal(JSON.stringify([f.entries, f.observations]), frozen);
    assert.deepEqual(project(f, projected), projected, 'runtime projection is idempotent');
  }
});

test('legacy account-ambiguous flags do not erase verified official continuity in a 35-row two-zero history', () => {
  const facts: Fact[] = [...Array.from({ length: 33 }, (_, index) => ({ at: T - (32 - index) * M,
    percent: 100, reset: OLD_RESET })), initial[1], initial[2]];
  for (const history of [facts, [...facts, initial[3]]]) {
    const f = fixture(history);
    for (const row of f.observations) row.flags = ['account-ambiguous'];
    assert.equal(f.observations.length, history.length);
    assert.equal(new Set(f.observations.map(row => row.accountFingerprint)).size, 1);
    const frozen = JSON.stringify([f.entries, f.observations]), projected = project(f);
    assert.equal(selectCodexCycleEstimates(projected).length, 2);
    assert.equal(projected[33].quotaCycle?.id, projected[34].quotaCycle?.id);
    assert.ok(projected.every(entry => entry.fullEquivalentUsd === null), 'display aliases grant no amount admission');
    assert.ok(f.observations.every(row => row.flags.includes('account-ambiguous') && row.confidence === 'high'));
    assert.equal(JSON.stringify([f.entries, f.observations]), frozen);
  }
});

test('legacy flags do not replace verified attribution, official source or matching account proof', () => {
  const f = fixture(initial.slice(0, 3));
  for (const row of f.observations) row.flags = ['account-ambiguous'];
  for (const patch of [{ accountAttribution: 'profile-continuity' as const },
    { accountAttribution: 'unattributed' as const }, { source: 'codex-local-structured-event' as const },
    { accountFingerprint: 'acct_' + 'b'.repeat(32) }, { flags: ['account-ambiguous' as const, 'clock-anomaly' as const] }]) {
    for (const onlyLast of [false, true]) {
      const rows = f.observations.map((row, index) => !onlyLast || index === 2 ? { ...row, ...patch } : row);
      const frozen = JSON.stringify(rows);
      assert.equal(selectCodexCycleEstimates(project(f, f.entries, rows)).length, 3);
      assert.equal(JSON.stringify(rows), frozen);
    }
  }
});

test('first positive use under an unchanged last zero anchor belongs to the same display cycle', () => {
  const f = fixture([...initial.slice(0, 3), { at: P, percent: 1, reset: Z2 + W }]);
  const projected = project(f);
  assert.equal(selectCodexCycleEstimates(projected).length, 2);
  assert.equal(projected[3].quotaEpoch?.startedAt, Z2);
  assert.equal(projected[3].quotaCycle?.id, Z1);
  assert.equal(projectWeeklyEstimateChart('codex', [], projected, chartOptions(f.now, Z2)).filter(row => row.current).length, 1);
});

test('active raw epoch maps explicitly through all snapshots, including a discarded zero checkpoint', () => {
  const f = fixture(), projected = project(f);
  assert.equal(selectCodexCycleEstimates(projected).some(entry => entry.quotaEpoch?.startedAt === Z2), false);
  for (const rawActive of [Z1, Z2, P]) {
    const chart = projectWeeklyEstimateChart('codex', [], projected, chartOptions(f.now, rawActive));
    assert.equal(chart.length, 2);
    assert.equal(chart.filter(row => row.current).length, 1);
    assert.equal(chart.find(row => row.current)!.quotaCycle?.id, Z1);
    assert.equal(chart.find(row => row.current)!.observedAt, P);
  }
  for (const options of [{ ...chartOptions(f.now), activeQuotaEpochStartedAt: T },
    { ...chartOptions(f.now), activeQuotaEpochStartedAt: Z2 + 1 },
    { ...chartOptions(f.now), activeAccountNumber: 2 }, { ...chartOptions(f.now), accountIdentityAvailable: false }]) {
    assert.ok(projectWeeklyEstimateChart('codex', [], projected, options).every(row => !row.current));
  }
});

test('a known Codex account with an open latest cycle still requires a proven active raw epoch', () => {
  for (const f of [fixture(), fixture([{ at: P, percent: 10 }])]) {
    const projected = project(f), withoutActive = { now: f.now, activeAccountNumber: 1, accountIdentityAvailable: true };
    const before = JSON.stringify(projected);
    assert.equal(projectWeeklyEstimateChart('codex', [], projected, chartOptions(f.now)).filter(row => row.current).length, 1);
    const chart = projectWeeklyEstimateChart('codex', [], projected, withoutActive);
    assert.ok(chart.every(row => !row.current), 'account identity and an open deadline cannot replace active epoch proof');
    assert.equal(chart[0].observedAt, f.now, 'the original as-of measurement remains visible');
    assert.equal(JSON.stringify(projected), before);
  }
});

test('alias mapping does not make an older monetary snapshot current when a newer pending fact exists', () => {
  const f = fixture([...initial, { at: P + M, percent: 2, reset: P + W }]);
  f.entries[3] = { ...f.entries[3], usedEquivalentUsd: 10, fullEquivalentUsd: 700,
    unusedEquivalentUsd: 693, pricingCoverage: 1 };
  const projected = project(f), chart = projectWeeklyEstimateChart('codex', [], projected, chartOptions(f.now));
  assert.equal(chart.length, 2);
  const monetary = chart.find(row => row.fullEquivalentUsd === 700)!;
  assert.ok(monetary); assert.equal(monetary.observedAt, P); assert.equal(monetary.current, false);
});

test('prior-cycle money and later post-positive money remain separate unchanged snapshots', () => {
  const f = fixture([...initial, { at: P + M, percent: 2, reset: P + W }]);
  f.entries[0] = { ...f.entries[0], usedEquivalentUsd: 300, fullEquivalentUsd: 1000,
    unusedEquivalentUsd: 0, pricingCoverage: 1 };
  f.entries[4] = { ...f.entries[4], usedEquivalentUsd: 10, fullEquivalentUsd: 500,
    unusedEquivalentUsd: 490, pricingCoverage: 1 };
  const frozen = JSON.stringify(f.entries), projected = project(f), selected = selectCodexCycleEstimates(projected);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(entry => entry.fullEquivalentUsd).sort((a, b) => a! - b!), [500, 1000]);
  assert.equal(selected.find(entry => entry.fullEquivalentUsd === 500)!.usedEquivalentUsd, 10);
  assert.equal(selected.find(entry => entry.fullEquivalentUsd === 500)!.quotaEpoch?.startedAt, P);
  assert.equal(JSON.stringify(f.entries), frozen);
});

test('an anchor change after positive use remains a separate used cycle', () => {
  const f = fixture([...initial, { at: P + 30 * M, percent: 2 }]);
  const projected = project(f);
  assert.equal(selectCodexCycleEstimates(projected).length, 3);
  assert.notEqual(projected[3].quotaCycle?.id, projected[4].quotaCycle?.id);
});

test('a genuine positive-to-zero drop stays separate and only its later zero continuation may coalesce', () => {
  const drop = P + 30 * M, drift = drop + 20 * M;
  const f = fixture([...initial, { at: drop, percent: 0, reset: P + W }, { at: drift, percent: 0 }]);
  const projected = project(f);
  assert.equal(selectCodexCycleEstimates(projected).length, 3);
  assert.equal(projected[4].quotaEpoch?.reason, 'counter-drop');
  assert.notEqual(projected[3].quotaCycle?.id, projected[4].quotaCycle?.id);
  assert.equal(projected[4].quotaCycle?.id, projected[5].quotaCycle?.id);
});

test('expiry and scheduled rollover terminate a provisional zero run', () => {
  const at = Z2 + W + M;
  const f = fixture([...initial.slice(0, 3), { at, percent: 0, reset: Z2 + 2 * W }]);
  const projected = project(f);
  assert.equal(selectCodexCycleEstimates(projected).length, 3);
  assert.equal(projected[3].quotaEpoch?.reason, 'scheduled-reset');
  assert.equal(projected[3].quotaCycle?.startAt, Z2 + W);
  assert.equal(projected[1].quotaCycle?.endAt, Z2 + W);
  const uncertain = fixture([...initial.slice(0, 3), { at, percent: 0 }]);
  assert.equal(selectCodexCycleEstimates(project(uncertain)).length, 3,
    'an expired deadline cannot be bridged even without an exact weekly rollover');
});

test('ambiguous mappings of one active raw epoch to different cycles fail closed', () => {
  const f = fixture(), projected = project(f), member = projected[2];
  const contradictory = { ...member, quotaCycle: { ...member.quotaCycle!, id: Z2, startAt: Z2 } };
  const chart = projectWeeklyEstimateChart('codex', [], [...projected, contradictory], chartOptions(f.now, Z2));
  assert.ok(chart.every(row => !row.current));
});

test('nonzero to nonzero anchor changes are not provisional zero continuations', () => {
  const f = fixture([{ at: Z1, percent: 1 }, { at: Z2, percent: 1 }, { at: P, percent: 2 }]);
  assert.equal(selectCodexCycleEstimates(project(f)).length, 3);
});

test('missing P2 proof or a missing provisional window never aliases archived epochs by reset or account alone', () => {
  const f = fixture();
  assert.equal(selectCodexCycleEstimates(project(f, f.entries, [])).length, 4);
  const partial = f.observations.filter(row => row.observedAt !== Z2);
  assert.equal(selectCodexCycleEstimates(project(f, f.entries, partial)).length, 4);
  for (const extra of [{ accountAttribution: 'profile-continuity' as const }, { flags: ['clock-anomaly' as const] },
    { remainingFraction: .5 }]) {
    const rows = f.observations.map(row => row.observedAt === Z2 ? { ...row, ...extra } : row);
    assert.equal(selectCodexCycleEstimates(project(f, f.entries, rows)).length, 4);
  }
});

test('a provider window identity change is not explained away as zero anchor movement', () => {
  const f = fixture(initial.slice(0, 3));
  f.observations[2] = { ...f.observations[2], captureReason: 'window-id-change',
    providerWindowFingerprint: 'pwin_' + 'f'.repeat(32) };
  assert.equal(selectCodexCycleEstimates(project(f)).length, 3);
});

test('monetary or positive-use history inside a zero-looking epoch protects that epoch from coalescing', () => {
  for (const patch of [{ usedEquivalentUsd: 5 }, { fullEquivalentUsd: 100, unusedEquivalentUsd: 100, pricingCoverage: 1 },
    { unlinkedEquivalentUsd: 5 }, { utilizationPercent: 1 }]) {
    const f = fixture(); f.entries[1] = { ...f.entries[1], ...patch };
    const frozen = JSON.stringify(f.entries), projected = project(f);
    assert.equal(selectCodexCycleEstimates(projected).length, 3);
    assert.notEqual(projected[1].quotaCycle?.id, projected[2].quotaCycle?.id);
    assert.equal(JSON.stringify(f.entries), frozen);
  }
});

test('another account with identical zero reset times remains separate', () => {
  const f = fixture(), b = 'b'.repeat(64);
  const other = f.entries.slice(1, 3).map(entry => ({ ...entry, accountScopeKey: b, accountNumber: 2 }));
  const projected = project(f, [...f.entries, ...other]);
  const selected = selectCodexCycleEstimates(projected);
  assert.equal(selected.filter(entry => entry.accountNumber === 1).length, 2);
  assert.equal(selected.filter(entry => entry.accountNumber === 2).length, 2);
});
