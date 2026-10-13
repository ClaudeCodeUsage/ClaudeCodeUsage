import { createRequire } from 'node:module';
import { test, expect, openClaude } from './support/app.mjs';

const require = createRequire(import.meta.url);
const { achievementCopyFor, achievementRecordStatusCopyFor } = require('../../out/i18n.js');
const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];

async function openReview(page, { locale, theme, width, fixture }) {
  // Normal server route: every load/reload gets fresh production HTML with
  // controlled synthetic host flags, without fabricated markup or DOM patches.
  await openClaude(page, { locale, theme, width, fixture, claudeOnly: true });
  const tab = page.locator('#tab-achievements');
  await tab.focus();
  await tab.press('Enter');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function expectNoImplicitActions(page) {
  const commands = await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command));
  expect(commands.filter(command => /^(?:refresh|updateSetting|setAchievementPinned|previewAchievementShare|exportAchievementShare|restoreAchievementShare|achievementNoticeAck|markAchievementGroupRead)$/.test(command))).toEqual([]);
}

async function expectFits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const locale of locales) for (const theme of ['light', 'dark']) for (const width of [320, 1280]) {
  test(`${locale} ${theme} ${width}: record loading/failure survive reload with keyboard settings and no empty awards`, async ({ page }, testInfo) => {
    const copy = achievementCopyFor(locale);
    const statusCopy = achievementRecordStatusCopyFor(locale);
    for (const [fixture, state] of [['achievement-review-loading', 'loading'], ['achievement-review-failure', 'unavailable']]) {
      await openReview(page, { locale, theme, width, fixture });
      const collection = page.locator('.achievement-collection');
      const status = collection.locator('.achievement-intro p[role]');
      const settings = collection.getByRole('button', { name: copy.settingsTitle, exact: true });
      const assertState = async () => {
        await expect(collection).toHaveAttribute('data-achievement-record-state', state);
        await expect(status).toHaveText(statusCopy[state]);
        await expect(status).toHaveAttribute('role', state === 'loading' ? 'status' : 'alert');
        if (state === 'loading') await expect(status).toHaveAttribute('aria-busy', 'true');
        else await expect(status).not.toHaveAttribute('aria-busy');
        await expect(collection).not.toContainText(/\b0\s*\/\s*0\b/);
        await expect(collection.locator('.achievement-count, .achievement-card, .achievement-filter-toolbar')).toHaveCount(0);
        await expect(collection.locator('[onclick="openAchievementShare()"]')).toHaveCount(0);
        await expect(collection.getByRole('button', { name: copy.shareTitle, exact: true })).toHaveCount(0);
        await expect(page.locator('.achievement-share-choice')).toHaveCount(0);
        await expect(settings).toBeVisible();
        await expectFits(page);
      };
      await assertState();
      if (locale === 'zh-CN' && theme === 'dark' && state === 'unavailable') {
        await collection.screenshot({ path: testInfo.outputPath(`record-failure-zh-CN-dark-${width}.png`), animations: 'disabled' });
      }
      await page.reload();
      await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
      await assertState();
      await expectNoImplicitActions(page);

      await settings.focus();
      await settings.press('Enter');
      await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true');
      // The accessible switch input is intentionally visually hidden; its
      // styled parent is the visible control, while the input owns focus.
      await expect(page.locator('#set_enableAchievements').locator('..')).toBeVisible();
      await expect(page.locator('#set_enableAchievements')).toBeFocused();
      await page.reload();
      await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true');
      await page.locator('#tab-achievements').focus();
      await page.locator('#tab-achievements').press('Enter');
      await assertState();
      await expectNoImplicitActions(page);
    }
  });

  test(`${locale} ${theme} ${width}: next overview names the silver target while the gallery retains earned bronze`, async ({ page }, testInfo) => {
    await openReview(page, { locale, theme, width, fixture: 'achievement-review-next-rank' });
    const copy = achievementCopyFor(locale);
    const next = page.locator('[data-achievement-overview="next"] [data-achievement-open="cumulative-volume"]');
    const card = page.locator('.achievement-card[data-achievement-key="cumulative-volume"]');
    const badge = page.locator('[data-achievement-overview="badges"] [data-achievement-open="cumulative-volume"]');
    const assertRanks = async () => {
      await expect(next).toBeVisible();
      await expect(next).toHaveAttribute('data-overview-rank', 'silver');
      await expect(next.locator('.achievement-overview-name')).toHaveText(copy.titles['billion-token-club']);
      await expect(next.locator('.achievement-overview-rank')).toHaveText(`${copy.nextTarget} · ${copy.levels[1]}`);
      await expect(next).toHaveAccessibleName(new RegExp(copy.titles['billion-token-club'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await expect(card).toHaveAttribute('data-achievement-earned', 'true');
      await expect(card).toHaveAttribute('data-achievement-tier', 'bronze');
      await expect(card.locator('h4')).toHaveText(copy.titles['hundred-million-club']);
      await expect(card.locator('.achievement-rank')).toHaveText(copy.levels[0]);
      await expect(badge).toHaveAttribute('data-overview-rank', 'bronze');
      await expect(badge.locator('.achievement-overview-rank')).toHaveText(copy.levels[0]);
      await expect(card.locator('.achievement-current-progress')).toHaveText('6M / 1B');
      await expectFits(page);
    };
    await assertRanks();
    if (locale === 'zh-CN' && theme === 'dark') {
      // Include the production section heading and target cards in one image.
      await page.locator('[data-achievement-overview="next"]').screenshot({
        path: testInfo.outputPath(`next-overview-zh-CN-dark-${width}.png`), animations: 'disabled',
      });
    }
    await next.focus();
    await next.press('Enter');
    await expect(card.locator('details')).toHaveAttribute('open');
    await expect(card.locator('summary')).toBeFocused();
    await page.reload();
    await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
    await expect(card.locator('details')).toHaveAttribute('open');
    await assertRanks();
    await expectNoImplicitActions(page);
  });
}
