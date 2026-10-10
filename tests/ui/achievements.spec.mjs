import { test, expect, openCodex, openCompare } from './support/app.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ACHIEVEMENT_COPY } = require('../../out/i18n.js');
const { renderAchievementShareSvg } = require('../../out/achievementShare.js');
const { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } = require('../../out/achievements.js');
const { ACHIEVEMENT_GALLERY } = require('../../out/achievementGallery.js');

function shareSvg(selected, copy) {
  return renderAchievementShareSvg({ selected, titles: copy.titles, heading: copy.shareTitle,
    subtitle: copy.intro, groups: copy.groups, levels: copy.levels, milestone: copy.milestone, footer: copy.heading });
}

// Renderer-only layout coverage supplies canonical IDs in the visible sharing
// host. These synthetic choices say nothing about personal earned eligibility.
async function selectRendererIds(page, selected) {
  expect(new Set(selected).size).toBe(selected.length);
  expect(selected.length).toBeLessThanOrEqual(9);
  expect(selected.every(id => ACHIEVEMENT_DEFINITIONS.some(rule => rule.id === id))).toBe(true);
  const host = page.locator('.achievement-share-presentation');
  await expect(host).toBeVisible();
  await host.locator('fieldset').evaluate((fieldset, selected) => {
    fieldset.querySelectorAll('label, .achievement-share-choice').forEach(element => element.remove());
    for (const id of selected) {
      const label = document.createElement('label');
      label.className = 'sc-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'achievement-share-choice';
      input.value = id;
      input.addEventListener('change', () => window.previewAchievementShare(input));
      label.append(input, document.createTextNode(id));
      fieldset.append(label);
    }
  }, selected);
  for (const id of selected) await host.locator(`.achievement-share-choice[value="${id}"]`).check();
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages
    .filter(message => message.command === 'previewAchievementShare').at(-1)?.ids)).toEqual(selected);
}

async function acceptAchievementSvg(page, svg) {
  await page.evaluate(svg => {
    const request = window.__ccuPostedMessages.filter(message =>
      ['previewAchievementShare', 'restoreAchievementShare'].includes(message.command)).at(-1);
    if (!request) throw new Error('fixture needs a matching preview request');
    const checked = [...document.querySelectorAll('.achievement-share-choice:checked')].map(input => input.value);
    const badges = [...new DOMParser().parseFromString(svg, 'image/svg+xml')
      .querySelectorAll('g[data-achievement-share-badge]')].map(badge => badge.getAttribute('data-achievement-share-badge'));
    if (JSON.stringify(request.ids) !== JSON.stringify(checked) ||
        JSON.stringify(request.ids) !== JSON.stringify(badges)) {
      throw new Error('preview selection, host request and SVG badge IDs must match');
    }
    window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'achievementShareResult', clientId: request.clientId, requestId: request.requestId,
      ids: request.ids, previewId: 'synthetic-preview', svg,
    } }));
  }, svg);
}

test('achievements are on by default and remain selected after reload', async ({ page }, testInfo) => {
  await openCodex(page, { theme: 'dark' });
  await expect(page.locator('#tab-achievements')).toBeVisible();
  await page.locator('#tab-achievements').click();
  await expect(page.locator('#achievements')).toBeVisible();
  // Tiered series occupy one card, including the five-level cumulative ladder.
  await expect(page.locator('.achievement-card')).toHaveCount(ACHIEVEMENT_GALLERY.length);
  await expect(page.locator('.achievement-card img[data-achievement-icon]')).toHaveCount(ACHIEVEMENT_GALLERY.length);
  await expect(page.locator('.achievement-count')).toContainText(`/ ${ACHIEVEMENT_DEFINITIONS.length}`);
  expect(await page.locator('.achievement-card').evaluateAll(cards =>
    cards.map(card => card.getAttribute('data-achievement-series') ?? card.getAttribute('data-achievement-id')).sort()))
    .toEqual(ACHIEVEMENT_GALLERY.map(entry => entry.key).sort());
  await expect(page.locator('[data-achievement-id="astra-regular"]')).toContainText('Astra regular');
  await expect(page.locator('[data-achievement-series="effort-breadth"]')).toContainText('Effort explorer');
  await page.locator('#achievements').screenshot({ path: testInfo.outputPath('achievements-dark.png') });
  await page.reload();
  await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#achievements')).toBeVisible();
});

