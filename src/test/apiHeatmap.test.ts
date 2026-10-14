import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ApiHeatmapDaily,
  ApiHeatmapOptions,
  buildApiHeatmapArtifact,
  normalizeApiHeatmapConfig,
  renderApiHeatmapSvg,
} from '../apiHeatmap';
import { API_HEATMAP_COPY } from '../apiHeatmapCopy';
import {
  CombinedHeatmapSvgOptions, COMBINED_ACTIVITY_PALETTES,
  customCombinedHeatmapScale, normalizeCombinedHeatmapAccent, renderCombinedHeatmapSvg,
} from '../combinedHeatmapSvg';
import { formatUsdForDisplay } from '../currencyDisplay';
import { dayKeyInZone, resolveTimeZone } from '../dateKeys';
import { HEATMAP_ARTIFACT_TRANSLATIONS, I18n } from '../i18n';

const options: ApiHeatmapOptions = {
  endDateISO: '2026-06-30', range: '30d', provider: 'both',
  metric: 'apiEquivalent', showAmounts: true, timezone: 'Asia/Shanghai',
};
const day = (tokens: number, amountUSD: number | null, pricingStatus: 'empty' | 'unpriced' | 'partial' | 'complete' = 'complete') => ({
  tokens, amountUSD, pricingStatus, estimated: false,
  pricedCount: pricingStatus === 'unpriced' || pricingStatus === 'empty' ? 0 : 2,
  unpricedCount: pricingStatus === 'unpriced' || pricingStatus === 'partial' ? 1 : 0,
});

test('normalization is explicit, bounded and idempotent; hiding retires amount configuration', () => {
  const config = normalizeApiHeatmapConfig({ ...options, hideAmounts: true, provider: 'bogus',
    range: 'forever', locale: 'secret', currency: 'secret', timezone: '/Users/secret',
    dataRevision: Infinity, pricingRevision: -1 } as unknown as ApiHeatmapOptions);
  assert.equal(config.provider, 'both');
  assert.equal(config.metric, 'tokens');
  assert.equal(config.showAmounts, false);
  assert.equal(config.range, 'year');
  assert.equal(config.locale, 'en');
  assert.equal(config.currency, 'USD');
  assert.equal(config.timezone, 'UTC');
  assert.equal(config.dataRevision, 0);
  assert.equal(config.pricingRevision, 0);
  assert.deepEqual(normalizeApiHeatmapConfig(config), config);
  assert.equal(normalizeApiHeatmapConfig({ endDateISO: options.endDateISO }).metric, 'tokens');
  assert.throws(() => normalizeApiHeatmapConfig({ endDateISO: '2026-02-30' }));
});

test('hidden and Token mode never access any money/quality getter on selected input', () => {
  const protectedDay = { tokens: 12345 };
  for (const key of ['amountUSD', 'pricingStatus', 'estimated', 'pricedCount', 'unpricedCount', 'sourceId', 'path', 'account']) {
    Object.defineProperty(protectedDay, key, { enumerable: true, get() { throw new Error(`read ${key}`); } });
  }
  const daily = { '2026-06-30': { claude: protectedDay, codex: protectedDay } } as unknown as ApiHeatmapDaily;
  for (const override of [{ showAmounts: false }, { hideAmounts: true }, { metric: 'tokens' as const }]) {
    const artifact = buildApiHeatmapArtifact(daily, { ...options, ...override });
    assert.equal(artifact.config.metric, 'tokens');
    assert.doesNotMatch(JSON.stringify(artifact), /amountUSD|pricingStatus|pricedCount|estimated|\$/);
  }
});

test('hidden output and data signatures are insensitive to secret amount and quality changes', () => {
  const left = { '2026-06-30': { claude: day(100, 918273.61), codex: day(200, null, 'unpriced') } };
  const right = { '2026-06-30': { claude: { ...day(100, 0), estimated: true }, codex: day(200, 765432.19, 'partial') } };
  assert.deepEqual(buildApiHeatmapArtifact(left, { ...options, showAmounts: false }),
    buildApiHeatmapArtifact(right, { ...options, showAmounts: false }));
});

