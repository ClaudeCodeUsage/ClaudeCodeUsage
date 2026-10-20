import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexWindowEvidence, codexCalibrationPricingVersion, copyCodexWindowEvidence,
  codexWindowEvidenceFits } from '../codexWindowEvidence';
import { CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT } from '../providers/codex/codexQuotaCheckpoints';

const T = Date.parse('2026-10-19T02:00Z'), M = 60_000, R = T + 6 * 86_400_000;
function evidence(extra: Partial<CodexWindowEvidence> = {}): CodexWindowEvidence {
  return { schemaVersion: 1, methodVersion: 1, from: T, through: T + M, calibratedThrough: T + M,
    percentFrom: 20, percentThrough: 50, deltaPercent: 30, deltaUsd: 210,
    pricedTokens: 210_000, totalTokens: 210_000, intervals: 1, sources: 1, excludedUsd: 0,
    skippedIntervals: 0, skippedUsd: 0, complete: true,
    pricebook: { schemaVersion: 1, parserVersion: 5, periodVersion: 1,
      rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] },
    cycle: { id: T, startAt: null, startLowerAt: null, endAt: R, endLowerAt: R,
      closed: false, scheduledResetAt: R, boundaryUncertain: true, referenceOnly: false }, ...extra };
}
function receipt(e = evidence(), full: number | null = 700) {
  return { observedAt: e.through, utilizationPercent: e.percentThrough, usedEquivalentUsd: e.deltaUsd,
    fullEquivalentUsd: full, unusedEquivalentUsd: full === null ? null : full * (1 - e.percentThrough / 100),
    pricingCoverage: e.totalTokens > 0 ? e.pricedTokens / e.totalTokens : 0 };
}

test('paired receipts round-trip without aliases and permit switch gaps and extra contributing sources', () => {
  const e = evidence({ percentThrough: 63, deltaPercent: 40, deltaUsd: 280,
    pricedTokens: 280_000, totalTokens: 280_000, intervals: 2, sources: 3 });
  const copied = copyCodexWindowEvidence(e)!;
  assert.deepEqual(copied, e); assert.notEqual(copied.pricebook, e.pricebook);
  assert.notEqual(copied.pricebook.rates, e.pricebook.rates); assert.notEqual(copied.cycle, e.cycle);
  assert.ok(codexWindowEvidenceFits(copied, receipt(e)));
});

test('the reported zero-interval, zero-token, reversed-percentage capacity forgery is rejected', () => {
  const forged = evidence({ percentFrom: 90, intervals: 0, sources: 0, pricedTokens: 0, totalTokens: 0 });
  assert.equal(copyCodexWindowEvidence(forged), undefined);
  assert.equal(codexWindowEvidenceFits(forged, receipt(forged)), false);
});

test('scalar interval and source counts accept the bounded checkpoint projection, not just 4096 pairs', () => {
  const cap = CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT;
  assert.equal(cap, 65_536);
  for (const extra of [{ intervals: 4097 }, { intervals: 48_000 }, { intervals: cap }, { sources: cap }]) {
    const e = evidence(extra);
    assert.ok(copyCodexWindowEvidence(e), JSON.stringify(extra));
    assert.ok(codexWindowEvidenceFits(e, receipt(e)), JSON.stringify(extra));
  }
  for (const extra of [{ intervals: cap + 1 }, { sources: cap + 1 }, { intervals: cap - .5 }, { sources: cap - .5 }]) {
    const e = evidence(extra);
    assert.equal(copyCodexWindowEvidence(e), undefined);
    assert.equal(codexWindowEvidenceFits(e, receipt(e)), false);
  }
});

test('legacy method-one receipts default absent skipped diagnostics to fixed numeric zeros', () => {
  const legacy = evidence(); delete legacy.skippedIntervals; delete legacy.skippedUsd;
  const copied = copyCodexWindowEvidence(legacy)!;
  assert.equal(copied.skippedIntervals, 0); assert.equal(copied.skippedUsd, 0);
  assert.ok(codexWindowEvidenceFits(legacy, receipt(legacy)));
  assert.deepEqual(copyCodexWindowEvidence(copied), copied);
});

test('whole skipped components do not contaminate complete admitted proof or its capacity', () => {
  const e = evidence({ skippedIntervals: 65_536, skippedUsd: 1e12 });
  assert.deepEqual(copyCodexWindowEvidence(e), e);
  assert.ok(codexWindowEvidenceFits(e, receipt(e)), 'skipped diagnostics do not enter dollars, coverage or percentage span');
  assert.equal(codexWindowEvidenceFits(e, { ...receipt(e), usedEquivalentUsd: e.deltaUsd + e.skippedUsd! }), false);
  const inflated = (e.deltaUsd + e.skippedUsd!) / (e.deltaPercent / 100);
  assert.equal(codexWindowEvidenceFits(e, receipt(e, inflated)), false);
  assert.equal(codexWindowEvidenceFits({ ...e, complete: false }, receipt(e)), false);
  assert.equal(codexWindowEvidenceFits({ ...e, excludedUsd: 1 }, receipt(e)), false,
    'whole-component skips must not weaken the exclusion check within admitted proof');
});

