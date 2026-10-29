import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildApiHeatmapArtifact, normalizeApiHeatmapConfig, ApiHeatmapOptions, ApiHeatmapDaily, ApiHeatmapDailyUsage } from '../apiHeatmap';
import { API_HEATMAP_COPY } from '../apiHeatmapCopy';
import { COMBINED_ACTIVITY_PALETTES, customCombinedHeatmapScale } from '../combinedHeatmapSvg';
import { resolveCurrencyDisplay } from '../currencyDisplay';
import { renderHeatmapSvg } from '../heatmapSvg';

const options: ApiHeatmapOptions = { endDateISO: '2026-10-13', provider: 'codex', metric: 'apiEquivalent',
  showAmounts: true, presentation: 'compact', range: 'year', locale: 'en', timezone: 'UTC' };
const day = (amountUSD: number | null, pricingStatus: ApiHeatmapDailyUsage['pricingStatus'] = 'complete',
  sourceComplete = true): ApiHeatmapDailyUsage => ({ tokens: 100, amountUSD, pricingStatus, sourceComplete,
  estimated: false, pricedCount: pricingStatus === 'unpriced' ? 0 : 9,
  unpricedCount: pricingStatus === 'partial' || pricingStatus === 'unpriced' ? 1 : 0 });
const text = (svg: string): string => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]).join(' ');
const cell = (svg: string, date: string): string => svg.match(new RegExp(`<rect[^>]*><title>${date}[^<]*<\\/title><\\/rect>`))?.[0] ?? '';
const fill = (svg: string, date: string): string => /fill="([^"]+)"/.exec(cell(svg, date))?.[1] ?? '';

test('compact amounts sum precision before integer display, retain descriptions and one slim footer', () => {
  const artifact = buildApiHeatmapArtifact({ '2026-10-12': { codex: day(.6) }, '2026-10-13': { codex: day(.6) } }, options);
  assert.equal(artifact.config.presentation, 'compact');
  assert.equal(artifact.config.intensityMode, 'peakRelative');
  assert.match(text(artifact.svg), /\$1 API equivalent · Codex/);
  assert.match(text(buildApiHeatmapArtifact({ '2026-10-13': { codex: day(1) } }, {...options,range:'30d',title:'Custom'}).svg), /last 30 days.*Custom/);
  assert.doesNotMatch(text(artifact.svg), /\$2|\$1\.20|Current pricing|Reference estimate|Gray:|Coverage/);
  assert.match(artifact.svg, /width="843" height="177"/);
  assert.match(artifact.svg, /role="group"/);
  assert.match(artifact.svg, /<desc>.*Current pricing.*not a bill.*<\/desc>/);
  assert.match(artifact.svg, /Track Claude Code \+ Codex with our VS Code extension ↗/);
  assert.match(artifact.svg, /href="https:\/\/marketplace.visualstudio.com\/items\?itemName=growthjack.claude-code-usage"/);
  assert.doesNotMatch(artifact.svg, /≥\$1/);
  assert.doesNotMatch(artifact.svg, /data-heatmap-footer|width="9" height="9"/);
  assert.equal((text(artifact.svg).match(/Codex/g) ?? []).length, 2, 'provider appears only in title and product link');
});

