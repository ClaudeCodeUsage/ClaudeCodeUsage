import { createRequire } from 'node:module';
import { test, expect, openClaude, openCodex } from './support/app.mjs';

const require = createRequire(import.meta.url);
const { I18n, achievementCopyFor } = require('../../out/i18n.js');
const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
const themes = ['light', 'dark', 'highContrast'];
const ranks = ['bronze', 'silver', 'gold', 'platinum', 'legendary'];
const rowSelector = 'ol.achievement-level-rules > li';

async function openHistory(page, options = {}) {
  await openClaude(page, { fixture: 'achievement-management-history', claudeOnly: true, ...options });
  await page.locator('#tab-achievements').click();
  const card = page.locator('[data-achievement-key="sonnet-main"]');
  await card.locator('summary').focus();
  await card.locator('summary').press('Enter');
  return card;
}

async function expectNoImplicitActions(page) {
  const commands = await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command));
  expect(commands.filter(command =>
    /^(refresh|recalibrateAchievements|updateSetting|setAchievementPinned|editAchievementShowcase|achievementNoticeAck|markAchievementGroupRead|previewAchievementShare|exportAchievementShare|restoreAchievementShare)$/.test(command)
    || /grant/i.test(command))).toEqual([]);
}

async function expectCompactGeometry(page, card) {
  const rows = card.locator(rowSelector);
  await expect(rows).toHaveCount(5);
  expect(await rows.locator(':scope > strong.achievement-level-name').evaluateAll(nodes =>
    nodes.map(node => node.dataset.rank))).toEqual(ranks);
  await expect(rows.locator(':scope > span.achievement-level-value')).toHaveCount(5);
  const geometry = await rows.evaluateAll(nodes => nodes.map((row, index) => {
    const name = row.querySelector(':scope > strong.achievement-level-name');
    const value = row.querySelector(':scope > span.achievement-level-value');
    const box = row.getBoundingClientRect();
    const textBox = node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];
      return { top: rects[0].top, bottom: rects.at(-1).bottom,
        left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)),
        lines: new Set(rects.map(rect => Math.round(rect.top))).size };
    };
    // Zero-size inline probes measure the actual font baseline, not just the
    // outer grid-cell boxes (which can align while their text is stacked).
    const baseline = node => {
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
      node.append(probe);
      const y = probe.getBoundingClientRect().top;
      probe.remove();
      return y;
    };
    const style = getComputedStyle(row);
    return { name: textBox(name), value: textBox(value), baselineDelta: Math.abs(baseline(name) - baseline(value)),
      right: box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
      weight: Number(getComputedStyle(value).fontWeight),
      separator: index === 0 || (parseFloat(style.borderTopWidth) >= 1 && style.borderTopStyle !== 'none'
        && style.borderTopColor !== 'transparent' && style.borderTopColor !== 'rgba(0, 0, 0, 0)'),
      gap: index === 0 ? null : box.top - nodes[index - 1].getBoundingClientRect().bottom,
      overflow: row.scrollWidth > row.clientWidth + 1 };
  }));
  for (const [index, row] of geometry.entries()) {
    expect(row.name.lines, ranks[index] + ' name wraps').toBe(1);
    expect(row.value.lines, ranks[index] + ' threshold wraps').toBe(1);
    expect(row.baselineDelta, ranks[index] + ' baseline').toBeLessThanOrEqual(1.5);
    expect(row.name.right + 4, ranks[index] + ' name/value separation').toBeLessThanOrEqual(row.value.left);
    expect(Math.abs(row.value.right - row.right), ranks[index] + ' right alignment').toBeLessThanOrEqual(2);
    expect(row.weight, ranks[index] + ' bold threshold').toBeGreaterThanOrEqual(600);
    expect(row.separator, ranks[index] + ' visible row separator').toBe(true);
    if (index) expect(row.gap, ranks[index] + ' row separation').toBeGreaterThanOrEqual(6);
    expect(row.overflow).toBe(false);
  }
  expect(Math.max(...geometry.map(row => row.value.right)) - Math.min(...geometry.map(row => row.value.right)))
    .toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function expectSingleNext(card, index) {
  const rows = card.locator(rowSelector);
  await expect(rows.locator('small.achievement-level-status[data-level-status="next"]')).toHaveCount(1);
  await expect(rows.nth(index).locator('small.achievement-level-status[data-level-status="next"]')).toBeVisible();
  for (let i = index + 1; i < await rows.count(); i++) {
    await expect(rows.nth(i).locator('.achievement-level-status')).toHaveCount(0);
  }
}

