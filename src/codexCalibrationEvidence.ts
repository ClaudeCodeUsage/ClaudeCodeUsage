import { getExactModelPricing } from './pricing';
import { createCodexParserState } from './providers/codex/codexParser';
import { CODEX_PERIOD_LINEAGE_VERSION } from './providers/codex/codexPeriodIndex';

/** Public model labels and the exact rates used locally, not a mutable fetch label. */
export interface CodexCalibrationPricebook {
  schemaVersion: 1;
  parserVersion: number;
  periodVersion: number;
  rates: Array<{ model: string; input: number; cachedInput: number; output: number }>;
}
export interface CodexCalibrationEvidence {
  schemaVersion: 1;
  methodVersion: 1 | 2;
  /** Absent on historical receipts; never inferred for old evidence. */
  collectionMode?: 'forward-append-v1' | 'forward-matched-cut-v1';
  pricebook: CodexCalibrationPricebook;
  /** Real official observation/request endpoints, including their percentages. */
  interval: {
    from: number; through: number; requestedFrom: number; requestedThrough: number;
    percentFrom: number; percentThrough: number; deltaUsd: number;
    pricedTokens: number; totalTokens: number; linkedSources: number; excludedSources: number; continuityGap: boolean;
  };
  /** Required in method two: interval USD/Tokens and accumulated deltaPercent
   * measure matched cuts, while the official envelope remains the as-of fact. */
  matchedCut?: { from: number; through: number; percentFrom: number; percentThrough: number };
  accumulated: { intervals: number; deltaPercent: number; deltaUsd: number; pricedTokens: number; totalTokens: number };
}
const MAX_MODELS = 64;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown, max = 1e12): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
function time(value: unknown): value is number { return finite(value, 8.64e15) && Number.isSafeInteger(value) && value > 0; }
function close(a: number, b: number): boolean { return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); }
export function copyCodexCalibrationPricebook(value: unknown): CodexCalibrationPricebook | undefined {
  if (!object(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.parserVersion) ||
    !finite(value.parserVersion, 1024) || value.parserVersion < 1 || !Number.isSafeInteger(value.periodVersion) ||
    !finite(value.periodVersion, 1024) || value.periodVersion < 1 || !Array.isArray(value.rates) || value.rates.length > MAX_MODELS) return undefined;
  const rates: CodexCalibrationPricebook['rates'] = [];
  for (const item of value.rates) {
    if (!object(item) || typeof item.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(item.model) ||
      !finite(item.input, 1) || !finite(item.cachedInput, 1) || !finite(item.output, 1) ||
      rates.some(rate => rate.model === item.model)) return undefined;
    rates.push({ model: item.model, input: item.input, cachedInput: item.cachedInput, output: item.output });
  }
  rates.sort((a, b) => a.model.localeCompare(b.model));
  return { schemaVersion: 1, parserVersion: value.parserVersion, periodVersion: value.periodVersion, rates };
}
/** Reuses materialized model labels only; no I/O, source scan or price fetch. */
export function captureCodexCalibrationPricebook(models: Iterable<string>): CodexCalibrationPricebook | undefined {
  const rates: CodexCalibrationPricebook['rates'] = [];
  for (const model of new Set(models)) {
    const pricing = getExactModelPricing(model);
    if (!pricing) continue; // Unknown models remain unpriced, never filled by coverage.
    rates.push({ model, input: pricing.input_cost_per_token ?? 0,
      cachedInput: pricing.cache_read_input_token_cost ?? 0, output: pricing.output_cost_per_token ?? 0 });
    if (rates.length > MAX_MODELS) return undefined;
  }
  return copyCodexCalibrationPricebook({ schemaVersion: 1,
    parserVersion: createCodexParserState('calibration-version').schemaVersion,
    periodVersion: CODEX_PERIOD_LINEAGE_VERSION, rates });
}
/** Fixed-field reconstruction prevents source keys/text/unknown fields from reaching disk. */
export function copyCodexCalibrationEvidence(value: unknown): CodexCalibrationEvidence | undefined {
  if (!object(value) || value.schemaVersion !== 1 || (value.methodVersion !== 1 && value.methodVersion !== 2) ||
    (value.methodVersion === 1 && value.collectionMode !== undefined && value.collectionMode !== 'forward-append-v1') ||
    (value.methodVersion === 2 && value.collectionMode !== 'forward-matched-cut-v1') ||
    !object(value.interval) || !object(value.accumulated)) return undefined;
  const pricebook = copyCodexCalibrationPricebook(value.pricebook), i = value.interval, a = value.accumulated;
  // The first receipt shape predates partial-source calibration; absent means
  // zero exclusions, never unknown source ownership or complete account use.
  const excludedSources = i.excludedSources === undefined ? 0 : i.excludedSources;
  if (!pricebook || !time(i.from) || !time(i.through) || i.through <= i.from ||
    !time(i.requestedFrom) || !time(i.requestedThrough) || i.requestedFrom > i.from ||
    i.from - i.requestedFrom > 30_000 || i.requestedThrough <= i.from || i.requestedThrough > i.through ||
    i.through - i.requestedThrough > 30_000 || !finite(i.percentFrom, 100) || !finite(i.percentThrough, 100) ||
    i.percentThrough >= 100 || i.percentThrough - i.percentFrom < 1 || !finite(i.deltaUsd) || i.deltaUsd <= 0 ||
    !finite(i.pricedTokens) || !finite(i.totalTokens) || i.pricedTokens <= 0 || i.pricedTokens > i.totalTokens ||
    !finite(i.linkedSources, 16_384) || !Number.isSafeInteger(i.linkedSources) || i.linkedSources < 1 ||
    !finite(excludedSources, 16_384) || !Number.isSafeInteger(excludedSources) ||
    typeof i.continuityGap !== 'boolean') return undefined;
  let matchedCut: CodexCalibrationEvidence['matchedCut'];
  let deltaPercent = i.percentThrough - i.percentFrom;
  if (value.methodVersion === 2) {
    const cut = value.matchedCut;
    if (!object(cut) || !time(cut.from) || !time(cut.through) || cut.from <= i.from ||
      cut.through <= cut.from || cut.through > i.requestedThrough ||
      !finite(cut.percentFrom, 100) || !finite(cut.percentThrough, 100) || cut.percentThrough >= 100 ||
      cut.percentThrough - cut.percentFrom < 1 || cut.percentFrom < i.percentFrom || cut.percentThrough > i.percentThrough ||
      i.continuityGap || excludedSources !== 0 || i.pricedTokens !== i.totalTokens || a.pricedTokens !== a.totalTokens) return undefined;
    matchedCut = { from: cut.from, through: cut.through, percentFrom: cut.percentFrom, percentThrough: cut.percentThrough };
    deltaPercent = cut.percentThrough - cut.percentFrom;
  }
  if (!finite(a.intervals, 100) || !Number.isSafeInteger(a.intervals) || a.intervals < 1 ||
    !finite(a.deltaPercent, 100) || a.deltaPercent < deltaPercent || a.deltaPercent >= 100 ||
    !finite(a.deltaUsd) || a.deltaUsd < i.deltaUsd || !finite(a.pricedTokens) || a.pricedTokens < i.pricedTokens ||
    !finite(a.totalTokens) || a.totalTokens < i.totalTokens || a.pricedTokens > a.totalTokens ||
    (a.intervals === 1 && (!close(a.deltaPercent, deltaPercent) ||
      !close(a.deltaUsd, i.deltaUsd) || !close(a.pricedTokens, i.pricedTokens) || !close(a.totalTokens, i.totalTokens)))) return undefined;
  return { schemaVersion: 1, methodVersion: value.methodVersion, pricebook,
    ...(value.collectionMode === 'forward-append-v1' ? { collectionMode: 'forward-append-v1' as const } : {}),
    ...(matchedCut === undefined ? {} : { collectionMode: 'forward-matched-cut-v1' as const, matchedCut }),
    interval: { from: i.from, through: i.through, requestedFrom: i.requestedFrom, requestedThrough: i.requestedThrough,
      percentFrom: i.percentFrom, percentThrough: i.percentThrough, deltaUsd: i.deltaUsd,
      pricedTokens: i.pricedTokens, totalTokens: i.totalTokens, linkedSources: i.linkedSources,
      excludedSources, continuityGap: i.continuityGap },
    accumulated: { intervals: a.intervals, deltaPercent: a.deltaPercent, deltaUsd: a.deltaUsd,
      pricedTokens: a.pricedTokens, totalTokens: a.totalTokens } };
}
export function codexCalibrationEvidenceFitsEstimate(e: CodexCalibrationEvidence, estimate: {
  observedAt: number; utilizationPercent: number | null; usedEquivalentUsd: number;
  fullEquivalentUsd: number | null; unusedEquivalentUsd: number | null; pricingCoverage: number;
  calibrationStart?: number; quotaEpoch?: { startedAt: number; resetAnchorAt: number };
}): boolean {
  const a = e.accumulated, i = e.interval, full = a.deltaUsd / (a.deltaPercent / 100);
  const calibrationFrom = e.methodVersion === 2 ? e.matchedCut?.from : i.from;
  return estimate.observedAt === i.through && estimate.utilizationPercent === i.percentThrough &&
    estimate.calibrationStart !== undefined && calibrationFrom !== undefined && estimate.calibrationStart <= calibrationFrom &&
    estimate.quotaEpoch !== undefined && estimate.calibrationStart >= estimate.quotaEpoch.startedAt &&
    i.through < estimate.quotaEpoch.resetAnchorAt && close(a.deltaUsd, estimate.usedEquivalentUsd) &&
    estimate.fullEquivalentUsd !== null && close(full, estimate.fullEquivalentUsd) &&
    estimate.unusedEquivalentUsd !== null && close(full * (1 - i.percentThrough / 100), estimate.unusedEquivalentUsd) &&
    close(a.pricedTokens / a.totalTokens, estimate.pricingCoverage);
}
