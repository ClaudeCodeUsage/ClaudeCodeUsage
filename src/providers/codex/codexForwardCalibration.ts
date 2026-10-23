import { createHash } from 'node:crypto';
import type { CodexIndexV1, CodexFileContribution } from './codexIndex';
import type { ProviderTokenCounts } from '../providerTypes';
import { isCodexForwardHistoricalQualityFlag } from './codexParser';
import { isCodexForwardFileQualityFlag } from './codexForwardQuality';
import { codexQuotaObservationsFromLimit } from './codexQuotaHistory';
import { CODEX_LINEAGE_FINGERPRINT_BYTES, CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK } from './codexLineage';
import type { CodexQuotaCheckpoint, CodexQuotaIncompleteRange } from './codexQuotaCheckpoints';
import { copyCodexForwardSlices, CodexForwardUsageSlice } from './codexForwardSlices';

export const CODEX_FORWARD_CALIBRATION_MAX_SOURCES = 16_384;
export const CODEX_FORWARD_CALIBRATION_MAX_BYTES = 8 * 1024 * 1024;
export const CODEX_FORWARD_APPEND_MAX_PER_SOURCE = 32;
export const CODEX_FORWARD_APPEND_MAX_WINDOWS = 512;
export const CODEX_FORWARD_APPEND_MAX_BYTES = 256 * 1024;
export const CODEX_FORWARD_BIRTH_MAX_BASELINES = 32;
const MAX_HASH_BYTES = 64 * 1024 * 1024;
type Models = Readonly<Record<string, Readonly<ProviderTokenCounts>>>;
export interface CodexForwardAppendWindow {
  readonly beforeOffset: number;
  readonly throughOffset: number;
  readonly minUsageAt: number | null;
  readonly maxUsageAt: number | null;
  readonly complete: boolean;
  /** Optional prospective numeric detail. Absence never authorizes cutting USD. */
  readonly slices?: readonly CodexForwardUsageSlice[];
}
export interface CodexForwardCalibrationSource {
  readonly sourceKey: string;
  readonly canonical: boolean;
  readonly eligible: boolean;
  /** Forward-baseline validity only. Approved old gaps never establish full
   * history completeness; missing historical sidecars do not change it. */
  readonly uncertain: boolean;
  readonly bytes: number;
  readonly offset: number;
  readonly revision: string;
  readonly continuity: string;
  readonly parserStateHash: string;
  readonly lineage: Readonly<{ tokenEvents: number; prefixEvents: number; hash: string }> | null;
  readonly byModel: Models | null;
  /** Conservative bounds of ALL primary usage, never bounds of a difference. */
  readonly usageFrom: number | null;
  readonly usageThrough: number | null;
  /** Primary aggregates omit some metadata activity; null is unknown. */
  readonly activityThrough: number | null;
  /** Primary cumulative vectors cannot locate the first newly appended request. */
  readonly incrementFrom: null;
  /** Optional scan-issued runtime witness. Exact offset matching is mandatory;
   * absence is unknown, never a zero delta or permission to infer first timing. */
  readonly appendWindow?: CodexForwardAppendWindow;
  /** Bounded runtime-only suffix, oldest first. Consumers must select a chain
   * exactly from their baseline offset; an evicted/missing prefix is unknown. */
  readonly appendWindows?: readonly CodexForwardAppendWindow[];
  readonly quotaWitness: Readonly<{ observedAt: number; resetAt: number; usedPercent: number }> | null;
  /** Compatibility fields, always null in this forward-only producer. Historical
   * sidecars are not inspected; exact appendWindow.complete owns tail evidence. */
  readonly checkpoints: readonly Readonly<CodexQuotaCheckpoint>[] | null;
  readonly incompleteRanges: readonly Readonly<CodexQuotaIncompleteRange>[] | null;
}
export interface CodexForwardCalibration {
  readonly schemaVersion: 1;
  /** Runtime collection capability, including a baseline before any slices.
   * Consumers must still prove every required slice and interval bound. */
  readonly slicesVersion?: 1;
  readonly indexGeneration: number;
  /** Verification START, before parsing/title latency and before the official RPC. */
  readonly verifiedAt: number;
  readonly sources: readonly CodexForwardCalibrationSource[];
}

