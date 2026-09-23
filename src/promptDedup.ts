// Retry re-log dedup for the "Messages" count.
//
// When an API request errors, Claude Code retries it and re-logs the *same*
// user prompt, so one prompt can appear several times just seconds apart in a
// session's .jsonl (observed: an identical prompt logged twice ~30 s apart
// around a `system:api_error` record). Those are one message the user sent, not
// several — counting each inflates the "Messages" figure.
//
// A genuine re-send of the same text (the user types "继续" again, or a routine
// fires the same prompt) happens minutes / hours / days later, well outside the
// retry window, and still counts. So we only collapse identical prompts that
// land within a short window of the previous occurrence.

import { createHash } from 'crypto';

/** Detach a bounded UI/advice excerpt from a potentially huge JSONL string.
 * A plain slice can keep the whole original prompt alive in V8's heap. */
export function detachedPromptPrefix(text: string, maxCodeUnits: number): string {
  const prefix = text.slice(0, maxCodeUnits);
  // UTF-16LE round-trip preserves even unmatched surrogate code units while
  // allocating independent storage for the small retained excerpt.
  return Buffer.from(prefix, 'utf16le').toString('utf16le');
}

/** Prompts with identical text within this many ms of the previous occurrence
 * are treated as an API-error retry re-log and counted once. Retries are rapid
 * (seconds); genuine repeats are far apart. */
export const PROMPT_RETRY_WINDOW_MS = 120_000;

/**
 * Decide whether a user prompt is a retry re-log of one already counted, and
 * record its time. Mutates `lastSeen` (digest → last-seen epoch ms). Never keep
 * raw text as a Map key: V8 substring keys can pin an entire JSONL read buffer
 * for the lifetime of the incremental index, even when only a short prompt is
 * relevant. This is a process-local dedup key, not persisted prompt data.
 *
 * Returns true when it should be SKIPPED (an identical prompt occurred within
 * `windowMs`). Returns false when it should be counted — including when the
 * timestamp is unusable (we never drop a message we can't reason about).
 */
export function isRetryDuplicatePrompt(
  key: string,
  tsMs: number,
  lastSeen: Map<string, number>,
  windowMs: number = PROMPT_RETRY_WINDOW_MS
): boolean {
  if (!Number.isFinite(tsMs)) {
    return false;
  }
  // Hash code units, not UTF-8: distinct lone surrogates both encode as the
  // same replacement character in UTF-8 but were distinct raw prompt keys.
  const digest = createHash('sha256').update(key, 'utf16le').digest('hex');
  const prev = lastSeen.get(digest);
  lastSeen.set(digest, tsMs);
  return prev !== undefined && tsMs - prev >= 0 && tsMs - prev <= windowMs;
}
