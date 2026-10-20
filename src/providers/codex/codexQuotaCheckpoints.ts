import type { ProviderTokenCounts } from '../providerTypes';
import type { CodexLineOutput } from './codexParser';
import { codexQuotaObservationsFromLimit, CODEX_QUOTA_RESET_CLUSTER_MS } from './codexQuotaHistory';
import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';
import type { CodexSkippedLineWitness } from './codexJsonlScanner';

/** File-local evidence only. Neither sourceKey, segment nor reset identifies an account.
 * Tokens are cumulative strictly AFTER the baseline line, through this sample.
 * Subtract two rows only within the same sourceKey/segment; never interpolate days. */
export interface CodexQuotaCheckpoint {
  sourceKey: string;
  segment: number;
  from: number;
  through: number;
  resetAt: number;
  /** Original provider reset for this sample; resetAt is the segment's first
   * reset anchor. Optional only for legacy runtime inputs, never v4 storage. */
  observedResetAt?: number;
  usedPercent: number;
  baseline: boolean;
  byModel: Readonly<Record<string, ProviderTokenCounts>>;
  /** Admitted baseline-line request only, for another source's strictly enclosing
   * interval. Never part of this segment's cumulative delta. {} means known zero;
   * absent means unavailable/legacy. Present on baseline rows only. */
  baselineByModel?: Readonly<Record<string, ProviderTokenCounts>>;
  /** Eligibility of this retained segment interval, not account/device coverage.
   * Earlier evicted episodes do not poison a later retained interval. */
  complete: boolean;
}

export interface CodexQuotaIncompleteRange { from: number; through: number; resetAt?: number }
export const CODEX_QUOTA_CHECKPOINT_VERSION = 4;
export const CODEX_QUOTA_GAP_LIMIT = 512;
export const CODEX_QUOTA_RANGE_LIMIT = 65_536;
export const CODEX_QUOTA_CHECKPOINT_LIMIT = 512;
export const CODEX_QUOTA_CHECKPOINT_BYTES = 256 * 1024;
export const CODEX_QUOTA_CHECKPOINT_MODELS = 16;
/** Replay02 measured 47,899 rows / 9.4 MiB before baseline vectors. Retain
 * historical cycles as well as current sources within a fixed 32 MiB ceiling. */
export const CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT = 65_536;
export const CODEX_QUOTA_CHECKPOINT_SNAPSHOT_BYTES = 32 * 1024 * 1024;
/** Payload budget across source and resumable draft states (metadata remains per-file). */
export const CODEX_QUOTA_CHECKPOINT_INDEX_BYTES = 32 * 1024 * 1024;
type Row = Omit<CodexQuotaCheckpoint, 'sourceKey'>;
export interface CodexQuotaCheckpointState {
  ranges: CodexQuotaIncompleteRange[];
  rangesUnlocalized: boolean;
  pendingGapFrom?: number;
  pendingGapUnknown: boolean;
  activityFrom: number;
  activityThrough: number;
  observedTokens: ProviderTokenCounts;
  excludedTokens: ProviderTokenCounts;
  version: typeof CODEX_QUOTA_CHECKPOINT_VERSION;
  indexedThrough: number;
  prefixEvents: number;
  segment: number;
  segmentResetAt: number;
  lastEventAt: number;
  /** Fixed enum distinguishes explicit Codex from an unspecified quota source. */
  source: 0 | 1 | 2;
  pendingBoundary: boolean;
  complete: boolean;
  segmentComplete: boolean;
  overflow: boolean;
  byModel: Record<string, ProviderTokenCounts>;
  rows: Row[];
}

export function createCodexQuotaCheckpointState(prefixEvents: number): CodexQuotaCheckpointState {
  return { version: 4, indexedThrough: 0, prefixEvents, segment: 0, segmentResetAt: 0, lastEventAt: 0, source: 0,
    ranges: [], rangesUnlocalized: false, pendingGapUnknown: false, activityFrom: 0, activityThrough: 0,
    observedTokens: copyTokens({ inputTotal: 0, outputTotal: 0 }),
    excludedTokens: copyTokens({ inputTotal: 0, outputTotal: 0 }),
    pendingBoundary: true, complete: true, segmentComplete: true, overflow: false, byModel: {}, rows: [] };
}

