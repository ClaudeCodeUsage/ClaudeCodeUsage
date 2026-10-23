import { createHmac, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { acquireCodexIndexLease } from './providers/codex/codexIndexLease';
import { fingerprintForStableIdentity } from './quotaObservationStore';
import { copyCodexQuotaEpoch, codexQuotaEpochFitsObservation, CodexQuotaEpoch } from './codexQuotaEpoch';
import { CodexCalibrationEvidence, copyCodexCalibrationEvidence, codexCalibrationEvidenceFitsEstimate } from './codexCalibrationEvidence';
import { CodexWindowEvidence, copyCodexWindowEvidence, codexWindowEvidenceFits } from './codexWindowEvidence';

export const WEEKLY_ESTIMATE_ARCHIVE_FILE = 'weekly-estimates-v1.json';
export const WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES = 4096;
export const WEEKLY_ESTIMATE_ARCHIVE_MAX_BYTES = 1024 * 1024;
export const WEEKLY_ESTIMATE_ARCHIVE_MAX_CLEAR_FENCES = 128;
export type WeeklyEstimateProvider = 'claude' | 'codex';
export type WeeklyEstimateMethod = 'legacy-prefix-ratio' | 'rough-prefix-v2' | 'paired-delta' | 'owned-window'
  | 'series-prefix-v1' | 'account-delta-v1';
export type WeeklyEstimateFlag = 'account-unattributed' | 'boundary-uncertain' | 'partial-pricing'
  | 'stale-observation' | 'counter-change' | 'reconstructed' | 'partial-history';

/** Numeric snapshots only. All times are Unix milliseconds; null is unknown, not zero. */
export interface WeeklyEstimateInput {
  provider: WeeklyEstimateProvider;
  windowStart: number;
  resetAt: number;
  observedAt: number;
  estimatedAt: number;
  usedEquivalentUsd: number;
  fullEquivalentUsd: number | null;
  unusedEquivalentUsd: number | null;
  utilizationPercent: number | null;
  pricingCoverage: number;
  method: WeeklyEstimateMethod;
  /** Public version label, e.g. api-equivalent-v1 or v1.2 (at most 32 ASCII characters). */
  pricingVersion: string;
  /** Original paired-delta measurement interval and conditional range, never identity proof. */
  calibrationStart?: number;
  calibrationEvidence?: CodexCalibrationEvidence;
  windowEvidence?: CodexWindowEvidence;
  localWindowKey?: string;
  fullRange?: { lower: number; upper: number };
  /** Optional machine-local 64 lowercase hex key. This is never ownership/identity proof. */
  accountScopeKey?: string;
  quotaEpoch?: CodexQuotaEpoch;
  /** Source-local ordinal assigned under the archive lease, never caller identity. */
  accountNumber?: number;
  unlinkedEquivalentUsd?: number;
  linkedSourceCount?: number;
  flags: readonly WeeklyEstimateFlag[];
}
export interface WeeklyEstimateEntry extends WeeklyEstimateInput {
  sourceKey: string;
  windowKey: string;
  revision: number;
}
export type WeeklyEstimateArchiveStatus = 'ready' | 'full' | 'invalid' | 'unsafe' | 'unavailable';
export interface WeeklyEstimateArchiveResult {
  status: WeeklyEstimateArchiveStatus;
  /** Always source filtered; includes historical accounts. Do not export pseudonymous keys. */
  entries: WeeklyEstimateEntry[];
  /** Global canonical counts, not source-filtered. null means unknown, never proof of empty. */
  totalEntries: number | null;
  totalEntriesByProvider: Record<WeeklyEstimateProvider, number> | null;
  /** Changes only on clear. Legacy documents and absent files start at generation zero. */
  generation: number | null;
  /** Source-applicable durable observation cutoffs, without exposing fence/source keys. */
  clearedThrough: Partial<Record<WeeklyEstimateProvider, number>>;
  /** Internal P2 account receipts applicable to this source. Never project these keys to UI. */
  accountClearedThrough?: Partial<Record<WeeklyEstimateProvider, Record<string, number>>>;
}
export interface WeeklyEstimateRecordResult extends WeeklyEstimateArchiveResult {
  outcome: 'recorded' | 'unchanged' | 'full' | 'invalid' | 'unsafe' | 'unavailable' | 'stale-generation' | 'cleared-observation';
}
export interface WeeklyEstimateRecordOptions { expectedGeneration?: number }
export interface WeeklyEstimateArchiveOptions { maxEntries?: number; maxBytes?: number }
export interface WeeklyEstimateClearScope {
  /** Default clears this source only. Explicit true clears every source, including corrupt data. */
  allSources?: boolean;
  provider?: WeeklyEstimateProvider;
  /** P2 account fingerprint, distinct from the full-length internal accountScopeKey. */
  accountFingerprint?: string;
}
interface ClearFence { sourceKey?: string; provider?: WeeklyEstimateProvider; accountFingerprint?: string; observedThrough: number }
interface Document { schemaVersion: 1; entries: WeeklyEstimateEntry[]; generation: number; clearFences: ClearFence[] }
interface Loaded extends Document { bytes: number }
function empty(): Document { return { schemaVersion: 1, generation: 0, clearFences: [], entries: [] }; }
function covers(outer: ClearFence, inner: ClearFence): boolean {
  return (outer.sourceKey === undefined || outer.sourceKey === inner.sourceKey) &&
    (outer.provider === undefined || outer.provider === inner.provider) &&
    (outer.accountFingerprint === undefined || outer.accountFingerprint === inner.accountFingerprint);
}
function cutoff(fences: ClearFence[], sourceKey: string, provider: WeeklyEstimateProvider, accountFingerprint?: string): number | undefined {
  const matches = fences.filter(fence => covers(fence, { sourceKey, provider, accountFingerprint, observedThrough: 0 }));
  return matches.length ? Math.max(...matches.map(fence => fence.observedThrough)) : undefined;
}
const FLAGS: readonly WeeklyEstimateFlag[] = ['account-unattributed', 'boundary-uncertain',
  'partial-pricing', 'stale-observation', 'counter-change', 'reconstructed', 'partial-history'];
const HEX = /^[a-f0-9]{64}$/;
const ACCOUNT_FINGERPRINT = /^(?:acct|anon)_[a-f0-9]{32}$/;
/** Same stable signal as official Codex quota capture. Importing the quota helper has no archive cycle. */
export function weeklyEstimateAccountFingerprint(salt: string, provider: WeeklyEstimateProvider, key?: string): string | undefined {
  return key !== undefined && HEX.test(key)
    ? fingerprintForStableIdentity(salt, provider, 'official-account-scope-v1|' + key) : undefined;
}
const VERSION = /^(?:[a-z]{1,16}-){0,2}v\d{1,4}(?:\.\d{1,4}){0,3}$/;
class ArchiveFailure extends Error {
  constructor(readonly status: 'invalid' | 'unsafe' | 'unavailable') { super(`weekly-estimate-archive:${status}`); }
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function number(value: unknown, max: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max; }
function timestamp(value: unknown): value is number { return number(value, 8_640_000_000_000_000) && Number.isSafeInteger(value); }
function money(value: unknown): value is number { return number(value, 1e12); }

/** Rebuild from a fixed field list at both input and disk boundaries. Never spread untrusted data. */
function copyInput(value: unknown): WeeklyEstimateInput | undefined {
  if (!object(value) || (value.provider !== 'claude' && value.provider !== 'codex') ||
    !timestamp(value.windowStart) || !timestamp(value.resetAt) || value.windowStart >= value.resetAt ||
    !timestamp(value.observedAt) || !timestamp(value.estimatedAt) || !money(value.usedEquivalentUsd) ||
    !(value.fullEquivalentUsd === null || money(value.fullEquivalentUsd)) ||
    !(value.unusedEquivalentUsd === null || money(value.unusedEquivalentUsd)) ||
    !(value.utilizationPercent === null || number(value.utilizationPercent, 100)) ||
    !number(value.pricingCoverage, 1) ||
    !['legacy-prefix-ratio', 'rough-prefix-v2', 'paired-delta', 'owned-window', 'series-prefix-v1', 'account-delta-v1'].includes(value.method as string) ||
    typeof value.pricingVersion !== 'string' || value.pricingVersion.length > 32 || !VERSION.test(value.pricingVersion) ||
    !(value.accountScopeKey === undefined || (typeof value.accountScopeKey === 'string' && HEX.test(value.accountScopeKey))) ||
    !Array.isArray(value.flags) || value.flags.length > 12 ||
    !value.flags.every(flag => FLAGS.includes(flag as WeeklyEstimateFlag))) return undefined;
  if (value.accountNumber !== undefined && (value.accountScopeKey === undefined || !number(value.accountNumber, 1e12) ||
    !Number.isSafeInteger(value.accountNumber) || value.accountNumber < 1)) return undefined;
  if (value.unlinkedEquivalentUsd !== undefined && !money(value.unlinkedEquivalentUsd)) return undefined;
  if (value.linkedSourceCount !== undefined && (!number(value.linkedSourceCount, 1e12) ||
    !Number.isSafeInteger(value.linkedSourceCount))) return undefined;
  if (value.calibrationStart !== undefined && (!timestamp(value.calibrationStart) ||
    value.calibrationStart < value.windowStart || value.calibrationStart >= value.observedAt)) return undefined;
  const quotaEpoch = copyCodexQuotaEpoch(value.quotaEpoch);
  if (value.quotaEpoch !== undefined && (!quotaEpoch || value.provider !== 'codex' ||
    value.accountScopeKey === undefined || value.method !== 'account-delta-v1' ||
    !codexQuotaEpochFitsObservation(quotaEpoch, value.observedAt, value.resetAt, value.windowStart,
      value.calibrationStart as number | undefined))) return undefined;
  const calibrationEvidence = copyCodexCalibrationEvidence(value.calibrationEvidence);
  const windowEvidence = copyCodexWindowEvidence(value.windowEvidence);
  if (value.localWindowKey !== undefined && (typeof value.localWindowKey !== 'string' || !HEX.test(value.localWindowKey))) return undefined;
  if (value.windowEvidence !== undefined && (!windowEvidence || value.provider !== 'codex' ||
    value.method !== 'series-prefix-v1' || value.localWindowKey === undefined ||
    !codexWindowEvidenceFits(windowEvidence, value as unknown as WeeklyEstimateInput))) return undefined;
  if (value.calibrationEvidence !== undefined && (!calibrationEvidence || value.provider !== 'codex' ||
    value.method !== 'account-delta-v1' || !codexCalibrationEvidenceFitsEstimate(calibrationEvidence,
      value as unknown as WeeklyEstimateInput))) return undefined;
  if (value.fullRange !== undefined && (!object(value.fullRange) || !money(value.fullRange.lower) ||
    !money(value.fullRange.upper) || value.fullRange.lower <= 0 || value.fullEquivalentUsd === null ||
    value.fullRange.lower > value.fullEquivalentUsd || value.fullRange.upper < value.fullEquivalentUsd)) return undefined;
  return {
    provider: value.provider, windowStart: value.windowStart, resetAt: value.resetAt,
    observedAt: value.observedAt, estimatedAt: value.estimatedAt,
    usedEquivalentUsd: value.usedEquivalentUsd, fullEquivalentUsd: value.fullEquivalentUsd,
    unusedEquivalentUsd: value.unusedEquivalentUsd, utilizationPercent: value.utilizationPercent,
    pricingCoverage: value.pricingCoverage, method: value.method as WeeklyEstimateMethod,
    pricingVersion: value.pricingVersion,
    ...(value.calibrationStart === undefined ? {} : { calibrationStart: value.calibrationStart as number }),
    ...(value.fullRange === undefined ? {} : { fullRange: {
      lower: (value.fullRange as { lower: number }).lower,
      upper: (value.fullRange as { upper: number }).upper,
    } }),
    ...(value.accountScopeKey === undefined ? {} : { accountScopeKey: value.accountScopeKey as string }),
    ...(quotaEpoch === undefined ? {} : { quotaEpoch }),
    ...(calibrationEvidence === undefined ? {} : { calibrationEvidence }),
    ...(windowEvidence === undefined ? {} : { windowEvidence }),
    ...(value.localWindowKey === undefined ? {} : { localWindowKey: value.localWindowKey as string }),
    ...(value.accountNumber === undefined ? {} : { accountNumber: value.accountNumber as number }),
    ...(value.unlinkedEquivalentUsd === undefined ? {} : { unlinkedEquivalentUsd: value.unlinkedEquivalentUsd as number }),
    ...(value.linkedSourceCount === undefined ? {} : { linkedSourceCount: value.linkedSourceCount as number }),
    flags: FLAGS.filter(flag => (value.flags as unknown[]).includes(flag)),
  };
}
function semanticKey(input: WeeklyEstimateInput): string {
  const { observedAt, estimatedAt: _estimated, accountNumber: _number, ...values } = input;
  // New account/series methods retain each as-of measurement. Legacy signatures stay unchanged.
  return JSON.stringify(input.method === 'series-prefix-v1' || input.method === 'account-delta-v1'
    ? { ...values, observedAt } : values);
}
/** Official epoch snapshots retain the first as-of point at each percentage
 * change for each method/price. Legacy snapshots keep their original signatures. */
export function sameWeeklyEstimateQuotaPoint(left: WeeklyEstimateInput, right: WeeklyEstimateInput): boolean {
  if (left.localWindowKey !== right.localWindowKey) return false;
  if (left.provider !== 'codex' || right.provider !== 'codex' || left.accountScopeKey !== right.accountScopeKey ||
    left.method !== right.method || left.pricingVersion !== right.pricingVersion ||
    left.utilizationPercent !== right.utilizationPercent) return false;
  const a = left.calibrationEvidence, b = right.calibrationEvidence;
  if (a?.methodVersion === 2 || b?.methodVersion === 2) {
    // Official percentage can plateau while delayed local endpoints add a
    // stronger, independently metered interval. Preserve that evidence, notably
    // when it crosses the chart's minimum calibrated-point threshold.
    if (a?.methodVersion !== b?.methodVersion || a?.collectionMode !== b?.collectionMode ||
      left.calibrationStart !== right.calibrationStart || JSON.stringify(a?.accumulated) !== JSON.stringify(b?.accumulated) ||
      JSON.stringify(a?.pricebook) !== JSON.stringify(b?.pricebook) ||
      left.fullEquivalentUsd !== right.fullEquivalentUsd || left.unusedEquivalentUsd !== right.unusedEquivalentUsd) return false;
  }
  if (left.fullEquivalentUsd === null && right.fullEquivalentUsd === null) {
    return left.localWindowKey !== undefined && left.localWindowKey === right.localWindowKey ||
      left.quotaEpoch !== undefined && right.quotaEpoch !== undefined && left.quotaEpoch.startedAt === right.quotaEpoch.startedAt;
  }
  if (left.fullEquivalentUsd === null || left.fullEquivalentUsd <= 0 || left.unusedEquivalentUsd === null ||
    right.fullEquivalentUsd === null || right.fullEquivalentUsd <= 0 || right.unusedEquivalentUsd === null) return false;
  if (left.quotaEpoch !== undefined || right.quotaEpoch !== undefined) return left.quotaEpoch !== undefined &&
    right.quotaEpoch !== undefined && left.quotaEpoch.startedAt === right.quotaEpoch.startedAt;
  return left.accountScopeKey === undefined && ['rough-prefix-v2', 'series-prefix-v1'].includes(left.method) &&
    left.calibrationStart === right.calibrationStart && Math.abs(left.resetAt - right.resetAt) <= 300_000;
}
function boundedOption(value: number | undefined, max: number): number {
  if (value === undefined) return max;
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error('weekly-estimate-archive:invalid-options');
  return value;
}

/**
 * Caller supplies an exact extension-storage file, machine salt and runtime source namespace.
 * Namespace/salt never leave memory. No account filter, expiry, eviction, migration or network I/O.
 * Every mutation rereads under the same cross-process lease; no stale cached state can resurrect data.
 */
export class WeeklyEstimateArchive {
  private readonly filePath: string;
  private readonly sourceKey: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  constructor(filePath: string, private readonly salt: string, sourceNamespace: string,
    options: WeeklyEstimateArchiveOptions = {}) {
    if (!path.isAbsolute(filePath) || !salt || salt.length > 4096 || !sourceNamespace || sourceNamespace.length > 8192) {
      throw new Error('weekly-estimate-archive:invalid-options');
    }
    this.filePath = path.resolve(filePath);
    this.maxEntries = boundedOption(options.maxEntries, WEEKLY_ESTIMATE_ARCHIVE_MAX_ENTRIES);
    this.maxBytes = boundedOption(options.maxBytes, WEEKLY_ESTIMATE_ARCHIVE_MAX_BYTES);
    this.sourceKey = this.hmac(['weekly-estimate-source-v1', sourceNamespace]);
  }
  private hmac(values: unknown[]): string {
    return createHmac('sha256', this.salt).update(JSON.stringify(values)).digest('hex');
  }
  private windowKey(sourceKey: string, value: WeeklyEstimateInput): string {
    if (value.localWindowKey !== undefined) return this.hmac(['paired-window-v1', sourceKey, value.localWindowKey]);
    if (value.quotaEpoch !== undefined) return this.hmac(['weekly-estimate-window-v2', sourceKey, value.provider,
      value.method, value.accountScopeKey, value.quotaEpoch.startedAt]);
    return this.hmac(['weekly-estimate-window-v1', sourceKey, value.provider, value.resetAt,
      value.method, value.accountScopeKey ?? null]);
  }
  private result(document: Document, bytes: number): WeeklyEstimateArchiveResult {
    const { entries, generation, clearFences } = document;
    const clearedThrough: WeeklyEstimateArchiveResult['clearedThrough'] = {};
    const accountClearedThrough: NonNullable<WeeklyEstimateArchiveResult['accountClearedThrough']> = {};
    for (const provider of ['claude', 'codex'] as const) {
      const through = cutoff(clearFences, this.sourceKey, provider);
      if (through !== undefined) clearedThrough[provider] = through;
      for (const fence of clearFences) {
        if (fence.accountFingerprint === undefined || (fence.sourceKey !== undefined && fence.sourceKey !== this.sourceKey) ||
          (fence.provider !== undefined && fence.provider !== provider)) continue;
        const accounts = accountClearedThrough[provider] ??= {};
        accounts[fence.accountFingerprint] = Math.max(accounts[fence.accountFingerprint] ?? 0, fence.observedThrough);
      }
    }
    return { status: entries.length >= this.maxEntries || bytes >= this.maxBytes ? 'full' : 'ready',
      entries: entries.filter(entry => entry.sourceKey === this.sourceKey), generation, clearedThrough,
      ...(Object.keys(accountClearedThrough).length ? { accountClearedThrough } : {}),
      totalEntries: entries.length, totalEntriesByProvider: {
        claude: entries.filter(entry => entry.provider === 'claude').length,
        codex: entries.filter(entry => entry.provider === 'codex').length,
      } };
  }
  private failed(error: unknown): WeeklyEstimateArchiveResult {
    return { status: error instanceof ArchiveFailure ? error.status : 'unavailable', entries: [],
      totalEntries: null, totalEntriesByProvider: null, generation: null, clearedThrough: {} };
  }
  /** Reject symlinks in every existing component, including the archive and its parent. */
  private async checkPath(): Promise<void> {
    const parts = this.filePath.slice(path.parse(this.filePath).root.length).split(path.sep);
    let current = path.parse(this.filePath).root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      let info;
      try { info = await lstat(current); } catch (error) { if (missing(error)) return; throw error; }
      if (info.isSymbolicLink() || (i === parts.length - 1 ? !info.isFile() : !info.isDirectory())) throw new ArchiveFailure('unsafe');
    }
  }
  private parse(value: unknown): Document {
    if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > this.maxEntries) {
      throw new ArchiveFailure('invalid');
    }
    const generation = value.generation === undefined ? 0 : value.generation;
    if (!number(generation, Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(generation)) throw new ArchiveFailure('invalid');
    const rawFences = value.clearFences === undefined ? [] : value.clearFences;
    if (!Array.isArray(rawFences) || rawFences.length > WEEKLY_ESTIMATE_ARCHIVE_MAX_CLEAR_FENCES) throw new ArchiveFailure('invalid');
    const clearFences: ClearFence[] = [];
    const fenceScopes = new Set<string>();
    for (const raw of rawFences) {
      if (!object(raw) || !timestamp(raw.observedThrough) ||
        (raw.sourceKey !== undefined && (typeof raw.sourceKey !== 'string' || !HEX.test(raw.sourceKey))) ||
        (raw.provider !== undefined && raw.provider !== 'claude' && raw.provider !== 'codex') ||
        (raw.accountFingerprint !== undefined && (typeof raw.accountFingerprint !== 'string' || !ACCOUNT_FINGERPRINT.test(raw.accountFingerprint)))) throw new ArchiveFailure('invalid');
      const scope = JSON.stringify([raw.sourceKey ?? null, raw.provider ?? null, raw.accountFingerprint ?? null]);
      if (fenceScopes.has(scope)) throw new ArchiveFailure('invalid');
      fenceScopes.add(scope);
      clearFences.push({ observedThrough: raw.observedThrough,
        ...(raw.sourceKey === undefined ? {} : { sourceKey: raw.sourceKey as string }),
        ...(raw.provider === undefined ? {} : { provider: raw.provider as WeeklyEstimateProvider }),
        ...(raw.accountFingerprint === undefined ? {} : { accountFingerprint: raw.accountFingerprint as string }) });
    }
    const entries: WeeklyEstimateEntry[] = [];
    const accountNumbers = new Map<string, number>();
    const numberedAccounts = new Map<string, string>();
    const windows = new Map<string, { revision: number; signatures: Set<string>; tuple: string }>();
    for (const raw of value.entries) {
      const input = copyInput(raw);
      if (!input || !object(raw) || typeof raw.sourceKey !== 'string' || !HEX.test(raw.sourceKey) ||
        typeof raw.windowKey !== 'string' || !HEX.test(raw.windowKey) ||
        !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1 ||
        (raw.sourceKey === this.sourceKey && raw.windowKey !== this.windowKey(raw.sourceKey, input))) throw new ArchiveFailure('invalid');
      if (input.accountScopeKey !== undefined && input.accountNumber !== undefined) {
        const account = JSON.stringify([raw.sourceKey, input.accountScopeKey]);
        const ordinal = JSON.stringify([raw.sourceKey, input.accountNumber]);
        if ((accountNumbers.has(account) && accountNumbers.get(account) !== input.accountNumber) ||
          (numberedAccounts.has(ordinal) && numberedAccounts.get(ordinal) !== input.accountScopeKey)) throw new ArchiveFailure('invalid');
        accountNumbers.set(account, input.accountNumber);
        numberedAccounts.set(ordinal, input.accountScopeKey);
      }
      const through = cutoff(clearFences, raw.sourceKey, input.provider,
        weeklyEstimateAccountFingerprint(this.salt, input.provider, input.accountScopeKey));
      if (through !== undefined && (input.observedAt <= through ||
        (input.windowEvidence !== undefined && input.windowEvidence.from <= through) ||
        (input.method === 'account-delta-v1' && input.calibrationStart !== undefined && input.calibrationStart <= through))) throw new ArchiveFailure('invalid');
      const key = raw.windowKey;
      const previous = windows.get(key);
      const signature = semanticKey(input);
      const tuple = JSON.stringify(input.localWindowKey !== undefined ? [raw.sourceKey, input.provider, input.localWindowKey] : input.quotaEpoch === undefined
        ? [raw.sourceKey, input.provider, input.resetAt, input.method, input.accountScopeKey ?? null]
        : [raw.sourceKey, input.provider, input.method, input.accountScopeKey, input.quotaEpoch]);
      if (raw.revision !== (previous?.revision ?? 0) + 1 || previous?.signatures.has(signature) ||
        (previous && previous.tuple !== tuple)) throw new ArchiveFailure('invalid');
      const signatures = previous?.signatures ?? new Set<string>();
      signatures.add(signature);
      windows.set(key, { revision: raw.revision as number, signatures, tuple });
      entries.push({ ...input, sourceKey: raw.sourceKey, windowKey: key, revision: raw.revision as number });
    }
    return { schemaVersion: 1, entries, generation, clearFences };
  }
  private async read(): Promise<Loaded> {
    await this.checkPath();
    let handle;
    try {
      const before = await lstat(this.filePath);
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new ArchiveFailure('unsafe');
      if (info.size > this.maxBytes) throw new ArchiveFailure('invalid');
      const buffer = Buffer.alloc(Math.min(this.maxBytes + 1, info.size + 1));
      let bytes = 0;
      while (bytes < buffer.length) {
        const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
        if (!read.bytesRead) break;
        bytes += read.bytesRead;
      }
      const after = await handle.stat();
      if (bytes > this.maxBytes || bytes !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new ArchiveFailure('invalid');
      let parsed: unknown;
      try { parsed = JSON.parse(buffer.subarray(0, bytes).toString('utf8')); } catch { throw new ArchiveFailure('invalid'); }
      return { ...this.parse(parsed), bytes };
    } catch (error) {
      if (missing(error)) return { ...empty(), bytes: 0 };
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new ArchiveFailure('unsafe');
      throw error;
    } finally { await handle?.close(); }
  }
  private async write(body: string): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let handle;
    try {
      await this.checkPath();
      handle = await open(temporary, 'wx', 0o600);
      await handle.chmod(0o600);
      await handle.writeFile(body, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.checkPath();
      await rename(temporary, this.filePath);
      let directoryHandle;
      try { directoryHandle = await open(directory, 'r'); await directoryHandle.sync(); }
      catch { /* Some hosts do not support directory fsync; the file was flushed. */ }
      finally { await directoryHandle?.close(); }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(error => { if (!missing(error)) throw error; });
    }
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    await this.checkPath();
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await this.checkPath();
    try {
      const lock = await lstat(`${this.filePath}.lock`);
      if (lock.isSymbolicLink() || (!lock.isDirectory() && !lock.isFile())) throw new ArchiveFailure('unsafe');
    } catch (error) { if (!missing(error)) throw error; }
    const lease = await acquireCodexIndexLease(this.filePath);
    try { return await operation(); } finally { await lease.release(); }
  }
  private async temporaries(): Promise<string[]> {
    const basename = path.basename(this.filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\.${basename}\\.\\d+\\.[a-f0-9]{12}\\.tmp$`);
    return (await readdir(path.dirname(this.filePath))).filter(name => pattern.test(name));
  }
  async load(): Promise<WeeklyEstimateArchiveResult> {
    try { const current = await this.read(); return this.result(current, current.bytes); }
    catch (error) { return this.failed(error); }
  }
  async record(value: WeeklyEstimateInput, options: WeeklyEstimateRecordOptions = {}): Promise<WeeklyEstimateRecordResult> {
    const input = copyInput(value);
    if (!input || (options.expectedGeneration !== undefined && (!number(options.expectedGeneration, Number.MAX_SAFE_INTEGER) ||
      !Number.isSafeInteger(options.expectedGeneration)))) return { ...this.failed(new ArchiveFailure('invalid')), outcome: 'invalid' };
    try {
      return await this.locked(async () => {
        const current = await this.read();
        if (options.expectedGeneration !== undefined && options.expectedGeneration !== current.generation) {
          return { ...this.result(current, current.bytes), outcome: 'stale-generation' as const };
        }
        const through = cutoff(current.clearFences, this.sourceKey, input.provider,
          weeklyEstimateAccountFingerprint(this.salt, input.provider, input.accountScopeKey));
        if (through !== undefined && (input.observedAt <= through ||
          (input.windowEvidence !== undefined && input.windowEvidence.from <= through) ||
          (input.method === 'account-delta-v1' && input.calibrationStart !== undefined && input.calibrationStart <= through))) {
          return { ...this.result(current, current.bytes), outcome: 'cleared-observation' as const };
        }
        // Incoming ordinals are display hints only. Canonical numbering is source-local and leased.
        if (input.quotaEpoch !== undefined && current.entries.some(entry => entry.sourceKey === this.sourceKey &&
          entry.provider === input.provider && entry.accountScopeKey === input.accountScopeKey &&
          entry.quotaEpoch?.startedAt === input.quotaEpoch!.startedAt &&
          JSON.stringify(entry.quotaEpoch) !== JSON.stringify(input.quotaEpoch))) {
          return { ...this.result(current, current.bytes), outcome: 'invalid' as const };
        }
        let normalized = input;
        if (input.accountScopeKey !== undefined) {
          const sourceEntries = current.entries.filter(entry => entry.sourceKey === this.sourceKey);
          const existing = sourceEntries.find(entry => entry.accountScopeKey === input.accountScopeKey && entry.accountNumber !== undefined);
          const accountNumber = existing?.accountNumber ?? Math.max(0, ...sourceEntries.map(entry => entry.accountNumber ?? 0)) + 1;
          if (accountNumber > 1e12) return { ...this.result(current, current.bytes), status: 'full' as const, outcome: 'full' as const };
          normalized = { ...input, accountNumber };
        }
        const windowKey = this.windowKey(this.sourceKey, normalized);
        const previous = current.entries.filter(entry => entry.windowKey === windowKey);
        if (previous.some(entry => semanticKey(copyInput(entry)!) === semanticKey(normalized)) ||
          current.entries.some(entry => entry.sourceKey === this.sourceKey && sameWeeklyEstimateQuotaPoint(entry, normalized))) {
          return { ...this.result(current, current.bytes), outcome: 'unchanged' as const };
        }
        const entry: WeeklyEstimateEntry = { ...normalized, sourceKey: this.sourceKey, windowKey, revision: previous.length + 1 };
        const next: Document = { schemaVersion: 1, generation: current.generation,
          clearFences: current.clearFences, entries: [...current.entries, entry] };
        const body = JSON.stringify(next);
        if (current.entries.length >= this.maxEntries || current.bytes >= this.maxBytes ||
          next.entries.length > this.maxEntries || Buffer.byteLength(body) > this.maxBytes) {
          return { ...this.result(current, current.bytes), status: 'full' as const, outcome: 'full' as const };
        }
        await this.write(body);
        return { ...this.result(next, Buffer.byteLength(body)), outcome: 'recorded' as const };
      });
    } catch (error) {
      const failure = this.failed(error);
      return { ...failure, outcome: failure.status as 'invalid' | 'unsafe' | 'unavailable' };
    }
  }
  async clear(scope: WeeklyEstimateClearScope = {}): Promise<WeeklyEstimateArchiveResult> {
    if ((scope.provider !== undefined && scope.provider !== 'claude' && scope.provider !== 'codex') ||
      (scope.allSources !== undefined && typeof scope.allSources !== 'boolean') ||
      (scope.accountFingerprint !== undefined && (typeof scope.accountFingerprint !== 'string' || !ACCOUNT_FINGERPRINT.test(scope.accountFingerprint)))) return this.failed(new ArchiveFailure('invalid'));
    try {
      return await this.locked(async () => {
        const clearAll = scope.allSources === true && scope.provider === undefined && scope.accountFingerprint === undefined;
        const temporaries = await this.temporaries();
        // An interrupted write may contain several sources; a scoped clear cannot safely retain it.
        if (!clearAll && temporaries.length) throw new ArchiveFailure('invalid');
        let current;
        try { current = await this.read(); }
        catch (error) {
          if (!(error instanceof ArchiveFailure && error.status === 'invalid' && clearAll)) throw error;
          current = { ...empty(), bytes: 0 };
        }
        const entries = current.entries.filter(entry => !((scope.allSources || entry.sourceKey === this.sourceKey) &&
          (scope.provider === undefined || entry.provider === scope.provider) &&
          (scope.accountFingerprint === undefined || weeklyEstimateAccountFingerprint(this.salt, entry.provider, entry.accountScopeKey) === scope.accountFingerprint)));
        const observedNow = Date.now();
        if (!timestamp(observedNow) || current.generation >= Number.MAX_SAFE_INTEGER) throw new ArchiveFailure('invalid');
        const fence: ClearFence = { observedThrough: observedNow,
          ...(scope.allSources ? {} : { sourceKey: this.sourceKey }),
          ...(scope.provider === undefined ? {} : { provider: scope.provider }),
          ...(scope.accountFingerprint === undefined ? {} : { accountFingerprint: scope.accountFingerprint }) };
        // Never weaken a receipt on clock rollback; also fence future-dated records actually removed.
        for (const old of current.clearFences) if (covers(fence, old)) fence.observedThrough = Math.max(fence.observedThrough, old.observedThrough);
        for (const old of current.entries) {
          if (covers(fence, { sourceKey: old.sourceKey, provider: old.provider,
            accountFingerprint: weeklyEstimateAccountFingerprint(this.salt, old.provider, old.accountScopeKey), observedThrough: 0 })) {
            fence.observedThrough = Math.max(fence.observedThrough, old.observedAt);
          }
        }
        const clearFences = current.clearFences.filter(old => !(covers(fence, old) && old.observedThrough <= fence.observedThrough));
        if (!clearFences.some(old => covers(old, fence) && old.observedThrough >= fence.observedThrough)) clearFences.push(fence);
        const next: Document = { schemaVersion: 1, generation: Math.max(current.generation + 1, observedNow), clearFences, entries };
        const body = JSON.stringify(next);
        if (clearFences.length > WEEKLY_ESTIMATE_ARCHIVE_MAX_CLEAR_FENCES || Buffer.byteLength(body) > this.maxBytes) {
          return { ...this.result(current, current.bytes), status: 'full' as const };
        }
        await this.write(body);
        if (clearAll) {
          for (const name of temporaries) {
            // unlink removes an exact auxiliary or symlink, never its target or an arbitrary directory.
            await unlink(path.join(path.dirname(this.filePath), name)).catch(error => { if (!missing(error)) throw error; });
          }
        }
        return this.result(next, Buffer.byteLength(body));
      });
    } catch (error) { return this.failed(error); }
  }
}
