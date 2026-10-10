import { getAchievementMoneyPricebook, type AchievementMoneyBackend, type AchievementMoneyPricebook } from './achievementMoney';
import { API_ACHIEVEMENT_DEFINITIONS, type AchievementMoneyId } from './achievementMoneyCatalog';
import type { AchievementMoneyScopes } from './achievementMoneyScopes';
import type { UsageProvider } from './providers/providerTypes';

/** Ephemeral numeric lower bound in 10^-18 microUSD units. No model/source
 * labels, dates or ledger authority; callers own the accepted producer window. */
export interface AchievementMoneyProof {
  readonly provider: UsageProvider;
  readonly backend: AchievementMoneyBackend;
  readonly pricebookVersion: string;
  readonly exactMicroUsdUnits: string;
  readonly microUsd: number;
  readonly eligibleProcessed: number;
}
/** At most two Claude books or one Codex book, never arbitrary backend keys. */
export type AchievementMoneyProofs = Partial<Record<AchievementMoneyBackend, AchievementMoneyProof>>;
const SCALE = 10n ** 18n;
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const units = (v: unknown): v is string => typeof v === 'string' && /^(?:0|[1-9][0-9]{0,63})$/.test(v);
const allowed = (provider: UsageProvider, backend: AchievementMoneyBackend): boolean =>
  provider === 'codex' ? backend === 'openai'
    : provider === 'claude' && (backend === 'anthropic' || backend === 'aws-bedrock-in-region');

// Lazy, finite frozen-book cache only. Importing this module or copying an
// absent proof performs no price-table traversal. No model distribution is
// inferred: each eligible processed token can cost at most the largest rate.
const maximumRates = new WeakMap<AchievementMoneyPricebook, Partial<Record<UsageProvider, bigint | null>>>();
function maximumRateUnits(provider: UsageProvider, book: AchievementMoneyPricebook): bigint | null {
  let cached = maximumRates.get(book);
  if (!cached) { cached = {}; maximumRates.set(book, cached); }
  if (cached[provider] !== undefined) return cached[provider]!;
  const fields = provider === 'codex' ? ['input', 'output', 'cacheRead'] as const
    : ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const;
  let maximum = 0n;
  for (const rates of Object.values(book.prices)) {
    for (const field of fields) {
      const rate = rates[field];
      if (rate === undefined) continue;
      if (typeof rate !== 'string' || rate.length > 40 || !/^\d+(?:\.\d{1,18})?$/.test(rate)) {
        cached[provider] = null; return null;
      }
      const [whole, fraction = ''] = rate.split('.');
      const exact = BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, '0'));
      if (exact > maximum) maximum = exact;
    }
  }
  cached[provider] = maximum;
  return maximum;
}

export function validateMoneyProof(value: unknown, provider: UsageProvider, backend: AchievementMoneyBackend,
  maxProcessed = Number.MAX_SAFE_INTEGER): value is AchievementMoneyProof {
  if (!object(value) || !allowed(provider, backend) || !count(maxProcessed) ||
      !['provider', 'backend', 'pricebookVersion', 'exactMicroUsdUnits', 'microUsd', 'eligibleProcessed']
        .every(field => Object.prototype.hasOwnProperty.call(value, field)) ||
      value.provider !== provider || value.backend !== backend ||
      !units(value.exactMicroUsdUnits) || !count(value.microUsd) ||
      !count(value.eligibleProcessed) || value.eligibleProcessed === 0 || value.eligibleProcessed > maxProcessed) return false;
  const book = getAchievementMoneyPricebook(backend);
  if (value.pricebookVersion !== book.version) return false;
  const exact = BigInt(value.exactMicroUsdUnits);
  if (exact / SCALE !== BigInt(value.microUsd)) return false;
  const maximum = maximumRateUnits(provider, book);
  return maximum !== null && exact <= maximum * BigInt(value.eligibleProcessed);
}
/** Always rebuild fixed fields, including at every worker boundary. */
export function copyMoneyProof(value: unknown, provider: UsageProvider, backend: AchievementMoneyBackend,
  maxProcessed = Number.MAX_SAFE_INTEGER): AchievementMoneyProof | undefined {
  if (!validateMoneyProof(value, provider, backend, maxProcessed)) return undefined;
  return { provider, backend, pricebookVersion: value.pricebookVersion,
    exactMicroUsdUnits: value.exactMicroUsdUnits, microUsd: value.microUsd, eligibleProcessed: value.eligibleProcessed };
}
export function copyMoneyProofs(value: unknown, provider: UsageProvider, maxProcessed: number): AchievementMoneyProofs | undefined {
  if (!object(value)) return undefined;
  const result: AchievementMoneyProofs = {};
  for (const backend of ['anthropic', 'aws-bedrock-in-region', 'openai'] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, backend)) continue;
    const proof = copyMoneyProof(value[backend], provider, backend, maxProcessed);
    if (proof) result[backend] = proof;
  }
  return Object.keys(result).length ? result : undefined;
}
/** Floor once AFTER adding exact decimal units. Failed/mixed/overflowed sums
 * return no proof, independently of the native Token delta. */
