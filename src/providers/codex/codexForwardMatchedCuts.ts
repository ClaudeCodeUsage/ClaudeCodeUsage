import { copyCodexCalibrationPricebook } from '../../codexCalibrationEvidence';
import { CodexForwardCalibration, CodexForwardCalibrationSource, isCodexForwardCalibration,
  isCodexForwardAppend, isCodexForwardBirth } from './codexForwardCalibration';
import type { CodexForwardUsageSlice } from './codexForwardSlices';

/** A candidate local monetary interval, NOT an official RPC interval or receipt.
 * No runtime estimator/archive route consumes this yet. Numeric evidence only;
 * no reads, account attribution, state restoration, percentage interpolation or
 * implicit admission based on the containing official percentage difference. */
export interface CodexForwardMatchedInterval {
  from: number; through: number; percentFrom: number; percentThrough: number;
  deltaPercent: number; deltaUsd: number; pricedTokens: number; totalTokens: number; linkedSources: number;
  officialEnvelope: { from: number; through: number; resetAt: number; percentFrom: number; percentThrough: number };
}
type Envelope = CodexForwardMatchedInterval['officialEnvelope'];
const parts = ['inputTotal', 'cachedInput', 'outputTotal', 'reasoningOutput'] as const;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown): v is number => integer(v) && v > 0;
const percent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100;

function detail(before: CodexForwardCalibrationSource | undefined, after: CodexForwardCalibrationSource): readonly CodexForwardUsageSlice[] | undefined {
  if (!after.eligible || !after.byModel || before && (!before.eligible || !before.byModel || !isCodexForwardAppend(before, after))) return;
  const start = before?.offset ?? 0, rows: CodexForwardUsageSlice[] = [];
  let offset = start, last: number | null = null;
  if (after.appendWindow?.complete === false) return;
  for (const w of after.appendWindows ?? []) {
    if (w.throughOffset <= offset) continue;
    if (!w.complete || w.beforeOffset !== offset || w.throughOffset > after.offset || !w.slices) return;
    for (const slice of w.slices) {
      if (last !== null && slice.from < last || before?.usageThrough !== null && before?.usageThrough !== undefined &&
        slice.from <= before.usageThrough) return;
      rows.push(slice); last = slice.through;
    }
    offset = w.throughOffset;
  }
  if (offset !== after.offset) return;
  // Reconcile the ENTIRE physical append, including dollars outside the proposed
  // monetary cut. Missing/overflowed detail cannot be mistaken for zero usage.
  const sums = new Map<string, number[]>();
  for (const row of rows) {
    const sum = sums.get(row.model) ?? [0, 0, 0, 0];
    parts.forEach((key, i) => { sum[i] += row.tokens[key] ?? 0; });
    if (!sum.every(integer)) return;
    sums.set(row.model, sum);
  }
  for (const model of new Set([...Object.keys(before?.byModel ?? {}), ...Object.keys(after.byModel), ...sums.keys()])) {
    if (parts.some((key, i) => {
      const delta = (after.byModel![model]?.[key] ?? 0) - (before?.byModel?.[model]?.[key] ?? 0);
      return !integer(delta) || delta !== (sums.get(model)?.[i] ?? 0);
    })) return;
  }
  return rows;
}

export function projectCodexForwardMatchedCuts(before: unknown, after: unknown, envelope: Envelope,
  rawBook: unknown): CodexForwardMatchedInterval | undefined {
  const book = copyCodexCalibrationPricebook(rawBook);
  if (!book || !isCodexForwardCalibration(before) || !isCodexForwardCalibration(after) ||
    before === after || before.indexGeneration !== after.indexGeneration ||
    !time(envelope.from) || !time(envelope.through) || !time(envelope.resetAt) ||
    envelope.through <= envelope.from || envelope.through - envelope.from > 300000 ||
    envelope.resetAt <= envelope.through || before.verifiedAt > envelope.from ||
    envelope.from - before.verifiedAt > 300000 ||
    after.verifiedAt <= envelope.from || after.verifiedAt > envelope.through ||
    !percent(envelope.percentFrom) || !percent(envelope.percentThrough) ||
    envelope.percentThrough < envelope.percentFrom ||
    before.sources.some(s => s.usageThrough !== null && s.usageThrough > envelope.from)) return;
  const old = new Map(before.sources.map(s => [s.sourceKey, s]));
  const current = new Map(after.sources.map(s => [s.sourceKey, s]));
  if (before.sources.some(s => current.get(s.sourceKey)?.continuity !== s.continuity)) return;
  const all: Array<{ row: CodexForwardUsageSlice; source: number }> = [];
  for (const [source, s] of after.sources.entries()) {
    const prior = old.get(s.sourceKey);
    if (prior?.revision === s.revision) continue;
    if (!prior && !isCodexForwardBirth(before, s)) return;
    const rows = detail(prior, s); if (!rows) return;
    if (rows.some(row => row.from <= before.verifiedAt || row.through > envelope.through)) return;
    all.push(...rows.map(row => ({ row, source })));
  }
  const upper = Math.min(envelope.through, after.verifiedAt);
  const points = all.filter(({ row }) => row.quota && row.through > envelope.from && row.through <= upper)
    .map(({ row }) => row.quota!).sort((a, b) => a.observedAt - b.observedAt);
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], prev = points[i - 1];
    if (p.resetAt !== envelope.resetAt || p.usedPercent < envelope.percentFrom || p.usedPercent > envelope.percentThrough ||
      prev && (p.usedPercent < prev.usedPercent || p.observedAt === prev.observedAt && p.usedPercent !== prev.usedPercent)) return;
  }
  const left = points[0], right = points[points.length - 1], deltaPercent = right.usedPercent - left.usedPercent;
  if (right.observedAt <= left.observedAt || deltaPercent < 1) return;
  // The global cut is right-inclusive for EVERY physical source. A request
  // envelope crossing either endpoint makes this candidate indeterminate.
  if (all.some(({ row }) => [left.observedAt, right.observedAt].some(t => row.from <= t && row.through > t))) return;
  const rates = new Map(book.rates.map(rate => [rate.model, rate]));
  if (all.some(({ row }) => !rates.has(row.model))) return;
  let usd = 0, total = 0; const sources = new Set<number>();
  for (const { row, source } of all) {
    if (row.through <= left.observedAt || row.through > right.observedAt) continue;
    const rate = rates.get(row.model); if (!rate) return;
    const input = row.tokens.inputTotal, cached = row.tokens.cachedInput ?? 0, output = row.tokens.outputTotal;
    total += input + output;
    usd += (input - cached) * rate.input + cached * rate.cachedInput + output * rate.output;
    sources.add(source);
  }
  if (!integer(total) || total <= 0 || !Number.isFinite(usd) || usd <= 0 || usd > 1e12) return;
  return { from: left.observedAt, through: right.observedAt, percentFrom: left.usedPercent,
    percentThrough: right.usedPercent, deltaPercent, deltaUsd: usd, pricedTokens: total, totalTokens: total,
    linkedSources: sources.size, officialEnvelope: { from: envelope.from, through: envelope.through,
      resetAt: envelope.resetAt, percentFrom: envelope.percentFrom, percentThrough: envelope.percentThrough } };
}