// Cover every locale/theme, rotating width rather than multiplying by all
// three widths. Extra color and state cases below remain locale-independent.
for (const [localeIndex, locale] of locales.entries()) for (const [themeIndex, theme] of themes.entries()) {
  const width = [320, 360, 1280][(localeIndex + themeIndex) % 3];
  test(`${locale} ${theme} ${width}: compact ranks align and verified dates avoid repeated prefixes`, async ({ page }) => {
    I18n.setLanguage(locale);
    const management = I18n.achievementManagement;
    const card = await openHistory(page, { locale, theme, width });
    await expectCompactGeometry(page, card);
    await expect(card.locator(rowSelector).locator(':scope > strong.achievement-level-name'))
      .toHaveText(achievementCopyFor(locale).levels);
    await expectSingleNext(card, 2);
    for (const [id, day] of [['sonnet-main', '2026-06-01'], ['sonnet-main-silver', '2026-06-03']]) {
      const row = card.locator(`[data-achievement-level="${id}"]`);
      const date = row.locator('[data-date-source="retained-logs"]');
      await expect(date).toHaveText(day);
      await expect(date.locator('time')).toHaveAttribute('datetime', day);
      const accessibleSource = await date.evaluate(node => [node, ...node.querySelectorAll('time')]
        .flatMap(el => [el.getAttribute('title') || '', el.getAttribute('aria-label') || '']).join(' '));
      expect(accessibleSource).toContain(management.verifiedDay);
      await expect(row).not.toContainText(management.verifiedDay);
      await expect(row.locator('[data-date-source="first-recorded"]')).toHaveCount(0);
    }
    const evidence = page.locator('.achievement-evidence-note');
    await expect(evidence).not.toHaveAttribute('open');
    await evidence.locator('summary').click();
    await expect(evidence.locator('.achievement-date-note')).toHaveText(management.verifiedDay + ': ' + management.dateNote);
    await expectNoImplicitActions(page);
  });
}

