import { test, expect, openCodex, openClaude, openCompare } from './support/app.mjs';

// Browser bridge proves client restoration, not canonical filesystem writes.
for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  for (const provider of ['claude', 'codex']) {
    test(`${locale} ${provider} readiness reports restored achievements then another tab without implicit action`, async ({ page }) => {
      await (provider === 'claude' ? openClaude : openCodex)(page, { locale, fixture: 'achievement-records', width: 360 });
      await page.locator('#tab-achievements').click();
      await page.locator('[data-persist="achievement:records"] summary').click();
      await page.reload();
      await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-persist="achievement:records"]')).toHaveAttribute('open');
      const restored = await page.evaluate(() => window.__ccuPostedMessages);
      expect(restored.filter(message => message.command === 'localDataClientReady')).toEqual([
        { command: 'localDataClientReady', provider, activeTab: 'achievements', documentId: expect.stringMatching(/^[0-9a-f]{48}$/) },
      ]);
      for (const command of ['tabChanged', 'achievementNoticeAck', 'setAchievementPinned', 'previewAchievementShare',
        'exportAchievementShare', 'refresh', 'updateSetting']) expect(restored.map(message => message.command)).not.toContain(command);
      await page.locator('#tab-month').click();
      await page.reload();
      await expect(page.locator('#tab-month')).toHaveAttribute('aria-selected', 'true');
      expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'localDataClientReady'))).toEqual([
        { command: 'localDataClientReady', provider, activeTab: 'month', documentId: expect.stringMatching(/^[0-9a-f]{48}$/) },
      ]);
    });
  }
}

test('compare readiness reports its actual all panel despite an old achievement preference', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-records' });
  await page.locator('#tab-achievements').click();
  await openCompare(page);
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'localDataClientReady'))).toEqual([
    { command: 'localDataClientReady', provider: 'compare', activeTab: 'all', documentId: expect.stringMatching(/^[0-9a-f]{48}$/) },
  ]);
});
