import { rollingDayKeysFromDayKey } from './dateKeys';
import type { ProjectMatrixCoverage, ProjectUsageMatrixSnapshot } from './projectUsageMatrix';

export type ProjectChartScale = 'day' | 'week' | 'month';
export interface ProjectChartRequest {
  startDay: string;
  endDay: string;
  scale?: ProjectChartScale;
  /** Only tokens are present in the existing project-day materialization. */
  metric?: string;
  /** Omitted selects all source projects; an empty selection stays empty. */
  projectKeys?: readonly string[];
  maxRows?: number;
  maxSeries?: number;
}
export interface ProjectChartPeriod {
  key: string;
  startDay: string;
  endDay: string;
  days: number;
  /** Selected range covers only part of this calendar week/month. */
  clipped: boolean;
}
export interface ProjectChartValue {
  /** Indexed subtotal when partial; null when unknown or numerically unsafe. */
  tokens: number | null;
  coverage: ProjectMatrixCoverage;
  knownProjectDays: number;
  expectedProjectDays: number;
  overflow: boolean;
}
export interface ProjectChartCell extends ProjectChartValue {
  bucket: 0 | 1 | 2 | 3 | 4 | null;
}
export interface ProjectChartRow {
  projectKeys: string[];
  projectCount: number;
  projectName: string;
  other: boolean;
  total: ProjectChartValue;
  cells: ProjectChartCell[];
}
export interface ProjectChartProjection {
  provider: ProjectUsageMatrixSnapshot['provider'];
  timeZone: string;
  sourceCoverage: ProjectMatrixCoverage;
  tokenBasis: 'claude-total' | 'codex-processed';
  status: 'ready' | 'no-data' | 'unavailable';
  reason?: 'invalid-range' | 'metric-unavailable' | 'project-unavailable';
  periods: ProjectChartPeriod[];
  selectedProjects: number;
  hiddenProjects: number;
  total: ProjectChartValue;
  rows: ProjectChartRow[];
  series: ProjectChartRow[];
}

const dayMs = 86_400_000;
function dayTime(day: string): number {
  return rollingDayKeysFromDayKey(day, 1).length ? Date.parse(`${day}T00:00:00Z`) : NaN;
}
function dateKey(time: number): string { return new Date(time).toISOString().slice(0, 10); }
function unknown(): ProjectChartValue {
  return { tokens: null, coverage: 'none', knownProjectDays: 0, expectedProjectDays: 1, overflow: false };
}
function accumulate(target: ProjectChartValue, value: ProjectChartValue): void {
  if (!value.expectedProjectDays) return;
  const empty = !target.expectedProjectDays;
  const sum = target.tokens === null && value.tokens === null ? null : (target.tokens ?? 0) + (value.tokens ?? 0);
  target.overflow ||= value.overflow || (sum !== null && !Number.isSafeInteger(sum));
  target.tokens = target.overflow ? null : sum;
  target.coverage = target.tokens === null ? 'none'
    : (empty || target.coverage === 'complete') && value.coverage === 'complete' ? 'complete' : 'partial';
  target.knownProjectDays += value.knownProjectDays;
  target.expectedProjectDays += value.expectedProjectDays;
}
function total(values: readonly ProjectChartValue[]): ProjectChartValue {
  const result = { ...unknown(), expectedProjectDays: 0 };
  for (const value of values) accumulate(result, value);
  return result;
}
function limit(value: number | undefined, fallback: number, min: number, max: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(min, Math.min(max, Math.floor(value)));
}
function periodFor(day: string, scale: ProjectChartScale): { key: string; first: string; last: string } {
  const time = dayTime(day);
  if (scale === 'day') return { key: day, first: day, last: day };
  if (scale === 'week') {
    const first = time - ((new Date(time).getUTCDay() + 6) % 7) * dayMs;
    return { key: dateKey(first), first: dateKey(first), last: dateKey(first + 6 * dayMs) };
  }
  const date = new Date(time);
  return { key: day.slice(0, 7), first: `${day.slice(0, 7)}-01`,
    last: dateKey(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)) };
}

