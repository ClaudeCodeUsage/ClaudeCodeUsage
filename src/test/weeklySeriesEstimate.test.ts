import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildLocalWeeklyEstimates, weeklyEstimateForPoint } from '../weeklyEstimate';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
import type { WeeklyEquivalentUsage, WeeklyQuotaObservation, WeeklyValueInputs, WeeklyValuePoint } from '../weeklyValue';

const DAY = 86_400_000, HOUR = 3_600_000;
const RESET = 1_800_000_000_000, AT = RESET - DAY;
function observation(sourceKey: string | undefined, overrides: Partial<WeeklyQuotaObservation> = {}): WeeklyQuotaObservation {
  return { provider: 'codex', seriesKey: 'codex', sourceKey, resetAt: RESET, observedAt: AT, usedPercent: 10, ...overrides };
}
function usage(sourceKey: string | undefined, equivalentUsd: number, overrides: Partial<WeeklyEquivalentUsage> = {}): WeeklyEquivalentUsage {
  return { sourceKey, timestamp: AT - 1000, equivalentUsd, pricedTokens: 100, totalTokens: 100, ...overrides };
}
function pair(): WeeklyValueInputs {
  return { observations: [observation('file-a'), observation('file-b', { resetAt: RESET + DAY, usedPercent: 3 })],
    usage: [usage('file-a', 25), usage('file-b', 120)] };
}

test('own-source prefixes yield A 25/10%=250 with 225 unused and B 120/3%=4000, never the mixed 1450', () => {
  const input = pair(), before = JSON.stringify(input);
  const rows = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 });
  const a = rows.find(row => row.resetAt === RESET)!;
  const b = rows.find(row => row.resetAt === RESET + DAY)!;
  assert.equal(a.method, 'series-prefix-v1');
  assert.equal(a.usedEquivalentUsd, 25); assert.equal(a.fullEquivalentUsd, 250); assert.equal(a.unusedEquivalentUsd, 225);
  assert.equal(b.usedEquivalentUsd, 120); assert.equal(b.fullEquivalentUsd, 4000); assert.equal(b.unusedEquivalentUsd, 3880);
  assert.notEqual(a.fullEquivalentUsd, 1450);
  assert.equal(a.linkedSourceCount, 1); assert.equal(a.unlinkedEquivalentUsd, 120);
  assert.equal(b.linkedSourceCount, 1); assert.equal(b.unlinkedEquivalentUsd, 25);
  assert.ok(rows.every(row => row.flags.includes('account-unattributed')));
  assert.equal(JSON.stringify(input), before);
  assert.doesNotMatch(JSON.stringify(rows), /file-a|file-b|sourceKey|accountScopeKey|accountNumber/);
});

test('multiple sessions reporting one reset/series/window aggregate into one estimate', () => {
  const input = { observations: [observation('one', { observedAt: AT - 100 }), observation('two')],
    usage: [usage('one', 10), usage('two', 15)] };
  const rows = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 });
  assert.equal(rows.length, 1); assert.equal(rows[0].linkedSourceCount, 2);
  assert.equal(rows[0].fullEquivalentUsd, 250); assert.equal(rows[0].unlinkedEquivalentUsd, 0);
});

test('different series and explicit windows stay separate even when reset timestamps match', () => {
  for (const distinction of [{ seriesKey: 'other-counter' }, { windowId: 'other-window' }]) {
    const input = pair(); input.observations[1] = observation('file-b', { ...distinction, usedPercent: 3 });
    const rows = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 });
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.utilizationPercent === 10)!.fullEquivalentUsd, 250);
    assert.equal(rows.find(row => row.utilizationPercent === 3)!.fullEquivalentUsd, 4000);
  }
});

test('unsampled and missing-source usage is excluded and revealed rather than added to concurrent series', () => {
  const input = pair(); input.usage.push(usage('unsampled', 7), usage(undefined, 8));
  const rows = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 });
  const a = rows.find(row => row.resetAt === RESET)!;
  assert.equal(a.usedEquivalentUsd, 25); assert.equal(a.unlinkedEquivalentUsd, 135);
  assert.equal(a.linkedSourceCount, 1); assert.ok(a.flags.includes('partial-history'));
});

