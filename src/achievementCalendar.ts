import { claudeAchievementFamily, codexModelFamily, normalizeCodexAchievementModel } from './achievementModels';
import type { CodexFileAggregate } from './providers/codex/codexIndex';
import { CODEX_PERIOD_LINEAGE_VERSION } from './providers/codex/codexPeriodIndex';
import { createCodexParserState } from './providers/codex/codexParser';
import type { ProviderTokenCounts } from './providers/providerTypes';
import type { UsageData } from './types';
import { verifiedCodexAchievementFiles } from './codexAchievementProof';
import { codexAchievementProofRevision, isImmutableCodexAchievementFiles } from './codexAchievementRevision';

/** Numeric, already-materialized calendar evidence; no source-log I/O. */
export interface AchievementDay {
  day: string;
  processed: number;
  output: number;
  models: Record<string, { processed: number; output: number }>;
}
export interface AchievementDayEvidence {
  complete: boolean; days: AchievementDay[]; timeZone?: string;
  /** Positive dated components only. Missing dates never mean verified zero. */
  scope?: 'verified-subset';
  /** Runtime census/provenance binding, not persisted, rendered or exported. */
  sourceRevision?: string;
}
export interface AchievementTokenEvidence { complete: boolean; output: number; cachedInput: number; lowerBound?: true }
export interface AchievementCalendarSignals {
  familyDays: Partial<Record<'sonnet' | 'opus' | 'haiku' | 'fable' | 'astra' | 'sol' | 'luna', number>>;
  dualProviderDays: number;
  activeWeeks: number;
  threeFamilyDay: boolean;
  dualProviderDay: boolean;
  peakFourWeekAverage: number;
  /** True only after both normalized day proofs pass validation, not a UI flag. */
  peakEvidenceComplete?: boolean;
  claudeEvidenceComplete?: boolean;
  codexEvidenceComplete?: boolean;
  codexEvidenceUsable?: boolean;
}
const DAY_MS = 86_400_000;
type Family = keyof AchievementCalendarSignals['familyDays'];
const FAMILIES: Family[] = ['sonnet', 'opus', 'haiku', 'fable', 'astra', 'sol', 'luna'];
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface CalendarPeakContext {
  ruleVersion: number;
  parserVersion: number;
  periodVersion: number;
  timeZone: string;
  providers: number;
}
export interface CalendarPeakEvidence extends CalendarPeakContext {
  schemaVersion: 1;
  peakFourWeekAverage: number;
}
const CALENDAR_PEAK_RULE_VERSION = 1;
const CURRENT_PARSER_VERSION = createCodexParserState('achievement-version').schemaVersion;
export function calendarPeakContext(timeZone: string, claude: boolean, codex: boolean): CalendarPeakContext {
  return { ruleVersion: CALENDAR_PEAK_RULE_VERSION, parserVersion: CURRENT_PARSER_VERSION,
    periodVersion: CODEX_PERIOD_LINEAGE_VERSION, timeZone, providers: Number(claude) + 2 * Number(codex) };
}
/** Rebuild an allowlisted DTO; never retain unknown source or personal fields. */
export function parseCalendarPeakEvidence(value: unknown): CalendarPeakEvidence | undefined {
  if (!object(value) || value.schemaVersion !== 1 || !count(value.peakFourWeekAverage) ||
      !count(value.ruleVersion) || value.ruleVersion < 1 || !count(value.parserVersion) || value.parserVersion < 1 ||
      !count(value.periodVersion) || value.periodVersion < 1 || !count(value.providers) ||
      value.providers < 1 || value.providers > 3 || typeof value.timeZone !== 'string' || !validTimeZone(value.timeZone)) return undefined;
  return { schemaVersion: 1, ruleVersion: value.ruleVersion, parserVersion: value.parserVersion,
    periodVersion: value.periodVersion, timeZone: value.timeZone, providers: value.providers,
    peakFourWeekAverage: value.peakFourWeekAverage };
}
function samePeakContext(saved: CalendarPeakEvidence, current: CalendarPeakContext): boolean {
  return saved.ruleVersion === current.ruleVersion && saved.timeZone === current.timeZone &&
    saved.providers === current.providers &&
    ((current.providers & 2) === 0 || (saved.parserVersion === current.parserVersion &&
      saved.periodVersion === current.periodVersion));
}
export function readCalendarPeakEvidence(value: unknown, context: CalendarPeakContext, complete: boolean): number {
  const saved = parseCalendarPeakEvidence(value);
  return complete && saved && samePeakContext(saved, context) ? saved.peakFourWeekAverage : 0;
}
export function updateCalendarPeakEvidence(previous: CalendarPeakEvidence | undefined, context: CalendarPeakContext,
  peak: number, complete: boolean): CalendarPeakEvidence | undefined {
  if (!complete || !count(peak) || peak === 0) return previous;
  if (previous && readCalendarPeakEvidence(previous, context, true) >= peak) return previous;
  return parseCalendarPeakEvidence({ schemaVersion: 1, ...context, peakFourWeekAverage: peak }) ?? previous;
}
function validTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone }); return true; } catch { return false; }
}
function dayTimestamp(day: string): number {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day + 'T00:00:00.000Z') : NaN;
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : NaN;
}
function monday(time: number): number {
  return time - ((new Date(time).getUTCDay() + 6) % 7) * DAY_MS;
}
/** Undefined is invalid/incomplete; an empty Map is verified empty evidence. */
function validatedDays(evidence: AchievementDayEvidence, asOf: number, additiveContributions = false): Map<string, AchievementDay> | undefined {
  const rows = new Map<string, AchievementDay>();
  if (!object(evidence) || (evidence.complete !== true && evidence.scope !== 'verified-subset') ||
      !Array.isArray(evidence.days)) return undefined;
  for (const row of evidence.days) {
    if (!object(row) || typeof row.day !== 'string' || !object(row.models)) return undefined;
    if (!additiveContributions && rows.has(row.day)) return undefined;
    const time = dayTimestamp(row.day);
    if (!Number.isFinite(time) || !count(row.processed) || !count(row.output) || row.output > row.processed) return undefined;
    const target = rows.get(row.day) ?? { day: row.day, processed: 0, output: 0, models: {} };
    target.processed += row.processed;
    target.output += row.output;
    if (!count(target.processed) || !count(target.output)) return undefined;
    let modelProcessed = 0;
    let modelOutput = 0;
    for (const [model, tokens] of Object.entries(row.models)) {
      if (!object(tokens) || !count(tokens.processed) || !count(tokens.output) || tokens.output > tokens.processed) return undefined;
      modelProcessed += tokens.processed;
      modelOutput += tokens.output;
      const bucket = Object.prototype.hasOwnProperty.call(target.models, model)
        ? target.models[model] : { processed: 0, output: 0 };
      bucket.processed += tokens.processed;
      bucket.output += tokens.output;
      if (!count(bucket.processed) || !count(bucket.output)) return undefined;
      Object.defineProperty(target.models, model, { value: bucket, enumerable: true, configurable: true, writable: true });
    }
    if (!count(modelProcessed) || !count(modelOutput) || modelProcessed > row.processed || modelOutput > row.output) return undefined;
    rows.set(row.day, target);
  }
  // Civil dates are already bucketed in the provider's zone. UTC arithmetic is
  // only an ordinal for those labels, so DST never changes a week or its divisor.
  for (const date of rows.keys()) if (dayTimestamp(date) >= asOf) rows.delete(date);
  return rows;
}

