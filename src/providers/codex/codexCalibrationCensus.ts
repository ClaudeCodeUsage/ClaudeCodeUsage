import type { CodexIndexV1 } from './codexIndex';
import type { CodexQuotaIncompleteRange } from './codexQuotaCheckpoints';
import { createHash } from 'node:crypto';
import { codexQuotaCheckpointStateRanges, CODEX_QUOTA_CHECKPOINT_VERSION } from './codexQuotaCheckpoints';

export const CODEX_CALIBRATION_CENSUS_MAX_SOURCES = 16_384;
export const CODEX_CALIBRATION_CENSUS_MAX_BYTES = 8 * 1024 * 1024;

/** Runtime-only producer proof. Source keys are existing machine-local HMACs;
 * revisions are opaque, never account identity or a persistent/export field. */
export interface CodexCalibrationSource {
  readonly sourceKey: string;
  readonly revision: string;
  readonly continuity: string;
  readonly bytes: number;
  readonly canonical: boolean;
  readonly eligible: boolean;
  readonly uncertain: boolean;
  /** Broad root-line activity, including nonusage metadata. */
  readonly activityThrough: number | null;
  /** Latest numeric usage/quota boundary, excluding later nonusage metadata. */
  readonly usageThrough: number | null;
  /** Complete model vectors and pairing/uncertainty provenance, not byte metadata. */
  readonly usageRevision: string;
  /** Undefined means undated uncertainty; never invent a finite bound. */
  readonly ranges: readonly CodexQuotaIncompleteRange[] | undefined;
}
export interface CodexCalibrationCensus {
  readonly schemaVersion: 1;
  readonly indexGeneration: number;
  readonly verifiedAt: number;
  readonly sources: readonly CodexCalibrationSource[];
}

/** Build in the provider host after the current manifest/index is verified.
 * Includes EVERY physical indexed file, including unpaired, noncanonical and
 * ambiguous sources. Undefined is unavailable, never an empty/partial proof.
 * No I/O, source reads, persistence, account assignment or model pricing. */
