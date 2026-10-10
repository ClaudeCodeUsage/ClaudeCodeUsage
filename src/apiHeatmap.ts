import { createHash } from 'node:crypto';
import {
  CombinedDayUsage, CombinedHeatmapRange, addCalendarDays,
  combinedHeatmapRangeDays, normalizeCombinedHeatmapRange, sanitizeCombinedHeatmapTitle,
} from './combinedHeatmap';
import {
  COMBINED_ACTIVITY_PALETTES, CombinedHeatmapIntensityMode, CombinedHeatmapPalette,
  customCombinedHeatmapScale, normalizeCombinedHeatmapAccent,
  normalizeCombinedHeatmapIntensityMode, normalizeCombinedHeatmapPalette, renderCombinedHeatmapSvg,
} from './combinedHeatmapSvg';
import {
  CURRENCY_REFERENCE_DATE, DisplayCurrencyCode, formatUsdForDisplay,
  normalizeDisplayCurrencyCode, resolveCurrencyDisplay,
} from './currencyDisplay';
import { DayUsage } from './heatmap';
import { resolveTimeZone } from './dateKeys';
import { HeatmapSvgOptions, renderHeatmapSvg } from './heatmapSvg';
import { artifactLocale } from './i18n';
import { API_HEATMAP_COPY } from './apiHeatmapCopy';
import { escapeSvgAttribute, escapeSvgText } from './svgEscape';
import { SupportedLanguage } from './types';

export type ApiHeatmapProvider = 'claude' | 'codex' | 'both';
export type ApiHeatmapMetric = 'tokens' | 'apiEquivalent';
export type ApiHeatmapPricingStatus = 'empty' | 'unpriced' | 'partial' | 'complete';

/** Current floating daily estimates, never achievement reference-price money.
 * Counts use the same producer-defined pricing evidence unit for both fields.
 * Claude includes current backend/fallback/override semantics (estimated).
 * Codex supplies exact-model-priced subsets only, with estimated=false.
 * Missing rows / empty status mean no data; complete amountUSD=0 is real zero.
 */
export interface ApiHeatmapDailyUsage {
  readonly tokens: number;
  readonly amountUSD: number | null;
  readonly pricingStatus: ApiHeatmapPricingStatus;
  readonly estimated: boolean;
  readonly pricedCount: number;
  readonly unpricedCount: number;
  /** False when a missing date cannot prove absence in an incomplete index. */
  readonly sourceComplete?: boolean;
}

export type ApiHeatmapDaily = Readonly<Record<string, {
  readonly claude?: ApiHeatmapDailyUsage;
  readonly codex?: ApiHeatmapDailyUsage;
}>>;

export interface ApiHeatmapOptions {
  endDateISO: string;
  provider?: ApiHeatmapProvider;
  metric?: ApiHeatmapMetric;
  showAmounts?: boolean;
  hideAmounts?: boolean;
  range?: CombinedHeatmapRange;
  timezone?: string;
  locale?: string;
  currency?: string;
  title?: string;
  palette?: CombinedHeatmapPalette | string;
  customAccent?: string;
  intensityMode?: CombinedHeatmapIntensityMode | string;
  claudeBackend?: 'anthropic' | 'aws-bedrock-in-region';
  /** Nonpersonal monotonic counters, bumped by the producer on replacement. */
  dataRevision?: number;
  pricingRevision?: number;
}

export interface ApiHeatmapConfig {
  endDateISO: string;
  startDateISO: string;
  provider: ApiHeatmapProvider;
  metric: ApiHeatmapMetric;
  showAmounts: boolean;
  range: CombinedHeatmapRange;
  timezone: string;
  locale: SupportedLanguage;
  currency: DisplayCurrencyCode;
  /** Empty uses the renderer's locale/provider-specific default heading. */
  title: string;
  palette: CombinedHeatmapPalette;
  customAccent: string;
  intensityMode: CombinedHeatmapIntensityMode;
  claudeBackend: 'anthropic' | 'aws-bedrock-in-region';
  dataRevision: number;
  pricingRevision: number;
}

export interface ApiHeatmapArtifact {
  config: ApiHeatmapConfig;
  svg: string;
  summary: string;
  filename: string;
  markdown: string;
  /** Internal identity only: never serialize into public SVG or Markdown. */
  cacheKey: string;
  dataQualitySignature: string;
}

