import { test, expect, openCodex } from './support/app.mjs';

const base = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
for (const [theme, width] of [['light', 1280], ['dark', 320]]) {
  test(`${theme} ${width}px: reset cycles keep two short axis lines and scroll across up to 48 bars`, async ({ page }, testInfo) => {
    const external = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await openCodex(page, { fixture: 'weekly-cycles', codexOnly: true, theme, width });
    await page.locator('#tab-all').click();
    const chart = page.locator('#all [data-weekly-estimate-chart]');
    const labels = chart.locator('.hc-xlabel'), bars = chart.locator('.stack-bar');
    await expect(labels).toHaveCount(48); await expect(bars).toHaveCount(48);
    const geometry = await bars.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width };
    }));
    for (let index = 1; index < geometry.length; index++) {
      expect(geometry[index].left - geometry[index - 1].right).toBe(6);
    }
    expect(geometry.every(bar => bar.width === 40)).toBe(true);
    const columns = await chart.locator('.hc-col').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    const axisWidths = await labels.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    expect(columns).toEqual(axisWidths);
    expect(columns.every(width => width === 44)).toBe(true);
    await expect(page.locator('#all [data-codex-cycle-panel]')).toContainText('Missing boundaries use 7-day references');
    await expect(page.locator('#all [data-codex-cycle-panel] [data-weekly-actual-chart]')).toHaveCount(0);
    for (const label of await labels.all()) {
      const lines = label.locator(':scope > span'); await expect(lines).toHaveCount(2);
      await expect(lines.first()).toHaveText(/^\d{1,2}\/\d{1,2}$/);
      await expect(lines.last()).toHaveText(/^#[12]$/);
      for (const line of await lines.all()) {
        await expect(line).toHaveCSS('white-space', 'nowrap');
        await expect(line).toHaveCSS('text-overflow', 'ellipsis');
        expect(await line.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(14);
      }
    }
    const latest = bars.last();
    await expect(latest).toHaveAttribute('title', /Cycle total \(estimate\): \$160\.00.*Inferred used \(estimate\): \$96\.00.*Unused estimate: \$64\.00/);
    const early = bars.nth(46);
    await expect(early).toHaveAttribute('title', /Cycle start:.*Cycle end:.*Scheduled reset:.*Boundary uncertain.*As of observation:/);
    for (const bar of [latest, early]) {
      const title = await bar.getAttribute('title'); await expect(bar).toHaveAccessibleName(title);
    }
    const scroll = chart.locator('.hc-scroll');
    expect(await scroll.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await scroll.focus(); await page.keyboard.press('ArrowRight'); await page.clock.runFor(500);
    expect(await scroll.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    const details = page.locator('#all .weekly-estimate-details');
    await details.locator(':scope > summary').click();
    // The capped table describes exactly the plotted cycles. Old extra raw
    // audit rows (53 here) and older references outside the cap are obsolete.
    await expect(details.locator('tbody tr')).toHaveCount(48);
    await expect(details.locator('thead th')).toHaveText(['Period', 'Account', 'Cycle total (estimate)',
      'Inferred used (estimate)', 'Unused estimate', 'As of observation', 'Calibration evidence']);
    await expect(details.locator('tbody tr details[data-cycle-evidence][data-persist]')).toHaveCount(48);
    await expect(details.locator(':scope > summary')).toHaveText('Cycle details');
    const chartTitles = await bars.evaluateAll(nodes => nodes.map(node => node.title));
    for (const row of await details.locator('tbody tr').all()) {
      const cells = row.locator('td');
      await expect(cells).toHaveCount(7);
      await expect(row.locator('details[data-cycle-evidence][data-persist]')).toHaveCount(1);
      const bounds = await cells.first().getAttribute('title');
      const account = await cells.nth(1).textContent();
      const asOf = await cells.nth(5).evaluate(node => node.firstChild.textContent);
      const amounts = await Promise.all([2, 3, 4].map(column => cells.nth(column).textContent()));
      // Equal counts alone could hide different capped subsets or observations.
      expect(chartTitles.filter(title => [bounds, account, asOf, ...amounts]
        .every(value => title.includes(value)))).toHaveLength(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(external).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message =>
      /fetch|pricing|publish|daemon|login/i.test(message.command)))).toEqual([]);
    const screenshot = testInfo.outputPath(`weekly-cycles-${theme}-${width}.png`);
    await chart.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('cycle-chart', { path: screenshot, contentType: 'image/png' });
  });
}

const referenceLocales = [
  ['en', '7d', '7-day reference period (UTC)', 'Observed reset'],
  ['zh-CN', '7天', '7天参考周期（UTC）', '原观测重置时间'],
  ['zh-TW', '7天', '7天參考週期（UTC）', '原觀測重設時間'],
  ['de-DE', '7T', '7-Tage-Referenzzeitraum (UTC)', 'Beobachteter Reset'],
  ['ja', '7日', '7日間の参考期間（UTC）', '観測されたリセット'],
  ['ko', '7일', '7일 참고 기간 (UTC)', '관측된 재설정'],
  ['pt-BR', '7d', 'Período de referência de 7 dias (UTC)', 'Redefinição observada'],
  ['id', '7h', 'Periode referensi 7 hari (UTC)', 'Pengaturan ulang teramati'],
];
for (const [locale, short, period, reset] of referenceLocales) {
  test(`${locale}: 24 days of daily legacy resets render only four stable reference periods`, async ({ page }, testInfo) => {
    await openCodex(page, { fixture: 'weekly-reference-cycles', codexOnly: true, locale,
      theme: 'dark', width: 320 });
    await page.locator('#tab-all').click();
    const chart = page.locator('#all [data-weekly-estimate-chart]');
    const bars = chart.locator('.stack-bar'), labels = chart.locator('.hc-xlabel');
    await expect(bars).toHaveCount(4); await expect(labels).toHaveCount(4);
    await expect(labels.locator(':scope > span:first-child')).toHaveText(['6/29', '7/6', '7/13', '7/20']);
    await expect(labels.locator(':scope > span:last-child')).toHaveText([short, short, short, short]);
    for (const label of await labels.all()) await expect(label.locator(':scope > span')).toHaveCount(2);
    for (const bar of await bars.all()) {
      const title = await bar.getAttribute('title');
      expect(title).toContain(period); expect(title).toContain(reset);
      await expect(bar).toHaveAccessibleName(title);
    }
    const details = page.locator('#all .weekly-estimate-details');
    await details.locator(':scope > summary').click();
    // Repeated observations belong to the same four reference periods.
    await expect(details.locator('tbody tr')).toHaveCount(4);
    await expect(details.locator('thead th')).toHaveCount(7);
    await expect(details.locator('details[data-cycle-evidence][data-persist]')).toHaveCount(4);
    await expect(details).toContainText(period); await expect(details).toContainText(reset);
    const geometry = await bars.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right };
    }));
    for (let index = 1; index < geometry.length; index++) {
      expect(geometry[index].left - geometry[index - 1].right).toBeLessThanOrEqual(10);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (locale === 'en' || locale === 'zh-CN') {
      const screenshot = testInfo.outputPath(`weekly-reference-${locale}.png`);
      await chart.screenshot({ path: screenshot, animations: 'disabled' });
      await testInfo.attach('reference-chart', { path: screenshot, contentType: 'image/png' });
    }
  });
}