test('both amount mode has two independent blocks and no cross-provider amount total', () => {
  const daily = { '2026-06-30': { claude: { ...day(20, 12), estimated: true }, codex: day(30, 34) } };
  const artifact = buildApiHeatmapArtifact(daily, options);
  assert.equal((artifact.svg.match(/data-provider=/g) ?? []).length, 2);
  assert.match(artifact.svg, /data-provider="claude"/);
  assert.match(artifact.svg, /data-provider="codex"/);
  assert.match(artifact.summary, /Claude.*\$12\.00/);
  assert.match(artifact.summary, /Codex.*\$34\.00/);
  assert.doesNotMatch(artifact.svg + artifact.summary + artifact.markdown, /\$46\.00/);
  assert.match(artifact.svg, /Asia\/Shanghai/);
  assert.match(artifact.svg, /Estimated/);
  assert.match(artifact.svg, /Exact model pricing/);
  assert.match(artifact.svg, /Current pricing/);
  assert.equal(artifact.svg, renderApiHeatmapSvg(daily, options));
  assert.equal(artifact.svg, buildApiHeatmapArtifact(daily, options).svg);
});

test('unpriced, partial, true zero and no data have different styles and truthful titles', () => {
  const artifact = buildApiHeatmapArtifact({
    '2026-06-27': { claude: day(100, null, 'unpriced') },
    '2026-06-28': { claude: day(100, 2, 'partial') },
    '2026-06-29': { claude: { ...day(0, 0), pricedCount: 0 } },
  }, { ...options, provider: 'claude' });
  const rect = (date: string) => artifact.svg.match(new RegExp(`<rect[^>]*><title>${date}[^<]*<\\/title><\\/rect>`))?.[0] ?? '';
  assert.match(rect('2026-06-27'), /fill="#d1d5db"/);
  assert.match(rect('2026-06-27'), /Unpriced/);
  assert.doesNotMatch(rect('2026-06-27'), /\$0/);
  assert.match(rect('2026-06-28'), /Priced subtotal.*\$2\.00.*Coverage.*2\/3/);
  assert.match(rect('2026-06-28'), /stroke-dasharray="2 2"/);
  assert.match(rect('2026-06-29'), /fill="#ebedf0"/);
  assert.match(rect('2026-06-29'), /\$0\.00/);
  assert.match(rect('2026-06-30'), /fill="#f6f8fa"/);
  assert.match(rect('2026-06-30'), /No data/);
  assert.match(artifact.summary, /Priced subtotal.*\$2\.00.*Coverage.*2\/4/);
});

test('Codex rejects estimated, malformed, and inconsistent pricing as neutral missing', () => {
  for (const candidate of [
    { ...day(20, 9), estimated: true }, day(20, NaN), day(20, -1), day(20, Infinity),
    { ...day(20, 9), pricedCount: 0 }, { ...day(20, 9), unpricedCount: 1 }, day(20, 9, 'empty'),
  ]) {
    const artifact = buildApiHeatmapArtifact({ '2026-06-30': { codex: candidate } }, { ...options, provider: 'codex' });
    assert.match(artifact.svg, /fill="#d1d5db"/);
    assert.doesNotMatch(artifact.summary, /\$9\.00/);
    assert.match(artifact.summary, /Unpriced/);
  }
});

test('selection reads only in-range and selected-provider aggregates, never private extras', () => {
  const daily: ApiHeatmapDaily = { '2026-06-30': { claude: day(1, 3) } };
  Object.defineProperty(daily, '2020-01-01', { enumerable: true, get() { throw new Error('old data'); } });
  Object.defineProperty(daily['2026-06-30'], 'codex', { enumerable: true, get() { throw new Error('other provider'); } });
  Object.defineProperty(daily['2026-06-30']!.claude, 'personalConfig', { enumerable: true, get() { throw new Error('private'); } });
  const artifact = buildApiHeatmapArtifact(daily, { ...options, provider: 'claude' });
  assert.doesNotMatch(artifact.svg, /2020-01-01|personalConfig|sourceId|cacheKey|pricingRevision/);
  assert.match(artifact.summary, /\$3\.00/);
});

