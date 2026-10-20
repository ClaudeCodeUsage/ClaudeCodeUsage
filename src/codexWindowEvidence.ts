import { CodexCalibrationPricebook, copyCodexCalibrationPricebook } from './codexCalibrationEvidence';
import { CodexQuotaCycle, copyCodexQuotaCycle } from './codexQuotaCycles';
import { createHash } from 'node:crypto';

/** Frozen numeric evidence; never a session, source or account identifier. */
export interface CodexWindowEvidence {
  schemaVersion: 1;
  methodVersion: 1;
  from: number;
  through: number;
  calibratedThrough: number;
  percentFrom: number;
  percentThrough: number;
  deltaPercent: number;
  deltaUsd: number;
  pricedTokens: number;
  totalTokens: number;
  intervals: number;
  sources: number;
  excludedUsd: number;
  /** Whole rejected attempts: neither their USD nor percentage enters the fit.
   * Absent in older method-one receipts means zero, not a partial numerator. */
  skippedIntervals?: number;
  skippedUsd?: number;
  complete: boolean;
  pricebook: CodexCalibrationPricebook;
  cycle: CodexQuotaCycle;
}
export const CODEX_MIN_CALIBRATION_PERCENT = 5;
/** A fetch timestamp is not a price change. The full sorted book is still
 * retained and compared; this bounded label is only its public revision. */