test('a daily source spanning two quota groups is not assigned wholesale or counted in both numerators', () => {
  const input = pair();
  input.observations.push(observation('spanning'), observation('spanning', { resetAt: RESET + DAY, usedPercent: 3, observedAt: AT + HOUR }));
  input.usage.push(usage('spanning', 60, { timestamp: AT + HOUR, intervalStart: AT - HOUR, intervalEnd: AT + HOUR }));
  const rows = buildLocalWeeklyEstimates('codex', input, { now: AT + HOUR + 1 });
  const a = rows.find(row => row.resetAt === RESET)!;
  const b = rows.find(row => row.resetAt === RESET + DAY)!;
  assert.equal(a.usedEquivalentUsd, 25); assert.equal(b.usedEquivalentUsd, 120);
  assert.equal(a.unlinkedEquivalentUsd, 150); assert.equal(b.unlinkedEquivalentUsd, 85);
  assert.equal(a.linkedSourceCount, 1); assert.equal(b.linkedSourceCount, 1);
  assert.ok(rows.every(row => row.flags.includes('partial-history') && row.flags.includes('boundary-uncertain')));
});

test('a source observed only in an unrelated old reset does not contaminate current source membership', () => {
  const input: WeeklyValueInputs = { observations: [observation('reused', { resetAt: RESET - 7 * DAY, observedAt: AT - 7 * DAY }), observation('reused')],
    usage: [usage('reused', 25)] };
  const current = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 }).find(row => row.resetAt === RESET)!;
  assert.equal(current.fullEquivalentUsd, 250); assert.equal(current.linkedSourceCount, 1);
});

test('membership considers groups omitted by the display cap', () => {
  const input = pair(); input.observations.forEach(row => { row.sourceKey = 'spanning'; });
  input.usage = [usage('spanning', 145)];
  const [only] = buildLocalWeeklyEstimates('codex', input, { now: AT + 1, limit: 1 });
  assert.equal(only.usedEquivalentUsd, 0); assert.equal(only.fullEquivalentUsd, null);
  assert.equal(only.unlinkedEquivalentUsd, 145); assert.equal(only.linkedSourceCount, 0);
});

test('entirely source-less legacy history stays rough and explicitly unassigned; Claude behavior is unchanged', () => {
  const legacy: WeeklyValueInputs = { observations: [observation(undefined)], usage: [usage(undefined, 25), usage(undefined, 120)] };
  const [old] = buildLocalWeeklyEstimates('codex', legacy, { now: AT + 1 });
  assert.equal(old.method, 'rough-prefix-v2'); assert.equal(old.fullEquivalentUsd, 1450);
  assert.ok(old.flags.includes('account-unattributed')); assert.equal(old.linkedSourceCount, 0);
  assert.equal(old.unlinkedEquivalentUsd, 145);
  const claude = pair(); claude.observations.forEach(row => { row.provider = 'claude'; });
  const rows = buildLocalWeeklyEstimates('claude', claude, { now: AT + 1 });
  assert.equal(rows.find(row => row.resetAt === RESET)!.fullEquivalentUsd, 1450);
  assert.ok(rows.every(row => row.method === 'rough-prefix-v2' && row.linkedSourceCount === undefined));
});

test('linked invalid counts still withdraw conversion; malformed foreign usage cannot poison another group', () => {
  const invalid = pair(); invalid.usage[0].pricedTokens = 0; invalid.usage[0].totalTokens = 0;
  assert.equal(buildLocalWeeklyEstimates('codex', invalid, { now: AT + 1 }).find(row => row.resetAt === RESET)!.fullEquivalentUsd, null);
  invalid.usage[0] = usage('file-a', 25); invalid.usage[1].pricedTokens = NaN;
  const a = buildLocalWeeklyEstimates('codex', invalid, { now: AT + 1 }).find(row => row.resetAt === RESET)!;
  assert.equal(a.fullEquivalentUsd, 250);
});

test('linked partial pricing remains labelled and an entirely unlinked numerator stays unknown', () => {
  const input = pair(); input.usage[0].pricedTokens = 50;
  const a = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 }).find(row => row.resetAt === RESET)!;
  assert.equal(a.fullEquivalentUsd, 250); assert.equal(a.pricingCoverage, .5); assert.ok(a.flags.includes('partial-pricing'));
  const [unknown] = buildLocalWeeklyEstimates('codex', { observations: [observation('missing')], usage: [usage('other', 80)] }, { now: AT + 1 });
  assert.equal(unknown.fullEquivalentUsd, null); assert.equal(unknown.unusedEquivalentUsd, null);
  assert.equal(unknown.usedEquivalentUsd, 0); assert.equal(unknown.unlinkedEquivalentUsd, 80);
});

