import { test, expect, openClaude, openCodex, openCompare } from './support/app.mjs';

// Runtime variables provided by VS Code's webview/theme bridge. Keeping this
// independent from the harness prevents an invented variable from being added
// to both sides of the test and turning a real transparent-style bug green.
const REGISTERED_VSCODE_VARIABLES = new Set([
  '--vscode-badge-background', '--vscode-badge-foreground',
  '--vscode-button-background', '--vscode-button-foreground', '--vscode-button-hoverBackground',
  '--vscode-button-secondaryBackground', '--vscode-button-secondaryForeground',
  '--vscode-button-secondaryHoverBackground', '--vscode-charts-blue', '--vscode-charts-foreground',
  '--vscode-charts-green', '--vscode-charts-lines', '--vscode-charts-orange', '--vscode-charts-purple',
  '--vscode-charts-red', '--vscode-charts-yellow', '--vscode-descriptionForeground',
  '--vscode-dropdown-background', '--vscode-dropdown-border', '--vscode-dropdown-foreground',
  '--vscode-editor-background', '--vscode-editor-font-family', '--vscode-editorWidget-background',
  '--vscode-errorForeground', '--vscode-focusBorder', '--vscode-font-family', '--vscode-font-size',
  '--vscode-foreground', '--vscode-input-background', '--vscode-input-border', '--vscode-input-foreground',
  '--vscode-inputValidation-warningBackground', '--vscode-inputValidation-warningBorder',
  '--vscode-list-hoverBackground', '--vscode-panel-border', '--vscode-progressBar-background',
  '--vscode-symbolIcon-functionForeground', '--vscode-testing-iconPassed',
  '--vscode-textBlockQuote-background', '--vscode-textBlockQuote-border',
  '--vscode-textCodeBlock-background', '--vscode-textLink-foreground', '--vscode-toolbar-hoverBackground',
]);

const SHARED_VISUAL_TOKENS = [
  '--ccu-space-1',
  '--ccu-space-2',
  '--ccu-space-3',
  '--ccu-space-4',
  '--ccu-space-5',
  '--ccu-space-6',
  '--ccu-radius-control',
  '--ccu-radius-panel',
  '--ccu-border',
  '--ccu-surface-raised',
  '--ccu-surface-subtle',
  '--ccu-data-font',
  '--ccu-focus',
];

async function computedContract(locator, properties, rectangleProperties = []) {
  await expect(locator).toBeVisible();
  return locator.evaluate((element, contract) => {
    const style = getComputedStyle(element);
    const rectangle = element.getBoundingClientRect();
    return {
      styles: Object.fromEntries(contract.properties.map((property) => [
        property,
        style.getPropertyValue(property).trim(),
      ])),
      geometry: Object.fromEntries(contract.rectangleProperties.map((property) => [
        property,
        Number(rectangle[property].toFixed(3)),
      ])),
    };
  }, { properties, rectangleProperties });
}

async function summaryCardContract(page) {
  const card = page.locator('#today .usage-summary .summary-grid .summary-item').first();
  return {
    card: await computedContract(card, [
      'display',
      'min-height',
      'flex-direction',
      'justify-content',
      'text-align',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'background-color',
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-radius',
    ], ['height']),
    value: await computedContract(card.locator('.value'), [
      'font-family',
      'font-size',
      'font-weight',
      'font-variant-numeric',
    ]),
  };
}

async function modelSurfaceContract(page) {
  const surface = page.locator('#today .model-breakdown details.model-item').first();
  return {
    surface: await computedContract(surface, [
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'background-color',
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-radius',
    ], ['width']),
    summary: await computedContract(surface.locator(':scope > summary'), [
      'display',
      'align-items',
      'gap',
      'margin-bottom',
      'cursor',
    ]),
    details: await computedContract(surface.locator(':scope > .model-details-stacked'), [
      'display',
      'flex-direction',
      'gap',
      'margin-top',
      'font-size',
      'color',
    ]),
  };
}

async function monthChartContract(page) {
  await page.locator('#tab-month').click();
  const panel = page.locator('#month .daily-breakdown:has(> .chart-tabs)').first();
  const tabs = panel.locator(':scope > .chart-tabs');
  return {
    tabs: await computedContract(tabs, [
      'display',
      'gap',
      'margin-bottom',
      'flex-wrap',
    ], ['width', 'height']),
    control: await computedContract(tabs.locator('.chart-tab').first(), [
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'font-size',
      'border-top-width',
      'border-top-style',
      'border-radius',
    ], ['height']),
    content: await computedContract(panel.locator(':scope > .chart-content'), [
      'display',
      'align-items',
      'justify-content',
      'width',
      'height',
    ], ['width', 'height']),
  };
}

