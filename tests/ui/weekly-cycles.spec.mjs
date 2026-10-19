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
    await expect(chart.locator('.table-hint').first()).toContainText('cycle length varies');
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
    await expect(details.locator('tbody tr')).toHaveCount(53);
    await expect(details).toContainText('Cycle start unknown');
    await expect(details).toContainText('Reference estimate · not an account cycle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(external).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message =>
      /fetch|pricing|publish|daemon|login/i.test(message.command)))).toEqual([]);
    const screenshot = testInfo.outputPath(`weekly-cycles-${theme}-${width}.png`);
    await chart.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('cycle-chart', { path: screenshot, contentType: 'image/png' });
  });
}
