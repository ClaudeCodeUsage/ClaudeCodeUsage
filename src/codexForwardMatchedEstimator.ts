import type { OfficialQuotaSample } from './codexAccountEstimate';
import type { LocalWeeklyEstimate } from './weeklyEstimate';
import type { CodexCalibrationDiagnostics, CodexCalibrationReason, CodexCalibrationState, CodexCalibrationStatus } from './codexForwardAccountEstimate';
import { copyCodexQuotaEpoch, codexQuotaEpochFitsObservation } from './codexQuotaEpoch';
import { copyCodexCalibrationEvidence, copyCodexCalibrationPricebook, CodexCalibrationPricebook } from './codexCalibrationEvidence';
import { CodexForwardCalibration, isCodexForwardCalibration } from './providers/codex/codexForwardCalibration';
import { collectCodexForwardSliceDelta } from './providers/codex/codexForwardMatchedCuts';
import type { CodexForwardUsageSlice } from './providers/codex/codexForwardSlices';
import { CODEX_MIN_CALIBRATION_PERCENT } from './codexWindowEvidence';

type Row = CodexForwardUsageSlice & { readonly sourceKey: string };
type Point = Pick<OfficialQuotaSample, 'observedAt' | 'requestedAt' | 'usedPercent'>;
type Cut = { at: number; percent: number; anchor: Point };
type Run = { account: string; from: number; usd: number; tokens: number; points: number; intervals: number };
type Baseline = { sample: OfficialQuotaSample; proof: CodexForwardCalibration; key: string; book: CodexCalibrationPricebook };
const MAX_GAP = 300000, HEX = /^[a-f0-9]{64}$/;
const validTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Runtime-only matched endpoints. Full physical deltas are reconciled first;
 * flat-percentage dollars are sealed into bounded numeric sums, never dropped
 * on an intermediate official poll. No ledger/baseline is restored from disk. */
