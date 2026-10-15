import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import { test, expect } from './support/app.mjs';

const require = createRequire(import.meta.url);
const { EFFORT_PROCESSED, EFFORT_OUTPUT, EFFORT_ROOTS } = require('../../out/achievementCollaboration.js');
const base = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
const titles = {
  en: 'Effort usage and progress', 'de-DE': 'Denkstufen: Nutzung und Fortschritt',
  'zh-TW': '檔位用量與進度', 'zh-CN': '档位用量与进度', ja: '推論レベル別の使用量と進捗',
  ko: '추론 단계별 사용량과 진행률', 'pt-BR': 'Uso e progresso por esforço', id: 'Penggunaan dan progres per upaya',
};
const card = page => page.locator('.achievement-card[data-achievement-key="effort-breadth"]');
const stats = page => card(page).locator('.achievement-effort-statistics');
const row = (page, effort) => stats(page).locator(`[data-effort-statistics-row="${effort}"]`);
const posted = page => page.evaluate(() => window.__ccuPostedMessages);
const evidence = new WeakMap();

// Synthetic in-memory fixture host only. No real Extension Host, local logs,
// account, OAuth, grant receipts, filesystem exports or pricing fetches run.
test.beforeEach(async ({ page }) => {
  const observed = { external: [], requests: [], errors: [] };
  evidence.set(page, observed);
  page.on('request', request => observed.requests.push(request.url()));
  page.on('pageerror', error => observed.errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    observed.external.push(route.request().url());
    return route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(evidence.get(page).external).toEqual([]);
  expect(evidence.get(page).errors).toEqual([]);
  expect((await posted(page) ?? []).filter(message =>
    /pricing|fetch|refresh|preview.*share|export.*share|updateSetting|setAchievementPinned|editAchievementShowcase/i.test(message.command))).toEqual([]);
});

async function open(page, { locale = 'en', theme = 'light', width = 1280,
  fixture = 'achievement-effort-statistics', enabled = true, provider = 'codex' } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const params = new URLSearchParams({ provider, locale, theme, fixture,
    achievementsEnabled: String(enabled), autoRefresh: 'false' });
  const response = await page.goto(`${base}/?${params}`, { waitUntil: 'load' });
  expect(response.status()).toBe(200);
  await expect(page.locator('#provider-panel')).toBeVisible();
  if (enabled) await page.locator('#tab-achievements').click();
}

async function expand(page) {
  const summary = card(page).locator(':scope > details > summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(card(page).locator(':scope > details')).toHaveAttribute('open');
  await expect(card(page)).toHaveClass(/achievement-statistics-expanded/);
  await expect(stats(page)).toBeVisible();
}

async function themeGuard(page, theme) {
  const tokens = await page.evaluate(() => {
    const css = [...document.querySelectorAll('head style:not(#test-vscode-theme)')].map(el => el.textContent).join('\n');
    const defined = new Map([...document.querySelector('#test-vscode-theme').textContent
      .matchAll(/(--vscode-[\w-]+)\s*:\s*([^;{}]*);/g)].map(m => [m[1], m[2].trim()]));
    const referenced = [...new Set([...css.matchAll(/var\(\s*(--vscode-[\w-]+)/g)].map(m => m[1]))];
    // Registered nullable colors may compute empty only when explicitly initial.
    const nullable = new Set(['--vscode-input-border', '--vscode-textBlockQuote-background', '--vscode-toolbar-hoverBackground',
      '--vscode-button-secondaryBackground', '--vscode-button-secondaryHoverBackground', '--vscode-charts-orange',
      '--vscode-list-inactiveSelectionBackground', '--vscode-widget-shadow']);
    const computed = getComputedStyle(document.documentElement);
    return { count: referenced.length, missing: referenced.filter(name => !defined.has(name) ||
      (!computed.getPropertyValue(name).trim() && !(nullable.has(name) && defined.get(name) === 'initial'))),
      background: getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim() };
  });
  expect(tokens.count).toBeGreaterThan(0);
  expect(tokens.missing).toEqual([]);
  expect(tokens.background).toBe({ light: '#ffffff', dark: '#1e1e1e', highContrast: '#000000' }[theme]);
}

async function structure(page, locale = 'en') {
  await expect(stats(page).locator(':scope > h5')).toHaveText(titles[locale]);
  await expect(stats(page).locator('[data-effort-statistics-row]')).toHaveCount(6);
  await expect(stats(page).locator('[data-effort-progress]')).toHaveCount(18);
  await expect(stats(page).locator('[data-effort-joint-progress]')).toHaveCount(6);
  await expect(stats(page)).toContainText('USD');
  await expect(stats(page)).not.toContainText('api-reference-2026-10-openai-v1');
  await expect(stats(page).locator('[data-achievement-reference]')).toHaveCount(1);
  await expect(page.locator('#achievementMoneyReference [data-reference-provider="codex"]')).toContainText('api-reference-2026-10-openai-v1');
  await expect(page.locator('#achievementMoneyReference [data-reference-provider="codex"]')).toContainText('2026-10-09');
  expect(await stats(page).innerHTML()).not.toMatch(/private-effort|private-custom-model|sessionKey|parentSessionKey|gpt-6/);
  // This fixture publishes current statistics, not durable earned grants.
  await expect(card(page)).toHaveAttribute('data-achievement-earned', 'false');
  for (const effort of efforts) {
    await expect(row(page, effort).locator('h6')).toHaveText(effort);
    for (const [metric, target] of [['processed', EFFORT_PROCESSED[0]], ['output', EFFORT_OUTPUT[0]], ['tasks', EFFORT_ROOTS[0]]]) {
      const progress = row(page, effort).locator(`[data-effort-progress="${metric}"]`);
      await expect(progress).toHaveAttribute('max', String(target));
      await expect(progress).toHaveAttribute('aria-label', /.+: .+ \/ .+/);
    }
  }
}

test('six inline rows separate empty, unknown, mixed attribution, partial subtotal and positive submicro money', async ({ page }) => {
  await open(page);
  await expect(stats(page)).toBeHidden();
  await expect(card(page)).not.toHaveClass(/achievement-statistics-expanded/);
  await expand(page);
  await structure(page);
  await expect(row(page, 'low').locator('[data-effort-money]')).toHaveAttribute('data-effort-money', 'empty');
  await expect(row(page, 'low')).toContainText('No qualifying usage');
  for (const effort of ['medium', 'max', 'ultra']) {
    await expect(row(page, effort).locator('[data-effort-money]')).toHaveAttribute('data-effort-money', 'unpriced');
    await expect(row(page, effort)).toContainText('Unpriced');
    await expect(row(page, effort)).not.toContainText('$0');
  }
  await expect(row(page, 'high').locator('[data-effort-money]')).toHaveAttribute('data-effort-money', 'partial');
  await expect(row(page, 'high').locator('[data-effort-money]')).toContainText('≥$');
  await expect(row(page, 'xhigh').locator('[data-effort-money]')).toHaveAttribute('data-effort-money', 'complete');
  await expect(row(page, 'xhigh').locator('[data-effort-money]')).toContainText('<$1');
  await expect(row(page, 'high').locator('[data-effort-joint-progress]')).toHaveAttribute('data-effort-joint-progress', '40');
  for (const [effort, values] of [['low', [0, 0, 0]], ['medium', [11, 1, 1]],
    ['high', [100_100_011, 100_001, 2]], ['xhigh', [1, 1, 1]], ['max', [1, 1, 1]], ['ultra', [1, 1, 1]]]) {
    for (const [index, metric] of ['processed', 'output', 'tasks'].entries()) {
      const expected = Math.min(values[index], [EFFORT_PROCESSED[0], EFFORT_OUTPUT[0], EFFORT_ROOTS[0]][index]);
      await expect(row(page, effort).locator(`[data-effort-progress="${metric}"]`)).toHaveAttribute('value', String(expected));
    }
  }
  expect((await posted(page)).some(message => /grant|unlock|award/i.test(message.command))).toBe(false);
});

test('keyboard expansion uses generic openDetails; reload, filter return and provider return restore derived full width', async ({ page }) => {
  await open(page);
  const share = await page.evaluate(() => localStorage.getItem('ccu.sharing.achievementBadges'));
  await expand(page);
  await page.clock.runFor(250);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('__ccu-vscode-state')));
  expect(saved.openDetails).toContain('achievement:effort-breadth');
  expect(Object.keys(saved).filter(key => /effort|statisticsExpanded/i.test(key))).toEqual([]);
  await page.reload();
  await expect(card(page).locator(':scope > details')).toHaveAttribute('open');
  await expect(card(page)).toHaveClass(/achievement-statistics-expanded/);
  await page.locator('#achievementFilter').selectOption('earned');
  await expect(card(page)).toBeHidden();
  await page.locator('#achievementFilter').selectOption('all');
  await expect(stats(page)).toBeVisible();
  await open(page, { provider: 'claude' });
  await open(page);
  await expect(card(page).locator(':scope > details')).toHaveAttribute('open');
  await expect(card(page)).toHaveClass(/achievement-statistics-expanded/);
  expect(await page.evaluate(() => localStorage.getItem('ccu.sharing.achievementBadges'))).toBe(share);
  evidence.get(page).requests = [];
  await card(page).locator(':scope > details > summary').press('Enter');
  await expect(card(page).locator(':scope > details')).not.toHaveAttribute('open');
  await expect(card(page)).not.toHaveClass(/achievement-statistics-expanded/);
  expect(evidence.get(page).requests).toEqual([]);
});

test('desktop disclosure spans its real multi-column grid only while open, without host work', async ({ page }, testInfo) => {
  await open(page);
  const widths = () => card(page).evaluate(el => ({ card: el.getBoundingClientRect().width,
    grid: el.parentElement.getBoundingClientRect().width }));
  const closed = await widths();
  expect(closed.card).toBeLessThan(closed.grid / 2);
  evidence.get(page).requests = [];
  await expand(page);
  const opened = await widths();
  expect(Math.abs(opened.card - opened.grid)).toBeLessThanOrEqual(1);
  expect(evidence.get(page).requests).toEqual([]);
  const path = testInfo.outputPath('effort-expanded-desktop-1280.png');
  await stats(page).screenshot({ path, animations: 'disabled' });
  await testInfo.attach('expanded-desktop', { path, contentType: 'image/png' });
  await card(page).locator(':scope > details > summary').press('Enter');
  await expect(card(page)).not.toHaveClass(/achievement-statistics-expanded/);
  expect((await widths()).card).toBeCloseTo(closed.card, 1);
  expect(evidence.get(page).requests).toEqual([]);
});

test('retired current source hides old derived rows, OFF never accesses statistics, empty census is genuine zero', async ({ page }) => {
  await open(page, { fixture: 'achievement-effort-statistics-retired' });
  await card(page).locator(':scope > details > summary').click();
  await expect(stats(page)).toHaveCount(0);
  await expect(card(page).locator('[data-effort-statistics-row]')).toHaveCount(0);
  await expect(card(page).locator('.achievement-proof-status').first()).toBeVisible();
  await open(page, { enabled: false });
  await expect(page.locator('.achievement-effort-statistics')).toHaveCount(0);
  await open(page, { fixture: 'achievement-effort-statistics-empty' });
  if (!(await card(page).locator('details').evaluate(el => el.open))) await expand(page);
  for (const effort of efforts) {
    await expect(row(page, effort).locator('[data-effort-money]')).toHaveAttribute('data-effort-money', 'empty');
    await expect(row(page, effort)).toContainText('No qualifying usage');
    for (const metric of ['processed', 'output', 'tasks'])
      await expect(row(page, effort).locator(`[data-effort-progress="${metric}"]`)).toHaveAttribute('value', '0');
    await expect(row(page, effort)).not.toContainText('Unpriced');
  }
});

for (const locale of locales) for (const theme of ['light', 'dark', 'highContrast']) for (const width of [320, 360]) {
  test(`${locale} ${theme} ${width}px: expanded statistics fit three sizes and 200% CSS surrogate`, async ({ page }, testInfo) => {
    await open(page, { locale, theme, width });
    await themeGuard(page, theme);
    await expand(page);
    await structure(page, locale);
    evidence.get(page).requests = [];
    for (const scale of [1, 2]) {
      // CSS layout stress only, not native browser zoom acceptance.
      await page.setViewportSize({ width: width * scale, height: 900 });
      await page.evaluate(scale => { document.documentElement.style.zoom = String(scale); }, scale);
      for (const [size, emblem] of [['small', 56], ['medium', 80], ['large', 112]]) {
        await page.locator('#achievementSize').selectOption(size);
        await expect(card(page)).toHaveClass(/achievement-statistics-expanded/);
        const geometry = await card(page).evaluate((el, scale) => ({
          fullWidth: getComputedStyle(el).gridColumnStart === '1' && getComputedStyle(el).gridColumnEnd === '-1',
          emblem: el.querySelector('.achievement-emblem').getBoundingClientRect().width / scale,
          pageFits: document.documentElement.scrollWidth <= innerWidth + 1,
          overflowing: [...el.querySelectorAll('.achievement-effort-statistics,.achievement-effort-rows article,.achievement-effort-metric,strong,progress')]
            .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.tagName),
        }), scale);
        expect(geometry).toEqual({ fullWidth: true, emblem, pageFits: true, overflowing: [] });
      }
      await stats(page).scrollIntoViewIfNeeded();
      const result = await new AxeBuilder({ page }).include('.achievement-effort-statistics')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(result.violations).toEqual([]);
      expect(result.passes.some(entry => entry.id === 'color-contrast')).toBe(true);
      expect(result.incomplete.filter(entry => entry.id === 'color-contrast')).toEqual([]);
      const path = testInfo.outputPath(`effort-${locale}-${theme}-${width}-${scale}x-css-surrogate.png`);
      await stats(page).screenshot({ path, animations: 'disabled' });
      await testInfo.attach(`expanded-effort-${scale}x`, { path, contentType: 'image/png' });
    }
    expect(evidence.get(page).requests).toEqual([]);
  });
}
