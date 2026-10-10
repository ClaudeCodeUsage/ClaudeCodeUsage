import type { TokenUsage } from './pricing';
import type { ProviderTokenCounts, UsageProvider } from './providers/providerTypes';

export type AchievementMoneyBackend = 'anthropic' | 'aws-bedrock-in-region' | 'openai';
export type AchievementDecimalRate = string;
export interface AchievementMoneyRates {
  /** Decimal USD per million tokens, numerically equal to microUSD per token.
   * Unsigned ordinary decimal notation, at most 18 fractional digits; no
   * exponents, coercion or binary floating point. Missing is distinct from 0. */
  readonly input?: AchievementDecimalRate;
  readonly output?: AchievementDecimalRate;
  readonly cacheRead?: AchievementDecimalRate;
  readonly cacheWrite5m?: AchievementDecimalRate;
  readonly cacheWrite1h?: AchievementDecimalRate;
}
export interface AchievementMoneyPricebook {
  readonly version: string;
  readonly referenceDate: '2026-10-09';
  readonly backend: AchievementMoneyBackend;
  readonly rateUnit: 'usd-per-million-tokens';
  readonly rounding: 'floor-after-sum';
  readonly aliases: Readonly<Record<string, string>>;
  readonly prices: Readonly<Record<string, AchievementMoneyRates>>;
}

// Candidate reference snapshot of src/pricing.ts at
// b2e4f72a84b73e1465bc09f68a8ecb5584d84c53. This is deliberately a versioned
// reference, not a claim about today's bills or a live vendor catalog. Values
// below are written as decimals, never copied from mutable per-token floats.
// Baseline standard rates only: no Fast/Batch/Flex, request-level context
// uplift, subscriptions, discounts or inferred currency conversions.
// Initial coverage is the native Claude and OpenAI IDs explicitly listed
// below. Other proxy vendors remain unpriced even when the dashboard has an
// estimate; adding coverage or aliases requires a new reference version.
const native = (input: string, output: string, cacheRead: string,
  cacheWrite5m: string, cacheWrite1h: string): AchievementMoneyRates =>
  Object.freeze({ input, output, cacheRead, cacheWrite5m, cacheWrite1h });
const openai = (input: string, output: string, cacheRead: string): AchievementMoneyRates =>
  Object.freeze({ input, output, cacheRead });
const opus = native('5', '25', '0.5', '6.25', '10');
const legacyOpus = native('15', '75', '1.5', '18.75', '30');
const sonnet = native('3', '15', '0.3', '3.75', '6');
const anthropic: Readonly<Record<string, AchievementMoneyRates>> = Object.freeze({
  'claude-fable-5-1': native('10', '50', '0.25', '12.5', '20'),
  'claude-fable-5': native('10', '50', '1', '12.5', '20'),
  'claude-opus-5-5': native('4', '20', '0.2', '5', '8'),
  'claude-opus-5': opus,
  'claude-opus-4-8': opus,
  'claude-opus-4-7': opus,
  'claude-opus-4-6': opus,
  'claude-opus-4-5': opus,
  'claude-opus-4-1': legacyOpus,
  'claude-opus-4-20250514': legacyOpus,
  'claude-sonnet-5-5': native('2', '10', '0.2', '2.5', '4'),
  'claude-sonnet-5': sonnet,
  'claude-sonnet-4-6': sonnet,
  'claude-sonnet-4-5': sonnet,
  'claude-sonnet-4-20250514': sonnet,
  'claude-3-5-sonnet-20241022': sonnet,
  'claude-haiku-4-5': native('1', '5', '0.1', '1.25', '2'),
  'claude-3-5-haiku-20241022': native('0.8', '4', '0.08', '1', '1.6'),
});
const openaiPrices: Readonly<Record<string, AchievementMoneyRates>> = Object.freeze({
  'gpt-6-astra': openai('10', '50', '1'),
  'gpt-6.1-sol': openai('2', '10', '0.1'),
  'gpt-6-sol': openai('2', '10', '0.2'),
  'gpt-6-luna': openai('0.1', '0.5', '0.01'),
  'gpt-5.6-sol': openai('5', '30', '0.5'),
  'gpt-5.6-terra': openai('2', '12', '0.2'),
  'gpt-5.6-luna': openai('0.2', '1.2', '0.02'),
  'gpt-5.5': openai('5', '30', '0.5'),
  'gpt-5.4': openai('2.5', '15', '0.25'),
  'gpt-5': openai('1.25', '10', '0.125'),
  'gpt-5-mini': openai('0.25', '2', '0.025'),
  'gpt-5-nano': openai('0.05', '0.4', '0.005'),
  'gpt-4.1': openai('2', '8', '0.5'),
  'gpt-4.1-mini': openai('0.4', '1.6', '0.1'),
  'gpt-4.1-nano': openai('0.1', '0.4', '0.025'),
  'gpt-4o': openai('2.5', '10', '1.25'),
  'gpt-4o-mini': openai('0.15', '0.6', '0.075'),
  'o3': openai('2', '8', '0.5'),
  'o4-mini': openai('1.1', '4.4', '0.275'),
});
const regionalOpus = native('5.5', '27.5', '0.55', '6.875', '11');
const regionalSonnet = native('3.3', '16.5', '0.33', '4.125', '6.6');
const bedrock = Object.freeze({
  'claude-opus-5-5': native('4.4', '22', '0.22', '5.5', '8.8'),
  'claude-opus-5': regionalOpus,
  'claude-opus-4-8': regionalOpus,
  'claude-opus-4-7': regionalOpus,
  'claude-opus-4-6': regionalOpus,
  'claude-opus-4-5': regionalOpus,
  'claude-sonnet-5-5': native('2.2', '11', '0.22', '2.75', '4.4'),
  'claude-sonnet-5': regionalSonnet,
  'claude-sonnet-4-6': regionalSonnet,
  'claude-sonnet-4-5': regionalSonnet,
  'claude-haiku-4-5': native('1.1', '5.5', '0.11', '1.375', '2.2'),
});

