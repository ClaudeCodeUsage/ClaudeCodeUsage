import type { OfficialQuotaSample } from './codexAccountEstimate';
import type { LocalWeeklyEstimate } from './weeklyEstimate';
import { copyCodexQuotaEpoch, codexQuotaEpochFitsObservation } from './codexQuotaEpoch';
import { copyCodexCalibrationPricebook, copyCodexCalibrationEvidence, CodexCalibrationPricebook } from './codexCalibrationEvidence';
import { isCodexForwardAppend, isCodexForwardBirth, isCodexForwardCalibration, CodexForwardCalibration,
  CodexForwardCalibrationSource, CodexForwardAppendWindow } from './providers/codex/codexForwardCalibration';
import { CODEX_MIN_CALIBRATION_PERCENT } from './codexWindowEvidence';

/** Runtime-only, allowlisted progress. No account/source/model identifiers. */
export type CodexCalibrationState = 'baseline' | 'percentage-step' | 'first-step-discarded' |
  'accumulating' | 'calibrated' | 'source-unavailable' | 'source-changed' |
  'append-incomplete' | 'endpoint-mismatch' | 'unpriced-usage' | 'quota-blocked' | 'continuity-gap';
export interface CodexCalibrationStatus { state: CodexCalibrationState; deltaPercent: number; intervals: number }
export const CODEX_CALIBRATION_DIAGNOSTIC_REASONS = Object.freeze([
  'proof-missing', 'proof-reused', 'proof-reused-noop', 'proof-future', 'proof-stale', 'invalid-sample', 'invalid-pricebook',
  'baseline-empty', 'epoch-change', 'context-change', 'observation-gap', 'observation-order',
  'proof-before-baseline', 'counter-correction', 'baseline-retired', 'not-forward-mode', 'quota-blocked',
  'source-changed', 'append-incomplete', 'endpoint-mismatch', 'unpriced-usage', 'percentage-step',
  'first-step-discarded', 'accumulating', 'calibrated', 'no-priced-increment', 'capacity-invalid', 'evidence-invalid',
  'source-ineligible', 'append-unproven', 'append-window-missing', 'append-window-incomplete',
  'append-chain-gap', 'append-vector-invalid', 'metadata-usage-mismatch', 'usage-time-missing',
  'usage-before-baseline', 'usage-after-request', 'counter-overflow',
] as const);
export type CodexCalibrationReason = typeof CODEX_CALIBRATION_DIAGNOSTIC_REASONS[number];
export interface CodexCalibrationDiagnostics extends CodexCalibrationStatus {
  reason: CodexCalibrationReason;
  proofAgeMs?: number;
  /** Current official observedAt minus the previous runtime baseline observedAt. */
  bracketGapMs?: number;
}

type Sample = OfficialQuotaSample;
type Delta = { usd: number; priced: number; total: number; sources: number };
type RejectedDelta = { state: CodexCalibrationState; reason: CodexCalibrationReason };
const rejectDelta = (state: CodexCalibrationState, reason = statusReason(state)): RejectedDelta => ({ state, reason });
type Run = { account: string; from: number; usd: number; priced: number; total: number; delta: number; intervals: number };
type Pending = Delta & { sample: Sample };
const MAX_GAP = 300_000, HEX = /^[a-f0-9]{64}$/;
const parts = ['inputTotal', 'cachedInput', 'outputTotal', 'reasoningOutput'] as const;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const diagnosticGap = (later: number, earlier: number): number | undefined => {
  if (!Number.isSafeInteger(later) || !Number.isSafeInteger(earlier)) return undefined;
  const gap = later - earlier;
  return Number.isSafeInteger(gap) && gap >= 0 ? gap : undefined;
};
function statusReason(state: CodexCalibrationState): CodexCalibrationReason {
  return state === 'baseline' ? 'baseline-empty' : state === 'source-unavailable' ? 'proof-missing' :
    state === 'continuity-gap' ? 'observation-gap' : state;
}

