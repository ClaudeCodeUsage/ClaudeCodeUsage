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

/** Prompts with identical text within this many ms of the previous occurrence
 * are treated as an API-error retry re-log and counted once. Retries are rapid
 * (seconds); genuine repeats are far apart. */
export const PROMPT_RETRY_WINDOW_MS = 120_000;

/**
 * Decide whether a user prompt is a retry re-log of one already counted, and
 * record its time. Mutates `lastSeen` (key → last-seen epoch ms).
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
  const prev = lastSeen.get(key);
  lastSeen.set(key, tsMs);
  return prev !== undefined && tsMs - prev >= 0 && tsMs - prev <= windowMs;
}
