// Token heatmap (Monthly tab) — pure, dependency-free logic for the V2.2
// GitHub-contribution-style month grid. The rendering (themed cells + tooltip)
// lives in the webview; the day bucketing lives here so it's unit-tested and
// reused by the share card's rhythm strip.

export type HeatMetric = 'tokens' | 'cost' | 'sessions';

export interface DayUsage {
  tokens: number;
  cost: number;
  sessions: number;
}

export interface HeatCell {
  day: number; // 1..daysInMonth
  dateISO: string; // YYYY-MM-DD
  tokens: number;
  cost: number;
  sessions: number;
  value: number; // the selected metric
  bucket: number; // 0 (no usage) .. 4 (most)
}

export interface MonthHeatmap {
  year: number;
  month: number; // 1..12
  metric: HeatMetric;
  cells: HeatCell[];
  max: number; // max value across the month (for the legend)
}

/** Number of days in a month (month is 1..12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Intensity bucket 0..4. 0 = no usage; otherwise a quartile of the month's max
 * (a tiny non-zero day still reads as bucket 1, the max day as 4). */
export function intensityBucket(value: number, max: number): number {
  if (value <= 0 || max <= 0) {
    return 0;
  }
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

/**
 * Build the month grid. `daily` is keyed by 'YYYY-MM-DD'; missing days are
 * zero-filled so every calendar day has a cell. The metric selects which value
 * drives the intensity (default tokens).
 */
export function buildMonthHeatmap(
  daily: Record<string, DayUsage>,
  year: number,
  month: number,
  metric: HeatMetric = 'tokens'
): MonthHeatmap {
  const n = daysInMonth(year, month);
  const mm = String(month).padStart(2, '0');
  const valueOf = (u: DayUsage): number =>
    metric === 'cost' ? u.cost : metric === 'sessions' ? u.sessions : u.tokens;

  const rows: { day: number; dateISO: string; u: DayUsage; value: number }[] = [];
  let max = 0;
  for (let day = 1; day <= n; day++) {
    const dateISO = `${year}-${mm}-${String(day).padStart(2, '0')}`;
    const u = daily[dateISO] ?? { tokens: 0, cost: 0, sessions: 0 };
    const value = valueOf(u);
    if (value > max) {
      max = value;
    }
    rows.push({ day, dateISO, u, value });
  }

  const cells: HeatCell[] = rows.map((r) => ({
    day: r.day,
    dateISO: r.dateISO,
    tokens: r.u.tokens,
    cost: r.u.cost,
    sessions: r.u.sessions,
    value: r.value,
    bucket: intensityBucket(r.value, max),
  }));

  return { year, month, metric, cells, max };
}
