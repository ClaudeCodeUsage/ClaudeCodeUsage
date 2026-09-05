// Opt-in data-contribution interface (SCAFFOLD — nothing is sent yet).
//
// Some future features are only possible with signals pooled across many users
// — e.g. estimating the prompt-cache TTL per subscription tier / task type /
// time of day, or how durable a plan's quota feels in practice. Those in turn
// sharpen the AI advice for everyone. This module reserves the interface for
// that now, so the shape is designed up front and privacy is enforced by types:
//
//   • OFF by default. Nothing leaves the machine unless the user explicitly
//     opts in AND an endpoint is configured. There is no endpoint today.
//   • Aggregate + coarse ONLY. An Observation has no field for a prompt, file
//     path, session id, username, repo, or exact timestamp — so they cannot be
//     contributed by accident. Time is a coarse 'YYYY-MM' bucket; the model is a
//     family; the tier is only present if the user chose to share it.
//   • Local-first. Callers build Observations from already-aggregated numbers
//     (e.g. ClaudeDataLoader.estimateCacheTtl), never from raw records.
//
// When contribution ships, `contributeObservations` gains a real transport
// behind the same gate; call sites and the Observation shape won't change.

export type ObservationKind = 'cache-ttl';

/** A single privacy-safe, aggregate observation. No identifying fields exist. */
export interface UsageObservation {
  kind: ObservationKind;
  /** Model FAMILY only (e.g. "opus", "sonnet") — never a full/versioned id. */
  modelFamily?: string;
  /** Estimated minutes the cache stays warm (from estimateCacheTtl). */
  cacheWarmMinutes?: number;
  /** How many turns the estimate is based on (confidence, not identity). */
  sampleN?: number;
  /** Coarse month bucket 'YYYY-MM' — never an exact timestamp. */
  monthBucket?: string;
  /** Only present if the user explicitly chose to share their plan tier. */
  subscriptionTier?: string;
}

export interface ContributionConfig {
  /** Master opt-in. Default false; nothing is sent while false. */
  enabled: boolean;
  /** Where to send. Absent = local-only (the current, only supported state). */
  endpoint?: string;
  /** The user opted into sharing their plan tier alongside observations. */
  shareTier?: boolean;
}

export const DEFAULT_CONTRIBUTION_CONFIG: ContributionConfig = { enabled: false };

/** Would the given observations actually be sent? Only when opted in AND an
 * endpoint exists. Kept pure so it's trivially testable and audit-able. */
export function willContribute(config: ContributionConfig): boolean {
  return !!(config.enabled && config.endpoint);
}

/** Strip anything the user didn't consent to share (currently just the tier).
 * A defensive pass so a caller can't over-share even by mistake. */
export function redactObservation(obs: UsageObservation, config: ContributionConfig): UsageObservation {
  const out: UsageObservation = { ...obs };
  if (!config.shareTier) {
    delete out.subscriptionTier;
  }
  return out;
}

/** Contribute observations — a NO-OP today (no endpoint is wired). Returns the
 * count that *would* be sent, so call sites and tests are already correct for
 * when a transport lands. It never sends while `willContribute` is false. */
export async function contributeObservations(
  observations: UsageObservation[],
  config: ContributionConfig
): Promise<{ sent: number }> {
  if (!willContribute(config) || observations.length === 0) {
    return { sent: 0 };
  }
  // Intentionally not implemented: no data leaves the machine yet. When a
  // transport is added it goes here, sending redactObservation()-ed payloads
  // to config.endpoint. Until then this stays a no-op even when "enabled".
  return { sent: 0 };
}
