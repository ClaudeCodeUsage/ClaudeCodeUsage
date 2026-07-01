// GitHub-contribution-style heatmap as a standalone SVG string — for pasting
// into a GitHub profile README (the "local trial" of the token heatmap).
//
// Pure and dependency-free (no vscode, no DOM) so it unit-tests and can be
// generated headlessly. GitHub's own graph is green; this uses a Claude-orange
// ramp instead. Like GitHub's default view it shows the trailing ~year ending
// today (future days are not drawn). Light-theme palette on purpose — a profile
// README renders on a white/light canvas.

import { DayUsage, HeatMetric, intensityBucket } from './heatmap';

/** Claude-orange 5-step intensity ramp (bucket 0..4). 0 = empty cell. */
export const CLAUDE_ORANGE_SCALE = ['#ebedf0', '#fadcc9', '#f0aa82', '#e07d4f', '#c85a2b'];

export interface HeatmapSvgOptions {
  metric?: HeatMetric; // default 'tokens'
  weeks?: number; // trailing weeks to show (default 53, GitHub-like)
  endDateISO?: string; // last day to show (default today)
  title?: string; // override the auto summary heading
  watermark?: string; // bottom-left source note (default "Made with Claude Code Usage")
  scale?: string[]; // 5 colours, empty→max (default CLAUDE_ORANGE_SCALE)
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
function compactNum(n: number): string {
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "June 18th" for a YYYY-MM-DD key. */
function longDate(dateISO: string): string {
  const month = MONTHS_FULL[Number(dateISO.slice(5, 7)) - 1];
  return `${month} ${ordinal(Number(dateISO.slice(8, 10)))}`;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  const metric = opts.metric ?? 'tokens';
  const weeks = Math.max(1, Math.min(53, opts.weeks ?? 53));
  const today = opts.endDateISO ?? new Date().toISOString().slice(0, 10);
  const scale = opts.scale && opts.scale.length === 5 ? opts.scale : CLAUDE_ORANGE_SCALE;
  const watermark = opts.watermark ?? 'Made with Claude Code Usage';

  // Trailing window: full weeks ending on the Saturday of today's week, cells
  // only up to today (no future) — GitHub's default contribution view.
  const gridEndSat = addDays(today, 6 - weekdayOf(today));
  const startISO = addDays(gridEndSat, -(weeks * 7 - 1)); // a Sunday, `weeks` back
  const grid = buildContributionGrid(daily, startISO, today, metric);

  // Auto summary heading, e.g. "5.3B tokens in Claude Code · 2026".
  const year = Number(today.slice(0, 4));
  const summary =
    opts.title ??
    (metric === 'cost'
      ? `$${compactNum(grid.total)} in Claude Code · ${year}`
      : metric === 'sessions'
        ? `${compactNum(grid.total)} sessions in Claude Code · ${year}`
        : `${compactNum(grid.total)} tokens in Claude Code · ${year}`);
  const noun = metric === 'sessions' ? 'sessions' : metric === 'cost' ? '' : 'tokens';

  const cell = 11;
  const gap = 3;
  const step = cell + gap;
  const padL = 30; // weekday labels
  const titleH = 16;
  const monthH = 14;
  const padT = titleH + monthH;
  const gridW = grid.columns * step;
  const gridH = 7 * step;
  const footerH = 24;
  const width = padL + gridW + 10;
  const height = padT + gridH + footerH;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<text x="${padL}" y="11" font-size="12" font-weight="600" fill="#24292f">${esc(summary)}</text>`);

  // Cells with GitHub-style tooltips: "1.2M tokens on June 18th".
  for (const c of grid.cells) {
    const x = padL + c.col * step;
    const y = padT + c.row * step;
    const when = longDate(c.dateISO);
    const tip =
      c.value <= 0
        ? `No ${noun || 'usage'} on ${when}`
        : metric === 'cost'
          ? `$${compactNum(c.value)} on ${when}`
          : `${compactNum(c.value)} ${noun} on ${when}`;
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
      parts.push(`<text x="${padL + col * step}" y="${titleH + 10}" font-size="10" fill="#57606a">${MONTHS[m]}</text>`);
    }
  }

  // Weekday labels (Mon / Wed / Fri).
  for (const [row, label] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']] as [number, string][]) {
    parts.push(`<text x="0" y="${padT + row * step + cell - 1}" font-size="9" fill="#57606a">${label}</text>`);
  }

  const footY = padT + gridH + 14;

  // Watermark, bottom-left (an orange dot + source, to point back at the tool).
  parts.push(`<rect x="${padL}" y="${footY - 8}" width="9" height="9" rx="2" ry="2" fill="${scale[3]}"/>`);
  parts.push(`<text x="${padL + 13}" y="${footY}" font-size="9" fill="#57606a">${esc(watermark)}</text>`);

  // Legend, bottom-right: Less [][][][][] More.
  let lx = padL + gridW - (5 * step + 56);
  parts.push(`<text x="${lx}" y="${footY}" font-size="9" fill="#57606a">Less</text>`);
  lx += 26;
  for (let b = 0; b < 5; b++) {
    parts.push(`<rect x="${lx + b * step}" y="${footY - 9}" width="${cell}" height="${cell}" rx="2" ry="2" fill="${scale[b]}"/>`);
  }
  parts.push(`<text x="${lx + 5 * step + 4}" y="${footY}" font-size="9" fill="#57606a">More</text>`);

  parts.push('</svg>');
  return parts.join('\n');
}
