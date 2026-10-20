import type { OfficialQuotaSample } from './codexAccountEstimate';
import type { LocalWeeklyEstimate } from './weeklyEstimate';
import { copyCodexQuotaEpoch, codexQuotaEpochFitsObservation } from './codexQuotaEpoch';
import { copyCodexCalibrationPricebook, copyCodexCalibrationEvidence, CodexCalibrationPricebook } from './codexCalibrationEvidence';
import { isCodexForwardAppend, isCodexForwardCalibration, CodexForwardCalibration } from './providers/codex/codexForwardCalibration';

type Sample = OfficialQuotaSample;
type Delta = { usd: number; priced: number; total: number; sources: number };
type Run = { account: string; from: number; usd: number; priced: number; total: number; delta: number; intervals: number };
type Pending = Delta & { sample: Sample };
const MAX_GAP = 300_000, HEX = /^[a-f0-9]{64}$/;
const parts = ['inputTotal', 'cachedInput', 'outputTotal', 'reasoningOutput'] as const;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Exact append timing is separate from primary cumulative counters. Refuse the
 * entire official denominator if ANY changed source cannot supply its dollars.
 * An unchanged old source is not a missing increment; it grants no historical
 * completeness, owned-account identity or cross-device coverage. */
function increment(before: CodexForwardCalibration, after: CodexForwardCalibration,
  first: Sample, last: Sample, book: CodexCalibrationPricebook): Delta | undefined {
  if (before.indexGeneration !== after.indexGeneration || before.sources.length !== after.sources.length) return;
  const old = new Map(before.sources.map(source => [source.sourceKey, source]));
  const rates = new Map(book.rates.map(rate => [rate.model, rate]));
  const out: Delta = { usd: 0, priced: 0, total: 0, sources: 0 };
  for (const source of after.sources) {
    const prior = old.get(source.sourceKey);
    if (!prior || source.continuity !== prior.continuity) return;
    if (source.revision === prior.revision) continue;
    if (!isCodexForwardAppend(prior, source) || !prior.byModel || !source.byModel) return;
    const window = source.appendWindow;
    if (!window || !window.complete || window.beforeOffset !== prior.offset || window.throughOffset !== source.offset) return;
    let tokens = 0, dollars = 0;
    for (const model of new Set([...Object.keys(prior.byModel), ...Object.keys(source.byModel)])) {
      const vector = parts.map(key => (source.byModel![model]?.[key] ?? 0) - (prior.byModel![model]?.[key] ?? 0));
      const [input, cached, output, reasoning] = vector;
      if (!vector.every(n => Number.isSafeInteger(n) && n >= 0) || cached > input || reasoning > output ||
        !Number.isSafeInteger(input + output)) return;
      if (input + output === 0) continue;
      const rate = rates.get(model); if (!rate) return;
      tokens += input + output;
      dollars += (input - cached) * rate.input + cached * rate.cachedInput + output * rate.output;
    }
    if (tokens === 0) {
      // Known metadata-only append. Unknown or zero-dated usage is not zero.
      if (window.minUsageAt !== null || window.maxUsageAt !== null) return;
      continue;
    }
    if (window.minUsageAt === null || window.maxUsageAt === null || window.minUsageAt <= first.observedAt ||
      window.maxUsageAt < window.minUsageAt || window.maxUsageAt > last.requestedAt) return;
    const witness = source.quotaWitness;
    if (!witness || witness.observedAt < window.maxUsageAt || witness.observedAt > last.requestedAt ||
      Math.abs(witness.resetAt - last.resetAt) > 300_000 ||
      witness.usedPercent < first.usedPercent || witness.usedPercent > last.usedPercent) return;
    if (source.incompleteRanges?.some(range => range.through > first.observedAt && range.from <= last.requestedAt)) return;
    out.usd += dollars; out.total += tokens; out.priced += tokens; out.sources++;
    if (!Number.isFinite(out.usd) || out.usd > 1e12 || !Number.isSafeInteger(out.total)) return;
  }
  return out;
}

/** Forward-only conditional local proxy. Never reads sources, restores a runtime
 * baseline from disk, extrapolates daily buckets or asserts account ownership. */
