import {
  getAchievementMoneyPricebook, normalizeAchievementMoneyModel,
  type AchievementMoneyBackend, type AchievementMoneyEvidence,
  type AchievementMoneyPricebook,
} from './achievementMoney';
import { verifiedCodexAchievementFiles, validAchievementTokenVector, validAchievementBuckets } from './codexAchievementProof';
import type { CodexFileAggregate } from './providers/codex/codexIndex';
import { CODEX_PERIOD_LINEAGE_VERSION } from './providers/codex/codexPeriodIndex';
import type { ProviderTokenCounts, UsageProvider } from './providers/providerTypes';
import type { UsageData } from './types';
import { codexAchievementCalendarProjection, type AchievementDayEvidence } from './achievementCalendar';

/** Accept existing materialized model rows without their dashboard cost/count.
 * referenceUsage is the admitted TTL-complete subset, never the full bucket. */
export type ClaudeMoneyModel = Pick<UsageData['modelBreakdown'][string],
  'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens' | 'referenceUsage'>;
export type ClaudeMoneyModels = Record<string, ClaudeMoneyModel>;
export type CodexMoneyModels = Readonly<Record<string, ProviderTokenCounts>>;
export type MoneyEvidence = AchievementMoneyEvidence;
/** No fake zero counts or pricebook identity for malformed input. */
export type InvalidMoneyEvidence = { readonly status: 'invalid' } & {
  readonly [K in Exclude<keyof MoneyEvidence, 'status'>]?: undefined;
};
export type MoneyEvidenceResult = MoneyEvidence | InvalidMoneyEvidence;
export interface MoneyScopeCoverage {
  readonly status: MoneyEvidence['status'] | 'invalid' | 'scopepending';
  readonly pricingCoverage?: number;
  readonly totalTokens?: number;
  readonly pricedTokens?: number;
  readonly unpricedTokens?: number;
  /** Preserve real positive amounts even when integer microUSD floors to 0. */
  readonly amountPositive?: boolean;
  /** Pricing coverage and date/census coverage are independent. */
  readonly scopeLowerBound?: true;
}
export interface AchievementMoneyScopes {
  readonly provider: UsageProvider;
  readonly backend?: AchievementMoneyBackend;
  readonly pricebookVersion?: string;
  readonly cumulative?: MoneyEvidence;
  readonly completedMondayWeekPeak?: number;
  readonly maxSessionTask?: number;
  readonly coverage: {
    readonly cumulative: MoneyScopeCoverage;
    /** Coverage describes the selected peak, not global coverage. */
    readonly completedMondayWeekPeak: MoneyScopeCoverage;
    readonly maxSessionTask: MoneyScopeCoverage;
    readonly verifiedFiles?: number;
    readonly excludedFiles?: number;
  };
}
export interface ClaudeMoneyDay { readonly date: string; readonly models: ClaudeMoneyModels }
export interface ClaudeMoneyScopesInput {
  readonly backend: AchievementMoneyBackend;
  readonly asOfDay: string;
  readonly allTimeModels: ClaudeMoneyModels;
  /** Independently complete numeric date/model projection in caller's zone.
   * Missing dates mean verified zero. A UI range or incomplete index is false. */
  readonly days?: { readonly complete: boolean; readonly rows: Iterable<ClaudeMoneyDay> };
  /** One complete numeric model bucket per canonical session. Supply the
   * uncapped index Iterable, never the Sessions UI's 1000-row projection. */
  readonly allSessionModels?: Iterable<ClaudeMoneyModels>;
  readonly sessionsComplete?: boolean;
}
export interface CodexMoneyScopesInput {
  readonly backend: AchievementMoneyBackend;
  readonly asOfDay: string;
  /** Canonical, prefix/duplicate-reconciled files from a complete current
   * census. Keys are ephemeral parent-resolution input, never output/storage. */
  readonly files: readonly CodexFileAggregate[];
  readonly complete: boolean;
  /** Independent host coverage fence: the snapshot may omit unsettled usage
   * contributions even while its base byte index is complete. */
  readonly calendarComplete?: boolean;
  /** Independent date proof plus each file's complete period/model buckets.
   * Caller proves indexedThrough caught up and zone/prefix provenance. Legacy
   * byDay and a successful cumulative value cannot replace this proof. */
  readonly dayEvidence?: AchievementDayEvidence;
}

