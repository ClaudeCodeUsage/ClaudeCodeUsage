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
});

test('Claude and Codex receive the exact same production stylesheet', async ({ page }) => {
  await openClaude(page);
  const claudeStyles = await page.locator('head style').first().textContent();

  await openCodex(page);
  const codexStyles = await page.locator('head style').first().textContent();

  expect(codexStyles).toBe(claudeStyles);
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
  await expect(table.locator('thead th').nth(1)).toHaveText('API-equivalent cost');
  await expect(table.locator('tbody .cost-cell').first()).toHaveText(/^(?:\$[\d,.]+|—)$/);
});

test('Codex month chart defaults to API-equivalent cost and retains token switches', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-month').click();

  const chart = page.locator('#month .daily-breakdown');
  await expect(chart).toBeVisible();
  await expect(chart.locator('.chart-tab')).toHaveCount(6);
  await expect(chart.locator('.chart-tab.active')).toHaveAttribute('data-metric', 'cost');
  await expect(chart.locator('.chart-tab.active')).toHaveText('API-equivalent cost');
  await expect(chart.locator('.chart-bar[data-cost]').first()).toBeVisible();
  await expect(chart.locator('.hc-yaxis .hc-yval').first()).toHaveText(/^\$/);
  await expect(chart.locator('.daily-table thead th').nth(1)).toHaveText('API-equivalent cost');
  await expect(chart.locator('.daily-table tbody .cost-cell').first()).toHaveText(/^(?:\$[\d,.]+|—)$/);

  await chart.locator('.chart-tab[data-metric="outputTokens"]').click();
  await expect(chart.locator('.chart-tab[data-metric="outputTokens"]')).toHaveClass(/active/);
  await chart.locator('.chart-tab[data-metric="cost"]').click();
  await expect(chart.locator('.chart-tab[data-metric="cost"]')).toHaveClass(/active/);
  await expect(chart.locator('.hc-barval').first()).toHaveText(/^(?:\$[\d,.]+|—)$/);
  await expect(chart.locator('.chart-bar[data-cost]').first()).toHaveAttribute(
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
    hasText: 'Weekly allowance value · Codex Beta',
  });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Estimate, not a bill');
  await expect(panel).toContainText('Historical used equivalents come directly from local token logs');
  await expect(panel).toContainText('When usage cannot be reliably attributed to a single quota observation');
  await expect(panel).toContainText('no account split or allowance estimate is invented');
  await expect(panel).toContainText('If an official reset falls within a recorded day');
  await expect(panel.locator('tbody')).toContainText('Usage only · Boundary approx.');
  await expect(panel.locator('.hc-col')).toHaveCount(2);
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  await expect(panel.locator('thead')).toContainText('Full allowance est.');
  await expect(panel.locator('thead')).toContainText('Priced coverage');
  await expect(panel.locator('tbody')).toContainText('Current period');
  await expect(panel.locator('tbody')).toContainText('resets');
  await expect(panel.locator('tbody')).not.toContainText('In progress');
  await expect(panel.locator('tbody').getByText('Current period')).toHaveCount(1);

  const bars = panel.locator('.hc-col');
  await expect(bars.last().locator('.seg-cache-read')).toHaveCount(0);
});

test('a completed observed Claude period can still show its unused segment', async ({ page }) => {
  await openClaude(page, { fixture: 'weekly-claude-completed' });
  await page.locator('#tab-all').click();

  const panel = page.locator('#all .daily-breakdown').filter({
    hasText: 'Weekly allowance value · Claude',
  });
  await expect(panel.locator('.hc-col .seg-cache-read')).toHaveCount(1);
  await expect(panel.locator('tbody tr')).toHaveCount(1);
  await expect(panel.locator('tbody tr td').nth(4)).not.toHaveText('—');
});

test('weekly allowance value can be hidden without hiding Codex API-equivalent cost', async ({ page }) => {
  await openCodex(page, { weeklyValue: false });
  await page.locator('#tab-all').click();

  await expect(page.locator('#all')).not.toContainText('Weekly allowance value · Codex Beta');
  await expect(page.locator('#all .summary-grid .summary-item').first()).toContainText(
    'API-equivalent cost',
  );
});

test('weekly allowance value can be hidden from Claude All time', async ({ page }) => {
  await openClaude(page, { weeklyValue: false });
  await page.locator('#tab-all').click();

  await expect(page.locator('#all')).not.toContainText('Weekly allowance value · Claude');
  await expect(page.locator('#all .usage-summary').first()).toBeVisible();
});

test('Compare shows both weekly panels by default and hides only those panels when disabled', async ({ page }) => {
  await openCompare(page);
  await expect(page.locator('#provider-panel')).toContainText('Weekly allowance value · Claude');
  await expect(page.locator('#provider-panel')).toContainText('Weekly allowance value · Codex Beta');
  await expect(page.locator('#provider-panel .usage-summary .summary-item')).toHaveCount(2);

  await openCompare(page, { weeklyValue: false });
  await expect(page.locator('#provider-panel')).not.toContainText('Weekly allowance value · Claude');
  await expect(page.locator('#provider-panel')).not.toContainText('Weekly allowance value · Codex Beta');
  await expect(page.locator('#provider-panel .usage-summary .summary-item')).toHaveCount(2);
  await expect(page.locator('#provider-panel .usage-summary')).toContainText('Claude');
  await expect(page.locator('#provider-panel .usage-summary')).toContainText('Codex Beta');
});

test('weekly allowance table fits at 1280px in the longest locale', async ({ page }) => {
  await openCodex(page, { locale: 'de-DE', width: 1280 });
  await page.locator('#tab-all').click();
  const panel = page.locator('#all .daily-breakdown').filter({
    hasText: 'Wöchentlicher Gegenwert · Codex Beta',
  });
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
    hasText: 'Wöchentlicher Gegenwert · Codex Beta',
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
    hasText: 'Weekly allowance value · Codex Beta',
  });
  await expect(panel).toContainText('Monday-to-Monday UTC calendar weeks');
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