// An absent prior source is allowed only after producer birth provenance has
// been checked. Its exact initial chain starts at zero, with no historical end.
function appendChain(before: CodexForwardCalibrationSource | undefined, after: CodexForwardCalibrationSource): CodexForwardAppendWindow | undefined {
  if (after.appendWindow?.complete === false) return;
  const windows = after.appendWindows?.length ? after.appendWindows : after.appendWindow ? [after.appendWindow] : [];
  const start = before?.offset ?? 0;
  const knownZero = before?.eligible === true && before.byModel !== null &&
    Object.values(before.byModel).every(tokens => parts.every(key => (tokens[key] ?? 0) === 0));
  let cursor = start, min: number | null = null, max: number | null = null;
  for (const window of windows) {
    if (window.throughOffset <= cursor) continue;
    if (!window.complete || window.beforeOffset !== cursor || window.throughOffset > after.offset) return;
    if (window.minUsageAt !== null) {
      if (window.maxUsageAt === null || before && (before.usageThrough === null ? !knownZero : window.minUsageAt <= before.usageThrough) ||
        max !== null && window.minUsageAt <= max) return;
      min = min === null ? window.minUsageAt : Math.min(min, window.minUsageAt);
      max = window.maxUsageAt;
    } else if (window.maxUsageAt !== null) return;
    cursor = window.throughOffset;
    if (cursor === after.offset) return { beforeOffset: start, throughOffset: cursor,
      minUsageAt: min, maxUsageAt: max, complete: true };
  }
}

/** Exact append timing is separate from primary cumulative counters. Refuse the
 * entire official denominator if ANY changed source cannot supply its dollars.
 * An unchanged old source is not a missing increment; it grants no historical
 * completeness, owned-account identity or cross-device coverage. */