async function keyboardFocusContract(locator) {
  await locator.focus();
  // A keyboard activation puts Chromium into :focus-visible modality without
  // depending on mouse history from selecting the containing dashboard tab.
  await locator.press('Space');
  await expect(locator).toBeFocused();
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
    };
  });
}

async function responsiveShellContract(page) {
  const grid = page.locator('#today .usage-summary .summary-grid').first();
  const card = grid.locator('.summary-item').first();
  const nav = page.locator('.tabs');
  const contract = await page.evaluate((tokens) => {
    const root = getComputedStyle(document.documentElement);
    return {
      tokens: Object.fromEntries(tokens.map((token) => [token, root.getPropertyValue(token).trim()])),
      bodyPadding: getComputedStyle(document.body).padding,
    };
  }, SHARED_VISUAL_TOKENS);
  return {
    ...contract,
    grid: await computedContract(grid, ['grid-template-columns', 'gap']),
    card: await computedContract(card, ['min-height', 'padding', 'border-radius']),
    value: await computedContract(card.locator('.value'), ['font-size', 'font-family']),
    navigation: await nav.evaluate((element) => {
      const style = getComputedStyle(element);
      const tabStyle = getComputedStyle(element.querySelector('.tab'));
      return {
        display: style.display,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: element.clientWidth,
        scrollable: element.scrollWidth > element.clientWidth,
        tabWhiteSpace: tabStyle.whiteSpace,
      };
    }),
  };
}

test('Codex uses the shared dashboard shell and tab vocabulary', async ({ page }) => {
  await openCodex(page);

  await expect(page.locator('.container > header')).toBeVisible();
  await expect(page.locator('.tabs > .tab')).toHaveText([
    'Today',
    'Last 30 days',
    'All time',
    'Sessions',
    'Projects',
    'Recommendations',
    'Settings',
  ]);
  await expect(page.locator('.tab-content.active')).toHaveAttribute('id', 'today');
  await expect(page.locator('#today .model-breakdown h3').filter({ hasText: 'Recent task' })).toBeVisible();
  await expect(page.locator('[class*="codex-"]')).toHaveCount(0);
});

test('Claude middle dashboard scope is labelled as a rolling 30-day range', async ({ page }) => {
  await openClaude(page);
  await expect(page.locator('#tab-month')).toHaveText('Last 30 days');
});

test('legacy share-card errors are rendered as text instead of executable HTML', async ({ page }) => {
  await openCompare(page, {
    fixture: 'combined-heatmap',
    commandTemplate: 'claudeShareCard',
  });
  await expect(page.locator('#scPreview')).toBeVisible();

  const hostileError = '<img src="missing" onerror="window.__shareCardErrorExecuted = true">';
  await page.evaluate((error) => {
    window.__shareCardErrorExecuted = false;
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'shareCardResult', error },
    }));
  }, hostileError);

  await expect(page.locator('#scPreview img')).toHaveCount(0);
  await expect(page.locator('#scPreview .table-hint')).toHaveText(
    `Could not build the card: ${hostileError}`,
  );
  expect(await page.evaluate(() => window.__shareCardErrorExecuted)).toBe(false);
});

test('Codex header matches Claude with only Refresh and Settings actions', async ({ page }) => {
  await openCodex(page);

  await expect(page.locator('.container > header .actions > button')).toHaveText([
    '↻ Refresh',
    '⚙ Settings',
  ]);
});

test('manual Refresh remains visible while dashboard auto-refresh is enabled', async ({ page }) => {
  await openCodex(page, { autoRefresh: true });

  await expect(page.locator('#refreshNowBtn')).toBeVisible();
});

test('Codex labels incomplete usage as an indexed subtotal', async ({ page }) => {
  await openCodex(page);

  await expect(page.locator('#today .usage-summary').first()).toContainText('Indexed subtotal');
  await page.locator('#tab-all').click();
  await expect(page.locator('#all .usage-summary').first()).toContainText('Indexed subtotal');
});