const trusted = new WeakSet<object>();
const issued = new WeakMap<object, { proof: CodexForwardCalibration; forwardSourcesCurrent: boolean | undefined }>();
const provenance = new WeakMap<object, { fingerprints: string; generation: number; qualityFlags: readonly string[]; root: boolean }>();
interface ProofSummary { readonly token: object; readonly keys: ReadonlySet<string>; readonly verifiedAt: number }
const proofAncestry = new WeakMap<object, { summary: ProofSummary; recent: readonly ProofSummary[] }>();
const births = new WeakMap<object, { readonly baselines: readonly object[]; readonly bornAt: number }>();
const seenInitialScans = new WeakSet<object>();
const HEX = /^[a-f0-9]{64}$/;
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const time = (n: unknown): n is number => integer(n) && n > 0;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const components = ['inputTotal', 'cachedInput', 'outputTotal', 'reasoningOutput'] as const;

function vector(raw: ProviderTokenCounts): Readonly<ProviderTokenCounts> | undefined {
  const v = { inputTotal: raw.inputTotal, cachedInput: raw.cachedInput ?? 0,
    outputTotal: raw.outputTotal, reasoningOutput: raw.reasoningOutput ?? 0,
    sourceTotal: raw.inputTotal + raw.outputTotal };
  return components.every(k => integer(v[k])) && v.cachedInput <= v.inputTotal &&
    v.reasoningOutput <= v.outputTotal && integer(v.inputTotal + v.outputTotal) ? Object.freeze(v) : undefined;
}
function models(raw: Readonly<Record<string, ProviderTokenCounts>>): Models | null {
  const keys = Object.keys(raw).sort();
  if (keys.length > 256) return null;
  const result: Record<string, Readonly<ProviderTokenCounts>> = Object.create(null);
  for (const key of keys) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key) || key === 'unknown') return null;
    const v = vector(raw[key]); if (!v) return null;
    result[key] = v;
  }
  return Object.freeze(result);
}
function reconciles(byModel: Models | null, total: ProviderTokenCounts): boolean {
  const v = vector(total); if (!byModel || !v) return false;
  return components.every(k => {
    let sum = 0;
    for (const counts of Object.values(byModel)) { sum += counts[k] ?? 0; if (!integer(sum)) return false; }
    return sum === (v[k] ?? 0);
  });
}
function fingerprints(file: CodexFileContribution): string | undefined {
  const l = file.lineage;
  if (!l || !integer(l.tokenEvents) || !integer(l.desiredPrefixEvents) || !integer(l.appliedPrefixEvents) ||
    l.desiredPrefixEvents > l.tokenEvents || l.appliedPrefixEvents !== l.desiredPrefixEvents ||
    !Array.isArray(l.fingerprintBlocks) || !Array.isArray(l.pendingFingerprints) ||
    l.pendingFingerprints.length >= CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK ||
    l.fingerprintBlocks.length > Math.ceil(l.tokenEvents / CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK) ||
    l.tokenEvents * CODEX_LINEAGE_FINGERPRINT_BYTES * 2 > MAX_HASH_BYTES) return undefined;
  const blockBytes = CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK * CODEX_LINEAGE_FINGERPRINT_BYTES;
  const maxEncodedLength = Math.ceil(blockBytes / 3) * 4;
  let result = '', count = 0;
  for (let i = 0; i < l.fingerprintBlocks.length; i++) {
    const block = l.fingerprintBlocks[i];
    if (typeof block !== 'string' || block.length === 0 || block.length > maxEncodedLength) return undefined;
    const data = Buffer.from(block, 'base64');
    if (data.length === 0 || data.length > blockBytes || data.length % CODEX_LINEAGE_FINGERPRINT_BYTES !== 0 ||
      data.toString('base64') !== block) return undefined;
    // EOF packs the final short block. On a subsequent append the scanner
    // unpacks that tail before adding pending fingerprints; both cannot coexist.
    if (data.length < blockBytes && (i !== l.fingerprintBlocks.length - 1 || l.pendingFingerprints.length > 0)) return undefined;
    count += data.length / CODEX_LINEAGE_FINGERPRINT_BYTES;
    if (count > l.tokenEvents) return undefined;
    result += data.toString('hex');
  }
  for (const value of l.pendingFingerprints) {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) return undefined;
    count++;
    result += value;
  }
  return count === l.tokenEvents ? result : undefined;
}