export function achievementCalendarSignals(input: {
  claude: AchievementDayEvidence; codex: AchievementDayEvidence; asOfDay: string;
}): AchievementCalendarSignals {
  const result: AchievementCalendarSignals = { familyDays: Object.fromEntries(FAMILIES.map(f => [f, 0])), dualProviderDays: 0, activeWeeks: 0,
    threeFamilyDay: false, dualProviderDay: false, peakFourWeekAverage: 0, peakEvidenceComplete: false,
    claudeEvidenceComplete: false, codexEvidenceComplete: false };
  const asOf = dayTimestamp(input.asOfDay);
  if (!Number.isFinite(asOf)) return result;
  if (!input.claude.timeZone || !validTimeZone(input.claude.timeZone) ||
      input.claude.timeZone !== input.codex.timeZone) return result;
  const claudeProof = validatedDays(input.claude, asOf);
  const codexProof = validatedDays(input.codex, asOf);
  result.claudeEvidenceComplete = !!claudeProof && input.claude.complete === true;
  result.codexEvidenceComplete = !!codexProof && input.codex.complete === true;
  result.codexEvidenceUsable = !!codexProof;
  const claude = claudeProof ?? new Map<string, AchievementDay>();
  const codex = codexProof ?? new Map<string, AchievementDay>();
  const familyDates = new Map<string, Map<Family, { processed: number; output: number }>>();
  for (const [rows, provider] of [[claude, 'claude'], [codex, 'codex']] as const) {
    for (const [date, row] of rows) {
      const families = familyDates.get(date) ?? new Map();
      for (const [model, tokens] of Object.entries(row.models)) {
        const codexModel = normalizeCodexAchievementModel(model);
        const family = provider === 'claude' ? claudeAchievementFamily(model) : codexModel ? codexModelFamily(codexModel) : null;
        if (!family) continue;
        const bucket = families.get(family) ?? { processed: 0, output: 0 };
        bucket.processed += tokens.processed;
        bucket.output += tokens.output;
        if (!count(bucket.processed) || !count(bucket.output)) return result;
        families.set(family, bucket);
      }
      familyDates.set(date, families);
    }
  }
  for (const families of familyDates.values()) {
    let qualified = 0;
    for (const [family, tokens] of families) {
      if (tokens.processed >= 1_000_000 && tokens.output > 0) result.familyDays[family]!++;
      if (tokens.processed >= 1_000_000 && tokens.output > 0) qualified++;
    }
    result.threeFamilyDay ||= qualified >= 3;
  }
  if (result.claudeEvidenceComplete && result.codexEvidenceComplete) {
    for (const [date, row] of claude) {
      const other = codex.get(date);
      if (row.processed >= 1_000_000 && row.output > 0 && other && other.processed >= 1_000_000 && other.output > 0) result.dualProviderDays++;
    }
  }
  result.dualProviderDay = result.dualProviderDays > 0;
  const weekTotals = new Map<number, number>();
  const weekOutputDays = new Map<number, Set<string>>();
  let first = Infinity;
  for (const rows of [claude, codex]) for (const [date, row] of rows) {
    if (row.processed === 0) continue;
    const time = dayTimestamp(date);
    first = Math.min(first, time);
    const week = monday(time);
    const total = (weekTotals.get(week) ?? 0) + row.processed;
    if (!count(total)) return { ...result, activeWeeks: 0, peakFourWeekAverage: 0 };
    weekTotals.set(week, total);
    if (row.output > 0 && row.processed >= 1_000_000) {
      const dates = weekOutputDays.get(week) ?? new Set();
      dates.add(date);
      weekOutputDays.set(week, dates);
    }
  }
  const currentWeek = monday(asOf);
  result.activeWeeks = [...weekOutputDays].filter(([week, days]) => week < currentWeek && days.size >= 4).length;
  // Both present providers must be complete. A missing provider is an explicit
  // complete-empty input; incomplete evidence never supplies a combined mean.
  if (!result.claudeEvidenceComplete || !result.codexEvidenceComplete) return result;
  result.peakEvidenceComplete = true;
  if (!Number.isFinite(first)) return result;
  const firstWeek = monday(first) + (first === monday(first) ? 0 : 7 * DAY_MS);
  // Examine only windows containing an observed week: O(number of data weeks),
  // not an unbounded walk across empty years. Zero weeks remain in the divisor.
  const starts = new Set<number>();
  for (const week of weekTotals.keys()) for (let back = 0; back < 4; back++) starts.add(week - back * 7 * DAY_MS);
  for (const start of starts) {
    if (start < firstWeek || start + 4 * 7 * DAY_MS > currentWeek) continue;
    let sum = 0;
    for (let offset = 0; offset < 4; offset++) sum += weekTotals.get(start + offset * 7 * DAY_MS) ?? 0;
    if (count(sum)) result.peakFourWeekAverage = Math.max(result.peakFourWeekAverage, Math.floor(sum / 4));
  }
  return result;
}