function overflow(state: CodexQuotaCheckpointState): void {
  markCodexQuotaCheckpointGap(state);
  state.overflow = true; state.complete = false; state.segmentComplete = false;
  state.byModel = {}; state.pendingBoundary = true;
}

export function mergeCodexQuotaIncompleteRanges(
  ranges: readonly CodexQuotaIncompleteRange[], limit = CODEX_QUOTA_RANGE_LIMIT,
): CodexQuotaIncompleteRange[] {
  const merged: CodexQuotaIncompleteRange[] = [];
  for (const raw of [...ranges].sort((a, b) => a.from - b.from || a.through - b.through)) {
    const previous = merged[merged.length - 1];
    if (previous && raw.from <= previous.through) {
      previous.through = Math.max(previous.through, raw.through);
      if (previous.resetAt !== raw.resetAt) delete previous.resetAt;
    } else merged.push({ from: raw.from, through: raw.through,
      ...(raw.resetAt !== undefined ? { resetAt: raw.resetAt } : {}) });
  }
  if (merged.length > limit) return [{ from: merged[0].from, through: merged[merged.length - 1].through }];
  return merged;
}

function addRange(state: CodexQuotaCheckpointState, range: CodexQuotaIncompleteRange): void {
  state.complete = false;
  state.ranges = mergeCodexQuotaIncompleteRanges([...state.ranges, range], CODEX_QUOTA_GAP_LIMIT);
}

/** Stream-position witness; the next valid quota baseline closes this bracket. */
export function markCodexQuotaCheckpointGap(state: CodexQuotaCheckpointState, unknown = true): void {
  const previous = state.rows[state.rows.length - 1];
  if (state.pendingGapFrom === undefined) state.pendingGapFrom = previous?.through ?? state.activityThrough;
  state.pendingGapUnknown = state.pendingGapUnknown || unknown;
  state.complete = false; state.pendingBoundary = true; state.segmentComplete = false;
}

export function codexQuotaSkippedLineHandler(
  state: CodexQuotaCheckpointState, admit: () => boolean,
): (witness: CodexSkippedLineWitness) => void {
  let alreadyPending = false;
  return witness => {
    if (!admit()) return;
    if (witness.phase === 'start') {
      alreadyPending = state.pendingGapFrom !== undefined;
      markCodexQuotaCheckpointGap(state);
    } else if (witness.observedAt !== undefined) {
      const time = witness.observedAt;
      addRange(state, { from: time, through: time });
      const previous = state.rows[state.rows.length - 1];
      if (!alreadyPending && time >= (previous?.through ?? 0)) {
        delete state.pendingGapFrom; state.pendingGapUnknown = false;
      }
      state.activityFrom = state.activityFrom > 0 ? Math.min(state.activityFrom, time) : time;
      state.activityThrough = Math.max(state.activityThrough, time);
    }
  };
}

function excludeSegment(state: CodexQuotaCheckpointState, segment: number): void {
  const rows = state.rows.filter(row => row.segment === segment);
  if (rows.length) addRange(state, { from: rows[0].from, through: rows[rows.length - 1].through,
    resetAt: rows[0].resetAt });
}

export function codexQuotaCheckpointStateRanges(state: CodexQuotaCheckpointState): CodexQuotaIncompleteRange[] | undefined {
  if (state.rangesUnlocalized) return undefined;
  const ranges = [...state.ranges];
  if (state.pendingGapFrom !== undefined) ranges.push({ from: state.pendingGapFrom,
    through: state.pendingGapUnknown ? Number.MAX_SAFE_INTEGER : Math.max(state.pendingGapFrom, state.activityThrough) });
  const last = state.rows[state.rows.length - 1];
  if (state.pendingGapFrom === undefined && state.lastEventAt > (last?.through ?? 0)) {
    ranges.push({ from: last?.through ?? state.activityFrom, through: state.lastEventAt });
  }
  return mergeCodexQuotaIncompleteRanges(ranges, CODEX_QUOTA_GAP_LIMIT);
}

function compactCompletedSegments(state: CodexQuotaCheckpointState): void {
  state.rows = state.rows.filter((row, index, rows) => row.segment === state.segment ||
    index === 0 || rows[index - 1].segment !== row.segment ||
    index === rows.length - 1 || rows[index + 1].segment !== row.segment);
}

