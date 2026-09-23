import { test, expect, openClaude, openCodex } from './support/app.mjs';

test('currency preset reaches Codex summaries, charts, weekly values, and settings', async ({ page }) => {
  await openCodex(page, { fixture: 'local-currency' });

  const summary = page.locator('#today .usage-summary').first();
  await expect(summary.locator('.summary-item').first().locator('.label'))
    .toHaveText('API-equivalent cost');
  await expect(summary.locator('.summary-item').first().locator('.value'))
    .toHaveText(/^≈EUR \d/);

  await page.locator('#tab-month').click();
  const chart = page.locator('#month [data-codex-last30-daily]');
  await expect(chart.locator(':scope > .chart-content .hc-yaxis .hc-yval').first())
    .toHaveText(/^≈EUR \d/);
  await expect(chart.locator(':scope > .daily-table-container > table.daily-table > tbody'))
    .toContainText('≈EUR ');

  // Metric switching is a client-side re-render, so this catches a separate
  // formatting boundary from the server-rendered initial chart.
  await chart.locator(':scope > .chart-tabs .chart-tab[data-metric="outputTokens"]').click();
  await chart.locator(':scope > .chart-tabs .chart-tab[data-metric="cost"]').click();
  await expect(chart.locator(':scope > .chart-content .hc-yaxis .hc-yval').first())
    .toHaveText(/^≈EUR \d/);

  await page.locator('#tab-all').click();
  const weekly = page.locator('#all .daily-breakdown').filter({
    hasText: 'Weekly subscription allowance · API-equivalent estimate · Codex',
  });
  await expect(weekly.locator('.hc-yaxis .hc-yval').first()).toHaveText(/^≈EUR \d/);
  await weekly.locator('.weekly-value-details summary').click();
  await expect(weekly.locator('tbody .cost-cell').first()).toHaveText(/^≈EUR \d/);

  await page.locator('#tab-settings').click();
  await expect(page.locator('#set_displayCurrency')).toHaveValue('EUR');
  await expect(page.locator('#set_displayCurrency')).toHaveJSProperty('tagName', 'SELECT');
  await expect(page.locator('#set_displayCurrency option').first()).toHaveText('USD ($)');
  await expect(page.locator('#set_displayCurrency option')).toHaveCount(14);
  await expect(page.locator('#set_usdConversionRate')).toHaveCount(0);
  await expect(page.locator('#settings')).toContainText('rates are not editable or fetched');
});

test('currency preset reaches Claude and client-rendered drill-downs', async ({ page }) => {
  await openClaude(page, { fixture: 'local-currency' });
  await page.locator('#tab-today').click();
  await expect(page.locator('#today .usage-summary .summary-item').first().locator('.value'))
    .toHaveText(/^≈EUR \d/);

  const dynamic = await page.evaluate(() => {
    const usage = {
      totalCost: 10,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheCreationTokens: 25,
      totalCacheReadTokens: 200,
      messageCount: 2,
      costBreakdown: { input: 2, output: 5, cacheWrite: 2, cacheRead: 1 },
    };
    const parse = (html) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      return root;
    };
    const emptyUsage = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      messageCount: 0,
      costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    };
    const hourly = parse(window.renderHourlyData([
      { hour: '00:00', data: emptyUsage },
      { hour: '09:00', data: usage },
    ], '2026-07-20'));
    const daily = parse(window.renderDailyData([{ date: '2026-07-20', data: usage }], '2026-07'));
    return {
      hourlyCost: hourly.querySelector('tbody tr[data-hour="09:00"] .cost-cell')?.textContent,
      hourlyAxis: hourly.querySelector('.hc-yaxis .hc-yval')?.textContent,
      emptyHourlyLabel: hourly.querySelector('.hc-col[data-hour="00:00"] .hc-barval')?.textContent,
      emptyHourlyTableCost: hourly.querySelector('tbody tr[data-hour="00:00"] .cost-cell')?.textContent,
      dailyCost: daily.querySelector('tbody .cost-cell')?.textContent,
      dailyAxis: daily.querySelector('.hc-yaxis .hc-yval')?.textContent,
    };
  });

  expect(dynamic).toEqual({
    hourlyCost: '≈EUR 8.58',
    hourlyAxis: '≈EUR 8.58',
    emptyHourlyLabel: '',
    emptyHourlyTableCost: '≈EUR 0.00',
    dailyCost: '≈EUR 8.58',
    dailyAxis: '≈EUR 8.58',
  });
});
