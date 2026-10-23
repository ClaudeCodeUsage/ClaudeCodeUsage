import type { ProviderTokenCounts } from '../providerTypes';
import type { CodexFileContribution } from './codexIndex';
import { CODEX_LINEAGE_FINGERPRINT_BYTES, CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK } from './codexLineage';

export interface CodexDeduplication {
  canonicalFileKeys: Set<string>;
  exactDuplicateFileKeys: Set<string>;
  /** Runtime-only exclusion for calibration, never removal from usage totals. */
  ambiguousFileKeys: Set<string>;
  ambiguousSessionGroups: number;
}

interface CodexDeduplicationCandidate {
  recordKey: string;
  contribution: CodexFileContribution;
}

type StableNumber = number | null;

function stableNumber(value: number | undefined): StableNumber {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tokenSignature(tokens: ProviderTokenCounts): StableNumber[] {
  return [
    stableNumber(tokens.inputTotal),
    stableNumber(tokens.cachedInput),
    stableNumber(tokens.cacheWriteInput),
    stableNumber(tokens.outputTotal),
    stableNumber(tokens.reasoningOutput),
    stableNumber(tokens.sourceTotal),
  ];
}

function bucketSignature(
  buckets: Record<string, ProviderTokenCounts>,
): Array<[string, StableNumber[]]> {
  return Object.entries(buckets)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, tokens]) => [key, tokenSignature(tokens)]);
}

function structuralSignature(structural: {
  patchCalls: number;
  toolCalls: number;
  postPatchToolCalls: number;
  compactCount: number;
  taskCompleteCount: number;
}): StableNumber[] {
  return [
    stableNumber(structural.patchCalls),
    stableNumber(structural.toolCalls),
    stableNumber(structural.postPatchToolCalls),
    stableNumber(structural.compactCount),
    stableNumber(structural.taskCompleteCount),
  ];
}

function contributionSignature(contribution: CodexFileContribution): string {
  const { aggregate } = contribution;
  const { session, structural } = aggregate;
  return JSON.stringify([
    tokenSignature(aggregate.total),
    bucketSignature(aggregate.byDay),
    bucketSignature(aggregate.byModel),
    bucketSignature(aggregate.byEffort),
    session.parentSessionKey ?? null,
    session.projectKey ?? null,
    session.role,
    stableNumber(session.startedAt),
    stableNumber(session.endedAt),
    structuralSignature(structural),
  ]);
}

function isVerified(contribution: CodexFileContribution): boolean {
  return (
    (contribution.compression !== 'zstd' || contribution.compressionVerified === true) &&
    contribution.offset === contribution.size &&
    !contribution.discardingOversizedLine
  );
}

// Runtime-only proof budget. Exhaustion excludes calibration, never usage.
const MAX_CONTINUATION_FILES = 64;
// Allow long retained sessions while bounding decoded work to 1 MiB per group
// and 4 MiB per classification (the fingerprint map adds bounded overhead).
const MAX_CONTINUATION_FINGERPRINTS = 65_536;
const MAX_CLASSIFICATION_FINGERPRINTS = 262_144;
const MAX_FINGERPRINT_BLOCK_LENGTH = Math.ceil(
  CODEX_LINEAGE_FINGERPRINT_BYTES * CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK / 3,
) * 4;

// These diagnostics concern unparsed data or numeric attribution, not overlap
// between known counted requests. Preserve them for completeness/forward-tail
// consumers: a uniqueness proof does NOT certify missing historical usage.
// Invalid timestamps, identity/parent failures, stale state and unknown flags
// remain blockers. In particular, never infer chronology for an untimed request.
const COUNTED_REQUEST_QUALITY_FLAGS = new Set([
  'unknown-event', 'invalid-json', 'oversized-jsonl-line', 'invalid-event-payload',
  'missing-token-info', 'invalid-token-count', 'invalid-turn-context',
  'counter-regression', 'component-delta-clamped',
]);

