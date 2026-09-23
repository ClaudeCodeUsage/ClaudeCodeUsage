import {
  CombinedDayUsage,
  CombinedHeatmapRange,
  combinedDailyAsHeatmapUsage,
  selectCombinedHeatmapWindow,
} from './combinedHeatmap';
import { renderHeatmapSvg } from './heatmapSvg';
import { HEATMAP_ARTIFACT_TRANSLATIONS, artifactLocale } from './i18n';

export type CombinedHeatmapPalette =
  | 'academicViolet'
  | 'claudeOrange'
  | 'codexBlue'
  | 'githubGreen'
  | 'custom';

export type CombinedHeatmapIntensityMode = 'quantile' | 'logarithmic' | 'linear';

/** The default mirrors Carl's public combined-activity card: a neutral empty
 * cell plus five active violet bands. */
export const ACADEMIC_VIOLET_SCALE = [
  '#ebedf0', '#eee8f8', '#d8c9f1', '#bca5e6', '#8668c7', '#4f2f87',
];

const EMPTY_CELL_COLOR = '#ebedf0';
const MIN_ACCENT_CONTRAST = 1.5;

export const COMBINED_ACTIVITY_PALETTES: Record<Exclude<CombinedHeatmapPalette, 'custom'>, string[]> = {
  academicViolet: ACADEMIC_VIOLET_SCALE,
  claudeOrange: ['#ebedf0', '#fff1e8', '#fadcc9', '#f0aa82', '#e07d4f', '#c85a2b'],
  codexBlue: ['#ebedf0', '#eff6ff', '#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'],
  githubGreen: ['#ebedf0', '#dafbe1', '#aceebb', '#6fdd8b', '#2da44e', '#116329'],
};

/** Compatibility alias for callers that imported the original scale. */
export const COMBINED_ACTIVITY_SCALE = ACADEMIC_VIOLET_SCALE;

export function normalizeCombinedHeatmapPalette(value: unknown): CombinedHeatmapPalette {
  return value === 'claudeOrange' || value === 'codexBlue' ||
    value === 'githubGreen' || value === 'custom'
    ? value
    : 'academicViolet';
}

export function normalizeCombinedHeatmapIntensityMode(value: unknown): CombinedHeatmapIntensityMode {
  return value === 'logarithmic' || value === 'linear' ? value : 'quantile';
}

export function normalizeCombinedHeatmapAccent(value: unknown): string {
  const normalized = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : '#4f2f87';
  const emptyLuminance = relativeLuminance(EMPTY_CELL_COLOR);
  let channels = hexChannels(normalized);
  // A near-white custom colour can otherwise make active cells lighter than
  // the neutral empty cell. Preserve hue while darkening only as much as is
  // needed to keep the exported intensity direction visually honest.
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = channelsToHex(channels);
    const contrast = (emptyLuminance + 0.05) / (relativeLuminance(candidate) + 0.05);
    if (contrast >= MIN_ACCENT_CONTRAST) {
      return candidate;
    }
    channels = channels.map((channel) => Math.round(channel * 0.88));
  }
  return channelsToHex(channels);
}

function hexChannels(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

function channelsToHex(channels: number[]): string {
  return '#' + channels.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'),
  ).join('');
}

function relativeLuminance(hex: string): number {
  const linear = hexChannels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function mixFromEmpty(hex: string, accentShare: number): string {
  const accent = normalizeCombinedHeatmapAccent(hex);
  const baseChannels = hexChannels(EMPTY_CELL_COLOR);
  const accentChannels = hexChannels(accent);
  return channelsToHex(accentChannels.map((channel, index) =>
    baseChannels[index] * (1 - accentShare) + channel * accentShare,
  ));
}

export function customCombinedHeatmapScale(value: unknown): string[] {
  const accent = normalizeCombinedHeatmapAccent(value);
  return [
    EMPTY_CELL_COLOR,
    mixFromEmpty(accent, 0.12),
    mixFromEmpty(accent, 0.28),
    mixFromEmpty(accent, 0.48),
    mixFromEmpty(accent, 0.72),
    accent,
  ];
}

export interface CombinedHeatmapSvgOptions {
  range?: CombinedHeatmapRange;
  endDateISO: string;
  title?: string;
  watermark?: string;
  palette?: CombinedHeatmapPalette | string;
  customAccent?: string;
  intensityMode?: CombinedHeatmapIntensityMode | string;
  locale?: string;
  labels?: {
    combined: string;
    processedTokens: string;
    footerNote: string;
  };
}

function compactNumber(value: number, locale = 'en'): string {
  if (locale !== 'en') {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  const absolute = Math.abs(value);
  const format = (scaled: number): string => scaled.toFixed(1).replace(/\.0$/, '');
  if (absolute >= 1_000_000_000) return `${format(value / 1_000_000_000)}B`;
  if (absolute >= 1_000_000) return `${format(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `${format(value / 1_000)}K`;
  return String(Math.round(value));
}

/**
 * Deterministic, privacy-bounded share card. Its input carries date keys and
 * aggregate provider totals only; it has no account, project, thread, path, or
 * log-content fields that could accidentally be serialized.
 */
export function renderCombinedHeatmapSvg(
  daily: Readonly<Record<string, CombinedDayUsage>>,
  options: CombinedHeatmapSvgOptions,
): string {
  const locale = artifactLocale(options.locale);
  const artifactCopy = HEATMAP_ARTIFACT_TRANSLATIONS[locale];
  const window = selectCombinedHeatmapWindow(
    daily,
    options.range ?? 'year',
    options.endDateISO,
  );
  const title = options.title ?? artifactCopy.combinedTitle;
  const labels = options.labels ?? {
    combined: artifactCopy.combined,
    processedTokens: artifactCopy.processedTokens,
    footerNote: artifactCopy.combinedFooter,
  };
  const subtitle = [
    `Claude ${compactNumber(window.totals.claudeProcessed, locale)}`,
    `Codex ${compactNumber(window.totals.codexProcessed, locale)}`,
    `${labels.combined} ${compactNumber(window.totals.combinedProcessed, locale)} ${labels.processedTokens}`,
  ].join(' · ');
  const palette = normalizeCombinedHeatmapPalette(options.palette);
  const scale = palette === 'custom'
    ? customCombinedHeatmapScale(options.customAccent)
    : COMBINED_ACTIVITY_PALETTES[palette];
  return renderHeatmapSvg(combinedDailyAsHeatmapUsage(window.daily), {
    metric: 'tokens',
    startDateISO: window.startDateISO,
    endDateISO: window.endDateISO,
    title,
    subtitle,
    footerNote: labels.footerNote,
    watermark: options.watermark ?? artifactCopy.madeWith,
    locale,
    scale,
    intensityMode: normalizeCombinedHeatmapIntensityMode(options.intensityMode),
    background: '#fcfaff',
    primaryText: '#2f2142',
    secondaryText: '#685a77',
    borderColor: '#e5dded',
    accentColor: scale[scale.length - 1],
    minWidth: 720,
    ariaLabel: `${title}. ${subtitle}`,
    tooltip: (dateISO) => {
      const usage = window.daily[dateISO] ?? {
        claudeProcessed: 0,
        codexProcessed: 0,
        combinedProcessed: 0,
      };
      return `${dateISO} · Claude: ${compactNumber(usage.claudeProcessed, locale)} · ` +
        `Codex: ${compactNumber(usage.codexProcessed, locale)} · ` +
        `${labels.combined}: ${compactNumber(usage.combinedProcessed, locale)} ${labels.processedTokens}`;
    },
  });
}
