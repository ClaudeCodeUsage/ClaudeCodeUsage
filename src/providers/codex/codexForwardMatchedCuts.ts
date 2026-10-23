import { copyCodexCalibrationPricebook } from '../../codexCalibrationEvidence';
import { CodexForwardCalibration, CodexForwardCalibrationSource, isCodexForwardCalibration,
  isCodexForwardAppend, isCodexForwardBirth } from './codexForwardCalibration';
import type { CodexForwardUsageSlice } from './codexForwardSlices';

/** Reference projection of one complete local envelope, NOT an official RPC
 * interval or receipt. Production rolling estimation uses the reconciled slice
 * collector below rather than this non-streaming reference. Numeric evidence only;
 * no reads, account attribution, state restoration, percentage interpolation or
 * implicit admission based on the containing official percentage difference. */
export interface CodexForwardMatchedInterval {
  from: number; through: number; percentFrom: number; percentThrough: number;
  deltaPercent: number; deltaUsd: number; pricedTokens: number; totalTokens: number; linkedSources: number;
  officialEnvelope: { from: number; through: number; resetAt: number; percentFrom: number; percentThrough: number };
}
type Envelope = CodexForwardMatchedInterval['officialEnvelope'];
export interface CodexForwardSliceDelta {
  rows: ReadonlyArray<CodexForwardUsageSlice & { readonly sourceKey: string }>;
  deltaUsd: number;
  totalTokens: number;
}
/** Bounded diagnostics only: never attach source identifiers or raw detail. */
export type CodexForwardSliceFailureReason =
  | 'invalid-pricebook' | 'proof-missing' | 'proof-reused' | 'source-changed'
  | 'observation-order' | 'source-ineligible' | 'append-unproven'
  | 'append-window-incomplete' | 'append-chain-gap' | 'append-window-missing'
  | 'append-vector-invalid' | 'usage-before-baseline' | 'unpriced-usage'
  | 'counter-overflow' | 'birth-unproven' | 'slice-detail-missing' | 'slice-order-invalid';
type SliceFailure = { ok: false; reason: CodexForwardSliceFailureReason };
export type CodexForwardSliceInspection = { ok: true; delta: CodexForwardSliceDelta } | SliceFailure;
const failure = (reason: CodexForwardSliceFailureReason): SliceFailure => ({ ok: false, reason });
const parts = ['inputTotal', 'cachedInput', 'outputTotal', 'reasoningOutput'] as const;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown): v is number => integer(v) && v > 0;
const percent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100;

function detail(before: CodexForwardCalibrationSource | undefined, after: CodexForwardCalibrationSource):
  { ok: true; rows: readonly CodexForwardUsageSlice[] } | SliceFailure {
  if (!after.eligible) return failure('source-ineligible');
  if (!after.byModel) return failure('append-vector-invalid');
  if (before) {
    if (!before.eligible) return failure('source-ineligible');
    if (!before.byModel) return failure('append-vector-invalid');
    if (!isCodexForwardAppend(before, after)) return failure('append-unproven');
  }
  const start = before?.offset ?? 0, rows: CodexForwardUsageSlice[] = [];
  let offset = start, last: number | null = null;
  if (after.appendWindow?.complete === false) return failure('append-window-incomplete');
  for (const w of after.appendWindows ?? []) {
    if (w.throughOffset <= offset) continue;
    if (!w.complete) return failure('append-window-incomplete');
    if (w.beforeOffset !== offset || w.throughOffset > after.offset) return failure('append-chain-gap');
    if (!w.slices) return failure('slice-detail-missing');
    for (const slice of w.slices) {
      if (last !== null && slice.from < last) return failure('slice-order-invalid');
      if (before?.usageThrough !== null && before?.usageThrough !== undefined &&
        slice.from <= before.usageThrough) return failure('usage-before-baseline');
      rows.push(slice); last = slice.through;
    }
    offset = w.throughOffset;
  }
  if (offset !== after.offset) return failure('append-window-missing');
  // Reconcile the ENTIRE physical append, including dollars outside the proposed
  // monetary cut. Missing/overflowed detail cannot be mistaken for zero usage.
  const sums = new Map<string, number[]>();
  for (const row of rows) {
    const sum = sums.get(row.model) ?? [0, 0, 0, 0];
    parts.forEach((key, i) => { sum[i] += row.tokens[key] ?? 0; });
    if (!sum.every(integer)) return failure('counter-overflow');
    sums.set(row.model, sum);
  }
  for (const model of new Set([...Object.keys(before?.byModel ?? {}), ...Object.keys(after.byModel), ...sums.keys()])) {
    if (parts.some((key, i) => {
      const delta = (after.byModel![model]?.[key] ?? 0) - (before?.byModel?.[model]?.[key] ?? 0);
      return !integer(delta) || delta !== (sums.get(model)?.[i] ?? 0);
    })) return failure('append-vector-invalid');
  }
  return { ok: true, rows };
}

