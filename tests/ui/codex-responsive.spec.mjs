import { test, expect, openClaude, openCodex } from './support/app.mjs';

const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];

async function pageWidths(page) {
  return page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
}

async function expectTableToFit(table) {
  const layout = await table.evaluate((element) => {
    const scroller = element.closest('.daily-table-container');
    return {
      container: scroller ? { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth } : null,
      clippedHeaders: Array.from(element.querySelectorAll('thead th'))
        .filter((header) => header.scrollWidth > header.clientWidth)
        .map((header) => ({
          text: header.textContent?.trim() ?? '',
          clientWidth: header.clientWidth,
          scrollWidth: header.scrollWidth,
        })),
    };
  });
  expect(layout.container).not.toBeNull();
  expect(layout.container.scrollWidth, layout).toBeLessThanOrEqual(layout.container.clientWidth);
  expect(layout.clippedHeaders).toEqual([]);
}

async function expectMainCompositionAndTableAligned(panel) {
  const geometry = await panel.evaluate((element) => {
    const mainWrap = element.querySelector(':scope > .chart-content > .hc-wrap') ??
      element.querySelector(':scope > .hc-wrap');
    const compositionWrap = element.querySelector(':scope > .composition-chart > .hc-wrap');
    const table = element.querySelector(':scope > .daily-table-container');
    const rect = (target) => target ? {
      left: target.getBoundingClientRect().left,
      right: target.getBoundingClientRect().right,
      width: target.getBoundingClientRect().width,
    } : null;
    return {
      main: rect(mainWrap),
      composition: rect(compositionWrap),
      table: rect(table),
      mainPlot: rect(mainWrap?.querySelector('.hc-main') ?? null),
      compositionPlot: rect(compositionWrap?.querySelector('.hc-main') ?? null),
    };
  });

  for (const key of ['main', 'composition', 'table', 'mainPlot', 'compositionPlot']) {
    expect(geometry[key], geometry).not.toBeNull();
  }
  const tolerance = 1.5;
  expect(Math.abs(geometry.main.left - geometry.composition.left), geometry).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(geometry.main.right - geometry.composition.right), geometry).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(geometry.main.left - geometry.table.left), geometry).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(geometry.main.right - geometry.table.right), geometry).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(geometry.mainPlot.left - geometry.compositionPlot.left), geometry).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(geometry.mainPlot.right - geometry.compositionPlot.right), geometry).toBeLessThanOrEqual(tolerance);
}

for (const locale of locales) {
  test(`${locale} shared Codex shell fits a 360px viewport`, async ({ page }) => {
    await openCodex(page, { locale, width: 360, height: 800 });
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    const codexWidths = await pageWidths(page);

    for (const tab of ['month', 'sessions', 'projects', 'content', 'settings']) {
      await page.locator(`#tab-${tab}`).click();
      await expect(page.locator(`#${tab}`)).toBeVisible();
    }

    await openClaude(page, { locale, width: 360, height: 800 });
    const claudeWidths = await pageWidths(page);
    expect(codexWidths.document).toBeLessThanOrEqual(claudeWidths.document);
    expect(codexWidths.body).toBeLessThanOrEqual(claudeWidths.body);
  });
}

test('wide Codex session data stays inside the existing table scroller', async ({ page }) => {
  await openCodex(page, { locale: 'en', width: 360, height: 800 });
  await page.locator('#tab-sessions').click();

  const scroller = page.locator('#sessions .daily-table-container');
  await expect(scroller).toBeVisible();
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(page.locator('#sessions .name-cell').filter({ hasText: 'Refine the Codex dashboard' }).first())
    .toBeVisible();
});

test('desktop Codex sessions prioritize identifiers without horizontal overflow', async ({ page }) => {
  await openCodex(page, { locale: 'en', width: 1280, height: 900 });
  await page.locator('#tab-sessions').click();

  const table = page.locator('#sessions [data-provider-session-table]');
  const scroller = page.locator('#sessions .daily-table-container');
  await expect(table.locator('thead th')).toHaveText([
    'Last active', 'Thread', 'Project', 'Model', 'Effort', 'Processed', 'Output', 'Session span',
  ]);
  expect(await scroller.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const clippedHeaders = await table.locator('thead th').evaluateAll((headers) => headers
    .filter((header) => header.scrollWidth > header.clientWidth)
    .map((header) => ({
      text: header.textContent?.trim() ?? '',
      scrollWidth: header.scrollWidth,
      clientWidth: header.clientWidth,
    })));
  expect(clippedHeaders).toEqual([]);

  const rows = table.locator('tbody > tr[data-session-row]');
  expect(await rows.count()).toBeGreaterThan(0);
  const renderedLineCounts = await rows.evaluateAll((elements) => elements.map((row) =>
    Array.from(row.cells).map((cell) => {
      const tops = [];
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        if (node.textContent?.trim() && !parent?.closest('[data-session-detail-toggle]')) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && rect.height > 0 && !tops.some((top) => Math.abs(top - rect.top) < 1)) {
              tops.push(rect.top);
            }
          }
        }
        node = walker.nextNode();
      }
      return tops.length;
    })));
  expect(
    renderedLineCounts.every((cells) => cells.every((lineCount) => lineCount <= 2)),
    JSON.stringify(renderedLineCounts),
  ).toBe(true);

  const modelCells = table.locator('[data-session-model]');
  expect(await modelCells.evaluateAll((elements) => elements.every((cell) =>
    getComputedStyle(cell).whiteSpace === 'nowrap' && cell.scrollHeight <= cell.clientHeight + 1))).toBe(true);

  const widths = await rows.first().locator('td').evaluateAll((cells) => ({
    thread: cells[1].getBoundingClientRect().width,
    project: cells[2].getBoundingClientRect().width,
    processed: cells[5].getBoundingClientRect().width,
    output: cells[6].getBoundingClientRect().width,
  }));
  expect(widths.thread).toBeGreaterThan(widths.processed * 1.5);
  expect(widths.project).toBeGreaterThan(widths.output * 1.5);

  const spanHeader = table.locator('thead th').last();
  await expect(spanHeader).toHaveAttribute('title', /first and last observed events.*not actual active time/i);
  await table.locator('[data-session-detail-toggle]').first().click();
  await expect(table.locator('[data-session-detail]').first()).toBeVisible();
  await expect(table.locator('[data-session-detail]').first().locator('[data-session-detail-item]')).toHaveCount(6);
});

