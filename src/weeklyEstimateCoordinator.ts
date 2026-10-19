import { buildLocalWeeklyEstimates, LocalWeeklyEstimate } from './weeklyEstimate';
import { WeeklyEstimateArchive, WeeklyEstimateArchiveResult, WeeklyEstimateClearScope,
  WeeklyEstimateInput, WeeklyEstimateProvider, WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES,
  weeklyEstimateAccountFingerprint, sameWeeklyEstimateQuotaPoint } from './weeklyEstimateArchive';
import type { WeeklyValueInputs } from './weeklyValue';
import { copyCodexQuotaEpoch, codexQuotaEpochFitsObservation } from './codexQuotaEpoch';
import { copyCodexCalibrationEvidence, codexCalibrationEvidenceFitsEstimate } from './codexCalibrationEvidence';
import type { QuotaObservationV2 } from './quotaObservationStore';
import { codexFallbackQuotaCycle, withCodexQuotaCycles } from './codexQuotaCycles';

export interface WeeklyEstimateDisplayEntry extends LocalWeeklyEstimate {
  /** Public reference-price version retained with its historical numeric snapshot. */
  pricingVersion?: string;
}
export interface WeeklyEstimateProjection {
  entries: Omit<WeeklyEstimateDisplayEntry, 'accountScopeKey'>[];
  status: 'loading' | 'ready' | 'full' | 'unavailable';
  activeAccountNumber?: number;
  activeQuotaEpochStartedAt?: number;
}
export interface WeeklyEstimateProjectOptions {
  sourceNamespace: string; pricingVersion: string; now: number;
  accountEstimates?: readonly WeeklyEstimateDisplayEntry[];
  activeAccountScopeKey?: string;
  activeQuotaEpochStartedAt?: number;
  quotaObservations?: readonly QuotaObservationV2[];
}
interface InternalEntry extends WeeklyEstimateDisplayEntry { accountScopeKey?: string }
type Evidence = InternalEntry;
type Memo = {
  usage: WeeklyValueInputs['usage']; observations: WeeklyValueInputs['observations'];
  localHistoryComplete: WeeklyValueInputs['localHistoryComplete'];
  pricingVersion: string; minute: number; live: InternalEntry[];
  accountEstimates?: readonly WeeklyEstimateDisplayEntry[]; activeAccountScopeKey?: string;
  activeQuotaEpochStartedAt?: number;
  quotaObservations?: readonly QuotaObservationV2[];
  revision: number; projection: WeeklyEstimateProjection;
};
type State = {
  provider: WeeklyEstimateProvider; source: string; archive?: WeeklyEstimateArchive;
  saved: InternalEntry[]; status: WeeklyEstimateProjection['status'];
  loaded: boolean; scheduled: boolean; revision: number; memo?: Memo;
  pending: Map<string, WeeklyEstimateInput>;
  acknowledged: Set<string>;
  accountNumbers: Map<string, number>;
  epoch: number;
  queueFull?: boolean;
  generation: number | null;
  clearedThrough?: number;
  accountClearedThrough: Record<string, number>;
};
const FLAGS = ['account-unattributed', 'boundary-uncertain', 'partial-pricing',
  'stale-observation', 'counter-change', 'reconstructed', 'partial-history'] as const;
const HEX = /^[a-f0-9]{64}$/;
function bounded(value: unknown, max = 1e12): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
function time(value: unknown): value is number { return bounded(value, 8_640_000_000_000_000) && Number.isSafeInteger(value); }