// This finite list is the entire normalization policy. No substring matching,
// date stripping, bracket stripping, case folding or guessed family aliases.
const aliasEntries: Record<string, string> = Object.create(null);
for (const model of Object.keys(anthropic)) {
  aliasEntries[model] = model;
  aliasEntries[`anthropic/${model}`] = model;
}
for (const model of Object.keys(openaiPrices)) {
  aliasEntries[model] = model;
  aliasEntries[`openai/${model}`] = model;
}
Object.assign(aliasEntries, {
  'claude-mythos-5': 'claude-fable-5',
  'claude-mythos-5-1': 'claude-fable-5-1',
  'anthropic/claude-mythos-5': 'claude-fable-5',
  'anthropic/claude-mythos-5-1': 'claude-fable-5-1',
  'claude-opus-4-5-20251101': 'claude-opus-4-5',
  'claude-opus-4-1-20250805': 'claude-opus-4-1',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
});
const aliases = Object.freeze(aliasEntries);
function book(backend: AchievementMoneyBackend, prices: Readonly<Record<string, AchievementMoneyRates>>): AchievementMoneyPricebook {
  return Object.freeze({
    version: `api-reference-2026-10-${backend}-v1`, referenceDate: '2026-10-09',
    backend, rateUnit: 'usd-per-million-tokens', rounding: 'floor-after-sum',
    aliases, prices: Object.freeze({ ...prices, ...openaiPrices }),
  });
}
const books = Object.freeze({
  openai: book('openai', Object.freeze({})),
  anthropic: book('anthropic', anthropic),
  'aws-bedrock-in-region': book('aws-bedrock-in-region', bedrock),
});

export function getAchievementMoneyPricebook(backend: AchievementMoneyBackend): AchievementMoneyPricebook {
  if (!Object.prototype.hasOwnProperty.call(books, backend)) throw new RangeError('Unsupported achievement backend');
  return books[backend];
}
/** Recognizes a reference model label, not proof of its remote backend identity. */
export function normalizeAchievementMoneyModel(model: string | undefined): string | null {
  return typeof model === 'string' && Object.prototype.hasOwnProperty.call(aliases, model)
    ? aliases[model] : null;
}

const SCALE = 10n ** 18n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
export interface AchievementMoneyComponent { readonly tokens: number; readonly rate?: AchievementDecimalRate }
function count(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Token counters must be nonnegative safe integers');
  return BigInt(value);
}
function safe(value: bigint): number {
  if (value < 0n || value > MAX) throw new RangeError('Token aggregate overflow');
  return Number(value);
}
function decimalUnits(rate: AchievementDecimalRate | undefined): bigint | null {
  if (typeof rate !== 'string' || rate.length > 40 || !/^\d+(?:\.\d{1,18})?$/.test(rate)) return null;
  const [whole, fractional = ''] = rate.split('.');
  return BigInt(whole) * SCALE + BigInt(fractional.padEnd(18, '0'));
}
function componentUnits(components: readonly AchievementMoneyComponent[]): bigint | null {
  let units = 0n;
  for (const component of components) {
    const tokens = count(component.tokens);
    if (tokens === 0n) continue;
    const rate = decimalUnits(component.rate);
    if (rate === null) return null;
    units += tokens * rate;
  }
  return units;
}
/** Arithmetic helper only; arbitrary caller rates are never an award pricebook. */
export function calculateAchievementMicroUsd(components: readonly AchievementMoneyComponent[]): number | null {
  const units = componentUnits(components);
  if (units === null || units / SCALE > MAX) return null;
  return Number(units / SCALE);
}