test('internal identity covers selection, FX, revisions and pricing quality without raw fields', () => {
  const daily = { '2026-06-30': { claude: day(12, 1), codex: day(13, 2) } };
  const baseline = buildApiHeatmapArtifact(daily, options);
  for (const change of [
    { provider: 'claude' as const }, { metric: 'tokens' as const }, { range: '90d' as const },
    { currency: 'EUR' }, { timezone: 'UTC' }, { locale: 'zh-CN' },
    { dataRevision: 1 }, { pricingRevision: 1 }, { claudeBackend: 'aws-bedrock-in-region' as const },
    { endDateISO: '2026-07-01' },
  ]) assert.notEqual(buildApiHeatmapArtifact(daily, { ...options, ...change }).cacheKey, baseline.cacheKey);
  const changed = { '2026-06-30': { claude: day(12, 1, 'partial'), codex: day(13, 2) } };
  assert.notEqual(buildApiHeatmapArtifact(changed, options).dataQualitySignature, baseline.dataQualitySignature);
  assert.match(baseline.cacheKey, /2026-09-09/);
});

test('built-in currency conversion is reused and does not change USD-based ranking', () => {
  const daily = { '2026-06-29': { claude: day(100, 1) }, '2026-06-30': { claude: day(20, 2) } };
  const usd = buildApiHeatmapArtifact(daily, { ...options, provider: 'claude' });
  const eur = buildApiHeatmapArtifact(daily, { ...options, provider: 'claude', currency: 'EUR' });
  assert.match(eur.summary, new RegExp(formatUsdForDisplay(3, 'EUR')));
  const fills = (svg: string) => [...svg.matchAll(/<rect[^>]*fill="([^"]+)"[^>]*><title>/g)].map(match => match[1]);
  assert.deepEqual(fills(usd.svg), fills(eur.svg));
});

test('both Token output retains the exact existing combined renderer contract', () => {
  const daily = { '2026-06-30': { claude: day(10, 999), codex: day(20, 123) } };
  const svg = renderApiHeatmapSvg(daily, { ...options, showAmounts: false });
  assert.equal(svg, renderCombinedHeatmapSvg({ '2026-06-30': {
    dateISO: '2026-06-30', claudeProcessed: 10, codexProcessed: 20, combinedProcessed: 30,
  } }, { range: '30d', endDateISO: '2026-06-30', locale: 'en' }));
});

test('all eight locales contain compact quality and semantics copy in SVG, summary and Markdown', () => {
  assert.equal(Object.keys(API_HEATMAP_COPY).length, 8);
  for (const [locale, copy] of Object.entries(API_HEATMAP_COPY)) {
    const artifact = buildApiHeatmapArtifact({ '2026-06-30': { claude: day(100, 2, 'partial') } },
      { ...options, provider: 'claude', locale });
    for (const surface of [artifact.svg, artifact.summary, artifact.markdown]) {
      assert.ok(surface.includes(copy.apiEquivalent), `${locale}: metric`);
      assert.ok(surface.includes(copy.subtotal), `${locale}: subtotal`);
      assert.ok(surface.includes(copy.coverage), `${locale}: coverage`);
    }
    assert.ok(artifact.svg.includes(copy.notBill));
  }
});

test('date/provider order does not affect canonical bytes; invalid numeric totals fail closed', () => {
  const a = { '2026-06-29': { codex: day(1, 2), claude: day(2, 1) }, '2026-06-30': { claude: day(3, 4) } };
  const b = { '2026-06-30': { claude: day(3, 4) }, '2026-06-29': { claude: day(2, 1), codex: day(1, 2) } };
  assert.deepEqual(buildApiHeatmapArtifact(a, options), buildApiHeatmapArtifact(b, options));
  assert.throws(() => renderApiHeatmapSvg({ '2026-06-30': { claude: day(Number.MAX_VALUE, 1) } }, options));
});

test('invalid pricing counts cannot silently become complete coverage', () => {
  for (const provider of ['claude', 'codex'] as const) {
    for (const counts of [{ unpricedCount: NaN }, { unpricedCount: -1 }, { pricedCount: 2.5 }]) {
      const artifact = buildApiHeatmapArtifact({ '2026-06-30': { [provider]: { ...day(20, 7), ...counts } } },
        { ...options, provider });
      assert.match(artifact.summary, /Unpriced/);
      assert.doesNotMatch(artifact.svg, /\$7\.00|100%/);
    }
  }
});