/** Internal fixed-field copy. The account HMAC is stripped only at the public projection boundary. */
function copy(value: WeeklyEstimateInput | Evidence, provider: WeeklyEstimateProvider): InternalEntry | undefined {
  if (value.provider !== provider || !time(value.windowStart) || !time(value.resetAt) || value.windowStart >= value.resetAt ||
    !time(value.observedAt) || !time(value.estimatedAt) || !bounded(value.usedEquivalentUsd) ||
    !(value.fullEquivalentUsd === null || bounded(value.fullEquivalentUsd)) ||
    !(value.unusedEquivalentUsd === null || bounded(value.unusedEquivalentUsd)) ||
    !(value.utilizationPercent === null || bounded(value.utilizationPercent, 100)) || !bounded(value.pricingCoverage, 1) ||
    !['legacy-prefix-ratio', 'rough-prefix-v2', 'paired-delta', 'owned-window', 'series-prefix-v1', 'account-delta-v1'].includes(value.method) ||
    !Array.isArray(value.flags) || value.flags.length > 12 || !value.flags.every(flag => FLAGS.includes(flag))) return undefined;
  if (value.accountScopeKey !== undefined && (typeof value.accountScopeKey !== 'string' || !HEX.test(value.accountScopeKey))) return undefined;
  if (value.accountNumber !== undefined && (value.accountScopeKey === undefined || !bounded(value.accountNumber) ||
    !Number.isSafeInteger(value.accountNumber) || value.accountNumber < 1)) return undefined;
  if (value.unlinkedEquivalentUsd !== undefined && !bounded(value.unlinkedEquivalentUsd)) return undefined;
  if (value.linkedSourceCount !== undefined && (!bounded(value.linkedSourceCount) || !Number.isSafeInteger(value.linkedSourceCount))) return undefined;
  if (value.pricingVersion !== undefined && (typeof value.pricingVersion !== 'string' || value.pricingVersion.length > 32 ||
    !/^(?:[a-z]{1,16}-){0,2}v\d{1,4}(?:\.\d{1,4}){0,3}$/.test(value.pricingVersion))) return undefined;
  if (value.calibrationStart !== undefined && (!time(value.calibrationStart) || value.calibrationStart < value.windowStart ||
    value.calibrationStart >= value.observedAt)) return undefined;
  const quotaEpoch = copyCodexQuotaEpoch(value.quotaEpoch);
  if (value.quotaEpoch !== undefined && (!quotaEpoch || provider !== 'codex' ||
    value.accountScopeKey === undefined || value.method !== 'account-delta-v1' ||
    !codexQuotaEpochFitsObservation(quotaEpoch, value.observedAt, value.resetAt, value.windowStart,
      value.calibrationStart))) return undefined;
  const range = value.fullRange;
  const calibrationEvidence = copyCodexCalibrationEvidence(value.calibrationEvidence);
  if (value.calibrationEvidence !== undefined && (!calibrationEvidence || provider !== 'codex' ||
    value.method !== 'account-delta-v1' || !codexCalibrationEvidenceFitsEstimate(calibrationEvidence, value))) return undefined;
  if (range !== undefined && (!range || !bounded(range.lower) || range.lower <= 0 || !bounded(range.upper) ||
    value.fullEquivalentUsd === null || range.lower > value.fullEquivalentUsd || range.upper < value.fullEquivalentUsd)) return undefined;
  return { provider, windowStart: value.windowStart, resetAt: value.resetAt, observedAt: value.observedAt,
    estimatedAt: value.estimatedAt, usedEquivalentUsd: value.usedEquivalentUsd,
    fullEquivalentUsd: value.fullEquivalentUsd, unusedEquivalentUsd: value.unusedEquivalentUsd,
    utilizationPercent: value.utilizationPercent, pricingCoverage: value.pricingCoverage, method: value.method,
    flags: [...value.flags],
    ...(value.pricingVersion === undefined ? {} : { pricingVersion: value.pricingVersion }),
    ...(value.calibrationStart === undefined ? {} : { calibrationStart: value.calibrationStart }),
    ...(value.accountScopeKey === undefined ? {} : { accountScopeKey: value.accountScopeKey }),
    ...(quotaEpoch === undefined ? {} : { quotaEpoch }),
    ...(calibrationEvidence === undefined ? {} : { calibrationEvidence }),
    ...(value.accountNumber === undefined ? {} : { accountNumber: value.accountNumber }),
    ...(value.unlinkedEquivalentUsd === undefined ? {} : { unlinkedEquivalentUsd: value.unlinkedEquivalentUsd }),
    ...(value.linkedSourceCount === undefined ? {} : { linkedSourceCount: value.linkedSourceCount }),
    ...(range === undefined ? {} : { fullRange: { lower: range.lower, upper: range.upper } }) };
}
function full(value: Pick<WeeklyEstimateInput, 'fullEquivalentUsd' | 'unusedEquivalentUsd' | 'method' | 'pricingCoverage' | 'flags'>): boolean {
  return value.fullEquivalentUsd !== null && value.fullEquivalentUsd > 0 && value.unusedEquivalentUsd !== null &&
    (['rough-prefix-v2', 'series-prefix-v1', 'account-delta-v1'].includes(value.method) || (value.pricingCoverage === 1 &&
      !value.flags.some(flag => flag === 'boundary-uncertain' || flag === 'counter-change' ||
        flag === 'partial-pricing' || flag === 'partial-history')));
}
function merge(saved: InternalEntry[], live: InternalEntry[]): InternalEntry[] {
  const rows = new Map<string, InternalEntry>();
  for (const value of [...saved, ...live]) {
    const key = JSON.stringify([value.provider, value.accountScopeKey ?? null, value.quotaEpoch?.startedAt ?? null,
      value.quotaEpoch === undefined ? value.resetAt : null, value.observedAt, value.method, value.pricingVersion ?? null]);
    const previous = rows.get(key);
    // A newly withheld full estimate cannot erase a saved, valid as-of snapshot.
    if (previous?.fullEquivalentUsd !== null && previous !== undefined && value.fullEquivalentUsd === null) {
      rows.set(key, { ...previous, flags: [...new Set([...previous.flags, ...value.flags, 'stale-observation' as const])] });
      continue;
    }
    rows.set(key, value);
  }
  const representatives = new Map<string, InternalEntry>();
  for (const value of [...rows.values()].reverse().sort((a, b) => b.observedAt - a.observedAt || b.estimatedAt - a.estimatedAt)) {
    const fallback = value.provider === 'codex' && value.accountScopeKey === undefined && value.quotaEpoch === undefined;
    const key = fallback ? JSON.stringify(['codex', 'seven-day-reference', codexFallbackQuotaCycle(value).id,
      value.fullEquivalentUsd === null ? 'withheld' : 'full']) : JSON.stringify([value.provider, value.accountScopeKey ?? null, value.quotaEpoch?.startedAt ?? null,
      value.quotaEpoch === undefined ? value.resetAt : null, value.method, value.pricingVersion ?? null,
      value.fullEquivalentUsd === null ? 'withheld' : 'full']);
    if (!representatives.has(key)) representatives.set(key, value);
  }
  return [...representatives.values()].sort((a, b) => b.resetAt - a.resetAt || b.observedAt - a.observedAt ||
    b.estimatedAt - a.estimatedAt || a.method.localeCompare(b.method)).slice(0, 48)
    .map(value => copy(value, value.provider)!);
}
function signature(state: State): string {
  return JSON.stringify([state.status, state.saved, state.clearedThrough, state.accountClearedThrough, [...state.accountNumbers]]);
}
function semanticKey(value: WeeklyEstimateInput | Evidence): string {
  const { estimatedAt: _estimatedAt, accountNumber: _number, flags, ...fields } = copy(value, value.provider)!;
  // Clock passage changes display staleness, not the retained measurement or pricing evidence.
  return JSON.stringify({ ...fields, flags: FLAGS.filter(flag => flag !== 'stale-observation' && flags.includes(flag)) });
}
function cleared(state: State, entry: InternalEntry | WeeklyEstimateInput, salt: string): boolean {
  const fingerprint = weeklyEstimateAccountFingerprint(salt, entry.provider, entry.accountScopeKey);
  const beginning = entry.method === 'account-delta-v1' ? Math.min(entry.observedAt, entry.calibrationStart ?? Infinity) : entry.observedAt;
  return beginning <= Math.max(state.clearedThrough ?? -1,
    fingerprint === undefined ? -1 : state.accountClearedThrough[fingerprint] ?? -1);
}
function visible(state: State, entries: InternalEntry[], salt: string): InternalEntry[] {
  return entries.filter(entry => !cleared(state, entry, salt));
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
  private readonly epochs = new Map<WeeklyEstimateProvider, number>();
  private readonly clearCounts = new Map<WeeklyEstimateProvider, number>();
  private disposed = false;
  constructor(private readonly filePath: string, private readonly salt: string,
    private readonly onChanged?: () => void) {}

  /** Already loaded durable fences only; never introduces render-time I/O. */
  calibrationCutoff(provider: WeeklyEstimateProvider, sourceNamespace: string, accountScopeKey: string): number | undefined {
    const state = this.states.get(provider);
    if (!state || state.source !== sourceNamespace) return undefined;
    const fingerprint = weeklyEstimateAccountFingerprint(this.salt, provider, accountScopeKey);
    const through = Math.max(state.clearedThrough ?? -1,
      fingerprint === undefined ? -1 : state.accountClearedThrough[fingerprint] ?? -1);
    return through >= 0 ? through : undefined;
  }

  private retained(state: State): boolean { return !this.disposed && state.epoch === (this.epochs.get(state.provider) ?? 0); }
  private active(state: State): boolean { return this.retained(state) && this.states.get(state.provider) === state; }
  private blocked(state: State): boolean { return (this.clearCounts.get(state.provider) ?? 0) > 0; }
  private notify(): void {
    if (!this.disposed) { try { this.onChanged?.(); } catch { /* Rendering cannot break persistence. */ } }
  }
  private accountNumber(state: State, key: string | undefined): number | undefined {
    if (key === undefined || !HEX.test(key)) return undefined;
    const existing = state.accountNumbers.get(key);
    if (existing !== undefined) return existing;
    const next = Math.max(0, ...state.accountNumbers.values()) + 1;
    if (state.accountNumbers.size >= WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES || next > 1e12) {
      state.queueFull = true;
      state.status = 'full';
      return undefined;
    }
    state.accountNumbers.set(key, next);
    return next;
  }
  private projection(state: State, live: InternalEntry[], activeKey?: string, activeEpoch?: number,
    observations: readonly QuotaObservationV2[] = [], now = Date.now()): WeeklyEstimateProjection {
    const merged = merge(state.saved, visible(state, live, this.salt));
    const cycleEntries = state.provider === 'codex' ? withCodexQuotaCycles(merged, observations,
      key => weeklyEstimateAccountFingerprint(this.salt, 'codex', key), now) : merged;
    const entries = cycleEntries.map(entry => {
      const { accountScopeKey, accountNumber: _hint, ...publicEntry } = entry;
      const accountNumber = full(entry) ? this.accountNumber(state, accountScopeKey)
        : accountScopeKey === undefined ? undefined : state.accountNumbers.get(accountScopeKey);
      return { ...publicEntry, ...(accountNumber === undefined ? {} : { accountNumber }) };
    });
    // Identity alone must not reserve a number that the archive cannot honor.
    const activeAccountNumber = state.provider === 'codex' && activeKey !== undefined && HEX.test(activeKey)
      ? state.accountNumbers.get(activeKey) : undefined;
    return { entries, status: state.status, ...(activeAccountNumber === undefined ? {} : { activeAccountNumber }),
      ...(state.provider === 'codex' && activeKey !== undefined && HEX.test(activeKey) &&
        activeEpoch !== undefined && time(activeEpoch) && activeEpoch > 0 ? { activeQuotaEpochStartedAt: activeEpoch } : {}) };
  }
  private acknowledge(state: State, entry: WeeklyEstimateInput): void {
    const key = semanticKey(entry);
    if (!state.acknowledged.has(key)) {
      // This bounded runtime receipt set may discard old acknowledgements, never archive history.
      if (state.acknowledged.size >= WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES) {
        state.acknowledged.delete(state.acknowledged.values().next().value!);
      }
      state.acknowledged.add(key);
    }
    state.pending.delete(key);
  }
  private apply(state: State, result: WeeklyEstimateArchiveResult): void {
    state.status = status(result);
    if (state.status !== 'unavailable') {
      if (state.generation !== result.generation) state.acknowledged.clear();
      state.generation = result.generation;
      state.clearedThrough = result.clearedThrough[state.provider];
      state.accountClearedThrough = result.accountClearedThrough?.[state.provider] ?? {};
      const numbers = new Map<string, number>();
      for (const entry of result.entries) {
        if (entry.accountScopeKey !== undefined && entry.accountNumber !== undefined) numbers.set(entry.accountScopeKey, entry.accountNumber);
      }
      // Durable ordinals win over temporary labels, including labels allocated before the first load.
      const temporaryKeys = [...state.accountNumbers.keys()];
      state.accountNumbers = numbers;
      for (const entry of result.entries) this.accountNumber(state, entry.accountScopeKey);
      for (const key of temporaryKeys) this.accountNumber(state, key);
      state.saved = result.entries.map(entry => copy(entry, state.provider)).filter((entry): entry is InternalEntry => entry !== undefined);
      for (const entry of result.entries) {
        if (entry.provider === state.provider) this.acknowledge(state, entry);
      }
      for (const [key, entry] of state.pending) {
        if (state.acknowledged.has(key) || cleared(state, entry, this.salt)) state.pending.delete(key);
      }
    }
  }
  private schedule(state: State): void {
    if (state.scheduled || !this.retained(state) || this.blocked(state) || !state.archive ||
      (state.loaded && !state.pending.size)) return;
    state.scheduled = true;
    const run = async () => {
      const before = signature(state);
      try {
        if (!this.retained(state) || this.blocked(state)) return;
        if (!state.loaded) {
          const loaded = await state.archive!.load();
          if (!this.retained(state) || this.blocked(state)) return;
          this.apply(state, loaded);
          if (state.status === 'unavailable') return;
          state.loaded = true;
        }
        const pending = [...state.pending.values()];
        state.pending.clear();
        for (const entry of pending) {
          if (!this.retained(state) || this.blocked(state)) return;
          if (state.acknowledged.has(semanticKey(entry))) continue;
          if (state.generation === null || cleared(state, entry, this.salt)) continue;
          let result = await state.archive!.record(entry, { expectedGeneration: state.generation });
          if (!this.retained(state) || this.blocked(state)) return;
          this.apply(state, result);
          // A clear of another provider must not lose this provider's genuinely unblocked sample.
          // One retry is safe only against the newly read durable cutoff/generation, never an old receipt.
          if (result.outcome === 'stale-generation' && state.generation !== null &&
            !state.acknowledged.has(semanticKey(entry)) &&
            !cleared(state, entry, this.salt)) {
            result = await state.archive!.record(entry, { expectedGeneration: state.generation });
            if (!this.retained(state) || this.blocked(state)) return;
            this.apply(state, result);
          }
          if (result.outcome === 'recorded' || result.outcome === 'unchanged') this.acknowledge(state, entry);
          if (state.status === 'unavailable' || state.status === 'full') break;
        }
      } catch { if (this.retained(state)) state.status = 'unavailable'; }
      finally {
        state.scheduled = false;
        if (this.retained(state) && !this.blocked(state)) {
          if (state.queueFull && state.status === 'ready') state.status = 'full';
          if (signature(state) !== before) { state.revision++; if (this.active(state)) this.notify(); }
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
        scheduled: false, revision: 0, pending: new Map(), acknowledged: new Set(), accountNumbers: new Map(),
        epoch: this.epochs.get(provider) ?? 0, generation: null, accountClearedThrough: {} };
      try { state.archive = new WeeklyEstimateArchive(this.filePath, this.salt, options.sourceNamespace); }
      catch { state.status = 'unavailable'; }
      this.states.set(provider, state);
    }
    const minute = Math.floor(options.now / 60_000);
    let memo = state.memo;
    if (!memo || memo.usage !== inputs.usage || memo.observations !== inputs.observations ||
      memo.localHistoryComplete !== inputs.localHistoryComplete || memo.pricingVersion !== options.pricingVersion || memo.minute !== minute ||
      memo.accountEstimates !== options.accountEstimates || memo.activeAccountScopeKey !== options.activeAccountScopeKey ||
      memo.activeQuotaEpochStartedAt !== options.activeQuotaEpochStartedAt || memo.quotaObservations !== options.quotaObservations) {
      const produced = buildLocalWeeklyEstimates(provider, inputs, { now: options.now, limit: 48 })
        .map(entry => ({ ...entry, pricingVersion: options.pricingVersion }));
      // Account estimates freeze their USD and pricing evidence at capture. Only unstamped
      // legacy callers inherit the current version; a present invalid version fails copy().
      const accounts = provider === 'codex' ? (options.accountEstimates ?? []).map(entry => ({
        ...entry, pricingVersion: entry.pricingVersion === undefined ? options.pricingVersion : entry.pricingVersion,
      })) : [];
      const live = [...produced, ...accounts]
        .map(entry => copy(entry, provider))
        .filter((entry): entry is InternalEntry => entry !== undefined);
      memo = { usage: inputs.usage, observations: inputs.observations, localHistoryComplete: inputs.localHistoryComplete,
        pricingVersion: options.pricingVersion, accountEstimates: options.accountEstimates, activeAccountScopeKey: options.activeAccountScopeKey,
        activeQuotaEpochStartedAt: options.activeQuotaEpochStartedAt,
        quotaObservations: options.quotaObservations,
        minute, live, revision: state.revision, projection: this.projection(state, live, options.activeAccountScopeKey,
          options.activeQuotaEpochStartedAt, options.quotaObservations, options.now) };
      state.memo = memo;
      if (!this.blocked(state) && state.archive) {
        for (const entry of live) {
          if (!full(entry) || cleared(state, entry, this.salt)) continue;
          const dto: WeeklyEstimateInput = { ...copy(entry, provider)!, pricingVersion: entry.pricingVersion ?? options.pricingVersion };
          const key = semanticKey(dto);
          if (state.acknowledged.has(key) || state.pending.has(key)) continue;
          // Coalesce only the pending batch. A genuinely newer observation must
          // still check the durable generation/cutoff after an external clear.
          if ([...state.pending.values()].some(previous => sameWeeklyEstimateQuotaPoint(previous, dto))) continue;
          if (state.pending.size < WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES) state.pending.set(key, dto);
          else state.queueFull = true;
        }
        this.schedule(state);
      }
    } else if (memo.revision !== state.revision) {
      memo.projection = this.projection(state, memo.live, options.activeAccountScopeKey, options.activeQuotaEpochStartedAt,
        options.quotaObservations, options.now);
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
    const providers: WeeklyEstimateProvider[] = scope.provider === undefined ? ['claude', 'codex'] : [scope.provider];
    if (scope.accountFingerprint !== undefined) {
      // Drain all existing writers before deleting this account. Unlike provider/all clear,
      // unrelated account and unbound queues must retain their state and epoch.
      this.clearing++;
      const run = async (): Promise<WeeklyEstimateArchiveResult> => {
        if (this.disposed) return unavailable();
        try {
          const result = await new WeeklyEstimateArchive(this.filePath, this.salt, 'clear').clear({ ...scope, allSources: true });
          if (result.status === 'ready' || result.status === 'full') {
            for (const provider of providers) {
              const state = this.states.get(provider);
              if (!state?.archive || !this.active(state) || this.blocked(state)) continue;
              const loaded = await state.archive.load();
              if (!this.active(state) || this.blocked(state)) continue;
              this.apply(state, loaded);
              state.loaded = loaded.status === 'ready' || loaded.status === 'full';
              state.revision++;
            }
          }
          return result;
        } catch { return unavailable(); }
      };
      const pending = this.tail.then(run, run);
      this.tail = pending.then(() => undefined, () => undefined);
      try { return await pending; }
      finally { this.clearing--; if (!this.clearing) this.notify(); }
    }
    this.clearing++;
    for (const provider of providers) {
      this.clearCounts.set(provider, (this.clearCounts.get(provider) ?? 0) + 1);
      this.epochs.set(provider, (this.epochs.get(provider) ?? 0) + 1);
      this.states.delete(provider);
    }
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
      for (const provider of providers) {
        this.clearCounts.set(provider, (this.clearCounts.get(provider) ?? 1) - 1);
        this.states.delete(provider);
      }
      if (!this.clearing) this.notify();
    }
  }
  dispose(): void { this.disposed = true; this.states.clear(); }
}
