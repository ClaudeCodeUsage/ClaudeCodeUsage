import { test, expect, openCodex } from './support/app.mjs';

test('pin button sends a generation-bound preference only and failures stay inline', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-records', width: 360 });
  await page.locator('#tab-achievements').click();
  await page.locator('[data-achievement-key="local-share-export"] summary').click();
  const button = page.locator('#achievement-pin-local-share-export');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { window.__ccuPostedMessages = []; });
  await button.focus(); await button.press('Enter');
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([
    { command: 'setAchievementPinned', key: 'local-share-export', selected: true, generation: 1 },
  ]);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementPinResult', key: 'local-share-export', ok: false, reason: 'limit',
  } })));
  await expect(page.locator('#achievementPinStatus')).toHaveText('Pin up to 3 badges.');
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a host-confirmed pin patch keeps focus, disclosure, anchor and share state then hydrates after reload', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-records', width: 360, height: 600 });
  await page.locator('#tab-achievements').click();
  await page.locator('[data-achievement-key="local-share-export"] summary').click();
  const button = page.locator('#achievement-pin-local-share-export');
  await button.focus(); await button.press('Enter');
  const confirmedUrl = new URL(page.url()); confirmedUrl.searchParams.set('fixture', 'achievement-pins');
  const response = await page.context().request.get(confirmedUrl.href);
  expect(response.ok()).toBe(true);
  const nextHtml = await response.text();
  const before = await page.evaluate(nextHtml => {
    // Browser bridge receives a fresh production-renderer fixture; real filesystem
    // save and reopen are covered by the paired provider test, not this fake host.
    const next = new DOMParser().parseFromString(nextHtml, 'text/html').getElementById('provider-panel');
    const button = document.getElementById('achievement-pin-local-share-export');
    window.__pinDocument = document.documentElement;
    const state = { top: button.getBoundingClientRect().top, share: localStorage.getItem('ccu.sharing.achievementBadges') };
    window.__ccuPostedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'dashboardDataPatch', provider: 'codex', tab: 'achievements', revision: 1,
      html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {},
    } }));
    return state;
  }, nextHtml);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toBeFocused();
  await expect(page.locator('[data-achievement-key="local-share-export"] details')).toHaveAttribute('open');
  await expect(page.locator('[data-achievement-overview="badges"] button').first()).toHaveAttribute('data-achievement-open', 'local-share-export');
  await page.clock.runFor(200);
  const after = await page.evaluate(() => ({ top: document.getElementById('achievement-pin-local-share-export').getBoundingClientRect().top,
    sameDocument: document.documentElement === window.__pinDocument, share: localStorage.getItem('ccu.sharing.achievementBadges'),
    commands: window.__ccuPostedMessages.map(message => message.command) }));
  expect(after.sameDocument).toBe(true);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
  expect(after.share).toBe(before.share);
  for (const command of ['refresh', 'achievementNoticeAck', 'previewAchievementShare', 'exportAchievementShare'])
    expect(after.commands).not.toContain(command);
  await page.goto(confirmedUrl.href); await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-achievement-key="local-share-export"] details')).toHaveAttribute('open');
  await button.click();
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'setAchievementPinned'))).toEqual([
    { command: 'setAchievementPinned', key: 'local-share-export', selected: false, generation: 1 },
  ]);
});

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} pin actions and errors fit narrow themes with no raw host error`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) {
      await openCodex(page, { fixture: 'achievement-pins', locale, theme, width: 320 });
      await page.locator('#tab-achievements').click();
      const detail = page.locator('[data-achievement-key="local-share-export"] details');
      if (!await detail.evaluate(element => element.open)) await detail.locator('summary').click();
      const button = page.locator('#achievement-pin-local-share-export');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.focus();
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'achievementPinResult', key: 'local-share-export', ok: false, reason: 'failed', message: '/private/raw/path',
      } })));
      await expect(page.locator('#achievementPinStatus')).not.toBeEmpty();
      await expect(page.locator('#achievementPinStatus')).not.toContainText('/private/raw/path');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`pins-${locale}-${theme}.png`) });
    }
  });
}