function appendWindow(file: CodexFileContribution, eligible: boolean): CodexForwardAppendWindow | undefined {
  // Runtime field produced by the existing scanner, preserved by worker transport
  // and omitted by the disk DTO. Never recover an append window from timestamps.
  const raw = file.calibrationAppend;
  if (!raw || !integer(raw.beforeOffset) || !integer(raw.throughOffset) ||
    raw.beforeOffset >= raw.throughOffset || raw.throughOffset !== file.offset || typeof raw.complete !== 'boolean' ||
    !(raw.minUsageAt === null && raw.maxUsageAt === null ||
      time(raw.minUsageAt) && time(raw.maxUsageAt) && raw.minUsageAt <= raw.maxUsageAt)) return undefined;
  const slices = copyCodexForwardSlices(raw.slices);
  const bounded = slices && (slices.length === 0 ? raw.minUsageAt === null && raw.maxUsageAt === null :
    slices[0].from === raw.minUsageAt && slices[slices.length - 1].through === raw.maxUsageAt);
  return Object.freeze({ beforeOffset: raw.beforeOffset, throughOffset: raw.throughOffset,
    minUsageAt: raw.minUsageAt, maxUsageAt: raw.maxUsageAt, complete: raw.complete && eligible,
    ...(bounded ? { slices } : {}) });
}

function unchangedUsage(before: CodexForwardCalibrationSource, after: CodexForwardCalibrationSource): boolean {
  return !!before.byModel && !!after.byModel &&
    [...new Set([...Object.keys(before.byModel), ...Object.keys(after.byModel)])].every(model =>
      components.every(k => (before.byModel![model]?.[k] ?? 0) === (after.byModel![model]?.[k] ?? 0)));
}

function zeroUsage(source: CodexForwardCalibrationSource): boolean {
  return source.byModel !== null && Object.values(source.byModel).every(v => v.inputTotal === 0 && v.outputTotal === 0);
}

function completeBirthChain(source: CodexForwardCalibrationSource): boolean {
  let offset = 0, usageThrough: number | null = null;
  const windows = source.appendWindows;
  if (!windows?.length || windows.length > CODEX_FORWARD_APPEND_MAX_PER_SOURCE) return false;
  for (const window of windows) {
    if (!window.complete || window.beforeOffset !== offset || window.throughOffset <= offset) return false;
    if (window.minUsageAt === null) { if (window.maxUsageAt !== null) return false; }
    else {
      if (window.maxUsageAt === null || window.minUsageAt > window.maxUsageAt ||
        usageThrough !== null && window.minUsageAt <= usageThrough) return false;
      usageThrough = window.maxUsageAt;
    }
    offset = window.throughOffset;
  }
  return offset === source.offset && offset === source.bytes && (usageThrough !== null || zeroUsage(source));
}

/** No I/O, scanning, pricing, historical replay, account assertion or persistence.
 * Includes EVERY indexed physical source, not only usable canonical sources.
 * A missing manifest member makes the whole proof unavailable, never a partial census.
 * The provider supplies a fresh verificationBound for each successful manifest run;
 * absent that bound, an index object can issue only once and cannot renew its age. */
