import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildContributionGrid, renderHeatmapSvg, CLAUDE_ORANGE_SCALE } from '../heatmapSvg';
import { DayUsage } from '../heatmap';

const day = (tokens: number): DayUsage => ({ tokens, cost: tokens / 1000, sessions: 1 });

test('grid holds only days in [start, end] — no lead-in or future padding', () => {
  // 2026-01-01 is a Thursday; show Jan 1 .. Jan 20.
  const g = buildContributionGrid({}, '2026-01-01', '2026-01-20', 'tokens');
  assert.equal(g.cells.length, 20); // exactly the 20 in-range days
  assert.equal(g.cells[0].dateISO, '2026-01-01');
  assert.equal(g.cells[g.cells.length - 1].dateISO, '2026-01-20');
  // Jan 1 (Thu) sits at row 4 of the first column (Sun=0), not row 0.
  assert.equal(g.cells[0].row, 4);
  assert.equal(g.cells[0].col, 0);
});

test('renderHeatmapSvg runs Jan 1 → today, drawing no future days', () => {
  const daily: Record<string, DayUsage> = { '2026-03-15': day(1000) };
  const svg = renderHeatmapSvg(daily, { year: 2026, endDateISO: '2026-07-01' });
  assert.ok(svg.includes('<title>2026-03-15: 1,000</title>'));
  // A future day in the same year must not be drawn.
  assert.ok(!svg.includes('2026-09-01'));
  assert.ok(!svg.includes('2026-12-31'));
});

test('buckets scale to the range max (empty 0, max 4, tiny 1)', () => {
  const daily: Record<string, DayUsage> = { '2026-06-30': day(1_000_000), '2026-02-10': day(5) };
  const g = buildContributionGrid(daily, '2026-01-01', '2026-07-01', 'tokens');
  assert.equal(g.max, 1_000_000);
  assert.equal(g.cells.find((c) => c.dateISO === '2026-06-30')?.bucket, 4);
  assert.equal(g.cells.find((c) => c.dateISO === '2026-02-10')?.bucket, 1);
  assert.equal(g.cells.find((c) => c.value === 0)?.bucket, 0);
});

test('metric switch changes the value used', () => {
  const daily: Record<string, DayUsage> = { '2026-06-20': { tokens: 5, cost: 99, sessions: 2 } };
  assert.equal(buildContributionGrid(daily, '2026-01-01', '2026-07-01', 'tokens').max, 5);
  assert.equal(buildContributionGrid(daily, '2026-01-01', '2026-07-01', 'cost').max, 99);
});

test('SVG has title, months, legend, watermark and the orange ramp — no overlap', () => {
  const svg = renderHeatmapSvg({ '2026-06-30': day(500_000) }, {
    year: 2026,
    endDateISO: '2026-07-01',
    title: 'Claude Code',
    watermark: 'Claude Code Usage',
  });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.ok(svg.includes('Claude Code')); // title
  assert.ok(svg.includes('Claude Code Usage')); // watermark
  assert.ok(svg.includes('Less') && svg.includes('More'));
  assert.ok(svg.includes(CLAUDE_ORANGE_SCALE[4]));
  // title sits on its own row (y=11); month labels are lower (y=26) — no overlap.
  assert.ok(svg.includes('y="11"') && svg.includes('y="26"'));
});

test('no crash on empty data', () => {
  const svg = renderHeatmapSvg({}, { year: 2026, endDateISO: '2026-07-01' });
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes(CLAUDE_ORANGE_SCALE[0]));
});