const SCALE = 10n ** 18n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const DAY_MS = 86_400_000;
const INVALID = Object.freeze({ status: 'invalid' as const });
const PENDING = Object.freeze({ status: 'scopepending' as const });
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function count(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid aggregate');
  return BigInt(value);
}
function safe(value: bigint): number {
  if (value < 0n || value > MAX) throw new RangeError('Invalid aggregate');
  return Number(value);
}
interface Sum { total: bigint; priced: bigint; units: bigint }
const zero = (): Sum => ({ total: 0n, priced: 0n, units: 0n });
function add(to: Sum, from: Sum): void {
  to.total += from.total; to.priced += from.priced; to.units += from.units;
  safe(to.total); safe(to.priced);
}
function fromEvidence(e: MoneyEvidence): Sum {
  return { total: BigInt(e.totalTokens), priced: BigInt(e.pricedTokens), units: BigInt(e.exactMicroUsdUnits) };
}
function evidence(provider: UsageProvider, book: AchievementMoneyPricebook, sum: Sum): MoneyEvidence {
  const totalTokens = safe(sum.total), pricedTokens = safe(sum.priced);
  if (sum.priced > sum.total) throw new RangeError('Invalid subset');
  const amount = sum.units / SCALE;
  const status: MoneyEvidence['status'] = amount > MAX ? 'overflow'
    : sum.total === 0n ? 'empty' : sum.priced === 0n ? 'unpriced' : sum.priced < sum.total ? 'partial' : 'complete';
  return Object.freeze({ provider, backend: book.backend, pricebookVersion: book.version,
    status, microUsd: status === 'overflow' || sum.priced === 0n ? null : Number(amount),
    exactMicroUsdUnits: String(sum.units), totalTokens, pricedTokens,
    unpricedTokens: safe(sum.total - sum.priced), pricingCoverage: totalTokens ? pricedTokens / totalTokens : 0 });
}
/** Frozen pricebook decimals only; retain exact units even when an individual
 * amount overflows. The base pricing helper deliberately drops that amount. */
