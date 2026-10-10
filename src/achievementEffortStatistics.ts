import { getAchievementMoneyPricebook, normalizeAchievementMoneyModel } from './achievementMoney';
import { codexMoneyEvidenceFromModels } from './achievementMoneyScopes';
import { validAchievementBuckets, verifiedCodexAchievementFiles } from './codexAchievementProof';
import type { CodexFileAggregate } from './providers/codex/codexIndex';
import type { ProviderTokenCounts } from './providers/providerTypes';

export const CODEX_ACHIEVEMENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type AchievementEffort = typeof CODEX_ACHIEVEMENT_EFFORTS[number];
export const EFFORT_STATISTICS_PRICEBOOK_VERSION = getAchievementMoneyPricebook('openai').version;
export const EFFORT_STATISTICS_REFERENCE_DATE = getAchievementMoneyPricebook('openai').referenceDate;
export type EffortStatisticsStatus = 'empty' | 'unpriced' | 'partial' | 'complete' | 'invalid' | 'overflow';
export interface AchievementEffortStatisticsRow {
  readonly effort: AchievementEffort;
  readonly processed: number;
  readonly output: number;
  readonly qualifyingRoots: number;
  /** Frozen-reference subtotal, floored once after the eligible population sum.
   * Divide by 1_000_000 for USD. null is unavailable, never a synthetic $0. */
  readonly microUsd: number | null;
  readonly amountPositive: boolean;
  readonly pricedTokens: number;
  readonly unpricedTokens: number;
  readonly pricingCoverage: number;
  readonly status: EffortStatisticsStatus;
  /** False only for invalid money components or unsafe summed tokens/amount.
   * Unpriced and partial rows remain valid observations of the population. */
  readonly valid: boolean;
  /** Money bound only. Token overflow saturates processed/output like the
   * collaboration evaluator, with status=overflow and money withheld. */
  readonly boundState: 'exact' | 'lower-bound' | 'unavailable';
}
export interface AchievementEffortStatistics {
  readonly pricingVersion: string;
  readonly referenceDate: typeof EFFORT_STATISTICS_REFERENCE_DATE;
  readonly rows: readonly AchievementEffortStatisticsRow[];
}

const SCALE = 10n ** 18n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const PRICING_FIELDS = ['inputTotal', 'outputTotal', 'cachedInput', 'cacheWriteInput'] as const;
interface MoneySum { priced: bigint; units: bigint; invalid: boolean }
interface Population extends MoneySum { processed: bigint; output: bigint; roots: number }
const emptyMoney = (): MoneySum => ({ priced: 0n, units: 0n, invalid: false });
const emptyPopulation = (): Population => ({ ...emptyMoney(), processed: 0n, output: 0n, roots: 0 });
const safeLowerBound = (value: bigint): number => Number(value > MAX ? MAX : value);
const field = (tokens: ProviderTokenCounts, key: typeof PRICING_FIELDS[number]): bigint => BigInt(tokens[key] ?? 0);
const hasPricingTokens = (tokens: ProviderTokenCounts): boolean => PRICING_FIELDS.some(key => field(tokens, key) > 0n);
const coversPricing = (tokens: ProviderTokenCounts, total: ProviderTokenCounts): boolean =>
  PRICING_FIELDS.every(key => field(tokens, key) === field(total, key));
function addMoney(target: MoneySum, source: MoneySum): void {
  target.priced += source.priced;
  target.units += source.units;
  target.invalid ||= source.invalid;
}

/** Every pricing component must fit the interpreted total, including optional
 * fields whose absence means zero. The selector's optional-field allowances
 * alone cannot establish this. Fresh input must independently fit as well. */
function pricingBucketsFit(buckets: Readonly<Record<string, ProviderTokenCounts>>, total: ProviderTokenCounts): boolean {
  const sums = PRICING_FIELDS.map(() => 0n);
  let fresh = 0n, writes = 0n;
  for (const tokens of Object.values(buckets)) {
    PRICING_FIELDS.forEach((key, i) => { sums[i] += field(tokens, key); });
    fresh += field(tokens, 'inputTotal') - field(tokens, 'cachedInput');
    writes += field(tokens, 'cacheWriteInput');
  }
  return PRICING_FIELDS.every((key, i) => sums[i] <= field(total, key)) &&
    fresh <= field(total, 'inputTotal') - field(total, 'cachedInput') && writes === 0n;
}

function singleCoveringModel(file: CodexFileAggregate): string | undefined {
  let model: string | undefined;
  const sums = PRICING_FIELDS.map(() => 0n);
  for (const [label, tokens] of Object.entries(file.byModel)) {
    if (!hasPricingTokens(tokens)) continue;
    const canonical = normalizeAchievementMoneyModel(label);
    if (!canonical || (model !== undefined && model !== canonical)) return undefined;
    model = canonical;
    PRICING_FIELDS.forEach((key, i) => { sums[i] += field(tokens, key); });
  }
  // Explicit reference aliases may describe the same model. Their complete
  // numeric partition, not normalization alone, proves its entire-file usage.
  return PRICING_FIELDS.every((key, i) => sums[i] === field(file.total, key)) ? model : undefined;
}

/** Never construct a cross-tab from two marginals. Entire pricing-component
 * coverage proves either a single effort for the file's model buckets, or a
 * single model for each effort bucket. Residual model tokens stay unpriced. */