/** Whole, reconciled live append only. A caller must separately validate the
 * official/account context and select its own global monetary cuts. */
export function collectCodexForwardSliceDelta(before: unknown, after: unknown, rawBook: unknown): CodexForwardSliceDelta | undefined {
  const result = inspectCodexForwardSliceDelta(before, after, rawBook);
  return result.ok ? result.delta : undefined;
}

/** Same acceptance and math as the collector; the first failing predicate emits
 * only a fixed code. This performs no I/O and grants no estimator admission. */
export function inspectCodexForwardSliceDelta(before: unknown, after: unknown, rawBook: unknown): CodexForwardSliceInspection {
  const book = copyCodexCalibrationPricebook(rawBook);
  if (!book) return failure('invalid-pricebook');
  if (!isCodexForwardCalibration(before) || !isCodexForwardCalibration(after)) return failure('proof-missing');
  if (before === after) return failure('proof-reused');
  if (before.indexGeneration !== after.indexGeneration) return failure('source-changed');
  if (after.verifiedAt <= before.verifiedAt) return failure('observation-order');
  const old = new Map(before.sources.map(s => [s.sourceKey, s]));
  const current = new Map(after.sources.map(s => [s.sourceKey, s]));
  if (before.sources.some(s => current.get(s.sourceKey)?.continuity !== s.continuity)) return failure('source-changed');
  const rows: Array<CodexForwardUsageSlice & { readonly sourceKey: string }> = [];
  const rates = new Map(book.rates.map(r => [r.model, r]));
  let deltaUsd = 0, totalTokens = 0;
  for (const s of after.sources) {
    const prior = old.get(s.sourceKey);
    if (prior?.revision === s.revision) continue;
    if (!prior && !isCodexForwardBirth(before, s)) return failure('birth-unproven');
    const result = detail(prior, s); if (!result.ok) return result;
    for (const row of result.rows) {
      const rate = rates.get(row.model); if (!rate) return failure('unpriced-usage');
      if (row.from <= before.verifiedAt) return failure('usage-before-baseline');
      totalTokens += row.tokens.inputTotal + row.tokens.outputTotal;
      const cached = row.tokens.cachedInput ?? 0;
      deltaUsd += (row.tokens.inputTotal - cached) * rate.input + cached * rate.cachedInput + row.tokens.outputTotal * rate.output;
      if (!integer(totalTokens) || !Number.isFinite(deltaUsd) || deltaUsd > 1e12 || rows.length >= 2048) return failure('counter-overflow');
      rows.push(Object.freeze({ ...row, sourceKey: s.sourceKey }));
    }
  }
  rows.sort((a, b) => a.through - b.through || a.from - b.from || a.sourceKey.localeCompare(b.sourceKey));
  if (Buffer.byteLength(JSON.stringify(rows)) > 256 * 1024) return failure('counter-overflow');
  return { ok: true, delta: { rows: Object.freeze(rows), deltaUsd, totalTokens } };
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
    const result = detail(prior, s); if (!result.ok) return;
    const rows = result.rows;
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
