import { test, expect, openCodex, openCompare } from './support/app.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ACHIEVEMENT_GALLERY } = require('../../out/achievementGallery.js');
const { ACHIEVEMENT_DEFINITIONS } = require('../../out/achievements.js');

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} milestones share one theme card and retain icons, exact rules and reload state`, async ({ page }, testInfo) => {
    for (const theme of ['light', 'dark']) {
      await openCodex(page, { fixture: 'achievement-theme-milestones', width: 320, locale, theme });
      await page.evaluate(() => localStorage.removeItem('__ccu-vscode-state'));
      await page.reload();
      await page.locator('#tab-achievements').click();
      await expect(page.locator('.achievement-card')).toHaveCount(ACHIEVEMENT_GALLERY.length);
      await expect(page.locator('.achievement-card [data-achievement-level]')).toHaveCount(ACHIEVEMENT_DEFINITIONS.length);
      const card = page.locator('[data-achievement-key="active-day-streak"]');
      await expect(card).toHaveAttribute('data-achievement-earned', 'true');
      await expect(card.locator('.achievement-tier-pip.complete')).toHaveCount(0);
      await expect(card).toHaveAttribute('data-achievement-tier', '');
      await expect(card.locator('summary img')).toHaveAttribute('data-achievement-icon', 'streak-machine');
      await page.evaluate(() => { window.__ccuPostedMessages = []; });
      const recent = page.locator('[data-achievement-overview="recent"]');
      await expect(recent.locator('button')).toHaveCount(2);
      const record = recent.locator('[data-achievement-record="streak-machine"]');
      await expect(record).toHaveAttribute('data-achievement-open', 'active-day-streak');
      await record.focus(); await record.press('Enter');
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(card.locator('summary')).toBeFocused();
      const milestone = card.locator('[data-achievement-milestone="streak-machine"]');
      await expect(milestone.locator('img')).toBeVisible();
      await expect(card.locator('[data-achievement-level]')).toHaveCount(4);
      await expect(card.locator('.achievement-tier-pip')).toHaveCount(3);
      expect(await milestone.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await page.clock.runFor(200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.screenshot({ path: testInfo.outputPath(`theme-${locale}-${theme}.png`) });
      const commands = await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command));
      for (const command of ['refresh', 'achievementNoticeAck', 'setAchievementPinned', 'previewAchievementShare', 'exportAchievementShare'])
        expect(commands).not.toContain(command);
      await page.reload();
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(card.locator('[data-achievement-pin="streak-machine"]')).toHaveAttribute('aria-pressed', 'true');
    }
  });
}

test('old milestone disclosure aliases and direct links reopen the canonical theme without host work', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-theme-milestones', width: 360 });
  await page.locator('#tab-achievements').click();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state'));
    localStorage.setItem('__ccu-vscode-state', JSON.stringify({ ...state, openDetails: ['achievement:streak-machine'] }));
  });
  await page.reload();
  const card = page.locator('[data-achievement-key="active-day-streak"]');
  await expect(card.locator('details')).toHaveAttribute('open');
  await card.locator('summary').click();
  await page.evaluate(() => { window.__ccuPostedMessages = []; window.openAchievementDetail('streak-machine'); });
  await expect(card.locator('details')).toHaveAttribute('open');
  await expect(card.locator('summary')).toBeFocused();
  await page.clock.runFor(200);
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([]);
  await page.reload();
  await expect(card.locator('details')).toHaveAttribute('open');
});

test('two legacy theme pins stay individually removable and a confirmed removal keeps disclosure after reload', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-theme-pins', width: 360 });
  await page.locator('#tab-achievements').click();
  const card = page.locator('[data-achievement-key="active-day-streak"]');
  await card.locator('summary').click();
  await expect(card.locator('[data-achievement-pin]')).toHaveCount(2);
  await expect(page.locator('[data-achievement-overview="badges"] [data-achievement-open="active-day-streak"]')).toHaveCount(1);
  await expect(page.locator('[data-persist="achievement:hidden-pins"]')).toHaveCount(0);
  const button = card.locator('[data-achievement-pin="streak-machine"]');
  const documentId = await page.evaluate(() => window.__ccuPostedMessages.findLast(
    message => message.command === 'localDataClientReady').documentId);
  expect(documentId).toMatch(/^[0-9a-f]{48}$/);
  await page.evaluate(() => { window.__ccuPostedMessages = []; });
  await button.focus(); await button.press('Enter');
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([
    { command: 'setAchievementPinned', key: 'streak-machine', selected: false, generation: 1, documentId },
  ]);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(200);
  const confirmedUrl = new URL(page.url()); confirmedUrl.searchParams.set('fixture', 'achievement-theme-pins-released');
  const response = await page.context().request.get(confirmedUrl.href);
  expect(response.ok()).toBe(true);
  await page.evaluate(nextHtml => {
    const next = new DOMParser().parseFromString(nextHtml, 'text/html').getElementById('provider-panel');
    window.__ccuPostedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
      tab: 'achievements', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
  }, await response.text());
  await expect(card.locator('[data-achievement-pin]')).toHaveCount(1);
  await expect(card.locator('[data-achievement-pin="active-day-streak"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('details')).toHaveAttribute('open');
  await page.clock.runFor(200);
  await expect(card.locator('summary')).toBeFocused();
  expect(await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command)))
    .not.toContain('refresh');
  await page.goto(confirmedUrl.href); await page.reload();
  await expect(card.locator('details')).toHaveAttribute('open');
  await expect(card.locator('[data-achievement-pin]')).toHaveCount(1);
});

test('merged display themes do not merge the exact legacy share choices or opt into export', async ({ page }) => {
  await openCompare(page, { fixture: 'achievement-theme-pins', commandTemplate: 'achievements' });
  for (const id of ['streak-machine', 'dual-provider-day', 'active-day-streak', 'dual-provider-days-bronze'])
    await expect(page.locator(`.achievement-share-choice[value="${id}"]`)).toHaveCount(1);
  await expect(page.locator('.achievement-share-choice:checked')).toHaveCount(0);
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
  const commands = await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command));
  for (const command of ['refresh', 'achievementNoticeAck', 'exportAchievementShare', 'updateSetting'])
    expect(commands).not.toContain(command);
});