export const API_HEATMAP_RENDER_VERSION = 3;

function counter(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function timezoneLabel(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 64) return 'UTC';
  const zone = raw.trim();
  // An explicit empty app selection means the system zone. Unsupported input
  // still fails closed to UTC; never use dateKeys' invalid-input fallback here.
  if (zone === '') return resolveTimeZone('');
  if (!/^[A-Za-z0-9_+\-/:]+$/.test(zone)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return resolveTimeZone(zone);
  } catch {
    return 'UTC';
  }
}

/** Whitelisted fields only: bounded workbench titles, no FX multipliers/raw IDs. */
export function normalizeApiHeatmapConfig(options: ApiHeatmapOptions): ApiHeatmapConfig {
  const endDateISO = options.endDateISO;
  if (typeof endDateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDateISO)) {
    throw new Error('Invalid heatmap end date');
  }
  // Also checks real calendar dates; no implicit clock or machine timezone.
  addCalendarDays(endDateISO, 0);
  const range = normalizeCombinedHeatmapRange(options.range);
  const showAmounts = options.hideAmounts !== true && options.showAmounts === true && options.metric === 'apiEquivalent';
  return {
    endDateISO,
    startDateISO: addCalendarDays(endDateISO, -(combinedHeatmapRangeDays(range) - 1)),
    provider: options.provider === 'claude' || options.provider === 'codex' ? options.provider : 'both',
    metric: showAmounts ? 'apiEquivalent' : 'tokens',
    showAmounts,
    range,
    timezone: timezoneLabel(options.timezone),
    locale: artifactLocale(options.locale),
    currency: normalizeDisplayCurrencyCode(options.currency),
    title: sanitizeCombinedHeatmapTitle(options.title, ''),
    palette: normalizeCombinedHeatmapPalette(options.palette),
    customAccent: normalizeCombinedHeatmapAccent(options.customAccent),
    intensityMode: normalizeCombinedHeatmapIntensityMode(options.intensityMode),
    claudeBackend: options.claudeBackend === 'aws-bedrock-in-region' ? 'aws-bedrock-in-region' : 'anthropic',
    dataRevision: counter(options.dataRevision),
    pricingRevision: counter(options.pricingRevision),
  };
}

type Provider = Exclude<ApiHeatmapProvider, 'both'>;
interface SelectedDay {
  dateISO: string;
  tokens: number;
  pricing?: {
    status: ApiHeatmapPricingStatus;
    amountUSD: number | null;
    estimated: boolean;
    pricedCount: number;
    unpricedCount: number;
    sourceComplete: boolean;
  };
}

function checkedNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid heatmap numeric aggregate');
  }
  return value;
}

function addTotal(a: number, b: number): number {
  return checkedNumber(a + b);
}

function selectPricing(source: ApiHeatmapDailyUsage | undefined, tokens: number, provider: Provider): NonNullable<SelectedDay['pricing']> {
  const status = source?.pricingStatus;
  const sourceComplete = source?.sourceComplete === undefined || source.sourceComplete === true;
  const empty = {status:'empty' as const,amountUSD:null,estimated:false,pricedCount:0,unpricedCount:0,sourceComplete};
  if (!source || (status === 'empty' && tokens === 0 && sourceComplete)) return empty;
  const rawPriced = source.pricedCount;
  const rawUnpriced = source.unpricedCount;
  const rawEstimated = source.estimated;
  const priced = counter(rawPriced);
  const unpriced = counter(rawUnpriced);
  const estimated = rawEstimated === true;
  const unknown = {
    status: 'unpriced' as const, amountUSD: null, estimated,
    pricedCount:0,unpricedCount:addTotal(priced,unpriced),sourceComplete,
  };
  if (status !== 'complete' && status !== 'partial') return unknown;
  if (typeof rawPriced !== 'number' || !Number.isSafeInteger(rawPriced) || rawPriced < 0 ||
      typeof rawUnpriced !== 'number' || !Number.isSafeInteger(rawUnpriced) || rawUnpriced < 0 ||
      typeof rawEstimated !== 'boolean') return unknown;
  const amount = source.amountUSD;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER ||
      (provider === 'codex' && rawEstimated !== false) ||
      (tokens > 0 && priced === 0) ||
      (status === 'complete' && unpriced > 0) ||
      (status === 'partial' && (priced === 0 || unpriced === 0))) return unknown;
  return {status,amountUSD:amount,estimated,pricedCount:priced,unpricedCount:unpriced,sourceComplete};
}