export function accumulateMoneyProof(previous: AchievementMoneyProof | undefined,
  addition: AchievementMoneyProof): AchievementMoneyProof | undefined {
  const next = copyMoneyProof(addition, addition.provider, addition.backend);
  if (!next) return undefined;
  if (!previous) return next;
  const old = copyMoneyProof(previous, next.provider, next.backend);
  if (!old) return undefined;
  const exact = BigInt(old.exactMicroUsdUnits) + BigInt(next.exactMicroUsdUnits);
  const eligibleProcessed = old.eligibleProcessed + next.eligibleProcessed;
  return copyMoneyProof({ ...next, eligibleProcessed, exactMicroUsdUnits: String(exact), microUsd: Number(exact / SCALE) }, next.provider, next.backend);
}

function cumulativeUnits(scope: AchievementMoneyScopes | undefined): bigint | undefined {
  const value = scope?.cumulative, backend = scope?.backend;
  if (!scope || !value || !backend || !allowed(scope.provider, backend) ||
      scope.pricebookVersion !== getAchievementMoneyPricebook(backend).version ||
      value.provider !== scope.provider || value.backend !== backend || value.pricebookVersion !== scope.pricebookVersion ||
      !['empty', 'unpriced', 'partial', 'complete'].includes(value.status) || scope.coverage?.cumulative?.status !== value.status ||
      !units(value.exactMicroUsdUnits) || !count(value.totalTokens) || !count(value.pricedTokens) || !count(value.unpricedTokens) ||
      value.pricedTokens > value.totalTokens || value.unpricedTokens !== value.totalTokens - value.pricedTokens ||
      value.pricingCoverage !== (value.totalTokens ? value.pricedTokens / value.totalTokens : 0)) return undefined;
  const exact = BigInt(value.exactMicroUsdUnits);
  const coverage = scope.coverage.cumulative;
  if (coverage.totalTokens !== undefined && coverage.totalTokens !== value.totalTokens ||
      coverage.pricedTokens !== undefined && coverage.pricedTokens !== value.pricedTokens ||
      coverage.unpricedTokens !== undefined && coverage.unpricedTokens !== value.unpricedTokens ||
      coverage.pricingCoverage !== undefined && coverage.pricingCoverage !== value.pricingCoverage ||
      coverage.amountPositive !== undefined && coverage.amountPositive !== (exact > 0n)) return undefined;
  if (value.pricedTokens === 0) {
    if (exact !== 0n || value.microUsd !== null || value.status !== (value.totalTokens ? 'unpriced' : 'empty')) return undefined;
  } else if (!count(value.microUsd) || BigInt(value.microUsd) !== exact / SCALE ||
      value.status !== (value.pricedTokens < value.totalTokens ? 'partial' : 'complete')) return undefined;
  return exact;
}
/** CUMULATIVE ONLY. Same frozen reference and valid history on both sides;
 * the admitted amount must be sufficient from before and necessary at after.
 * No owner/source/date/ledger authority is inferred by this numeric helper. */
export function cumulativeCrossings(before: AchievementMoneyScopes | undefined, after: AchievementMoneyScopes | undefined,
  money: AchievementMoneyProofs | undefined): AchievementMoneyId[] {
  if (!before || !after || before.provider !== after.provider || before.backend !== after.backend ||
      before.pricebookVersion !== after.pricebookVersion || !after.backend) return [];
  const old = cumulativeUnits(before), next = cumulativeUnits(after);
  if (old === undefined || next === undefined || next < old) return [];
  const proof = copyMoneyProofs(money, after.provider, after.cumulative!.pricedTokens)?.[after.backend];
  if (!proof) return [];
  const addition = BigInt(proof.exactMicroUsdUnits);
  if (addition === 0n || addition > next - old) return [];
  return API_ACHIEVEMENT_DEFINITIONS.filter(rule => {
    if (rule.group !== after.provider || rule.scope !== 'cumulative') return false;
    const target = BigInt(rule.target) * SCALE;
    return old < target && next >= target && old + addition >= target && next - addition < target;
  }).map(rule => rule.id);
}
