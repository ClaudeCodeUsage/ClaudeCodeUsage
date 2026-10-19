import { buildLocalWeeklyEstimates, LocalWeeklyEstimate } from './weeklyEstimate';
import { WeeklyEstimateArchive, WeeklyEstimateArchiveResult, WeeklyEstimateClearScope,
  WeeklyEstimateInput, WeeklyEstimateProvider, WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES } from './weeklyEstimateArchive';
import type { WeeklyValueInputs } from './weeklyValue';

export interface WeeklyEstimateDisplayEntry extends LocalWeeklyEstimate {
  /** Public reference-price version retained with its historical numeric snapshot. */
  pricingVersion?: string;
}
export interface WeeklyEstimateProjection {
  entries: WeeklyEstimateDisplayEntry[];
  status: 'loading' | 'ready' | 'full' | 'unavailable';
}
export interface WeeklyEstimateProjectOptions { sourceNamespace: string; pricingVersion: string; now: number }
type Evidence = WeeklyEstimateDisplayEntry & { calibrationStart?: number };
type Memo = {
  usage: WeeklyValueInputs['usage']; observations: WeeklyValueInputs['observations'];
  pricingVersion: string; minute: number; live: WeeklyEstimateDisplayEntry[];
  revision: number; projection: WeeklyEstimateProjection;
};
type State = {
  provider: WeeklyEstimateProvider; source: string; archive?: WeeklyEstimateArchive;
  saved: WeeklyEstimateDisplayEntry[]; status: WeeklyEstimateProjection['status'];
  loaded: boolean; scheduled: boolean; revision: number; memo?: Memo;
  pending: Map<string, WeeklyEstimateInput>;
  queueFull?: boolean;
  generation: number | null;
  clearedThrough?: number;
};
const FLAGS = ['account-unattributed', 'boundary-uncertain', 'partial-pricing',
  'stale-observation', 'counter-change', 'reconstructed'] as const;
function bounded(value: unknown, max = 1e12): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
function time(value: unknown): value is number { return bounded(value, 8_640_000_000_000_000) && Number.isSafeInteger(value); }

