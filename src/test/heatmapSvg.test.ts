import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildContributionGrid, renderHeatmapSvg, CLAUDE_ORANGE_SCALE } from '../heatmapSvg';
import { DayUsage } from '../heatmap';
import { renderCombinedHeatmapSvg } from '../combinedHeatmapSvg';

const day = (tokens: number): DayUsage => ({ tokens, cost: tokens / 1000, sessions: 1 });

function fillForDate(svg: string, dateISO: string): string | undefined {
  const match = svg.match(new RegExp(
    `<rect[^>]*fill="([^"]+)"[^>]*><title>${dateISO}</title></rect>`,
  ));
  return match?.[1];
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(left: string, right: string): number {
  const l1 = relativeLuminance(left);
  const l2 = relativeLuminance(right);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function assertNormalSvgLabelContrast(svg: string): void {
  const background = /<rect\b[^>]*\bfill="(#[0-9a-f]{6})"/i.exec(svg)?.[1];
  assert.ok(background, 'SVG must expose a solid, auditable background');
  const labels = [...svg.matchAll(/<text\b([^>]*)>/g)];
  assert.ok(labels.length > 0, 'SVG must contain labels');
  for (const [, attributes] of labels) {
    const fill = /\bfill="(#[0-9a-f]{6})"/i.exec(attributes)?.[1];
    const fontSize = Number(/\bfont-size="([\d.]+)"/.exec(attributes)?.[1]);
    assert.ok(fill, `normal SVG label at ${fontSize}px must use a solid fill`);
    assert.ok(
      contrastRatio(fill, background) >= 4.5,
      `${fill} at ${fontSize}px must retain 4.5:1 contrast against ${background}`,
    );
  }
}

test('the in-dashboard heatmap anchors its end date in the configured timezone', () => {
  const webviewSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'webview.ts'),
    'utf8',
  );
  const start = webviewSource.indexOf('private renderClaudeHeatmapPresentation');
  const end = webviewSource.indexOf('private buildShareCardSvgFor', start);
  assert.ok(start >= 0 && end > start, 'the Claude heatmap presentation must remain discoverable');
  const panel = webviewSource.slice(start, end);
  assert.match(
    panel,
    /renderHeatmapSvg\(daily,\s*\{\s*endDateISO:\s*dayKeyInZone\(new Date\(\),\s*I18n\.getTimezone\(\)\),\s*locale:\s*I18n\.getLocale\(\),?\s*\}\)/,
  );
});

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

test('legacy and combined heatmaps give every normal SVG label at least 4.5:1 contrast', () => {
  assertNormalSvgLabelContrast(renderHeatmapSvg({}, { endDateISO: '2026-07-01' }));
  assertNormalSvgLabelContrast(renderCombinedHeatmapSvg({
    '2026-06-30': {
      dateISO: '2026-06-30',
      claudeProcessed: 1_000,
      codexProcessed: 2_000,
      combinedProcessed: 3_000,
    },
  }, {
    endDateISO: '2026-07-01',
  }));
});

test('short custom ramps keep a valid watermark and matching legend', () => {
  const svg = renderHeatmapSvg(
    { '2026-06-20': day(10) },
    { endDateISO: '2026-07-01', scale: ['#f5f3ff', '#4f2f87'] },
  );

  assert.ok(svg.includes('fill="#4f2f87"'));
  assert.equal((svg.match(/fill="#f5f3ff"/g) ?? []).length > 0, true);
  assert.equal(svg.includes('fill="undefined"'), false);
});

test('quantile mode keeps a large ordinary-day tie light and an isolated peak dark', () => {
  const daily: Record<string, DayUsage> = {};
  const start = new Date('2026-01-01T00:00:00Z');
  for (let index = 0; index < 100; index++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    daily[date.toISOString().slice(0, 10)] = day(index === 99 ? 10 : 1);
  }
  const scale = ['#eeeeee', '#dddddd', '#bbbbbb', '#999999', '#777777', '#333333'];
  const svg = renderHeatmapSvg(daily, {
    startDateISO: '2026-01-01',
    endDateISO: '2026-04-10',
    scale,
    intensityMode: 'quantile',
    tooltip: (dateISO) => dateISO,
  });

  assert.equal(fillForDate(svg, '2026-01-01'), scale[1]);
  assert.equal(fillForDate(svg, '2026-04-09'), scale[1]);
  assert.equal(fillForDate(svg, '2026-04-10'), scale[5]);
});

test('quantile mode always reaches the top band for sparse and maximum-tied data', () => {
  const scale = ['#eeeeee', '#dddddd', '#bbbbbb', '#999999', '#777777', '#333333'];
  const svg = renderHeatmapSvg({
    '2026-06-01': day(1),
    '2026-06-02': day(2),
    '2026-06-03': day(4),
    '2026-06-04': day(4),
  }, {
    startDateISO: '2026-06-01',
    endDateISO: '2026-06-04',
    scale,
    intensityMode: 'quantile',
    tooltip: (dateISO) => dateISO,
  });

  assert.equal(fillForDate(svg, '2026-06-01'), scale[1]);
  assert.equal(fillForDate(svg, '2026-06-03'), scale[5]);
  assert.equal(fillForDate(svg, '2026-06-04'), scale[5]);
});