export function buildCodexForwardCalibration(
  index: CodexIndexV1, currentManifestVerified: boolean,
  canonicalFileKeys: ReadonlySet<string>, ambiguousFileKeys: ReadonlySet<string>,
  verifiedAt = Date.now(), verificationBound: object = index, previousProof?: unknown,
  forwardSourcesCurrent?: boolean,
): CodexForwardCalibration | undefined {
  if (!currentManifestVerified || forwardSourcesCurrent === false || !time(verifiedAt)) return undefined;
  const old = issued.get(verificationBound);
  if (old) return old.forwardSourcesCurrent === forwardSourcesCurrent ? old.proof : undefined;
  const keys = Object.keys(index.files).sort(), keySet = new Set(keys);
  if (index.schemaVersion !== 3 || !time(index.indexGeneration) ||
    keys.length > CODEX_FORWARD_CALIBRATION_MAX_SOURCES || keys.length !== index.coverage.totalFiles ||
    [...canonicalFileKeys, ...ambiguousFileKeys].some(k => !keySet.has(k))) return undefined;
  const sources: CodexForwardCalibrationSource[] = [];
  // Only the provider's live branded proof can bridge disk DTO reloads. Copying
  // a proof, or merely passing the same index again, cannot restore authority.
  const previous = isCodexForwardCalibration(previousProof) && previousProof.indexGeneration === index.indexGeneration &&
    previousProof.verifiedAt <= verifiedAt ? new Map(previousProof.sources.map(source => [source.sourceKey, source])) : undefined;
  const previousAncestry = previous ? proofAncestry.get(previousProof as object) : undefined;
  // Summaries have no parent pointer: retaining 32 never retains an unbounded
  // chain of old proofs. Absence is checked across every retained predecessor.
  const recent = previousAncestry ? [previousAncestry.summary, ...previousAncestry.recent]
    .slice(0, CODEX_FORWARD_BIRTH_MAX_BASELINES) : [];
  let windowCount = 0, windowBytes = 0;
  let bytes = 128, hashBytes = 0;
  for (const key of keys) {
    const f = index.files[key], p = f.parserState, l = f.lineage;
    if (!HEX.test(key) || f.fileKey !== key || !integer(f.size) || !integer(f.offset) || f.offset > f.size ||
      !Number.isFinite(f.mtimeMs) || f.mtimeMs < 0) return undefined;
    const byModel = models(f.aggregate.byModel), trace = fingerprints(f);
    const canonical = canonicalFileKeys.has(key);
    const valid = canonical && !ambiguousFileKeys.has(key) && f.identityChecked === true &&
      p.schemaVersion === 4 && p.fileKey === key && p.sessionKey === f.aggregate.session.sessionKey &&
      p.parentSessionKey === f.aggregate.session.parentSessionKey && p.role === f.aggregate.session.role &&
      p.identityLocked === true && trace !== undefined &&
      integer(f.dev) && f.dev > 0 && integer(f.ino) && f.ino > 0 &&
      !f.compression && !f.compressionFailure && f.offset === f.size && !f.discardingOversizedLine &&
      !f.lineageReconciliation && f.qualityFlags.every(flag => isCodexForwardFileQualityFlag(flag, forwardSourcesCurrent === true)) &&
      p.qualityFlags.every(isCodexForwardHistoricalQualityFlag) &&
      reconciles(byModel, f.aggregate.total);
    // These bounds include structural events and are deliberately conservative.
    const session = f.aggregate.session;
    const dated = time(session.startedAt) && time(session.endedAt) && session.startedAt <= session.endedAt;
    const eligible = valid && (dated || f.aggregate.total.inputTotal === 0 && f.aggregate.total.outputTotal === 0);
    const identity = [key, f.sourceArea, f.dev, f.ino, f.compression, p.schemaVersion,
      p.sessionKey, p.parentSessionKey, p.treeKey, p.role, p.identityLocked,
      l?.desiredPrefixEvents, l?.appliedPrefixEvents, canonical, ambiguousFileKeys.has(key)];
    const continuity = hash(JSON.stringify(identity));
    const parser = JSON.stringify([p.highWater, p.previousSnapshotSignature, p.currentTurnId,
      Object.entries(p.snapshotSignaturesBySource ?? {}).sort(([a], [b]) => a.localeCompare(b)), p.model, p.effort]);
    // Bind rejected numeric/lineage states too: two unavailable vectors must
    // never both hash as null and make a changed unknown source appear static.
    const r = f.lineageReconciliation;
    // A reconciliation draft can itself contain old quota sidecars. Retain only
    // primary cursor/identity/counter state, never serialize its history payload.
    const reconciliation = r ? [r.offset, r.discardingOversizedLine, r.prefixEvents, r.tokenEventsSeen,
      r.parserState.schemaVersion, r.parserState.sessionKey, r.parserState.parentSessionKey,
      r.parserState.role, r.parserState.highWater, r.parserState.previousSnapshotSignature,
      r.parserState.snapshotSignaturesBySource, r.parserState.currentTurnId, r.parserState.model,
      r.parserState.effort, r.parserState.qualityFlags,
      r.aggregate.total, Object.entries(r.aggregate.byModel).sort(([a], [b]) => a.localeCompare(b)), r.qualityFlags] : null;
    const primary = JSON.stringify([f.aggregate.total, Object.entries(f.aggregate.byModel).sort(([a], [b]) => a.localeCompare(b)),
      l, reconciliation, f.compressionVerified, f.compressionFailure]);
    hashBytes += (parser.length + primary.length) * 2 + (trace?.length ?? 0);
    if (hashBytes > MAX_HASH_BYTES || parser.length > 1024 * 1024 || primary.length > MAX_HASH_BYTES / 2) return undefined;
    const candidates = [...(f.quotaHistory ?? []), ...[f.limit, ...Object.values(f.limits ?? {})]
      .flatMap(limit => limit ? codexQuotaObservationsFromLimit(limit) : [])]
      .filter(row => time(row.observedAt) && time(row.resetAt) && row.resetAt > row.observedAt &&
        Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100)
      .sort((a, b) => b.observedAt - a.observedAt);
    const latest = candidates[0];
    const witness = latest && !candidates.some(row => row.observedAt === latest.observedAt &&
      (row.resetAt !== latest.resetAt || row.usedPercent !== latest.usedPercent)) ? latest : undefined;
    const quotaWitness = witness ? Object.freeze({ observedAt: witness.observedAt,
      resetAt: witness.resetAt, usedPercent: witness.usedPercent }) : null;
    const lineage = trace === undefined ? null : Object.freeze({ tokenEvents: l!.tokenEvents,
      prefixEvents: l!.desiredPrefixEvents, hash: hash(trace) });
    const parserStateHash = hash(parser);
    const fields = { sourceKey: key, canonical, eligible, uncertain: !eligible, bytes: f.size, offset: f.offset,
      continuity, parserStateHash, lineage, byModel, usageFrom: dated ? session.startedAt! : null,
      usageThrough: dated ? session.endedAt! : null, activityThrough: null, incrementFrom: null,
      quotaWitness, checkpoints: null, incompleteRanges: null };
    const revision = hash(JSON.stringify([fields, f.mtimeMs, f.storageSize, f.storageCtimeMs,
      f.discardingOversizedLine, primary, f.qualityFlags, p.qualityFlags]));
    let window = appendWindow(f, eligible);
    const candidate = Object.freeze({ ...fields, revision, ...(window ? { appendWindow: window } : {}) });
    const origin = { fingerprints: trace ?? '', generation: index.indexGeneration,
      qualityFlags: [...new Set([...f.qualityFlags, ...p.qualityFlags])].sort(),
      root: p.role === 'root' && !p.parentSessionKey && !session.parentSessionKey &&
        l?.desiredPrefixEvents === 0 && l.appliedPrefixEvents === 0 };
    provenance.set(candidate, origin);
    const prior = previous?.get(key);
    const initialScan = f.calibrationAppend;
    const firstInitialPublication = initialScan?.beforeOffset === 0 && !seenInitialScans.has(initialScan);
    if (initialScan?.beforeOffset === 0) seenInitialScans.add(initialScan);
    let birth = prior && births.get(prior);
    if (!prior && previous && previousAncestry && firstInitialPublication && origin.root && eligible &&
      window?.complete && window.beforeOffset === 0 && previousAncestry.summary.verifiedAt < verifiedAt) {
      const baselines: object[] = [];
      for (const ancestor of recent) {
        if (ancestor.keys.has(key)) break;
        baselines.push(ancestor.token);
      }
      if (baselines.length) birth = { baselines: Object.freeze(baselines), bornAt: verifiedAt };
    }
    if (window?.complete && prior?.eligible && candidate.eligible && prior.continuity === candidate.continuity &&
        prior.revision !== candidate.revision) {
      const ordered = window.minUsageAt === null
        ? unchangedUsage(prior, candidate)
        : prior.usageThrough === null ? zeroUsage(prior) : window.minUsageAt > prior.usageThrough;
      if (!ordered || window.beforeOffset !== prior.offset || !isCodexForwardAppend(prior, candidate)) {
        // Per-scan ordering alone does not establish ordering across watcher
        // passes. Keep neither a bridge nor a compatibility admission for it.
        window = Object.freeze({ ...window, complete: false });
      }
    }
    let history: readonly CodexForwardAppendWindow[] = window?.complete && (window.beforeOffset !== 0 || birth) ? [window] : [];
    if (prior?.eligible && candidate.eligible && prior.continuity === candidate.continuity) {
      if (prior.revision === candidate.revision) {
        // A freshly verified, unchanged primary source may have been normalized
        // through the disk DTO, which intentionally contains no append window.
        history = prior.appendWindows ?? history;
      } else if (window?.complete && window.beforeOffset === prior.offset && isCodexForwardAppend(prior, candidate)) {
        history = [...(prior.appendWindows ?? []), window];
      }
    }
    const available = Math.min(CODEX_FORWARD_APPEND_MAX_PER_SOURCE, CODEX_FORWARD_APPEND_MAX_WINDOWS - windowCount);
    let retained = available > 0 ? history.slice(-available) : [];
    let retainedBytes = retained.length ? Buffer.byteLength(JSON.stringify(retained)) : 0;
    while (retained.length && windowBytes + retainedBytes > CODEX_FORWARD_APPEND_MAX_BYTES) {
      retained = retained.slice(1);
      retainedBytes = retained.length ? Buffer.byteLength(JSON.stringify(retained)) : 0;
    }
    windowCount += retained.length; windowBytes += retainedBytes;
    let latestWindow = window ?? retained[retained.length - 1];
    if (latestWindow?.slices && !retained.includes(latestWindow)) {
      // Compatibility timing may remain visible after its detail was evicted,
      // but the standalone latest-window alias cannot bypass the detail budget.
      const { slices: _omittedDetail, ...timing } = latestWindow;
      latestWindow = Object.freeze(timing);
    }
    const source = Object.freeze({ ...candidate, ...(latestWindow ? { appendWindow: latestWindow } : {}),
      appendWindows: Object.freeze(retained) });
    bytes += Buffer.byteLength(JSON.stringify(source));
    if (bytes > CODEX_FORWARD_CALIBRATION_MAX_BYTES) return undefined;
    sources.push(source);
    provenance.set(source, origin);
    if (birth && origin.root && source.eligible && (!prior || prior.continuity === source.continuity &&
      (prior.revision === source.revision || window?.complete && isCodexForwardAppend(prior, source))) &&
      completeBirthChain(source)) births.set(source, birth);
  }
  const proof: CodexForwardCalibration = Object.freeze({ schemaVersion: 1,
    ...(forwardSourcesCurrent === true ? { slicesVersion: 1 as const } : {}), indexGeneration: index.indexGeneration,
    verifiedAt, sources: Object.freeze(sources) });
  trusted.add(proof); issued.set(verificationBound, { proof, forwardSourcesCurrent });
  proofAncestry.set(proof, { summary: { token: {}, keys: new Set(keys), verifiedAt }, recent });
  return proof;
}
export function isCodexForwardCalibration(value: unknown): value is CodexForwardCalibration {
  return !!value && typeof value === 'object' && trusted.has(value);
}
/** Structural root-birth authority only. The consumer must still retain and
 * validate every old source, all model pricing and the official time bracket. */