/** Copy numeric DTOs and public pricing versions. Archive/account keys and unknown fields never reach UI. */
function copy(value: WeeklyEstimateInput | Evidence, provider: WeeklyEstimateProvider): WeeklyEstimateDisplayEntry | undefined {
  if (value.provider !== provider || !time(value.windowStart) || !time(value.resetAt) || value.windowStart >= value.resetAt ||
    !time(value.observedAt) || !time(value.estimatedAt) || !bounded(value.usedEquivalentUsd) ||
    !(value.fullEquivalentUsd === null || bounded(value.fullEquivalentUsd)) ||
    !(value.unusedEquivalentUsd === null || bounded(value.unusedEquivalentUsd)) ||
    !(value.utilizationPercent === null || bounded(value.utilizationPercent, 100)) || !bounded(value.pricingCoverage, 1) ||
    !['legacy-prefix-ratio', 'paired-delta', 'owned-window'].includes(value.method) ||
    !Array.isArray(value.flags) || value.flags.length > 12 || !value.flags.every(flag => FLAGS.includes(flag))) return undefined;
  if (value.pricingVersion !== undefined && (typeof value.pricingVersion !== 'string' || value.pricingVersion.length > 32 ||
    !/^(?:[a-z]{1,16}-){0,2}v\d{1,4}(?:\.\d{1,4}){0,3}$/.test(value.pricingVersion))) return undefined;
  if (value.calibrationStart !== undefined && (!time(value.calibrationStart) || value.calibrationStart < value.windowStart ||
    value.calibrationStart >= value.observedAt)) return undefined;
  const range = value.fullRange;
  if (range !== undefined && (!range || !bounded(range.lower) || range.lower <= 0 || !bounded(range.upper) ||
    value.fullEquivalentUsd === null || range.lower > value.fullEquivalentUsd || range.upper < value.fullEquivalentUsd)) return undefined;
  return { provider, windowStart: value.windowStart, resetAt: value.resetAt, observedAt: value.observedAt,
    estimatedAt: value.estimatedAt, usedEquivalentUsd: value.usedEquivalentUsd,
    fullEquivalentUsd: value.fullEquivalentUsd, unusedEquivalentUsd: value.unusedEquivalentUsd,
    utilizationPercent: value.utilizationPercent, pricingCoverage: value.pricingCoverage, method: value.method,
    flags: [...value.flags],
    ...(value.pricingVersion === undefined ? {} : { pricingVersion: value.pricingVersion }),
    ...(value.calibrationStart === undefined ? {} : { calibrationStart: value.calibrationStart }),
    ...(range === undefined ? {} : { fullRange: { lower: range.lower, upper: range.upper } }) };
}
function full(value: LocalWeeklyEstimate): boolean {
  return value.fullEquivalentUsd !== null && value.fullEquivalentUsd > 0 && value.unusedEquivalentUsd !== null &&
    value.pricingCoverage === 1 && !value.flags.some(flag => flag === 'boundary-uncertain' || flag === 'counter-change' || flag === 'partial-pricing');
}
function merge(saved: WeeklyEstimateDisplayEntry[], live: WeeklyEstimateDisplayEntry[]): WeeklyEstimateDisplayEntry[] {
  const rows = new Map<string, WeeklyEstimateDisplayEntry>();
  for (const value of [...saved, ...live]) {
    const key = `${value.resetAt}:${value.observedAt}:${value.method}`;
    const previous = rows.get(key);
    // A newly withheld full estimate cannot erase a saved, valid as-of snapshot.
    if (previous?.fullEquivalentUsd !== null && previous !== undefined && value.fullEquivalentUsd === null) {
      rows.set(key, { ...previous, flags: [...new Set([...previous.flags, ...value.flags, 'stale-observation' as const])] });
      continue;
    }
    rows.set(key, value);
  }
  return [...rows.values()].sort((a, b) => b.resetAt - a.resetAt || b.observedAt - a.observedAt ||
    b.estimatedAt - a.estimatedAt || a.method.localeCompare(b.method)).slice(0, 48)
    .map(value => copy(value, value.provider)!);
}
function signature(state: State): string { return JSON.stringify([state.status, state.saved, state.clearedThrough]); }
function visible(state: State, entries: WeeklyEstimateDisplayEntry[]): WeeklyEstimateDisplayEntry[] {
  return entries.filter(entry => state.clearedThrough === undefined || entry.observedAt > state.clearedThrough);
}
function unavailable(): WeeklyEstimateArchiveResult {
  return { status: 'unavailable', entries: [], totalEntries: null, totalEntriesByProvider: null, generation: null, clearedThrough: {} };
}
function status(result: WeeklyEstimateArchiveResult): WeeklyEstimateProjection['status'] {
  return result.status === 'ready' || result.status === 'full' ? result.status : 'unavailable';
}

/** Synchronous projections; a coalesced asynchronous queue owns all archive I/O. */
export class WeeklyEstimateCoordinator {
  private readonly states = new Map<WeeklyEstimateProvider, State>();
  private tail: Promise<void> = Promise.resolve();
  private clearing = 0;
  private disposed = false;
  constructor(private readonly filePath: string, private readonly salt: string,
    private readonly onChanged?: () => void) {}

  private active(state: State): boolean { return !this.disposed && this.states.get(state.provider) === state; }
  private notify(): void {
    if (!this.disposed) { try { this.onChanged?.(); } catch { /* Rendering cannot break persistence. */ } }
  }
  private apply(state: State, result: WeeklyEstimateArchiveResult): void {
    state.status = status(result);
    if (state.status !== 'unavailable') {
      state.generation = result.generation;
      state.clearedThrough = result.clearedThrough[state.provider];
      state.saved = result.entries.map(entry => copy(entry, state.provider)).filter((entry): entry is WeeklyEstimateDisplayEntry => entry !== undefined);
      for (const [key, entry] of state.pending) {
        if (state.clearedThrough !== undefined && entry.observedAt <= state.clearedThrough) state.pending.delete(key);
      }
    }
  }
  private schedule(state: State): void {
    if (state.scheduled || !this.active(state) || this.clearing || !state.archive) return;
    state.scheduled = true;
    const run = async () => {
      const before = signature(state);
      try {
        if (!this.active(state) || this.clearing) return;
        if (!state.loaded) {
          const loaded = await state.archive!.load();
          if (!this.active(state) || this.clearing) return;
          this.apply(state, loaded);
          if (state.status === 'unavailable') return;
          state.loaded = true;
        }
        const pending = [...state.pending.values()];
        state.pending.clear();
        for (const entry of pending) {
          if (!this.active(state) || this.clearing) return;
          if (state.generation === null || (state.clearedThrough !== undefined && entry.observedAt <= state.clearedThrough)) continue;
          let result = await state.archive!.record(entry, { expectedGeneration: state.generation });
          if (!this.active(state) || this.clearing) return;
          this.apply(state, result);
          // A clear of another provider must not lose this provider's genuinely unblocked sample.
          // One retry is safe only against the newly read durable cutoff/generation, never an old receipt.
          if (result.outcome === 'stale-generation' && state.generation !== null &&
            (state.clearedThrough === undefined || entry.observedAt > state.clearedThrough)) {
            result = await state.archive!.record(entry, { expectedGeneration: state.generation });
            if (!this.active(state) || this.clearing) return;
            this.apply(state, result);
          }
          if (state.status === 'unavailable' || state.status === 'full') break;
        }
      } catch { if (this.active(state)) state.status = 'unavailable'; }
      finally {
        state.scheduled = false;
        if (this.active(state) && !this.clearing) {
          if (state.queueFull && state.status === 'ready') state.status = 'full';
          if (signature(state) !== before) { state.revision++; this.notify(); }
          // Only a genuinely newer projection can schedule more work, never an unchanged callback render.
          if (state.pending.size && state.status === 'ready') this.schedule(state);
        }
      }
    };
    this.tail = this.tail.then(run, run);
  }

