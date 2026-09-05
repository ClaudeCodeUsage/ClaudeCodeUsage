import AxeBuilder from '@axe-core/playwright';
import { test, expect, openCodex } from './support/app.mjs';

async function seriousOrCriticalViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = [];
  for (const violation of results.violations
    .filter((item) => item.impact === 'serious' || item.impact === 'critical')) {
    const targets = [];
    for (const node of violation.nodes) {
      const contrast = node.any.map((check) => check.data).find((data) => data?.contrastRatio);
      const themedAccent = violation.id === 'color-contrast' && contrast
        ? await page.evaluate((target) => {
          const element = document.querySelector(target.join(' '));
          if (!element) return null;
          const style = getComputedStyle(element);
          const probe = document.createElement('span');
          document.body.appendChild(probe);
          const resolve = (value) => {
            probe.style.color = value;
            return getComputedStyle(probe).color;
          };
          const root = getComputedStyle(document.documentElement);
          const accentTokens = [
            '--vscode-charts-blue', '--vscode-charts-green', '--vscode-charts-orange',
            '--vscode-charts-purple', '--vscode-charts-red', '--vscode-charts-yellow',
            '--vscode-focusBorder',
          ];
          const isAccent = accentTokens.some((token) =>
            resolve(root.getPropertyValue(token).trim()) === style.color);
          probe.remove();
          const weight = Number.parseInt(style.fontWeight, 10) || 400;
          const hasUnderline = style.textDecorationLine !== 'none' ||
            (Number.parseFloat(style.borderBottomWidth) >= 2 && style.borderBottomStyle !== 'none');
          const before = getComputedStyle(element, '::before').content;
          const after = getComputedStyle(element, '::after').content;
          const hasIcon = (before && before !== 'none' && before !== 'normal') ||
            (after && after !== 'none' && after !== 'normal') ||
            Boolean(element.querySelector('svg, .codicon, [aria-hidden="true"]'));
          return { isAccent, hasNonColorCue: weight >= 600 || hasUnderline || hasIcon };
        }, node.target)
        : null;
      // Body/description text stays at 4.5:1; theme accent tokens use 3:1 only
      // when weight, an underline, or an icon carries the same meaning.
      if (!themedAccent?.isAccent || Number(contrast.contrastRatio) < 3 || !themedAccent.hasNonColorCue) {
        targets.push(node.target);
      }
    }
    if (targets.length) violations.push({ id: violation.id, impact: violation.impact, targets });
  }
  return violations;
}

for (const tab of ['today', 'month', 'sessions', 'projects', 'content', 'settings']) {
  test(`${tab} has no serious or critical Axe violations`, async ({ page }) => {
    await openCodex(page, { locale: 'en' });
    if (tab !== 'today') {
      await page.locator(`#tab-${tab}`).click();
    }

    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
}

test('provider tabs keep the shared keyboard navigation contract', async ({ page }) => {
  await openCodex(page, { locale: 'en' });
  const claude = page.locator('#provider-tab-claude');
  const codex = page.locator('#provider-tab-codex');
  const compare = page.locator('#provider-tab-compare');

  await codex.focus();
  await codex.press('ArrowRight');
  await expect(compare).toBeFocused();
  await compare.press('Home');
  await expect(claude).toBeFocused();
  await claude.press('End');
  await expect(compare).toBeFocused();

  expect(await page.evaluate(() => window.__ccuPostedMessages.map((message) => message.provider)))
    .toEqual(['compare', 'claude', 'compare']);
});

test('shared chart controls activate from the keyboard', async ({ page }) => {
  await openCodex(page, { locale: 'en' });
  await page.locator('#tab-month').click();
  const output = page.locator('#month .chart-tab[data-metric="cacheCreation"]');

  await output.focus();
  await output.press('Space');

  await expect(output).toHaveClass(/active/);
  await expect(page.locator('#month .chart-bar').first()).toHaveClass(/cache-creation-bar/);
});

test('shared settings controls retain explicit labels', async ({ page }) => {
  await openCodex(page, { locale: 'en' });
  await page.locator('#tab-settings').click();

  await expect(page.locator('label[for="set_codex_fileWatchSeconds"]')).toBeVisible();
  await expect(page.locator('#set_codex_fileWatchSeconds')).toBeVisible();
  await expect(page.locator('label[for="set_codex_optimization_enabled"]')).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`${theme} active dashboard tab uses readable text plus a non-color cue`, async ({ page }) => {
    await openCodex(page, { locale: 'en', theme });
    const active = page.locator('.tab.active');
    const treatment = await active.evaluate((element) => {
      const style = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      probe.style.color = root.getPropertyValue('--vscode-foreground');
      document.body.appendChild(probe);
      const foreground = getComputedStyle(probe).color;
      probe.remove();
      return {
        color: style.color,
        foreground,
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
        borderWidth: Number.parseFloat(style.borderBottomWidth),
        borderStyle: style.borderBottomStyle,
      };
    });
    expect(treatment.color).toBe(treatment.foreground);
    expect(treatment.fontWeight).toBeGreaterThanOrEqual(600);
    expect(treatment.borderWidth).toBeGreaterThanOrEqual(2);
    expect(treatment.borderStyle).not.toBe('none');
  });
}

test('sortable header hover keeps readable text and uses an underline cue', async ({ page }) => {
  await openCodex(page, { locale: 'en', theme: 'light' });
  await page.locator('#tab-sessions').click();
  const header = page.locator('#sessions th.sortable').first();
  await header.hover();
  const treatment = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    probe.style.color = root.getPropertyValue('--vscode-foreground');
    document.body.appendChild(probe);
    const foreground = getComputedStyle(probe).color;
    probe.remove();
    return { color: style.color, foreground, decoration: style.textDecorationLine };
  });
  expect(treatment.color).toBe(treatment.foreground);
  expect(treatment.decoration).toContain('underline');
});