test('compact small, zero, unknown, no data and partial retain distinct numeric states', () => {
  const artifact = buildApiHeatmapArtifact({
    '2026-10-09': { codex: day(.001) },
    '2026-10-10': { codex: day(0) },
    '2026-10-11': { codex: day(null, 'unpriced') },
    '2026-10-12': { codex: day(1.6, 'partial') },
  }, options);
  assert.match(cell(artifact.svg, '2026-10-09'), /&lt;\$1/);
  assert.doesNotMatch(cell(artifact.svg, '2026-10-09'), /\$0/);
  assert.match(cell(artifact.svg, '2026-10-10'), /\$0/);
  assert.equal(fill(artifact.svg, '2026-10-10'), '#ebedf0');
  assert.match(cell(artifact.svg, '2026-10-11'), /Unpriced/);
  assert.doesNotMatch(cell(artifact.svg, '2026-10-11'), /\$0/);
  assert.match(cell(artifact.svg, '2026-10-12'), /Priced subtotal \$2 · Coverage/);
  assert.doesNotMatch(cell(artifact.svg, '2026-10-12'), /\$2\+|stroke/);
  for (const date of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) {
    assert.doesNotMatch(cell(artifact.svg, date), /stroke/);
  }
  assert.match(cell(artifact.svg, '2026-10-13'), /No data/);
  assert.doesNotMatch(artifact.svg, /≥\$2/);
  for (const daily of [{}, { '2026-10-13': { codex: day(null, 'unpriced') } }] as ApiHeatmapDaily[]) {
    const unknown = buildApiHeatmapArtifact(daily, options);
    assert.match(text(unknown.svg), /— API equivalent · Codex/);
    assert.doesNotMatch(text(unknown.svg), /\$0|No data|Unpriced/);
    assert.match(unknown.svg, /No data|Unpriced/);
  }
  assert.match(text(buildApiHeatmapArtifact({ '2026-10-13': { codex: day(0) } }, options).svg), /\$0 API/);
  assert.doesNotMatch(text(buildApiHeatmapArtifact({ '2026-10-13': { codex: day(0) } }, options).svg), /\$0\+/);
});

test('compact quality stays in descriptions and tooltips without visible labels or amount suffixes', () => {
  const incomplete = buildApiHeatmapArtifact({ '2026-10-13': { codex: day(3, 'complete', false) } }, options);
  assert.match(text(incomplete.svg), /\$3 API/);
  assert.match(incomplete.svg, /Indexed subtotal; source history incomplete/);
  assert.doesNotMatch(text(incomplete.svg), /priced|Coverage|%|\$3\+|UTC/);
  assert.doesNotMatch(incomplete.summary + incomplete.markdown + incomplete.svg, /\$3\+|≥\$3/);
  const tinyTail = buildApiHeatmapArtifact({ '2026-10-13': { codex: { ...day(3, 'partial'), pricedCount: 9999, unpricedCount: 1 } } }, options);
  assert.doesNotMatch(text(tinyTail.svg), /priced|Coverage|%|\$3\+/);
  assert.match(tinyTail.svg, /9999\/10000/);
  assert.match(tinyTail.svg, /Priced subtotal \$3/);
  assert.doesNotMatch(tinyTail.svg, /stroke-dasharray|outline: no data|dashed: partial/);
});

test('all eight locales and currencies format integers after existing local conversion', () => {
  for (const locale of Object.keys(API_HEATMAP_COPY)) for (const currency of ['USD', 'EUR', 'JPY', 'CNY', 'KRW', 'IDR']) {
    const preference = resolveCurrencyDisplay(currency);
    const artifact = buildApiHeatmapArtifact({ '2026-10-13': { codex: day(1234.56) } }, { ...options, locale, currency });
    const expected = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(1234.56 * preference.unitsPerUsd);
    assert.ok(artifact.svg.includes(expected), `${locale}/${currency}: integer grouping`);
    const tiny = buildApiHeatmapArtifact({ '2026-10-13': { codex: day(.1 / preference.unitsPerUsd) } }, { ...options, locale, currency });
    assert.match(tiny.svg, /&lt;/);
    assert.ok(tiny.svg.includes(API_HEATMAP_COPY[locale as keyof typeof API_HEATMAP_COPY].notBill));
  }
});

