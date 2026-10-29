import { createRequire } from 'node:module';
import { test, expect } from './support/app.mjs';

const require = createRequire(import.meta.url);
const { buildApiHeatmapArtifact } = require('../../out/apiHeatmap.js');
const { addCalendarDays } = require('../../out/combinedHeatmap.js');
const { API_HEATMAP_COPY } = require('../../out/apiHeatmapCopy.js');
const { COMBINED_ACTIVITY_PALETTES, customCombinedHeatmapScale } = require('../../out/combinedHeatmapSvg.js');
const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
const providers = ['claude', 'codex'];
const widths = [320, 360, 843];
const endDateISO = '2026-07-20';
const options = { endDateISO, range: 'year', provider: 'claude', metric: 'apiEquivalent',
  showAmounts: true, presentation: 'compact', timezone: 'Asia/Shanghai', currency: 'USD' };
const usage = (amountUSD, status = 'complete') => ({ tokens: amountUSD === 0 ? 0 : 100,
  amountUSD, pricingStatus: status, estimated: false,
  pricedCount: status === 'unpriced' || status === 'empty' || amountUSD === 0 ? 0 : 2,
  unpricedCount: status === 'partial' || status === 'unpriced' ? 1 : 0 });

function yearDaily(provider) {
  const amounts = [0, 1, 10, 25, 50, 100];
  return Object.fromEntries(Array.from({ length: 366 }, (_, i) =>
    [addCalendarDays(endDateISO, i - 365), { [provider]: usage(amounts[i % amounts.length]) }]));
}