/**
 * On-demand, pure projection of the existing bounded numeric project-day DTO.
 * No provider adapter, index, persisted field, IO, timer or renderer is introduced.
 * This foundation is intentionally not wired to the dashboard pending design review.
 */
export function projectChartProjection(
  snapshot: ProjectUsageMatrixSnapshot,
  request: ProjectChartRequest,
): ProjectChartProjection {
  const result: ProjectChartProjection = {
    provider: snapshot.provider, timeZone: snapshot.timeZone, sourceCoverage: snapshot.coverage,
    tokenBasis: snapshot.provider === 'claude' ? 'claude-total' : 'codex-processed',
    status: 'ready', periods: [], selectedProjects: 0, hiddenProjects: 0,
    total: { ...unknown(), expectedProjectDays: 0 }, rows: [], series: [],
  };
  const unavailable = (reason: ProjectChartProjection['reason']): ProjectChartProjection =>
    ({ ...result, status: 'unavailable', reason });
  if (request.metric !== undefined && request.metric !== 'tokens') return unavailable('metric-unavailable');
  const start = dayTime(request.startDay), end = dayTime(request.endDay);
  const count = (end - start) / dayMs + 1;
  const scale = request.scale ?? 'day';
  if (!Number.isInteger(count) || count < 1 || count > 90 || !Number.isFinite(dayTime(snapshot.asOfDay)) ||
      request.endDay > snapshot.asOfDay || !['day', 'week', 'month'].includes(scale)) return unavailable('invalid-range');
  const days = rollingDayKeysFromDayKey(request.endDay, count);
  const daySet = new Set(days), sourceDays = new Set(snapshot.days);
  const periods = new Map<string, { period: ProjectChartPeriod; days: string[] }>();
  for (const day of days) {
    const bounds = periodFor(day, scale);
    const entry = periods.get(bounds.key) ?? {
      period: { key: bounds.key, startDay: day, endDay: day, days: 0, clipped: false }, days: [],
    };
    entry.days.push(day);
    entry.period.endDay = day;
    entry.period.days += 1;
    entry.period.clipped = entry.period.startDay !== bounds.first || day !== bounds.last;
    periods.set(bounds.key, entry);
  }
  result.periods = [...periods.values()].map(entry => entry.period);

  const projects = new Map<string, { name: string; byDay: Map<string, ProjectChartValue> }>();
  // Source keys, not display names, define selection; labels do not become identities.
  for (const point of snapshot.points) {
    if (!point.projectKey) continue;
    if (!projects.has(point.projectKey)) projects.set(point.projectKey, { name: point.projectName, byDay: new Map() });
  }
  const selection = request.projectKeys === undefined ? new Set(projects.keys()) : new Set(request.projectKeys);
  if ([...selection].some(key => !projects.has(key))) return unavailable('project-unavailable');
  for (const key of projects.keys()) if (!selection.has(key)) projects.delete(key);
  result.selectedProjects = projects.size;
  if (!projects.size) return { ...result, status: 'no-data' };

  for (const point of snapshot.points) {
    const project = projects.get(point.projectKey);
    if (!project || !daySet.has(point.day) || !sourceDays.has(point.day)) continue;
    const valid = Number.isSafeInteger(point.tokens) && point.tokens >= 0 &&
      snapshot.coverage !== 'none' && (point.coverage === 'complete' || point.coverage === 'partial');
    let value: ProjectChartValue = valid ? {
      tokens: point.tokens,
      coverage: snapshot.coverage === 'complete' && point.coverage === 'complete' ? 'complete' : 'partial',
      knownProjectDays: 1, expectedProjectDays: 1, overflow: false,
    } : unknown();
    const previous = project.byDay.get(point.day);
    if (previous) {
      value = total([previous, value]);
      value.expectedProjectDays = 1;
      value.knownProjectDays = value.tokens === null ? 0 : 1;
    }
    project.byDay.set(point.day, value);
  }
  const rowLimit = limit(request.maxRows, 40, 1, 40);
  const seriesLimit = limit(request.maxSeries, 6, 2, 12);
  const keepLimit = Math.max(rowLimit, seriesLimit);
  const rows: ProjectChartRow[] = [];
  const positives = new Set<number>();
  const empty = (): ProjectChartValue => ({ ...unknown(), expectedProjectDays: 0 });
  const tailCells = result.periods.map(empty);
  let tailCount = 0;
  const addTail = (row: ProjectChartRow): void => {
    tailCount += row.projectCount;
    for (let i = 0; i < tailCells.length; i++) accumulate(tailCells[i], row.cells[i]);
  };
  const compare = (a: ProjectChartRow, b: ProjectChartRow): number =>
    (b.total.tokens ?? -1) - (a.total.tokens ?? -1) || a.projectKeys[0].localeCompare(b.projectKeys[0], 'en');
  const periodEntries = [...periods.values()];
  const defaultDay = (day: string): ProjectChartValue =>
    sourceDays.has(day) && snapshot.coverage === 'complete'
      ? { tokens: 0, coverage: 'complete', knownProjectDays: 1, expectedProjectDays: 1, overflow: false }
      : unknown();
  const defaults: ProjectChartCell[] = periodEntries.map(entry => ({
    ...total(entry.days.map(defaultDay)), bucket: null,
  }));
  const dayPeriods = new Map<string, number>();
  periodEntries.forEach((entry, i) => entry.days.forEach(day => dayPeriods.set(day, i)));
  for (const [key, project] of projects) {
    // Empty periods share immutable defaults during calculation. Only observed
    // periods allocate values; copied visible cells receive intensity below.
    const cells = defaults.slice();
    const observedPeriods = new Set([...project.byDay.keys()].map(day => dayPeriods.get(day)!));
    for (const i of observedPeriods) cells[i] = {
      ...total(periodEntries[i].days.map(day => project.byDay.get(day) ?? defaultDay(day))), bucket: null,
    };
    const row: ProjectChartRow = {
      projectKeys: [key], projectCount: 1, projectName: project.name,
      other: false, cells, total: total(cells),
    };
    for (const cell of cells) if (cell.tokens !== null && cell.tokens > 0) positives.add(cell.tokens);
    accumulate(result.total, row.total);
    rows.push(row);
    rows.sort(compare);
    if (rows.length > keepLimit) addTail(rows.pop()!);
    // Only bounded display rows survive; no dense projects × dates matrix is retained.
    projects.delete(key);
  }
  const sortedPositives = [...positives].sort((a, b) => a - b);
  const ranks = new Map(sortedPositives.map((value, index) => [value, index]));
  const bucket = (tokens: number | null): ProjectChartCell['bucket'] => tokens === null ? null : tokens === 0 ? 0
    : sortedPositives.length === 1 ? 4
    : (1 + Math.floor(3 * ranks.get(tokens)! / (sortedPositives.length - 1))) as 1 | 2 | 3 | 4;
  for (const row of rows) row.cells = row.cells.map(cell => ({ ...cell, bucket: bucket(cell.tokens) }));
  result.rows = rows.slice(0, rowLimit);
  result.hiddenProjects = result.selectedProjects - result.rows.length;
  result.series = rows.slice(0, result.selectedProjects > seriesLimit ? seriesLimit - 1 : rows.length);
  if (result.selectedProjects > seriesLimit) {
    for (const row of rows.slice(seriesLimit - 1)) addTail(row);
    const cells = tailCells.map(cell => ({ ...cell, bucket: null }));
    result.series.push({ projectKeys: [], projectCount: tailCount, projectName: '', other: true,
      total: total(cells), cells });
  }
  return result;
}