function price(model: string, components: readonly bigint[],
  keys: readonly ('input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h')[],
  book: AchievementMoneyPricebook): Sum {
  const total = components.reduce((a, b) => a + b, 0n);
  safe(total);
  const canonical = normalizeAchievementMoneyModel(model);
  const rates = canonical && Object.prototype.hasOwnProperty.call(book.prices, canonical) ? book.prices[canonical] : undefined;
  if (!rates) return { total, priced: 0n, units: 0n };
  let units = 0n;
  for (let i = 0; i < components.length; i++) {
    if (components[i] === 0n) continue;
    const rate = rates[keys[i]];
    // A missing required price excludes this model subset, as in §3.2.
    if (typeof rate !== 'string' || rate.length > 40 || !/^\d+(?:\.\d{1,18})?$/.test(rate)) return { total, priced: 0n, units: 0n };
    const [whole, fractional = ''] = rate.split('.');
    units += components[i] * (BigInt(whole) * SCALE + BigInt(fractional.padEnd(18, '0')));
  }
  return { total, priced: total, units };
}
function claudeVector(row: ClaudeMoneyModel): bigint[] {
  if (!object(row)) throw new RangeError('Invalid aggregate');
  return [count(row.inputTokens), count(row.outputTokens), count(row.cacheReadTokens), count(row.cacheCreationTokens)];
}
function claudeEvidence(models: ClaudeMoneyModels, book: AchievementMoneyPricebook): MoneyEvidence {
  if (!object(models)) throw new RangeError('Invalid aggregate');
  const sum = zero();
  for (const [model, row] of Object.entries(models)) {
    const primary = claudeVector(row);
    const total = primary.reduce((a, b) => a + b, 0n);
    safe(total);
    const known = row.referenceUsage;
    if (known === undefined) { add(sum, { total, priced: 0n, units: 0n }); continue; }
    if (!object(known)) throw new RangeError('Invalid shadow');
    const components = [count(known.inputTokens), count(known.outputTokens), count(known.cacheReadTokens),
      count(known.cacheCreation5mTokens), count(known.cacheCreation1hTokens)];
    if (components[0] > primary[0] || components[1] > primary[1] || components[2] > primary[2] ||
      components[3] + components[4] > primary[3]) throw new RangeError('Invalid shadow subset');
    const priced = price(model, components, ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'], book);
    // Unknown TTL records leave ALL of their original four components here.
    add(sum, { ...priced, total });
  }
  return evidence('claude', book, sum);
}
function codexVector(tokens: ProviderTokenCounts): bigint[] {
  if (!validAchievementTokenVector(tokens) || count(tokens.cacheWriteInput ?? 0) !== 0n) throw new RangeError('Invalid aggregate');
  return [count(tokens.inputTotal), count(tokens.outputTotal), count(tokens.cachedInput ?? 0)];
}
function codexEvidence(models: CodexMoneyModels, book: AchievementMoneyPricebook): MoneyEvidence {
  if (!object(models)) throw new RangeError('Invalid aggregate');
  const sum = zero();
  for (const [model, tokens] of Object.entries(models)) {
    const [input, output, cached] = codexVector(tokens);
    add(sum, price(model, [input - cached, output, cached], ['input', 'output', 'cacheRead'], book));
  }
  return evidence('codex', book, sum);
}
/** Pure model aggregation; malformed/unsafe counters return one fixed sentinel.
 * Valid evidence retains empty/unpriced/partial/complete/overflow semantics. */
export function claudeMoneyEvidenceFromModels(models: ClaudeMoneyModels, backend: AchievementMoneyBackend): MoneyEvidenceResult {
  try { return claudeEvidence(models, getAchievementMoneyPricebook(backend)); } catch { return INVALID; }
}
export function codexMoneyEvidenceFromModels(models: CodexMoneyModels, backend: AchievementMoneyBackend): MoneyEvidenceResult {
  try { return codexEvidence(models, getAchievementMoneyPricebook(backend)); } catch { return INVALID; }
}
function coverage(e: MoneyEvidence): MoneyScopeCoverage {
  return Object.freeze({ status: e.status, pricingCoverage: e.pricingCoverage,
    totalTokens: e.totalTokens, pricedTokens: e.pricedTokens, unpricedTokens: e.unpricedTokens,
    amountPositive: e.exactMicroUsdUnits!=='0' });
}
function base(provider: UsageProvider, book?: AchievementMoneyPricebook): AchievementMoneyScopes {
  return { provider, backend: book?.backend, pricebookVersion: book?.version, coverage: {
    cumulative: book ? PENDING : INVALID, completedMondayWeekPeak: book ? PENDING : INVALID,
    maxSessionTask: book ? PENDING : INVALID } };
}
function dayOrdinal(day: string): number {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('Invalid date');
  const time = Date.parse(day + 'T00:00:00.000Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) throw new RangeError('Invalid date');
  return time;
}
function monday(day: number): number { return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS; }
interface Peak { value?: number; coverage: MoneyScopeCoverage }
function peak(parts: Iterable<MoneyEvidence>, provider: UsageProvider, book: AchievementMoneyPricebook): Peak {
  let selected: MoneyEvidence | undefined;
  let fallback = evidence(provider, book, zero());
  for (const part of parts) {
    // An unsafe candidate prevents a claim about the maximum. No substitute
    // cumulative amount and no winner chosen from only nonoverflowing tasks.
    if (part.status === 'overflow') return { coverage: coverage(part) };
    if (part.microUsd !== null && (!selected || BigInt(part.exactMicroUsdUnits) > BigInt(selected.exactMicroUsdUnits))) selected = part;
    if (part.status === 'unpriced') fallback = part;
  }
  return selected ? { value: selected.microUsd ?? undefined, coverage: coverage(selected) } : { coverage: coverage(fallback) };
}
function weekPeak(days: Map<string, MoneyEvidence>, provider: UsageProvider, book: AchievementMoneyPricebook, asOfDay: string): Peak {
  const asOf = dayOrdinal(asOfDay);
  const weeks = new Map<number, Sum>();
  let hasOpenWeek = false;
  for (const [day, amount] of days) {
    const start = monday(dayOrdinal(day));
    // End is Sunday's civil date; strictly earlier than caller's asOfDay.
    if (start + 6 * DAY_MS >= asOf) { hasOpenWeek = true; continue; }
    const sum = weeks.get(start) ?? zero(); add(sum, fromEvidence(amount)); weeks.set(start, sum);
  }
  if (!weeks.size && hasOpenWeek) return { coverage: PENDING };
  return peak([...weeks.values()].map(sum => evidence(provider, book, sum)), provider, book);
}
function claudeSignature(models: ClaudeMoneyModels): string {
  // Compare only source numeric vectors, including shadow: equal rounded
  // money/total counters cannot prove equal TTL evidence. Cost/count ignored.
  return JSON.stringify(Object.entries(models).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([model, row]) =>
    [model, ...claudeVector(row).map(String), row.referenceUsage === undefined ? null : [
      row.referenceUsage.inputTokens, row.referenceUsage.outputTokens, row.referenceUsage.cacheReadTokens,
      row.referenceUsage.cacheCreation5mTokens, row.referenceUsage.cacheCreation1hTokens]]));
}
export function claudeAchievementMoneyScopes(input: ClaudeMoneyScopesInput): AchievementMoneyScopes {
  let book: AchievementMoneyPricebook;
  try { book = getAchievementMoneyPricebook(input.backend); } catch { return base('claude'); }
  const result = base('claude', book);
  let cumulative: MoneyEvidence | undefined;
  let cumulativeCoverage: MoneyScopeCoverage = INVALID;
  try { cumulative = claudeEvidence(input.allTimeModels, book); cumulativeCoverage = coverage(cumulative); } catch { /* independent scopes remain available */ }
  let week: Peak = { coverage: PENDING }, task: Peak = { coverage: PENDING };
  if (input.days?.complete === true) {
    try {
      const days = new Map<string, MoneyEvidence>(), signatures = new Map<string, string>();
      for (const row of input.days.rows) {
        dayOrdinal(row.date);
        const value = claudeEvidence(row.models, book), signature = claudeSignature(row.models);
        if (signatures.has(row.date) && signatures.get(row.date) !== signature) throw new RangeError('Conflicting day');
        signatures.set(row.date, signature); days.set(row.date, value);
      }
      week = weekPeak(days, 'claude', book, input.asOfDay);
    } catch { week = { coverage: INVALID }; }
  }
  if (input.sessionsComplete === true && input.allSessionModels !== undefined) {
    try {
      function* amounts(): Iterable<MoneyEvidence> {
        for (const models of input.allSessionModels!) yield claudeEvidence(models, book);
      }
      task = peak(amounts(), 'claude', book);
    } catch { task = { coverage: INVALID }; }
  }
  return { ...result, cumulative, completedMondayWeekPeak: week.value, maxSessionTask: task.value,
    coverage: { cumulative: cumulativeCoverage, completedMondayWeekPeak: week.coverage, maxSessionTask: task.coverage } };
}

function fileEvidence(file: CodexFileAggregate, book: AchievementMoneyPricebook): MoneyEvidence {
  const [input, output] = codexVector(file.total);
  const modelEvidence = codexEvidence(file.byModel, book);
  const sum = fromEvidence(modelEvidence);
  if (sum.total > input + output) throw new RangeError('Invalid model subset');
  sum.total = input + output; // Unattributed total stays an unpriced counter.
  return evidence('codex', book, sum);
}
/** Path-compressed iterative resolution: every net file enters exactly one
 * root sum. APRs may contribute money, but this module emits no team counts. */
function codexTaskPeak(files: readonly CodexFileAggregate[], book: AchievementMoneyPricebook): Peak {
  const byKey = new Map(files.map(f => [f.session.sessionKey, f]));
  const roots = new Map<string, string>(), sums = new Map<string, Sum>();
  for (const file of files) {
    let current = file.session.sessionKey;
    const chain: string[] = [];
    while (!roots.has(current)) {
      const entry = byKey.get(current);
      if (!entry) throw new RangeError('Unverified parent');
      chain.push(current);
      if (entry.session.parentSessionKey === undefined) { roots.set(current, current); break; }
      current = entry.session.parentSessionKey;
    }
    const root = roots.get(current)!;
    for (const key of chain) roots.set(key, root);
    const sum = sums.get(root) ?? zero(); add(sum, fromEvidence(fileEvidence(file, book))); sums.set(root, sum);
  }
  return peak([...sums.values()].map(sum => evidence('codex', book, sum)), 'codex', book);
}
const TOKEN_FIELDS = ['inputTotal', 'outputTotal', 'cachedInput', 'cacheWriteInput', 'reasoningOutput', 'sourceTotal'] as const;
function addTokens(to: ProviderTokenCounts, from: ProviderTokenCounts): void {
  codexVector(from);
  for (const field of TOKEN_FIELDS) to[field] = safe(count(to[field] ?? 0) + count(from[field] ?? 0));
}
function fits(actual: ProviderTokenCounts, allowed: ProviderTokenCounts): boolean {
  return TOKEN_FIELDS.every(field => allowed[field] === undefined || (actual[field] ?? 0) <= allowed[field]!);
}
const emptyTokens = (): ProviderTokenCounts => ({ inputTotal: 0, outputTotal: 0 });
interface CodexDay { total: ProviderTokenCounts; models: Map<string, ProviderTokenCounts> }
function dayProofSignature(processed: number, output: number, models: Record<string, { processed: number; output: number }>): string {
  count(processed); count(output);
  if (output > processed || !object(models)) throw new RangeError('Invalid day proof');
  let modelTotal = 0n, modelOutput = 0n;
  const rows = Object.entries(models).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([model, t]) => {
    if (!object(t) || count(t.output) > count(t.processed)) throw new RangeError('Invalid model proof');
    modelTotal += count(t.processed); modelOutput += count(t.output);
    return [model, t.processed, t.output];
  });
  if (safe(modelTotal) > processed || safe(modelOutput) > output) throw new RangeError('Invalid day subset');
  return JSON.stringify([processed, output, rows]);
}
function codexMoneyDays(files: readonly CodexFileAggregate[], proof: AchievementDayEvidence, book: AchievementMoneyPricebook): Map<string, MoneyEvidence> {
  if (proof.complete !== true || typeof proof.timeZone !== 'string' || !proof.timeZone || !Array.isArray(proof.days)) throw new RangeError('Missing date proof');
  // Validate the supplied zone label without re-bucketing dates; timezone and
  // indexed-through provenance remain the caller's independent proof.
  new Intl.DateTimeFormat('en-GB', { timeZone: proof.timeZone });
  const proofDays = new Map<string, string>();
  for (const row of proof.days) {
    dayOrdinal(row.day);
    const signature = dayProofSignature(row.processed, row.output, row.models);
    if (proofDays.has(row.day) && proofDays.get(row.day) !== signature) throw new RangeError('Conflicting proof day');
    proofDays.set(row.day, signature);
  }
  const days = new Map<string, CodexDay>();
  for (const file of files) {
    const period = file.period;
    if (!period || period.timeZone !== proof.timeZone || period.lineageVersion !== CODEX_PERIOD_LINEAGE_VERSION || !object(period.days)) throw new RangeError('Missing period proof');
    count(period.lineagePrefixEvents); count(period.indexedThrough);
    const total = emptyTokens(), models = new Map<string, ProviderTokenCounts>();
    for (const [date, slice] of Object.entries(period.days)) {
      dayOrdinal(date);
      if (!object(slice) || !validAchievementBuckets(slice.byModel, slice.total)) throw new RangeError('Invalid date bucket');
      const day = days.get(date) ?? { total: emptyTokens(), models: new Map() };
      addTokens(total, slice.total); addTokens(day.total, slice.total);
      for (const [model, tokens] of Object.entries(slice.byModel)) {
        const value = models.get(model) ?? emptyTokens(); addTokens(value, tokens); models.set(model, value);
        const daily = day.models.get(model) ?? emptyTokens(); addTokens(daily, tokens); day.models.set(model, daily);
      }
      days.set(date, day);
    }
    // Complete date attribution must cover all billable counters. Independent
    // proof may be marked complete while a period still omits undated usage.
    const allowed = codexVector(file.total), actual = codexVector(total);
    if (!fits(total, file.total) || actual.some((value, i) => value !== allowed[i])) throw new RangeError('Incomplete dates');
    for (const [model, tokens] of models) {
      const limit = Object.prototype.hasOwnProperty.call(file.byModel, model) ? file.byModel[model] : undefined;
      if (!limit || !fits(tokens, limit)) throw new RangeError('Invalid model/date joint');
    }
    for (const [model, tokens] of Object.entries(file.byModel)) {
      const actualModel = codexVector(models.get(model) ?? emptyTokens());
      if (codexVector(tokens).some((value, i) => value !== actualModel[i])) throw new RangeError('Incomplete model dates');
    }
  }
  const amounts = new Map<string, MoneyEvidence>();
  for (const [date, day] of days) {
    const models = Object.fromEntries([...day.models].map(([model, tokens]) =>
      [model, { processed: tokens.inputTotal + tokens.outputTotal, output: tokens.outputTotal }]));
    if (proofDays.get(date) !== dayProofSignature(safe(count(day.total.inputTotal) + count(day.total.outputTotal)), day.total.outputTotal, models)) throw new RangeError('Date proof mismatch');
    const money = codexEvidence(Object.fromEntries(day.models), book), sum = fromEvidence(money);
    sum.total = count(day.total.inputTotal) + count(day.total.outputTotal);
    amounts.set(date, evidence('codex', book, sum)); proofDays.delete(date);
  }
  // Zero-only extra dates are harmless; any unmatched positive proof fails.
  for (const signature of proofDays.values()) if (signature !== dayProofSignature(0, 0, {})) throw new RangeError('Unmatched date proof');
  return amounts;
}
export function codexAchievementMoneyScopes(input: CodexMoneyScopesInput): AchievementMoneyScopes {
  let book: AchievementMoneyPricebook;
  try { book = getAchievementMoneyPricebook(input.backend); } catch { return base('codex'); }
  const result = base('codex', book);
  if (input.complete !== true) return result;
  let files: CodexFileAggregate[];
  try {
    if (!Array.isArray(input.files)) throw new RangeError('Missing file census');
    files = verifiedCodexAchievementFiles(input.files);
    if (input.files.length && !files.length) throw new RangeError('No verified files');
  } catch { return { ...result, coverage: { cumulative: INVALID, maxSessionTask: INVALID, completedMondayWeekPeak: PENDING } }; }
  let cumulative: MoneyEvidence | undefined, cumulativeCoverage: MoneyScopeCoverage = INVALID;
  try {
    const sum = zero(); for (const file of files) add(sum, fromEvidence(fileEvidence(file, book)));
    cumulative = evidence('codex', book, sum); cumulativeCoverage = coverage(cumulative);
  } catch { /* no unsafe host values */ }
  let task: Peak;
  try { task = codexTaskPeak(files, book); } catch { task = { coverage: INVALID }; }
  let week: Peak = { coverage: PENDING };
  // Date proof over the full census cannot silently become proof for a newly
  // selected subset; caller may supply a separately validated subset instead.
  if (input.dayEvidence?.sourceRevision !== undefined) {
    try {
      const supplied=input.dayEvidence;
      // Immutable producer snapshots reuse the internally evaluated projection
      // (including its full-census ancestry/witness checks). Mutable inputs are
      // re-evaluated. A supplied digest or matching totals never seeds the cache.
      const projection=codexAchievementCalendarProjection(input.files,supplied.timeZone ?? '',input.complete,input.calendarComplete!==false);
      const current=projection.evidence;
      const signatures=(proof:AchievementDayEvidence):string => {
        const rows=new Map<string,string>();
        for (const row of proof.days) {
          dayOrdinal(row.day);
          if (rows.has(row.day)) throw new RangeError('Duplicate date binding');
          rows.set(row.day,dayProofSignature(row.processed,row.output,row.models));
        }
        return JSON.stringify([...rows].sort(([a],[b])=>a<b?-1:a>b?1:0));
      };
      if (current.sourceRevision!==supplied.sourceRevision || current.complete!==supplied.complete ||
        current.scope!==supplied.scope || signatures(current)!==signatures(supplied)) throw new RangeError('Retired date binding');
      if (current.complete || current.scope==='verified-subset') {
        week=weekPeak(codexMoneyDays(projection.completeDateFiles,projection.completeDateEvidence,book),'codex',book,input.asOfDay);
        if (!current.complete) {
          // Only a positive lower bound is meaningful for an incomplete scope.
          // Do not certify zero/empty weeks, or replace overflow/unpriced states.
          if (week.value!==undefined && week.coverage.amountPositive &&
            (week.coverage.status==='complete' || week.coverage.status==='partial')) {
            week={...week,coverage:{...week.coverage,status:'partial',scopeLowerBound:true}};
          } else if (week.coverage.status==='empty') week={coverage:PENDING};
        }
      }
    } catch { week={coverage:PENDING}; }
  } else if (input.dayEvidence?.complete === true && files.length === input.files.length) {
    try { week = weekPeak(codexMoneyDays(files, input.dayEvidence, book), 'codex', book, input.asOfDay); }
    catch { week = { coverage: INVALID }; }
  }
  return { ...result, cumulative, completedMondayWeekPeak: week.value, maxSessionTask: task.value,
    coverage: { cumulative: cumulativeCoverage, maxSessionTask: task.coverage, completedMondayWeekPeak: week.coverage,
      verifiedFiles: files.length, excludedFiles: input.files.length - files.length } };
}
