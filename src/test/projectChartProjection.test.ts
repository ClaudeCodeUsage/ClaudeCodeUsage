import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildProjectUsageMatrixSnapshot, ProjectDayPoint } from '../projectUsageMatrix';
import { projectChartProjection } from '../projectChartProjection';

const point = (projectKey: string, day: string, tokens: number, coverage: ProjectDayPoint['coverage'] = 'complete'): ProjectDayPoint =>
  ({ projectKey, projectName: projectKey, day, tokens, coverage });
const snapshot = (points: ProjectDayPoint[], coverage: ProjectDayPoint['coverage'] = 'complete', provider: 'claude' | 'codex' = 'codex') =>
  buildProjectUsageMatrixSnapshot(provider, points, { asOfDay: '2026-10-13', timeZone: 'Asia/Shanghai', coverage });
const range = { startDay: '2026-10-11', endDay: '2026-10-13' };

test('chart gaps are known zero only under complete source coverage', () => {
  for (const coverage of ['complete', 'partial', 'none'] as const) {
    const result = projectChartProjection(snapshot([point('a', '2026-10-13', 7)], coverage), range);
    assert.equal(result.rows[0].cells[0].tokens, coverage === 'complete' ? 0 : null);
    assert.equal(result.rows[0].cells[0].coverage, coverage === 'complete' ? 'complete' : 'none');
    assert.equal(result.rows[0].cells[0].bucket, coverage === 'complete' ? 0 : null);
    assert.equal(result.rows[0].cells[2].tokens, coverage === 'none' ? null : 7);
  }
});

test('observed zero subtotal is distinct from unknown and from complete zero', () => {
  const result = projectChartProjection(snapshot([point('a', '2026-10-13', 0)], 'partial'), range);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].cells[2].tokens, 0);
  assert.equal(result.rows[0].cells[2].coverage, 'partial');
  assert.equal(result.rows[0].cells[0].tokens, null);
  assert.equal(result.rows[0].total.coverage, 'partial');
});

test('calendar weeks start Monday and clipped periods disclose their actual days', () => {
  const result = projectChartProjection(snapshot([point('a', '2026-10-13', 7)]), { ...range, scale: 'week' });
  assert.deepEqual(result.periods, [
    { key: '2026-10-05', startDay: '2026-10-11', endDay: '2026-10-11', days: 1, clipped: true },
    { key: '2026-10-12', startDay: '2026-10-12', endDay: '2026-10-13', days: 2, clipped: true },
  ]);
  assert.deepEqual(result.rows[0].cells.map(cell => cell.tokens), [0, 7]);
});

test('monthly buckets use already zoned civil dates and retain unknown days', () => {
  const result = projectChartProjection(snapshot([
    point('a', '2026-09-30', 3), point('a', '2026-10-01', 5),
  ], 'partial'), { startDay: '2026-09-30', endDay: '2026-10-02', scale: 'month' });
  assert.equal(result.timeZone, 'Asia/Shanghai');
  assert.deepEqual(result.periods.map(period => period.key), ['2026-09', '2026-10']);
  assert.deepEqual(result.rows[0].cells.map(cell => [cell.tokens, cell.coverage, cell.knownProjectDays, cell.expectedProjectDays]), [
    [3, 'partial', 1, 1], [5, 'partial', 1, 2],
  ]);
});

test('dates outside the retained source never acquire complete zero coverage', () => {
  const data = snapshot([point('a', '2026-10-13', 7)]);
  const result = projectChartProjection(data, { startDay: '2026-07-14', endDay: '2026-07-16' });
  assert.equal(result.rows[0].cells[0].tokens, null);
  assert.equal(result.rows[0].cells[2].tokens, 0);
});

test('explicit project filters have one denominator and never fall back to all projects', () => {
  const data = snapshot([point('a', '2026-10-13', 7), point('b', '2026-10-13', 11)]);
  const selected = projectChartProjection(data, { ...range, projectKeys: ['a', 'a'] });
  assert.equal(selected.selectedProjects, 1);
  assert.equal(selected.total.tokens, 7);
  assert.equal(selected.total.expectedProjectDays, 3);
  assert.equal(projectChartProjection(data, { ...range, projectKeys: [] }).status, 'no-data');
  assert.equal(projectChartProjection(data, { ...range, projectKeys: ['missing'] }).status, 'unavailable');
});

test('Other preserves token totals and unknown evidence in every period', () => {
  const data = snapshot(Array.from({ length: 8 }, (_, i) => point(`p${i}`, '2026-10-13', i + 1)), 'partial');
  const result = projectChartProjection(data, { ...range, maxRows: 2, maxSeries: 3 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.hiddenProjects, 6);
  assert.equal(result.series.length, 3);
  assert.equal(result.series[2].other, true);
  assert.equal(result.series[2].projectCount, 6);
  assert.deepEqual(result.series[2].projectKeys, []);
  assert.equal(result.series.reduce((sum, row) => sum + (row.total.tokens ?? 0), 0), 36);
  assert.equal(result.series[2].cells[0].tokens, null);
  assert.equal(result.total.expectedProjectDays, 24);
  assert.equal(result.total.knownProjectDays, 8);
});

test('intensity has one scale including hidden rows, after filtering and bucketing', () => {
  const data = snapshot([point('a', '2026-10-12', 50), point('a', '2026-10-13', 50), point('b', '2026-10-13', 80)]);
  const result = projectChartProjection(data, { ...range, maxRows: 1 });
  assert.equal(result.rows[0].projectKeys[0], 'a');
  assert.equal(result.rows[0].cells[2].bucket, 1);
  assert.equal(projectChartProjection(data, { ...range, scale: 'week', maxRows: 1 }).rows[0].cells[1].bucket, 4);
});

test('provider token semantics remain explicit and unsupported metrics stay unavailable', () => {
  const points = [point('a', '2026-10-13', 7)];
  assert.equal(projectChartProjection(snapshot(points, 'complete', 'claude'), range).tokenBasis, 'claude-total');
  assert.equal(projectChartProjection(snapshot(points), range).tokenBasis, 'codex-processed');
  for (const metric of ['cost', 'cache', 'reasoning', 'fresh']) {
    const result = projectChartProjection(snapshot(points), { ...range, metric });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'metric-unavailable');
  }
});