export function buildCodexCalibrationCensus(
  index: CodexIndexV1, currentManifestVerified: boolean,
  canonicalFileKeys: ReadonlySet<string>, ambiguousFileKeys: ReadonlySet<string>,
  verifiedAt = Date.now(),
): CodexCalibrationCensus | undefined {
  if (!currentManifestVerified) return undefined;
  const old = issued.get(index);
  if (old) return old;
  const keys = Object.keys(index.files).sort(), keySet = new Set(keys), coverage = index.coverage;
  if (index.schemaVersion !== 3 || !integer(index.indexGeneration) || index.indexGeneration! < 1 ||
    !integer(verifiedAt) || verifiedAt <= 0 || !coverage.complete || !coverage.period.allTime.complete ||
    keys.length > CODEX_CALIBRATION_CENSUS_MAX_SOURCES || keys.length !== coverage.totalFiles ||
    keys.length !== coverage.indexedFiles || [...canonicalFileKeys, ...ambiguousFileKeys].some(key => !keySet.has(key))) return undefined;
  const sources: CodexCalibrationSource[] = [];
  let outputBytes = 128, hashBytes = 0;
  for (const key of keys) {
    const file = index.files[key], state = file.quotaCheckpoints, lineage = file.lineage;
    if (!HEX.test(key) || file.fileKey !== key || !integer(file.size) || file.offset !== file.size ||
      !Number.isFinite(file.mtimeMs) || file.mtimeMs < 0 || file.discardingOversizedLine ||
      file.lineageReconciliation || file.periodMigration || file.compressionFailure ||
      file.compression === 'zstd' && file.compressionVerified !== true ||
      file.qualityFlags.some(flag => flag === 'stale-file' || flag === 'stale-reset-required') ||
      lineage && lineage.appliedPrefixEvents !== lineage.desiredPrefixEvents || file.parserState.schemaVersion !== 4) return undefined;
    const canonical = canonicalFileKeys.has(key), eligible = canonical && !ambiguousFileKeys.has(key) && !file.qualityFlags.includes('missing-parent');
    const current = state?.version === CODEX_QUOTA_CHECKPOINT_VERSION && state.indexedThrough === file.offset &&
      state.prefixEvents === (lineage?.desiredPrefixEvents ?? 0);
    const rawRanges = current ? codexQuotaCheckpointStateRanges(state!) : undefined;
    if (rawRanges?.some(range => !integer(range.from) || !integer(range.through) || range.through < range.from ||
      range.resetAt !== undefined && (!integer(range.resetAt) || range.resetAt === 0))) return undefined;
    const ranges = rawRanges?.map(range => Object.freeze({ from: range.from, through: range.through,
      ...(range.resetAt === undefined ? {} : { resetAt: range.resetAt }) }));
    const activity = [state?.activityThrough, state?.lastEventAt, file.aggregate.session.endedAt,
      ...(state?.rows ?? []).map(row => row.through),
      ...Object.values(file.aggregate.period?.days ?? {}).map(day => day.lastObservedAt)]
      .filter((n): n is number => typeof n === 'number' && integer(n) && n > 0);
    const activityThrough = activity.length ? Math.max(...activity) :
      file.aggregate.total.inputTotal + file.aggregate.total.outputTotal === 0 ? 0 : null;
    const usageThrough = current && integer(state!.lastEventAt) ? state!.lastEventAt : null;
    const uncertain = !eligible || !current || !state!.complete || state!.overflow || rawRanges === undefined || rawRanges.length > 0 ||
      state!.rows.some(row => !row.complete) || !covered(file);
    const identity = [key, file.sourceArea, file.dev, file.ino, file.compression,
      file.parserState.schemaVersion, file.parserState.sessionKey, file.parserState.parentSessionKey,
      file.parserState.role, file.parserState.identityLocked, lineage?.desiredPrefixEvents,
      lineage?.appliedPrefixEvents, state?.version, state?.prefixEvents, canonical, eligible];
    const proof = JSON.stringify([identity, file.size, file.offset, file.mtimeMs, file.storageSize,
      file.storageCtimeMs, file.compressionVerified, file.parserState, lineage, file.qualityFlags.slice().sort(),
      file.aggregate.total, file.aggregate.byModel, activityThrough, state]);
    const usageProof = JSON.stringify([identity, file.aggregate.total, file.aggregate.byModel,
      state?.observedTokens, state?.excludedTokens, state?.byModel, state?.rows, usageThrough,
      state?.segment, state?.segmentResetAt, state?.source, state?.pendingBoundary, state?.complete,
      state?.segmentComplete, state?.overflow, state?.rangesUnlocalized, state?.pendingGapFrom,
      state?.pendingGapUnknown, rawRanges]);
    hashBytes += Buffer.byteLength(proof) + Buffer.byteLength(usageProof);
    if (Buffer.byteLength(proof) > 1024 * 1024 || Buffer.byteLength(usageProof) > 1024 * 1024 ||
      hashBytes > 64 * 1024 * 1024) return undefined;
    const source: CodexCalibrationSource = Object.freeze({ sourceKey: key, revision: hash(proof), continuity: hash(JSON.stringify(identity)),
      bytes: file.size, canonical, eligible, uncertain, activityThrough, usageThrough,
      usageRevision: hash(usageProof), ranges: ranges && Object.freeze(ranges) });
    outputBytes += Buffer.byteLength(JSON.stringify(source));
    if (outputBytes > CODEX_CALIBRATION_CENSUS_MAX_BYTES) return undefined;
    sources.push(source);
  }
  const census: CodexCalibrationCensus = Object.freeze({ schemaVersion: 1, indexGeneration: index.indexGeneration!,
    verifiedAt, sources: Object.freeze(sources) });
  trusted.add(census); issued.set(index, census); return census;
}

/** Only immutable objects issued by this producer in this runtime qualify.
 * Serialization, caller-provided hashes and shallow frozen copies confer no authority. */
export function isCodexCalibrationCensus(value: unknown): value is CodexCalibrationCensus {
  return !!value && typeof value === 'object' && trusted.has(value);
}

const trusted = new WeakSet<object>(), issued = new WeakMap<object, CodexCalibrationCensus>();
const HEX = /^[a-f0-9]{64}$/;
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
function covered(file: CodexIndexV1['files'][string]): boolean {
  const state = file.quotaCheckpoints;
  if (!state) return false;
  const fields = ['inputTotal', 'cachedInput', 'outputTotal', 'reasoningOutput'] as const;
  const total = { inputTotal: 0, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 };
  const add = (models: Readonly<Record<string, import('../providerTypes').ProviderTokenCounts>>) => {
    for (const tokens of Object.values(models)) for (const field of fields) {
      const n = tokens[field] ?? 0;
      if (!integer(n) || !integer(total[field] + n)) return false;
      total[field] += n;
    }
    return true;
  };
  if (!add({ excluded: state.excludedTokens })) return false;
  let previous: typeof state.rows[number] | undefined;
  for (const row of state.rows) {
    if (previous && previous.segment !== row.segment && !add(previous.byModel)) return false;
    if (row.baseline && (!row.baselineByModel || !add(row.baselineByModel))) return false;
    previous = row;
  }
  return (!previous || add(previous.byModel)) && fields.every(field => total[field] === (file.aggregate.total[field] ?? 0));
}