/** Dropping an entire old segment loses history, not the proof of retained intervals. */
function enforceBudget(state: CodexQuotaCheckpointState): void {
  if (state.rows.length <= CODEX_QUOTA_CHECKPOINT_LIMIT &&
    Buffer.byteLength(JSON.stringify(state)) <= CODEX_QUOTA_CHECKPOINT_BYTES) return;
  compactCompletedSegments(state);
  while (state.rows.length > CODEX_QUOTA_CHECKPOINT_LIMIT ||
    Buffer.byteLength(JSON.stringify(state)) > CODEX_QUOTA_CHECKPOINT_BYTES) {
    const first = state.rows[0];
    if (!first) { overflow(state); return; }
    if (first.segment !== state.segment) {
      excludeSegment(state, first.segment);
      state.rows = state.rows.filter(row => row.segment !== first.segment);
      state.overflow = true; state.complete = false;
    } else {
      // Endpoint compaction keeps the exact baseline-to-endpoint interval.
      // No intermediate timestamp is subsequently advertised as retained.
      state.rows = [first, state.rows[state.rows.length - 1]];
      if (Buffer.byteLength(JSON.stringify(state)) > CODEX_QUOTA_CHECKPOINT_BYTES) {
        excludeSegment(state, state.segment);
        state.rows = []; overflow(state);
      }
      return;
    }
  }
}

/** Prefer recent episodes; never trim a baseline from an otherwise retained episode. */
export function boundCodexQuotaCheckpointStates(
  states: readonly CodexQuotaCheckpointState[], maxBytes = CODEX_QUOTA_CHECKPOINT_INDEX_BYTES,
): void {
  let remaining = Number.isSafeInteger(maxBytes) && maxBytes >= 0
    ? Math.min(maxBytes, CODEX_QUOTA_CHECKPOINT_INDEX_BYTES) : 0;
  const ordered = [...new Set(states)].sort((a, b) =>
    (b.rows[b.rows.length - 1]?.through ?? 0) - (a.rows[a.rows.length - 1]?.through ?? 0));
  for (const state of ordered) {
    const size = () => state.rows.length === 0 && Object.keys(state.byModel).length === 0 && state.ranges.length === 0
      ? 0 : Buffer.byteLength(JSON.stringify([state.rows, state.byModel, state.ranges]));
    if (size() > remaining) compactCompletedSegments(state);
    while (size() > remaining && state.rows.length) {
      const segment = state.rows[0].segment;
      excludeSegment(state, segment);
      state.rows = state.rows.filter(row => row.segment !== segment);
      state.complete = false; state.overflow = true;
      if (segment === state.segment) {
        state.byModel = {}; state.pendingBoundary = true; state.segmentComplete = false;
      }
    }
    if (size() > remaining) {
      state.ranges = mergeCodexQuotaIncompleteRanges(state.ranges, 1);
      if (size() > remaining) { state.ranges = []; state.rangesUnlocalized = true; state.complete = false; }
    }
    remaining = Math.max(0, remaining - size());
  }
}
const components = ['inputTotal', 'cachedInput', 'outputTotal', 'reasoningOutput', 'sourceTotal'] as const;
function copyTokens(value: ProviderTokenCounts): ProviderTokenCounts {
  return { inputTotal: value.inputTotal, cachedInput: value.cachedInput ?? 0,
    outputTotal: value.outputTotal, reasoningOutput: value.reasoningOutput ?? 0,
    sourceTotal: value.inputTotal + value.outputTotal };
}
function copyModels(value: Readonly<Record<string, ProviderTokenCounts>>): Record<string, ProviderTokenCounts> {
  return Object.fromEntries(Object.entries(value).map(([model, tokens]) => [model, copyTokens(tokens)]));
}

export interface CodexQuotaCheckpointSegment {
  sourceKey: string;
  rows: readonly Row[];
  eligible: boolean;
}

/** Select whole segments under numeric payload bounds. Smaller limits support
 * deterministic pressure tests; callers cannot raise the production ceiling. */
