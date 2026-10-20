import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexAccountEstimator, OfficialQuotaSample } from '../codexAccountEstimate';
import type { CodexQuotaCheckpoint, CodexQuotaIncompleteRange as IncompleteRange } from '../providers/codex/codexQuotaCheckpoints';
import type { WeeklyValueInputs } from '../weeklyValue';

const T = Date.parse('2026-10-19T02:00Z'), M = 60_000, R = T + 6 * 86_400_000;
const A = 'a'.repeat(64), B = 'b'.repeat(64), S = 'c'.repeat(64);
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .01, cachedInput: .001, output: .1 }] };
function sample(t: number, p: number, accountScopeKey = A): OfficialQuotaSample {
  return { accountScopeKey, sourceScopeKey: S, requestedAt: t - 100, observedAt: t, resetAt: R,
    usedPercent: p, quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } };
}
function point(through: number, p: number, output: number, sourceKey = 'private-own-source',
  segment = 1, from = T - M): CodexQuotaCheckpoint {
  return { sourceKey, segment, from, through, resetAt: R, usedPercent: p, baseline: false,
    byModel: { 'gpt-5': { inputTotal: 0, outputTotal: output } }, complete: true };
}
function base(from = T - M, p = 10, source = 'private-own-source', segment = 1): CodexQuotaCheckpoint {
  return { ...point(from, p, 0, source, segment, from), baseline: true, byModel: {} };
}
function inputs(t: number, p: number, rows: readonly CodexQuotaCheckpoint[], daily = 100): WeeklyValueInputs {
  return { localHistoryComplete: true, calibrationPricebook: book,
    codexQuotaCheckpoints: rows, codexQuotaCheckpointsComplete: true,
    usage: [{ sourceKey: 'private-own-source', timestamp: t - 1, intervalStart: T - M,
      intervalEnd: t - 1, equivalentUsd: daily, pricedTokens: daily * 10, totalTokens: daily * 10 }],
    observations: [{ provider: 'codex', sourceKey: 'private-own-source', seriesKey: 'codex',
      observedAt: t - 1, resetAt: R, usedPercent: p }] };
}
const initial = () => [base(), point(T - 1000, 20, 1000)];
function ranged(t: number, p: number, rows: readonly CodexQuotaCheckpoint[], ranges: readonly IncompleteRange[]) {
  return { ...inputs(t, p, rows, 9999), codexQuotaCheckpointsComplete: false,
    codexQuotaIncompleteRanges: ranges };
}

