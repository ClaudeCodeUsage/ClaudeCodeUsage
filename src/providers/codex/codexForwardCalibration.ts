import { createHash } from 'node:crypto';
import type { CodexIndexV1, CodexFileContribution } from './codexIndex';
import type { ProviderTokenCounts } from '../providerTypes';
import { codexQuotaObservationsFromLimit } from './codexQuotaHistory';
import { CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK } from './codexLineage';
import type { CodexQuotaCheckpoint, CodexQuotaIncompleteRange } from './codexQuotaCheckpoints';

export const CODEX_FORWARD_CALIBRATION_MAX_SOURCES = 16_384;
export const CODEX_FORWARD_CALIBRATION_MAX_BYTES = 8 * 1024 * 1024;
const MAX_HASH_BYTES = 64 * 1024 * 1024;
type Models = Readonly<Record<string, Readonly<ProviderTokenCounts>>>;
export interface CodexForwardAppendWindow {
  readonly beforeOffset: number;
  readonly throughOffset: number;
  readonly minUsageAt: number | null;
  readonly maxUsageAt: number | null;
  readonly complete: boolean;
}
export interface CodexForwardCalibrationSource {
  readonly sourceKey: string;
  readonly canonical: boolean;
  readonly eligible: boolean;
  /** Primary uncertainty only. Missing historical sidecars do not change it. */
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
  readonly quotaWitness: Readonly<{ observedAt: number; resetAt: number; usedPercent: number }> | null;
  /** Compatibility fields, always null in this forward-only producer. Historical
   * sidecars are not inspected; exact appendWindow.complete owns tail evidence. */
  readonly checkpoints: readonly Readonly<CodexQuotaCheckpoint>[] | null;
  readonly incompleteRanges: readonly Readonly<CodexQuotaIncompleteRange>[] | null;
}
export interface CodexForwardCalibration {
  readonly schemaVersion: 1;
  readonly indexGeneration: number;
  /** Verification START, before parsing/title latency and before the official RPC. */
  readonly verifiedAt: number;
  readonly sources: readonly CodexForwardCalibrationSource[];
}

const trusted = new WeakSet<object>();
const issued = new WeakMap<object, CodexForwardCalibration>();
const provenance = new WeakMap<object, { fingerprints: string; generation: number }>();
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
    l.pendingFingerprints.length >= CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK ||
    l.fingerprintBlocks.length * CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK + l.pendingFingerprints.length !== l.tokenEvents ||
    l.tokenEvents * 32 > MAX_HASH_BYTES) return undefined;
  let result = '';
  for (const block of l.fingerprintBlocks) {
    if (block.length > 22_000) return undefined;
    const data = Buffer.from(block, 'base64');
    if (data.length !== CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK * 16 || data.toString('base64') !== block) return undefined;
    result += data.toString('hex');
  }
  for (const value of l.pendingFingerprints) {
    if (!/^[a-f0-9]{32}$/.test(value)) return undefined;
    result += value;
  }
  return result;
}

function appendWindow(file: CodexFileContribution, eligible: boolean): CodexForwardAppendWindow | undefined {
  // Runtime field produced by the existing scanner, preserved by worker transport
  // and omitted by the disk DTO. Never recover an append window from timestamps.
  const raw = file.calibrationAppend;
  if (!raw || !integer(raw.beforeOffset) || !integer(raw.throughOffset) ||
    raw.beforeOffset >= raw.throughOffset || raw.throughOffset !== file.offset || typeof raw.complete !== 'boolean' ||
    !(raw.minUsageAt === null && raw.maxUsageAt === null ||
      time(raw.minUsageAt) && time(raw.maxUsageAt) && raw.minUsageAt <= raw.maxUsageAt)) return undefined;
  return Object.freeze({ beforeOffset: raw.beforeOffset, throughOffset: raw.throughOffset,
    minUsageAt: raw.minUsageAt, maxUsageAt: raw.maxUsageAt, complete: raw.complete && eligible });
}

/** No I/O, scanning, pricing, historical replay, account assertion or persistence.
 * Includes EVERY indexed physical source, not only usable canonical sources.
 * A missing manifest member makes the whole proof unavailable, never a partial census.
 * The provider supplies a fresh verificationBound for each successful manifest run;
 * absent that bound, an index object can issue only once and cannot renew its age. */
export function buildCodexForwardCalibration(
  index: CodexIndexV1, currentManifestVerified: boolean,
  canonicalFileKeys: ReadonlySet<string>, ambiguousFileKeys: ReadonlySet<string>,
  verifiedAt = Date.now(), verificationBound: object = index,
): CodexForwardCalibration | undefined {
  if (!currentManifestVerified || !time(verifiedAt)) return undefined;
  const old = issued.get(verificationBound); if (old) return old;
  const keys = Object.keys(index.files).sort(), keySet = new Set(keys);
  if (index.schemaVersion !== 3 || !time(index.indexGeneration) ||
    keys.length > CODEX_FORWARD_CALIBRATION_MAX_SOURCES || keys.length !== index.coverage.totalFiles ||
    [...canonicalFileKeys, ...ambiguousFileKeys].some(k => !keySet.has(k))) return undefined;
  const sources: CodexForwardCalibrationSource[] = [];
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
      !f.lineageReconciliation && f.qualityFlags.length === 0 && p.qualityFlags.length === 0 &&
      reconciles(byModel, f.aggregate.total);
    // These bounds include structural events and are deliberately conservative.
    const session = f.aggregate.session;
    const dated = time(session.startedAt) && time(session.endedAt) && session.startedAt <= session.endedAt;
    const eligible = valid && dated;
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
    const window = appendWindow(f, eligible);
    const source = Object.freeze({ ...fields, revision, ...(window ? { appendWindow: window } : {}) });
    bytes += Buffer.byteLength(JSON.stringify(source));
    if (bytes > CODEX_FORWARD_CALIBRATION_MAX_BYTES) return undefined;
    sources.push(source);
    provenance.set(source, { fingerprints: trace ?? '', generation: index.indexGeneration });
  }
  const proof: CodexForwardCalibration = Object.freeze({ schemaVersion: 1, indexGeneration: index.indexGeneration,
    verifiedAt, sources: Object.freeze(sources) });
  trusted.add(proof); issued.set(verificationBound, proof); return proof;
}
export function isCodexForwardCalibration(value: unknown): value is CodexForwardCalibration {
  return !!value && typeof value === 'object' && trusted.has(value);
}
/** PRIMARY append continuity only, never temporal/calibration admission. Check
 * same full source census and fresh official bounds separately. No copied source authority. */
export function isCodexForwardAppend(before: CodexForwardCalibrationSource, after: CodexForwardCalibrationSource): boolean {
  const a = provenance.get(before), b = provenance.get(after);
  if (!a || !b || a.generation !== b.generation || !before.eligible || !after.eligible ||
    before.continuity !== after.continuity || after.offset <= before.offset || after.bytes <= before.bytes ||
    !b.fingerprints.startsWith(a.fingerprints) || !before.byModel || !after.byModel) return false;
  return Object.entries(before.byModel).every(([model, tokens]) => Object.prototype.hasOwnProperty.call(after.byModel!, model) &&
    components.every(k => (after.byModel![model][k] ?? 0) >= (tokens[k] ?? 0)));
}
