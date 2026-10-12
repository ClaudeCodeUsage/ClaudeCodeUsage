import { createHash } from 'crypto';
import type { CodexFileAggregate } from './providers/codex/codexIndex';

const TOKEN_FIELDS = ['inputTotal', 'cachedInput', 'cacheWriteInput', 'outputTotal', 'reasoningOutput', 'sourceTotal'] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Runtime-only proof revision, independent of the dashboard render revision.
 * Reads only already-materialized numeric/identity projections; no JSONL, I/O,
 * timers, persistence or retained second corpus. Only the 64-character digest
 * is retained by the host (never logged/exported). Stream each vector instead
 * of serializing the entire history or walking parent chains recursively.
 */
export function codexAchievementProofRevision(
  files: readonly CodexFileAggregate[],
  fence: { indexed: boolean; calendarComplete: boolean; timeZone: string },
): string {
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
  scalar('codex-achievement-proof-v2');
  scalar(fence.indexed); scalar(fence.calendarComplete); scalar(fence.timeZone);
  scalar(files.length);
  for (const file of files) {
    scalar(file.session.sessionKey); scalar(file.session.parentSessionKey); scalar(file.session.role);
    vector(file.total); buckets(file.byModel); buckets(file.byEffort);
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
  return hash.digest('hex');
}
