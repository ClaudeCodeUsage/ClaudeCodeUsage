import type { LocalWeeklyEstimate } from './weeklyEstimate';
import type { WeeklyValueInputs } from './weeklyValue';
import type { CodexQuotaCheckpoint } from './providers/codex/codexQuotaCheckpoints';
import { copyCodexCalibrationPricebook } from './codexCalibrationEvidence';
import { CodexWindowEvidence, CODEX_MIN_CALIBRATION_PERCENT } from './codexWindowEvidence';
import { CodexQuotaCycle, codexFallbackQuotaCycle } from './codexQuotaCycles';

const WEEK = 604_800_000, TOLERANCE = 300_000;
type Pair = { from: number; through: number; low: number; high: number; usd: number; priced: number; total: number; source: string; valid: boolean };
/** Union of observed percentage intervals, never a sum of duplicate account-wide
 * counters from concurrently logged requests. Unobserved switch gaps stay out. */
function coveredPercent(pairs: readonly Pair[]): number {
  let total = 0, end = -1;
  for (const pair of [...pairs].sort((a, b) => a.low - b.low)) {
    total += Math.max(0, pair.high - Math.max(end, pair.low)); end = Math.max(end, pair.high);
  }
  return total;
}

/** Uses paired, lineage-admitted numeric checkpoints only. The result remains
 * an unassigned local-window proxy: matching reset times never identify users
 * or prove complete cross-device usage. No daily interpolation or source I/O. */