test('saved tier badges retain readable title contrast in the dark gallery', async ({ page }) => {
  // Default incomplete usage has no earned tier. Use an existing fixture with
  // explicit saved records for this visual assertion.
  await openCodex(page, { theme: 'dark', fixture: 'achievement-six-pins' });
  await page.locator('#tab-achievements').click();
  await expect(page.locator('.achievement-card[data-achievement-series].earned').first()).toBeVisible();
  const tierTitleContrast = await page.locator('.achievement-card[data-achievement-series].earned').first()
    .evaluate((card) => {
      const channels = (color) => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number);
        return color.startsWith('color(srgb') ? values : values.map((value) => value / 255);
      };
      const luminance = (color) => channels(color).map((value) => {
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const foreground = luminance(getComputedStyle(card.querySelector('h4')).color);
      const background = luminance(getComputedStyle(card).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
  expect(tierTitleContrast).toBeGreaterThanOrEqual(7);
});

test('gallery leads with artwork and reveals numeric progress on demand', async ({ page }) => {
  await openCodex(page, { theme: 'dark' });
  await page.locator('#tab-achievements').click();
  const tile = page.locator('.achievement-card[data-achievement-proof="ready"]').first();
  const series = await tile.getAttribute('data-achievement-series');
  const detail = tile.locator('details[data-persist]');
  const icon = tile.locator('img[data-achievement-icon]');
  await expect(detail).not.toHaveAttribute('open');
  await expect(tile.locator('.achievement-progress-label')).toBeHidden();
  await expect(page.locator('#achievementSize')).toHaveValue('medium');
  expect(await icon.evaluate((element) => element.getBoundingClientRect().width)).toBe(80);
  await detail.locator('summary').click();
  await expect(detail).toHaveAttribute('open');
  await expect(tile.locator('.achievement-progress-label')).toBeVisible();
  await page.reload();
  await expect(page.locator(`[data-achievement-series="${series}"] details`)).toHaveAttribute('open');
});

test('turning achievements off removes its tab and setting remains available', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}/?provider=codex&achievementsEnabled=false`);
  await expect(page.locator('#tab-achievements')).toHaveCount(0);
  await page.locator('#tab-settings').click();
  await expect(page.locator('#set_enableAchievements')).not.toBeChecked();
});

test('earned badges join the preview-first sharing workspace without automatic export', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await page.locator('#sharingTemplate').selectOption('achievements');
  await expect(page.locator('.achievement-share-presentation')).toBeVisible();
  const count = await page.locator('.achievement-share-choice').count();
  expect(count).toBeGreaterThan(0);
  // Nothing is preselected for public-facing export, even if earned locally.
  await expect(page.locator('#achievementSharePreview > svg')).toHaveCount(0);
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
  await page.locator('.achievement-share-choice').first().check();
  const selectedId = await page.locator('.achievement-share-choice').first().inputValue();
  await expect.poll(async () => (await page.evaluate(() => window.__ccuPostedMessages))
    .some((message) => message.command === 'previewAchievementShare' &&
      message.ids.length === 1 && message.ids[0] === selectedId)).toBe(true);
  // This browser harness records host messages but does not run the extension
  // host; acknowledge its preview response explicitly.
  await acceptAchievementSvg(page, shareSvg([selectedId], ACHIEVEMENT_COPY.en));
  await expect(page.locator('#achievementSharePreview > svg')).toBeVisible();
  await expect(page.locator('#achievementSharePreview g[data-achievement-share-badge]'))
    .toHaveAttribute('data-achievement-share-badge', selectedId);
  await page.locator('.achievement-share-choice').first().uncheck();
  const firstId = await page.locator('.achievement-share-choice').first().inputValue();
  const posted = await page.evaluate(() => window.__ccuPostedMessages);
  expect(posted.some((message) => message.command === 'previewAchievementShare')).toBe(true);
  expect(posted.some((message) => message.command === 'exportAchievementShare')).toBe(false);
  await page.reload();
  await page.locator('#sharingTemplate').selectOption('achievements');
  await expect(page.locator(`.achievement-share-choice[value="${firstId}"]`)).not.toBeChecked();
});

test('restoring badge choices is display hydration, not a deliberate share preview', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await page.locator('#sharingTemplate').selectOption('achievements');
  const selectedId = await page.locator('.achievement-share-choice').first().inputValue();
  await page.evaluate((id) => {
    localStorage.setItem('ccu.sharing.achievementBadges', JSON.stringify([id]));
  }, selectedId);
  await page.reload();
  await expect(page.locator(`.achievement-share-choice[value="${selectedId}"]`)).toBeChecked();
  const restored = await page.evaluate(() => window.__ccuPostedMessages);
  expect(restored.some((message) => message.command === 'restoreAchievementShare' &&
    message.ids.includes(selectedId))).toBe(true);
  expect(restored.some((message) => message.command === 'previewAchievementShare')).toBe(false);
  await page.locator('.achievement-share-choice:checked').first().uncheck();
  await expect.poll(async () => (await page.evaluate(() => window.__ccuPostedMessages))
    .some((message) => message.command === 'previewAchievementShare')).toBe(true);
});

test('Codex-only users can reach the achievement presentation without Claude data', async ({ page }) => {
  await openCodex(page, { codexOnly: true });
  await page.locator('#tab-achievements').click();
  await page.getByRole('button', { name: 'Achievement card' }).click();
  await expect(page.locator('#all')).toBeVisible();
  await expect(page.locator('#sharingTemplate')).toHaveValue('achievements');
  const before = await page.evaluate(() => ({
    request: window.__ccuPostedMessages.findLast(message => message.command === 'sharingTemplateChanged'),
    documentId: window.__ccuPostedMessages.findLast(message => message.command === 'localDataClientReady').documentId,
    commands: window.__ccuPostedMessages.map(message => message.command),
  }));
  expect(before.request).toEqual({ command: 'sharingTemplateChanged', template: 'achievements' });
  expect(before.documentId).toMatch(/^[0-9a-f]{48}$/);
  // fakeHost response only, not real Extension Host/server integration. The
  // legacy commandTemplate route requires Claude records, so mirror only the
  // validated dashboard enum handler's state before calling the real renderer.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { renderHarness } = require('./support/render-harness.cjs');
  const { UsageWebviewProvider } = require('../../out/webview.js');
  const render = UsageWebviewProvider.prototype.getWebviewContent;
  let html;
  try {
    UsageWebviewProvider.prototype.getWebviewContent = function () {
      if (this.currentProvider !== 'codex' || this.providerAvailability.claude)
        throw new Error('fakeHost response must remain Codex-only');
      this.sharingTemplate = before.request.template;
      this.currentTab = 'all';
      return render.call(this);
    };
    html = await renderHarness({ provider: 'codex', codexOnly: true });
  } finally {
    UsageWebviewProvider.prototype.getWebviewContent = render;
  }
  const url = new URL(page.url());
  expect(url.searchParams.get('codexOnly')).toBe('true');
  url.searchParams.set('fakeHostTemplate', before.request.template);
  await page.route(url.href, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const response = await page.goto(url.href, { waitUntil: 'load' });
  expect(response.status()).toBe(200);
  const after = await page.evaluate(() => ({
    documentId: window.__ccuPostedMessages.findLast(message => message.command === 'localDataClientReady').documentId,
    commands: window.__ccuPostedMessages.map(message => message.command),
  }));
  expect(after.documentId).toMatch(/^[0-9a-f]{48}$/);
  expect(after.documentId).not.toBe(before.documentId);
  await expect(page.locator('#provider-tab-codex')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#all')).toBeVisible();
  await expect(page.locator('#sharingTemplate')).toHaveValue(before.request.template);
  await expect(page.locator('.achievement-share-presentation')).toBeVisible();
  await expect(page.locator('option[value="claudeShareCard"]')).toHaveAttribute('disabled', '');
  await expect(page.locator('option[value="claudeHeatmap"]')).toHaveAttribute('disabled', '');
  expect([...before.commands, ...after.commands].filter(command =>
    /^(previewAchievementShare|exportAchievementShare|buildShareCard|exportShareCard|previewCombinedHeatmap|exportCombinedHeatmap|publishHeatmap)$/.test(command))).toEqual([]);
});

test('share choices visibly enforce the nine-badge card capacity', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await page.locator('#sharingTemplate').selectOption('achievements');
  await page.evaluate(() => {
    const fieldset = document.querySelector('.achievement-share-presentation fieldset');
    for (let index = 0; index < 10; index += 1) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'achievement-share-choice';
      input.value = `test-${index}`;
      input.checked = true;
      fieldset.append(input);
    }
    window.previewAchievementShare();
  });
  await expect(page.locator('.achievement-share-choice:checked')).toHaveCount(9);
  await expect(page.locator('#achievementShareCount')).toHaveText('9/9');
  await expect(page.locator('.achievement-share-choice:not(:checked)').first()).toBeDisabled();
});

test('turning sharing off keeps achievements but removes the share action', async ({ page }) => {
  await openCodex(page, { shareStudio: false });
  await page.locator('#tab-achievements').click();
  await expect(page.locator('.achievement-card')).toHaveCount(ACHIEVEMENT_GALLERY.length);
  await expect(page.getByRole('button', { name: 'Achievement card' })).toHaveCount(0);
});

test('gallery sharing and notice dismissal remain keyboard-operated without focus theft', async ({ page }) => {
  // This fixture has evidenced earned badges. The incomplete Codex-only fixture
  // correctly presents an empty selector rather than inventing share choices.
  await openCodex(page, { fixture: 'combined-heatmap' });
  const galleryTab = page.locator('#tab-achievements');
  await galleryTab.focus();
  await galleryTab.press('Enter');
  await expect(page.locator('#achievements')).toBeVisible();
  const shareAction = page.getByRole('button', { name: 'Achievement card' });
  await shareAction.focus();
  await shareAction.press('Enter');
  // Provider navigation is a host request, not client-side fabrication of a
  // second provider panel. This harness records that boundary; load its real
  // Compare render to stand in for the Extension Host response.
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.some((message) =>
    message.command === 'providerChanged' && message.provider === 'compare' &&
    message.tab === 'all'))).toBe(true);
  await openCompare(page, { fixture: 'combined-heatmap' });
  await expect(page.locator('#sharingTemplate')).toHaveValue('achievements');
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.some((message) =>
    message.command === 'sharingTemplateChanged' && message.template === 'achievements'))).toBe(true);
  // The harness records host requests rather than executing them. Supply the
  // requested template's host response before testing its real controls.
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  const choice = page.locator('.achievement-share-choice').first();
  await choice.focus();
  await choice.press('Space');
  await expect(choice).toBeChecked();
  await expect(choice).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    data: { command: 'achievementUnlockNotice', text: 'New local badge' },
  })));
  const notice = page.locator('#ccuAchievementUnlockNotice');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveAttribute('aria-live', 'polite');
  await expect(choice).toBeFocused();
  const dismiss = notice.getByRole('button');
  await dismiss.focus();
  await expect(dismiss).toHaveAccessibleName(/\S/);
  await expect(dismiss).toBeFocused();
  await dismiss.press('Enter');
  await expect(notice).toHaveCount(0);
});

test('unlock notice is literal text, has no animation, and dismisses after six seconds', async ({ page }) => {
  await openCodex(page);
  const before = await page.evaluate(() => window.__ccuPostedMessages.length);
  const literalText = '<img src="invalid" onerror="alert(1)"> local badge';
  await page.evaluate((text) => window.dispatchEvent(new MessageEvent('message', {
    data: { command: 'achievementUnlockNotice', text },
  })), literalText);
  const notice = page.locator('#ccuAchievementUnlockNotice');
  await expect(notice.locator('span')).toHaveText(literalText);
  await expect(notice.locator('img')).toHaveCount(0);
  expect(await notice.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await page.clock.runFor(6001);
  await expect(notice).toHaveCount(0);
  expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(before);
});

test('unlock notice reuses a bundled gallery icon even when its PNG exceeds the old data URL cap', async ({ page }) => {
  await openCodex(page);
  await expect(page.locator('#tab-achievements')).not.toHaveAttribute('aria-selected', 'true');
  const artwork = 'codex-astra-regular.png';
  const galleryIcon = page.locator(`.achievement-card img[data-achievement-artwork="${artwork}"]`).first();
  await expect(galleryIcon).toHaveCount(1);
  await page.evaluate((iconFile) => window.dispatchEvent(new MessageEvent('message', {
    data: { command: 'achievementUnlockNotice', text: 'Astra unlocked', iconFile },
  })), artwork);
  const noticeIcon = page.locator('#ccuAchievementUnlockNotice img');
  await expect(noticeIcon).toBeVisible();
  await expect(noticeIcon).toHaveAttribute('src', await galleryIcon.getAttribute('src'));
});

test('a visible notice acknowledges exactly its opaque host token without moving focus', async ({ page }) => {
  await openCodex(page);
  const tab = page.locator('#tab-achievements');
  await tab.focus();
  const noticeId = 'a'.repeat(48);
  await page.evaluate((noticeId) => window.dispatchEvent(new MessageEvent('message', {
    data: { command: 'achievementUnlockNotice', text: 'Local badge', noticeId },
  })), noticeId);
  await expect(page.locator('#ccuAchievementUnlockNotice')).toBeVisible();
  await expect(tab).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.filter(row => row.command === 'achievementNoticeAck')))
    .toEqual([{ command: 'achievementNoticeAck', noticeId }]);
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { command: 'achievementNoticeDismiss' } })));
  await expect(page.locator('#ccuAchievementUnlockNotice')).toHaveCount(0);
});

test('notice timer pauses while keyboard focus or pointer is inside it', async ({ page }) => {
  await openCodex(page);
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    data: { command: 'achievementUnlockNotice', text: 'Local badge' },
  })));
  const notice = page.locator('#ccuAchievementUnlockNotice');
  await notice.getByRole('button').focus();
  await page.clock.runFor(6001);
  await expect(notice).toBeVisible();
  await page.locator('#tab-achievements').focus();
  await notice.hover();
  await page.clock.runFor(6001);
  await expect(notice).toBeVisible();
  await page.locator('#tab-achievements').hover();
  await page.clock.runFor(6001);
  await expect(notice).toHaveCount(0);
});

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  for (const theme of ['light', 'dark']) {
    test(`${locale} exported achievement levels stay inside the ${theme} narrow preview`, async ({ page }, testInfo) => {
      await openCompare(page, { locale, theme, fixture: 'combined-heatmap', commandTemplate: 'achievements', width: 360 });
      const copy = ACHIEVEMENT_COPY[locale];
      const cumulative = ACHIEVEMENT_SERIES['cumulative-volume'];
      const longest = Object.keys(copy.titles).filter((id) => !cumulative.includes(id))
        .sort((left, right) => copy.titles[right].length - copy.titles[left].length).slice(0, 4);
      const selected = [...cumulative, ...longest];
      // Actual production SVG, not a placeholder host acknowledgement. Rules
      // determining earned selection are covered by host/unit tests separately.
      const svg = shareSvg(selected, copy);
      await selectRendererIds(page, selected);
      await acceptAchievementSvg(page, svg);
      const preview = page.locator('#achievementSharePreview > svg');
      await expect(preview).toBeVisible();
      await expect(preview.locator('g[data-achievement-share-badge]')).toHaveCount(9);
      expect(await preview.locator('g[data-achievement-share-badge]').evaluateAll(badges =>
        badges.map(badge => badge.getAttribute('data-achievement-share-badge')))).toEqual(selected);
      const overflows = await preview.evaluate((svg) => {
        const bounds = svg.viewBox.baseVal;
        const outside = (box, area) => box.x < area.x - 1 || box.y < area.y - 1 ||
          box.x + box.width > area.x + area.width + 1 || box.y + box.height > area.y + area.height + 1;
        const failures = [];
        for (const text of svg.querySelectorAll('text')) {
          const badge = text.closest('g[data-achievement-share-badge]');
          const area = badge ? badge.querySelector('rect').getBBox() : bounds;
          if (outside(text.getBBox(), area)) failures.push(text.textContent);
        }
        return failures;
      });
      expect(overflows).toEqual([]);
      for (const label of copy.levels) await expect(preview).toContainText(label);
      await expect(preview).not.toContainText('local achievement milestones');
      if (locale === 'zh-CN') await preview.screenshot({ path: testInfo.outputPath(`achievement-share-levels-${theme}.png`) });
    });

    test(`${locale} achievement cards fit a narrow ${theme} webview`, async ({ page }, testInfo) => {
      await openCodex(page, { locale, theme, width: 360, height: 800 });
      await page.locator('#tab-achievements').click();
      const weeklyTitle = await page.locator('[data-achievement-series="weekly-volume"] h4').textContent();
      expect(weeklyTitle).not.toContain(ACHIEVEMENT_COPY[locale].levels[0]);
      const sizes = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        cards: [...document.querySelectorAll('.achievement-card')].map((card) => card.scrollWidth - card.clientWidth),
      }));
      expect(sizes.document, sizes).toBeLessThanOrEqual(sizes.viewport + 1);
      expect(sizes.body, sizes).toBeLessThanOrEqual(sizes.viewport + 1);
      expect(sizes.cards.every((overflow) => overflow <= 1), sizes).toBe(true);
      const icons = page.locator('.achievement-card img[data-achievement-icon]');
      await expect(icons).toHaveCount(ACHIEVEMENT_GALLERY.length);
      // Walk the gallery in small batches, preserving production lazy loading.
      // Offscreen PNGs must decode before a full-gallery evidence screenshot;
      // capturing first would show blank emblems that are not a product defect.
      const galleryIcons = await icons.all();
      for (let index = 0; index < galleryIcons.length; index += 4) {
        await galleryIcons[index].scrollIntoViewIfNeeded();
      }
      await galleryIcons.at(-1).scrollIntoViewIfNeeded();
      await expect.poll(() => icons.evaluateAll((images) =>
        images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
      if (locale === 'zh-CN') {
        await galleryIcons[0].scrollIntoViewIfNeeded();
        await page.locator('#achievements').screenshot({
          path: testInfo.outputPath(`achievements-zh-CN-${theme}.png`),
        });
      }
    });
  }
}