for (const locale of ['en', 'de-DE']) {
  test(`${locale} Codex daily and session tables fit at 1280px`, async ({ page }) => {
    await openCodex(page, { locale, width: 1280, height: 900 });
    await page.locator('#tab-month').click();
    const dailyTable = page.locator('#month .daily-breakdown .daily-table');
    await expect(dailyTable).toBeVisible();
    await expect(dailyTable.locator('thead th')).toHaveCount(9);
    await expect(dailyTable.locator('thead th').nth(1)).toContainText('API');
    await expectTableToFit(dailyTable);

    await page.locator('#tab-sessions').click();
    const sessionTable = page.locator('#sessions [data-provider-session-table]');
    await expect(sessionTable).toBeVisible();
    await expect(sessionTable.locator('thead th')).toHaveCount(8);
    await expectTableToFit(sessionTable);
  });
}

test('desktop Codex destinations use the same container width as Claude', async ({ page }) => {
  await openCodex(page, { width: 1280, height: 900 });
  const codexWidth = await page.locator('.container').evaluate((element) => element.getBoundingClientRect().width);
  await openClaude(page, { width: 1280, height: 900 });
  const claudeWidth = await page.locator('.container').evaluate((element) => element.getBoundingClientRect().width);
  expect(codexWidth).toBe(claudeWidth);
});

test('Claude main cost chart aligns with token composition and its table', async ({ page }) => {
  await openClaude(page, { locale: 'en', width: 1280, height: 900 });
  await page.locator('#tab-month').click();
  const month = page.locator('#month .daily-breakdown', {
    has: page.getByRole('heading', { name: 'Daily Usage', exact: true }),
  });
  await expect(month).toBeVisible();
  await expectMainCompositionAndTableAligned(month);
});

test('Codex 30-day charts scroll horizontally without widening the dashboard', async ({ page }) => {
  await openCodex(page, { locale: 'en', width: 720, height: 900 });
  await page.locator('#tab-month').click();

  const breakdown = page.locator('#month [data-codex-last30-daily]');
  await expect(breakdown).toBeVisible();
  await expect(breakdown.locator('.chart-tab.active')).toHaveAttribute('data-metric', 'cost');
  const chartScrollers = breakdown.locator('.hc-scroll');
  await expect(chartScrollers).toHaveCount(2);

  const viewportWidth = page.viewportSize()?.width ?? 720;
  const widths = await pageWidths(page);
  expect(widths.document).toBeLessThanOrEqual(viewportWidth);
  expect(widths.body).toBeLessThanOrEqual(viewportWidth);

  for (const scroller of await chartScrollers.all()) {
    const before = await scroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    expect(before.overflowX).toBe('auto');
    expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);

    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const after = await scroller.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      maxScrollLeft: element.scrollWidth - element.clientWidth,
    }));
    expect(after.scrollLeft).toBeGreaterThan(0);
    expect(after.scrollLeft).toBeCloseTo(after.maxScrollLeft, 0);

    const visibleRightEdge = await scroller.evaluate((element) => {
      const scrollerRect = element.getBoundingClientRect();
      const lastLabel = element.querySelector('.hc-xlabel:last-child');
      const labelRect = lastLabel?.getBoundingClientRect();
      return labelRect ? labelRect.right <= scrollerRect.right + 1 : false;
    });
    expect(visibleRightEdge).toBe(true);
  }

  const tableScroller = breakdown.locator('.daily-table-container');
  await expect(tableScroller.locator('thead th')).toHaveCount(9);
  await expect(tableScroller.locator('thead th').nth(1)).toHaveText('API-equivalent cost');
  const tableBefore = await tableScroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  expect(tableBefore.overflowX).toBe('auto');
  expect(tableBefore.scrollWidth).toBeGreaterThan(tableBefore.clientWidth);
  await tableScroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await tableScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});