test('invalid and excessive ranges fail closed; empty data is explicit', () => {
  const data = snapshot([]);
  for (const request of [
    { startDay: '2026-02-30', endDay: '2026-03-01' },
    { startDay: '2026-10-13', endDay: '2026-10-11' },
    { startDay: '2026-01-01', endDay: '2026-10-13' },
    { startDay: '2026-10-13', endDay: '2026-10-14' },
  ]) assert.equal(projectChartProjection(data, request).reason, 'invalid-range');
  const result = projectChartProjection(data, range);
  assert.equal(result.status, 'no-data');
  assert.equal(result.total.tokens, null);
  assert.equal(result.rows.length, 0);
});

test('partial point coverage cannot be promoted by a complete snapshot', () => {
  const result = projectChartProjection(snapshot([point('a', '2026-10-13', 7, 'partial')]), range);
  assert.equal(result.total.tokens, 7);
  assert.equal(result.total.coverage, 'partial');
});

test('invalid numeric points and overflow withhold values instead of producing zero or infinity', () => {
  for (const tokens of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const data = snapshot([point('a', '2026-10-13', 1)]);
    data.points[0].tokens = tokens;
    const result = projectChartProjection(data, range);
    assert.equal(result.rows[0].cells[2].tokens, null);
    assert.equal(result.rows[0].total.coverage, 'partial');
  }
  const result = projectChartProjection(snapshot([
    point('a', '2026-10-12', Number.MAX_SAFE_INTEGER), point('a', '2026-10-13', 1),
  ]), { ...range, scale: 'week' });
  assert.equal(result.rows[0].cells[1].tokens, null);
  assert.equal(result.total.tokens, null);
});

test('duplicate points add once and any unknown duplicate prevents complete coverage', () => {
  const data = snapshot([point('a', '2026-10-13', 7)]);
  data.points.push(point('a', '2026-10-13', 2), point('a', '2026-10-13', 100, 'none'));
  const result = projectChartProjection(data, range);
  assert.equal(result.rows[0].cells[2].tokens, 9);
  assert.equal(result.rows[0].cells[2].coverage, 'partial');
  assert.equal(result.rows[0].cells[2].knownProjectDays, 1);
});

test('projection is deterministic, bounded and does not mutate the materialized snapshot', () => {
  const data = snapshot(Array.from({ length: 50 }, (_, i) => point(`p${i}`, '2026-10-13', i)));
  const before = JSON.stringify(data);
  const first = projectChartProjection(data, { ...range, maxRows: NaN, maxSeries: Infinity });
  assert.equal(first.rows.length, 40);
  assert.equal(first.series.length, 6);
  assert.deepEqual(first, projectChartProjection(data, { ...range, maxRows: NaN, maxSeries: Infinity }));
  assert.equal(JSON.stringify(data), before);
});

test('Other retains only a project count, never an unbounded hidden identity list', () => {
  const data = snapshot(Array.from({ length: 5000 }, (_, i) => point(`p${i}`, '2026-10-13', i + 1)));
  const result = projectChartProjection(data, { ...range, maxRows: 1, maxSeries: 2 });
  assert.equal(result.series[1].projectCount, 4999);
  assert.deepEqual(result.series[1].projectKeys, []);
  assert.equal(result.series[1].total.tokens, 12_497_500);
  assert.equal(result.total.tokens, 12_502_500);
});

test('leap days and DST transitions do not change civil-date denominators', () => {
  const leap = buildProjectUsageMatrixSnapshot('claude', [point('a', '2024-02-29', 2)], {
    asOfDay: '2024-03-01', timeZone: 'America/New_York',
  });
  const result = projectChartProjection(leap, { startDay: '2024-02-28', endDay: '2024-03-01', scale: 'month' });
  assert.deepEqual(result.periods.map(p => [p.key, p.days]), [['2024-02', 2], ['2024-03', 1]]);
  assert.equal(result.total.expectedProjectDays, 3);
  const dst = buildProjectUsageMatrixSnapshot('codex', [point('a', '2026-03-08', 2)], {
    asOfDay: '2026-03-10', timeZone: 'America/New_York',
  });
  assert.equal(projectChartProjection(dst, { startDay: '2026-03-01', endDay: '2026-03-10', scale: 'week' }).total.expectedProjectDays, 10);
});

test('all-unknown periods stay unknown even when streaming many Other projects', () => {
  const data = snapshot(Array.from({ length: 100 }, (_, i) => point(`p${i}`, '2026-10-13', 1)), 'none');
  const result = projectChartProjection(data, { ...range, scale: 'week' });
  assert.equal(result.total.tokens, null);
  assert.equal(result.total.coverage, 'none');
  assert.equal(result.total.knownProjectDays, 0);
  assert.equal(result.series[result.series.length - 1]?.projectCount, 95);
  assert.ok(result.series[result.series.length - 1]?.cells.every(cell => cell.tokens === null));
});

test('empty selections preserve source coverage without implying zero usage', () => {
  for (const coverage of ['complete', 'partial', 'none'] as const) {
    const result = projectChartProjection(snapshot([], coverage), range);
    assert.equal(result.sourceCoverage, coverage);
    assert.equal(result.status, 'no-data');
    assert.equal(result.total.tokens, null);
  }
});