/** Bounded range access, without Object.entries/spread on provider payloads.
 * Token mode intentionally never touches any pricing property, even quality.
 */
function selectDays(daily: ApiHeatmapDaily, config: ApiHeatmapConfig, provider: Provider): SelectedDay[] {
  const result: SelectedDay[] = [];
  const days = combinedHeatmapRangeDays(config.range);
  for (let index = 0; index < days; index++) {
    const dateISO = addCalendarDays(config.startDateISO, index);
    const source = daily[dateISO]?.[provider];
    const tokens = source === undefined ? 0 : checkedNumber(source.tokens);
    const selected: SelectedDay = { dateISO, tokens };
    if (config.metric === 'apiEquivalent') selected.pricing = selectPricing(source, tokens, provider);
    result.push(selected);
  }
  return result;
}

function totalTokens(days: readonly SelectedDay[]): number {
  return days.reduce((total, day) => addTotal(total, day.tokens), 0);
}

function compact(value: number, config: ApiHeatmapConfig): string {
  return new Intl.NumberFormat(config.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function money(value: number, config: ApiHeatmapConfig): string {
  const rate = resolveCurrencyDisplay(config.currency).unitsPerUsd;
  const converted = checkedNumber(value * rate);
  // Avoid falsely displaying a small positive amount as true zero.
  return converted > 0 && converted < 0.01
    ? `<${formatUsdForDisplay(0.01 / rate, config.currency)}`
    : formatUsdForDisplay(value, config.currency);
}

function coverage(priced: number, unpriced: number, config: ApiHeatmapConfig): string {
  const total = addTotal(priced, unpriced);
  const percentage = total === 0 ? '—' : new Intl.NumberFormat(config.locale, {
    style: 'percent', maximumFractionDigits: 0,
  }).format(priced / total);
  return `${API_HEATMAP_COPY[config.locale].coverage} ${priced}/${total} (${percentage})`;
}

function pricingSummary(days: readonly SelectedDay[], config: ApiHeatmapConfig): string {
  const copy = API_HEATMAP_COPY[config.locale];
  let subtotal = 0;
  let priced = 0;
  let unpriced = 0;
  let hasPriced = false;
  let hasData = false;
  let sourceComplete = true;
  for (const day of days) {
    const quality = day.pricing!;
    sourceComplete &&= quality.sourceComplete;
    hasData ||= quality.status !== 'empty';
    priced = addTotal(priced, quality.pricedCount);
    unpriced = addTotal(unpriced, quality.unpricedCount);
    if (quality.amountUSD !== null) {
      hasPriced = true;
      subtotal = addTotal(subtotal, quality.amountUSD);
    }
  }
  if (!hasData) return copy.noData;
  const note=sourceComplete ? '' : ` · ${copy.sourceIncomplete}`;
  if (!hasPriced) return `${copy.unpriced} · ${coverage(priced,unpriced,config)}${note}`;
  return `${unpriced>0 || !sourceComplete ? `${copy.subtotal} ≥` : ''}${money(subtotal,config)} · ${coverage(priced,unpriced,config)}${note}`;
}

function activityScale(config: ApiHeatmapConfig): string[] {
  return config.palette === 'custom'
    ? customCombinedHeatmapScale(config.customAccent)
    : COMBINED_ACTIVITY_PALETTES[config.palette];
}

function renderAmountBlock(days: readonly SelectedDay[], provider: Provider, config: ApiHeatmapConfig): { svg: string; summary: string } {
  const copy = API_HEATMAP_COPY[config.locale];
  const name = provider === 'claude' ? 'Claude' : 'Codex';
  const label = provider === 'claude' ? copy.estimated : copy.exact;
  const summary = `${name} · ${copy.apiEquivalent} · ${label} · ${pricingSummary(days, config)}`;
  const byDate = new Map(days.map(day => [day.dateISO, day]));
  const usage: Record<string, DayUsage> = {};
  for (const day of days) usage[day.dateISO] = { tokens: day.tokens, cost: day.pricing!.amountUSD ?? 0, sessions: 0 };
  const currency = resolveCurrencyDisplay(config.currency);
  const subtitle = `${config.startDateISO} – ${config.endDateISO} · ${config.timezone} · ${config.currency}`;
  const title = config.title || summary;
  const backend = provider === 'claude' ? config.claudeBackend : 'openai';
  const footer = `${copy.currentPricing}: ${backend} · ${copy.notBill}`;
  const options: HeatmapSvgOptions = {
    metric: 'cost', startDateISO: config.startDateISO, endDateISO: config.endDateISO,
    locale: config.locale, scale: activityScale(config),
    intensityMode: config.intensityMode, minWidth: 900, title,
    subtitle: config.title ? `${summary} · ${subtitle}` : subtitle,
    footerNote: footer, watermark: copy.missingLegend,
    ariaLabel: `${title}. ${summary}. ${subtitle}. ${footer}. ${copy.missingLegend}`,
    cellStyle: date => {
      const status = byDate.get(date)!.pricing!.status;
      if (status === 'empty') return { fill: '#f6f8fa', stroke: '#d0d7de' };
      if (status === 'unpriced') return { fill: '#d1d5db', stroke: '#6b7280' };
      if (status === 'partial') return { stroke: '#6b7280', dashed: true };
      return undefined;
    },
    tooltip: date => {
      const quality = byDate.get(date)!.pricing!;
      const prefix = `${date} · ${name} · ${copy.apiEquivalent}`;
      const note=quality.sourceComplete ? '' : ` · ${copy.sourceIncomplete}`;
      if (quality.status === 'empty') return `${prefix} · ${copy.noData}`;
      if (quality.status === 'unpriced') return `${prefix} · ${copy.unpriced} · ${coverage(quality.pricedCount, quality.unpricedCount, config)}${note}`;
      return `${prefix} · ${label} · ${quality.status==='partial' || !quality.sourceComplete ? `${copy.subtotal} ≥` : ''}` +
        `${money(quality.amountUSD!,config)} · ${coverage(quality.pricedCount,quality.unpricedCount,config)}${note}`;
    },
  };
  const fx = currency.converted ? ` · FX ${currency.referenceDate}` : '';
  const svg = renderHeatmapSvg(usage, options).replace(/^(<svg[^>]*>)/, opening =>
    `${opening}\n<desc>${escapeSvgText(`${title}. ${summary}. ${subtitle}. ${footer}${fx}. ${copy.missingLegend}`)}</desc>`);
  return { svg, summary };
}

function composeAmountBlocks(blocks: readonly { svg: string; summary: string }[], title: string): string {
  const widths = blocks.map(block => Number(/width="([\d.]+)"/.exec(block.svg)![1]));
  const heights = blocks.map(block => Number(/height="([\d.]+)"/.exec(block.svg)![1]));
  const width = Math.max(...widths);
  const gap = 12;
  const height = heights.reduce((sum, item) => sum + item, 0) + gap * (blocks.length - 1);
  const summary = blocks.map(block => block.summary).join('; ');
  const heading = title ? `${title}. ${summary}` : summary;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvgAttribute(heading)}">`,
    `<title>${escapeSvgText(heading)}</title>`,
  ];
  let offset = 0;
  for (let index = 0; index < blocks.length; index++) {
    parts.push(blocks[index].svg.replace(/^<svg /, `<svg x="0" y="${offset}" data-provider="${index === 0 && blocks.length === 2 ? 'claude' : 'codex'}" `));
    offset += heights[index] + gap;
  }
  parts.push('</svg>');
  return parts.join('\n');
}