export function isCodexForwardBirth(before: CodexForwardCalibration, after: CodexForwardCalibrationSource): boolean {
  if (!isCodexForwardCalibration(before)) return false;
  const base = proofAncestry.get(before), birth = births.get(after), origin = provenance.get(after);
  return !!base && !!birth && !!origin && origin.root && after.eligible && !after.uncertain &&
    origin.generation === before.indexGeneration && before.verifiedAt < birth.bornAt &&
    !base.summary.keys.has(after.sourceKey) && birth.baselines.includes(base.summary.token) && completeBirthChain(after);
}
/** PRIMARY append continuity only, never temporal/calibration admission. Check
 * same full source census and fresh official bounds separately. No copied source authority. */
export function isCodexForwardAppend(before: CodexForwardCalibrationSource, after: CodexForwardCalibrationSource): boolean {
  const a = provenance.get(before), b = provenance.get(after);
  if (!a || !b || a.generation !== b.generation || !before.eligible || !after.eligible ||
    b.qualityFlags.some(flag => !a.qualityFlags.includes(flag)) ||
    before.continuity !== after.continuity || after.offset <= before.offset || after.bytes <= before.bytes ||
    !b.fingerprints.startsWith(a.fingerprints) || !before.byModel || !after.byModel) return false;
  return Object.entries(before.byModel).every(([model, tokens]) => Object.prototype.hasOwnProperty.call(after.byModel!, model) &&
    components.every(k => (after.byModel![model][k] ?? 0) >= (tokens[k] ?? 0)));
}