test('shared renderer offers exact peak-relative boundaries without changing existing intensity modes', () => {
  const values = [0, 5, 5.01, 15, 15.01, 35, 35.01, 65, 65.01, 100];
  const usage = Object.fromEntries(values.map((cost, index) => [`2026-10-${String(index + 1).padStart(2, '0')}`, { tokens: 1, cost, sessions: 0 }]));
  const scale = COMBINED_ACTIVITY_PALETTES.academicViolet;
  const svg = renderHeatmapSvg(usage, { startDateISO: '2026-10-01', endDateISO: '2026-10-10', metric: 'cost',
    scale, intensityMode: 'peakRelative', tooltip: date => date });
  assert.deepEqual(values.map((_, index) => fill(svg, `2026-10-${String(index + 1).padStart(2, '0')}`)),
    [0, 1, 2, 2, 3, 3, 4, 4, 5, 5].map(bucket => scale[bucket]));
});

test('all palettes share numeric bands and custom accents preserve contrast and identity', () => {
  const daily = { '2026-10-12': { codex: day(15) }, '2026-10-13': { codex: day(100) } };
  const keys = new Set<string>();
  for (const palette of ['academicViolet', 'claudeOrange', 'codexBlue', 'githubGreen', 'custom'] as const) {
    const artifact = buildApiHeatmapArtifact(daily, { ...options, palette, customAccent: '#ffffff' });
    const scale = palette === 'custom' ? customCombinedHeatmapScale('#ffffff') : COMBINED_ACTIVITY_PALETTES[palette];
    assert.equal(fill(artifact.svg, '2026-10-12'), scale[2]);
    assert.equal(fill(artifact.svg, '2026-10-13'), scale[5]);
    assert.match(text(artifact.svg), /\$115 API/);
    keys.add(artifact.cacheKey);
    assert.equal(artifact.svg, buildApiHeatmapArtifact(daily, artifact.config).svg);
  }
  assert.equal(keys.size, 5);
});

test('compact presentation is allowlisted, canonical and inert when amounts are hidden', () => {
  const normal = normalizeApiHeatmapConfig({ ...options, presentation: 'other' as never });
  assert.equal(normal.presentation, 'standard');
  const compact = normalizeApiHeatmapConfig(options);
  assert.deepEqual(compact, normalizeApiHeatmapConfig(compact));
  const protectedDay = { tokens: 12 };
  for (const name of ['amountUSD', 'pricingStatus', 'estimated', 'pricedCount', 'unpricedCount', 'sourceComplete']) {
    Object.defineProperty(protectedDay, name, { get() { throw new Error(`Forbidden pricing read: ${name}`); } });
  }
  const hiddenOptions = { ...options, hideAmounts: true };
  const hidden = buildApiHeatmapArtifact({ '2026-10-13': { codex: protectedDay as ApiHeatmapDailyUsage } }, hiddenOptions);
  assert.equal(hidden.config.presentation, 'standard');
  assert.doesNotMatch(hidden.svg + hidden.summary + hidden.markdown, /API equivalent|priced|\$|Current pricing/);
  const daily = { '2026-10-13': { codex: day(3) } };
  const full = buildApiHeatmapArtifact(daily, options);
  assert.notEqual(full.cacheKey, buildApiHeatmapArtifact(daily, { ...options, presentation: 'standard' }).cacheKey);
  assert.notEqual(full.cacheKey, buildApiHeatmapArtifact(daily, { ...options, palette: 'githubGreen' }).cacheKey);
});

test('compact two-provider output retains separate amounts and private extras are never serialized', () => {
  const daily = { '2026-10-13': { claude: day(12), codex: day(34) } };
  Object.defineProperty(daily['2026-10-13'].codex, 'privateId', { get() { throw new Error('private'); } });
  const artifact = buildApiHeatmapArtifact(daily, { ...options, provider: 'both' });
  assert.match(artifact.svg, /data-provider="claude"/);
  assert.match(artifact.svg, /data-provider="codex"/);
  assert.match(text(artifact.svg), /\$12 API.*Claude/);
  assert.match(text(artifact.svg), /\$34 API.*Codex/);
  assert.doesNotMatch(artifact.svg + artifact.markdown, /\$46|privateId/);
});