test('official calibration prices paired checkpoints with the supplied book, ignoring misleading daily aggregates and witnesses', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  const next = inputs(T + M, 30, rows, 10_000);
  next.observations[0].flags = ['account-ambiguous'];
  const x = e.observe(sample(T + M, 30), next, 'v1')!;
  assert.equal(x.usedEquivalentUsd, 20);
  assert.equal(x.fullEquivalentUsd, 200);
  assert.equal(x.calibrationEvidence!.interval.pricedTokens, 200);
  assert.equal(x.calibrationEvidence!.interval.linkedSources, 1);
  assert.deepEqual(x.calibrationEvidence!.pricebook, book);
  assert.ok(x.flags.includes('account-unattributed'));
  assert.ok(!JSON.stringify(x).includes('private-own-source'));
});
test('paired pricing counts cached input and reasoning only as subsets of input and output', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, [base()]), 'v1');
  const row = { ...point(T + M - 1000, 30, 0), byModel: {
    'gpt-5': { inputTotal: 100, cachedInput: 40, outputTotal: 20, reasoningOutput: 10, sourceTotal: 120 } } };
  const x = e.observe(sample(T + M, 30), inputs(T + M, 30, [base(), row], 9999), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 2.64);
  assert.equal(x.calibrationEvidence!.interval.totalTokens, 120);
});
test('missing or incomplete checkpoint authority never falls back to daily calibration', () => {
  for (const mode of ['scope-false', 'scope-missing', 'array-missing', 'row-incomplete', 'baseline-missing', 'book-missing', 'unknown-rate'] as const) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
    const end = point(T + M - 1000, 30, 1200), next = inputs(T + M, 30, [...rows, end], 120);
    if (mode === 'scope-false') next.codexQuotaCheckpointsComplete = false;
    if (mode === 'scope-missing') delete next.codexQuotaCheckpointsComplete;
    if (mode === 'array-missing') delete next.codexQuotaCheckpoints;
    if (mode === 'row-incomplete') end.complete = false;
    if (mode === 'baseline-missing') next.codexQuotaCheckpoints = [end];
    if (mode === 'book-missing') delete next.calibrationPricebook;
    if (mode === 'unknown-rate') end.byModel = { ...end.byModel, 'unknown-exact-model': { inputTotal: 0, outputTotal: 10 } };
    assert.equal(e.observe(sample(T + M, 30), next, 'v1'), undefined, mode);
  }
});
test('a new file or segment baseline with discarded request tokens withholds the whole official interval, then permits a fresh pair', () => {
  for (const source of ['private-own-source', 'private-new-source']) {
    const e = new CodexAccountEstimator(), rows = initial(), segment = source === 'private-own-source' ? 2 : 1;
    e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
    rows.push(point(T + M - 2000, 30, 1200));
    const from = T + M - 1000;
    rows.push(base(from, 30, source, segment));
    assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows, 120), 'v1'), undefined);
    if (source !== 'private-own-source') rows.push(point(T + 2 * M - 2000, 40, 1400));
    rows.push(point(T + 2 * M - 1000, 40, 100, source, segment, from));
    const x = e.observe(sample(T + 2 * M, 40), inputs(T + 2 * M, 40, rows, 9999), 'v1')!;
    assert.equal(x.usedEquivalentUsd, source === 'private-own-source' ? 10 : 30);
    assert.equal(x.calibrationEvidence!.accumulated.intervals, 1);
    assert.equal(x.calibrationStart, T + M);
  }
});
test('A-B-A keeps admitted account evidence while segment counters never bridge visits or baseline-line tokens', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows), 'v1')!.usedEquivalentUsd, 20);
  rows.push(base(T + 2 * M - 2000, 40, 'private-own-source', 2),
    point(T + 2 * M - 1000, 40, 9000, 'private-own-source', 2, T + 2 * M - 2000));
  assert.equal(e.observe(sample(T + 2 * M, 40, B), inputs(T + 2 * M, 40, rows), 'v1'), undefined);
  rows.push(base(T + 3 * M - 2000, 35, 'private-own-source', 3),
    point(T + 3 * M - 1000, 35, 500, 'private-own-source', 3, T + 3 * M - 2000));
  assert.equal(e.observe(sample(T + 3 * M, 35), inputs(T + 3 * M, 35, rows), 'v1'), undefined);
  rows.push(point(T + 4 * M - 1000, 45, 600, 'private-own-source', 3, T + 3 * M - 2000));
  const x = e.observe(sample(T + 4 * M, 45), inputs(T + 4 * M, 45, rows), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 30);
  assert.equal(x.calibrationEvidence!.accumulated.intervals, 2);
  assert.equal(x.calibrationEvidence!.interval.deltaUsd, 10);
});
test('future checkpoints and entirely historical backfill supply no current increment', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 1000, 30, 1200),
    base(T - 4 * M, 10, 'private-backfill'), point(T - 2 * M, 15, 9000, 'private-backfill', 1, T - 4 * M),
    base(T + 2 * M, 40, 'private-future'), point(T + 3 * M, 50, 9000, 'private-future', 1, T + 2 * M));
  const x = e.observe(sample(T + M, 30), inputs(T + M, 30, rows, 100_000), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 20);
  assert.equal(x.calibrationEvidence!.interval.linkedSources, 1);
});
test('late-discovered sources crossing the official baseline cannot masquerade as paired increments', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 1000, 30, 1200), base(T - 4 * M, 10, 'private-late'),
    point(T + M - 2000, 25, 9000, 'private-late', 1, T - 4 * M));
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows, 120), 'v1'), undefined);
});
test('a late pre-official checkpoint inside an existing segment cannot inflate the next official interval', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T - 500, 20, 9000), point(T + M - 1000, 30, 9200));
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows, 120), 'v1'), undefined);
  rows.push(point(T + 2 * M - 1000, 40, 9400));
  assert.equal(e.observe(sample(T + 2 * M, 40), inputs(T + 2 * M, 40, rows, 140), 'v1')!.usedEquivalentUsd, 20);
});
test('endpoint compaction does not discard a still-held exact baseline counter', () => {
  const e = new CodexAccountEstimator();
  e.observe(sample(T, 20), inputs(T, 20, initial()), 'v1');
  const compacted = [base(), point(T + M - 1000, 30, 1200)];
  const x = e.observe(sample(T + M, 30), inputs(T + M, 30, compacted, 9999), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 20);
});
test('exclusions use original file scope and never disappear behind segment-qualified keys', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  rows.push(base(T - 2 * M, 10, 'private-excluded'), point(T - 1000, 20, 500, 'private-excluded', 1, T - 2 * M));
  const scoped = (t: number, p: number) => ({ ...inputs(t, p, rows, 100 + (t - T) / M * 20),
    calibrationSourceScope: { verified: true, excludedSourceKeys: ['private-excluded'] } });
  e.observe(sample(T, 20), scoped(T, 20), 'v1');
  rows.push(point(T + M - 1000, 30, 1200), point(T + M - 2000, 30, 700, 'private-excluded', 1, T - 2 * M));
  assert.equal(e.observe(sample(T + M, 30), scoped(T + M, 30), 'v1'), undefined);
  rows.push(point(T + 2 * M - 1000, 40, 1400));
  const x = e.observe(sample(T + 2 * M, 40), scoped(T + 2 * M, 40), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 20);
  assert.equal(x.calibrationEvidence!.interval.excludedSources, 1);
});
test('component regressions cannot be hidden by another growing component or model', () => {
  const e = new CodexAccountEstimator(), start = { ...point(T - 1000, 20, 1000), byModel: {
    'gpt-5': { inputTotal: 100, cachedInput: 50, outputTotal: 1000 } } };
  e.observe(sample(T, 20), inputs(T, 20, [base(), start]), 'v1');
  const regressed = { ...point(T + M - 1000, 30, 1200), byModel: {
    'gpt-5': { inputTotal: 100, cachedInput: 40, outputTotal: 1200 } } };
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, [base(), regressed], 120), 'v1'), undefined);
});
test('a cumulative subset cannot grow beyond its enclosing incremental component', () => {
  const e = new CodexAccountEstimator();
  const start = { ...point(T - 1000, 20, 1000), byModel: {
    'gpt-5': { inputTotal: 100, cachedInput: 40, outputTotal: 1000 } } };
  e.observe(sample(T, 20), inputs(T, 20, [base(), start]), 'v1');
  const end = { ...point(T + M - 1000, 30, 1200), byModel: {
    'gpt-5': { inputTotal: 100, cachedInput: 50, outputTotal: 1200 } } };
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, [base(), end], 120), 'v1'), undefined);
});
test('a retired file segment cannot resume behind a later segment', () => {
  const e = new CodexAccountEstimator(), rows = [base(T - 4 * M, 5),
    point(T - 3 * M, 10, 100, 'private-own-source', 1, T - 4 * M),
    base(T - 2 * M, 15, 'private-own-source', 2),
    point(T - 1000, 20, 1000, 'private-own-source', 2, T - 2 * M)];
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 2000, 30, 300, 'private-own-source', 1, T - 4 * M),
    point(T + M - 1000, 30, 1200, 'private-own-source', 2, T - 2 * M));
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows, 120), 'v1'), undefined);
});
test('localized old-window omissions preserve exact active-window calibration and admitted sums', () => {
  for (const includeOld of [false, true]) {
    const e = new CodexAccountEstimator(), rows = initial(), oldReset = T - 10 * M;
    if (includeOld) rows.push({ ...base(T - 30 * M, 10, 'private-old-incomplete'), resetAt: oldReset, complete: false },
      { ...point(T - 20 * M, 20, 9000, 'private-old-incomplete', 1, T - 30 * M), resetAt: oldReset, complete: false });
    const scoped = (t: number, p: number) => ({ ...inputs(t, p, rows, 9999),
      codexQuotaCheckpointsComplete: false, codexQuotaIncompleteResets: includeOld ? [oldReset] : [],
      codexQuotaIncompleteRanges: includeOld ? [{ from: T - 30 * M, through: T - 20 * M, resetAt: oldReset }] : [] });
    e.observe(sample(T, 20), scoped(T, 20), 'v1');
    rows.push(point(T + M - 1000, 30, 1200));
    const first = e.observe(sample(T + M, 30), scoped(T + M, 30), 'v1')!;
    assert.equal(first.usedEquivalentUsd, 20);
    assert.equal(first.fullEquivalentUsd, 200);
    rows.push(point(T + 2 * M - 1000, 40, 1400));
    const next = { ...scoped(T + 2 * M, 40), codexQuotaIncompleteResets: [oldReset, R - 604_800_000] };
    const x = e.observe(sample(T + 2 * M, 40), next, 'v1')!;
    assert.equal(x.usedEquivalentUsd, 40);
    assert.equal(x.calibrationEvidence!.accumulated.intervals, 2);
    assert.ok(!JSON.stringify(x).includes('private-old-incomplete'));
  }
});
test('a newly localized old-window eviction does not break an already admitted active run', () => {
  const e = new CodexAccountEstimator(), oldReset = T - 10 * M;
  const old = [{ ...base(T - 30 * M, 10, 'private-evicted'), resetAt: oldReset },
    { ...point(T - 20 * M, 20, 9000, 'private-evicted', 1, T - 30 * M), resetAt: oldReset }];
  const rows = [...initial(), ...old];
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows), 'v1')!.usedEquivalentUsd, 20);
  const activeRows = rows.filter(row => row.resetAt === R);
  activeRows.push(point(T + 2 * M - 1000, 40, 1400));
  const next = { ...inputs(T + 2 * M, 40, activeRows), codexQuotaCheckpointsComplete: false,
    codexQuotaIncompleteResets: [oldReset],
    codexQuotaIncompleteRanges: [{ from: T - 30 * M, through: T - 20 * M, resetAt: oldReset }] };
  const x = e.observe(sample(T + 2 * M, 40), next, 'v1')!;
  assert.equal(x.usedEquivalentUsd, 40);
  assert.equal(x.calibrationEvidence!.accumulated.intervals, 2);
});
test('an incomplete reset within the active five-minute cluster withholds even when the global flag says complete', () => {
  for (const complete of [false, true]) for (const reset of [R - 300_000, R, R + 300_000]) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
    rows.push(point(T + M - 1000, 30, 1200));
    const next = { ...inputs(T + M, 30, rows, 120), codexQuotaCheckpointsComplete: complete,
      codexQuotaIncompleteResets: [reset] };
    assert.equal(e.observe(sample(T + M, 30), next, 'v1'), undefined);
  }
});
test('localized omissions cannot override an incomplete active checkpoint or missing global authority', () => {
  for (const mode of ['active-row', 'missing-flag', 'invalid-reset', 'unknown-resets'] as const) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
    const end = point(T + M - 1000, 30, 1200);
    const next: WeeklyValueInputs = { ...inputs(T + M, 30, [...rows, end], 120),
      codexQuotaCheckpointsComplete: false, codexQuotaIncompleteResets: [R - 604_800_000] };
    if (mode === 'active-row') end.complete = false;
    if (mode === 'missing-flag') delete next.codexQuotaCheckpointsComplete;
    if (mode === 'invalid-reset') next.codexQuotaIncompleteResets = [NaN];
    if (mode === 'unknown-resets') delete next.codexQuotaIncompleteResets;
    assert.equal(e.observe(sample(T + M, 30), next, 'v1'), undefined, mode);
  }
});
test('v2 baseline-line tokens remain outside official calibration until a fresh baseline is established', () => {
  const e = new CodexAccountEstimator(), rows = initial(), from = T + M - 1000;
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 2000, 30, 1200), { ...base(from, 30, 'private-new-v2'),
    baselineByModel: { 'gpt-5': { inputTotal: 0, outputTotal: 9000 } } });
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows, 120), 'v1'), undefined);
  rows.push(point(T + 2 * M - 2000, 40, 1400), point(T + 2 * M - 1000, 40, 100, 'private-new-v2', 1, from));
  assert.equal(e.observe(sample(T + 2 * M, 40), inputs(T + 2 * M, 40, rows, 140), 'v1')!.usedEquivalentUsd, 30);
});
test('old same-reset missing ranges and static incomplete segments do not veto a fresh exact official interval', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  rows.push({ ...base(T - 30 * M, 5, 'private-static-gap'), complete: false },
    { ...point(T - 20 * M, 10, 9000, 'private-static-gap', 1, T - 30 * M), complete: false });
  const ranges = [{ from: T - 30 * M, through: T - 20 * M, resetAt: R }];
  const scoped = (t: number, p: number) => ({ ...ranged(t, p, rows, ranges), codexQuotaIncompleteResets: [R] });
  e.observe(sample(T, 20), scoped(T, 20), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  const x = e.observe(sample(T + M, 30), scoped(T + M, 30), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 20); assert.equal(x.fullEquivalentUsd, 200);
  assert.equal(x.calibrationEvidence!.interval.linkedSources, 1);
  assert.ok(x.flags.includes('account-unattributed'));
});
test('overlapping missing ranges withhold only their official interval and preserve prior admitted sums', () => {
  for (const resetAt of [undefined, R, R + 300_000]) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), ranged(T, 20, rows, []), 'v1');
    rows.push(point(T + M - 1000, 30, 1200));
    assert.equal(e.observe(sample(T + M, 30), ranged(T + M, 30, rows, []), 'v1')!.usedEquivalentUsd, 20);
    const ranges = [{ from: T + M + 100, through: T + 2 * M - 100, ...(resetAt === undefined ? {} : { resetAt }) }];
    rows.push(point(T + 2 * M - 1000, 40, 1400));
    assert.equal(e.observe(sample(T + 2 * M, 40), ranged(T + 2 * M, 40, rows, ranges), 'v1'), undefined);
    rows.push(point(T + 3 * M - 1000, 50, 1600));
    const x = e.observe(sample(T + 3 * M, 50), ranged(T + 3 * M, 50, rows, ranges), 'v1')!;
    assert.equal(x.usedEquivalentUsd, 40); assert.equal(x.calibrationEvidence!.accumulated.intervals, 2);
    assert.equal(x.calibrationEvidence!.accumulated.deltaPercent, 20);
    assert.equal(x.calibrationEvidence!.interval.from, T + 2 * M);
  }
});
test('range checks use the monetary baseline during unchanged percentages and establish a fresh baseline after a gap', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), ranged(T, 20, rows, []), 'v1');
  const ranges = [{ from: T + 100, through: T + M - 100, resetAt: R }];
  rows.push(point(T + M - 1000, 20, 1100));
  assert.equal(e.observe(sample(T + M, 20), ranged(T + M, 20, rows, ranges), 'v1'), undefined);
  rows.push(point(T + 2 * M - 1000, 30, 1300));
  const x = e.observe(sample(T + 2 * M, 30), ranged(T + 2 * M, 30, rows, ranges), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 20); assert.equal(x.calibrationStart, T + M);
});
test('range time and reset boundaries apply to (official baseline, official sample]', () => {
  for (const range of [{ from: T - M, through: T, resetAt: R },
    { from: T + M + 1, through: T + 2 * M, resetAt: R },
    { from: T + 100, through: T + M - 100, resetAt: R + 300_001 }]) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), ranged(T, 20, rows, [range]), 'v1');
    rows.push(point(T + M - 1000, 30, 1200));
    assert.equal(e.observe(sample(T + M, 30), ranged(T + M, 30, rows, [range]), 'v1')!.usedEquivalentUsd, 20);
  }
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), ranged(T, 20, rows, []), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  assert.equal(e.observe(sample(T + M, 30), ranged(T + M, 30, rows,
    [{ from: T + M, through: T + M }]), 'v1'), undefined);
});
test('unlocalized or unverified precise scope stays closed even with an empty coarse reset list', () => {
  for (const mode of ['undefined-ranges', 'unverified-index', 'missing-global-flag'] as const) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
    rows.push(point(T + M - 1000, 30, 1200));
    const next: WeeklyValueInputs & { codexQuotaIncompleteRanges?: readonly IncompleteRange[] } = {
      ...ranged(T + M, 30, rows, []), codexQuotaIncompleteResets: [] };
    if (mode === 'undefined-ranges') delete next.codexQuotaIncompleteRanges;
    if (mode === 'unverified-index') next.localHistoryComplete = false;
    if (mode === 'missing-global-flag') delete next.codexQuotaCheckpointsComplete;
    assert.equal(e.observe(sample(T + M, 30), next, 'v1'), undefined, mode);
  }
});
test('range authority does not bypass active ambiguous-source or unknown new-baseline guards', () => {
  for (const complete of [false, true]) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), ranged(T, 20, rows, []), 'v1');
    rows.push(point(T + M - 1000, 30, 1200), { ...base(T + M - 2000, 25, 'private-active-ambiguous'), complete });
    const next = { ...ranged(T + M, 30, rows, []),
      calibrationSourceScope: { verified: true, excludedSourceKeys: ['private-active-ambiguous'] } };
    assert.equal(e.observe(sample(T + M, 30), next, 'v1'), undefined);
  }
});
test('same-reset incomplete groups cannot restart their counters without a new segment', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), ranged(T, 20, rows, []), 'v1');
  rows.push({ ...point(T + M - 1000, 30, 1200), complete: false });
  assert.equal(e.observe(sample(T + M, 30), ranged(T + M, 30, rows, []), 'v1'), undefined);
  rows.push(point(T + 2 * M - 1000, 40, 1400));
  assert.equal(e.observe(sample(T + 2 * M, 40), ranged(T + 2 * M, 40, rows, []), 'v1'), undefined);
});
test('an incomplete newer segment still retires the earlier source segment', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  e.observe(sample(T, 20), ranged(T, 20, rows, []), 'v1');
  rows.push({ ...base(T + M - 1000, 30, 'private-own-source', 2), complete: false });
  assert.equal(e.observe(sample(T + M, 30), ranged(T + M, 30, rows, []), 'v1'), undefined);
  rows.push(point(T + 2 * M - 1000, 40, 1400));
  assert.equal(e.observe(sample(T + 2 * M, 40), ranged(T + 2 * M, 40, rows, []), 'v1'), undefined);
});
test('retained historical checkpoint volume cannot exhaust the active official converter below the provider budget', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  for (let i = 0; i < 4200; i++) rows.push({ ...base(T - 2 * 86_400_000, 5, 'private-old-' + i), resetAt: R - 604_800_000 });
  const ranges = [{ from: T - 3 * 86_400_000, through: T - 2 * 86_400_000 }];
  e.observe(sample(T, 20), ranged(T, 20, rows, ranges), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  assert.equal(e.observe(sample(T + M, 30), ranged(T + M, 30, rows, ranges), 'v1')!.usedEquivalentUsd, 20);
});
test('new historical flags on a static same-reset source do not erase or bridge active increments', () => {
  const e = new CodexAccountEstimator(), rows = initial();
  const old = [base(T - 30 * M, 5, 'private-later-flagged'),
    point(T - 20 * M, 10, 9000, 'private-later-flagged', 1, T - 30 * M)];
  rows.push(...old);
  e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  assert.equal(e.observe(sample(T + M, 30), inputs(T + M, 30, rows, 120), 'v1')!.usedEquivalentUsd, 20);
  for (const row of old) row.complete = false;
  rows.push(point(T + 2 * M - 1000, 40, 1400));
  const x = e.observe(sample(T + 2 * M, 40), ranged(T + 2 * M, 40, rows,
    [{ from: T - 30 * M, through: T - 20 * M, resetAt: R }]), 'v1')!;
  assert.equal(x.usedEquivalentUsd, 40); assert.equal(x.calibrationEvidence!.accumulated.intervals, 2);
});
test('malformed numeric gap ranges cannot certify an otherwise complete interval', () => {
  for (const range of [{ from: NaN, through: T - M }, { from: T + M, through: T },
    { from: T - M, through: T, resetAt: -1 }]) {
    const e = new CodexAccountEstimator(), rows = initial();
    e.observe(sample(T, 20), inputs(T, 20, rows), 'v1');
    rows.push(point(T + M - 1000, 30, 1200));
    const next = { ...ranged(T + M, 30, rows, [range]), codexQuotaCheckpointsComplete: true };
    assert.equal(e.observe(sample(T + M, 30), next, 'v1'), undefined);
  }
});
test('numeric unknown-prefix and open-tail sentinels are bounds, not fabricated observation times', () => {
  const e = new CodexAccountEstimator(), rows = initial(), oldPrefix = [{ from: 0, through: T, resetAt: R }];
  e.observe(sample(T, 20), ranged(T, 20, rows, oldPrefix), 'v1');
  rows.push(point(T + M - 1000, 30, 1200));
  assert.equal(e.observe(sample(T + M, 30), ranged(T + M, 30, rows, oldPrefix), 'v1')!.usedEquivalentUsd, 20);
  const openTail = [{ from: T + M + 100, through: Number.MAX_SAFE_INTEGER }];
  rows.push(point(T + 2 * M - 1000, 40, 1400));
  assert.equal(e.observe(sample(T + 2 * M, 40), ranged(T + 2 * M, 40, rows, openTail), 'v1'), undefined);
  rows.push(point(T + 3 * M - 1000, 50, 1600));
  assert.equal(e.observe(sample(T + 3 * M, 50), ranged(T + 3 * M, 50, rows, openTail), 'v1'), undefined);
});