test('Codex summary leads with a clearly qualified API-equivalent cost', async ({ page }) => {
  await openCodex(page);

  const cards = page.locator('#today .usage-summary').first().locator('.summary-grid .summary-item');
  await expect(cards).toHaveCount(8);
  await expect(cards.first().locator('.label')).toHaveText('API-equivalent cost');
  await expect(cards.first().locator('.value')).toHaveText(/^\$[\d,.]+$/);
  await expect(cards.first()).toHaveAttribute(
    'title',
    /not a bill or subscription charge.*Priced model coverage: \d+%/,
  );
  await expect(cards.nth(1).locator('.label')).toHaveText('Processed');
  await expect(cards.nth(5).locator('.label')).toHaveText('Cache Hit Rate');
});

test('Codex model headlines use green API-equivalent prices while effort stays token-native', async ({ page }) => {
  await openCodex(page);

  const modelSection = page.locator('#today .model-breakdown', {
    has: page.getByRole('heading', { name: 'Models', exact: true }),
  });
  const modelSummary = modelSection.locator('summary').first();
  const modelPrice = modelSummary.locator('.model-cost');
  await expect(modelPrice).toHaveText(/^\$[\d,.]+$/);
  await expect(modelPrice).toHaveAttribute(
    'title',
    /not a bill or subscription charge.*Priced model coverage: 100%/,
  );
  await expect(modelSummary).not.toContainText('Uncached usage');
  const expectedGreen = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--vscode-charts-green)';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(await modelPrice.evaluate((element) => getComputedStyle(element).color)).toBe(expectedGreen);

  const effortSection = page.locator('#today .model-breakdown', {
    has: page.getByRole('heading', { name: 'Effort', exact: true }),
  });
  const effortSummary = effortSection.locator('summary').first();
  await expect(effortSummary.locator('.model-cost')).toHaveCount(0);
  await expect(effortSummary.locator('.model-metric')).toContainText('Uncached usage');
});

test('Codex shows an unpriced marker without hiding unknown-model token totals', async ({ page }) => {
  await openCodex(page, { fixture: 'unknown-models' });

  const cards = page.locator('#today .usage-summary').first().locator('.summary-grid .summary-item');
  const costCard = cards.first();
  const costValue = costCard.locator('.value');
  await expect(cards).toHaveCount(8);
  await expect(costValue).toHaveText('—');
  const costText = await costValue.textContent();
  expect(costText).toBe('—');
  expect(costText).not.toContain('$');
  await expect(costCard).toHaveAttribute('title', /Priced model coverage: 0%/);
  const modelSection = page.locator('#today .model-breakdown', {
    has: page.getByRole('heading', { name: 'Models', exact: true }),
  });
  await expect(modelSection.locator('summary .model-cost').first()).toHaveText('—');
  await expect(modelSection.locator('summary .model-cost').first()).toHaveAttribute(
    'title',
    /Priced model coverage: 0%/,
  );
  await expect(
    page.locator('#today [data-codex-today-hourly] .chart-content .hc-yaxis .hc-yval'),
  ).toHaveText(['—', '—', '—']);
  await expect(cards.locator('.value')).toHaveText([
    '—',
    '9,840',
    '5,340',
    '8,200',
    '4,500',
    '55%',
    '1,640',
    '530',
  ]);
});

test('Codex shows an undefined cache-hit rate when the selected scope has no input', async ({ page }) => {
  await openCodex(page, { fixture: 'zero-input' });

  const cards = page.locator('#today .usage-summary').first().locator('.summary-grid .summary-item');
  await expect(cards.nth(5).locator('.label')).toHaveText('Cache Hit Rate');
  await expect(cards.nth(5).locator('.value')).toHaveText('-');
});

test('Codex explains multi-sign-in usage and last-observed limits', async ({ page }) => {
  await openCodex(page);

  const limits = page.locator('#today .usage-summary').filter({ hasText: 'Usage limits' });
  await expect(limits).toContainText(
    'Usage combines sign-ins in this Codex home · limits are last observed, not combined',
  );
  await expect(limits).toContainText(/\d+% used · \d+% remaining/);
  await expect(limits).toContainText(/Last observed:/);
  await expect(limits).toContainText(/Resets:/);
});

