import { test, expect, openClaude, openCodex } from './support/app.mjs';

test('Codex navigates through the same dashboard tabs as Claude', async ({ page }) => {
  await openCodex(page);

  for (const tab of ['month', 'all', 'sessions', 'projects', 'content', 'settings', 'today']) {
    await page.locator(`#tab-${tab}`).click();
    await expect(page.locator(`#${tab}`)).toHaveClass(/active/);
    await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
  }

  expect(await page.evaluate(() => localStorage.getItem('codexUi'))).toBeNull();
});

test('Codex sessions and projects display source-derived names', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-sessions').click();

  await expect(page.locator('#sessions .name-cell').filter({ hasText: 'Refine the Codex dashboard' }).first())
    .toBeVisible();
  await expect(page.locator('#sessions .project-name').filter({ hasText: 'ClaudeCodeUsage' }).first())
    .toBeVisible();

  await page.locator('#tab-projects').click();
  for (const name of ['ClaudeCodeUsage', 'TianGong', 'PolyU Research']) {
    await expect(page.locator('#projects .project-name').filter({ hasText: name })).toHaveCount(1);
  }
});

test('shared sortable table behavior works for Codex sessions', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-sessions').click();

  const header = page.locator('#sessions th.sortable[data-sortkey="time"]');
  await header.click();
  await expect(header).toHaveClass(/sorted-desc/);
  await header.click();
  await expect(header).toHaveClass(/sorted-asc/);
});

test('Codex settings use the shared setting-row message path', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-settings').click();

  const refreshDelay = page.locator('#set_codex_fileWatchSeconds');
  await expect(refreshDelay).toBeVisible();
  await refreshDelay.selectOption('120');

  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual({
    command: 'updateSetting',
    key: 'codex.fileWatchSeconds',
    value: '120',
  });
});

test('provider tabs still send the selected provider to the extension host', async ({ page }) => {
  await openCodex(page);
  await page.locator('#provider-tab-claude').click();

  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual(expect.objectContaining({
    command: 'providerChanged',
    provider: 'claude',
  }));
});

test('active dashboard tab survives a full reload', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-month').click();

  await page.reload();

  await expect(page.locator('#tab-month')).toHaveClass(/active/);
  await expect(page.locator('#month')).toHaveClass(/active/);
});

test('session range and model filters survive a full reload', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-sessions').click();
  await page.locator('#sessions .sess-filter-btn[data-range="7"]').click();
  await page.locator('#sessions .sess-model-select').selectOption('gpt-5.6-sol');

  await page.reload();

  await expect(page.locator('#sessions .sess-filter-btn[data-range="7"]')).toHaveClass(/active/);
  await expect(page.locator('#sessions .sess-model-select')).toHaveValue('gpt-5.6-sol');
});

test('persisted details survive a full reload', async ({ page }) => {
  await openClaude(page, { fixture: 'persisted-details' });
  const details = page.locator('details[data-persist]').first();
  if (await details.getAttribute('open') !== null) {
    await details.locator('summary').click();
    await expect(details).not.toHaveAttribute('open', '');
  }
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
    return state.openDetails || [];
  })).toContain('test-model');

  await page.reload();

  await expect(page.locator('details[data-persist]').first()).toHaveAttribute('open', '');
});

test('expanded session detail survives a full reload', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-sessions').click();
  const toggle = page.locator('[data-session-detail-toggle]').first();
  const detailId = await toggle.getAttribute('aria-controls');
  await toggle.click();
  await expect(page.locator(`#${detailId}`)).toBeVisible();

  await page.reload();

  await expect(page.locator(`[aria-controls="${detailId}"]`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#${detailId}`)).toBeVisible();
});

test('table sort column and direction survive a full reload', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-sessions').click();
  const header = page.locator('#sessions th.sortable[data-sortkey="time"]');
  await header.click();
  await header.click();
  await expect(header).toHaveClass(/sorted-asc/);

  await page.reload();

  await expect(page.locator('#sessions th.sortable[data-sortkey="time"]')).toHaveClass(/sorted-asc/);
});

test('chart metric selection survives a full reload', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-month').click();
  await page.locator('#month .chart-tab[data-metric="outputTokens"]').click();
  await expect(page.locator('#month .chart-tab[data-metric="outputTokens"]')).toHaveClass(/active/);

  await page.reload();

  await expect(page.locator('#month .chart-tab[data-metric="outputTokens"]')).toHaveClass(/active/);
});

test('page scroll position survives a full reload', async ({ page }) => {
  await page.addInitScript(() => { history.scrollRestoration = 'manual'; });
  await openCodex(page);
  await page.locator('#tab-sessions').click();
  const target = await page.evaluate(() => {
    history.scrollRestoration = 'manual';
    const y = Math.min(520, document.documentElement.scrollHeight - innerHeight);
    scrollTo(0, y);
    return y;
  });
  expect(target).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(target);

  await page.reload();

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(target);
});
