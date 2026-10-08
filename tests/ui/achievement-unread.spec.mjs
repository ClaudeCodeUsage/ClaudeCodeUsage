import { test, expect, openCodex } from './support/app.mjs';

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} unread group stays folded until opened, sends explicit bounded confirmation and survives reload`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) {
      await openCodex(page, { locale, theme, fixture: 'achievement-records', width: 320 });
      await page.evaluate(() => localStorage.removeItem('__ccu-vscode-state'));
      await page.reload();
      await page.locator('#tab-achievements').click();
      const group = page.locator('[data-persist="achievement:unread"]');
      await expect(group).not.toHaveAttribute('open');
      await group.locator('summary').click();
      await expect(group.locator('[data-achievement-record]')).toHaveCount(4);
      for (const image of await group.locator('img').all())
        expect(await image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
      await page.reload();
      await expect(group).toHaveAttribute('open');
      expect(await page.evaluate(() => window.__ccuPostedMessages.some(message => message.command === 'achievementSummaryAck'))).toBe(false);
      const button = page.locator('#achievement-unread-read');
      const id = await button.getAttribute('data-achievement-summary');
      await page.evaluate(() => { window.__ccuPostedMessages = []; });
      await button.focus(); await button.press('Enter');
      const messages = await page.evaluate(() => window.__ccuPostedMessages);
      expect(messages).toEqual([{ command: 'achievementSummaryAck', summaryId: id,
        documentId: expect.stringMatching(/^[0-9a-f]{48}$/) }]);
      await expect(group.locator('[data-achievement-record]')).toHaveCount(4, 'no optimistic read before durable host patch');
      await page.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'achievementSummaryResult', ...message, ok: false, rawError: '/private/path/canary',
      } })), { summaryId: id, documentId: messages[0].documentId });
      await expect(page.locator('#achievementUnreadStatus')).not.toBeEmpty();
      await expect(page.locator('#achievementUnreadStatus')).not.toContainText('/private/path/canary');
      await expect(button).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`unread-${locale}-${theme}.png`) });
    }
  });
}

test('a host-confirmed final group patch keeps gallery and share state and returns focus to the tab', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-records', width: 360, height: 600 });
  await page.locator('#tab-achievements').click();
  await page.locator('[data-persist="achievement:unread"] summary').click();
  const button = page.locator('#achievement-unread-read');
  await button.focus(); await button.press('Enter');
  const url = new URL(page.url()); url.searchParams.set('fixture', 'achievement-records-read');
  const response = await page.context().request.get(url.href); expect(response.ok()).toBe(true);
  // This browser bridge simulates a persisted host response. Provider tests perform real filesystem save/reopen.
  const old = await page.evaluate(html => {
    const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
    window.__unreadDocument = document.documentElement;
    const state = localStorage.getItem('ccu.sharing.achievementBadges');
    window.__ccuPostedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
      tab: 'achievements', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
    return state;
  }, await response.text());
  await expect(page.locator('[data-persist="achievement:unread"]')).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(page.locator('#tab-achievements')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement === window.__unreadDocument)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('ccu.sharing.achievementBadges'))).toBe(old);
  expect(await page.evaluate(() => window.__ccuPostedMessages.map(message => message.command))).toEqual(['dashboardDataPatchAck']);
  await page.goto(url.href); await page.reload();
  await expect(page.locator('[data-persist="achievement:unread"]')).toHaveCount(0);
  await expect(page.locator('[data-achievement-overview="recent"]')).toBeVisible();
});

test('retired or unrelated summary error cannot change the current status', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-records' });
  await page.locator('#tab-achievements').click();
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementSummaryResult', summaryId: 'retired', documentId: 'retired', ok: false,
  } })));
  await expect(page.locator('#achievementUnreadStatus')).toBeEmpty();
});