function permitsCountedRequestProof(flags: readonly string[], fileScoped = false): boolean {
  return flags.length <= 32 && flags.every(flag => typeof flag === 'string' && flag.length <= 64 && (
    COUNTED_REQUEST_QUALITY_FLAGS.has(flag) ||
    // A completed reparse retains these file diagnostics. EOF, identity and
    // stale-state checks still apply; forward authority needs its own live proof.
    fileScoped && (flag === 'replaced-jsonl' || flag === 'truncated-jsonl')
  ));
}

/** A request-empty member needs no request time range. This is not a claim of
 * complete historical coverage, nor permission to drop the member or its flags.
 * The caller still verifies EOF, identity and explicit zero lineage/prefixes. */
function hasZeroRequestContribution(file: CodexFileContribution): boolean {
  const fields = ['inputTotal', 'outputTotal', 'cachedInput', 'cacheWriteInput', 'reasoningOutput', 'sourceTotal'];
  const zeroTokens = (tokens: ProviderTokenCounts): boolean => {
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens) ||
        tokens.inputTotal !== 0 || tokens.outputTotal !== 0) return false;
    for (const key in tokens) {
      if (!fields.includes(key) ||
          (tokens[key as keyof ProviderTokenCounts] !== undefined && tokens[key as keyof ProviderTokenCounts] !== 0)) return false;
    }
    return true;
  };
  // Bound sidecar validation too; a forged zero aggregate cannot hide unbounded
  // buckets or nonzero tokens in a historical projection.
  let remainingBuckets = 256;
  function everyBucket<T>(buckets: Record<string, T>, check: (value: T) => boolean): boolean {
    if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets)) return false;
    for (const key in buckets) {
      if (--remainingBuckets < 0 || !check(buckets[key])) return false;
    }
    return true;
  }
  const validStructural = (value: CodexFileContribution['aggregate']['structural']): boolean =>
    !!value && structuralSignature(value).every(n => n !== null && Number.isSafeInteger(n) && n >= 0);
  const { aggregate, parserState, quotaCheckpoints: checkpoints, calibrationAppend: append, hourProof } = file;
  if (file.lineageReconciliation !== undefined || file.periodMigration !== undefined ||
      file.todayMigration !== undefined || file.hourProofMigration !== undefined ||
      parserState.highWater !== undefined || parserState.previousSnapshotSignature !== undefined ||
      parserState.snapshotSignaturesBySource !== undefined && !everyBucket(parserState.snapshotSignaturesBySource, () => false) ||
      !zeroTokens(aggregate.total) || !everyBucket(aggregate.byDay, zeroTokens) ||
      !everyBucket(aggregate.byModel, zeroTokens) || !everyBucket(aggregate.byEffort, zeroTokens) ||
      !validStructural(aggregate.structural)) return false;
  // Structural-only activity can have times and nonzero counters without a
  // token request. Validate it, but do not treat its range as request overlap.
  const { startedAt, endedAt } = aggregate.session;
  if (!(startedAt === undefined && endedAt === undefined) &&
      !(typeof startedAt === 'number' && Number.isFinite(startedAt) &&
        typeof endedAt === 'number' && Number.isFinite(endedAt) && startedAt <= endedAt)) return false;
  if (aggregate.period !== undefined && (!aggregate.period ||
      (aggregate.period.lineagePrefixEvents !== undefined && aggregate.period.lineagePrefixEvents !== 0) ||
      !everyBucket(aggregate.period.days, day => !!day && zeroTokens(day.total) &&
        everyBucket(day.byModel, zeroTokens) && everyBucket(day.byEffort, zeroTokens) && validStructural(day.structural)))) return false;
  const zeroHour = (hour: { total: ProviderTokenCounts; byModel: Record<string, ProviderTokenCounts> }): boolean =>
    !!hour && zeroTokens(hour.total) && everyBucket(hour.byModel, zeroTokens);
  if (aggregate.today !== undefined && (!aggregate.today || !everyBucket(aggregate.today.hours, zeroHour) ||
      aggregate.today.days !== undefined && !everyBucket(aggregate.today.days, hours => everyBucket(hours, zeroHour)))) return false;
  if (checkpoints !== undefined && (!checkpoints || checkpoints.prefixEvents !== 0 || checkpoints.overflow !== false ||
      !zeroTokens(checkpoints.observedTokens) || !zeroTokens(checkpoints.excludedTokens) ||
      !everyBucket(checkpoints.byModel, zeroTokens) || !Array.isArray(checkpoints.rows) || checkpoints.rows.length !== 0)) return false;
  if (hourProof !== undefined && (!hourProof || hourProof.prefixEvents !== 0 ||
      !Array.isArray(hourProof.hours) || hourProof.hours.length !== 0)) return false;
  if (append !== undefined && (!append || append.complete !== true || append.throughOffset !== file.offset ||
      append.minUsageAt !== null || append.maxUsageAt !== null ||
      append.slices !== undefined && (!Array.isArray(append.slices) || append.slices.length !== 0))) return false;
  return true;
}