const TOKEN_FIELDS = ['inputTotal', 'outputTotal', 'cachedInput', 'reasoningOutput', 'cacheWriteInput', 'sourceTotal'] as const;
function validTokens(tokens: unknown): tokens is ProviderTokenCounts {
  return object(tokens) && count(tokens.inputTotal) && count(tokens.outputTotal) &&
    count(tokens.inputTotal + tokens.outputTotal) &&
    TOKEN_FIELDS.every(field => tokens[field] === undefined || count(tokens[field])) &&
    (tokens.cachedInput === undefined || (tokens.cachedInput as number) <= tokens.inputTotal) &&
    (tokens.reasoningOutput === undefined || (tokens.reasoningOutput as number) <= tokens.outputTotal);
}
function sumTokens(buckets: readonly ProviderTokenCounts[]): ProviderTokenCounts | undefined {
  const total: ProviderTokenCounts = { inputTotal: 0, outputTotal: 0 };
  for (const bucket of buckets) {
    if (!validTokens(bucket)) return undefined;
    for (const field of TOKEN_FIELDS) {
      const next = (total[field] ?? 0) + (bucket[field] ?? 0);
      if (!count(next)) return undefined;
      total[field] = next;
    }
  }
  return validTokens(total) ? total : undefined;
}
function tokensFit(actual: ProviderTokenCounts, allowed: ProviderTokenCounts): boolean {
  // An omitted optional allowance is unknown, consistent with the period DTO.
  return TOKEN_FIELDS.every(field => allowed[field] === undefined || (actual[field] ?? 0) <= allowed[field]!);
}
function validBuckets(buckets: unknown, total: ProviderTokenCounts): buckets is Record<string, ProviderTokenCounts> {
  if (!object(buckets)) return false;
  const values = Object.values(buckets);
  if (!values.every(validTokens)) return false;
  const sum = sumTokens(values);
  return !!sum && tokensFit(sum, total);
}