test('source-linked saturation freezes at the first 100% sample and counter regressions retain segment boundaries', () => {
  const saturated: WeeklyValueInputs = { observations: [observation('one', { observedAt: AT - 100, usedPercent: 100 }), observation('one', { usedPercent: 100 })],
    usage: [usage('one', 25, { timestamp: AT - 200 }), usage('one', 100, { timestamp: AT - 50 })] };
  const [full] = buildLocalWeeklyEstimates('codex', saturated, { now: AT + 1 });
  assert.equal(full.observedAt, AT - 100); assert.equal(full.fullEquivalentUsd, 25); assert.equal(full.unusedEquivalentUsd, 0);
  const regressed: WeeklyValueInputs = { observations: [observation('one', { observedAt: AT - 100, usedPercent: 80 }), observation('one')],
    usage: [usage('one', 25, { timestamp: AT - 200 }), usage('one', 5, { timestamp: AT - 50 })] };
  const [tail] = buildLocalWeeklyEstimates('codex', regressed, { now: AT + 1 });
  assert.equal(tail.usedEquivalentUsd, 5); assert.equal(tail.fullEquivalentUsd, 50);
  assert.equal(tail.calibrationStart, AT - 100); assert.ok(tail.flags.includes('counter-change'));
});

test('another session newer sample cannot extend this source own recorded prefix', () => {
  const input: WeeklyValueInputs = { observations: [observation('older-source', { observedAt: AT - 100 }), observation('current-source')],
    usage: [usage('older-source', 25, { timestamp: AT - 50 }), usage('current-source', 5, { timestamp: AT - 50 })] };
  const [entry] = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 });
  assert.equal(entry.usedEquivalentUsd, 5); assert.equal(entry.fullEquivalentUsd, 50);
  assert.equal(entry.unlinkedEquivalentUsd, 25); assert.equal(entry.linkedSourceCount, 1);
});

test('invalid or future own-source quota samples never authorize that source usage', () => {
  for (const invalid of [{ usedPercent: NaN }, { usedPercent: 101 }, { observedAt: AT + 2 }]) {
    const input = pair(); input.observations[1] = observation('file-b', { resetAt: RESET + DAY, ...invalid });
    const [entry] = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 });
    assert.equal(entry.usedEquivalentUsd, 25); assert.equal(entry.fullEquivalentUsd, 250);
    assert.equal(entry.unlinkedEquivalentUsd, 120);
  }
});

test('series estimates preserve the 64-row hard cap and caller lower display limit', () => {
  const input: WeeklyValueInputs = { observations: [], usage: [] };
  for (let i = 0; i < 70; i++) {
    const at = AT - i * 7 * DAY;
    input.observations.push(observation(`source-${i}`, { resetAt: RESET - i * 7 * DAY, observedAt: at }));
    input.usage.push(usage(`source-${i}`, 25, { timestamp: at - 1000 }));
  }
  const capped = buildLocalWeeklyEstimates('codex', input, { now: AT + 1, limit: 100 });
  assert.equal(capped.length, 64);
  assert.ok(capped.every(entry => entry.fullEquivalentUsd === 250 && entry.linkedSourceCount === 1));
  assert.equal(buildLocalWeeklyEstimates('codex', input, { now: AT + 1, limit: 2 }).length, 2);
});

test('unowned grid selection cannot consume an account-scoped or numbered estimate', t => {
  t.mock.method(Date, 'now', () => AT + HOUR);
  const base: LocalWeeklyEstimate = { provider: 'codex', windowStart: RESET - 7 * DAY, resetAt: RESET,
    observedAt: AT, estimatedAt: AT + 1, usedEquivalentUsd: 25, fullEquivalentUsd: 250,
    unusedEquivalentUsd: 225, utilizationPercent: 10, pricingCoverage: 1,
    method: 'series-prefix-v1', flags: ['account-unattributed'] };
  const point = { provider: 'codex', resetAt: RESET, observedAt: AT, utilizationPercent: 10 } as WeeklyValuePoint;
  const scoped: LocalWeeklyEstimate[] = [
    { ...base, accountNumber: 1 }, { ...base, accountScopeKey: 'a'.repeat(64) },
    { ...base, method: 'account-delta-v1' },
  ];
  assert.equal(weeklyEstimateForPoint(point, scoped), undefined);
  assert.strictEqual(weeklyEstimateForPoint(point, [...scoped, base]), base);
  assert.strictEqual(weeklyEstimateForPoint(point, [{ ...base, method: 'rough-prefix-v2', fullEquivalentUsd: 1450 }, base]), base);
});

