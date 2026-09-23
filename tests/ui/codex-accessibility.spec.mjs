import AxeBuilder from '@axe-core/playwright';
import { test, expect, openClaude, openCodex, openCompare } from './support/app.mjs';

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

async function expectKeyboardFocusRing(page, locator) {
  // Establish keyboard modality before focusing the exact contract under test.
  await page.keyboard.press('Tab');
  await locator.focus();
  await expect(locator).toBeFocused();
  const treatment = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineOffset: Number.parseFloat(style.outlineOffset),
    };
  });
  expect(treatment.focusVisible).toBe(true);
  expect(treatment.outlineStyle).not.toBe('none');
  expect(treatment.outlineColor).not.toBe('transparent');
  expect(treatment.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(treatment.outlineOffset).toBeGreaterThanOrEqual(2);
}

for (const tab of ['today', 'month', 'all', 'sessions', 'projects', 'content', 'settings']) {
  test(`${tab} has no serious or critical Axe violations`, async ({ page }) => {
    await openCodex(page, { locale: 'en' });
    if (tab !== 'today') {
      await page.locator(`#tab-${tab}`).click();
    }

    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
}

for (const scenario of [
  { name: 'Claude light English', open: openClaude, options: { locale: 'en', theme: 'light' } },
  { name: 'Claude dark CJK', open: openClaude, options: { locale: 'zh-CN', theme: 'dark' } },
  { name: 'Codex dark CJK', open: openCodex, options: { locale: 'zh-CN', theme: 'dark' } },
  { name: 'Compare light English', open: openCompare, options: { locale: 'en', theme: 'light' } },
  { name: 'Compare dark CJK', open: openCompare, options: { locale: 'zh-CN', theme: 'dark' } },
]) {
  test(`${scenario.name} has no serious or critical Axe violations`, async ({ page }) => {
    await scenario.open(page, scenario.options);
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
}

test('dashboard tablist uses automatic activation with roving keyboard focus', async ({ page }) => {
  await openCodex(page, { locale: 'en' });

  const tablist = page.locator('.tabs[role="tablist"]');
  const tabNames = ['today', 'month', 'all', 'sessions', 'projects', 'content', 'settings'];
  await expect(tablist).toHaveAttribute('aria-label', /\S/);
  await expect(tablist.getByRole('tab')).toHaveCount(tabNames.length);

  for (const name of tabNames) {
    const tab = page.locator(`#tab-${name}`);
    const panel = page.locator(`#${name}`);
    await expect(tab).toHaveAttribute('aria-controls', name);
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', `tab-${name}`);
  }

  const today = page.locator('#tab-today');
  const month = page.locator('#tab-month');
  const settings = page.locator('#tab-settings');
  await expect(today).toHaveAttribute('aria-selected', 'true');
  await expect(today).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#today')).not.toHaveAttribute('hidden', '');

  await today.focus();
  await today.press('ArrowRight');
  await expect(month).toBeFocused();
  await expect(month).toHaveAttribute('aria-selected', 'true');
  await expect(month).toHaveAttribute('tabindex', '0');
  await expect(today).toHaveAttribute('aria-selected', 'false');
  await expect(today).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#month')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#today')).toHaveAttribute('hidden', '');

  await month.press('End');
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#settings')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#month')).toHaveAttribute('hidden', '');

  await settings.press('Home');
  await expect(today).toBeFocused();
  await expect(today).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#today')).not.toHaveAttribute('hidden', '');

  await today.press('ArrowLeft');
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute('aria-selected', 'true');
});

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

  expect(await page.evaluate(() => window.__ccuPostedMessages
    .filter((message) => message.command === 'providerChanged')
    .map((message) => message.provider)))
    .toEqual(['compare', 'claude', 'compare']);
});

test('shared chart controls expose and update aria-pressed from the keyboard', async ({ page }) => {
  await openCodex(page, { locale: 'en' });
  await page.locator('#tab-month').click();
  const chart = page.locator('#month [data-codex-last30-daily]');
  const group = chart.locator(':scope > .chart-tabs');
  const cost = group.locator('.chart-tab[data-metric="cost"]');
  const output = group.locator('.chart-tab[data-metric="cacheCreation"]');

  await expect(group).toHaveAttribute('role', 'group');
  await expect(group).toHaveAttribute('aria-label', /\S/);
  await expect(cost).toHaveAttribute('aria-pressed', 'true');
  await expect(output).toHaveAttribute('aria-pressed', 'false');

  await output.focus();
  await output.press('Space');

  await expect(output).toBeFocused();
  await expect(output).toHaveClass(/active/);
  await expect(output).toHaveAttribute('aria-pressed', 'true');
  await expect(cost).toHaveAttribute('aria-pressed', 'false');
  await expect(chart.locator(':scope > .chart-content .chart-bar').first())
    .toHaveClass(/cache-creation-bar/);

  await cost.focus();
  await cost.press('Enter');
  await expect(cost).toBeFocused();
  await expect(cost).toHaveAttribute('aria-pressed', 'true');
  await expect(output).toHaveAttribute('aria-pressed', 'false');
});

for (const scenario of [
  { name: 'Claude', label: 'Claude', open: openClaude },
  { name: 'Codex', label: 'Codex', open: openCodex },
  { name: 'Compare', label: 'Compare', open: openCompare },
]) {
  test(`${scenario.name} chart regions have unique provider-qualified accessible names`, async ({ page }) => {
    await scenario.open(page, { locale: 'en' });
    const regions = page.locator('#provider-panel [data-chart-region="true"]');
    await expect.poll(() => regions.count()).toBeGreaterThan(0);
    const labels = await regions.evaluateAll((elements) => elements.map((element) => ({
      role: element.getAttribute('role'),
      label: element.getAttribute('aria-label') || '',
    })));

    expect(labels.every((item) => item.role === 'region')).toBe(true);
    expect(labels.every((item) => item.label.startsWith(`${scenario.label} ·`))).toBe(true);
    expect(new Set(labels.map((item) => item.label)).size).toBe(labels.length);

    await page.evaluate(() => {
      initializeChartRegions();
      initializeChartRegions();
    });
    expect(await regions.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') || ''),
    )).toEqual(labels.map((item) => item.label));
  });
}

test('a chart region name follows the selected metric', async ({ page }) => {
  await openCodex(page, { locale: 'en' });
  await page.locator('#tab-month').click();
  const chart = page.locator('#month #dailyChart .hc-scroll');
  const output = page.locator(
    '#month [data-codex-last30-daily] > .chart-tabs .chart-tab[data-metric="cacheCreation"]',
  );

  await expect(chart).toHaveAttribute('aria-label', /API-equivalent cost$/);
  await output.click();
  await expect(chart).toHaveAttribute('aria-label', /Output$/);
});

test('sortable headers expose keyboard sorting state for Enter and Space', async ({ page }) => {
  await openCodex(page, { locale: 'en' });
  await page.locator('#tab-sessions').click();
  const header = page.locator('#sessions th.sortable[data-sortkey="time"]');

  await expect(header).toHaveAttribute('tabindex', '0');
  await expect(header).toHaveAttribute('aria-sort', 'none');
  await header.focus();
  await header.press('Enter');
  await expect(header).toBeFocused();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(header).toHaveClass(/sorted-desc/);

  await header.press('Space');
  await expect(header).toBeFocused();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(header).toHaveClass(/sorted-asc/);
});

test('chart drilldown is named, controlled, expanded, and collapsed from the keyboard', async ({ page }) => {
  await openCodex(page, { locale: 'en' });
  await page.locator('#tab-month').click();

  const day = '2026-07-19';
  const control = page.locator(
    `#month [data-codex-last30-daily] .hc-col[data-date="${day}"] .chart-bar.clickable`,
  );
  const detail = page.locator(`#codex-hourly-detail-${day}`);
  const detailRow = detail.locator('xpath=ancestor::tr[1]');

  await expect(control).toHaveAttribute('role', 'button');
  await expect(control).toHaveAttribute('tabindex', '0');
  await expect(control).toHaveAccessibleName(/\S/);
  await expect(control).toHaveAttribute('aria-controls', `codex-hourly-detail-${day}`);
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(detailRow).toBeHidden();

  await control.focus();
  await control.press('Enter');
  await expect(control).toBeFocused();
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await expect(detailRow).toBeVisible();

  await control.press('Space');
  await expect(control).toBeFocused();
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(detailRow).toBeHidden();
});

test('buttons, summaries, and custom tabindex controls share a visible focus contract', async ({ page }) => {
  await openCodex(page, { locale: 'en' });

  await expectKeyboardFocusRing(page, page.locator('#refreshNowBtn'));
  await expectKeyboardFocusRing(page, page.locator('#today details.model-item summary').first());

  await page.locator('#tab-month').click();
  await expectKeyboardFocusRing(page, page.locator('#month .daily-table-container[tabindex="0"]').first());
});

for (const provider of [
  { name: 'Claude', open: openClaude },
  { name: 'Codex', open: openCodex },
]) {
  test(`${provider.name} model details summary opens and closes from the keyboard`, async ({ page }) => {
    await provider.open(page, { locale: 'en' });
    const modelDetails = page.locator('#today details.model-item');
    const closedIndex = await modelDetails.evaluateAll((elements) =>
      elements.findIndex((element) => !element.open),
    );
    expect(closedIndex).toBeGreaterThanOrEqual(0);
    const details = modelDetails.nth(closedIndex);
    const summary = details.locator(':scope > summary');

    await expect(details).toBeVisible();
    await expect(summary).toHaveAccessibleName(/\S/);
    await summary.focus();
    await expect(summary).toBeFocused();
    await summary.press('Enter');
    await expect(summary).toBeFocused();
    await expect(details).toHaveAttribute('open', '');

    await summary.press('Space');
    await expect(summary).toBeFocused();
    await expect(details).not.toHaveAttribute('open', '');
  });
}

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
