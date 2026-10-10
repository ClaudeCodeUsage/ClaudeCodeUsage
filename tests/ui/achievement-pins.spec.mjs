import { test, expect, openCodex, openClaude } from './support/app.mjs';

const unpinLabels = {
  en: 'Unpin badge', 'de-DE': 'Abzeichen lösen', 'zh-TW': '取消固定', 'zh-CN': '取消固定',
  ja: '固定を解除', ko: '고정 해제', 'pt-BR': 'Desafixar medalha', id: 'Lepas sematan',
};

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} hidden pins can be removed with disabled Codex and no implicit side effects`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) {
      await openClaude(page, { fixture: 'achievement-hidden-pins', claudeOnly: true, locale, theme, width: 320, height: 360 });
      // Theme iterations start fresh; reload preservation is asserted separately below.
      await page.evaluate(() => localStorage.removeItem('__ccu-vscode-state'));
      await page.reload();
      await page.locator('#tab-achievements').click();
      const manager = page.locator('[data-persist="achievement:hidden-pins"]');
      await expect(manager).not.toHaveAttribute('open');
      await manager.locator('summary').click();
      await expect(manager.locator('button')).toHaveCount(3);
      await expect(page.locator('[data-achievement-key="astra-regular"]')).toHaveCount(0);
      const button = page.locator('#achievement-unpin-astra-regular');
      await page.evaluate(() => { window.__ccuPostedMessages = []; });
      await button.focus(); await button.press('Enter');
      expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([
        { command: 'setAchievementPinned', key: 'astra-regular', selected: false, generation: 1,
          documentId: expect.stringMatching(/^[0-9a-f]{48}$/) },
      ]);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'achievementPinResult', key: 'astra-regular', ok: false, reason: 'failed', message: '/private/raw/path',
      } })));
      await expect(page.locator('#achievementPinStatus')).not.toBeEmpty();
      await expect(page.locator('#achievementPinStatus')).not.toContainText('/private/raw/path');
      await expect(button).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`hidden-pins-${locale}-${theme}.png`) });
      // Renderer fixtures simulate durable host state; provider tests reopen a real isolated store.
      const confirmedUrl = new URL(page.url()); confirmedUrl.searchParams.set('fixture', 'achievement-hidden-pins-released');
      const response = await page.context().request.get(confirmedUrl.href);
      expect(response.ok()).toBe(true);
      // Leave scroll headroom: deleting inline feedback at scrollY=0 cannot
      // preserve an anchor's old position because browsers clamp negative scrolling.
      await manager.locator('summary').evaluate(element => element.scrollIntoView({ block: 'center' }));
      await page.clock.runFor(200);
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(40);
      const summaryTop = await manager.locator('summary').evaluate(element => element.getBoundingClientRect().top);
      await page.evaluate(nextHtml => {
        const next = new DOMParser().parseFromString(nextHtml, 'text/html').getElementById('provider-panel');
        window.__ccuPostedMessages = [];
        window.__hiddenPinDocument = document.documentElement;
        window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'claude',
          tab: 'achievements', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
      }, await response.text());
      await expect(button).toHaveCount(0);
      await expect(manager).toHaveAttribute('open');
      await expect(manager.locator('button')).toHaveCount(2);
      await page.clock.runFor(200);
      await expect(manager.locator('summary')).toBeFocused();
      expect(Math.abs(await manager.locator('summary').evaluate(element => element.getBoundingClientRect().top) - summaryTop)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement === window.__hiddenPinDocument)).toBe(true);
      const commands = await page.evaluate(() => window.__ccuPostedMessages.map(message => message.command));
      for (const command of ['refresh', 'achievementNoticeAck', 'previewAchievementShare', 'exportAchievementShare', 'updateSetting'])
        expect(commands).not.toContain(command);
      await page.goto(confirmedUrl.href); await page.reload();
      await expect(manager).toHaveAttribute('open');
      await expect(manager.locator('button')).toHaveCount(2);
    }
  });
}

test('removing the final hidden pin returns keyboard focus to achievements without refresh or consent', async ({ page }) => {
  await openClaude(page, { fixture: 'achievement-hidden-pins-last', claudeOnly: true, width: 320 });
  await page.locator('#tab-achievements').click();
  await page.locator('[data-persist="achievement:hidden-pins"] summary').click();
  await page.locator('#achievement-unpin-astra-regular').focus();
  await page.locator('#achievement-unpin-astra-regular').press('Enter');
  const confirmedUrl = new URL(page.url()); confirmedUrl.searchParams.set('fixture', 'achievement-records');
  const response = await page.context().request.get(confirmedUrl.href);
  expect(response.ok()).toBe(true);
  await page.evaluate(nextHtml => {
    const next = new DOMParser().parseFromString(nextHtml, 'text/html').getElementById('provider-panel');
    window.__ccuPostedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'claude',
      tab: 'achievements', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
  }, await response.text());
  await expect(page.locator('[data-persist="achievement:hidden-pins"]')).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(page.locator('#tab-achievements')).toBeFocused();
  expect(await page.evaluate(() => window.__ccuPostedMessages.map(message => message.command))).toEqual(['dashboardDataPatchAck']);
});

test('pin button sends a generation-bound preference only and failures stay inline', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-records', width: 360 });
  await page.locator('#tab-achievements').click();
  const card = page.locator('.achievement-card[data-achievement-key="local-share-export"]');
  const button = page.locator('#achievement-pin-local-share-export');
  await expect(card.locator('details')).not.toHaveAttribute('open');
  await expect(button).toBeVisible();
  await expect(card.locator(':scope > .achievement-card-pins > button')).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-label', `Pin badge: ${await card.locator('h4').textContent()}`);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { window.__ccuPostedMessages = []; });
  await button.focus(); await button.press('Enter');
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([
    { command: 'setAchievementPinned', key: 'local-share-export', selected: true, generation: 1,
      documentId: expect.stringMatching(/^[0-9a-f]{48}$/) },
  ]);
  await expect(card.locator('details')).not.toHaveAttribute('open');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementPinResult', key: 'local-share-export', ok: false, reason: 'limit',
  } })));
  await expect(page.locator('#achievementPinStatus')).toHaveText('Pin up to 6 badges.');
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
  const showcaseBadge = page.locator('[data-achievement-overview="badges"] .achievement-overview-badge').first();
  await expect(showcaseBadge).toHaveAttribute('data-achievement-open', 'local-share-export');
  const showcasePin = showcaseBadge.locator('..').locator('[data-achievement-pin="local-share-export"]');
  await expect(showcasePin).toBeVisible();
  await expect(showcasePin).toHaveAttribute('aria-pressed', 'true');
  await expect(showcasePin).toHaveAttribute('aria-label', `Unpin badge: ${await showcaseBadge.locator('.achievement-overview-name').textContent()}`);
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
    { command: 'setAchievementPinned', key: 'local-share-export', selected: false, generation: 1,
      documentId: expect.stringMatching(/^[0-9a-f]{48}$/) },
  ]);
});

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} pin actions and errors fit narrow themes with no raw host error`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) {
      await openCodex(page, { fixture: 'achievement-pins', locale, theme, width: 320 });
      await page.locator('#tab-achievements').click();
      const card = page.locator('.achievement-card[data-achievement-key="local-share-export"]');
      const detail = card.locator('details');
      if (await detail.evaluate(element => element.open)) await detail.locator('summary').click();
      const button = page.locator('#achievement-pin-local-share-export');
      await expect(detail).not.toHaveAttribute('open');
      await expect(button).toBeVisible();
      await expect(card.locator(':scope > .achievement-card-pins > button')).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-label', `${unpinLabels[locale]}: ${await card.locator('h4').textContent()}`);
      await detail.locator('summary').click();
      await expect(detail).toHaveAttribute('open');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.focus();
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'achievementPinResult', key: 'local-share-export', ok: false, reason: 'failed', message: '/private/raw/path',
      } })));
      await expect(page.locator('#achievementPinStatus')).not.toBeEmpty();
      await expect(page.locator('#achievementPinStatus')).not.toContainText('/private/raw/path');
      await expect(button).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`pins-${locale}-${theme}.png`) });
    }
  });
}
