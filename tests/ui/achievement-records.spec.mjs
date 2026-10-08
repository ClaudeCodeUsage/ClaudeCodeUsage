import { test, expect, openCodex } from './support/app.mjs';

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} recorded awards fit both narrow themes and quiet history never appears recent`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) {
      await openCodex(page, { fixture: 'achievement-records', width: 320, locale, theme });
      await page.locator('#tab-achievements').click();
      const recent = page.locator('[data-achievement-overview="recent"]');
      await expect(recent.locator('button')).toHaveCount(3);
      await expect(recent.locator('time')).toHaveCount(3);
      await expect(recent.locator('img')).toHaveCount(3);
      const disclosure = page.locator('[data-persist="achievement:records"]');
      if (!await disclosure.evaluate(element => element.open)) await disclosure.locator('summary').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.reload();
      await expect(page.locator('[data-persist="achievement:records"]')).toHaveAttribute('open');
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`records-${locale}-${theme}.png`) });
      await openCodex(page, { fixture: 'achievement-history-only', width: 320, locale, theme });
      await page.locator('#tab-achievements').click();
      await expect(page.locator('[data-achievement-overview="recent"]')).toHaveCount(0);
      const history = page.locator('[data-persist="achievement:records"]');
      await expect(history.locator('li')).toHaveCount(5);
      await expect(history.locator('time')).toHaveCount(0);
    }
  });
}

test('recent saved awards link to exact rules and history disclosure survives reload', async ({ page }, testInfo) => {
  await openCodex(page, { fixture: 'achievement-records', width: 360 });
  await page.locator('#tab-achievements').click();
  const recent = page.locator('[data-achievement-overview="recent"]');
  await expect(recent.locator('button')).toHaveCount(3);
  await expect(recent.locator('[data-achievement-record="hundred-million-club"]')).toHaveCount(0);
  await expect(recent.locator('[data-achievement-record="settings-explorer-bronze"]')).toHaveCount(0);
  const button = recent.locator('[data-achievement-record="settings-explorer-silver"]');
  await expect(button).toHaveAttribute('aria-label', /First recorded: 2026-07-20/);
  await button.focus();
  await button.press('Enter');
  await expect(page.locator('[data-achievement-series="settings-explorer"] details')).toHaveAttribute('open');
  const history = page.locator('[data-persist="achievement:records"]');
  await expect(history).not.toHaveAttribute('open');
  await history.locator('summary').click();
  await page.reload();
  await expect(history).toHaveAttribute('open');
  await expect(history).toContainText('Historical award');
  await expect(history).toContainText('First recorded');
  expect(await page.evaluate(() => window.__ccuPostedMessages.some(message =>
    ['refresh', 'achievementNoticeAck', 'previewAchievementShare', 'exportAchievementShare'].includes(message.command)))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('recent-records-light.png') });
});