test('logarithmic mode compresses a long tail while preserving value order', () => {
  const scale = ['#eeeeee', '#dddddd', '#bbbbbb', '#999999', '#777777', '#333333'];
  const svg = renderHeatmapSvg({
    '2026-06-01': day(1),
    '2026-06-02': day(9),
    '2026-06-03': day(99),
    '2026-06-04': day(999),
  }, {
    startDateISO: '2026-06-01',
    endDateISO: '2026-06-04',
    scale,
    intensityMode: 'logarithmic',
    tooltip: (dateISO) => dateISO,
  });

  assert.equal(fillForDate(svg, '2026-06-01'), scale[1]);
  assert.equal(fillForDate(svg, '2026-06-02'), scale[2]);
  assert.equal(fillForDate(svg, '2026-06-03'), scale[4]);
  assert.equal(fillForDate(svg, '2026-06-04'), scale[5]);
});

test('short-range legends stay inside a min-width share card', () => {
  const svg = renderHeatmapSvg({}, {
    startDateISO: '2026-06-23',
    endDateISO: '2026-07-22',
    scale: ['#ebedf0', '#eee8f8', '#d8c9f1', '#bca5e6', '#8668c7', '#4f2f87'],
    minWidth: 720,
  });

  assert.doesNotMatch(svg, /<(?:text|rect) x="-/);
  assert.match(svg, /<text x="[\d.]+"[^>]*>Less<\/text>/);
  assert.match(svg, /<text x="[\d.]+"[^>]*>More<\/text>/);
});

test('the default linear renderer preserves the original four active buckets', () => {
  const daily: Record<string, DayUsage> = {
    '2026-06-01': day(1),
    '2026-06-02': day(25),
    '2026-06-03': day(50),
    '2026-06-04': day(75),
    '2026-06-05': day(100),
  };
  const svg = renderHeatmapSvg(daily, {
    startDateISO: '2026-06-01',
    endDateISO: '2026-06-05',
    tooltip: (dateISO) => dateISO,
  });

  assert.equal(fillForDate(svg, '2026-06-01'), CLAUDE_ORANGE_SCALE[1]);
  assert.equal(fillForDate(svg, '2026-06-02'), CLAUDE_ORANGE_SCALE[1]);
  assert.equal(fillForDate(svg, '2026-06-03'), CLAUDE_ORANGE_SCALE[2]);
  assert.equal(fillForDate(svg, '2026-06-04'), CLAUDE_ORANGE_SCALE[3]);
  assert.equal(fillForDate(svg, '2026-06-05'), CLAUDE_ORANGE_SCALE[4]);
});

test('renderer sanitizes caller-supplied SVG colors at the shared boundary', () => {
  const svg = renderHeatmapSvg(
    { '2026-06-20': day(10) },
    {
      endDateISO: '2026-07-01',
      scale: ['#eeeeee', 'url(javascript:alert(1))'],
      background: 'url(javascript:alert(2))',
      accentColor: '" onload="alert(3)',
    },
  );

  assert.doesNotMatch(svg, /javascript|onload|url\(/i);
});

test('renderer escapes quotes before caller text enters an SVG attribute', () => {
  const svg = renderHeatmapSvg({}, {
    endDateISO: '2026-07-01',
    title: 'Safe title',
    ariaLabel: `Safe title\" onload=\"alert(1)' data-canary='unsafe`,
  });

  assert.doesNotMatch(svg, /aria-label="Safe title"\s+onload=/i);
  assert.match(svg, /aria-label="Safe title&quot; onload=&quot;alert\(1\)&#39; data-canary=&#39;unsafe"/);
  assert.match(svg, /&#39;/);
});

test('maximum ASCII and CJK titles are visually contained in the SVG viewBox', () => {
  for (const title of ['W'.repeat(80), '综合活动热力图'.repeat(12)]) {
    const svg = renderHeatmapSvg({}, {
      startDateISO: '2026-06-23',
      endDateISO: '2026-07-22',
      minWidth: 720,
      title,
    });
    const width = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)?.[1]);
    const renderedTitle = /<text x="38" y="16"[^>]*>(.*?)<\/text>/.exec(svg)?.[1] ?? '';
    assert.equal(width, 720);
    assert.ok(renderedTitle.endsWith('…'), `expected a contained title: ${renderedTitle}`);
    assert.ok(renderedTitle.length < title.length);
  }
});

test('Claude heatmap labels and tooltips use all eight UI locales', () => {
  const expected = {
    en: ['Less', 'More', 'No tokens on June'],
    'de-DE': ['Weniger', 'Mehr', 'Keine Token am'],
    'zh-TW': ['較少', '較多', '無 Token 日期'],
    'zh-CN': ['较少', '较多', '无 Token 日期'],
    ja: ['少ない', '多い', 'なし： トークン 日付'],
    ko: ['적게', '많이', '없음: 토큰 날짜'],
    'pt-BR': ['Menos', 'Mais', 'Sem tokens em'],
    id: ['Lebih sedikit', 'Lebih banyak', 'Tidak ada token pada'],
  };
  for (const [locale, markers] of Object.entries(expected)) {
    const svg = renderHeatmapSvg({}, {
      startDateISO: '2026-06-20',
      endDateISO: '2026-06-22',
      locale,
    });
    for (const marker of markers) assert.match(svg, new RegExp(marker));
  }
});