test('small positive money stays distinct from true zero; wholly empty and unpriced ranges show no fake total', () => {
  const tiny = buildApiHeatmapArtifact({ '2026-06-30': { claude: day(1, 0.00001) } }, { ...options, provider: 'claude' });
  assert.match(tiny.summary, /<\$0\.01/);
  assert.match(tiny.svg, /&lt;\$0\.01/);
  assert.doesNotMatch(tiny.summary, /\$0\.00/);
  const empty = buildApiHeatmapArtifact({}, { ...options, provider: 'claude' });
  assert.match(empty.summary, /No data/);
  assert.doesNotMatch(empty.svg, /\$0/);
  const unpriced = buildApiHeatmapArtifact({ '2026-06-30': { claude: day(20, null, 'unpriced') } }, { ...options, provider: 'claude' });
  assert.match(unpriced.summary, /Unpriced/);
  assert.doesNotMatch(unpriced.svg, /\$0/);
});

test('amount descriptions preserve literal dollars without SVG replacement-template expansion', () => {
  const artifact = buildApiHeatmapArtifact({ '2026-06-30': { claude: day(20, 12) } }, { ...options, provider: 'claude' });
  const description = /<desc>([\s\S]*?)<\/desc>/.exec(artifact.svg)![1];
  assert.match(description, /\$12\.00/);
  assert.doesNotMatch(description, /<svg|<rect|aria-label=/);
});

type ShareControls = Pick<CombinedHeatmapSvgOptions, 'title' | 'palette' | 'customAccent' | 'intensityMode'>;
const controlled = (controls: ShareControls, overrides: Partial<ApiHeatmapOptions> = {}): ApiHeatmapOptions & ShareControls =>
  ({ ...options, ...overrides, ...controls });
const cell = (svg: string, date: string): string =>
  svg.match(new RegExp(`<rect[^>]*><title>${date}[^<]*<\\/title><\\/rect>`))?.[0] ?? '';
const fill = (svg: string, date: string): string => /fill="([^"]+)"/.exec(cell(svg, date))?.[1] ?? '';

test('appearance controls normalize like the existing workbench and enter canonical cache identity', () => {
  const config = normalizeApiHeatmapConfig(controlled({
    title: '  My\n activity\u0000  ', palette: 'custom', customAccent: ' #ABCDEF ', intensityMode: 'logarithmic',
  }));
  assert.equal(Reflect.get(config, 'title'), 'My activity');
  assert.equal(Reflect.get(config, 'palette'), 'custom');
  assert.equal(Reflect.get(config, 'customAccent'), normalizeCombinedHeatmapAccent('#abcdef'));
  assert.equal(Reflect.get(config, 'intensityMode'), 'logarithmic');
  assert.deepEqual(normalizeApiHeatmapConfig(config), config);
  const defaults = normalizeApiHeatmapConfig(controlled({
    title: '\u0000 ', palette: 'injected', customAccent: 'url(secret)', intensityMode: 'injected',
  }));
  assert.equal(Reflect.get(defaults, 'title'), '');
  assert.equal(Reflect.get(defaults, 'palette'), 'academicViolet');
  assert.equal(Reflect.get(defaults, 'customAccent'), '#4f2f87');
  assert.equal(Reflect.get(defaults, 'intensityMode'), 'quantile');
  assert.equal(String(Reflect.get(normalizeApiHeatmapConfig(controlled({ title: 'x'.repeat(120) })), 'title')).length, 80);
  const daily = { '2026-06-30': { claude: day(10, 2), codex: day(20, 3) } };
  const baseline = buildApiHeatmapArtifact(daily, options);
  for (const controls of [
    { title: 'My activity' }, { palette: 'githubGreen' }, { customAccent: '#123456' }, { intensityMode: 'linear' },
  ]) assert.notEqual(buildApiHeatmapArtifact(daily, controlled(controls)).cacheKey, baseline.cacheKey);
  assert.equal(buildApiHeatmapArtifact(daily, controlled({ palette: 'custom', customAccent: ' #ABCDEF ' })).cacheKey,
    buildApiHeatmapArtifact(daily, controlled({ palette: 'custom', customAccent: '#abcdef' })).cacheKey);
});

