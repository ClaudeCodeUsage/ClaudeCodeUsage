import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, openCodex } from './support/app.mjs';
const base = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
for (const [theme, width] of [['dark', 1280], ['light', 320], ['highContrast', 360]]) {
  test(`${theme} ${width}: paired cycles share compact rows, pending values and persistent evidence`, async ({ page }, testInfo) => {
    const external = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await openCodex(page, { fixture: 'weekly-paired-cycles', locale: 'zh-CN', codexOnly: true, theme, width });
    const session = randomBytes(16).toString('hex'), url = new URL(page.url());
    url.searchParams.set('weeklyAccountSession', session); await page.goto(url.href);
    await page.locator('#tab-settings').click();
    await page.locator('#set_codex_officialQuota_enabled').focus(); await page.keyboard.press('Space');
    await expect(page.locator('#set_codex_officialQuota_enabled')).toBeChecked();
    const saved = await page.context().request.post(`${base}/__weekly_accounts_setting__`, {
      data: { session, command: 'updateSetting', key: 'codex.officialQuota.enabled', value: true } });
    expect(saved.ok()).toBe(true); await page.reload(); await page.locator('#tab-all').click();
    const panel = page.locator('#all [data-codex-cycle-panel]'), chart = panel.locator('[data-codex-cycle-chart]');
    await expect(chart.locator('.hc-xlabel')).toHaveCount(11);
    await expect(chart.locator('.stack-bar')).toHaveCount(10);
    await expect(chart.locator('[data-cycle-pending]')).toHaveCount(1);
    await expect(panel.locator('[data-cycle-source-conflict]')).toContainText('尚未对齐');
    await expect(panel).not.toContainText('本机七天用量');
    const outer = panel.locator('.weekly-estimate-details');
    await outer.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
    const rows = outer.locator('[data-codex-cycle-summary-row]'); await expect(rows).toHaveCount(11);
    const evidence = rows.nth(1).locator('[data-cycle-evidence]');
    await evidence.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(evidence).toHaveAttribute('open', '');
    const key = await evidence.getAttribute('data-persist');
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem('__ccu-vscode-state') ?? '{}').openDetails?.includes(key), key)).toBe(true);
    const response = await page.context().request.get(page.url());
    await page.evaluate(html => {
      const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
      window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
        tab: 'all', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
    }, await response.text());
    await page.clock.runFor(500);
    await expect(page.locator(`details[data-persist="${key}"]`)).toHaveAttribute('open', '');
    await page.reload(); await expect(page.locator(`details[data-persist="${key}"]`)).toHaveAttribute('open', '');
    const labels = chart.locator('.hc-xlabel');
    for (const label of await labels.all()) {
      await expect(label.locator(':scope > span')).toHaveCount(2);
      await expect(label.locator(':scope > span').first()).toHaveCSS('white-space', 'nowrap');
    }
    const geometry = await chart.locator('.stack-bar').evaluateAll(nodes => nodes.map(n => {
      const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };
    }));
    expect(geometry.every(r => r.width === 40)).toBe(true);
    for (let i = 1; i < geometry.length; i++) expect(geometry[i].left - geometry[i-1].right).toBeLessThanOrEqual(6.1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const audit = await new AxeBuilder({ page }).include('#all [data-codex-cycle-panel]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(audit.violations).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
    const picture = testInfo.outputPath(`paired-cycles-${theme}-${width}.png`);
    await chart.screenshot({ path: picture, animations: 'disabled' });
    await testInfo.attach('paired-cycle-chart', { path: picture, contentType: 'image/png' });
  });
}