/** Callers supply only canonical, reconciled files and their host completeness fence. */
function validCanonicalFiles(files: readonly CodexFileAggregate[]): boolean {
  if (!Array.isArray(files)) return false;
  const parents = new Map<string, string | undefined>();
  for (const file of files) {
    if (!object(file) || !object(file.session) || !validTokens(file.total) || !validBuckets(file.byModel, file.total)) return false;
    const { sessionKey, parentSessionKey, role } = file.session;
    if (typeof sessionKey !== 'string' || !sessionKey.trim() || parents.has(sessionKey) ||
        (parentSessionKey !== undefined && (typeof parentSessionKey !== 'string' || !parentSessionKey.trim())) ||
        ((role === 'subagent' || role === 'approval-reviewer') && parentSessionKey === undefined)) return false;
    parents.set(sessionKey, parentSessionKey);
  }
  // Iterative graph walk handles deep ancestry without recursion or O(n²) walks.
  const verified = new Set<string>();
  for (const session of parents.keys()) {
    const path = new Set<string>();
    let current: string | undefined = session;
    while (current !== undefined && !verified.has(current)) {
      if (!parents.has(current) || path.has(current)) return false;
      path.add(current);
      current = parents.get(current);
    }
    for (const key of path) verified.add(key);
  }
  return true;
}

/** No date projection is required for all-time output/cache proof. */
export function codexAchievementTokenEvidence(files: readonly CodexFileAggregate[], complete: boolean): AchievementTokenEvidence {
  const fail = (): AchievementTokenEvidence => ({ complete: false, output: 0, cachedInput: 0 });
  if (complete !== true || !Array.isArray(files)) return fail();
  const verified = verifiedCodexAchievementFiles(files);
  if (files.length && !verified.length) return fail();
  const total = sumTokens(verified.map(file => file.total));
  return total ? { complete: true, output: total.outputTotal, cachedInput: total.cachedInput ?? 0,
    ...(verified.length < files.length ? { lowerBound: true as const } : {}) } : fail();
}