export type AchievementMoneyModelBucket =
  | { readonly provider: 'claude'; readonly model: string | undefined; readonly usage: TokenUsage }
  | { readonly provider: 'codex'; readonly model: string | undefined; readonly tokens: ProviderTokenCounts };
export type AchievementMoneyUnpricedReason = 'unknown-model' | 'missing-rate' | 'incomplete-cache-ttl' | 'overflow';
export interface AchievementMoneyModelResult {
  readonly canonicalModel: string | null;
  readonly microUsd: number | null;
  /** Exact decimal integer in 10^-18 microUSD units, for lossless incremental
   * reduction. Internal numeric evidence only; never a share DTO. */
  readonly exactMicroUsdUnits: string;
  readonly totalTokens: number;
  readonly pricedTokens: number;
  readonly reason: AchievementMoneyUnpricedReason | null;
}
export interface AchievementMoneyEvidence {
  readonly provider: UsageProvider;
  readonly pricebookVersion: string;
  readonly backend: AchievementMoneyBackend;
  readonly microUsd: number | null;
  readonly exactMicroUsdUnits: string;
  readonly totalTokens: number;
  readonly pricedTokens: number;
  readonly unpricedTokens: number;
  readonly pricingCoverage: number;
  readonly status: 'empty' | 'unpriced' | 'partial' | 'complete' | 'overflow';
}

/** Prices an already materialized numeric model bucket. Never accepts records,
 * paths, timestamps or content. Caller owns identity/date/lineage eligibility. */