// Artifact-only browser inspection. This wrapper supplies a white canvas and
// one local scroller around canonical production SVG bytes; it has no product
// renderer, Sharing workspace controls, fake host protocol, or native claims.
async function mountArtifact(page, artifact, width) {
  await page.setViewportSize({ width, height: 300 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff;color:#24292f}
    #artifact{max-width:100%;overflow-x:auto;overflow-y:hidden}
    #artifact>svg{display:block;max-width:none;flex-shrink:0}
  </style></head><body><main id="artifact" tabindex="0" role="region" aria-label="Standalone SVG artifact layout check">${artifact.svg}</main></body></html>`);
  await expect(page.locator('#artifact > svg')).toBeVisible();
}

async function layoutContract(page) {
  return page.locator('#artifact > svg').evaluate(svg => {
    const scroller = svg.parentElement;
    const box = svg.viewBox.baseVal;
    const bounds = element => {
      const b = element.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height, end: b.x + b.width };
    };
    const title = svg.querySelector('[data-heatmap-title]');
    const footer = svg.querySelector('[data-heatmap-footer]');
    const promotion = svg.querySelector('[data-heatmap-promotion]');
    const text = [...svg.querySelectorAll('text')];
    return {
      width: svg.width.baseVal.value, height: svg.height.baseVal.value,
      viewport: window.innerWidth, pageWidth: document.documentElement.scrollWidth,
      scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
      background: svg.querySelector('rect').getAttribute('fill'),
      title: title && { text: title.textContent, ...bounds(title), size: Number(title.getAttribute('font-size')) },
      footer: footer && { text: footer.textContent, ...bounds(footer), size: Number(footer.getAttribute('font-size')) },
      promotion: promotion && { text: promotion.textContent, ...bounds(promotion),
        size: parseFloat(getComputedStyle(promotion.querySelector('text') || promotion).fontSize),
        href: promotion.getAttribute('href') || promotion.getAttribute('xlink:href') },
      outside: text.filter(element => {
        const b = bounds(element);
        return b.x < -0.5 || b.y < -0.5 || b.end > box.width + 0.5 || b.y + b.height > box.height + 0.5;
      }).map(element => element.textContent),
      lowerRow: text.filter(element => promotion && Math.abs(bounds(element).y - bounds(promotion).y) < 3)
        .map(element => ({ text: element.textContent, ...bounds(element) })).sort((a, b) => a.x - b.x),
    };
  });
}

async function expectLayout(page, width) {
  const geometry = await layoutContract(page);
  expect(geometry.width).toBe(843);
  expect(geometry.height).toBe(177);
  expect(geometry.background).toBe('#ffffff');
  expect(geometry.pageWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(width);
  expect(geometry.clientWidth).toBe(width);
  expect(geometry.scrollWidth).toBe(843);
  expect(geometry.outside, JSON.stringify(geometry)).toEqual([]);
  expect(geometry.title?.text).toMatch(/\S/);
  expect(geometry.title?.size).toBeGreaterThanOrEqual(14);
  if (geometry.footer) expect(geometry.footer.size).toBeGreaterThanOrEqual(10);
  expect(geometry.promotion?.text).toMatch(/\S/);
  expect(geometry.promotion?.size).toBeGreaterThanOrEqual(10);
  const url = new URL(geometry.promotion.href);
  expect(url.origin).toBe('https://marketplace.visualstudio.com');
  expect(url.pathname).toBe('/items');
  expect(url.searchParams.get('itemName')).toBe('growthjack.claude-code-usage');
  if (geometry.footer && geometry.footer.width > 0) {
    expect(Math.abs(geometry.footer.y - geometry.promotion.y)).toBeLessThanOrEqual(3);
    expect(geometry.promotion.x - geometry.footer.end).toBeGreaterThanOrEqual(4);
  }
  for (let i = 1; i < geometry.lowerRow.length; i++) {
    expect(geometry.lowerRow[i].x - geometry.lowerRow[i - 1].end,
      JSON.stringify(geometry.lowerRow)).toBeGreaterThanOrEqual(3);
  }
  return geometry;
}

async function expectCleanVisibleText(page, locale) {
  const copy = API_HEATMAP_COPY[locale];
  const visible = await page.locator('#artifact > svg text').allTextContents();
  for (const text of visible) {
    expect(text).not.toMatch(/%|Asia\/Shanghai/);
    for (const removed of [copy.coverage, copy.subtotal, copy.sourceIncomplete,
      copy.currentPricing, copy.missingLegend]) expect(text).not.toContain(removed);
  }
  await expect(page.locator('[data-heatmap-title]')).not.toContainText('+');
  const stroked = await page.locator('#artifact > svg rect').filter({ has: page.locator('title') })
    .evaluateAll(cells => cells.filter(cell => cell.hasAttribute('stroke') || cell.hasAttribute('stroke-dasharray'))
      .map(cell => cell.querySelector('title').textContent));
  expect(stroked).toEqual([]);
}

async function screenshot(page, testInfo, name, full = false) {
  const image = await page.locator(full ? '#artifact > svg' : '#artifact')
    .screenshot({ path: testInfo.outputPath(name), animations: 'disabled' });
  await testInfo.attach(`Standalone compact SVG artifact: ${name}`, { body: image, contentType: 'image/png' });
}

const external = new WeakMap();
test.beforeEach(async ({ page }) => {
  const requests = [];
  external.set(page, requests);
  await page.route('**/*', route => {
    requests.push(route.request().url());
    return route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(external.get(page)).toEqual([]);
});

for (const locale of locales) {
  for (const provider of providers) {
    test(`compact SVG artifact layout only: ${locale} ${provider}, year and 320/360/843px`, async ({ page }, testInfo) => {
      const artifact = buildApiHeatmapArtifact(yearDaily(provider), { ...options, locale, provider });
      for (const width of widths) {
        await mountArtifact(page, artifact, width);
        const geometry = await expectLayout(page, width);
        expect(geometry.title.text).toContain(provider === 'claude' ? 'Claude' : 'Codex');
        expect(artifact.svg).toContain(API_HEATMAP_COPY[locale].notBill);
        // Compact SVGs contain a real promotional link, so their root must
        // expose a labelled group rather than hiding descendants in an image.
        await expect(page.locator('#artifact > svg')).toHaveAttribute('role', 'group');
        await expect(page.getByRole('link', { name:API_HEATMAP_COPY[locale].promotion, exact:true })).toHaveCount(1);
        await expect(page.locator('#artifact > svg')).toHaveAttribute('aria-label', /\S/);
        await expect(page.locator('#artifact > svg > desc')).toContainText(API_HEATMAP_COPY[locale].apiEquivalent);
        await expect(page.locator('#artifact > svg rect > title')).toHaveCount(366);
        await expectCleanVisibleText(page, locale);
        await screenshot(page, testInfo, `compact-artifact-${provider}-${locale}-${width}.png`, width === 843);
        if (width < 843) {
          const scroller = page.locator('#artifact');
          await scroller.focus();
          await expect(scroller).toBeFocused();
          // This is a wrapper layout check, not a product keyboard contract.
          await scroller.evaluate(element => { element.scrollLeft = 120; });
          expect(await scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
        }
      }
    });
  }
}

for (const palette of [...Object.keys(COMBINED_ACTIVITY_PALETTES), 'custom']) {
  test(`compact SVG artifact peak-relative palette: ${palette}`, async ({ page }, testInfo) => {
    const customAccent = '#285c4a';
    const scale = palette === 'custom' ? customCombinedHeatmapScale(customAccent) : COMBINED_ACTIVITY_PALETTES[palette];
    const artifact = buildApiHeatmapArtifact(yearDaily('claude'), { ...options, palette, customAccent });
    await mountArtifact(page, artifact, 843);
    await expectLayout(page, 843);
    const cells = page.locator('#artifact > svg rect').filter({ has: page.locator('title') });
    const fills = await cells.evaluateAll(elements => [...new Set(elements.map(element => element.getAttribute('fill')))]);
    expect(fills.sort()).toEqual([...scale].sort());
    const bucket = amount => cells.filter({ has: page.locator('title', { hasText: ` · $${amount} · ` }) }).first();
    for (const [i, amount] of [1, 10, 25, 50, 100].entries()) await expect(bucket(amount)).toHaveAttribute('fill', scale[i + 1]);
    await screenshot(page, testInfo, `compact-artifact-palette-${palette}.png`, true);
  });
}

test('compact artifact keeps subunit, partial, unpriced, zero and no-data semantics distinct', async ({ page }, testInfo) => {
  const daily = {
    '2026-07-15': { claude: usage(0.4) },
    '2026-07-16': { claude: usage(null, 'unpriced') },
    '2026-07-17': { claude: usage(2.4, 'partial') },
    '2026-07-18': { claude: usage(0) },
  };
  const artifact = buildApiHeatmapArtifact(daily, options);
  await mountArtifact(page, artifact, 843);
  const geometry = await expectLayout(page, 843);
  expect(geometry.title.text).not.toContain('+');
  expect(geometry.title.text).not.toMatch(/≥|\$\d+\.\d/);
  const cell = date => page.locator('#artifact > svg rect').filter({ has: page.locator('title', { hasText: date }) });
  await expect(cell('2026-07-15')).toContainText('<$1');
  await expect(cell('2026-07-16')).toContainText('Unpriced');
  await expect(cell('2026-07-16')).not.toContainText('$0');
  await expect(cell('2026-07-17')).toContainText('Priced subtotal $2');
  await expect(cell('2026-07-17')).toContainText('Coverage 2/3');
  await expect(cell('2026-07-17')).not.toHaveAttribute('stroke-dasharray', /.+/);
  await expect(cell('2026-07-17')).not.toHaveAttribute('stroke', /.+/);
  await expect(cell('2026-07-18')).toContainText(' · $0 · ');
  await expect(cell('2026-07-19')).toContainText('No data');
  await expect(cell('2026-07-19')).not.toContainText('$0');
  // Clean visible cells may share the neutral intensity fill; their internal
  // tooltip/description semantics must still distinguish zero and missing use.
  await expect(page.locator('#artifact > svg > desc')).toContainText('Priced subtotal $3');
  await expectCleanVisibleText(page, 'en');
  await screenshot(page, testInfo, 'compact-artifact-quality.png', true);

  for (const [name, data] of [
    ['subunit', { [endDateISO]: { claude: usage(0.4) } }],
    ['no-data', {}],
    ['unpriced', { [endDateISO]: { claude: usage(null, 'unpriced') } }],
    ['zero', { [endDateISO]: { claude: usage(0) } }],
  ]) {
    await mountArtifact(page, buildApiHeatmapArtifact(data, options), 843);
    await expectLayout(page, 843);
    const title = page.locator('[data-heatmap-title]');
    if (name === 'subunit') {
      await expect(title).toContainText('<');
      await expect(title).not.toContainText('$0');
    } else if (name === 'zero') {
      await expect(title).toContainText('$0');
    } else {
      await expect(title).toContainText('—');
      await expect(title).not.toContainText('$0');
      const state = name === 'unpriced' ? 'Unpriced' : 'No data';
      await expect(page.locator('#artifact > svg > desc')).toContainText(state);
    }
    await screenshot(page, testInfo, `compact-artifact-${name}.png`, true);
  }
});

test('compact artifact large amounts and long headings fit without changing detailed default', async ({ page }, testInfo) => {
  const daily = { [endDateISO]: { claude: usage(1_234_567_890.75) } };
  const defaultArtifact = buildApiHeatmapArtifact(daily, { ...options, presentation: undefined });
  expect(defaultArtifact.svg).toBe(buildApiHeatmapArtifact(daily, { ...options, presentation: 'standard' }).svg);
  for (const locale of ['en', 'de-DE', 'zh-CN', 'ko']) {
    const artifact = buildApiHeatmapArtifact(daily, { ...options, locale,
      title: 'Very long artifact title: '.repeat(8) });
    expect(artifact.svg).not.toBe(defaultArtifact.svg);
    await mountArtifact(page, artifact, 843);
    const geometry = await expectLayout(page, 843);
    expect(geometry.title.text).toMatch(/\d/);
    await expect(page.locator('#artifact > svg > desc')).toContainText(API_HEATMAP_COPY[locale].notBill);
    await screenshot(page, testInfo, `compact-artifact-large-${locale}.png`, true);
  }
});

test('compact artifact localized quality layouts retain rounded-subtotal and missing semantics', async ({ page }, testInfo) => {
  const partialDaily = { [endDateISO]: { claude: usage(2.4, 'partial') } };
  for (const locale of locales) {
    const copy = API_HEATMAP_COPY[locale];
    const partial = buildApiHeatmapArtifact(partialDaily, { ...options, locale });
    await mountArtifact(page, partial, 843);
    const geometry = await expectLayout(page, 843);
    expect(geometry.title.text).not.toContain('+');
    expect(geometry.title.text).not.toContain('≥');
    await expectCleanVisibleText(page, locale);
    await expect(page.locator('#artifact > svg > desc')).toContainText(copy.subtotal);
    await expect(page.locator('#artifact > svg > desc')).toContainText('2/3');
    await expect(page.locator('#artifact > svg > desc')).toContainText(copy.notBill);
    await screenshot(page, testInfo, `compact-artifact-partial-${locale}.png`, true);
    for (const [name, daily] of [
      ['subunit', { [endDateISO]: { claude: usage(0.4) } }],
      ['no-data', {}],
      ['unpriced', { [endDateISO]: { claude: usage(null, 'unpriced') } }],
      ['zero', { [endDateISO]: { claude: usage(0) } }],
    ]) {
      const artifact = buildApiHeatmapArtifact(daily, { ...options, locale });
      await mountArtifact(page, artifact, 843);
      await expectLayout(page, 843);
      const title = page.locator('[data-heatmap-title]');
      await expectCleanVisibleText(page, locale);
      if (name === 'subunit') await expect(title).toContainText('<');
      else if (name === 'zero') await expect(title).toContainText('$0');
      else {
        await expect(title).toContainText('—');
        await expect(title).not.toContainText('$0');
        const state = name === 'unpriced' ? copy.unpriced : copy.noData;
        await expect(page.locator('#artifact > svg > desc')).toContainText(state);
        expect(await page.locator('#artifact > svg').getAttribute('aria-label')).toContain(state);
      }
      await screenshot(page, testInfo, `compact-artifact-${name}-${locale}.png`, true);
    }
  }
});