test('skipped diagnostics are independently optional, bounded and fixed-field only', () => {
  for (const extra of [{ skippedIntervals: 1, skippedUsd: undefined }, { skippedIntervals: undefined, skippedUsd: .000123 }]) {
    const e = evidence(extra), copied = copyCodexWindowEvidence(e)!;
    assert.equal(copied.skippedIntervals, extra.skippedIntervals ?? 0);
    assert.equal(copied.skippedUsd, extra.skippedUsd ?? 0);
    assert.ok(codexWindowEvidenceFits(e, receipt(e)));
  }
  const e = evidence({ skippedIntervals: 1, skippedUsd: 50 });
  const copied = copyCodexWindowEvidence({ ...e, skippedSourceKey: 'private-source-canary' })!;
  assert.deepEqual(copied, e); assert.ok(!JSON.stringify(copied).includes('private-source-canary'));
  for (const extra of [{ skippedIntervals: -1 }, { skippedIntervals: .5 }, { skippedIntervals: 65_537 },
    { skippedIntervals: Infinity }, { skippedIntervals: NaN }, { skippedIntervals: null }, { skippedIntervals: '1' },
    { skippedUsd: -1 }, { skippedUsd: 1e12 + 1 }, { skippedUsd: Infinity }, { skippedUsd: NaN },
    { skippedUsd: null }, { skippedUsd: '1' }]) {
    const invalid = { ...e, ...extra };
    assert.equal(copyCodexWindowEvidence(invalid), undefined);
    assert.equal(codexWindowEvidenceFits(invalid as CodexWindowEvidence, receipt(e)), false);
  }
});

test('all-skipped attempts can retain a pending latest fact without any admitted calibration', () => {
  const e = evidence({ from: T + M, calibratedThrough: T + M, percentFrom: 50, percentThrough: 50,
    deltaPercent: 0, deltaUsd: 0, pricedTokens: 0, totalTokens: 0, intervals: 0, sources: 0,
    skippedIntervals: 10, skippedUsd: 210, complete: false });
  assert.deepEqual(copyCodexWindowEvidence(e), e);
  assert.ok(codexWindowEvidenceFits(e, receipt(e, null)));
  assert.equal(codexWindowEvidenceFits(e, receipt(e)), false);
});

const invalidEvidence: Array<[string, Partial<CodexWindowEvidence>]> = [
  ['reversed percentages', { percentFrom: 90 }],
  ['delta exceeds the observed positive span', { deltaPercent: 31 }],
  ['nonfinite percentage', { deltaPercent: NaN }],
  ['nonfinite dollars', { deltaUsd: Infinity }],
  ['positive calibration without intervals', { intervals: 0 }],
  ['positive calibration without sources', { sources: 0 }],
  ['positive dollars without tokens', { pricedTokens: 0, totalTokens: 0 }],
  ['positive dollars without priced tokens', { pricedTokens: 0 }],
  ['fractional token counts', { pricedTokens: 209_999.5 }],
  ['zero-delta positive calibration', { percentFrom: 50, deltaPercent: 0 }],
  ['calibration after the observation', { calibratedThrough: T + 2 * M }],
  ['calibration before its start', { calibratedThrough: T - M }],
  ['positive calibration with no time interval', { calibratedThrough: T }],
  ['priced tokens without a model price', { pricebook: { ...evidence().pricebook, rates: [] } }],
  ['dollars above every retained model rate', { deltaUsd: 421 }],
  ['dollars below every retained model rate', { deltaUsd: 20 }],
];
for (const [name, extra] of invalidEvidence) test(`receipt rejects ${name}`, () => {
  const e = evidence(extra);
  assert.equal(copyCodexWindowEvidence(e), undefined);
  assert.equal(codexWindowEvidenceFits(e, receipt(e)), false, 'fits also rejects unchecked evidence');
});

test('model-price validation rejects duplicate models and positive dollars under zero rates', () => {
  const e = evidence(), rate = e.pricebook.rates[0];
  for (const rates of [[rate, rate], [{ ...rate, input: 0, cachedInput: 0, output: 0 }]]) {
    const bad = evidence({ pricebook: { ...e.pricebook, rates } });
    assert.equal(copyCodexWindowEvidence(bad), undefined);
    assert.equal(codexWindowEvidenceFits(bad, receipt(bad)), false);
  }
});

test('finite fractional deltas retain their precision, including floating-point subtraction roundoff', () => {
  for (const e of [evidence({ percentFrom: .1, percentThrough: .3, deltaPercent: .2 }),
    evidence({ percentFrom: 20, percentThrough: 20.000001, deltaPercent: .000000123456789 })]) {
    assert.equal(copyCodexWindowEvidence(e)?.deltaPercent, e.deltaPercent);
    assert.ok(codexWindowEvidenceFits(e, receipt(e, null)), 'tiny samples may remain pending');
    assert.equal(codexWindowEvidenceFits(e, receipt(e)), false, 'tiny samples cannot price capacity');
  }
});

