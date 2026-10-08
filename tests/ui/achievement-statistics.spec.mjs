import { test, expect, openCodex, openClaude } from './support/app.mjs';

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} current-statistics return stays readable and keeps local state in both providers and themes`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) for (const [open, provider, key, section] of [
      [openClaude, 'claude', 'claude-output', 'tokens'], [openCodex, 'codex', 'sol-regular', 'models'],
    ]) {
      await open(page, { fixture: 'complete-index', width: 320, locale, theme });
      await page.evaluate(() => localStorage.removeItem('__ccu-vscode-state')); await page.reload();
      await page.locator('#tab-achievements').click();
      const card = page.locator('[data-achievement-key="' + key + '"]');
      await card.locator('summary').focus(); await card.locator('summary').press('Enter');
      const button = page.locator('#achievement-statistics-' + key);
      await expect(button).toHaveAttribute('data-statistics-section', section);
      await button.focus(); await page.clock.runFor(250);
      const share = await page.evaluate(() => localStorage.getItem('ccu.sharing.achievementBadges'));
      await page.evaluate(() => { window.__ccuPostedMessages = []; });
      await button.press('Enter');
      await expect(page.locator('#tab-all')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#achievement-statistics-target')).toBeFocused();
      await page.clock.runFor(250);
      await page.reload();
      await expect(page.locator('#achievement-statistics-back')).toBeVisible();
      await page.locator('#achievement-statistics-back').focus(); await page.locator('#achievement-statistics-back').press('Enter');
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(button).toBeFocused(); await page.clock.runFor(250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('ccu.sharing.achievementBadges'))).toBe(share);
      await card.screenshot({ path: testInfo.outputPath(`statistics-${provider}-${locale}-${theme}.png`) });
      const commands = await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command));
      for (const command of ['refresh', 'previewAchievementShare', 'exportAchievementShare', 'achievementNoticeAck', 'updateSetting'])
        expect(commands).not.toContain(command);
      await page.reload(); await expect(card.locator('details')).toHaveAttribute('open');
      await button.click(); await page.locator('#tab-today').click(); await page.locator('#tab-all').click();
      await expect(page.locator('#achievement-statistics-back')).toBeHidden();
    }
  });
}

test('tampered, cross-provider and unavailable statistics intents cannot navigate or refresh', async ({ page }) => {
  await openCodex(page, { fixture: 'complete-index' });
  await page.locator('#tab-achievements').click();
  for (const key of ['weekly-volume', 'cumulative-volume', 'safe-feature-explorer'])
    await expect(page.locator('#achievement-statistics-' + key)).toHaveCount(0);
  await page.evaluate(() => {
    window.__ccuPostedMessages = [];
    for (const intent of [{ provider: 'claude', key: 'sol-regular' }, { provider: 'codex', key: '../../private' },
      { provider: 'codex', key: '__proto__' }, { provider: 'codex', key: 'weekly-volume' }]) {
      ccuWriteUiState('achievementStatisticsReturn', intent);
      restoreAchievementStatisticsReturn(); backFromAchievementStatistics();
    }
  });
  await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#achievement-statistics-back')).toBeHidden();
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([]);
});

test('statistics patch keeps target focus, saved disclosure and return without reopening logs', async ({ page }) => {
  await openCodex(page, { fixture: 'complete-index', width: 360 });
  await page.locator('#tab-achievements').click();
  await page.locator('[data-achievement-key="sol-regular"] summary').click();
  await page.locator('#achievement-statistics-sol-regular').click();
  const response = await page.context().request.get(page.url()); expect(response.ok()).toBe(true);
  await page.evaluate(html => {
    window.__ccuPostedMessages = [];
    const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
      tab: 'all', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
  }, await response.text());
  await page.clock.runFor(250);
  await expect(page.locator('#achievement-statistics-target')).toBeFocused();
  await expect(page.locator('#achievement-statistics-back')).toBeVisible();
  expect(await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command))).toEqual(['dashboardDataPatchAck']);
  await page.locator('#achievement-statistics-back').click();
  await expect(page.locator('#achievement-statistics-sol-regular')).toBeFocused();
  await expect(page.locator('[data-achievement-key="sol-regular"] details')).toHaveAttribute('open');
});

test('switching badge destinations retires the old target identity and revoked links return focus safely', async ({ page }) => {
  await openCodex(page, { fixture: 'complete-index', width: 360 });
  await page.locator('#tab-achievements').click();
  await page.locator('[data-achievement-key="sol-regular"] summary').click();
  await page.locator('#achievement-statistics-sol-regular').click();
  await page.locator('#achievement-statistics-back').click();
  await page.locator('[data-achievement-key="codex-output"] summary').click();
  await page.locator('#achievement-statistics-codex-output').click();
  await expect(page.locator('#achievement-statistics-target')).toHaveCount(1);
  await expect(page.locator('#all .summary-grid')).toHaveAttribute('id', 'achievement-statistics-target');
  await page.locator('#achievement-statistics-back').click();
  await page.locator('#achievement-statistics-sol-regular').click();
  const changed = new URL(page.url()); changed.searchParams.set('fixture', 'unknown-models');
  const response = await page.context().request.get(changed.href); expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain('id="achievement-statistics-sol-regular"');
  await page.evaluate(html => {
    const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
    window.__ccuPostedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
      tab: 'all', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
  }, await response.text());
  await page.clock.runFor(250);
  await expect(page.locator('#achievement-statistics-back')).toBeHidden();
  await expect(page.locator('#tab-all')).toBeFocused();
  expect(await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command))).toEqual(['dashboardDataPatchAck']);
});

test('Codex current statistics keeps badge disclosure and keyboard return across reload without implicit work', async ({ page }) => {
  await openCodex(page, { fixture: 'complete-index', width: 360 });
  await page.locator('#tab-achievements').click();
  const card = page.locator('[data-achievement-key="sol-regular"]');
  await card.locator('summary').click();
  const link = page.locator('#achievement-statistics-sol-regular');
  await expect(link).toBeVisible();
  await link.focus();
  await page.evaluate(() => { window.__ccuPostedMessages = []; });
  await link.press('Enter');
  await expect(page.locator('#tab-all')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#all .model-breakdown h3').first()).toBeFocused();
  await expect(page.locator('#achievement-statistics-back')).toBeVisible();
  for (const command of ['refresh', 'previewAchievementShare', 'exportAchievementShare', 'achievementNoticeAck', 'updateSetting'])
    expect(await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command))).not.toContain(command);
  await page.reload();
  await expect(page.locator('#tab-all')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#achievement-statistics-back')).toBeVisible();
  await page.locator('#achievement-statistics-back').focus();
  await page.locator('#achievement-statistics-back').press('Enter');
  await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
  await expect(card.locator('details')).toHaveAttribute('open');
  await expect(link).toBeFocused();
});
