/** Numeric official facts only. Account/source/period separation is enforced
 * by the observation owner before this classifier is called. A planned reset
 * is a deadline, not an event. This projection never proves a coupon redemption. */
import type { CodexOfficialQuotaFacts } from './codexOfficialQuotaFacts';
interface Point { observedAt: number; usedFraction: number; resetAt: number | null;
  officialFacts?: CodexOfficialQuotaFacts }
export function classifyCodexOfficialTransition(previous: Point, next: Point): {
  boundary: 'reset-at-change' | 'usage-drop' | null;
  breakCalibration: boolean;
} {
  const drop = previous.usedFraction - next.usedFraction;
  const expired = previous.resetAt !== null && next.observedAt >= previous.resetAt;
  const changed = previous.resetAt !== null && next.resetAt !== null &&
    Math.abs(previous.resetAt - next.resetAt) > 300_000;
  if (next.observedAt <= previous.observedAt) return { boundary: null, breakCalibration: true };
  const beforeCredits = previous.officialFacts?.rateLimitResetCredits?.credits;
  const afterCredits = next.officialFacts?.rateLimitResetCredits?.credits;
  // Lists can be capped and credits can expire. Disappearance/count changes do
  // not prove redemption; an explicit same-key status transition can do so.
  const redeemed = Array.isArray(beforeCredits) && Array.isArray(afterCredits) && afterCredits.some(credit =>
    credit.resetType === 'codexRateLimits' && credit.status === 'redeemed' &&
    beforeCredits.some(old => old.creditKey === credit.creditKey && old.resetType === 'codexRateLimits' &&
      (old.status === 'available' || old.status === 'redeeming')));
  if (redeemed) return { boundary: 'usage-drop', breakCalibration: true };
  // An unused rolling window can be anchored on the next request/read. Neither
  // 0→0 nor its first positive observation proves a second allowance grant.
  if (!expired && previous.usedFraction === 0 && next.usedFraction >= 0) {
    return { boundary: null, breakCalibration: changed };
  }
  if (expired && (changed || drop > 0)) return { boundary: 'reset-at-change', breakCalibration: true };
  // Integer-percent rounding/corrections must not manufacture short cycles.
  // Retire the monetary baseline even though the reset cycle remains intact.
  if (!changed && drop > 0 && drop <= .010000000001 && next.usedFraction > 0) {
    return { boundary: null, breakCalibration: true };
  }
  if (drop > 0) return { boundary: 'usage-drop', breakCalibration: true };
  return { boundary: changed ? 'reset-at-change' : null, breakCalibration: changed };
}
