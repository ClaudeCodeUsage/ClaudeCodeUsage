/** A timezone-neutral, positive-output hour set. No source text or identifiers. */
export const CODEX_UTC_HOUR_PROOF_VERSION = 1;
export const MAX_CODEX_HOURS_PER_FILE = 32_768;
export const MAX_CODEX_HOURS_IN_SNAPSHOT = 524_288;
const HOUR_MS = 3_600_000;

export interface CodexHourProof {
  version: typeof CODEX_UTC_HOUR_PROOF_VERSION;
  /** Verified JSONL byte position, never a guessed file size. */
  indexedThrough: number;
  /** Lineage token events intentionally excluded from this proof. */
  prefixEvents: number;
  /** Strictly increasing absolute UTC hour IDs with positive output. */
  hours: number[];
}

function safeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function sanitizeCodexHourProof(value: unknown): CodexHourProof | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== CODEX_UTC_HOUR_PROOF_VERSION ||
      !safeNonnegativeInteger(candidate.indexedThrough) ||
      !safeNonnegativeInteger(candidate.prefixEvents) ||
      !Array.isArray(candidate.hours) ||
      candidate.hours.length > MAX_CODEX_HOURS_PER_FILE) return undefined;
  const hours: number[] = [];
  for (const hour of candidate.hours) {
    if (!Number.isSafeInteger(hour) || hour <= 0 ||
        (hours.length > 0 && hour <= hours[hours.length - 1])) return undefined;
    hours.push(hour);
  }
  return {
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    indexedThrough: candidate.indexedThrough,
    prefixEvents: candidate.prefixEvents,
    hours,
  };
}

/** Return undefined on capacity exhaustion; callers must fail closed. */
export function addCodexOutputHour(
  hours: readonly number[],
  timestamp: number,
  outputTotal: number,
): number[] | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0 ||
      !Number.isSafeInteger(outputTotal) || outputTotal <= 0) return hours as number[];
  const hour = Math.floor(timestamp / HOUR_MS);
  if (!Number.isSafeInteger(hour) || hour <= 0) return hours as number[];
  let low = 0;
  let high = hours.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (hours[mid] < hour) low = mid + 1;
    else high = mid;
  }
  if (hours[low] === hour) return hours as number[];
  if (hours.length >= MAX_CODEX_HOURS_PER_FILE) return undefined;
  const next = [...hours];
  next.splice(low, 0, hour);
  return next;
}

/** Mutates only an owned working array; avoids copying it for every event. */
export function addCodexOutputHourInPlace(
  hours: number[],
  timestamp: number,
  outputTotal: number,
): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0 ||
      !Number.isSafeInteger(outputTotal) || outputTotal <= 0) return true;
  const hour = Math.floor(timestamp / HOUR_MS);
  if (!Number.isSafeInteger(hour) || hour <= 0) return true;
  let low = 0;
  let high = hours.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (hours[mid] < hour) low = mid + 1;
    else high = mid;
  }
  if (hours[low] === hour) return true;
  if (hours.length >= MAX_CODEX_HOURS_PER_FILE) return false;
  hours.splice(low, 0, hour);
  return true;
}

export interface CodexHourProofFile {
  compression?: 'zstd';
  compressionVerified?: true;
  offset: number;
  size: number;
  discardingOversizedLine: boolean;
  qualityFlags: readonly string[];
  identityChecked?: boolean;
  lineage?: {
    appliedPrefixEvents?: number;
    desiredPrefixEvents?: number;
  };
  lineageReconciliation?: unknown;
  hourProof?: unknown;
}

export interface CanonicalCodexOutputHours {
  complete: boolean;
  hours: number[];
  provenFiles: number;
  totalFiles: number;
  /** Files eligible for a bounded historical pass; zero means retrying cannot help. */
  backfillableFiles?: number;
}

/** Never expose a partial union as a historical certificate. */
export function canonicalCodexOutputHours(
  files: Readonly<Record<string, CodexHourProofFile>>,
  canonicalKeys: ReadonlySet<string>,
  identityComplete: boolean,
): CanonicalCodexOutputHours {
  let provenFiles = 0;
  const union = new Set<number>();
  for (const key of canonicalKeys) {
    const file = files[key];
    const proof = sanitizeCodexHourProof(file?.hourProof);
    const eligible = file && proof &&
      (file.compression !== 'zstd' || file.compressionVerified === true) &&
      file.identityChecked === true &&
      file.offset === file.size && proof.indexedThrough === file.offset &&
      !file.discardingOversizedLine && !file.lineageReconciliation &&
      file.lineage?.appliedPrefixEvents === file.lineage?.desiredPrefixEvents &&
      proof.prefixEvents === file.lineage?.desiredPrefixEvents &&
      !file.qualityFlags.some((flag) => [
        'stale-file', 'stale-reset-required', 'oversized-jsonl-line',
        'invalid-event-timestamp',
      ].includes(flag));
    if (!eligible) continue;
    provenFiles += 1;
    for (const hour of proof.hours) {
      union.add(hour);
      if (union.size > MAX_CODEX_HOURS_IN_SNAPSHOT) {
        return { complete: false, hours: [], provenFiles, totalFiles: canonicalKeys.size };
      }
    }
  }
  const complete = identityComplete && provenFiles === canonicalKeys.size;
  return {
    complete,
    hours: complete ? [...union].sort((left, right) => left - right) : [],
    provenFiles,
    totalFiles: canonicalKeys.size,
  };
}
