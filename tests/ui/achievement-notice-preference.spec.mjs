import { test, expect, openCodex, openClaude } from './support/app.mjs';

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} notice opt-out is separate, keyboard-operated and fits narrow themes`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) for (const open of [openClaude, openCodex]) {
      await open(page, { locale, theme, width: 320 });
      await page.locator('#tab-settings').click();
      const control = page.locator('#set_showAchievementNotices');
      const switchLabel = control.locator('..');
      await switchLabel.scrollIntoViewIfNeeded();
      await expect(switchLabel).toBeVisible(); await expect(control).toBeChecked();
      const label = page.locator('label[for="set_showAchievementNotices"]');
      await expect(label).not.toBeEmpty();
      await expect(control).toHaveAccessibleName(await label.innerText());
      await control.focus();
      // Establish real keyboard modality after the pointer-selected Settings tab.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(control).toBeFocused();
      expect(await switchLabel.locator('.set-slider').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
      await control.press('Space');
      expect(await page.evaluate(() => window.__ccuPostedMessages.at(-1)))
        .toEqual({ command: 'updateSetting', key: 'showAchievementNotices', value: false });
      await expect(page.locator('#set_enableAchievements')).toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`notice-preference-${locale}-${theme}-${open === openClaude ? 'claude' : 'codex'}.png`) });
      // Simulated host re-render after persistence; real preference persistence is a Node SettingsStore test.
      const url = new URL(page.url()); url.searchParams.set('achievementNotices', 'false');
      await page.goto(url.href); await page.reload();
      await expect(control).not.toBeChecked();
      await expect(page.locator('#tab-achievements')).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'achievementUnlockNotice', text: 'Retired notice', noticeId: 'b'.repeat(48),
      } })));
      await expect(page.locator('#ccuAchievementUnlockNotice')).toHaveCount(0);
      expect(await page.evaluate(() => window.__ccuPostedMessages.some(row => row.command === 'achievementNoticeAck'))).toBe(false);
    }
  });
}

test('opting out immediately dismisses an already visible notice without confirming more awards', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-records' });
  await page.locator('#tab-settings').click();
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementUnlockNotice', text: 'New badge',
  } })));
  await expect(page.locator('#ccuAchievementUnlockNotice')).toBeVisible();
  await page.locator('#set_showAchievementNotices').focus();
  await page.locator('#set_showAchievementNotices').press('Space');
  await expect(page.locator('#ccuAchievementUnlockNotice')).toHaveCount(0);
  await page.locator('#tab-achievements').click();
  await expect(page.locator('[data-persist="achievement:unread"]')).toBeVisible();
  expect(await page.evaluate(() => window.__ccuPostedMessages.some(row => row.command === 'achievementSummaryAck'))).toBe(false);
});
