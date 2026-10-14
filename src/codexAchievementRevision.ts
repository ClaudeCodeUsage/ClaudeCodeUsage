import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import type { CodexFileAggregate } from './providers/codex/codexIndex';

const TOKEN_FIELDS = ['inputTotal', 'cachedInput', 'cacheWriteInput', 'outputTotal', 'reasoningOutput', 'sourceTotal'] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// This registry certifies immutability only, never current-source authority.
// No caller-supplied revision, unchanged flag or shallow Object.freeze can
// enroll an arbitrary mutable census. Weak keys retain no second file corpus.
const immutableFiles = new WeakSet<readonly CodexFileAggregate[]>();
export function isImmutableCodexAchievementFiles(files: readonly CodexFileAggregate[]): boolean {
  return immutableFiles.has(files);
}

// Plain worker data only. Preserve undefined/non-finite numeric counter values
// so malformed proof is rejected by consumers, never normalized into validity.
// Use ES2020 primitives, including on older Extension Hosts without structuredClone.
function copyFrozenData(value: unknown, copies: Map<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Non-data input');
    return value;
  }
  if (copies.has(value)) return copies.get(value);
  const proto = Object.getPrototypeOf(value);
  if ((!Array.isArray(value) && proto !== Object.prototype && proto !== null) ||
    Object.getOwnPropertySymbols(value).length) throw new TypeError('Non-plain input');
  const copy = Array.isArray(value) ? new Array(value.length) : proto === null ? Object.create(null) : {};
  copies.set(value, copy);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new TypeError('Accessor input');
    const child = copyFrozenData(descriptor.value, copies);
    if (key === '__proto__') Object.defineProperty(copy, key, { value: child, enumerable: true });
    else copy[key] = child;
  }
  return Object.freeze(copy);
}

/** Publish detached plain-data files. The provider must first reconstruct the
 * current census and independent contribution witnesses. Exact comparison is
 * intentionally O(files); bodyReads/indexChanged/totals are not equality proof.
 * Worker-owned aggregates and previously published snapshots stay untouched. */
export function immutableCodexAchievementFiles(files: CodexFileAggregate[],
  previous?: CodexFileAggregate[]): CodexFileAggregate[] {
  if (previous && immutableFiles.has(previous) && isDeepStrictEqual(files, previous)) return previous;
  try {
    const copy = copyFrozenData(files, new Map()) as CodexFileAggregate[];
    immutableFiles.add(copy);
    return copy;
  } catch {
    // Non-worker / malformed input receives the ordinary noncached validation.
    return files;
  }
}

interface ProofFence { indexed: boolean; calendarComplete: boolean; timeZone: string }
const revisions = new WeakMap<readonly CodexFileAggregate[], ProofFence & { revision: string }>();

/**
 * Runtime-only proof revision, independent of the dashboard render revision.
 * Reads only already-materialized numeric/identity projections; no JSONL, I/O,
 * timers, persistence or retained second corpus. The 64-character digest and
 * its fences are memoized only for immutable snapshots (never logged/exported).
 * Stream each vector instead of serializing the entire history or walking
 * parent chains recursively.
 */
export function codexAchievementProofRevision(
  files: readonly CodexFileAggregate[],
  fence: ProofFence,
): string {
  const cached = revisions.get(files);
  if (cached && cached.indexed === fence.indexed && cached.calendarComplete === fence.calendarComplete &&
    cached.timeZone === fence.timeZone) return cached.revision;
  const hash = createHash('sha256');
  const scalar = (value: unknown): void => {
    // Type framing distinguishes invalid null/non-finite counters from absent
    // optional counters. Undefined is not silently converted to null.
    hash.update(JSON.stringify([typeof value, value === null ? null : String(value)]));
  };
  const vector = (value: unknown): void => {
    if (!object(value)) { scalar('invalid-vector'); scalar(value); return; }
    scalar('vector');
    for (const field of TOKEN_FIELDS) scalar(value[field]);
  };
  const buckets = (value: unknown): void => {
    if (!object(value)) { scalar('invalid-buckets'); scalar(value); return; }
    const keys = Object.keys(value).sort();
    scalar('buckets'); scalar(keys.length);
    for (const key of keys) { scalar(key); vector(value[key]); }
  };
  scalar('codex-achievement-proof-v3');
  scalar(fence.indexed); scalar(fence.calendarComplete); scalar(fence.timeZone);
  scalar(files.length);
  for (const file of files) {
    scalar(file.session.sessionKey); scalar(file.session.parentSessionKey); scalar(file.session.role);
    vector(file.total); buckets(file.byModel); buckets(file.byEffort);
    const witness = file.achievementPeriodWitness;
    if (!object(witness)) { scalar('invalid-witness'); scalar(witness); }
    else {
      scalar('witness'); scalar(witness.size); scalar(witness.offset);
      scalar(witness.expectedPrefixEvents); scalar(witness.timeZone);
    }
    const period = file.period;
    if (!object(period)) { scalar('invalid-period'); scalar(period); continue; }
    scalar('period'); scalar(period.timeZone); scalar(period.lineageVersion); scalar(period.lineagePrefixEvents);
    // Numeric provenance must retire a stale calendar binding even when a
    // cursor-only source change leaves all displayed counters unchanged.
    scalar(period.indexedThrough);
    if (!object(period.days)) { scalar('invalid-days'); scalar(period.days); continue; }
    const dates = Object.keys(period.days).sort();
    scalar(dates.length);
    for (const date of dates) {
      scalar(date);
      const day = period.days[date];
      if (!object(day)) { scalar('invalid-day'); scalar(day); continue; }
      vector(day.total); buckets(day.byModel); buckets(day.byEffort);
    }
  }
  const revision = hash.digest('hex');
  if (immutableFiles.has(files)) revisions.set(files, { ...fence, revision });
  return revision;
}