export function projectCodexQuotaCheckpointSegments(
  segments: readonly CodexQuotaCheckpointSegment[],
  limits = { maxRows: CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT, maxBytes: CODEX_QUOTA_CHECKPOINT_SNAPSHOT_BYTES },
): { checkpoints: CodexQuotaCheckpoint[]; omittedResets: number[]; omittedRanges: CodexQuotaIncompleteRange[]; complete: boolean } {
  const maxRows = Number.isSafeInteger(limits.maxRows) && limits.maxRows >= 0
    ? Math.min(limits.maxRows, CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT) : 0;
  const maxBytes = Number.isSafeInteger(limits.maxBytes) && limits.maxBytes >= 0
    ? Math.min(limits.maxBytes, CODEX_QUOTA_CHECKPOINT_SNAPSHOT_BYTES) : 0;
  const checkpoints: CodexQuotaCheckpoint[] = [];
  const omittedResets = new Set<number>();
  const omittedRanges: CodexQuotaIncompleteRange[] = [];
  let bytes = 0;
  for (const segment of [...segments].filter(segment => segment.rows.length > 0).sort((a, b) =>
    b.rows[b.rows.length - 1].through - a.rows[a.rows.length - 1].through)) {
    let rows = segment.rows.map(row => ({ ...row, sourceKey: segment.sourceKey,
      byModel: copyModels(row.byModel),
      ...(row.baselineByModel !== undefined ? { baselineByModel: copyModels(row.baselineByModel) } : {}),
      complete: row.complete && segment.eligible }));
    // Count emitted DTO bytes, including source keys and baseline vectors.
    let size = Buffer.byteLength(JSON.stringify(rows));
    if ((checkpoints.length + rows.length > maxRows || bytes + size > maxBytes) && rows.length > 2) {
      rows = [rows[0], rows[rows.length - 1]];
      size = Buffer.byteLength(JSON.stringify(rows));
    }
    if (checkpoints.length + rows.length > maxRows || bytes + size > maxBytes) {
      for (const row of rows) omittedResets.add(row.resetAt);
      omittedRanges.push({ from: rows[0].from, through: rows[rows.length - 1].through, resetAt: rows[0].resetAt });
      continue;
    }
    bytes += size;
    checkpoints.push(...rows);
  }
  checkpoints.sort((a, b) => a.through - b.through || a.segment - b.segment);
  return { checkpoints, omittedResets: [...omittedResets], omittedRanges: mergeCodexQuotaIncompleteRanges(omittedRanges),
    complete: omittedResets.size === 0 };
}

function baselineRequestTokens(parsed: CodexLineOutput): Record<string, ProviderTokenCounts> | undefined {
  if (parsed.quotaPairingIncomplete) return undefined;
  const byModel: Record<string, ProviderTokenCounts> = {};
  for (const event of parsed.events) {
    const model = sanitizeCodexMetadataLabel(event.model);
    if (!model) return undefined;
    const tokens = copyTokens(event.tokens);
    if (components.some(key => !Number.isSafeInteger(tokens[key]) || (tokens[key] ?? 0) < 0) ||
      tokens.cachedInput! > tokens.inputTotal || tokens.reasoningOutput! > tokens.outputTotal) return undefined;
    const previous = Object.prototype.hasOwnProperty.call(byModel, model) ? byModel[model] : undefined;
    const sum = copyTokens(previous ?? { inputTotal: 0, outputTotal: 0 });
    for (const key of components) {
      const n = (sum[key] ?? 0) + (tokens[key] ?? 0);
      if (!Number.isSafeInteger(n) || n < 0) return undefined;
      sum[key] = n;
    }
    Object.defineProperty(byModel, model, { value: sum, enumerable: true, configurable: true, writable: true });
    if (Object.keys(byModel).length > CODEX_QUOTA_CHECKPOINT_MODELS) return undefined;
  }
  return byModel;
}

function addVector(target: ProviderTokenCounts, tokens: ProviderTokenCounts): boolean {
  const source = copyTokens(tokens);
  for (const key of components) {
    const n = (target[key] ?? 0) + (source[key] ?? 0);
    if (!Number.isSafeInteger(n) || n < 0) return false;
    target[key] = n;
  }
  return true;
}

function flushUnpairedTail(state: CodexQuotaCheckpointState): void {
  const previous = state.rows[state.rows.length - 1];
  if (previous && state.lastEventAt > previous.through) addRange(state,
    { from: previous.through, through: state.lastEventAt });
}