/** Validate original dated components without confusing containment with coverage. */
function codexFileDays(file: CodexFileAggregate, timeZone: string): AchievementDayEvidence | undefined {
  const days: AchievementDay[] = [];
  const period = file.period;
  if (!object(period) || period.timeZone !== timeZone || period.lineageVersion !== CODEX_PERIOD_LINEAGE_VERSION ||
      !count(period.lineagePrefixEvents) || !count(period.indexedThrough) ||
      !object(period.days) || !validTokens(file.total) || !validBuckets(file.byModel, file.total)) return undefined;
  const periodTotals: ProviderTokenCounts[] = [];
  const periodModels = new Map<string, ProviderTokenCounts>();
  for (const [date, slice] of Object.entries(period.days)) {
    if (!Number.isFinite(dayTimestamp(date)) || !object(slice) || !validTokens(slice.total) ||
        !validBuckets(slice.byModel, slice.total) || !validBuckets(slice.byEffort, slice.total)) return undefined;
    periodTotals.push(slice.total);
    for (const [model, tokens] of Object.entries(slice.byModel)) {
      const sum = sumTokens([periodModels.get(model) ?? { inputTotal: 0, outputTotal: 0 }, tokens]);
      const allowed = Object.prototype.hasOwnProperty.call(file.byModel, model) ? file.byModel[model] : undefined;
      if (!sum || !allowed || !tokensFit(sum, allowed)) return undefined;
      periodModels.set(model, sum);
    }
    const models = Object.fromEntries(Object.entries(slice.byModel).map(([model, tokens]) =>
      [model, { processed: tokens.inputTotal + tokens.outputTotal, output: tokens.outputTotal }]));
    days.push({ day: date, processed: slice.total.inputTotal + slice.total.outputTotal, output: slice.total.outputTotal, models });
  }
  const total = sumTokens(periodTotals);
  if (!total || !tokensFit(total, file.total)) return undefined;
  const equal = (a: ProviderTokenCounts, b: ProviderTokenCounts): boolean =>
    TOKEN_FIELDS.every(field => b[field] === undefined || (a[field] ?? 0) === b[field]);
  const complete = equal(total, file.total) && Object.entries(file.byModel).every(([model, tokens]) =>
    equal(periodModels.get(model) ?? { inputTotal: 0, outputTotal: 0 }, tokens));
  return { complete, days, timeZone, ...(!complete ? { scope: 'verified-subset' as const } : {}) };
}
/** Period proof is independent of byDay's legacy UTC projection. The caller
 * supplies its complete-census/provenance fence; host snapshots use the stricter
 * runtime-witness projection below. */
export function codexAchievementDayEvidence(files: readonly CodexFileAggregate[], timeZone: string, complete: boolean): AchievementDayEvidence {
  const fail = (): AchievementDayEvidence => ({ complete: false, days: [], timeZone });
  if (complete !== true || !validTimeZone(timeZone) || !validCanonicalFiles(files)) return fail();
  const proofs = files.map(file => codexFileDays(file,timeZone));
  if (proofs.some(proof => !proof)) return fail();
  const days = proofs.flatMap(proof => proof!.days);
  const combined = validatedDays({ complete: true, days }, Infinity, true);
  if (!combined) return fail();
  const whole = proofs.every(proof => proof!.complete);
  return { complete:whole, days:[...combined.values()], timeZone,
    ...(!whole && [...combined.values()].some(day=>day.processed>0) ? {scope:'verified-subset' as const} : {}) };
}

export interface CodexAchievementCalendarProjection {
  evidence: AchievementDayEvidence;
  /** Fully dated files selected AFTER full-census ancestry validation. Money
   * still validates all billable model/date vectors before admitting a week. */
  completeDateFiles: CodexFileAggregate[];
  completeDateEvidence: AchievementDayEvidence;
}
const calendarProjections = new WeakMap<readonly CodexFileAggregate[], {
  timeZone: string; indexed: boolean; wholeCensusComplete: boolean; projection: CodexAchievementCalendarProjection;
}>();
function freezeDayEvidence(evidence: AchievementDayEvidence): void {
  for (const day of evidence.days) {
    for (const model of Object.values(day.models)) Object.freeze(model);
    Object.freeze(day.models); Object.freeze(day);
  }
  Object.freeze(evidence.days); Object.freeze(evidence);
}
/** No source reads. Expected offsets/prefixes come from the provider's actual
 * contributions, never copied from the period that they are meant to verify.
 * Only a detached, deeply immutable census can reuse this evaluation. All
 * independent fences are keys; caller-supplied projections cannot seed it. */
