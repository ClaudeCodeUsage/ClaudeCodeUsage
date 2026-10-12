import { ClaudeReferenceUsage, ClaudeUsageRecord } from './types';

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Shared with compaction so unsupported TTL shapes cannot become apparently
 * complete after unknown fields are dropped from the retained record. */
export function hasKnownClaudeCacheCreationShape(
  value: unknown,
): value is NonNullable<ClaudeUsageRecord['message']['usage']['cache_creation']> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key =>
      key === 'ephemeral_5m_input_tokens' || key === 'ephemeral_1h_input_tokens');
}

/** Fill only a missing flat count from an explicitly complete native TTL split.
 * Never change supplied flat evidence or infer an absent TTL count. Keep the
 * source immutable; all other shapes retain their existing primary semantics. */
export function normalizeClaudeNativeUsage(
  usage: ClaudeUsageRecord['message']['usage'],
): ClaudeUsageRecord['message']['usage'] {
  if (usage.cache_creation_input_tokens !== undefined) return usage;
  const split = usage.cache_creation;
  if (!hasKnownClaudeCacheCreationShape(split) ||
      !safeCount(split.ephemeral_5m_input_tokens) || !safeCount(split.ephemeral_1h_input_tokens)) return usage;
  const creation = split.ephemeral_5m_input_tokens + split.ephemeral_1h_input_tokens;
  return Number.isSafeInteger(creation) ? { ...usage, cache_creation_input_tokens: creation } : usage;
}

/** Called only inside the existing accepted/canonical record reducer. Never
 * infer TTL from prices, model names, or the primary cost fallback. */
export function claudeReferenceUsage(
  usage: ClaudeUsageRecord['message']['usage'],
): ClaudeReferenceUsage | undefined {
  usage = normalizeClaudeNativeUsage(usage);
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const read = usage.cache_read_input_tokens === undefined ? 0 : usage.cache_read_input_tokens;
  const creation = usage.cache_creation_input_tokens === undefined ? 0 : usage.cache_creation_input_tokens;
  if (!safeCount(input) || !safeCount(output) || !safeCount(read) || !safeCount(creation)) return undefined;

  let fiveM = 0;
  let oneH = 0;
  const split = usage.cache_creation;
  if (split === undefined) {
    if (creation !== 0) return undefined;
  } else {
    if (!hasKnownClaudeCacheCreationShape(split)) return undefined;
    // Missing counts can only be zero: equality to the safe flat total below
    // proves that no positive residual has an unobserved TTL.
    const fiveMValue = split.ephemeral_5m_input_tokens === undefined ? 0 : split.ephemeral_5m_input_tokens;
    const oneHValue = split.ephemeral_1h_input_tokens === undefined ? 0 : split.ephemeral_1h_input_tokens;
    if (!safeCount(fiveMValue) || !safeCount(oneHValue) ||
        !Number.isSafeInteger(fiveMValue + oneHValue) || fiveMValue + oneHValue !== creation) return undefined;
    fiveM = fiveMValue;
    oneH = oneHValue;
  }
  return {
    inputTokens: input, outputTokens: output, cacheReadTokens: read,
    cacheCreation5mTokens: fiveM, cacheCreation1hTokens: oneH,
  };
}

/** Return an owned vector for ordinary aggregate add/subtract. An empty subset
 * is absent, matching the full reducer after the last eligible record leaves. */
export function addClaudeReferenceUsage(
  current: ClaudeReferenceUsage | undefined,
  contribution: ClaudeReferenceUsage,
  sign: 1 | -1 = 1,
): ClaudeReferenceUsage | undefined {
  const next = {
    inputTokens: (current?.inputTokens ?? 0) + sign * contribution.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + sign * contribution.outputTokens,
    cacheReadTokens: (current?.cacheReadTokens ?? 0) + sign * contribution.cacheReadTokens,
    cacheCreation5mTokens: (current?.cacheCreation5mTokens ?? 0) + sign * contribution.cacheCreation5mTokens,
    cacheCreation1hTokens: (current?.cacheCreation1hTokens ?? 0) + sign * contribution.cacheCreation1hTokens,
  };
  return next.inputTokens === 0 && next.outputTokens === 0 && next.cacheReadTokens === 0 &&
    next.cacheCreation5mTokens === 0 && next.cacheCreation1hTokens === 0 ? undefined : next;
}
