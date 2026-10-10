import type { ApiHeatmapConfig, ApiHeatmapDaily, ApiHeatmapDailyUsage, ApiHeatmapMetric, ApiHeatmapProvider } from './apiHeatmap';
import { addCalendarDays } from './combinedHeatmap';
import type { CodexDailyUsageView } from './providers/codex/codexUsage';
import type { UsageData } from './types';
import {getCurrentEstimatePricing} from './pricing';
import type {ModelPricing} from './types';

export interface ApiHeatmapDailyRange {
  startDateISO: string;
  endDateISO: string;
  /** Observed/configured zone of the already-bucketed input, supplied by caller. */
  timezone: string;
  provider?: ApiHeatmapProvider;
  metric?: ApiHeatmapMetric;
  showAmounts?: boolean;
  hideAmounts?: boolean;
}

export type ClaudeApiHeatmapDailyRow = { readonly date: string; readonly data: UsageData };

type Provider = 'claude' | 'codex';
type Components = readonly [number, number, number, number];

function validTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function tokenSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!validTokens(value) || !validTokens(total + value)) throw new Error('Invalid heatmap daily token aggregate');
    total += value;
  }
  return total;
}

function empty(provider: Provider): ApiHeatmapDailyUsage {
  return { tokens: 0, amountUSD: null, pricingStatus: 'empty', estimated: provider === 'claude', pricedCount: 0, unpricedCount: 0 };
}

function unpriced(tokens: number, provider: Provider, denominator = tokens): ApiHeatmapDailyUsage {
  return { tokens, amountUSD: null, pricingStatus: 'unpriced', estimated: provider === 'claude', pricedCount: 0, unpricedCount: denominator };
}

function identifiableModel(name: string): boolean {
  return name.trim().length > 0 && name.length <= 256 && !/[\x00-\x1f\x7f]/.test(name) &&
    name !== '<unknown>' && name !== 'unknown' && name !== '<synthetic>' &&
    !Object.prototype.hasOwnProperty.call(Object.prototype, name);
}

function claudeDay(data: UsageData, amounts: boolean,
  pricingFor: (model: string) => ModelPricing | null): ApiHeatmapDailyUsage {
  const components: Components = [data.totalInputTokens, data.totalOutputTokens,
    data.totalCacheCreationTokens, data.totalCacheReadTokens];
  const tokens = tokenSum(components);
  if (!amounts) return tokens === 0 ? empty('claude') : unpriced(tokens, 'claude');
  const currentAmount = data.totalCost;
  if (!validMoney(currentAmount)) return unpriced(tokens, 'claude');
  // A present, explicitly priced zero row differs from an absent calendar day.
  if (tokens === 0) return currentAmount === 0
    ? { ...empty('claude'), amountUSD: 0, pricingStatus: 'complete' }
    : unpriced(tokens, 'claude');
  const models = data.modelBreakdown;
  if (!models || typeof models !== 'object') return unpriced(tokens, 'claude');
  let pricedTokens = 0;
  let subtotal = 0;
  const attributed = [0, 0, 0, 0];
  // Sort model keys so subtotal rounding and duplicate comparison do not depend
  // on object insertion order. Only existing model scalar estimates are read;
  // Only bounded in-memory rate admission, no repricing, TTL evidence,
  // achievement book, network or record inspection. Missing rates are not zero.
  for (const name of Object.keys(models).sort()) {
    const part = models[name];
    if (!part || typeof part !== 'object') return unpriced(tokens, 'claude');
    const values: Components = [part.inputTokens, part.outputTokens, part.cacheCreationTokens, part.cacheReadTokens];
    if (!values.every(validTokens)) return unpriced(tokens, 'claude');
    for (let index = 0; index < values.length; index++) {
      const next = attributed[index] + values[index];
      if (!validTokens(next) || next > components[index]) return unpriced(tokens, 'claude');
      attributed[index] = next;
    }
    if (!identifiableModel(name)) continue;
    const count = part.count;
    const cost = part.cost;
    if (!validTokens(count) || count === 0 || !validMoney(cost)) continue;
    const partTokens = tokenSum(values);
    if (partTokens === 0) continue;
    const pricing = pricingFor(name);
    if (!pricing) continue;
    const rates = [pricing.input_cost_per_token, pricing.output_cost_per_token,
      pricing.cache_creation_input_token_cost, pricing.cache_read_input_token_cost];
    const knownTokens = tokenSum(values.map((value,index) =>
      typeof rates[index] === 'number' && Number.isFinite(rates[index]) && rates[index]! >= 0 ? value : 0));
    if (knownTokens === 0) continue;
    pricedTokens = tokenSum([pricedTokens, knownTokens]);
    if (!validMoney(subtotal + cost)) return unpriced(tokens, 'claude');
    subtotal += cost;
  }
  if (pricedTokens === 0) return unpriced(tokens, 'claude');
  const unpricedTokens = tokens - pricedTokens;
  return {
    tokens, amountUSD: unpricedTokens > 0 ? subtotal : currentAmount,
    pricingStatus: unpricedTokens > 0 ? 'partial' : 'complete', estimated: true,
    pricedCount: pricedTokens, unpricedCount: unpricedTokens,
  };
}