test('both-provider Token controls exactly reuse combined SVG rendering for every palette and intensity', () => {
  const daily = {
    '2026-06-28': { claude: day(1, 99), codex: day(2, 99) },
    '2026-06-29': { claude: day(20, 99), codex: day(30, 99) },
    '2026-06-30': { claude: day(1000, 99), codex: day(2000, 99) },
  };
  const combined = Object.fromEntries(Object.entries(daily).map(([dateISO, usage]) => [dateISO, {
    dateISO, claudeProcessed: usage.claude.tokens, codexProcessed: usage.codex.tokens,
    combinedProcessed: usage.claude.tokens + usage.codex.tokens,
  }]));
  for (const palette of ['academicViolet', 'claudeOrange', 'codexBlue', 'githubGreen', 'custom']) {
    for (const intensityMode of ['quantile', 'linear', 'logarithmic']) {
      const controls = { title: 'My activity <&>', palette, customAccent: '#123456', intensityMode };
      const artifact = buildApiHeatmapArtifact(daily, controlled(controls, { showAmounts: false }));
      assert.equal(artifact.svg, renderCombinedHeatmapSvg(combined, {
        ...controls, range: '30d', endDateISO: options.endDateISO, locale: 'en',
      }), `${palette}/${intensityMode}`);
      assert.match(artifact.markdown, /My activity <&>/);
    }
  }
});

test('explicit normalized defaults retain exact old both-provider Token bytes in every locale', () => {
  const daily = { '2026-06-30': { claude: day(10, 99), codex: day(20, 99) } };
  for (const locale of Object.keys(API_HEATMAP_COPY)) {
    const expected = renderCombinedHeatmapSvg({ '2026-06-30': {
      dateISO: options.endDateISO, claudeProcessed: 10, codexProcessed: 20, combinedProcessed: 30,
    } }, { range: '30d', endDateISO: options.endDateISO, locale });
    assert.equal(buildApiHeatmapArtifact(daily, controlled({
      palette: 'academicViolet', customAccent: '#4f2f87', intensityMode: 'quantile',
    }, { showAmounts: false, locale })).svg, expected);
    assert.equal(buildApiHeatmapArtifact(daily, controlled({
      title: HEATMAP_ARTIFACT_TRANSLATIONS[locale as keyof typeof HEATMAP_ARTIFACT_TRANSLATIONS].combinedTitle,
      palette: 'academicViolet', customAccent: '#4f2f87', intensityMode: 'quantile',
    }, { showAmounts: false, locale })).svg, expected);
  }
});

test('amount and single-provider Token cells honor palettes, accents and intensity modes', () => {
  const daily = {
    '2026-06-28': { claude: day(1, 1), codex: day(1, 1) },
    '2026-06-29': { claude: day(30, 30), codex: day(30, 30) },
    '2026-06-30': { claude: day(1000, 1000), codex: day(1000, 1000) },
  };
  for (const provider of ['claude', 'codex', 'both'] as const) {
    for (const metric of ['tokens', 'apiEquivalent'] as const) {
      for (const palette of ['academicViolet', 'claudeOrange', 'codexBlue', 'githubGreen', 'custom'] as const) {
        const scale = palette === 'custom' ? customCombinedHeatmapScale('#123456') : COMBINED_ACTIVITY_PALETTES[palette];
        const artifacts = ['quantile', 'linear', 'logarithmic'].map(intensityMode =>
          buildApiHeatmapArtifact(daily, controlled({ title: 'My activity', palette, customAccent: '#123456', intensityMode },
            { provider, metric })));
        for (const artifact of artifacts) {
          assert.match(artifact.svg, /My activity/);
          assert.equal(fill(artifact.svg, '2026-06-30'), scale[5], `${provider}/${metric}/${palette}: maximum`);
          if (provider === 'both' && metric === 'apiEquivalent') {
            const codexBlock = artifact.svg.slice(artifact.svg.indexOf('<svg x="0"', artifact.svg.indexOf('<svg x="0"') + 1));
            assert.equal(fill(codexBlock, '2026-06-30'), scale[5], `${palette}: Codex block`);
          }
        }
        assert.equal(new Set(artifacts.map(artifact => fill(artifact.svg, '2026-06-29'))).size, 3,
          `${provider}/${metric}/${palette}: each intensity mode changes ordinary cells`);
      }
    }
  }
});