test('Claude and Codex receive the exact same tokenized production stylesheet', async ({ page }) => {
  await openClaude(page);
  const claudeStyles = await page.locator('head style').first().textContent();

  await openCodex(page);
  const codexStyles = await page.locator('head style').first().textContent();

  expect(codexStyles).toBe(claudeStyles);
  for (const token of SHARED_VISUAL_TOKENS) {
    expect(codexStyles).toContain(`${token}:`);
  }
  expect(codexStyles).toContain('@media (max-width: 480px)');
  expect(codexStyles).toContain('@media (prefers-reduced-motion: reduce)');
});

test('Claude and Codex summary cards share geometry and use the VS Code UI font', async ({ page }) => {
  // Metric labels, values, semantics, and card counts intentionally remain
  // provider-native; this samples one representative card from each shell.
  await openClaude(page);
  const claude = await summaryCardContract(page);

  await openCodex(page);
  const codex = await summaryCardContract(page);

  expect(codex).toEqual(claude);
  expect(codex.card.styles).toMatchObject({
    display: 'flex',
    'min-height': '68px',
    'flex-direction': 'column',
    'justify-content': 'center',
    'text-align': 'left',
    'padding-top': '12px',
    'padding-bottom': '12px',
    'border-top-width': '1px',
    'border-top-style': 'solid',
    'border-radius': '8px',
  });
  expect(codex.value.styles['font-variant-numeric']).toContain('tabular-nums');
  const bodyFont = await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
  expect(codex.value.styles['font-family']).toBe(bodyFont);
});

test('Claude and Codex model details share surface and disclosure contracts', async ({ page }) => {
  // The expanded bodies contain different fields and therefore may have
  // different heights. Surface width and computed component styles are the
  // shared contract; row counts and metric equality are deliberately absent.
  await openClaude(page);
  const claude = await modelSurfaceContract(page);

  await openCodex(page);
  const codex = await modelSurfaceContract(page);

  expect(codex).toEqual(claude);
  expect(codex.surface.styles).toMatchObject({
    'padding-top': '12px',
    'padding-right': '12px',
    'padding-bottom': '12px',
    'padding-left': '12px',
    'border-top-width': '1px',
    'border-top-style': 'solid',
    'border-radius': '6px',
  });
  expect(codex.summary.styles).toMatchObject({
    display: 'flex',
    'align-items': 'center',
    gap: '8px',
    cursor: 'pointer',
  });
  expect(codex.details.styles).toMatchObject({
    display: 'flex',
    'flex-direction': 'column',
    gap: '4px',
  });
});

test('Claude and Codex chart controls and content share visual geometry', async ({ page }) => {
  // Control labels and available metrics are provider-specific. Width is
  // compared for the shared rows/content, while label-driven button width and
  // the overall panel height are intentionally outside this contract.
  await openClaude(page);
  const claude = await monthChartContract(page);

  await openCodex(page);
  const codex = await monthChartContract(page);

  expect(codex).toEqual(claude);
  expect(codex.tabs.styles).toMatchObject({
    display: 'flex',
    gap: '4px',
    'margin-bottom': '16px',
    'flex-wrap': 'wrap',
  });
  expect(codex.control.styles).toMatchObject({
    'padding-top': '6px',
    'padding-right': '12px',
    'padding-bottom': '6px',
    'padding-left': '12px',
    'font-size': '11px',
    'border-top-width': '1px',
    'border-top-style': 'solid',
    'border-radius': '4px',
  });
  expect(codex.content.styles).toMatchObject({
    display: 'flex',
    'align-items': 'end',
    'justify-content': 'center',
  });
});

test('Claude and Codex keyboard controls share the visible focus contract', async ({ page }) => {
  await openClaude(page);
  const claudeSummary = await keyboardFocusContract(
    page.locator('#today .model-breakdown details.model-item > summary').first(),
  );
  await page.locator('#tab-month').click();
  const claudeChart = await keyboardFocusContract(
    page.locator('#month .daily-breakdown:has(> .chart-tabs) > .chart-tabs .chart-tab').first(),
  );

  await openCodex(page);
  await page.locator('#tab-today').click();
  const codexSummary = await keyboardFocusContract(
    page.locator('#today .model-breakdown details.model-item > summary').first(),
  );
  await page.locator('#tab-month').click();
  const codexChart = await keyboardFocusContract(
    page.locator('#month .daily-breakdown:has(> .chart-tabs) > .chart-tabs .chart-tab').first(),
  );

  expect(codexSummary).toEqual(claudeSummary);
  expect(codexChart).toEqual(claudeChart);
  for (const focus of [codexSummary, codexChart]) {
    expect(focus).toMatchObject({
      focusVisible: true,
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineOffset: '2px',
    });
  }
  expect(codexSummary.outlineColor).toBe(codexChart.outlineColor);
});