export class CodexForwardMatchedEstimator {
  private baseline?: Baseline;
  private cut?: Cut;
  private aligned = false;
  private rows: Row[] = [];
  private pendingUsd = 0;
  private pendingTokens = 0;
  private pendingSources = new Set<string>();
  private history: Point[] = [];
  private localPoint?: { at: number; percent: number };
  private readonly used = new WeakSet<object>();
  private readonly runs = new Map<string, Run>();
  private readonly lastSamples = new Map<string, { account: string; percent: number; at: number }>();
  private context?: string;
  private progress: CodexCalibrationStatus = { state: 'source-unavailable', deltaPercent: 0, intervals: 0 };
  private reason: CodexCalibrationReason = 'proof-missing';
  private times: { proofAgeMs?: number; bracketGapMs?: number } = {};
  calibrationStatus(): CodexCalibrationStatus { return { ...this.progress }; }
  calibrationDiagnostics(): CodexCalibrationDiagnostics { return { ...this.progress, reason: this.reason, ...this.times }; }
  private status(state: CodexCalibrationState, reason: CodexCalibrationReason, key = this.baseline?.key): void {
    const run = key ? this.runs.get(key) : undefined;
    this.progress = { state, deltaPercent: run?.points ?? 0, intervals: run?.intervals ?? 0 }; this.reason = reason;
  }
  private pendingClear(): void { this.rows = []; this.pendingUsd = 0; this.pendingTokens = 0; this.pendingSources.clear(); }
  breakContinuity(): void {
    this.baseline = undefined; this.cut = undefined; this.aligned = false;
    this.pendingClear(); this.history = []; this.localPoint = undefined; this.times = {};
    this.status('continuity-gap', 'baseline-retired');
  }
  reset(): void { this.breakContinuity(); this.runs.clear(); this.lastSamples.clear(); this.context = undefined; this.status('source-unavailable', 'proof-missing'); }
  invalidateThrough(account: string, through: number): void {
    for (const [key, run] of this.runs) if (run.account === account && run.from <= through) this.runs.delete(key);
    for (const [key, point] of this.lastSamples) if (point.account === account) this.lastSamples.delete(key);
    if (this.baseline?.sample.accountScopeKey === account) this.breakContinuity();
  }
  private amount(rows: readonly Row[], book: CodexCalibrationPricebook): { usd: number; tokens: number; sources: Set<string> } {
    const rates = new Map(book.rates.map(r => [r.model, r]));
    let usd = 0, tokens = 0; const sources = new Set<string>();
    for (const row of rows) {
      const rate = rates.get(row.model)!; const cached = row.tokens.cachedInput ?? 0;
      usd += (row.tokens.inputTotal - cached) * rate.input + cached * rate.cachedInput + row.tokens.outputTotal * rate.output;
      tokens += row.tokens.inputTotal + row.tokens.outputTotal; sources.add(row.sourceKey);
    }
    return { usd, tokens, sources };
  }
  private seal(at: number, book: CodexCalibrationPricebook): boolean {
    const prefix = this.rows.filter(row => row.through <= at), amount = this.amount(prefix, book);
    this.rows = this.rows.filter(row => row.through > at);
    this.pendingUsd += amount.usd; this.pendingTokens += amount.tokens;
    for (const key of amount.sources) this.pendingSources.add(key);
    return Number.isFinite(this.pendingUsd) && this.pendingUsd <= 1e12 && Number.isSafeInteger(this.pendingTokens) &&
      this.pendingSources.size <= 16384 && this.rows.length <= 2048 && Buffer.byteLength(JSON.stringify(this.rows)) <= 256 * 1024;
  }
  observe(sample: OfficialQuotaSample, proof: unknown, rawBook: unknown): LocalWeeklyEstimate | undefined {
    const epoch = copyCodexQuotaEpoch(sample.quotaEpoch), book = copyCodexCalibrationPricebook(rawBook);
    const prior = this.baseline;
    this.times = { ...(isCodexForwardCalibration(proof) && proof.verifiedAt <= sample.observedAt
      ? { proofAgeMs: sample.observedAt - proof.verifiedAt } : {}),
      ...(prior && sample.observedAt >= prior.sample.observedAt ? { bracketGapMs: sample.observedAt - prior.sample.observedAt } : {}) };
    const blocked = sample.usedPercent >= 100 || sample.ordinaryUsageAllowed === false || sample.spendControlReached === true;
    if (!epoch || !book || typeof sample.accountScopeKey !== 'string' || !HEX.test(sample.accountScopeKey) ||
      typeof sample.sourceScopeKey !== 'string' || !HEX.test(sample.sourceScopeKey) ||
      !validTime(sample.requestedAt) || !validTime(sample.observedAt) || sample.requestedAt > sample.observedAt ||
      sample.observedAt - sample.requestedAt > 30000 || !Number.isFinite(sample.usedPercent) || sample.usedPercent < 0 ||
      !(sample.planType == null || typeof sample.planType === 'string' && /^[a-z0-9_]{1,64}$/.test(sample.planType)) ||
      !(sample.ordinaryUsageAllowed == null || typeof sample.ordinaryUsageAllowed === 'boolean') ||
      !(sample.spendControlReached == null || typeof sample.spendControlReached === 'boolean') ||
      blocked || !codexQuotaEpochFitsObservation(epoch, sample.observedAt, sample.resetAt) || sample.resetAt <= sample.observedAt ||
      !isCodexForwardCalibration(proof) || proof.verifiedAt > sample.requestedAt || sample.observedAt - proof.verifiedAt > MAX_GAP) {
      const reason: CodexCalibrationReason = blocked ? 'quota-blocked' : !book ? 'invalid-pricebook' :
        !isCodexForwardCalibration(proof) ? 'proof-missing' : proof.verifiedAt > sample.requestedAt ? 'proof-future' :
        sample.observedAt - proof.verifiedAt > MAX_GAP ? 'proof-stale' : 'invalid-sample';
      const times = this.times; this.reset(); this.times = times;
      this.status(blocked ? 'quota-blocked' : 'source-unavailable', reason); return;
    }
    const context = JSON.stringify([sample.sourceScopeKey, proof.indexGeneration, book,
      sample.planType ?? null, sample.spendControlReached ?? null, sample.ordinaryUsageAllowed ?? null]);
    const key = JSON.stringify([sample.accountScopeKey, context, epoch]);
    if (this.used.has(proof)) {
      if (prior?.proof === proof && prior.key === key && prior.sample.usedPercent === sample.usedPercent &&
        sample.requestedAt > prior.sample.observedAt && sample.observedAt - prior.sample.observedAt <= MAX_GAP) {
        prior.sample = { ...prior.sample, requestedAt: sample.requestedAt, observedAt: sample.observedAt };
        this.lastSamples.set(key, { account: sample.accountScopeKey, percent: sample.usedPercent, at: sample.observedAt });
        this.history.push({ requestedAt: sample.requestedAt, observedAt: sample.observedAt, usedPercent: sample.usedPercent });
        this.history = this.history.slice(-32); this.reason = 'proof-reused-noop'; return;
      }
      this.breakContinuity(); this.status('continuity-gap', 'proof-reused'); return;
    }
    this.used.add(proof);
    const safe: OfficialQuotaSample = { accountScopeKey: sample.accountScopeKey, sourceScopeKey: sample.sourceScopeKey,
      requestedAt: sample.requestedAt, observedAt: sample.observedAt, resetAt: sample.resetAt, usedPercent: sample.usedPercent,
      quotaEpoch: epoch, planType: sample.planType, ordinaryUsageAllowed: sample.ordinaryUsageAllowed, spendControlReached: sample.spendControlReached };
    if (this.context !== undefined && this.context !== context) { this.breakContinuity(); this.runs.clear(); this.lastSamples.clear(); }
    this.context = context;
    const last = this.lastSamples.get(key);
    if (last && sample.requestedAt <= last.at) { this.breakContinuity(); this.status('continuity-gap', 'observation-order'); return; }
    if (last && sample.usedPercent < last.percent) this.runs.delete(key);
    this.lastSamples.delete(key); this.lastSamples.set(key, { account: sample.accountScopeKey, percent: sample.usedPercent, at: sample.observedAt });
    if (this.lastSamples.size > 64) this.lastSamples.delete(this.lastSamples.keys().next().value!);
    const replace = (state: CodexCalibrationState, reason: CodexCalibrationReason) => {
      const times = this.times; this.breakContinuity(); this.times = times;
      this.baseline = { sample: safe, proof, key, book }; this.history = [safe]; this.status(state, reason);
    };
    if (!this.baseline || this.baseline.key !== key || sample.requestedAt <= this.baseline.sample.observedAt ||
      sample.observedAt - this.baseline.sample.observedAt > MAX_GAP || last && sample.usedPercent < last.percent) {
      replace('baseline', last && sample.usedPercent < last.percent ? 'counter-correction' : !this.baseline ? 'baseline-empty' : 'observation-gap'); return;
    }
    const before = this.baseline;
    const delta = collectCodexForwardSliceDelta(before.proof, proof, book);
    if (!delta || delta.rows.some(row => row.through > sample.requestedAt)) { replace('append-incomplete', 'append-incomplete'); return; }
    this.baseline = { sample: safe, proof, key, book };
    this.rows.push(...delta.rows);
    this.rows.sort((a, b) => a.through - b.through || a.from - b.from);
    // Every newly supplied local quota is checked, including RPC-edge points
    // not chosen as monetary cuts. Corrections cannot silently re-enter a run.
    let checkedPoint = this.localPoint;
    for (const row of this.rows) if (row.quota) {
      const q = row.quota;
      const precedingOfficial = this.history.filter(point => point.observedAt < q.observedAt).slice(-1)[0];
      const followingOfficial = this.history.find(point => point.requestedAt >= q.observedAt);
      if (q.resetAt !== sample.resetAt || q.usedPercent > sample.usedPercent ||
        precedingOfficial && q.usedPercent < precedingOfficial.usedPercent ||
        followingOfficial && q.usedPercent > followingOfficial.usedPercent ||
        checkedPoint && (q.observedAt < checkedPoint.at || q.usedPercent < checkedPoint.percent ||
          q.observedAt === checkedPoint.at && q.usedPercent !== checkedPoint.percent)) {
        this.runs.delete(key); replace('endpoint-mismatch', 'endpoint-mismatch'); return;
      }
      checkedPoint = { at: q.observedAt, percent: q.usedPercent };
      // The manifest proves a global ordering cut only through its verification
      // start. Later rows remain reorderable with another source's next tail.
      if (q.observedAt <= proof.verifiedAt) this.localPoint = checkedPoint;
    }
    const lower = this.cut?.at ?? this.history[0].observedAt;
    const byStart = [...this.rows].sort((a, b) => a.from - b.from);
    let started = 0, latestThrough = 0;
    const points = this.rows.filter(row => row.quota && row.through > lower && row.through <= proof.verifiedAt &&
      (() => {
        while (started < byStart.length && byStart[started].from <= row.through) {
          latestThrough = Math.max(latestThrough, byStart[started++].through);
        }
        return latestThrough <= row.through;
      })());
    const right = points[points.length - 1]?.quota;
    const anchorFor = (at: number): Point | undefined => this.history.filter(point => point.observedAt < at).slice(-1)[0] ??
      (this.cut && this.cut.anchor.observedAt < at ? this.cut.anchor : undefined);
    let result: LocalWeeklyEstimate | undefined;
    if (!this.cut && right) {
      const anchor = anchorFor(right.observedAt);
      if (!anchor || right.usedPercent < anchor.usedPercent) { replace('endpoint-mismatch', 'endpoint-mismatch'); return; }
      this.cut = { at: right.observedAt, percent: right.usedPercent, anchor };
      this.aligned = right.usedPercent - anchor.usedPercent >= 1;
      this.pendingClearAfter(right.observedAt);
      this.status(this.aligned ? 'first-step-discarded' : 'percentage-step', this.aligned ? 'first-step-discarded' : 'percentage-step');
    } else if (this.cut && right && right.usedPercent - this.cut.percent >= 1) {
      const left = this.cut, amount = this.amount(this.rows.filter(row => row.through <= right.observedAt), book);
      const usd = this.pendingUsd + amount.usd, tokens = this.pendingTokens + amount.tokens;
      const sources = new Set([...this.pendingSources, ...amount.sources]);
      const anchor = anchorFor(right.observedAt);
      if (!anchor) { replace('endpoint-mismatch', 'endpoint-mismatch'); return; }
      if (!this.aligned) { this.aligned = true; this.status('first-step-discarded', 'first-step-discarded'); }
      else if (usd > 0 && tokens > 0 && Number.isSafeInteger(tokens)) {
        const old = this.runs.get(key), points = right.usedPercent - left.percent;
        const run: Run = { account: sample.accountScopeKey, from: old?.from ?? left.at,
          usd: (old?.usd ?? 0) + usd, tokens: (old?.tokens ?? 0) + tokens,
          points: (old?.points ?? 0) + points, intervals: (old?.intervals ?? 0) + 1 };
        const full = run.usd / (run.points / 100);
        const evidence = copyCodexCalibrationEvidence({ schemaVersion: 1, methodVersion: 2,
          collectionMode: 'forward-matched-cut-v1', pricebook: book,
          interval: { from: left.anchor.observedAt, through: sample.observedAt,
            requestedFrom: left.anchor.requestedAt, requestedThrough: sample.requestedAt,
            percentFrom: left.anchor.usedPercent, percentThrough: sample.usedPercent,
            deltaUsd: usd, pricedTokens: tokens, totalTokens: tokens, linkedSources: sources.size, excludedSources: 0, continuityGap: false },
          matchedCut: { from: left.at, through: right.observedAt, percentFrom: left.percent, percentThrough: right.usedPercent },
          accumulated: { intervals: run.intervals, deltaPercent: run.points, deltaUsd: run.usd, pricedTokens: run.tokens, totalTokens: run.tokens } });
        if (!evidence || !Number.isFinite(full) || full <= 0 || full > 1e12) { replace('append-incomplete', 'evidence-invalid'); return; }
        this.runs.delete(key); this.runs.set(key, run);
        if (this.runs.size > 64) this.runs.delete(this.runs.keys().next().value!);
        this.status(run.points >= CODEX_MIN_CALIBRATION_PERCENT ? 'calibrated' : 'accumulating', run.points >= CODEX_MIN_CALIBRATION_PERCENT ? 'calibrated' : 'accumulating');
        result = { provider: 'codex', method: 'account-delta-v1', accountScopeKey: sample.accountScopeKey,
          windowStart: epoch.startLowerAt ?? epoch.startedAt, resetAt: sample.resetAt, observedAt: sample.observedAt,
          estimatedAt: sample.observedAt, usedEquivalentUsd: run.usd, fullEquivalentUsd: full,
          unusedEquivalentUsd: full * (1 - sample.usedPercent / 100), utilizationPercent: sample.usedPercent,
          pricingCoverage: 1, calibrationStart: run.from, quotaEpoch: epoch, calibrationEvidence: evidence,
          flags: ['account-unattributed', 'boundary-uncertain'] };
      }
      this.cut = { at: right.observedAt, percent: right.usedPercent, anchor }; this.pendingClearAfter(right.observedAt);
    } else this.status('percentage-step', 'percentage-step');
    if (this.cut) {
      if (!this.seal(proof.verifiedAt, book)) { replace('append-incomplete', 'counter-overflow'); return; }
    } else this.rows = this.rows.filter(row => row.through > proof.verifiedAt);
    this.history.push(safe); this.history = this.history.slice(-32);
    return result;
  }
  private pendingClearAfter(at: number): void {
    const rest = this.rows.filter(row => row.through > at); this.pendingClear(); this.rows = rest;
  }
}