function codexDay(row: CodexDailyUsageView, amounts: boolean): ApiHeatmapDailyUsage {
  const tokens = tokenSum([row.total.processed]);
  if (!amounts) return tokens === 0 ? empty('codex') : unpriced(tokens, 'codex');
  const pricing = row.apiEquivalent;
  if (!pricing || typeof pricing !== 'object') return unpriced(tokens, 'codex');
  const amount = pricing.equivalentUsd;
  const priced = pricing.pricedTokens;
  const denominator = pricing.totalTokens;
  if (!validMoney(amount) || !validTokens(priced) || !validTokens(denominator) || priced > denominator ||
      (tokens > 0 && (denominator === 0 || priced === 0))) {
    return unpriced(tokens, 'codex', validTokens(denominator) && denominator > 0 ? denominator : tokens);
  }
  if (priced === 0 && (denominator > 0 || amount > 0)) return unpriced(tokens, 'codex', denominator);
  return {
    tokens, amountUSD: amount, pricingStatus: priced < denominator ? 'partial' : 'complete', estimated: false,
    pricedCount: priced, unpricedCount: denominator - priced,
  };
}

function calendarKey(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid heatmap daily date');
  return addCalendarDays(value, 0);
}

/** Read date keys to locate the selected interval in an existing descending
 * daily array. Only matching payloads are projected: O(log history + rows in
 * range), with no copy/sort/iteration of the full array or source records. */
function selectedDays<Row>(
  rows: readonly Row[], key: (row: Row) => string,
  project: (row: Row) => ApiHeatmapDailyUsage,
  start: string, end: string, provider: Provider,
): Map<string, ApiHeatmapDailyUsage> {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendarKey(key(rows[middle])) > end) low = middle + 1;
    else high = middle;
  }
  const result = new Map<string, ApiHeatmapDailyUsage>();
  const conflicts = new Set<string>();
  let previousDate = end;
  for (let index = low; index < rows.length; index++) {
    const row = rows[index];
    const date = calendarKey(key(row));
    if (date < start) break;
    if (date > previousDate) throw new Error('Heatmap daily rows must be newest first');
    previousDate = date;
    const candidate = project(row);
    const previous = result.get(date);
    // Both objects are explicit scalar DTOs; private source fields never enter
    // duplicate identity. Hidden mode compares only token-derived scalars.
    if (previous && (conflicts.has(date) || JSON.stringify(previous) !== JSON.stringify(candidate))) {
      conflicts.add(date);
      // A known conflicting day is unavailable pricing, not absent activity.
      // Max retains a valid observed bound without adding duplicate totals.
      // Keep examining later rows so the bound is independent of row order;
      // once conflicted, no later duplicate can restore a monetary amount.
      const tokens = Math.max(previous.tokens, candidate.tokens);
      const denominator = Math.max(tokens,
        tokenSum([previous.pricedCount, previous.unpricedCount]),
        tokenSum([candidate.pricedCount, candidate.unpricedCount]));
      result.set(date, unpriced(tokens, provider, denominator));
    } else {
      result.set(date, candidate);
    }
  }
  return result;
}

/** Pure projection of current daily aggregates into at most 366 civil dates.
 * Both producer arrays must be newest first, as their materialized views are.
 * Caller supplies canonical bounds and the observed zone used to bucket them;
 * this function never re-buckets a day or resolves an implicit current date.
 * Conflicting duplicates withhold money as unpriced and retain the maximum
 * observed token/coverage bound; duplicate totals are never summed.
 */
export function buildApiHeatmapDaily(
  claudeDaily: readonly ClaudeApiHeatmapDailyRow[],
  codexDaily: readonly CodexDailyUsageView[],
  options: ApiHeatmapDailyRange | ApiHeatmapConfig,
  pricingResolver: (model: string) => ModelPricing | null = getCurrentEstimatePricing,
): ApiHeatmapDaily {
  const config: ApiHeatmapDailyRange = options;
  const start = calendarKey(config.startDateISO);
  const end = calendarKey(config.endDateISO);
  const daySpan = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  if (end < start || daySpan > 365) throw new Error('Heatmap daily range must contain 1–366 days');
  if (typeof config.timezone !== 'string' || !config.timezone.trim()) throw new Error('Heatmap daily zone must be supplied');
  // Validate only the caller's observed zone. There is no system-zone fallback.
  new Intl.DateTimeFormat('en', { timeZone: config.timezone });
  const provider = config.provider === 'claude' || config.provider === 'codex' ? config.provider : 'both';
  const amounts = config.hideAmounts !== true && config.metric === 'apiEquivalent' && config.showAmounts === true;
  const prices = new Map<string, ModelPricing | null>();
  const pricingFor = (model: string): ModelPricing | null => {
    if (!prices.has(model)) prices.set(model, pricingResolver(model));
    return prices.get(model)!;
  };
  const claude = provider === 'codex' ? undefined : selectedDays(claudeDaily, row => row.date,
    row => claudeDay(row.data, amounts, pricingFor), start, end, 'claude');
  const codex = provider === 'claude' ? undefined : selectedDays(codexDaily, row => row.day,
    row => codexDay(row, amounts), start, end, 'codex');
  const output: Record<string, { claude?: ApiHeatmapDailyUsage; codex?: ApiHeatmapDailyUsage }> = {};
  const totals = { claude: { tokens: 0, amount: 0 }, codex: { tokens: 0, amount: 0 } };
  for (let date = start; ; date = addCalendarDays(date, 1)) {
    const entry: { claude?: ApiHeatmapDailyUsage; codex?: ApiHeatmapDailyUsage } = {};
    for (const [name, source] of [['claude', claude], ['codex', codex]] as const) {
      if (!source) continue;
      const value = source.get(date) ?? empty(name);
      totals[name].tokens = tokenSum([totals[name].tokens, value.tokens]);
      if (value.amountUSD !== null) {
        const amount = totals[name].amount + value.amountUSD;
        if (!validMoney(amount)) throw new Error('Invalid heatmap daily amount aggregate');
        totals[name].amount = amount;
      }
      entry[name] = value;
    }
    output[date] = entry;
    if (date === end) break;
  }
  return output;
}