function isVerifiedContinuation(
  group: readonly CodexDeduplicationCandidate[],
  budget: { remaining: number },
): boolean {
  if (group.length > MAX_CONTINUATION_FILES) return false;
  const identity = group[0].contribution.aggregate.session;
  const treeKey = group[0].contribution.parserState.treeKey;
  let fingerprints = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const { contribution } of group) {
    const { aggregate: { session }, parserState, lineage } = contribution;
    const { startedAt, endedAt } = session;
    if (!isVerified(contribution) || contribution.compressionFailure ||
        !Number.isSafeInteger(contribution.size) || contribution.size < 0 ||
        !permitsCountedRequestProof(contribution.qualityFlags, true) ||
        !permitsCountedRequestProof(parserState.qualityFlags) ||
        parserState.identityLocked !== true ||
        session.sessionKey !== identity.sessionKey ||
        session.parentSessionKey !== identity.parentSessionKey ||
        session.projectKey !== identity.projectKey || session.role !== identity.role ||
        parserState.sessionKey !== session.sessionKey ||
        parserState.parentSessionKey !== session.parentSessionKey ||
        parserState.projectKey !== session.projectKey || parserState.role !== session.role ||
        parserState.treeKey !== treeKey ||
        !lineage || lineage.appliedPrefixEvents !== 0 || lineage.desiredPrefixEvents !== 0 ||
        !Number.isSafeInteger(lineage.tokenEvents) || lineage.tokenEvents < 0 ||
        !Array.isArray(lineage.fingerprintBlocks) || !Array.isArray(lineage.pendingFingerprints) ||
        lineage.fingerprintBlocks.length > lineage.tokenEvents ||
        lineage.pendingFingerprints.length > lineage.tokenEvents ||
        lineage.pendingFingerprints.length >= CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK) return false;
    if (lineage.tokenEvents === 0) {
      if (!hasZeroRequestContribution(contribution)) return false;
      continue;
    }
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) ||
        typeof endedAt !== 'number' || !Number.isFinite(endedAt) || startedAt > endedAt) return false;
    fingerprints += lineage.tokenEvents;
    if (fingerprints > MAX_CONTINUATION_FINGERPRINTS || fingerprints > budget.remaining) return false;
    ranges.push({ start: startedAt, end: endedAt });
  }
  ranges.sort((left, right) => left.start - right.start);
  if (ranges.some((range, index) => index > 0 && range.start <= ranges[index - 1].end)) return false;

  // Charge the complete declared trace even if decoding or comparison later fails.
  // Per-block size/count checks precede decoding; malformed counts cannot bypass
  // this budget. The map holds at most one group's fingerprints, never the corpus.
  budget.remaining -= fingerprints;
  const owners = new Map<string, number>();
  for (let owner = 0; owner < group.length; owner++) {
    const lineage = group[owner].contribution.lineage!;
    let seen = 0;
    const accept = (fingerprint: string): boolean => {
      const previousOwner = owners.get(fingerprint);
      if (previousOwner !== undefined && previousOwner !== owner) return false;
      owners.set(fingerprint, owner);
      return true;
    };
    for (const block of lineage.fingerprintBlocks) {
      if (typeof block !== 'string' || block.length === 0 ||
          block.length > MAX_FINGERPRINT_BLOCK_LENGTH || block.length % 4 !== 0) return false;
      const padding = (block.endsWith('=') ? 1 : 0) + (block.endsWith('==') ? 1 : 0);
      const bytes = block.length / 4 * 3 - padding;
      const count = bytes / CODEX_LINEAGE_FINGERPRINT_BYTES;
      if (!Number.isInteger(count) || count <= 0 ||
          count > CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK || seen + count > lineage.tokenEvents) return false;
      const decoded = Buffer.from(block, 'base64');
      // Node's decoder accepts malformed input; require canonical packed evidence.
      if (decoded.length !== bytes || decoded.toString('base64') !== block) return false;
      seen += count;
      for (let offset = 0; offset < bytes; offset += CODEX_LINEAGE_FINGERPRINT_BYTES) {
        if (!accept(decoded.toString('hex', offset, offset + CODEX_LINEAGE_FINGERPRINT_BYTES))) return false;
      }
    }
    if (seen + lineage.pendingFingerprints.length !== lineage.tokenEvents) return false;
    for (const fingerprint of lineage.pendingFingerprints) {
      if (typeof fingerprint !== 'string' || fingerprint.length !== CODEX_LINEAGE_FINGERPRINT_BYTES * 2 ||
          !/^[a-f0-9]+$/.test(fingerprint) || !accept(fingerprint)) return false;
    }
  }
  return true;
}

