import { test, expect, openClaude } from './support/app.mjs';

test.use({ timezoneId: 'America/Los_Angeles' });

test('chart metric switches preserve daily and monthly key labels west of UTC', async ({ page }) => {
  await openClaude(page, { timeZone: 'Asia/Tokyo' });

  await page.locator('#tab-month').click();
  const dailyBar = page.locator(
    '#month #dailyChart .hc-col[data-date="2026-07-20"] .chart-bar',
  );
  await expect(dailyBar).toHaveAttribute('title', /^7\/20\/2026:/);
  await page.locator('#month .chart-tab[data-metric="inputTokens"]').click();
  await expect(dailyBar).toHaveAttribute('title', /^7\/20\/2026:/);

  await page.locator('#tab-all').click();
  const monthlyBar = page.locator(
    '#all #allTimeChart .hc-col[data-date="2026-07-01"] .chart-bar',
  );
  await expect(monthlyBar).toHaveAttribute('title', /^July 2026:/);
  await page.locator('#all .chart-tab[data-metric="inputTokens"]').click();
  await expect(monthlyBar).toHaveAttribute('title', /^July 2026:/);
});

test('drill-down labels render configured-zone usage keys without UTC rollback', async ({ page }) => {
  await openClaude(page, { timeZone: 'Pacific/Honolulu' });

  const labels = await page.evaluate(() => {
    const usage = {
      totalInputTokens: 10,
      totalOutputTokens: 2,
      totalCacheCreationTokens: 3,
      totalCacheReadTokens: 4,
      totalCost: 1,
      costBreakdown: { input: 0.2, output: 0.3, cacheWrite: 0.4, cacheRead: 0.1 },
      messageCount: 1,
      modelBreakdown: {},
    };
    const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
    const hourly = parse(window.renderHourlyData([
      { hour: '00:00', data: usage },
    ], '2026-07-20'));
    const daily = parse(window.renderDailyData([
      { date: '2026-07-01', data: usage },
    ], '2026-07'));
    return {
      hourlyHeading: hourly.querySelector('h4')?.textContent,
      dailyHeading: daily.querySelector('h4')?.textContent,
      compositionDay: daily.querySelector('.composition-chart .hc-xlabel')?.textContent,
      tableDay: daily.querySelector('tbody .date-cell')?.textContent,
    };
  });

  expect(labels).toEqual({
    hourlyHeading: '7/20/2026 Hourly Usage',
    dailyHeading: 'July 2026 Daily Usage',
    compositionDay: '7/1',
    tableDay: '7/1',
  });
});