test('16k synthetic sources with 128k observations and two model rows avoid argument limits and quadratic group reads', t => {
  const fileCount = 16_000, samplesPerFile = 8;
  const input: WeeklyValueInputs = { observations: [], usage: [] };
  let observedAtReads = 0;
  const readBudget = fileCount * samplesPerFile * 128;
  for (let i = 0; i < fileCount; i++) {
    const source = `synthetic-source-${i}`;
    for (let sample = 0; sample < samplesPerFile; sample++) {
      const at = AT - samplesPerFile + sample + 1;
      const row = observation(source, { observedAt: at });
      Object.defineProperty(row, 'observedAt', { enumerable: true, get() {
        if (++observedAtReads > readBudget) throw new Error('synthetic observation read budget exhausted');
        return at;
      } });
      input.observations.push(row);
    }
    input.usage.push(usage(source, .25), usage(source, .75));
  }
  const firstObservation = input.observations[0], lastObservation = input.observations[input.observations.length - 1];
  const firstUsage = input.usage[0], lastUsage = input.usage[input.usage.length - 1];
  const started = performance.now();
  let rows: LocalWeeklyEstimate[] = [];
  assert.doesNotThrow(() => { rows = buildLocalWeeklyEstimates('codex', input, { now: AT + 1 }); });
  const elapsedMs = performance.now() - started;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].usedEquivalentUsd, fileCount);
  assert.equal(rows[0].fullEquivalentUsd, fileCount * 10);
  assert.equal(rows[0].unusedEquivalentUsd, fileCount * 9);
  assert.equal(rows[0].linkedSourceCount, fileCount);
  assert.equal(rows[0].unlinkedEquivalentUsd, 0);
  assert.ok(observedAtReads <= readBudget);
  assert.equal(input.observations.length, fileCount * samplesPerFile);
  assert.equal(input.usage.length, fileCount * 2);
  assert.strictEqual(input.observations[0], firstObservation);
  assert.strictEqual(input.observations[input.observations.length - 1], lastObservation);
  assert.strictEqual(input.usage[0], firstUsage);
  assert.strictEqual(input.usage[input.usage.length - 1], lastUsage);
  t.diagnostic(`Synthetic instrumented input only: ${fileCount} sources, ${input.observations.length} observations, ${input.usage.length} model rows; ${elapsedMs.toFixed(1)} ms, ${observedAtReads} observedAt reads. No timing assertion or real-history claim.`);
});

test('same-interval model rows reuse source evidence while membership cache never survives a projection', () => {
  const input = pair();
  let reads = 0;
  for (const row of input.observations) {
    const at = row.observedAt;
    Object.defineProperty(row, 'observedAt', { enumerable: true, get() { reads++; return at; } });
  }
  // Do not count each model row's normal as-of comparison as a proof read:
  // the group's latest sample is a different, uninstrumented source.
  input.observations.push(observation('anchor-a', { observedAt: AT + 1 }),
    observation('anchor-b', { resetAt: RESET + DAY, usedPercent: 3, observedAt: AT + 1 }));
  const expected = buildLocalWeeklyEstimates('codex', input, { now: AT + 2 });
  const baselineReads = reads;
  const expanded = { ...input, usage: [usage('file-a', 10), usage('file-a', 15), usage('file-b', 60), usage('file-b', 60)] };
  reads = 0;
  const actual = buildLocalWeeklyEstimates('codex', expanded, { now: AT + 2 });
  assert.deepEqual(actual, expected);
  assert.equal(reads, baselineReads, 'duplicated model intervals must not reread their source quota evidence');
  reads = 0;
  assert.deepEqual(buildLocalWeeklyEstimates('codex', expanded, { now: AT + 2 }), expected);
  assert.equal(reads, baselineReads, 'a fresh projection rebuilds evidence rather than retaining old group objects');
});
