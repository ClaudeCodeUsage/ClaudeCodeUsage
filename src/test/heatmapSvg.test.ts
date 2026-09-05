import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildContributionGrid, renderHeatmapSvg, CLAUDE_ORANGE_SCALE } from '../heatmapSvg';
import { DayUsage } from '../heatmap';

const day = (tokens: number): DayUsage => ({ tokens, cost: tokens / 1000, sessions: 1 });

test('grid holds only days in [start, end], and totals them', () => {
  const daily: Record<string, DayUsage> = { '2026-01-05': day(10), '2026-01-10': day(20) };
  const g = buildContributionGrid(daily, '2026-01-01', '2026-01-20', 'tokens');
  assert.equal(g.cells.length, 20);
  assert.equal(g.cells[0].dateISO, '2026-01-01');
  assert.equal(g.cells[g.cells.length - 1].dateISO, '2026-01-20');
  assert.equal(g.total, 30);
});

test('renderHeatmapSvg shows a trailing ~year ending today', () => {
  const daily: Record<string, DayUsage> = { '2026-03-15': day(1000) };
  const svg = renderHeatmapSvg(daily, { endDateISO: '2026-07-01' });
  assert.ok(svg.includes('March 15th')); // ~4 months back is in-window
});

test('the window ends at today — no future cells drawn', () => {
  const g = buildContributionGrid({}, '2025-07-06', '2026-07-01', 'tokens');
  assert.ok(g.cells.every((c) => c.dateISO <= '2026-07-01'));
  assert.ok(g.cells.some((c) => c.dateISO === '2026-07-01')); // today is included
});

test('top-left summary reports the compact total, "tokens in Claude Code · YEAR"', () => {
  const daily: Record<string, DayUsage> = { '2026-06-01': day(5_300_000_000) };
  const svg = renderHeatmapSvg(daily, { endDateISO: '2026-07-01' });
  assert.ok(svg.includes('5.3B tokens in Claude Code · 2026'));
});

test('tooltips read GitHub-style: "<n> tokens on <Month> <ordinal>"', () => {
  const daily: Record<string, DayUsage> = {
    '2026-06-18': day(1_200_000),
    '2026-06-21': day(500),
  };
  const svg = renderHeatmapSvg(daily, { endDateISO: '2026-07-01' });
  assert.ok(svg.includes('<title>1.2M tokens on June 18th</title>'));
  assert.ok(svg.includes('<title>500 tokens on June 21st</title>')); // ordinal 21 → 21st
  assert.ok(svg.includes('No tokens on ')); // empty days
});

test('buckets scale to the range max (empty 0, max 4, tiny 1)', () => {
  const daily: Record<string, DayUsage> = { '2026-06-30': day(1_000_000), '2026-06-01': day(5) };
  const g = buildContributionGrid(daily, '2026-01-01', '2026-07-01', 'tokens');
  assert.equal(g.cells.find((c) => c.dateISO === '2026-06-30')?.bucket, 4);
  assert.equal(g.cells.find((c) => c.dateISO === '2026-06-01')?.bucket, 1);
  assert.equal(g.cells.find((c) => c.value === 0)?.bucket, 0);
});

test('cost metric switches value, noun and summary', () => {
  const daily: Record<string, DayUsage> = { '2026-06-20': { tokens: 5, cost: 12.5, sessions: 2 } };
  const svg = renderHeatmapSvg(daily, { endDateISO: '2026-07-01', metric: 'cost' });
  assert.ok(svg.includes('in Claude Code · 2026'));
  assert.ok(svg.includes('$12.5 on June 20th') || svg.includes('$13 on June 20th'));
});

test('has legend, watermark and the orange ramp; no crash on empty data', () => {
  const svg = renderHeatmapSvg({}, { endDateISO: '2026-07-01', watermark: 'Made with Claude Code Usage' });
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes('Less') && svg.includes('More'));
  assert.ok(svg.includes('Made with Claude Code Usage'));
  assert.ok(svg.includes(CLAUDE_ORANGE_SCALE[0]));
});