test('custom amount titles keep provider semantics, current-price evidence and missing styles in all eight locales', () => {
  const daily = {
    '2026-06-27': { claude: day(100, null, 'unpriced'), codex: day(100, null, 'unpriced') },
    '2026-06-28': { claude: { ...day(100, 2, 'partial'), estimated: true }, codex: day(100, 3, 'partial') },
    '2026-06-29': { claude: { ...day(0, 0), pricedCount: 0 }, codex: { ...day(0, 0), pricedCount: 0 } },
  };
  for (const [locale, copy] of Object.entries(API_HEATMAP_COPY)) {
    const artifact = buildApiHeatmapArtifact(daily, controlled({
      title: 'My [activity] <&>', palette: 'custom', customAccent: '#123456', intensityMode: 'logarithmic',
    }, { locale, currency: 'EUR', claudeBackend: 'aws-bedrock-in-region' }));
    assert.match(artifact.svg, /My \[activity\] &lt;&amp;&gt;/);
    assert.doesNotMatch(artifact.markdown, /\[activity\]/);
    assert.match(artifact.markdown, /My  activity  <&>/);
    for (const evidence of ['Claude', 'Codex', copy.apiEquivalent, copy.estimated, copy.exact,
      copy.subtotal, copy.coverage, copy.currentPricing, copy.notBill, copy.missingLegend, 'aws-bedrock-in-region', 'openai', 'FX 2026-09-09']) {
      assert.ok(artifact.svg.includes(evidence), `${locale}: ${evidence}`);
    }
    assert.match(cell(artifact.svg, '2026-06-27'), /fill="#d1d5db".*stroke="#6b7280"/);
    assert.match(cell(artifact.svg, '2026-06-28'), /stroke="#6b7280" stroke-dasharray="2 2"/);
    assert.equal(fill(artifact.svg, '2026-06-29'), '#ebedf0');
    assert.equal(fill(artifact.svg, '2026-06-30'), '#f6f8fa');
  }
});