export function codexAchievementCalendarProjection(files: readonly CodexFileAggregate[], timeZone: string,
  indexed: boolean, wholeCensusComplete = true): CodexAchievementCalendarProjection {
  const cached = calendarProjections.get(files);
  if (cached && cached.timeZone === timeZone && cached.indexed === indexed &&
    cached.wholeCensusComplete === wholeCensusComplete) return cached.projection;
  const empty = (): CodexAchievementCalendarProjection => ({evidence:{complete:false,days:[],timeZone},
    completeDateFiles:[],completeDateEvidence:{complete:false,days:[],timeZone}});
  if (!indexed || !Array.isArray(files) || !validTimeZone(timeZone)) return empty();
  const selected = verifiedCodexAchievementFiles(files);
  const proofs: AchievementDayEvidence[] = [], completeDateFiles: CodexFileAggregate[] = [], moneyDays: AchievementDay[] = [];
  for (const file of selected) {
    const witness=file.achievementPeriodWitness, period=file.period;
    if (!witness || !period || !count(witness.size) || !count(witness.offset) ||
      witness.size!==witness.offset || witness.offset!==period.indexedThrough ||
      witness.timeZone!==timeZone || !count(witness.expectedPrefixEvents) ||
      witness.expectedPrefixEvents!==period.lineagePrefixEvents) continue;
    const proof=codexFileDays(file,timeZone);
    if (!proof) continue;
    proofs.push(proof);
    if (proof.complete) {completeDateFiles.push(file); moneyDays.push(...proof.days);}
  }
  const rows=validatedDays({complete:true,days:proofs.flatMap(proof=>proof.days)},Infinity,true);
  const moneyRows=validatedDays({complete:true,days:moneyDays},Infinity,true);
  if (!rows || !moneyRows) return empty();
  const whole=wholeCensusComplete && selected.length===files.length && proofs.length===files.length && proofs.every(proof=>proof.complete);
  const days=[...rows.values()];
  const sourceRevision=codexAchievementProofRevision(files,{indexed,calendarComplete:wholeCensusComplete,timeZone});
  const projection: CodexAchievementCalendarProjection = {evidence:{complete:whole,days,timeZone,sourceRevision,
    ...(!whole && days.some(day=>day.processed>0) ? {scope:'verified-subset' as const} : {})},
    completeDateFiles, completeDateEvidence:{complete:true,days:[...moneyRows.values()],timeZone}};
  if (isImmutableCodexAchievementFiles(files)) {
    freezeDayEvidence(projection.evidence); freezeDayEvidence(projection.completeDateEvidence);
    Object.freeze(projection.completeDateFiles); Object.freeze(projection);
    calendarProjections.set(files, { timeZone, indexed, wholeCensusComplete, projection });
  }
  return projection;
}

/** All four Claude buckets are disjoint; models must fit each original component. */
export function claudeAchievementDayEvidence(
  rows: readonly { date: string; data: UsageData }[], timeZone: string, complete: boolean,
): AchievementDayEvidence {
  const fail = (): AchievementDayEvidence => ({ complete: false, days: [], timeZone });
  if (complete !== true || !validTimeZone(timeZone) || !Array.isArray(rows)) return fail();
  const days = new Map<string, AchievementDay>();
  const signatures = new Map<string, string>();
  for (const row of rows) {
    if (!object(row) || typeof row.date !== 'string' || !Number.isFinite(dayTimestamp(row.date)) ||
        !object(row.data) || !object(row.data.modelBreakdown)) return fail();
    const total = [row.data.totalInputTokens, row.data.totalOutputTokens, row.data.totalCacheCreationTokens, row.data.totalCacheReadTokens];
    if (!total.every(count) || !count(total.reduce((a, b) => a + b, 0))) return fail();
    const components = [0, 0, 0, 0];
    const modelRows: Array<[string, number[]]> = [];
    for (const [model, tokens] of Object.entries(row.data.modelBreakdown)) {
      if (!object(tokens)) return fail();
      const parts = [tokens.inputTokens, tokens.outputTokens, tokens.cacheCreationTokens, tokens.cacheReadTokens];
      if (!parts.every(count) || !count(parts.reduce((a, b) => a + b, 0))) return fail();
      for (let i = 0; i < 4; i++) {
        components[i] += parts[i];
        if (!count(components[i]) || components[i] > total[i]) return fail();
      }
      modelRows.push([model, parts]);
    }
    // Duplicate dashboard projections are not additive contributions. Ignore
    // cost/count metadata, but retain every numeric component in the comparison.
    modelRows.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const signature = JSON.stringify([total, modelRows]);
    const previous = signatures.get(row.date);
    if (previous !== undefined && previous !== signature) return fail();
    signatures.set(row.date, signature);
    days.set(row.date, { day: row.date, processed: total.reduce((a, b) => a + b, 0), output: total[1],
      models: Object.fromEntries(modelRows.map(([model, parts]) =>
        [model, { processed: parts.reduce((a, b) => a + b, 0), output: parts[1] }])) });
  }
  return { complete: true, days: [...days.values()], timeZone };
}