test('Claude and Codex share the 360px responsive component contract', async ({ page }) => {
  await openClaude(page, { theme: 'dark', width: 360, height: 800 });
  const claude = await responsiveShellContract(page);

  await openCodex(page, { theme: 'dark', width: 360, height: 800 });
  const codex = await responsiveShellContract(page);

  expect(codex).toEqual(claude);
  expect(codex.bodyPadding).toBe('12px');
  expect(codex.grid.styles).toMatchObject({
    'grid-template-columns': '164px 164px',
    gap: '8px',
  });
  expect(codex.card.styles).toMatchObject({
    'min-height': '58px',
    padding: '10px 12px',
    'border-radius': '8px',
  });
  expect(codex.value.styles['font-size']).toBe('17px');
  expect(codex.navigation).toMatchObject({
    display: 'flex',
    overflowX: 'auto',
    overflowY: 'hidden',
    clientWidth: 336,
    scrollable: true,
    tabWhiteSpace: 'nowrap',
  });
  expect(codex.tokens).toMatchObject({
    '--ccu-space-2': '8px',
    '--ccu-space-3': '12px',
    '--ccu-space-4': '16px',
    '--ccu-radius-control': '4px',
    '--ccu-radius-panel': '8px',
  });
});

for (const theme of ['light', 'dark']) {
  test(`${theme} harness defines every VS Code variable used by the dashboard`, async ({ page }) => {
    await openClaude(page, { theme });

    const { referenced, defined } = await page.evaluate(() => {
      const productionCss = document.querySelector('head style:not(#test-vscode-theme)')?.textContent ?? '';
      const harnessCss = document.querySelector('#test-vscode-theme')?.textContent ?? '';
      const references = [];
      const pattern = /var\(\s*(--vscode-[\w-]+)/g;
      let match;
      while ((match = pattern.exec(productionCss)) !== null) {
        let depth = 1;
        let hasFallback = false;
        for (let index = pattern.lastIndex; index < productionCss.length; index += 1) {
          if (productionCss[index] === '(') depth += 1;
          if (productionCss[index] === ')') depth -= 1;
          if (productionCss[index] === ',' && depth === 1) hasFallback = true;
          if (depth === 0) break;
        }
        references.push({ name: match[1], hasFallback });
      }
      return {
        referenced: references,
        defined: [...new Set([...harnessCss.matchAll(/(--vscode-[\w-]+)\s*:/g)].map((match) => match[1]))],
      };
    });

    const referenceKinds = new Map();
    for (const { name, hasFallback } of referenced) {
      const kinds = referenceKinds.get(name) ?? new Set();
      kinds.add(hasFallback);
      referenceKinds.set(name, kinds);
    }
    const definedSet = new Set(defined);
    const missingWithoutFallback = [...referenceKinds]
      .filter(([name, kinds]) =>
        (REGISTERED_VSCODE_VARIABLES.has(name) && !definedSet.has(name)) ||
        (!REGISTERED_VSCODE_VARIABLES.has(name) && kinds.has(false)))
      .map(([name]) => name)
      .sort();
    const definedDespiteFallback = [...referenceKinds]
      .filter(([name, kinds]) =>
        !REGISTERED_VSCODE_VARIABLES.has(name) && kinds.has(true) && !kinds.has(false) && definedSet.has(name))
      .map(([name]) => name)
      .sort();

    const failureMessage = [
      `缺失(无回退): ${missingWithoutFallback.join(', ') || '无'}`,
      `不应定义(有回退): ${definedDespiteFallback.join(', ') || '无'}`,
    ].join('\n');
    expect(referenced.length).toBeGreaterThan(0);
    expect(
      { missingWithoutFallback, definedDespiteFallback },
      failureMessage,
    ).toEqual({ missingWithoutFallback: [], definedDespiteFallback: [] });
  });

  test(`${theme} composition fills are fully opaque`, async ({ page }) => {
    await openClaude(page, { theme });

    const fills = page.locator('.cost-comp-seg, .cost-comp-legend .legend-dot');
    expect(await fills.count()).toBeGreaterThan(0);
    const translucent = await fills.evaluateAll((elements) => elements.map((element) => {
      const background = getComputedStyle(element).backgroundColor;
      const rgba = background.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
      return {
        className: element.className,
        background,
        alpha: rgba ? Number(rgba[1]) : background === 'transparent' ? 0 : 1,
      };
    }).filter(({ alpha }) => alpha !== 1));

    expect(translucent).toEqual([]);
  });
}

test('Codex Today exposes hourly API-equivalent cost and token composition', async ({ page }) => {
  await openCodex(page);

  const overviewComposition = page.locator('#today .cost-composition').first();
  await expect(overviewComposition.locator('.cost-comp-head strong')).toHaveText(/^Uncached usage [\d,.]+(?:[KMB])?$/);
  await expect(overviewComposition.locator('.cost-comp-bar .cost-comp-seg')).toHaveCount(3);

  const hourly = page.locator('#today .daily-breakdown', {
    has: page.getByRole('heading', { name: 'Hourly Usage', exact: true }),
  });
  await expect(hourly).toBeVisible();
  await expect(hourly.locator('.chart-tab')).toHaveCount(6);
  await expect(hourly.locator('.chart-tab.active')).toHaveAttribute('data-metric', 'cost');
  await expect(hourly.locator('.chart-tab.active')).toHaveText('API-equivalent cost');

  const hourlyBars = hourly.locator('.hc-col[data-hour] .chart-bar[data-cost]');
  expect(await hourlyBars.count()).toBeGreaterThan(0);
  await expect(hourly.locator('.hc-yaxis .hc-yval').first()).toHaveText(/^\$/);
  await expect(hourly.locator('.composition-chart h4')).toHaveText('Token composition');
  expect(await hourly.locator('.composition-chart .hc-col').count()).toBeGreaterThan(0);

  const table = hourly.locator('.daily-table');
  await expect(table.locator('thead th').first()).toHaveText('Hour');
  await expect(table.locator(':scope > thead > tr > th').nth(1)).toHaveText('API-equivalent cost');
  await expect(table.locator(':scope > tbody > tr .cost-cell').first())
    .toHaveText(/^(?:\$[\d,.]+|—)$/);
});

test('Codex month chart defaults to API-equivalent cost and retains token switches', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-month').click();

  const chart = page.locator('#month [data-codex-last30-daily]');
  await expect(chart).toBeVisible();
  const tabs = chart.locator(':scope > .chart-tabs .chart-tab');
  const mainChart = chart.locator(':scope > .chart-content');
  const table = chart.locator(':scope > .daily-table-container > .daily-table');
  await expect(tabs).toHaveCount(6);
  await expect(chart.locator(':scope > .chart-tabs .chart-tab.active'))
    .toHaveAttribute('data-metric', 'cost');
  await expect(chart.locator(':scope > .chart-tabs .chart-tab.active')).toHaveText('API-equivalent cost');
  await expect(mainChart.locator('.chart-bar[data-cost]').first()).toBeVisible();
  await expect(mainChart.locator('.hc-yaxis .hc-yval').first()).toHaveText(/^\$/);
  await expect(table.locator(':scope > thead > tr > th').nth(1)).toHaveText('API-equivalent cost');
  await expect(table.locator(':scope > tbody > tr.daily-row .cost-cell').first())
    .toHaveText(/^(?:\$[\d,.]+|—)$/);

  await chart.locator(':scope > .chart-tabs .chart-tab[data-metric="outputTokens"]').click();
  await expect(chart.locator(':scope > .chart-tabs .chart-tab[data-metric="outputTokens"]')).toHaveClass(/active/);
  await chart.locator(':scope > .chart-tabs .chart-tab[data-metric="cost"]').click();
  await expect(chart.locator(':scope > .chart-tabs .chart-tab[data-metric="cost"]')).toHaveClass(/active/);
  await expect(mainChart.locator('.hc-barval').first()).toHaveText(/^(?:\$[\d,.]+|—)$/);
  await expect(mainChart.locator('.chart-bar[data-cost]').first()).toHaveAttribute(
    'title',
    /Priced model coverage:/,
  );
});