export function codexCalibrationPricingVersion(book: unknown): string {
  const copy = copyCodexCalibrationPricebook(book);
  if (!copy) return 'openai-v1';
  const digest = createHash('sha256').update(JSON.stringify(copy)).digest('hex');
  const parts = [0, 4, 8, 12].map(at => String(parseInt(digest.slice(at, at + 4), 16) % 10000).padStart(4, '0'));
  return 'openai-v' + parts.join('.');
}
const n = (v: unknown, max = 1e12): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const time = (v: unknown): v is number => n(v, 8.64e15) && Number.isSafeInteger(v) && v > 0;
// Both scalar counts are bounded by the 65,536-row checkpoint projection.
// Baseline-only contributors can make sources exceed paired intervals.
const MAX_CHECKPOINT_ROWS = 65_536;
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-8 * Math.max(Math.abs(a), Math.abs(b));
export function copyCodexWindowEvidence(value: unknown): CodexWindowEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as CodexWindowEvidence, pricebook = copyCodexCalibrationPricebook(v.pricebook), cycle = copyCodexQuotaCycle(v.cycle);
  const skippedIntervals = v.skippedIntervals === undefined ? 0 : v.skippedIntervals;
  const skippedUsd = v.skippedUsd === undefined ? 0 : v.skippedUsd;
  if (v.schemaVersion !== 1 || v.methodVersion !== 1 || !time(v.from) || !time(v.through) || v.through < v.from ||
    !time(v.calibratedThrough) || v.calibratedThrough < v.from || v.calibratedThrough > v.through ||
    !n(v.percentFrom, 100) || !n(v.percentThrough, 100) || !n(v.deltaPercent, 100) ||
    !n(v.deltaUsd) || !n(v.pricedTokens) || !n(v.totalTokens) || v.pricedTokens > v.totalTokens ||
    !Number.isSafeInteger(v.pricedTokens) || !Number.isSafeInteger(v.totalTokens) ||
    !n(v.excludedUsd) || !n(v.intervals, MAX_CHECKPOINT_ROWS) || !Number.isSafeInteger(v.intervals) ||
    !n(skippedIntervals, MAX_CHECKPOINT_ROWS) || !Number.isSafeInteger(skippedIntervals) || !n(skippedUsd) ||
    !n(v.sources, MAX_CHECKPOINT_ROWS) || !Number.isSafeInteger(v.sources) || typeof v.complete !== 'boolean' || !pricebook || !cycle) return undefined;
  // Unioned percentage intervals can omit switch gaps, but cannot exceed the
  // observed span. Permit only floating-point subtraction/summation roundoff;
  // retain fractional percentages rather than imposing a reporting precision.
  const span = v.percentThrough - v.percentFrom;
  const roundoff = 16 * Number.EPSILON * Math.max(1, v.percentFrom, v.percentThrough, v.deltaPercent);
  if (span < 0 || v.deltaPercent > span + roundoff) return undefined;
  if (v.intervals === 0) {
    // A withdrawn calibration can retain its latest fact and excluded USD,
    // while admitting no numerator, percentage interval or capacity.
    if (v.deltaPercent !== 0 || v.deltaUsd !== 0 || v.pricedTokens !== 0 || v.totalTokens !== 0 ||
      v.calibratedThrough !== v.from) return undefined;
  } else if (v.deltaPercent <= 0 || v.sources === 0 || v.calibratedThrough <= v.from) return undefined;
  // The DTO has no per-model token components. These are necessary rate bounds,
  // not a claim that aggregate totals can reproduce the exact model/token mix.
  if (v.pricedTokens === 0) {
    if (v.deltaUsd !== 0) return undefined;
  } else {
    if (pricebook.rates.length === 0) return undefined;
    const rates = pricebook.rates.flatMap(rate => [rate.input, rate.cachedInput, rate.output]);
    const low = v.pricedTokens * Math.min(...rates), high = v.pricedTokens * Math.max(...rates);
    if ((v.deltaUsd < low && !close(v.deltaUsd, low)) ||
      (v.deltaUsd > high && !close(v.deltaUsd, high))) return undefined;
  }
  return { schemaVersion: 1, methodVersion: 1, from: v.from, through: v.through, calibratedThrough: v.calibratedThrough,
    percentFrom: v.percentFrom, percentThrough: v.percentThrough, deltaPercent: v.deltaPercent,
    deltaUsd: v.deltaUsd, pricedTokens: v.pricedTokens, totalTokens: v.totalTokens,
    intervals: v.intervals, sources: v.sources, excludedUsd: v.excludedUsd, skippedIntervals, skippedUsd,
    complete: v.complete, pricebook, cycle };
}
export function codexWindowEvidenceFits(e: CodexWindowEvidence, value: {
  observedAt: number; utilizationPercent: number | null; usedEquivalentUsd: number;
  fullEquivalentUsd: number | null; unusedEquivalentUsd: number | null;
  pricingCoverage: number; pricingVersion?: string; flags?: readonly string[];
  unlinkedEquivalentUsd?: number; calibrationStart?: number;
}): boolean {
  // Also validate here: callers must not bypass receipt integrity by supplying
  // a typed but unchecked object directly to the fit predicate.
  const copy = copyCodexWindowEvidence(e);
  if (!copy) return false;
  e = copy;
  const coverage = e.totalTokens > 0 ? e.pricedTokens / e.totalTokens : 0;
  if (e.through !== value.observedAt || e.percentThrough !== value.utilizationPercent ||
    !n(value.usedEquivalentUsd) || !close(e.deltaUsd, value.usedEquivalentUsd) ||
    !n(value.pricingCoverage, 1) || !close(coverage, value.pricingCoverage) ||
    (value.calibrationStart !== undefined && value.calibrationStart !== e.from) ||
    (value.unlinkedEquivalentUsd !== undefined && !n(value.unlinkedEquivalentUsd)) ||
    (value.flags !== undefined && !Array.isArray(value.flags))) return false;
  // Generic legacy revisions do not encode a book. Our four-part revision does
  // and must agree with the full normalized book retained in this receipt.
  if (value.pricingVersion !== undefined &&
    (typeof value.pricingVersion !== 'string' || (/^openai-v\d{4}(?:\.\d{4}){3}$/.test(value.pricingVersion) &&
      value.pricingVersion !== codexCalibrationPricingVersion(e.pricebook)))) return false;
  if (value.fullEquivalentUsd === null) return value.unusedEquivalentUsd === null;
  if (!n(value.fullEquivalentUsd) || value.fullEquivalentUsd <= 0 || !n(value.unusedEquivalentUsd) ||
    value.unusedEquivalentUsd > value.fullEquivalentUsd || (value.unlinkedEquivalentUsd ?? 0) > 0 ||
    value.flags?.some(flag => flag === 'partial-history' || flag === 'partial-pricing')) return false;
  const full = e.deltaUsd / (e.deltaPercent / 100);
  return e.complete && e.excludedUsd === 0 && e.deltaPercent >= CODEX_MIN_CALIBRATION_PERCENT &&
    e.intervals > 0 && e.sources > 0 && e.deltaUsd > 0 && e.pricedTokens > 0 && e.pricedTokens === e.totalTokens &&
    Number.isFinite(full) && close(full, value.fullEquivalentUsd) && close(full * (1 - e.percentThrough / 100), value.unusedEquivalentUsd);
}