for (const theme of themes) {
  test(`${theme}: resolved browser rank colors are readable and normal themes distinguish five ranks`, async ({ page }, info) => {
    const card = await openHistory(page, { theme, width: 360 });
    // Keep the same registered nullable tokens as the existing fidelity guard.
    const missing = await page.evaluate(() => {
      const css = [...document.querySelectorAll('head style:not(#test-vscode-theme)')].map(el => el.textContent).join('\n');
      const definitions = new Map([...document.querySelector('#test-vscode-theme').textContent
        .matchAll(/(--vscode-[\w-]+)\s*:\s*([^;{}]*);/g)].map(match => [match[1], match[2].trim()]));
      const nullable = new Set(['--vscode-input-border', '--vscode-textBlockQuote-background', '--vscode-toolbar-hoverBackground',
        '--vscode-button-secondaryBackground', '--vscode-button-secondaryHoverBackground', '--vscode-charts-orange',
        '--vscode-list-inactiveSelectionBackground', '--vscode-widget-shadow']);
      const computed = getComputedStyle(document.documentElement);
      return [...new Set([...css.matchAll(/var\(\s*(--vscode-[\w-]+)/g)].map(match => match[1]))]
        .filter(name => !definitions.has(name) || (!computed.getPropertyValue(name).trim()
          && !(nullable.has(name) && definitions.get(name) === 'initial')));
    });
    expect(missing).toEqual([]);
    const names = card.locator(rowSelector).locator(':scope > strong.achievement-level-name');
    await expect(names).toHaveCount(5);
    const colors = await names.evaluateAll(nodes => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = css => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = css; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v);
      };
      const over = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3]));
      const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      return nodes.map(node => {
        const ancestors = []; for (let el = node; el; el = el.parentElement) ancestors.unshift(el);
        // Start at Chromium's white canvas, then composite every actual ancestor
        // background. Canvas resolves color(srgb ...), color-mix and alpha.
        let background = [255, 255, 255];
        const unsupported = [];
        for (const el of ancestors) {
          const style = getComputedStyle(el);
          if (style.backgroundImage !== 'none' || Number(style.opacity) !== 1) unsupported.push(el.className || el.tagName);
          background = over(rgba(style.backgroundColor), background);
        }
        const foreground = over(rgba(getComputedStyle(node).color), background);
        const a = luminance(foreground), b = luminance(background);
        return { rank: node.dataset.rank, foreground, background, unsupported,
          contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    await info.attach('resolved-rank-colors', { body: JSON.stringify(colors, null, 2), contentType: 'application/json' });
    for (const color of colors) {
      expect(color.unsupported, 'Do not silently approximate gradients or group opacity').toEqual([]);
      expect(color.contrast, `${theme} ${color.rank} normal text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    if (theme !== 'highContrast') {
      expect(new Set(colors.map(color => color.foreground.map(Math.round).join(','))).size).toBe(5);
    }
  });
}

test('first-recorded-only dates retain their visible provenance', async ({ page }) => {
  await openClaude(page, { fixture: 'achievement-records', locale: 'en', claudeOnly: true, width: 320 });
  await page.locator('#tab-achievements').click();
  const row = page.locator('[data-achievement-level="settings-explorer-bronze"]');
  await row.locator('xpath=ancestor::details').locator('summary').click();
  await expect(row.locator('[data-date-source="retained-logs"]')).toHaveCount(0);
  await expect(row.locator('[data-date-source="first-recorded"]')).toHaveText('First recorded: 2026-07-20');
  await expect(row.locator('time')).toHaveAttribute('datetime', '2026-07-20');
  await expect(row).not.toContainText('Earliest verified date');
  await expectNoImplicitActions(page);
});

test('verified dates take visual priority while first-recorded provenance remains accessible', async ({ page }) => {
  const card = await openHistory(page, { fixture: 'achievement-management-history-recorded', locale: 'en', width: 320 });
  for (const [id, verified] of [['sonnet-main', '2026-06-01'], ['sonnet-main-silver', '2026-06-03']]) {
    const row = card.locator(`[data-achievement-level="${id}"]`);
    const date = row.locator('[data-date-source="retained-logs"]');
    await expect(row.locator('time')).toHaveCount(1);
    await expect(date).toHaveText(verified);
    await expect(date.locator('time')).toHaveAttribute('datetime', verified);
    await expect(date).toHaveAttribute('title', /Earliest verified date: 2026-06-0[13]/);
    await expect(date).toHaveAttribute('title', /First recorded: 2026-07-20/);
    await expect(date.locator('time')).toHaveAttribute('aria-label', /First recorded: 2026-07-20/);
    await expect(row).not.toContainText('First recorded');
    await expect(row).not.toContainText('2026-07-20');
    await expect(row.locator('[data-date-source="first-recorded"]')).toHaveCount(0);
  }
  await expectNoImplicitActions(page);
});

test('default and retained-award fixtures target only the rank above the highest earned', async ({ page }) => {
  for (const [fixture, key, next] of [['default', 'sonnet-main', 0], ['achievement-review-next-rank', 'cumulative-volume', 1]]) {
    await openClaude(page, { fixture, locale: 'en', claudeOnly: true, width: 360 });
    await page.locator('#tab-achievements').click();
    const card = page.locator(`[data-achievement-key="${key}"]`);
    await expect(card).toHaveAttribute('data-achievement-proof', 'ready');
    await card.locator('summary').click();
    await expectSingleNext(card, next);
    await expectNoImplicitActions(page);
  }
});

test('full earned ranks retain thresholds and never advertise a next rank', async ({ page }) => {
  const full = await openHistory(page, { fixture: 'achievement-management-full' });
  await expect(full).toHaveAttribute('data-achievement-tier', 'legendary');
  await expect(full.locator('.achievement-level-status[data-level-status="next"]')).toHaveCount(0);
  await expect(full.locator('.achievement-current-value')).toContainText('60B');
  await expect(full.locator(rowSelector).locator(':scope > span.achievement-level-value'))
    .toHaveText(['100M', '1B', '10B', '20B', '50B']);
  await expectNoImplicitActions(page);
});

test('pending and stale proof never advertise a next rank', async ({ page }) => {
  await openCodex(page, { fixture: 'achievement-proof-stale', width: 320 });
  await page.locator('#tab-achievements').click();
  const cards = page.locator('.achievement-card[data-achievement-proof]:not([data-achievement-proof="ready"])');
  expect(await cards.count()).toBeGreaterThan(0);
  expect(await page.locator('.achievement-card[data-achievement-proof="stale"]').count()).toBeGreaterThan(0);
  expect(await page.locator('.achievement-card[data-achievement-proof="pending"]').count()).toBeGreaterThan(0);
  await page.locator('#achievementExpandAll').click();
  await expect(cards.locator('.achievement-level-status[data-level-status="next"]')).toHaveCount(0);
  await expect(cards.locator('.achievement-level-status').filter({ hasText: /^In progress$/ })).toHaveCount(0);
  await expectNoImplicitActions(page);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: expanded compact detail survives host update and reload without host work`, async ({ page }) => {
    const card = await openHistory(page, { theme, width: 360 });
    const summary = card.locator('summary');
    const before = await card.locator(rowSelector).allTextContents();
    const proof = await card.getAttribute('data-achievement-proof');
    await summary.focus();
    const scrollBefore = await page.evaluate(() => scrollY);
    const response = await page.context().request.get(page.url());
    expect(response.ok()).toBe(true);
    await page.evaluate(html => {
      const panel = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
      dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'claude',
        tab: 'achievements', revision: 83, html: panel.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
    }, await response.text());
    await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.some(row =>
      row.command === 'dashboardDataPatchAck' && row.revision === 83 && row.ok))).toBe(true);
    await page.clock.runFor(200);
    await expect(card.locator('details')).toHaveAttribute('open');
    await expect(summary).toBeFocused();
    expect(Math.abs(await page.evaluate(() => scrollY) - scrollBefore)).toBeLessThanOrEqual(2);
    expect(await card.locator(rowSelector).allTextContents()).toEqual(before);
    await expect(card).toHaveAttribute('data-achievement-proof', proof);
    await expectNoImplicitActions(page); // Check before reload clears the message collector.
    await page.reload();
    await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
    await expect(card.locator('details')).toHaveAttribute('open');
    expect(await card.locator(rowSelector).allTextContents()).toEqual(before);
    await expectCompactGeometry(page, card);
    await expectSingleNext(card, 2);
    await expectNoImplicitActions(page);
  });
}