test('Codex all-time chart defaults to monthly API-equivalent cost and retains token switches', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-all').click();

  const chart = page.locator('#all .daily-breakdown', {
    has: page.getByRole('heading', { name: 'Monthly', exact: true }),
  });
  await expect(chart).toBeVisible();
  await expect(chart.locator('.chart-tab')).toHaveCount(6);
  await expect(chart.locator('.chart-tab.active')).toHaveAttribute('data-metric', 'cost');
  await expect(chart.locator('.chart-tab.active')).toHaveText('API-equivalent cost');
  await expect(chart.locator('.chart-bar[data-cost]').first()).toBeVisible();
  await expect(chart.locator('.daily-table thead th').nth(1)).toHaveText('API-equivalent cost');
  await expect(chart.locator('.daily-table tbody .cost-cell').first()).toHaveText(/^(?:\$[\d,.]+|—)$/);

  await chart.locator('.chart-tab[data-metric="inputTokens"]').click();
  await expect(chart.locator('.chart-tab[data-metric="inputTokens"]')).toHaveClass(/active/);
  await chart.locator('.chart-tab[data-metric="cost"]').click();
  await expect(chart.locator('.chart-tab[data-metric="cost"]')).toHaveClass(/active/);
});

test('weekly allowance value uses the shared all-time chart and exposes uncertainty', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-all').click();

  const panel = page.locator('#all .daily-breakdown').filter({
    hasText: 'Weekly subscription allowance · API-equivalent estimate · Codex',
  });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('not an official balance, bill, or cash value');
  await expect(panel).toContainText('Historical used equivalents come directly from local token logs');
  await expect(panel).toContainText('Full and unused estimates appear only for windows with a real quota-utilization observation');
  await expect(panel).toContainText('current window uses the latest real quota observation for a low-confidence blended durability estimate');
  await expect(panel).toContainText('ambiguous completed windows remain usage-only');
  await expect(panel).toContainText('No account split or official balance is invented');
  await expect(panel).toContainText('A reset inside a recorded day lowers confidence');
  const details = panel.locator('.weekly-value-details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.getByText('Period details', { exact: true })).toBeVisible();
  await expect(details.locator('.daily-table-container')).toBeHidden();
  await details.locator('summary').click();
  await expect(details.locator('.daily-table-container')).toBeVisible();
  await expect(panel.locator('tbody')).toContainText('Low · Boundary approx.');
  await expect(panel.locator('.hc-col')).toHaveCount(2);
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  await expect(panel.locator('thead')).toContainText('Full allowance est.');
  await expect(panel.locator('thead')).toContainText('Priced coverage');
  await expect(panel.locator('tbody')).toContainText('Current period');
  await expect(panel.locator('tbody')).toContainText('resets');
  await expect(panel.locator('tbody')).not.toContainText('In progress');
  await expect(panel.locator('tbody').getByText('Current period')).toHaveCount(1);

  const bars = panel.locator('.hc-col');
  await expect(bars.last().locator('.seg-cache-read')).toHaveCount(1);
  const currentRow = panel.locator('tbody tr').filter({ hasText: 'Current period' });
  await expect(currentRow.locator('td').nth(4)).not.toHaveText('—');
  await expect(currentRow.locator('td').nth(5)).toContainText('Low');
});