function increment(before: CodexForwardCalibration, after: CodexForwardCalibration,
  first: Sample, last: Sample, book: CodexCalibrationPricebook): Delta | RejectedDelta {
  if (before.indexGeneration !== after.indexGeneration) return rejectDelta('source-changed');
  const old = new Map(before.sources.map(source => [source.sourceKey, source]));
  const current = new Map(after.sources.map(source => [source.sourceKey, source]));
  // Births extend the census; they never replace a missing or rewritten source.
  if (before.sources.some(source => current.get(source.sourceKey)?.continuity !== source.continuity)) return rejectDelta('source-changed');
  if (after.sources.some(source => !old.has(source.sourceKey) && !isCodexForwardBirth(before, source))) return rejectDelta('source-changed');
  const rates = new Map(book.rates.map(rate => [rate.model, rate]));
  const endpoint = (proof: CodexForwardCalibration, sample: Sample, since?: number) => proof.sources.some(source =>
    source.eligible && source.quotaWitness && Math.abs(source.quotaWitness.resetAt - sample.resetAt) <= 300_000 &&
    source.quotaWitness.usedPercent === sample.usedPercent && source.quotaWitness.observedAt <= sample.requestedAt &&
    (since === undefined || source.quotaWitness.observedAt > since));
  if (!endpoint(before, first)) return rejectDelta('endpoint-mismatch');
  const out: Delta = { usd: 0, priced: 0, total: 0, sources: 0 };
  for (const source of after.sources) {
    const prior = old.get(source.sourceKey);
    if (prior && source.revision === prior.revision) continue;
    if (!source.eligible || prior && !prior.eligible) return rejectDelta('append-incomplete', 'source-ineligible');
    if (!source.byModel || prior && !prior.byModel) return rejectDelta('append-incomplete', 'append-vector-invalid');
    if (prior && !isCodexForwardAppend(prior, source)) return rejectDelta('append-incomplete', 'append-unproven');
    const window = appendChain(prior, source);
    if (!window || !window.complete || window.beforeOffset !== (prior?.offset ?? 0) || window.throughOffset !== source.offset) {
      return rejectDelta('append-incomplete', source.appendWindow?.complete === false ? 'append-window-incomplete' :
        !source.appendWindows?.length && !source.appendWindow ? 'append-window-missing' : 'append-chain-gap');
    }
    let tokens = 0, dollars = 0;
    for (const model of new Set([...Object.keys(prior?.byModel ?? {}), ...Object.keys(source.byModel)])) {
      const vector = parts.map(key => (source.byModel![model]?.[key] ?? 0) - (prior?.byModel?.[model]?.[key] ?? 0));
      const [input, cached, output, reasoning] = vector;
      if (!vector.every(n => Number.isSafeInteger(n) && n >= 0) || cached > input || reasoning > output ||
        !Number.isSafeInteger(input + output)) return rejectDelta('append-incomplete', 'append-vector-invalid');
      if (input + output === 0) continue;
      const rate = rates.get(model); if (!rate) return rejectDelta('unpriced-usage');
      tokens += input + output;
      dollars += (input - cached) * rate.input + cached * rate.cachedInput + output * rate.output;
    }
    if (tokens === 0) {
      // Known metadata-only append. Unknown or zero-dated usage is not zero.
      if (window.minUsageAt !== null || window.maxUsageAt !== null) return rejectDelta('append-incomplete', 'metadata-usage-mismatch');
      continue;
    }
    if (window.minUsageAt === null || window.maxUsageAt === null || window.maxUsageAt < window.minUsageAt) {
      return rejectDelta('append-incomplete', 'usage-time-missing');
    }
    if (window.minUsageAt <= first.observedAt) return rejectDelta('append-incomplete', 'usage-before-baseline');
    if (window.maxUsageAt > last.requestedAt) return rejectDelta('append-incomplete', 'usage-after-request');
    const witness = source.quotaWitness;
    if (!witness || witness.observedAt < window.maxUsageAt || witness.observedAt > last.requestedAt ||
      Math.abs(witness.resetAt - last.resetAt) > 300_000 ||
      witness.usedPercent < first.usedPercent || witness.usedPercent > last.usedPercent) return rejectDelta('endpoint-mismatch');
    if (source.incompleteRanges?.some(range => range.through > first.observedAt && range.from <= last.requestedAt)) {
      return rejectDelta('append-incomplete', 'append-window-incomplete');
    }
    out.usd += dollars; out.total += tokens; out.priced += tokens; out.sources++;
    if (!Number.isFinite(out.usd) || out.usd > 1e12 || !Number.isSafeInteger(out.total)) return rejectDelta('append-incomplete', 'counter-overflow');
  }
  if ((out.total > 0 || last.usedPercent !== first.usedPercent) && !endpoint(after, last, first.observedAt)) return rejectDelta('endpoint-mismatch');
  return out;
}

/** Forward-only conditional local proxy. Never reads sources, restores a runtime
 * baseline from disk, extrapolates daily buckets or asserts account ownership. */