function effortMoney(file: CodexFileAggregate, effort: AchievementEffort): MoneySum {
  if (field(file.total, 'cacheWriteInput') !== 0n || !pricingBucketsFit(file.byEffort, file.total)) {
    return { ...emptyMoney(), invalid: true };
  }
  const own = file.byEffort[effort];
  const efforts = Object.values(file.byEffort).filter(hasPricingTokens);
  let models: Readonly<Record<string, ProviderTokenCounts>> | undefined;
  if (efforts.length === 1 && coversPricing(own, file.total)) {
    if (!pricingBucketsFit(file.byModel, file.total)) return { ...emptyMoney(), invalid: true };
    models = file.byModel;
  } else {
    const model = singleCoveringModel(file);
    if (model) models = { [model]: own };
  }
  if (!models) return emptyMoney();
  const money = codexMoneyEvidenceFromModels(models, 'openai');
  if (money.status === 'invalid') return { ...emptyMoney(), invalid: true };
  // The helper retains exact units even for amount overflow. Preserve them
  // internally and withhold the final row if its sum cannot be represented.
  return { priced: BigInt(money.pricedTokens), units: BigInt(money.exactMicroUsdUnits), invalid: false };
}

function statisticsRow(effort: AchievementEffort, total: Population): AchievementEffortStatisticsRow {
  const overflow = total.processed > MAX || total.output > MAX || total.priced > MAX || total.units / SCALE > MAX;
  const invalid = total.invalid || total.priced > total.processed;
  const valid = !overflow && !invalid;
  const status: EffortStatisticsStatus = overflow ? 'overflow' : invalid ? 'invalid'
    : total.processed === 0n ? 'empty' : total.priced === 0n ? 'unpriced'
    : total.priced < total.processed ? 'partial' : 'complete';
  const processed = safeLowerBound(total.processed);
  // Unsafe money is withheld as a whole, not displayed as a smaller exact sum.
  const pricedTokens = valid ? Number(total.priced) : 0;
  const available = valid && pricedTokens > 0;
  return {
    effort, processed, output: safeLowerBound(total.output), qualifyingRoots: total.roots,
    microUsd: available ? Number(total.units / SCALE) : null,
    amountPositive: available && total.units > 0n,
    pricedTokens, unpricedTokens: processed - pricedTokens,
    pricingCoverage: processed > 0 ? pricedTokens / processed : 0,
    status, valid, boundState: !available ? 'unavailable' : status === 'partial' ? 'lower-bound' : 'exact',
  };
}

/** Caller supplies a complete current canonical, prefix-reconciled census.
 * This getter cannot prove manifest completeness. It repeats existing lineage
 * and vector selection, pools non-APR root × effort first, and admits only
 * pools with their OWN positive output, exactly as collaboration evidence does.
 * Transient identities resolve ancestry only; the fixed DTO emits no identities,
 * model labels, exact-unit strings, thresholds, I/O or persistence instructions. */
export function codexAchievementEffortStatistics(files: readonly CodexFileAggregate[]): AchievementEffortStatistics {
  const verified = verifiedCodexAchievementFiles(files);
  const bySession = new Map(verified.map(file => [file.session.sessionKey, file]));
  const roots = new Map<string, string | null>();
  function rootFor(key: string): string | null {
    const path = new Set<string>();
    let current: string | undefined = key;
    let root: string | null = null;
    while (current !== undefined) {
      if (roots.has(current)) { root = roots.get(current)!; break; }
      const file = bySession.get(current);
      if (!file || path.has(current)) break;
      path.add(current);
      const parent = file.session.parentSessionKey;
      if (parent === undefined) { root = file.session.role === 'root' ? current : null; break; }
      current = parent;
    }
    for (const session of path) roots.set(session, root);
    return root;
  }
  const tasks = new Map<string, Map<AchievementEffort, Population>>();
  for (const file of verified) {
    if (file.session.role === 'approval-reviewer' || !validAchievementBuckets(file.byEffort, file.total)) continue;
    const root = rootFor(file.session.sessionKey);
    if (root === null) continue;
    let efforts = tasks.get(root);
    if (!efforts) tasks.set(root, efforts = new Map());
    for (const effort of CODEX_ACHIEVEMENT_EFFORTS) {
      const tokens = file.byEffort[effort];
      if (!tokens) continue;
      let population = efforts.get(effort);
      if (!population) efforts.set(effort, population = emptyPopulation());
      population.processed += BigInt(tokens.inputTotal) + BigInt(tokens.outputTotal);
      population.output += BigInt(tokens.outputTotal);
      if (hasPricingTokens(tokens)) addMoney(population, effortMoney(file, effort));
    }
  }
  const totals = new Map(CODEX_ACHIEVEMENT_EFFORTS.map(effort => [effort, emptyPopulation()]));
  for (const efforts of tasks.values()) {
    for (const [effort, population] of efforts) {
      if (population.output === 0n) continue;
      const total = totals.get(effort)!;
      total.processed += population.processed;
      total.output += population.output;
      total.roots++;
      addMoney(total, population);
    }
  }
  return { pricingVersion: EFFORT_STATISTICS_PRICEBOOK_VERSION, referenceDate: EFFORT_STATISTICS_REFERENCE_DATE,
    rows: CODEX_ACHIEVEMENT_EFFORTS.map(effort => statisticsRow(effort, totals.get(effort)!)) };
}