test('a completed observed Claude period can still show its unused segment', async ({ page }) => {
  await openClaude(page, { fixture: 'weekly-claude-completed' });
  await page.locator('#tab-all').click();

  const panel = page.locator('#all .daily-breakdown').filter({
    hasText: 'Weekly subscription allowance · API-equivalent estimate · Claude',
  });
  await expect(panel.locator('.hc-col .seg-cache-read')).toHaveCount(1);
  await expect(panel.locator('.weekly-value-details')).not.toHaveAttribute('open', '');
  await panel.locator('.weekly-value-details summary').click();
  await expect(panel.locator('tbody tr')).toHaveCount(1);
  await expect(panel.locator('tbody tr td').nth(4)).not.toHaveText('—');
});

test('weekly allowance value can be hidden without hiding Codex API-equivalent cost', async ({ page }) => {
  await openCodex(page, { weeklyValue: false });
  await page.locator('#tab-all').click();

  await expect(page.locator('#all')).not.toContainText('Weekly subscription allowance · API-equivalent estimate · Codex');
  await expect(page.locator('#all .summary-grid .summary-item').first()).toContainText(
    'API-equivalent cost',
  );
});

test('weekly allowance value can be hidden from Claude All time', async ({ page }) => {
  await openClaude(page, { weeklyValue: false });
  await page.locator('#tab-all').click();

  await expect(page.locator('#all')).not.toContainText('Weekly subscription allowance · API-equivalent estimate · Claude');
  await expect(page.locator('#all .usage-summary').first()).toBeVisible();
});