  project(provider: WeeklyEstimateProvider, inputs: WeeklyValueInputs,
    options: WeeklyEstimateProjectOptions): WeeklyEstimateProjection {
    if (this.disposed) return { entries: [], status: 'unavailable' };
    let state = this.states.get(provider);
    if (!state || state.source !== options.sourceNamespace) {
      state = { provider, source: options.sourceNamespace, saved: [], status: 'loading', loaded: false,
        scheduled: false, revision: 0, pending: new Map(), generation: null };
      try { state.archive = new WeeklyEstimateArchive(this.filePath, this.salt, options.sourceNamespace); }
      catch { state.status = 'unavailable'; }
      this.states.set(provider, state);
    }
    const minute = Math.floor(options.now / 60_000);
    let memo = state.memo;
    if (!memo || memo.usage !== inputs.usage || memo.observations !== inputs.observations ||
      memo.pricingVersion !== options.pricingVersion || memo.minute !== minute) {
      const live = buildLocalWeeklyEstimates(provider, inputs, { now: options.now, limit: 48 })
        .map(entry => copy({ ...entry, pricingVersion: options.pricingVersion }, provider))
        .filter((entry): entry is WeeklyEstimateDisplayEntry => entry !== undefined);
      memo = { usage: inputs.usage, observations: inputs.observations, pricingVersion: options.pricingVersion,
        minute, live, revision: state.revision, projection: { entries: merge(state.saved, visible(state, live)), status: state.status } };
      state.memo = memo;
      if (!this.clearing && state.archive) {
        for (const entry of live) {
          if (!full(entry) || (state.clearedThrough !== undefined && entry.observedAt <= state.clearedThrough)) continue;
          const dto: WeeklyEstimateInput = { ...copy(entry, provider)!, pricingVersion: options.pricingVersion };
          const { estimatedAt: _estimatedAt, ...values } = dto;
          const key = JSON.stringify(values);
          if (state.pending.size < WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES || state.pending.has(key)) state.pending.set(key, dto);
          else state.queueFull = true;
        }
        this.schedule(state);
      }
    } else if (memo.revision !== state.revision) {
      memo.projection = { entries: merge(state.saved, visible(state, memo.live)), status: state.status };
      memo.revision = state.revision;
    }
    return memo.projection;
  }

  /** Drain already queued work, including work coalesced during an in-flight write. */
  async flush(): Promise<void> {
    let pending: Promise<void>;
    do { pending = this.tail; await pending; } while (pending !== this.tail);
  }
  /** Clear the selected provider across ALL source homes; omit provider for the entire archive. */
  async clear(scope: WeeklyEstimateClearScope = {}): Promise<WeeklyEstimateArchiveResult> {
    if (this.disposed) return unavailable();
    this.clearing++;
    this.states.clear();
    const run = async (): Promise<WeeklyEstimateArchiveResult> => {
      if (this.disposed) return unavailable();
      try {
        return await new WeeklyEstimateArchive(this.filePath, this.salt, 'clear').clear({ ...scope, allSources: true });
      } catch { return unavailable(); }
    };
    const cleared = this.tail.then(run, run);
    this.tail = cleared.then(() => undefined, () => undefined);
    try { return await cleared; }
    finally {
      this.clearing--;
      this.states.clear();
      if (!this.clearing) this.notify();
    }
  }
  dispose(): void { this.disposed = true; this.states.clear(); }
}