export class CodexForwardAccountEstimator {
  private baseline?: { sample: Sample; proof: CodexForwardCalibration; book: CodexCalibrationPricebook; key: string; aligned: boolean };
  private pending?: Pending;
  private context?: string;
  private readonly used = new WeakSet<object>();
  private readonly runs = new Map<string, Run>();
  breakContinuity(): void { this.baseline = undefined; this.pending = undefined; }
  reset(): void { this.breakContinuity(); this.runs.clear(); this.context = undefined; }
  invalidateThrough(account: string, through: number): void {
    for (const [key, run] of this.runs) if (run.account === account && run.from <= through) this.runs.delete(key);
    if (this.baseline?.sample.accountScopeKey === account) this.breakContinuity();
  }
  observe(sample: Sample, proof: unknown, rawBook: unknown): LocalWeeklyEstimate | undefined {
    const epoch = copyCodexQuotaEpoch(sample.quotaEpoch), book = copyCodexCalibrationPricebook(rawBook);
    if (!epoch || !book || !HEX.test(sample.accountScopeKey) || !HEX.test(sample.sourceScopeKey) ||
      !Number.isSafeInteger(sample.requestedAt) || !Number.isSafeInteger(sample.observedAt) ||
      sample.requestedAt > sample.observedAt || sample.observedAt - sample.requestedAt > 30_000 ||
      !Number.isFinite(sample.usedPercent) || sample.usedPercent < 0 || sample.usedPercent >= 100 ||
      sample.ordinaryUsageAllowed === false || sample.spendControlReached === true ||
      !codexQuotaEpochFitsObservation(epoch, sample.observedAt, sample.resetAt) ||
      !isCodexForwardCalibration(proof) || this.used.has(proof) || proof.verifiedAt > sample.requestedAt ||
      sample.observedAt - proof.verifiedAt > MAX_GAP) { this.reset(); return; }
    this.used.add(proof);
    const safe: Sample = { ...sample, quotaEpoch: epoch };
    const context = JSON.stringify([sample.sourceScopeKey, proof.indexGeneration, book,
      sample.planType ?? null, sample.spendControlReached ?? null, sample.ordinaryUsageAllowed ?? null]);
    if (this.context !== undefined && this.context !== context) this.reset();
    this.context = context;
    const key = JSON.stringify([sample.accountScopeKey, context, epoch]);
    const before = this.baseline;
    const replace = () => { this.baseline = { sample: safe, proof, book, key, aligned: false }; this.pending = undefined; };
    if (before?.key === key && sample.usedPercent < before.sample.usedPercent) this.runs.delete(key);
    if (!before || before.key !== key || sample.requestedAt <= before.sample.observedAt ||
      proof.verifiedAt <= before.sample.observedAt || sample.observedAt - before.sample.observedAt > MAX_GAP ||
      sample.usedPercent < before.sample.usedPercent) { replace(); return; }
    const delta = increment(before.proof, proof, before.sample, sample, book);
    if (!delta) { replace(); return; }
    this.baseline = { sample: safe, proof, book, key, aligned: before.aligned };
    const pending = this.pending ?? { sample: before.sample, usd: 0, priced: 0, total: 0, sources: 0 };
    pending.usd += delta.usd; pending.priced += delta.priced; pending.total += delta.total;
    pending.sources = Math.max(pending.sources, delta.sources);
    this.pending = pending;
    const points = sample.usedPercent - pending.sample.usedPercent;
    if (points < 1) return;
    this.pending = undefined;
    // Official percentages are whole-number observations. An arbitrary first
    // sample can start midway through a percentage bin; its partial first span
    // biases short fits. Start each continuous cohort at the first observed
    // increase, and never use the discarded dollars/points in its estimate.
    if (!before.aligned) { this.baseline.aligned = true; return; }
    if (pending.usd <= 0 || pending.total <= 0 || pending.priced !== pending.total) return;
    const previous = this.runs.get(key);
    const run: Run = { account: sample.accountScopeKey, from: previous?.from ?? pending.sample.observedAt,
      usd: (previous?.usd ?? 0) + pending.usd, priced: (previous?.priced ?? 0) + pending.priced,
      total: (previous?.total ?? 0) + pending.total, delta: (previous?.delta ?? 0) + points,
      intervals: (previous?.intervals ?? 0) + 1 };
    const full = run.usd / (run.delta / 100);
    if (!Number.isFinite(full) || full <= 0 || full > 1e12 || run.delta >= 100 || run.intervals > 100) return;
    const calibrationEvidence = copyCodexCalibrationEvidence({ schemaVersion: 1, methodVersion: 1, pricebook: book,
      collectionMode: 'forward-append-v1',
      interval: { from: pending.sample.observedAt, through: sample.observedAt,
        requestedFrom: pending.sample.requestedAt, requestedThrough: sample.requestedAt,
        percentFrom: pending.sample.usedPercent, percentThrough: sample.usedPercent,
        deltaUsd: pending.usd, pricedTokens: pending.priced, totalTokens: pending.total,
        linkedSources: pending.sources, excludedSources: 0, continuityGap: false },
      accumulated: { intervals: run.intervals, deltaPercent: run.delta, deltaUsd: run.usd,
        pricedTokens: run.priced, totalTokens: run.total } });
    if (!calibrationEvidence || !close(calibrationEvidence.accumulated.deltaUsd, run.usd)) return;
    this.runs.delete(key); this.runs.set(key, run);
    if (this.runs.size > 64) this.runs.delete(this.runs.keys().next().value!);
    return { provider: 'codex', method: 'account-delta-v1', accountScopeKey: sample.accountScopeKey,
      windowStart: epoch.startLowerAt ?? epoch.startedAt, resetAt: sample.resetAt,
      observedAt: sample.observedAt, estimatedAt: sample.observedAt,
      usedEquivalentUsd: run.usd, fullEquivalentUsd: full,
      unusedEquivalentUsd: full * (1 - sample.usedPercent / 100), utilizationPercent: sample.usedPercent,
      pricingCoverage: 1, calibrationStart: run.from, quotaEpoch: epoch, calibrationEvidence,
      flags: ['account-unattributed', 'boundary-uncertain'] };
  }
}
