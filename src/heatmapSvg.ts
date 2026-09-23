// GitHub-contribution-style heatmap as a standalone SVG string — for pasting
// into a GitHub profile README (the "local trial" of the token heatmap).
//
// Pure and dependency-free (no vscode, no DOM) so it unit-tests and can be
// generated headlessly. GitHub's own graph is green; this uses a Claude-orange
// ramp instead. Like GitHub's default view it shows the trailing ~year ending
// today (future days are not drawn). Light-theme palette on purpose — a profile
// README renders on a white/light canvas.

import { DayUsage, HeatMetric, intensityBucket } from './heatmap';
import {
  approximateSvgTextWidth,
  escapeSvgAttribute,
  escapeSvgText,
  fitSvgText,
} from './svgEscape';
import { HEATMAP_ARTIFACT_TRANSLATIONS, artifactLocale } from './i18n';
import { SupportedLanguage } from './types';

/** Claude-orange 5-step intensity ramp (bucket 0..4). 0 = empty cell. */
export const CLAUDE_ORANGE_SCALE = ['#ebedf0', '#fadcc9', '#f0aa82', '#e07d4f', '#c85a2b'];

export interface HeatmapSvgOptions {
  metric?: HeatMetric; // default 'tokens'
  weeks?: number; // trailing weeks to show (default 53, GitHub-like)
  startDateISO?: string; // explicit inclusive start for deterministic custom ranges
  endDateISO?: string; // last day to show (default today)
  title?: string; // override the auto summary heading
  subtitle?: string; // optional aggregate breakdown below the heading
  footerNote?: string; // optional semantic disclaimer above the watermark row
  watermark?: string; // bottom-left source note (default "Made with Claude Code Usage")
  scale?: string[]; // 2..8 colours, empty→max (default CLAUDE_ORANGE_SCALE)
  intensityMode?: 'linear' | 'quantile' | 'logarithmic'; // default linear; alternatives keep outliers from flattening the history
  background?: string;
  primaryText?: string;
  secondaryText?: string;
  borderColor?: string;
  accentColor?: string;
  minWidth?: number; // optional card width floor for short date ranges
  ariaLabel?: string;
  locale?: string;
  tooltip?: (dateISO: string, usage: DayUsage, value: number, metric: HeatMetric) => string;
}

function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle] < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function assignRenderBuckets(
  cells: HeatGridCell[],
  activeBands: number,
  max: number,
  mode: 'linear' | 'quantile' | 'logarithmic',
): void {
  // buildContributionGrid already applies the original four-band linear rule.
  // Preserve that exact output for the long-standing Claude ramp.
  if (mode === 'linear' && activeBands === 4) {
    return;
  }
  const bands = Math.max(1, activeBands);
  const positive = mode === 'quantile'
    ? cells.map((cell) => cell.value).filter((value) => value > 0).sort((a, b) => a - b)
    : [];
  for (const cell of cells) {
    if (cell.value <= 0 || max <= 0) {
      cell.bucket = 0;
      continue;
    }
    // Rank by the first occurrence, so a large tie of ordinary days stays in
    // the lightest active band. The observed maximum is always the top band;
    // otherwise sparse inputs and a tie at the maximum make the legend's
    // darkest swatch unreachable.
    if (mode === 'quantile' && positive.length > 0) {
      cell.bucket = cell.value >= max
        ? bands
        : Math.min(bands, Math.max(1, Math.floor((lowerBound(positive, cell.value) / positive.length) * bands) + 1));
      continue;
    }
    const normalized = mode === 'logarithmic'
      ? Math.log1p(cell.value) / Math.log1p(max)
      : cell.value / max;
    cell.bucket = Math.min(bands, Math.max(1, Math.ceil(normalized * bands)));
  }
}

function safeSvgColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'transparent' || /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(normalized)
    ? normalized
    : fallback;
}

function valueOf(u: DayUsage, metric: HeatMetric): number {
  return metric === 'cost' ? u.cost : metric === 'sessions' ? u.sessions : u.tokens;
}

/** Add `days` to a YYYY-MM-DD key (UTC arithmetic, zone-stable). */
function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateISO: string): number {
  return new Date(dateISO + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
}

function daysBetween(aISO: string, bISO: string): number {
  return Math.round((Date.parse(bISO + 'T00:00:00Z') - Date.parse(aISO + 'T00:00:00Z')) / 86_400_000);
}

/** Compact number: 5.3B / 1.2M / 345K / 42. */
function compactNum(n: number, locale: SupportedLanguage = 'en'): string {
  if (locale !== 'en') {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  }
  const abs = Math.abs(n);
  const trim = (x: number): string => x.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1e9) return trim(n / 1e9) + 'B';
  if (abs >= 1e6) return trim(n / 1e6) + 'M';
  if (abs >= 1e3) return trim(n / 1e3) + 'K';
  return String(Math.round(n));
}