export function buildCodexWindowEstimates(inputs: WeeklyValueInputs,
  options: { now: number; minimumObservedAt?: number; windowKey?: (resetAt: number, startedAt: number) => string }): LocalWeeklyEstimate[] {
  const book = copyCodexCalibrationPricebook(inputs.calibrationPricebook);
  if (!book || !Number.isFinite(options.now)) return [];
  const rates = new Map(book.rates.map(rate => [rate.model, rate]));
  const points = (inputs.codexQuotaCheckpoints ?? []).filter(row => Number.isSafeInteger(row.through) &&
    row.through > (options.minimumObservedAt ?? 0) && row.through <= options.now && Number.isSafeInteger(row.resetAt) && row.resetAt > row.through &&
    row.resetAt - row.through <= WEEK && Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100)
    .slice().sort((a, b) => a.through - b.through || a.sourceKey.localeCompare(b.sourceKey) || a.segment - b.segment);
  const windows: Array<{ resetAt: number; points: CodexQuotaCheckpoint[] }> = [];
  const windowBuckets = new Map<number, typeof windows>();
  for (const point of points) {
    const bucket = Math.floor(point.resetAt / TOLERANCE);
    let window = [bucket - 1, bucket, bucket + 1].flatMap(b => windowBuckets.get(b) ?? [])
      .find(x => Math.abs(x.resetAt - point.resetAt) <= TOLERANCE);
    if (!window) { window = { resetAt: point.resetAt, points: [] }; windows.push(window);
      windowBuckets.set(bucket, [...(windowBuckets.get(bucket) ?? []), window]); }
    window.points.push(point);
  }
  const price = (point: Pick<CodexQuotaCheckpoint, 'byModel'>) => {
    let usd = 0, priced = 0, total = 0, valid = true;
    for (const [model, tokens] of Object.entries(point.byModel)) {
      const input = tokens.inputTotal, cached = tokens.cachedInput ?? 0, output = tokens.outputTotal;
      if (![input, cached, output].every(n => Number.isSafeInteger(n) && n >= 0) || cached > input) { valid = false; continue; }
      const n = input + output, rate = rates.get(model); total += n;
      if (rate) { usd += (input - cached) * rate.input + cached * rate.cachedInput + output * rate.output; priced += n; }
    }
    return { usd, priced, total, valid };
  };
  const result: LocalWeeklyEstimate[] = [];
  for (const window of windows) {
    const previous = new Map<string, CodexQuotaCheckpoint>(), rawDrops: Array<{ at: number; lower: number }> = [], dropTimes = new Set<number>();
    for (const point of window.points) {
      const old = previous.get(point.sourceKey);
      if (old && point.baseline && (old.usedPercent - point.usedPercent >= 15 || point.usedPercent === 0 && old.usedPercent > 0) && point.through > old.through &&
        !dropTimes.has(point.through)) { rawDrops.push({ at: point.through, lower: old.through }); dropTimes.add(point.through); }
      previous.set(point.sourceKey, point);
    }
    // Concurrent logs observe the same discontinuity at different times.
    // Intersect overlapping brackets; do not count each observer as a reset.
    const drops: Array<{ at: number; lower: number }> = [];
    for (const row of rawDrops.sort((a, b) => a.at - b.at)) {
      const old = drops[drops.length - 1];
      if (old && row.lower <= old.at && old.lower <= row.at) {
        old.lower = Math.max(old.lower, row.lower); old.at = Math.min(old.at, row.at);
      } else drops.push({ ...row });
    }
    const episodes = [window.points[0].through, ...drops.map(x => x.at)].sort((a, b) => a - b);
    let episodeCursor = 0;
    for (let i = 0; i < episodes.length; i++) {
      const start = episodes[i], end = episodes[i + 1] ?? window.resetAt;
      const firstRow = episodeCursor;
      while (episodeCursor < window.points.length && window.points[episodeCursor].through < end) episodeCursor++;
      const rows = window.points.slice(firstRow, episodeCursor);
      if (!rows.length) continue;
      const latest = rows[rows.length - 1], baselines = new Map<string, CodexQuotaCheckpoint>(), pairs: Pair[] = [];
      const scopeComplete = inputs.codexQuotaIncompleteRanges !== undefined ? true : inputs.codexQuotaIncompleteResets === undefined ? inputs.codexQuotaCheckpointsComplete !== false :
        !inputs.codexQuotaIncompleteResets.some(reset => Math.abs(reset - window.resetAt) <= TOLERANCE);
      for (const point of rows) {
        const key = point.sourceKey + ':' + point.segment, before = baselines.get(key);
        if (!before || point.baseline) { baselines.set(key, point); continue; }
        if (point.usedPercent <= before.usedPercent || point.usedPercent >= 100) continue;
        const first = price(before), last = price(point), usd = last.usd - first.usd,
          priced = last.priced - first.priced, total = last.total - first.total;
        if (!first.valid || !last.valid || usd < 0 || priced < 0 || total < priced || point.through <= before.through) {
          baselines.set(key, point); continue;
        }
        // A quota-only increase has an unknown cause. Do not call it external
        // traffic and remove its denominator to inflate a later estimate.
        pairs.push({ from: before.through, through: point.through, low: before.usedPercent,
          high: point.usedPercent, usd, priced, total, source: point.sourceKey, valid: before.complete && point.complete });
        baselines.set(key, point);
      }
      // A missing numerator anywhere inside overlapping observers invalidates
      // their WHOLE shared interval, not just the missing source's dollars.
      // Touching intervals remain separate so a later clean sample can recover.
      const components: Pair[][] = [];
      let componentEnd = -1;
      for (const pair of pairs.sort((a, b) => a.from - b.from || a.through - b.through)) {
        if (pair.from >= componentEnd) { components.push([pair]); componentEnd = pair.through; }
        else { components[components.length - 1].push(pair); componentEnd = Math.max(componentEnd, pair.through); }
      }
      type Sample = { pairs: Pair[]; from: number; through: number; low: number; high: number; usd: number; priced: number; total: number; sources: Set<string>; valid: boolean; conflict: boolean };
      const gaps = (inputs.codexQuotaIncompleteRanges ?? []).filter(gap => gap.resetAt === undefined || Math.abs(gap.resetAt - window.resetAt) <= TOLERANCE)
        .slice().sort((a, b) => a.from - b.from);
      const lowerBound = (at: number) => { let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >>> 1;
        if (rows[m].through < at) lo = m + 1; else hi = m; } return lo; };
      let gapCursor = 0;
      const samples: Sample[] = components.map(group => {
        const from = Math.min(...group.map(p => p.from)), through = Math.max(...group.map(p => p.through));
        const sample: Sample = { pairs: group, from, through, low: Math.min(...group.map(p => p.low)), high: Math.max(...group.map(p => p.high)),
          usd: group.reduce((n, p) => n + p.usd, 0), priced: group.reduce((n, p) => n + p.priced, 0),
          total: group.reduce((n, p) => n + p.total, 0), sources: new Set(group.map(p => p.source)),
          valid: scopeComplete && group.every(p => p.valid), conflict: false };
        while (gapCursor < gaps.length && gaps[gapCursor].through <= from) gapCursor++;
        if (gapCursor < gaps.length && gaps[gapCursor].from < through) sample.valid = false;
        let maxPercent = -1;
        // Sweep enclosing intervals. Only the furthest two distinct sources
        // matter when asking whether a baseline has another observer around it.
        let pairCursor = 0;
        const active = new Map<string, number>();
        let furthest: Array<{ source: string; end: number }> = [];
        for (let r = lowerBound(from); r < rows.length && rows[r].through <= through; r++) {
          const row = rows[r];
          if (row.usedPercent < maxPercent || row.usedPercent < sample.low || row.usedPercent > sample.high) {
            sample.valid = false; sample.conflict = true;
          }
          maxPercent = Math.max(maxPercent, row.usedPercent);
          while (pairCursor < group.length && group[pairCursor].from < row.through) {
            const p = group[pairCursor++];
            if (p.through > (active.get(p.source) ?? -1)) {
              active.set(p.source, p.through);
              furthest = [...furthest.filter(x => x.source !== p.source), { source: p.source, end: p.through }]
                .sort((a, b) => b.end - a.end).slice(0, 2);
            }
          }
          if (!row.baseline || !furthest.some(x => x.source !== row.sourceKey && x.end >= row.through)) continue;
          if (row.baselineByModel === undefined || !row.complete) { sample.valid = false; continue; }
          const amount = price({ byModel: row.baselineByModel });
          if (!amount.valid) { sample.valid = false; continue; }
          sample.usd += amount.usd; sample.priced += amount.priced; sample.total += amount.total;
          if (amount.total > 0) sample.sources.add(row.sourceKey);
        }
        if (sample.usd <= 0 || sample.total <= 0 || sample.priced !== sample.total) sample.valid = false;
        return sample;
      });
      // A small counter correction starts a new calibration cohort, not a new
      // quota cycle. Keep the strongest coherent cohort and its own as-of fact.
      // Maximum-weight compatible chain: a minor intervening correction does
      // not erase a stronger earlier cohort. Fenwick prefix maxima bound this
      // to O(n log n), with real percentage precision rather than integer bins.
      const candidates = samples.filter(s => s.valid), highs = [...new Set(candidates.map(s => s.high))].sort((a, b) => a - b);
      type Chain = { sample: Sample; weight: number; previous?: Chain };
      const tree: Array<Chain | undefined> = new Array(highs.length + 1);
      const better = (a: Chain | undefined, b: Chain | undefined) => !a ? b : !b ? a :
        a.weight > b.weight || a.weight === b.weight && a.sample.through > b.sample.through ? a : b;
      const upper = (p: number) => { let lo = 0, hi = highs.length; while (lo < hi) { const m = (lo + hi) >>> 1;
        if (highs[m] <= p) lo = m + 1; else hi = m; } return lo; };
      let best: Chain | undefined;
      for (const sample of candidates) {
        let previous: Chain | undefined;
        for (let at = upper(sample.low); at > 0; at -= at & -at) previous = better(previous, tree[at]);
        const chain: Chain = { sample, weight: (previous?.weight ?? 0) + coveredPercent(sample.pairs), previous };
        for (let at = upper(sample.high); at < tree.length; at += at & -at) tree[at] = better(tree[at], chain);
        best = better(best, chain);
      }
      const selected: Sample[] = [];
      for (let chain = best; chain; chain = chain.previous) selected.push(chain.sample);
      selected.reverse();
      const admitted = selected.flatMap(s => s.pairs), selectedSet = new Set(selected);
      const rejected = samples.filter(s => !selectedSet.has(s));
      const complete = selected.length > 0, conflict = samples.some(s => s.conflict);
      const deltaUsd = selected.reduce((n, s) => n + s.usd, 0), pricedTokens = selected.reduce((n, s) => n + s.priced, 0),
        totalTokens = selected.reduce((n, s) => n + s.total, 0), deltaPercent = coveredPercent(admitted);
      const sources = new Set(selected.flatMap(s => [...s.sources]));
      const asOf = selected[selected.length - 1];
      const observedAt = asOf?.through ?? latest.through, percentThrough = asOf?.high ?? latest.usedPercent;
      const full = complete && deltaPercent >= CODEX_MIN_CALIBRATION_PERCENT && deltaUsd > 0 && pricedTokens === totalTokens
        ? deltaUsd / (deltaPercent / 100) : null;
      const startDrop = i > 0 ? drops[i - 1] : undefined, nextDrop = drops[i];
      // Where real boundaries are unavailable, keep one stable seven-day
      // reference bucket anchored to the window's FIRST observed point. A
      // redraw or crossing Monday never splits a retained counter window.
      const cycle: CodexQuotaCycle = drops.length ? { id: start, startAt: startDrop ? start : null,
        startLowerAt: startDrop?.lower ?? null, endAt: end, endLowerAt: nextDrop?.lower ?? end,
        closed: nextDrop !== undefined || end <= options.now, scheduledResetAt: window.resetAt,
        boundaryUncertain: true, referenceOnly: true } : codexFallbackQuotaCycle({ observedAt: start, resetAt: window.resetAt }, options.now);
      const evidence: CodexWindowEvidence = { schemaVersion: 1, methodVersion: 1,
        from: selected[0]?.from ?? observedAt, through: observedAt,
        calibratedThrough: asOf?.through ?? observedAt,
        percentFrom: selected[0]?.low ?? percentThrough, percentThrough,
        deltaPercent, deltaUsd, pricedTokens, totalTokens, intervals: admitted.length,
        sources: sources.size, excludedUsd: 0, skippedIntervals: rejected.reduce((n, s) => n + s.pairs.length, 0),
        skippedUsd: rejected.reduce((n, s) => n + s.usd, 0), complete, pricebook: book, cycle };
      // Contradictory endpoints cannot form an admitted calibration interval.
      // Preserve the window and latest fact, with rejected USD explicitly
      // separate; do not serialize an impossible positive-delta receipt.
      if (evidence.percentThrough < evidence.percentFrom ||
        evidence.deltaPercent > evidence.percentThrough - evidence.percentFrom + 1e-10) {
        evidence.excludedUsd = evidence.deltaUsd; evidence.deltaUsd = 0; evidence.deltaPercent = 0;
        evidence.pricedTokens = 0; evidence.totalTokens = 0; evidence.intervals = 0; evidence.sources = 0;
        evidence.from = latest.through; evidence.calibratedThrough = latest.through;
        evidence.percentFrom = latest.usedPercent; evidence.complete = false;
      }
      const finiteFull = evidence.complete && full !== null && Number.isFinite(full) && full > 0 && full <= 1e12 ? full : null;
      result.push({ provider: 'codex', windowStart: Math.min(window.resetAt - WEEK, start), resetAt: window.resetAt,
        observedAt, estimatedAt: options.now, usedEquivalentUsd: evidence.deltaUsd,
        fullEquivalentUsd: finiteFull, unusedEquivalentUsd: finiteFull === null ? null : finiteFull * (1 - percentThrough / 100),
        utilizationPercent: percentThrough, pricingCoverage: evidence.totalTokens > 0 ? evidence.pricedTokens / evidence.totalTokens : 0,
        method: 'series-prefix-v1', flags: ['account-unattributed', 'reconstructed',
          ...(!complete ? ['partial-history' as const] : []), ...(conflict && !complete ? ['counter-change' as const] : []),
          ...(pricedTokens < totalTokens ? ['partial-pricing' as const] : [])],
        ...(evidence.from < observedAt ? { calibrationStart: evidence.from } : {}),
        windowEvidence: evidence, quotaCycle: cycle, localWindowNumber: result.length + 1,
        ...(options.windowKey ? { localWindowKey: options.windowKey(window.resetAt, i === 0 ? 0 : start) } : {}) });
    }
  }
  return result.sort((a, b) => b.observedAt - a.observedAt);
}