/** Called during the existing streaming pass, after lineage admission. */
export function retainCodexQuotaCheckpoints(
  state: CodexQuotaCheckpointState, parsed: CodexLineOutput, admit: boolean,
): void {
  const observedAt = parsed.observedAt ?? parsed.events[0]?.timestamp ?? parsed.limit?.observedAt ?? 0;
  const previousActivity = state.activityThrough;
  if (Number.isSafeInteger(observedAt) && observedAt > 0) {
    state.activityFrom = state.activityFrom > 0 ? Math.min(state.activityFrom, observedAt) : observedAt;
    state.activityThrough = Math.max(state.activityThrough, observedAt);
  }
  if (!admit) { state.pendingBoundary = true; return; }
  for (const event of parsed.events) {
    if (!addVector(state.observedTokens, event.tokens)) { state.rangesUnlocalized = true; markCodexQuotaCheckpointGap(state); }
  }
  if (parsed.lineageBoundary) {
    flushUnpairedTail(state);
    state.pendingBoundary = true;
  }
  if (parsed.quotaSource === 'other') {
    flushUnpairedTail(state);
    for (const event of parsed.events) if (!addVector(state.excludedTokens, event.tokens)) state.rangesUnlocalized = true;
    state.pendingBoundary = true;
    return;
  }
  const requestTokens = baselineRequestTokens(parsed);
  if (parsed.quotaPairingIncomplete) {
    markCodexQuotaCheckpointGap(state);
    if (state.rows.length === 0) state.pendingGapFrom = Math.min(state.pendingGapFrom!, previousActivity);
  }
  if (parsed.events.length > 0 && (requestTokens === undefined || observedAt <= 0)) markCodexQuotaCheckpointGap(state);
  const sample = parsed.limit && codexQuotaObservationsFromLimit(parsed.limit)[0];
  const source = parsed.limit?.limitId?.trim().toLowerCase() === 'codex' ? 1 : 2;
  if ((parsed.quotaSource && parsed.quotaSource !== (state.source === 1 ? 'codex' : 'unspecified')) ||
    (parsed.limit && (!sample || source !== state.source))) {
    flushUnpairedTail(state); state.pendingBoundary = true;
  }
  const previous = state.rows[state.rows.length - 1];
  if (sample && (sample.resetAt <= sample.observedAt ||
    sample.observedAt < previousActivity || (previous && sample.observedAt < previous.through))) {
    markCodexQuotaCheckpointGap(state);
    state.pendingGapFrom = Math.min(state.pendingGapFrom!, sample.observedAt > 0 ? sample.observedAt : 0);
    return;
  }
  const baseline = !!sample && (state.pendingBoundary || !previous ||
    sample.observedAt >= state.segmentResetAt ||
    Math.abs(state.segmentResetAt - sample.resetAt) > CODEX_QUOTA_RESET_CLUSTER_MS ||
    sample.usedPercent < previous.usedPercent);
  const baselineByModel = baseline ? requestTokens : undefined;
  if (baseline) {
    flushUnpairedTail(state);
    state.byModel = {}; state.segment += 1; state.source = source;
    state.segmentResetAt = sample.resetAt;
    state.lastEventAt = sample.observedAt;
    state.segmentComplete = baselineByModel !== undefined;
    if (state.segmentComplete && state.pendingGapFrom !== undefined) {
      addRange(state, { from: state.pendingGapFrom, through: sample.observedAt });
      delete state.pendingGapFrom; state.pendingGapUnknown = false;
    }
    if (!state.segmentComplete) markCodexQuotaCheckpointGap(state);
    state.pendingBoundary = false;
  } else if (!state.pendingBoundary) {
    for (const event of parsed.events) {
      const model = sanitizeCodexMetadataLabel(event.model);
      if (!model || event.timestamp <= (previous?.through ?? 0) || event.timestamp < state.lastEventAt) {
        markCodexQuotaCheckpointGap(state);
      }
      state.lastEventAt = Math.max(state.lastEventAt, event.timestamp);
      if (!model) continue;
      if (!Object.prototype.hasOwnProperty.call(state.byModel, model) && Object.keys(state.byModel).length >= CODEX_QUOTA_CHECKPOINT_MODELS) {
        overflow(state); return;
      }
      const sum = copyTokens(Object.prototype.hasOwnProperty.call(state.byModel, model)
        ? state.byModel[model] : { inputTotal: 0, outputTotal: 0 });
      const tokens = copyTokens(event.tokens);
      for (const key of components) {
        const n = (sum[key] ?? 0) + (tokens[key] ?? 0);
        if (!Number.isSafeInteger(n) || n < 0) { overflow(state); return; }
        sum[key] = n;
      }
      Object.defineProperty(state.byModel, model, { value: sum, enumerable: true, configurable: true, writable: true });
    }
  } else if (parsed.events.length > 0) {
    markCodexQuotaCheckpointGap(state, false);
    state.lastEventAt = Math.max(state.lastEventAt, observedAt);
  }
  if (!sample) return;
  if (sample.observedAt < state.lastEventAt) {
    markCodexQuotaCheckpointGap(state);
  }
  const row: Row = { segment: state.segment, from: baseline ? sample.observedAt : previous!.from,
    through: sample.observedAt, resetAt: state.segmentResetAt, observedResetAt: sample.resetAt, usedPercent: sample.usedPercent,
    baseline, byModel: copyModels(state.byModel), complete: state.segmentComplete,
    ...(baselineByModel !== undefined ? { baselineByModel } : {}) };
  const beforePrevious = state.rows[state.rows.length - 2];
  if (previous && beforePrevious && previous.segment === row.segment &&
      beforePrevious.segment === row.segment && previous.usedPercent === row.usedPercent &&
      beforePrevious.usedPercent === row.usedPercent && !previous.baseline) {
    state.rows[state.rows.length - 1] = row;
  } else {
    state.rows.push(row);
  }
  if (baseline) compactCompletedSegments(state);
  enforceBudget(state);
  if (parsed.quotaPairingIncomplete || !state.segmentComplete) state.pendingBoundary = true;
}