test('styled hidden mode never reads money fields or unrelated option getters', () => {
  const protectedDay = { tokens: 10 };
  for (const key of ['amountUSD', 'pricingStatus', 'estimated', 'pricedCount', 'unpricedCount','sourceComplete']) {
    Object.defineProperty(protectedDay, key, { get() { throw new Error(`read ${key}`); } });
  }
  const config = controlled({ title: 'My activity', palette: 'custom', customAccent: '#123456', intensityMode: 'linear' },
    { hideAmounts: true });
  for (const key of ['labels', 'watermark', 'fxMultiplier', 'privateId']) {
    Object.defineProperty(config, key, { enumerable: true, get() { throw new Error(`read ${key}`); } });
  }
  const artifact = buildApiHeatmapArtifact({ '2026-06-30': { claude: protectedDay, codex: protectedDay } } as unknown as ApiHeatmapDaily, config);
  assert.match(artifact.svg, /My activity/);
  assert.match(artifact.svg, /#123456/);
  assert.doesNotMatch(JSON.stringify(artifact), /amountUSD|pricingStatus|pricedCount|estimated|fxMultiplier|privateId/);
});

test('incomplete source history labels known money as a lower bound and missing days as unknown', () => {
  const daily: any = {
    '2026-06-30': {claude:{tokens:100,amountUSD:10,pricingStatus:'complete',estimated:true,
      pricedCount:100,unpricedCount:0,sourceComplete:false}},
    '2026-06-29': {claude:{tokens:0,amountUSD:null,pricingStatus:'empty',estimated:true,
      pricedCount:0,unpricedCount:0,sourceComplete:false}},
  };
  const artifact=buildApiHeatmapArtifact(daily,{...options,provider:'claude'});
  assert.match(artifact.summary,/≥\$10/);
  assert.match(artifact.svg,/Indexed subtotal; source history incomplete/);
  const unknown=artifact.svg.match(/<rect[^>]+><title>2026-06-29[^<]*<\/title><\/rect>/)?.[0];
  assert.ok(unknown); assert.match(unknown,/#d1d5db/); assert.match(unknown,/Unpriced/);
  assert.doesNotMatch(unknown,/No data|0\/1/);
  daily['2026-06-30'].claude.sourceComplete=true;
  daily['2026-06-29'].claude.sourceComplete=true;
  assert.notEqual(buildApiHeatmapArtifact(daily,{...options,provider:'claude'}).cacheKey,artifact.cacheKey);
});

test('an unpriced zero-token observation does not invent one unit of unknown usage', () => {
  const artifact=buildApiHeatmapArtifact({'2026-06-30':{claude:{tokens:0,amountUSD:null,
    pricingStatus:'unpriced',estimated:true,pricedCount:0,unpricedCount:0}}},{...options,provider:'claude'});
  assert.match(artifact.summary,/0\/0/);
  assert.doesNotMatch(artifact.svg,/0\/1/);
});

test('fixed-offset labels follow runtime support; unsupported zones normalize to UTC', () => {
  for (const [zone, timestamp, expectedDay] of [
    ['+08:00', '2026-06-30T18:00:00Z', '2026-07-01'],
    ['+0530', '2026-06-30T20:00:00Z', '2026-07-01'],
    ['-03:30', '2026-06-30T02:00:00Z', '2026-06-29'],
  ]) {
    // Probe Intl independently: Node 20 rejects offset identifiers accepted by newer engines.
    let runtimeZone: string | undefined;
    try {
      runtimeZone = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
    } catch (error) {
      assert.ok(error instanceof RangeError);
    }
    assert.equal(I18n.isValidTimeZone(zone), runtimeZone !== undefined, `${zone}: app and runtime must agree`);
    const artifact = buildApiHeatmapArtifact({}, { ...options, timezone: zone, endDateISO: expectedDay });
    assert.equal(artifact.config.timezone, runtimeZone ?? 'UTC');
    if (runtimeZone !== undefined) {
      assert.equal(dayKeyInZone(new Date(timestamp), zone), expectedDay);
      assert.equal(artifact.config.timezone, resolveTimeZone(zone));
      assert.notEqual(artifact.config.timezone, 'UTC');
    } else {
      assert.equal(dayKeyInZone(new Date(timestamp), artifact.config.timezone), timestamp.slice(0, 10));
      assert.equal(artifact.config.timezone, 'UTC', 'unsupported input must not fall back to the system zone');
      assert.ok(!artifact.svg.includes(zone));
    }
    assert.equal(normalizeApiHeatmapConfig({ ...options, timezone: ` ${zone} ` }).timezone, runtimeZone ?? 'UTC');
    assert.ok(artifact.svg.includes(artifact.config.timezone));
    assert.deepEqual(normalizeApiHeatmapConfig(artifact.config), artifact.config);
  }
  // These IANA zones retain the +08:00 civil-day boundary on every supported runtime.
  for (const zone of ['Asia/Shanghai', 'Etc/GMT-8']) {
    assert.equal(I18n.isValidTimeZone(zone), true);
    assert.equal(dayKeyInZone(new Date('2026-06-30T18:00:00Z'), zone), '2026-07-01');
    assert.equal(normalizeApiHeatmapConfig({ ...options, timezone: zone }).timezone, resolveTimeZone(zone));
  }
  assert.equal(normalizeApiHeatmapConfig({ ...options, timezone: '' }).timezone, resolveTimeZone(''));
  for (const zone of ['+99:99', '+24:00', '+08:60', 'UTC+08:00', '<script>', '/Users/secret']) {
    assert.equal(I18n.isValidTimeZone(zone), false);
    assert.equal(normalizeApiHeatmapConfig({ ...options, timezone: zone }).timezone, 'UTC');
  }
});