test('Compare shows both weekly panels by default and hides only those panels when disabled', async ({ page }) => {
  await openCompare(page);
  await expect(page.locator('#provider-panel')).toContainText('Weekly subscription allowance · API-equivalent estimate · Claude');
  await expect(page.locator('#provider-panel')).toContainText('Weekly subscription allowance · API-equivalent estimate · Codex');
  await expect(page.locator('#provider-panel .usage-summary .summary-item')).toHaveCount(2);

  await openCompare(page, { weeklyValue: false });
  await expect(page.locator('#provider-panel')).not.toContainText('Weekly subscription allowance · API-equivalent estimate · Claude');
  await expect(page.locator('#provider-panel')).not.toContainText('Weekly subscription allowance · API-equivalent estimate · Codex');
  await expect(page.locator('#provider-panel .usage-summary .summary-item')).toHaveCount(2);
  await expect(page.locator('#provider-panel .usage-summary')).toContainText('Claude');
  await expect(page.locator('#provider-panel .usage-summary')).toContainText('Codex');
});

test('weekly allowance table fits at 1280px in the longest locale', async ({ page }) => {
  await openCodex(page, { locale: 'de-DE', width: 1280 });
  await page.locator('#tab-all').click();
  const panel = page.locator('#all .daily-breakdown').filter({
    hasText: 'Wöchentliches Abo-Kontingent · API-Äquivalenzschätzung · Codex',
  });
  await panel.locator('.weekly-value-details summary').click();
  const container = panel.locator('.daily-table-container');
  await expect(container).toBeVisible();
  const dimensions = await container.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  const clippedHeaders = await panel.locator('th').evaluateAll((headers) =>
    headers.filter((header) => header.scrollWidth > header.clientWidth).map((header) => header.textContent),
  );
  expect(clippedHeaders).toEqual([]);
});

test('weekly chart uses a non-overflowing current-period label in German', async ({ page }) => {
  await openCodex(page, { locale: 'de-DE', width: 1280 });
  await page.locator('#tab-all').click();
  const panel = page.locator('#all .daily-breakdown').filter({
    hasText: 'Wöchentliches Abo-Kontingent · API-Äquivalenzschätzung · Codex',
  });
  const labels = panel.locator('.hc-xlabel');
  const layout = await labels.evaluateAll((elements) => {
    const rows = elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRect = range.getBoundingClientRect();
      return {
        text: element.textContent?.trim() ?? '',
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        textLeft: textRect.left,
        textRight: textRect.right,
      };
    });
    return {
      rows,
      overlappingPairs: rows.slice(0, -1).flatMap((row, index) =>
        row.textRight > rows[index + 1].textLeft
          ? [[row.text, rows[index + 1].text]]
          : []),
    };
  });
  expect(layout.rows.every((row) => row.scrollWidth <= row.clientWidth), layout).toBe(true);
  expect(layout.overlappingPairs).toEqual([]);
});

test('weekly used-value history remains visible without historical quota samples', async ({ page }) => {
  await openCodex(page, { fixture: 'weekly-usage-only' });
  await page.locator('#tab-all').click();

  const panel = page.locator('#all .daily-breakdown').filter({
    hasText: 'Weekly subscription allowance · API-equivalent estimate · Codex',
  });
  await expect(panel).toContainText('Monday-to-Monday UTC calendar weeks');
  await expect(panel.locator('.weekly-value-details')).not.toHaveAttribute('open', '');
  await panel.locator('.weekly-value-details summary').click();
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  await expect(panel.locator('tbody')).toContainText('Usage only');
  await expect(panel.locator('tbody')).toContainText('$12.00');
  await expect(panel.locator('tbody')).toContainText('$8.00');
  for (const row of await panel.locator('tbody tr').all()) {
    await expect(row.locator('td').nth(2)).toHaveText('—');
    await expect(row.locator('td').nth(3)).toHaveText('—');
    await expect(row.locator('td').nth(4)).toHaveText('—');
  }
});