/** Strict fixed-field reload boundary. Invalid versions trigger existing period replay. */
export function sanitizeCodexQuotaCheckpointState(value: unknown): CodexQuotaCheckpointState | undefined {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!record(value) || value.version !== CODEX_QUOTA_CHECKPOINT_VERSION || !integer(value.indexedThrough) ||
      !integer(value.prefixEvents) || !integer(value.segment) || !integer(value.segmentResetAt) || !integer(value.lastEventAt) ||
      ![0, 1, 2].includes(value.source as number) ||
      typeof value.pendingBoundary !== 'boolean' || typeof value.complete !== 'boolean' ||
      typeof value.segmentComplete !== 'boolean' ||
      typeof value.rangesUnlocalized !== 'boolean' || typeof value.pendingGapUnknown !== 'boolean' ||
      !integer(value.activityFrom) || !integer(value.activityThrough) || value.activityThrough < value.activityFrom ||
      (value.pendingGapFrom !== undefined && !integer(value.pendingGapFrom)) ||
      !Array.isArray(value.ranges) || value.ranges.length > CODEX_QUOTA_GAP_LIMIT ||
      typeof value.overflow !== 'boolean' || !Array.isArray(value.rows)) return undefined;
  const models = (raw: unknown): Record<string, ProviderTokenCounts> | undefined => {
    if (!record(raw)) return undefined;
    const entries = Object.entries(raw);
    if (entries.length > CODEX_QUOTA_CHECKPOINT_MODELS) return undefined;
    const result: Record<string, ProviderTokenCounts> = {};
    for (const [key, tokens] of entries) {
      if (sanitizeCodexMetadataLabel(key) !== key || !record(tokens) ||
          components.some(component => !integer(tokens[component])) ||
          (tokens.cachedInput as number) > (tokens.inputTotal as number) ||
          (tokens.reasoningOutput as number) > (tokens.outputTotal as number) ||
          tokens.sourceTotal !== (tokens.inputTotal as number) + (tokens.outputTotal as number)) return undefined;
      Object.defineProperty(result, key, { value: copyTokens(tokens as unknown as ProviderTokenCounts),
        enumerable: true, configurable: true, writable: true });
    }
    return result;
  };
  const state = createCodexQuotaCheckpointState(value.prefixEvents);
  state.indexedThrough = value.indexedThrough; state.segment = value.segment;
  state.segmentResetAt = value.segmentResetAt;
  state.lastEventAt = value.lastEventAt;
  state.source = value.source as 0 | 1 | 2; state.pendingBoundary = value.pendingBoundary;
  state.complete = value.complete; state.overflow = value.overflow;
  state.segmentComplete = value.segmentComplete;
  const observed = models({ vector: value.observedTokens })?.vector;
  const excluded = models({ vector: value.excludedTokens })?.vector;
  if (!observed || !excluded || components.some(key => (excluded[key] ?? 0) > (observed[key] ?? 0))) return undefined;
  state.observedTokens = observed; state.excludedTokens = excluded;
  state.rangesUnlocalized = value.rangesUnlocalized; state.pendingGapUnknown = value.pendingGapUnknown;
  state.activityFrom = value.activityFrom; state.activityThrough = value.activityThrough;
  if (value.pendingGapFrom !== undefined) state.pendingGapFrom = value.pendingGapFrom as number;
  else if (state.pendingGapUnknown) return undefined;
  for (const range of value.ranges) {
    if (!record(range) || !integer(range.from) || !integer(range.through) || range.through < range.from ||
      (range.resetAt !== undefined && (!integer(range.resetAt) || range.resetAt <= 0))) return undefined;
    state.ranges.push({ from: range.from, through: range.through,
      ...(range.resetAt !== undefined ? { resetAt: range.resetAt as number } : {}) });
  }
  state.ranges = mergeCodexQuotaIncompleteRanges(state.ranges, CODEX_QUOTA_GAP_LIMIT);
  if (state.ranges.length || state.pendingGapFrom !== undefined || state.rangesUnlocalized) state.complete = false;
  if (value.rows.length > CODEX_QUOTA_CHECKPOINT_LIMIT) { overflow(state); return state; }
  const byModel = models(value.byModel);
  if (!byModel || (value.rows.length === 0 && Object.keys(byModel).length > 0)) return undefined;
  state.byModel = byModel;
  for (const raw of value.rows) {
    if (!record(raw) || !integer(raw.segment) || !integer(raw.from) || !integer(raw.through) ||
        !integer(raw.resetAt) || !integer(raw.observedResetAt) || raw.from <= 0 || raw.through < raw.from ||
        raw.resetAt <= raw.through || raw.observedResetAt <= raw.through ||
        Math.abs(raw.observedResetAt - raw.resetAt) > CODEX_QUOTA_RESET_CLUSTER_MS ||
        (raw.baseline === true && raw.observedResetAt !== raw.resetAt) ||
        typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent) ||
        raw.usedPercent < 0 || raw.usedPercent > 100 || typeof raw.baseline !== 'boolean' ||
        typeof raw.complete !== 'boolean') return undefined;
    const counts = models(raw.byModel);
    if (!counts || (raw.baseline && (raw.from !== raw.through || Object.keys(counts).length !== 0))) return undefined;
    const baselineCounts = raw.baselineByModel === undefined ? undefined : models(raw.baselineByModel);
    if ((!raw.baseline && raw.baselineByModel !== undefined) ||
      (raw.baselineByModel !== undefined && !baselineCounts) ||
      (raw.baseline && raw.complete && baselineCounts === undefined)) return undefined;
    const previous = state.rows[state.rows.length - 1];
    if (raw.segment > state.segment || (!previous && !raw.baseline) ||
      (previous && (raw.segment < previous.segment || raw.through < previous.through))) return undefined;
    if (previous && raw.segment === previous.segment) {
      if (raw.baseline || raw.from !== previous.from || raw.resetAt !== previous.resetAt ||
        raw.usedPercent < previous.usedPercent || (!previous.complete && raw.complete)) return undefined;
      for (const [model, tokens] of Object.entries(previous.byModel)) {
        if (!Object.prototype.hasOwnProperty.call(counts, model) ||
          components.some(key => (counts[model][key] ?? 0) < (tokens[key] ?? 0))) return undefined;
      }
    } else if (!raw.baseline) return undefined;
    state.rows.push({ segment: raw.segment, from: raw.from, through: raw.through,
      resetAt: raw.resetAt, observedResetAt: raw.observedResetAt, usedPercent: raw.usedPercent, baseline: raw.baseline,
      complete: raw.complete, byModel: counts,
      ...(baselineCounts ? { baselineByModel: baselineCounts } : {}) });
  }
  const lastRow = state.rows[state.rows.length - 1];
  if (lastRow && lastRow.segment === state.segment && lastRow.resetAt !== state.segmentResetAt) return undefined;
  enforceBudget(state);
  if (state.overflow) state.complete = false;
  return state;
}