export class CodexForwardAccountEstimator {
  private progress: CodexCalibrationStatus = { state: 'source-unavailable', deltaPercent: 0, intervals: 0 };
  private diagnosticReason: CodexCalibrationReason = 'proof-missing';
  private diagnosticTimes: { proofAgeMs?: number; bracketGapMs?: number } = {};
  private baseline?: { sample: Sample; proof: CodexForwardCalibration; book: CodexCalibrationPricebook; key: string; aligned: boolean };
  private pending?: Pending;
  private context?: string;
  private readonly used = new WeakSet<object>();
  private readonly runs = new Map<string, Run>();
  private readonly lastSamples = new Map<string, { account: string; observedAt: number; percent: number }>();
  calibrationStatus(): CodexCalibrationStatus { return { ...this.progress }; }
  calibrationDiagnostics(): CodexCalibrationDiagnostics {
    return { ...this.progress, reason: this.diagnosticReason, ...this.diagnosticTimes };
  }
  private status(state: CodexCalibrationState, key?: string, reason = statusReason(state)): void {
    const run = key === undefined ? undefined : this.runs.get(key);
    this.progress = { state, deltaPercent: run?.delta ?? 0, intervals: run?.intervals ?? 0 };
    this.diagnosticReason = reason;
  }
  breakContinuity(): void {
    this.baseline = undefined; this.pending = undefined; this.diagnosticTimes = {};
    this.status('continuity-gap', undefined, 'baseline-retired');
  }
  reset(): void { this.breakContinuity(); this.runs.clear(); this.lastSamples.clear(); this.context = undefined; this.status('source-unavailable'); }
  invalidateThrough(account: string, through: number): void {
    for (const [key, run] of this.runs) if (run.account === account && run.from <= through) this.runs.delete(key);
    for (const [key, last] of this.lastSamples) if (last.account === account) this.lastSamples.delete(key);
    if (this.baseline?.sample.accountScopeKey === account) this.breakContinuity();
  }
  observe(sample: Sample, proof: unknown, rawBook: unknown): LocalWeeklyEstimate | undefined {
    const epoch = copyCodexQuotaEpoch(sample.quotaEpoch), book = copyCodexCalibrationPricebook(rawBook);
    const retired = this.diagnosticReason === 'baseline-retired';
    const proofAgeMs = isCodexForwardCalibration(proof) ? diagnosticGap(sample.observedAt, proof.verifiedAt) : undefined;
    const bracketGapMs = this.baseline ? diagnosticGap(sample.observedAt, this.baseline.sample.observedAt) : undefined;
    const times = { ...(proofAgeMs === undefined ? {} : { proofAgeMs }),
      ...(bracketGapMs === undefined ? {} : { bracketGapMs }) };
    this.diagnosticTimes = times;
    // A metadata-only quota read can see the exact already-consumed baseline
    // proof. Preserve monetary state only for this unchanged, fresh identity /
    // percentage / full-context observation; never consume or admit USD again.
    if (this.baseline && proof === this.baseline.proof && isCodexForwardCalibration(proof) && this.used.has(proof) &&
      epoch && book && HEX.test(sample.accountScopeKey) && HEX.test(sample.sourceScopeKey) &&
      Number.isSafeInteger(sample.requestedAt) && Number.isSafeInteger(sample.observedAt) &&
      sample.requestedAt <= sample.observedAt && sample.observedAt - sample.requestedAt <= 30_000 &&
      Number.isFinite(sample.usedPercent) && sample.usedPercent >= 0 && sample.usedPercent < 100 &&
      sample.ordinaryUsageAllowed !== false && sample.spendControlReached !== true &&
      (sample.planType == null || typeof sample.planType === 'string') &&
      (sample.ordinaryUsageAllowed == null || typeof sample.ordinaryUsageAllowed === 'boolean') &&
      (sample.spendControlReached == null || typeof sample.spendControlReached === 'boolean') &&
      codexQuotaEpochFitsObservation(epoch, sample.observedAt, sample.resetAt) && sample.resetAt > sample.observedAt &&
      sample.resetAt === this.baseline.sample.resetAt && sample.usedPercent === this.baseline.sample.usedPercent &&
      sample.requestedAt > this.baseline.sample.observedAt &&
      sample.observedAt - this.baseline.sample.observedAt <= MAX_GAP && proof.verifiedAt <= sample.requestedAt &&
      sample.observedAt - proof.verifiedAt <= MAX_GAP) {
      const metadataContext = JSON.stringify([sample.sourceScopeKey, proof.indexGeneration, book,
        sample.planType ?? null, sample.spendControlReached ?? null, sample.ordinaryUsageAllowed ?? null]);
      if (metadataContext === this.context && JSON.stringify([sample.accountScopeKey, metadataContext, epoch]) === this.baseline.key) {
        this.diagnosticReason = 'proof-reused-noop'; return;
      }
    }
    if (!epoch || !book || !HEX.test(sample.accountScopeKey) || !HEX.test(sample.sourceScopeKey) ||
      !Number.isSafeInteger(sample.requestedAt) || !Number.isSafeInteger(sample.observedAt) ||
      sample.requestedAt > sample.observedAt || sample.observedAt - sample.requestedAt > 30_000 ||
      !Number.isFinite(sample.usedPercent) || sample.usedPercent < 0 || sample.usedPercent >= 100 ||
      sample.ordinaryUsageAllowed === false || sample.spendControlReached === true ||
      !codexQuotaEpochFitsObservation(epoch, sample.observedAt, sample.resetAt) ||
      !isCodexForwardCalibration(proof) || this.used.has(proof) || proof.verifiedAt > sample.requestedAt ||
      sample.observedAt - proof.verifiedAt > MAX_GAP) {
      // Classify the existing rejection only. The admission predicate above and
      // all baseline/run mutations remain unchanged.
      const blocked = sample.ordinaryUsageAllowed === false || sample.spendControlReached === true || sample.usedPercent >= 100;
      const invalidSample = !epoch || !HEX.test(sample.accountScopeKey) || !HEX.test(sample.sourceScopeKey) ||
        !Number.isSafeInteger(sample.requestedAt) || !Number.isSafeInteger(sample.observedAt) ||
        sample.requestedAt > sample.observedAt || sample.observedAt - sample.requestedAt > 30_000 ||
        !Number.isFinite(sample.usedPercent) || sample.usedPercent < 0 || sample.usedPercent >= 100 ||
        !codexQuotaEpochFitsObservation(epoch, sample.observedAt, sample.resetAt);
      const reason: CodexCalibrationReason = blocked ? 'quota-blocked' : invalidSample ? 'invalid-sample' :
        !book ? 'invalid-pricebook' : !isCodexForwardCalibration(proof) ? 'proof-missing' :
        this.used.has(proof) ? 'proof-reused' : proof.verifiedAt > sample.requestedAt ? 'proof-future' : 'proof-stale';
      this.reset();
      this.diagnosticTimes = times;
      this.status(sample.ordinaryUsageAllowed === false || sample.spendControlReached === true || sample.usedPercent >= 100
        ? 'quota-blocked' : isCodexForwardCalibration(proof) ? 'continuity-gap' : 'source-unavailable', undefined, reason);
      return;
    }
    this.used.add(proof);
    const safe: Sample = { ...sample, quotaEpoch: epoch };
    const context = JSON.stringify([sample.sourceScopeKey, proof.indexGeneration, book,
      sample.planType ?? null, sample.spendControlReached ?? null, sample.ordinaryUsageAllowed ?? null]);
    const contextChanged = this.context !== undefined && this.context !== context;
    if (contextChanged) this.reset();
    this.diagnosticTimes = times;
    this.context = context;
    const key = JSON.stringify([sample.accountScopeKey, context, epoch]);
    const last = this.lastSamples.get(key);
    if (last && sample.requestedAt <= last.observedAt) {
      this.breakContinuity(); this.diagnosticTimes = times; this.diagnosticReason = 'observation-order'; return;
    }
    // Blur/visits retire a monetary baseline, not observed counter history.
    // A later correction must not resurrect a pre-correction admitted cohort.
    if (last && sample.usedPercent < last.percent) this.runs.delete(key);
    this.lastSamples.delete(key);
    this.lastSamples.set(key, { account: sample.accountScopeKey, observedAt: sample.observedAt, percent: sample.usedPercent });
    if (this.lastSamples.size > 64) this.lastSamples.delete(this.lastSamples.keys().next().value!);
    const before = this.baseline;
    const replace = (state: CodexCalibrationState, reason = statusReason(state)) => {
      this.baseline = { sample: safe, proof, book, key, aligned: false }; this.pending = undefined; this.status(state, key, reason);
    };
    if (before?.key === key && sample.usedPercent < before.sample.usedPercent) this.runs.delete(key);
    if (!before || before.key !== key || sample.requestedAt <= before.sample.observedAt ||
      proof.verifiedAt <= before.sample.observedAt || sample.observedAt - before.sample.observedAt > MAX_GAP ||
      sample.usedPercent < before.sample.usedPercent) {
      const reason: CodexCalibrationReason = contextChanged ? 'context-change' :
        (last && sample.usedPercent < last.percent || before?.key === key && sample.usedPercent < before.sample.usedPercent)
          ? 'counter-correction' : !before ? retired ? 'baseline-retired' : 'baseline-empty' :
        before.key !== key ? before.sample.accountScopeKey === sample.accountScopeKey ? 'epoch-change' : 'context-change' :
        sample.requestedAt <= before.sample.observedAt ? 'observation-order' :
        proof.verifiedAt <= before.sample.observedAt ? 'proof-before-baseline' : 'observation-gap';
      replace(!before ? 'baseline' : before.key !== key ? 'source-changed' : 'continuity-gap', reason); return;
    }
    const delta = increment(before.proof, proof, before.sample, sample, book);
    if ('state' in delta) { replace(delta.state, delta.reason); return; }
    this.baseline = { sample: safe, proof, book, key, aligned: before.aligned };
    const pending = this.pending ?? { sample: before.sample, usd: 0, priced: 0, total: 0, sources: 0 };
    pending.usd += delta.usd; pending.priced += delta.priced; pending.total += delta.total;
    pending.sources = Math.max(pending.sources, delta.sources);
    this.pending = pending;
    const points = sample.usedPercent - pending.sample.usedPercent;
    if (points < 1) { this.status('percentage-step', key); return; }
    this.pending = undefined;
    // Official percentages are whole-number observations. An arbitrary first
    // sample can start midway through a percentage bin; its partial first span
    // biases short fits. Start each continuous cohort at the first observed
    // increase, and never use the discarded dollars/points in its estimate.
    if (!before.aligned) { this.baseline.aligned = true; this.status('first-step-discarded', key); return; }
    if (pending.usd <= 0 || pending.total <= 0 || pending.priced !== pending.total) { this.diagnosticReason = 'no-priced-increment'; return; }
    const previous = this.runs.get(key);
    const run: Run = { account: sample.accountScopeKey, from: previous?.from ?? pending.sample.observedAt,
      usd: (previous?.usd ?? 0) + pending.usd, priced: (previous?.priced ?? 0) + pending.priced,
      total: (previous?.total ?? 0) + pending.total, delta: (previous?.delta ?? 0) + points,
      intervals: (previous?.intervals ?? 0) + 1 };
    const full = run.usd / (run.delta / 100);
    if (!Number.isFinite(full) || full <= 0 || full > 1e12 || run.delta >= 100 || run.intervals > 100) {
      this.diagnosticReason = 'capacity-invalid'; return;
    }
    const calibrationEvidence = copyCodexCalibrationEvidence({ schemaVersion: 1, methodVersion: 1, pricebook: book,
      collectionMode: 'forward-append-v1',
      interval: { from: pending.sample.observedAt, through: sample.observedAt,
        requestedFrom: pending.sample.requestedAt, requestedThrough: sample.requestedAt,
        percentFrom: pending.sample.usedPercent, percentThrough: sample.usedPercent,
        deltaUsd: pending.usd, pricedTokens: pending.priced, totalTokens: pending.total,
        linkedSources: pending.sources, excludedSources: 0, continuityGap: false },
      accumulated: { intervals: run.intervals, deltaPercent: run.delta, deltaUsd: run.usd,
        pricedTokens: run.priced, totalTokens: run.total } });
    if (!calibrationEvidence || !close(calibrationEvidence.accumulated.deltaUsd, run.usd)) { this.diagnosticReason = 'evidence-invalid'; return; }
    this.runs.delete(key); this.runs.set(key, run);
    if (this.runs.size > 64) this.runs.delete(this.runs.keys().next().value!);
    this.status(run.delta >= CODEX_MIN_CALIBRATION_PERCENT ? 'calibrated' : 'accumulating', key);
    return { provider: 'codex', method: 'account-delta-v1', accountScopeKey: sample.accountScopeKey,
      windowStart: epoch.startLowerAt ?? epoch.startedAt, resetAt: sample.resetAt,
      observedAt: sample.observedAt, estimatedAt: sample.observedAt,
      usedEquivalentUsd: run.usd, fullEquivalentUsd: full,
      unusedEquivalentUsd: full * (1 - sample.usedPercent / 100), utilizationPercent: sample.usedPercent,
      pricingCoverage: 1, calibrationStart: run.from, quotaEpoch: epoch, calibrationEvidence,
      flags: ['account-unattributed', 'boundary-uncertain'] };
  }
}