/** English ordinal: 1st, 2nd, 3rd, 4th, 18th, 21st, 31st. */
function ordinal(d: number): string {
  const v = d % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(d % 10, 4)] || 'th';
  return d + suffix;
}

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Locale-aware visible date for a YYYY-MM-DD key. */
function longDate(dateISO: string, locale: SupportedLanguage): string {
  if (locale !== 'en') {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${dateISO}T00:00:00.000Z`));
  }
  const month = MONTHS_FULL[Number(dateISO.slice(5, 7)) - 1];
  return `${month} ${ordinal(Number(dateISO.slice(8, 10)))}`;
}

const esc = escapeSvgText;

export interface HeatGridCell {
  dateISO: string;
  col: number; // week column (0-based)
  row: number; // weekday row 0..6 (Sun..Sat)
  value: number;
  bucket: number;
}

export interface HeatGrid {
  cells: HeatGridCell[]; // only days in [startISO, endISO]
  columns: number;
  max: number;
  total: number;
  startISO: string;
  endISO: string;
}

/** Lay days in [startISO, endISO] into a Sun-started week grid (GitHub layout).
 * Days outside the range (the first week's lead-in, and everything after
 * endISO) are simply absent — no future padding. */
export function buildContributionGrid(
  daily: Record<string, DayUsage>,
  startISO: string,
  endISO: string,
  metric: HeatMetric
): HeatGrid {
  const gridStart = addDays(startISO, -weekdayOf(startISO)); // Sunday on/before start
  const span = daysBetween(gridStart, endISO) + 1;
  const columns = Math.max(0, Math.ceil(span / 7));

  const cells: HeatGridCell[] = [];
  let max = 0;
  let total = 0;
  for (let i = 0; i < span; i++) {
    const dateISO = addDays(gridStart, i);
    if (dateISO < startISO || dateISO > endISO) {
      continue; // lead-in / future — not drawn
    }
    const u = daily[dateISO] ?? { tokens: 0, cost: 0, sessions: 0 };
    const value = valueOf(u, metric);
    if (value > max) {
      max = value;
    }
    total += value;
    cells.push({ dateISO, col: Math.floor(i / 7), row: i % 7, value, bucket: 0 });
  }
  for (const c of cells) {
    c.bucket = intensityBucket(c.value, max);
  }
  return { cells, columns, max, total, startISO, endISO };
}

/** Render the trailing-year token heatmap as a self-contained SVG string. */
export function renderHeatmapSvg(daily: Record<string, DayUsage>, opts: HeatmapSvgOptions = {}): string {
  const locale = artifactLocale(opts.locale);
  const copy = HEATMAP_ARTIFACT_TRANSLATIONS[locale];
  const metric = opts.metric ?? 'tokens';
  const weeks = Math.max(1, Math.min(53, opts.weeks ?? 53));
  const today = opts.endDateISO ?? new Date().toISOString().slice(0, 10);
  const requestedScale = opts.scale && opts.scale.length >= 2 && opts.scale.length <= 8
    ? opts.scale
    : CLAUDE_ORANGE_SCALE;
  const scale = requestedScale.map((color, index) => safeSvgColor(
    color,
    CLAUDE_ORANGE_SCALE[Math.min(index, CLAUDE_ORANGE_SCALE.length - 1)],
  ));
  const watermark = opts.watermark ?? copy.madeWith;

  // Trailing window: full weeks ending on the Saturday of today's week, cells
  // only up to today (no future) — GitHub's default contribution view.
  const gridEndSat = addDays(today, 6 - weekdayOf(today));
  const startISO = opts.startDateISO ?? addDays(gridEndSat, -(weeks * 7 - 1)); // a Sunday, `weeks` back
  const grid = buildContributionGrid(daily, startISO, today, metric);
  assignRenderBuckets(
    grid.cells,
    scale.length - 1,
    grid.max,
    opts.intensityMode ?? 'linear',
  );

  // Auto summary heading, e.g. "5.3B tokens in Claude Code · 2026".
  const year = Number(today.slice(0, 4));
  const summary =
    opts.title ??
    (metric === 'cost'
      ? `$${compactNum(grid.total, locale)} ${copy.inClaudeCode} · ${year}`
      : metric === 'sessions'
        ? `${compactNum(grid.total, locale)} ${copy.sessions} ${copy.inClaudeCode} · ${year}`
        : `${compactNum(grid.total, locale)} ${copy.tokens} ${copy.inClaudeCode} · ${year}`);
  const noun = metric === 'sessions' ? copy.sessions : metric === 'cost' ? '' : copy.tokens;

  const cell = 12;
  const gap = 3;
  const step = cell + gap;
  const padL = 38; // weekday labels
  const titleH = opts.subtitle ? 43 : 24;
  const monthH = 18;
  const padT = titleH + monthH;
  const gridW = grid.columns * step;
  const gridH = 7 * step;
  const footerH = opts.footerNote ? 48 : 30;
  const width = Math.max(padL + gridW + 10, Math.max(0, opts.minWidth ?? 0));
  const height = padT + gridH + footerH;
  const renderedSummary = fitSvgText(summary, width - padL - 10, 15);

  const parts: string[] = [];
  const background = safeSvgColor(opts.background, '#ffffff');
  const primaryText = safeSvgColor(opts.primaryText, '#24292f');
  const secondaryText = safeSvgColor(opts.secondaryText, '#57606a');
  const borderColor = safeSvgColor(opts.borderColor, 'transparent');
  const accentColor = opts.accentColor
    ? safeSvgColor(opts.accentColor, '')
    : undefined;
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" role="img" aria-label="${escapeSvgAttribute(opts.ariaLabel ?? summary)}">`
  );
  parts.push(`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${background}" stroke="${borderColor}"/>`);
  if (accentColor) {
    parts.push(`<rect x="0" y="0" width="${width}" height="4" rx="2" fill="${accentColor}"/>`);
  }
  parts.push(`<text x="${padL}" y="16" font-size="15" font-weight="600" fill="${primaryText}">${esc(renderedSummary)}</text>`);
  if (opts.subtitle) {
    parts.push(`<text x="${padL}" y="34" font-size="11" fill="${secondaryText}">${esc(opts.subtitle)}</text>`);
  }

  // Cells with GitHub-style tooltips: "1.2M tokens on June 18th".
  for (const c of grid.cells) {
    const x = padL + c.col * step;
    const y = padT + c.row * step;
    const when = longDate(c.dateISO, locale);
    const usage = daily[c.dateISO] ?? { tokens: 0, cost: 0, sessions: 0 };
    const tip = opts.tooltip
      ? opts.tooltip(c.dateISO, usage, c.value, metric)
      : c.value <= 0
        ? `${copy.no} ${noun || copy.usage} ${copy.on} ${when}`
        : metric === 'cost'
          ? `$${compactNum(c.value, locale)} ${copy.on} ${when}`
          : `${compactNum(c.value, locale)} ${noun} ${copy.on} ${when}`;
    parts.push(
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" ry="2" fill="${scale[c.bucket]}"><title>${esc(tip)}</title></rect>`
    );
  }

  // Month labels above the first column that starts a new month.
  let lastMonth = -1;
  for (let col = 0; col < grid.columns; col++) {
    const first = grid.cells.find((c) => c.col === col);
    if (!first) {
      continue;
    }
    const m = Number(first.dateISO.slice(5, 7)) - 1;
    if (m !== lastMonth) {
      lastMonth = m;
      const monthLabel = new Intl.DateTimeFormat(locale, {
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, m, 1)));
      parts.push(`<text x="${padL + col * step}" y="${titleH + 13}" font-size="12" fill="${secondaryText}">${esc(monthLabel)}</text>`);
    }
  }

  // Weekday labels (Mon / Wed / Fri).
  for (const [row, weekday] of [[1, 1], [3, 3], [5, 5]] as [number, number][]) {
    const label = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2026, 0, 4 + weekday)));
    parts.push(`<text x="0" y="${padT + row * step + cell - 1}" font-size="11" fill="${secondaryText}">${label}</text>`);
  }

  const footY = padT + gridH + (opts.footerNote ? 36 : 18);

  if (opts.footerNote) {
    parts.push(`<text x="${padL}" y="${padT + gridH + 15}" font-size="10" fill="${secondaryText}">${esc(opts.footerNote)}</text>`);
  }

  // Watermark, bottom-left (an orange dot + source, to point back at the tool).
  const watermarkColor = scale[Math.min(3, scale.length - 1)];
  parts.push(`<rect x="${padL}" y="${footY - 8}" width="9" height="9" rx="2" ry="2" fill="${watermarkColor}"/>`);
  parts.push(`<text x="${padL + 13}" y="${footY}" font-size="11" fill="${secondaryText}">${esc(watermark)}</text>`);

  // Legend, bottom-right: Less [][][][][] More.
  // Anchor to the rendered card rather than the raw grid. Short 30/90-day
  // ranges use minWidth, so a grid-relative position can fall outside the
  // viewBox as the legend gains additional bands.
  const lessWidth = approximateSvgTextWidth(copy.less, 11);
  const moreWidth = approximateSvgTextWidth(copy.more, 11);
  const legendWidth = lessWidth + 8 + scale.length * step + 4 + moreWidth;
  let lx = Math.max(padL, width - legendWidth - 10);
  parts.push(`<text x="${lx}" y="${footY}" font-size="11" fill="${secondaryText}">${esc(copy.less)}</text>`);
  lx += lessWidth + 8;
  for (let b = 0; b < scale.length; b++) {
    parts.push(`<rect x="${lx + b * step}" y="${footY - 9}" width="${cell}" height="${cell}" rx="2" ry="2" fill="${scale[b]}"/>`);
  }
  parts.push(`<text x="${lx + scale.length * step + 4}" y="${footY}" font-size="11" fill="${secondaryText}">${esc(copy.more)}</text>`);

  parts.push('</svg>');
  return parts.join('\n');
}
