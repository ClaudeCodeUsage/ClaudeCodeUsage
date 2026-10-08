import { test, expect, openCodex } from './support/app.mjs';

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} saved local feature steps stay readable, honest and folded after reload`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) {
      await openCodex(page, { fixture: 'achievement-journey-partial', width: 320, theme, locale });
      await page.evaluate(() => localStorage.removeItem('__ccu-vscode-state')); await page.reload();
      await page.locator('#tab-achievements').click();
      const card = page.locator('[data-achievement-key="safe-feature-explorer"]');
      await expect(card.locator('details')).not.toHaveAttribute('open');
      await card.locator('summary').focus(); await card.locator('summary').press('Enter');
      const journey = card.locator('.achievement-feature-journey');
      await expect(journey.locator('[data-achievement-step]')).toHaveCount(3);
      await expect(journey.locator('[data-complete="true"]')).toHaveCount(2);
      await expect(journey.locator('[data-achievement-step="localShareExport"]')).toHaveAttribute('data-complete', 'false');
      await expect(journey.locator('button,a,input')).toHaveCount(0);
      await page.clock.runFor(200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.screenshot({ path: testInfo.outputPath(`journey-${locale}-${theme}.png`) });
      await page.evaluate(() => { window.__ccuPostedMessages = []; });
      await page.reload();
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(journey.locator('[data-complete="true"]')).toHaveCount(2);
      const full = new URL(page.url()); full.searchParams.set('fixture', 'achievement-journey-complete');
      const response = await page.context().request.get(full.href); expect(response.ok()).toBe(true);
      await card.locator('summary').focus();
      await page.evaluate(html => {
        const panel = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
        window.__ccuPostedMessages = [];
        window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
          tab: 'achievements', revision: 1, html: panel.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
      }, await response.text());
      await page.clock.runFor(200);
      await expect(card.locator('summary')).toBeFocused();
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(journey.locator('[data-complete="true"]')).toHaveCount(3);
      for (const command of ['refresh', 'exportAchievementShare', 'previewAchievementShare', 'achievementNoticeAck', 'updateSetting'])
        expect(await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command))).not.toContain(command);
      await page.goto(full.href); await page.reload();
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(journey.locator('[data-complete="true"]')).toHaveCount(3);
    }
  });
}

test('historical award artwork does not invent recorded steps or request a new export', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-journey-history', width: 360 });
  await page.locator('#tab-achievements').click();
  const card = page.locator('[data-achievement-key="safe-feature-explorer"]');
  await expect(card).toHaveAttribute('data-achievement-earned', 'true');
  await card.locator('summary').click();
  await expect(card.locator('.achievement-feature-journey [data-complete="false"]')).toHaveCount(3);
  expect(await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command))).not.toContain('exportAchievementShare');
});