test('a zero-sample pending receipt has zero delta and no capacity', () => {
  const e = evidence({ calibratedThrough: T, percentThrough: 20, deltaPercent: 0, deltaUsd: 0,
    pricedTokens: 0, totalTokens: 0, intervals: 0, sources: 1 });
  assert.ok(copyCodexWindowEvidence(e)); assert.ok(codexWindowEvidenceFits(e, receipt(e, null)));
  assert.equal(codexWindowEvidenceFits(e, receipt(e, 0)), false);
  assert.equal(codexWindowEvidenceFits(e, receipt(e, 700)), false);
  for (const extra of [{ deltaPercent: 1, percentThrough: 21 }, { deltaUsd: 1 },
    { pricedTokens: 1, totalTokens: 1 }, { calibratedThrough: T + M }]) {
    assert.equal(copyCodexWindowEvidence({ ...e, ...extra }), undefined);
  }
});

test('contradictory-source admission can be withdrawn while retaining the latest fact and rejected dollars', () => {
  const e = evidence({ from: T + M, calibratedThrough: T + M, percentFrom: 50, percentThrough: 50,
    deltaPercent: 0, deltaUsd: 0, pricedTokens: 0, totalTokens: 0, intervals: 0, sources: 0,
    excludedUsd: 210, complete: false });
  assert.deepEqual(copyCodexWindowEvidence(e), e);
  const pending = { ...receipt(e, null), flags: ['partial-history', 'counter-change'] };
  assert.ok(codexWindowEvidenceFits(e, pending));
  assert.equal(codexWindowEvidenceFits(e, { ...pending, usedEquivalentUsd: e.excludedUsd }), false);
  assert.equal(codexWindowEvidenceFits(e, { ...pending, fullEquivalentUsd: 700, unusedEquivalentUsd: 350 }), false);
  assert.equal(codexWindowEvidenceFits(e, { ...pending, pricingCoverage: 1 }), false);
});

test('incomplete, unpriced, zero-rate and quota-only evidence may stay pending without inventing capacity', () => {
  const base = evidence(), zero = { ...base.pricebook.rates[0], input: 0, cachedInput: 0, output: 0 };
  for (const e of [evidence({ complete: false }), evidence({ excludedUsd: 10 }),
    evidence({ pricedTokens: 100_000, deltaUsd: 100 }),
    evidence({ deltaUsd: 0, pricedTokens: 0, totalTokens: 100_000, complete: false,
      pricebook: { ...base.pricebook, rates: [] } }),
    evidence({ deltaUsd: 0, pricedTokens: 0, totalTokens: 0, complete: false }),
    evidence({ deltaUsd: 0, pricebook: { ...base.pricebook, rates: [zero] } })]) {
    assert.ok(copyCodexWindowEvidence(e)); assert.ok(codexWindowEvidenceFits(e, receipt(e, null)));
    assert.equal(codexWindowEvidenceFits(e, receipt(e)), false);
  }
});

test('receipt fit matches finite amounts, coverage and observation fields', () => {
  const e = evidence(), base = receipt(e);
  for (const extra of [{ observedAt: T }, { utilizationPercent: 51 }, { usedEquivalentUsd: 209 },
    { usedEquivalentUsd: NaN }, { fullEquivalentUsd: Infinity }, { fullEquivalentUsd: 0 },
    { unusedEquivalentUsd: 351 }, { unusedEquivalentUsd: Infinity }, { unusedEquivalentUsd: null },
    { pricingCoverage: .5 }, { pricingCoverage: NaN }, { pricingCoverage: Infinity }]) {
    assert.equal(codexWindowEvidenceFits(e, { ...base, ...extra }), false, JSON.stringify(extra));
  }
  assert.equal(codexWindowEvidenceFits(e, { ...receipt(e, null), unusedEquivalentUsd: 0 }), false);
  assert.equal(codexWindowEvidenceFits(e, { ...receipt(e, null), pricingCoverage: .5 }), false);
});

test('explicit book revision and partial-numerator claims cannot contradict a full receipt', () => {
  const e = evidence(), base = receipt(e), version = codexCalibrationPricingVersion(e.pricebook);
  assert.ok(codexWindowEvidenceFits(e, { ...base, pricingVersion: version }));
  assert.ok(codexWindowEvidenceFits(e, { ...base, pricingVersion: 'openai-v1' }), 'legacy generic revision');
  const changed = { ...e.pricebook, rates: [{ ...e.pricebook.rates[0], input: .0015 }] };
  assert.equal(codexWindowEvidenceFits(e, { ...base, pricingVersion: codexCalibrationPricingVersion(changed) }), false);
  for (const extra of [{ flags: ['partial-history'] }, { flags: ['partial-pricing'] }, { unlinkedEquivalentUsd: 1 }]) {
    assert.equal(codexWindowEvidenceFits(e, { ...base, ...extra }), false);
    assert.ok(codexWindowEvidenceFits(e, { ...receipt(e, null), ...extra }));
  }
});