export function priceAchievementModelBucket(bucket: AchievementMoneyModelBucket,
  backend: AchievementMoneyBackend): AchievementMoneyModelResult {
  const pricebook = getAchievementMoneyPricebook(backend);
  const canonicalModel = normalizeAchievementMoneyModel(bucket.model);
  const rates = canonicalModel ? pricebook.prices[canonicalModel] : undefined;
  let totalTokens: number;
  let components: AchievementMoneyComponent[];
  let incompleteTtl = false;
  if (bucket.provider === 'claude') {
    const usage = bucket.usage;
    const input = count(usage.input_tokens);
    const output = count(usage.output_tokens);
    const read = count(usage.cache_read_input_tokens ?? 0);
    const five = count(usage.cache_creation?.ephemeral_5m_input_tokens ?? 0);
    const hour = count(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
    const splitTotal = five + hour;
    const flat = usage.cache_creation_input_tokens === undefined ? splitTotal : count(usage.cache_creation_input_tokens);
    const writes = flat > splitTotal ? flat : splitTotal;
    totalTokens = safe(input + output + read + writes);
    // Aggregates lacking TTL cannot prove which price applies. A complete
    // split-only shape is valid; residual or contradictory flat totals are not.
    incompleteTtl = writes > 0n && (!usage.cache_creation || flat !== splitTotal);
    components = [
      { tokens: safe(input), rate: rates?.input }, { tokens: safe(output), rate: rates?.output },
      { tokens: safe(read), rate: rates?.cacheRead }, { tokens: safe(five), rate: rates?.cacheWrite5m },
      { tokens: safe(hour), rate: rates?.cacheWrite1h },
    ];
  } else if (bucket.provider === 'codex') {
    const tokens = bucket.tokens;
    const input = count(tokens.inputTotal);
    const cached = count(tokens.cachedInput ?? 0);
    const output = count(tokens.outputTotal);
    const reasoning = count(tokens.reasoningOutput ?? 0);
    if (cached > input || reasoning > output) throw new RangeError('Invalid Codex token subset');
    if (count(tokens.cacheWriteInput ?? 0) !== 0n) throw new RangeError('Codex has no separate cache write bucket');
    totalTokens = safe(input + output);
    components = [
      { tokens: safe(input - cached), rate: rates?.input },
      { tokens: safe(cached), rate: rates?.cacheRead }, { tokens: safe(output), rate: rates?.output },
    ];
  } else {
    throw new RangeError('Unsupported achievement provider');
  }
  const excluded = (reason: AchievementMoneyUnpricedReason): AchievementMoneyModelResult => ({
    canonicalModel, totalTokens, pricedTokens: 0, microUsd: null, exactMicroUsdUnits: '0', reason,
  });
  if (!canonicalModel) return excluded('unknown-model');
  if (incompleteTtl) return excluded('incomplete-cache-ttl');
  if (!rates) return excluded('missing-rate');
  const units = componentUnits(components);
  if (units === null) return excluded('missing-rate');
  if (units / SCALE > MAX) return excluded('overflow');
  return { canonicalModel, totalTokens, pricedTokens: totalTokens,
    microUsd: Number(units / SCALE), exactMicroUsdUnits: String(units), reason: null };
}

function evidence(provider: UsageProvider, backend: AchievementMoneyBackend,
  total: bigint, priced: bigint, units: bigint): AchievementMoneyEvidence {
  const totalTokens = safe(total);
  const pricedTokens = safe(priced);
  const rounded = units / SCALE;
  const status: AchievementMoneyEvidence['status'] = rounded > MAX ? 'overflow'
    : total === 0n ? 'empty' : priced === 0n ? 'unpriced' : priced < total ? 'partial' : 'complete';
  return Object.freeze({ provider, backend, pricebookVersion: getAchievementMoneyPricebook(backend).version,
    microUsd: status === 'overflow' || priced === 0n ? null : Number(rounded),
    exactMicroUsdUnits: String(units), totalTokens, pricedTokens,
    unpricedTokens: safe(total - priced), pricingCoverage: totalTokens > 0 ? pricedTokens / totalTokens : 0,
    status });
}
/** Reduces only caller-selected aggregate buckets. Use independently proven
 * global/day/week/task scopes; this function cannot grant scope eligibility. */
export function achievementMoneyEvidenceFromBuckets(provider: UsageProvider,
  buckets: Iterable<AchievementMoneyModelBucket>, backend: AchievementMoneyBackend): AchievementMoneyEvidence {
  if (provider !== 'claude' && provider !== 'codex') throw new RangeError('Unsupported achievement provider');
  let total = 0n, priced = 0n, units = 0n;
  for (const bucket of buckets) {
    if (bucket.provider !== provider) throw new RangeError('Cannot combine achievement providers');
    const result = priceAchievementModelBucket(bucket, backend);
    total += BigInt(result.totalTokens);
    priced += BigInt(result.pricedTokens);
    units += BigInt(result.exactMicroUsdUnits);
  }
  return evidence(provider, backend, total, priced, units);
}
/** Lossless merge of numeric evidence, e.g. affected model/day buckets. Carry
 * exact units through indexes; adding individually floored microUSD loses value.
 * Versions/backends/providers may never be mixed. Empty input has no identity. */
export function mergeAchievementMoneyEvidence(parts: readonly AchievementMoneyEvidence[]): AchievementMoneyEvidence {
  if (parts.length === 0) throw new RangeError('At least one evidence item is required');
  const first = parts[0];
  const version = getAchievementMoneyPricebook(first.backend).version;
  let total = 0n, priced = 0n, units = 0n;
  for (const part of parts) {
    if (part.provider !== first.provider) throw new RangeError('Cannot combine achievement providers');
    if (part.backend !== first.backend || part.pricebookVersion !== version) throw new RangeError('Incompatible pricebook version');
    const partTotal = count(part.totalTokens), partPriced = count(part.pricedTokens);
    if (partPriced > partTotal || !/^\d{1,100}$/.test(part.exactMicroUsdUnits)) throw new RangeError('Invalid money evidence');
    total += partTotal;
    priced += partPriced;
    units += BigInt(part.exactMicroUsdUnits);
  }
  return evidence(first.provider, first.backend, total, priced, units);
}
/** Threshold is a positive integer microUSD, before any whole-dollar display
 * rounding. Partial positive coverage can prove a lower bound. This proves
 * money only, never dates, identity, notification eligibility or task quality. */
export function achievementMoneyMeetsThreshold(value: AchievementMoneyEvidence, thresholdMicroUsd: number): boolean {
  if (!Number.isSafeInteger(thresholdMicroUsd) || thresholdMicroUsd <= 0) throw new RangeError('Invalid money threshold');
  return (value.status === 'complete' || value.status === 'partial') && value.microUsd !== null && value.microUsd >= thresholdMicroUsd;
}