/** Stateless canonical artifact; callers use this exact svg for preview/export.
 * The cache identity is internal. Caller retires old preview handles on config
 * or producer revision changes, and validates identity again before saving.
 */
export function buildApiHeatmapArtifact(daily: ApiHeatmapDaily, options: ApiHeatmapOptions): ApiHeatmapArtifact {
  const config = normalizeApiHeatmapConfig(options);
  const providers: Provider[] = config.provider === 'both' ? ['claude', 'codex'] : [config.provider];
  const selections = providers.map(provider => ({ provider, days: selectDays(daily, config, provider) }));
  const copy = API_HEATMAP_COPY[config.locale];
  let svg: string;
  let summary: string;
  if (config.metric === 'apiEquivalent') {
    const blocks = selections.map(({ provider, days }) => renderAmountBlock(days, provider, config));
    summary = blocks.map(block => block.summary).join('; ');
    svg = blocks.length === 2 ? composeAmountBlocks(blocks, config.title)
      : blocks[0].svg.replace(/^<svg /, `<svg data-provider="${providers[0]}" `);
  } else {
    summary = selections.map(({ provider, days }) =>
      `${provider === 'claude' ? 'Claude' : 'Codex'} ${compact(totalTokens(days), config)} ${copy.tokens}`,
    ).join(' · ');
    if (config.provider === 'both') {
      const combined: Record<string, CombinedDayUsage> = {};
      for (let index = 0; index < selections[0].days.length; index++) {
        const claude = selections[0].days[index];
        const codex = selections[1].days[index];
        // Omit missing zero days exactly as the existing producer does.
        if (claude.tokens === 0 && codex.tokens === 0) continue;
        combined[claude.dateISO] = {
          dateISO: claude.dateISO, claudeProcessed: claude.tokens, codexProcessed: codex.tokens,
          combinedProcessed: addTotal(claude.tokens, codex.tokens),
        };
      }
      // Exact established combined Token renderer output, including palette.
      addTotal(totalTokens(selections[0].days), totalTokens(selections[1].days));
      svg = renderCombinedHeatmapSvg(combined, {
        range: config.range, endDateISO: config.endDateISO, locale: config.locale,
        title: config.title || undefined, palette: config.palette,
        customAccent: config.customAccent, intensityMode: config.intensityMode,
      });
    } else {
      const usage: Record<string, DayUsage> = {};
      for (const day of selections[0].days) usage[day.dateISO] = { tokens: day.tokens, cost: 0, sessions: 0 };
      svg = renderHeatmapSvg(usage, {
        startDateISO: config.startDateISO, endDateISO: config.endDateISO, locale: config.locale,
        minWidth: 720, title: config.title || summary,
        subtitle: config.title ? summary : undefined,
        ariaLabel: config.title ? `${config.title}. ${summary}` : summary,
        scale: activityScale(config), intensityMode: config.intensityMode,
        tooltip: (date: string) => `${date} · ${config.provider === 'claude' ? 'Claude' : 'Codex'} ${compact(usage[date].tokens, config)} ${copy.tokens}`,
      });
    }
  }
  const currency = resolveCurrencyDisplay(config.currency);
  // Only our explicit projection is hashed, never a raw object or private field.
  const signature = JSON.stringify([
    API_HEATMAP_RENDER_VERSION, config, currency.referenceDate, currency.unitsPerUsd,
    selections.map(({ provider, days }) => [provider, days.map(day =>
      config.metric === 'tokens' ? [day.dateISO, day.tokens]
        : [day.dateISO, day.tokens, day.pricing!.status, day.pricing!.amountUSD,
          day.pricing!.estimated,day.pricing!.pricedCount,day.pricing!.unpricedCount,day.pricing!.sourceComplete],
    )]),
  ]);
  const dataQualitySignature = createHash('sha256').update(signature).digest('hex');
  const cacheKey = JSON.stringify([API_HEATMAP_RENDER_VERSION, config, CURRENCY_REFERENCE_DATE, currency.unitsPerUsd, dataQualitySignature]);
  const filename = `api-heatmap-${config.provider}-${config.metric}-${config.range}-${config.endDateISO}.svg`;
  const alt = config.title ? `${config.title} · ${summary}` : summary;
  const markdown = `![${alt.replace(/[\r\n\[\]]/g, ' ')}](${filename})`;
  return { config, svg, summary, filename, markdown, cacheKey, dataQualitySignature };
}

export function renderApiHeatmapSvg(daily: ApiHeatmapDaily, options: ApiHeatmapOptions): string {
  return buildApiHeatmapArtifact(daily, options).svg;
}