export function classifyCodexSessionDuplicates(
  files: Readonly<Record<string, CodexFileContribution>>,
): CodexDeduplication {
  const canonicalFileKeys = new Set(Object.keys(files));
  const exactDuplicateFileKeys = new Set<string>();
  const ambiguousFileKeys = new Set<string>();
  const groups = new Map<string, CodexDeduplicationCandidate[]>();

  for (const [recordKey, contribution] of Object.entries(files)) {
    const sessionKey = contribution.aggregate.session.sessionKey;
    if (!sessionKey) {
      continue;
    }
    const group = groups.get(sessionKey) ?? [];
    group.push({ recordKey, contribution });
    groups.set(sessionKey, group);
  }

  let ambiguousSessionGroups = 0;
  const continuationBudget = { remaining: MAX_CLASSIFICATION_FINGERPRINTS };
  for (const group of groups.values()) {
    if (group.length === 1) {
      continue;
    }
    const active = group.filter(
      (candidate) => candidate.contribution.sourceArea === 'sessions',
    );
    const archive = group.filter(
      (candidate) => candidate.contribution.sourceArea === 'archive',
    );
    if (
      group.length === 2 &&
      active.length === 1 &&
      archive.length === 1 &&
      isVerified(active[0].contribution) &&
      isVerified(archive[0].contribution) &&
      contributionSignature(active[0].contribution) ===
        contributionSignature(archive[0].contribution)
    ) {
      canonicalFileKeys.delete(archive[0].recordKey);
      exactDuplicateFileKeys.add(archive[0].recordKey);
      continue;
    }
    // Canonical totals already contain continuations. Only lift the runtime
    // exclusion after bounded evidence rules out shared counted requests;
    // historical completeness and live calibration authority remain separate.
    if (isVerifiedContinuation(group, continuationBudget)) continue;
    ambiguousSessionGroups += 1;
    for (const candidate of group) ambiguousFileKeys.add(candidate.recordKey);
  }

  return {
    canonicalFileKeys,
    exactDuplicateFileKeys,
    ambiguousFileKeys,
    ambiguousSessionGroups,
  };
}
