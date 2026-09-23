import { test, expect, openClaude, openCodex } from './support/app.mjs';

async function dispatchDashboardDataPatch(
  page,
  { provider, fixture = 'unknown-models', revision = 1, tab },
) {
  const url = new URL(page.url());
  url.searchParams.set('provider', provider);
  url.searchParams.set('fixture', fixture);
  const response = await page.context().request.get(url.toString());
  const documentText = await response.text();
  await page.evaluate(({ provider: nextProvider, fixture: nextFixture, revision: nextRevision, nextTab, documentText }) => {
    const activeTab = nextTab
      || document.querySelector('.tabs [role="tab"].active')?.id.replace('tab-', '');
    if (!activeTab) throw new Error('Current dashboard did not expose an active tab');
    const nextDocument = new DOMParser().parseFromString(documentText, 'text/html');
    const nextPanel = nextDocument.getElementById('provider-panel');
    if (!nextPanel) throw new Error('Fixture did not render a provider panel');
    nextPanel.firstElementChild?.setAttribute('data-live-patch-fixture', nextFixture);
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'dashboardDataPatch',
        provider: nextProvider,
        tab: activeTab,
        revision: nextRevision,
        html: nextPanel.innerHTML,
        claudeLast30HoursByDay: {},
      },
    }));
  }, { provider, fixture, revision, nextTab: tab, documentText });
}

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

test('session range filters use configured-zone civil days and survive reload', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-20T20:00:00.000Z'));
  await openClaude(page, {
    fixture: 'session-timezone-boundaries',
    timeZone: 'Pacific/Honolulu',
  });
  await page.locator('#tab-sessions').click();

  const row = (title) => page.locator('#sessions tr.sort-row', { hasText: title });
  await page.locator('#sessions .sess-filter-btn[data-range="today"]').click();
  await expect(row('Honolulu today')).toBeVisible();
  await expect(row('Honolulu yesterday')).toBeHidden();

  await page.locator('#sessions .sess-filter-btn[data-range="7"]').click();
  await expect(row('Seven-day boundary inside')).toBeVisible();
  await expect(row('Seven-day boundary outside')).toBeHidden();

  await page.locator('#sessions .sess-filter-btn[data-range="30"]').click();
  await expect(row('Thirty-day boundary inside')).toBeVisible();
  await expect(row('Thirty-day boundary outside')).toBeHidden();

  await page.reload();

  await expect(page.locator('#sessions .sess-filter-btn[data-range="30"]')).toHaveClass(/active/);
  await expect(row('Thirty-day boundary inside')).toBeVisible();
  await expect(row('Thirty-day boundary outside')).toBeHidden();
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
  const metric = page.locator(
    '#month [data-codex-last30-daily] > .chart-tabs .chart-tab[data-metric="outputTokens"]',
  );
  await metric.click();
  await expect(metric).toHaveClass(/active/);

  await page.reload();

  await expect(page.locator(
    '#month [data-codex-last30-daily] > .chart-tabs .chart-tab[data-metric="outputTokens"]',
  )).toHaveClass(/active/);
});

for (const provider of [
  { name: 'Claude', open: openClaude },
  { name: 'Codex', open: openCodex },
]) {
  test(`${provider.name} Today hourly selection stays synchronized and survives reload`, async ({ page }) => {
    await provider.open(page, { locale: 'en' });

    const overview = page.locator('#today [data-hourly-overview]');
    const firstColumn = overview.locator('.hc-col[data-hour]').first();
    const hour = (await firstColumn.getAttribute('data-hour')) ?? '';
    expect(hour).not.toBe('');
    const displayHour = hour.length === 2 ? `${hour}:00` : hour;
    const bar = overview.locator(`.hc-col[data-hour="${hour}"] > .chart-bar`);
    const row = overview.locator(`.daily-table tbody tr[data-hour="${hour}"]`);
    const detail = overview.locator('[data-hour-selection-detail]');
    const postedBefore = await page.evaluate(() => window.__ccuPostedMessages.length);

    await expect(bar).toHaveAttribute('role', 'button');
    await expect(bar).toHaveAttribute('tabindex', '0');
    await expect(bar).toHaveAttribute('aria-pressed', 'false');
    const detailId = (await detail.getAttribute('id')) ?? '';
    expect(detailId).not.toBe('');
    await expect(bar).toHaveAttribute('aria-controls', detailId);
    await expect(detail).toBeHidden();

    await bar.focus();
    await bar.press('Enter');
    await expect(bar).toBeFocused();
    await expect(bar).toHaveClass(/selected/);
    await expect(bar).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toHaveClass(/chart-selection-row/);
    await expect(detail).toBeVisible();

    const metric = overview.locator(':scope > .chart-tabs .chart-tab[data-metric="outputTokens"]');
    await metric.click();
    await expect(firstColumn.locator('.hc-barval')).toBeEmpty();
    const selectedValue = ((await bar.getAttribute('title')) ?? '').trim();
    expect(selectedValue).not.toBe('');
    const expected = `${displayHour} · ${(await metric.textContent()).trim()}: ${selectedValue}`;
    await expect(detail).toHaveText(expected);
    await expect(bar).toHaveAttribute('aria-label', expected);
    await expect.poll(() => page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
      return Object.values(state.hourlyChartSelections || {});
    })).toContain(hour);
    expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(postedBefore);

    await page.reload();

    await expect(page.locator('#tab-today')).toHaveClass(/active/);
    await expect(bar).toHaveAttribute('aria-pressed', 'true');
    await expect(bar).toHaveClass(/selected/);
    await expect(row).toHaveClass(/chart-selection-row/);
    await expect(detail).toHaveText(expected);

    await bar.press('Space');
    await expect(bar).toHaveAttribute('aria-pressed', 'false');
    await expect(row).not.toHaveClass(/chart-selection-row/);
    await expect(detail).toBeHidden();

    await bar.click();
    await page.locator('#tab-month').click();
    await page.locator('#tab-today').click();
    await expect(bar).toHaveAttribute('aria-pressed', 'false');
    await expect(detail).toBeHidden();
  });
}

test('materialized Codex hourly detail sends no host message and survives a full reload', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-month').click();

  const day = '2026-07-19';
  const toggle = page.locator(`#month [data-codex-hourly-toggle][data-date="${day}"]`);
  const detail = page.locator(`#month [data-codex-hourly-detail-row][data-date="${day}"]`);
  const postedBefore = await page.evaluate(() => window.__ccuPostedMessages.length);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(detail).toBeVisible();
  await expect(detail.locator('[data-codex-materialized-hours="true"]')).toBeVisible();
  await expect(detail.locator('.daily-table tbody .date-cell').first()).toHaveText(/^\d{2}:00$/);
  expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(postedBefore);

  await toggle.click();
  await expect(detail).toBeHidden();
  const chartBar = page.locator(`#month [data-codex-last30-daily] .hc-col[data-date="${day}"] .chart-bar`);
  await expect(chartBar).toHaveClass(/clickable/);
  await chartBar.click();
  await expect(detail).toBeVisible();
  expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(postedBefore);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
    return state.codexHourlyDetails?.['codex:month'];
  })).toBe(day);

  await page.reload();

  await expect(page.locator('#tab-month')).toHaveClass(/active/);
  await expect(page.locator(`#month [data-codex-hourly-toggle][data-date="${day}"]`))
    .toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#month [data-codex-hourly-detail-row][data-date="${day}"]`)).toBeVisible();
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command !== 'localDataClientReady',
  ))).toEqual([]);
});

test('materialized Claude hourly detail sends no host message and survives a full reload', async ({ page }) => {
  await openClaude(page);
  await page.locator('#tab-month').click();

  const day = '2026-07-19';
  const chartBar = page.locator(
    `#month #dailyChart .hc-col[data-date="${day}"] .chart-bar.clickable`,
  );
  const detail = page.locator(`#month .hourly-detail-row[data-date="${day}"]`);
  const postedBefore = await page.evaluate(() => window.__ccuPostedMessages.length);

  await chartBar.click();
  await expect(detail).toBeVisible();
  await expect(chartBar).toHaveAttribute('aria-expanded', 'true');
  await expect(detail.locator('[data-claude-materialized-hours="true"]')).toBeVisible();
  await expect(detail.locator('.daily-table tbody tr')).toHaveCount(24);
  await expect(detail.locator('.daily-table tbody .date-cell').first()).toHaveText('00:00');
  expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(postedBefore);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
    return state.claudeDrilldownDetails?.['claude:month:hourly'];
  })).toBe(day);

  await page.reload({ waitUntil: 'load' });

  await expect(page.locator('#tab-month')).toHaveClass(/active/);
  await expect(page.locator(`#month .hourly-detail-row[data-date="${day}"]`)).toBeVisible();
  await expect(page.locator(
    `#month #dailyChart .hc-col[data-date="${day}"] .chart-bar.clickable`,
  )).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#month .hourly-detail-row[data-date="${day}"] [data-claude-materialized-hours="true"]`))
    .toBeVisible();
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command !== 'localDataClientReady',
  ))).toEqual([]);
});

test('Claude all-time months drill into materialized days and supported hours', async ({ page }) => {
  await openClaude(page);
  await page.locator('#tab-all').click();

  const month = '2026-07-01';
  const day = '2026-07-19';
  const dailyData = [{
    date: day,
    data: {
      totalInputTokens: 400,
      totalOutputTokens: 80,
      totalCacheCreationTokens: 120,
      totalCacheReadTokens: 200,
      totalCost: 1.6,
      costBreakdown: { input: 0.2, output: 0.4, cacheWrite: 0.6, cacheRead: 0.4 },
      messageCount: 10,
      modelBreakdown: {},
    },
  }];
  const chartBar = page.locator(
    `#all #allTimeChart .hc-col[data-date="${month}"] .chart-bar.clickable`,
  );
  const detail = page.locator(`#all .monthly-detail-row[data-date="${month}"]`);

  await chartBar.click();
  await expect(detail).toBeVisible();
  await expect(chartBar).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
    return state.claudeDrilldownDetails?.['claude:all:monthly'];
  })).toBe(month);

  await page.evaluate(({ month, dailyData }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'dailyDataResponse', provider: 'claude', month, data: dailyData },
    }));
  }, { month, dailyData });
  const daily = detail.locator('[data-claude-alltime-daily]');
  const hourlyId = `claude-alltime-hourly-detail-${day}`;
  const dailyBar = daily.locator(`.chart-content .hc-col[data-date="${day}"] .chart-bar.clickable`);
  const dailyToggle = daily.locator(`[data-claude-alltime-hourly-toggle][data-date="${day}"]`);
  await expect(dailyBar).toHaveAttribute('aria-controls', hourlyId);
  await expect(dailyToggle).toHaveAttribute('aria-controls', hourlyId);
  const postedBeforeHourlyOpen = await page.evaluate(() => window.__ccuPostedMessages.length);
  await dailyBar.focus();
  await page.keyboard.press('Space');
  const hourlyDetail = daily.locator(`[data-claude-alltime-hourly-detail-row][data-date="${day}"]`);
  await expect(hourlyDetail).toBeVisible();
  await expect(hourlyDetail.locator('[data-claude-materialized-hours="true"]')).toBeVisible();
  await expect(hourlyDetail.locator('.daily-table tbody tr')).toHaveCount(24);
  expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(postedBeforeHourlyOpen);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
    return state.claudeDrilldownDetails?.['claude:all:hourly'];
  })).toBe(day);

  await page.reload({ waitUntil: 'load' });

  await expect(page.locator('#tab-all')).toHaveClass(/active/);
  await expect(page.locator(`#all .monthly-detail-row[data-date="${month}"]`)).toBeVisible();
  await expect(page.locator(
    `#all #allTimeChart .hc-col[data-date="${month}"] .chart-bar.clickable`,
  )).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.find(
    (message) => message.command === 'getDailyData',
  ))).toEqual({ command: 'getDailyData', month, provider: 'claude' });
  await page.evaluate(({ month, dailyData }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'dailyDataResponse', provider: 'claude', month, data: dailyData },
    }));
  }, { month, dailyData });
  await expect(page.locator(
    `#all [data-claude-alltime-daily] [data-claude-alltime-hourly-detail-row][data-date="${day}"]`,
  )).toBeVisible();
  await expect(page.locator(
    `#all [data-claude-alltime-daily] .chart-content .hc-col[data-date="${day}"] .chart-bar.clickable`,
  )).toHaveAttribute('aria-expanded', 'true');
});

test('Codex all-time months drill into indexed days and available hours on demand', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-all').click();

  const month = '2026-07';
  const day = '2026-07-19';
  const chartBar = page.locator(
    `#all #allTimeChart .hc-col[data-date="${month}"] .chart-bar.clickable`,
  );
  const tableToggle = page.locator(
    `#all > .daily-breakdown .daily-row[data-date="${month}"] .detail-button`,
  );
  const detail = page.locator(`#all .monthly-detail-row[data-date="${month}"]`);

  await expect(chartBar).toHaveAttribute('aria-controls', `monthly-detail-${month}`);
  await expect(tableToggle).toHaveAttribute('aria-controls', `monthly-detail-${month}`);
  await chartBar.focus();
  await page.keyboard.press('Enter');
  await expect(detail).toBeVisible();
  await expect(chartBar).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.find(
    (message) => message.command === 'getDailyData',
  ))).toEqual({ command: 'getDailyData', month, provider: 'codex' });
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
    return state.claudeDrilldownDetails?.['codex:all:monthly'];
  })).toBe(month);

  const url = new URL(page.url());
  url.searchParams.set('codexMonth', month);
  const response = await page.context().request.get(url.toString());
  const html = await response.text();
  await page.evaluate(({ month, html }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'dailyDataResponse', provider: 'codex', month, html },
    }));
  }, { month, html });

  const daily = detail.locator('[data-codex-alltime-daily]');
  await expect(daily).toBeVisible();
  await expect(daily.locator('.daily-row')).toHaveCount(7);
  const hourlyId = `codex-alltime-hourly-detail-${day}`;
  const dailyBar = daily.locator(`.chart-content .hc-col[data-date="${day}"] .chart-bar.clickable`);
  const dailyToggle = daily.locator(`[data-codex-hourly-toggle][data-date="${day}"]`);
  await expect(dailyBar).toHaveAttribute('aria-controls', hourlyId);
  await expect(dailyToggle).toHaveAttribute('aria-controls', hourlyId);

  const postedBeforeHourlyOpen = await page.evaluate(() => window.__ccuPostedMessages.length);
  await dailyBar.focus();
  await page.keyboard.press('Space');
  await expect(daily.locator(`[data-codex-hourly-detail-row][data-date="${day}"]`)).toBeVisible();
  await expect(daily.locator(`#${hourlyId} [data-codex-materialized-hours="true"]`)).toBeVisible();
  await expect(dailyBar).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(postedBeforeHourlyOpen);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
    return state.codexHourlyDetails?.['codex:all'];
  })).toBe(day);

  await chartBar.click();
  await expect(detail).toBeHidden();
  await chartBar.click();
  await expect(detail).toBeVisible();
  await expect(daily.locator(`[data-codex-hourly-detail-row][data-date="${day}"]`)).toBeVisible();
  await expect(dailyBar).toHaveAttribute('aria-expanded', 'true');

  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#tab-all')).toHaveClass(/active/);
  await expect(page.locator(`#all .monthly-detail-row[data-date="${month}"]`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.find(
    (message) => message.command === 'getDailyData',
  ))).toEqual({ command: 'getDailyData', month, provider: 'codex' });
  await page.evaluate(({ month, html }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'dailyDataResponse', provider: 'codex', month, html },
    }));
  }, { month, html });
  await expect(page.locator(
    `#all [data-codex-alltime-daily] [data-codex-hourly-detail-row][data-date="${day}"]`,
  )).toBeVisible();
  await expect(page.locator(
    `#all [data-codex-alltime-daily] .chart-content .hc-col[data-date="${day}"] .chart-bar.clickable`,
  )).toHaveAttribute('aria-expanded', 'true');
});

test('a covered Codex date with no hourly token rows expands to an explicit empty state', async ({ page }) => {
  await openCodex(page, { fixture: 'covered-day-without-hourly-rows' });
  await page.locator('#tab-month').click();

  const day = '2026-07-19';
  const toggle = page.locator(`#month [data-codex-hourly-toggle][data-date="${day}"]`);
  const detail = page.locator(`#month [data-codex-hourly-detail-row][data-date="${day}"]`);
  const postedBefore = await page.evaluate(() => window.__ccuPostedMessages.length);

  await toggle.click();
  await expect(detail).toBeVisible();
  await expect(detail.locator('.no-chart-data')).toHaveText('No daily Codex usage is indexed yet.');
  expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(postedBefore);
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

test('continuous scrolling persists state once after the gesture instead of every frame', async ({ page }) => {
  await openCodex(page, { height: 560 });
  await page.locator('#tab-sessions').click();

  const result = await page.evaluate(() => {
    window.__ccuSetStateCalls = 0;
    const maxY = document.documentElement.scrollHeight - innerHeight;
    for (let step = 1; step <= 12; step += 1) {
      scrollTo(0, Math.min(maxY, step * 40));
      window.dispatchEvent(new Event('scroll'));
    }
    return { maxY, callsDuringGesture: window.__ccuSetStateCalls };
  });

  expect(result.maxY).toBeGreaterThan(0);
  expect(result.callsDuringGesture).toBe(0);
  await page.clock.runFor(200);
  await expect.poll(() => page.evaluate(() => window.__ccuSetStateCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => page.evaluate(() => window.__ccuSetStateCalls)).toBe(1);
});

test('live Codex indexing progress patches text without replacing the page or moving it', async ({ page }) => {
  await openCodex(page, { height: 560 });
  await page.locator('#tab-sessions').click();
  const target = await page.evaluate(() => {
    const y = Math.min(320, document.documentElement.scrollHeight - innerHeight);
    scrollTo(0, y);
    const body = document.body;
    body.dataset.progressPatchIdentity = 'preserved';
    return y;
  });
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(target);

  const progressText = 'Indexed log entries: 1,700/1,827 (93%) · Indexed storage: 3kB/4kB';
  await page.evaluate((text) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'codexIndexProgress', text },
    }));
  }, progressText);

  await expect(page.locator('[data-codex-index-progress-text]').first()).toHaveText(progressText);
  expect(await page.locator('[data-codex-index-progress-text]').count()).toBeGreaterThan(1);
  await expect(page.locator('body')).toHaveAttribute('data-progress-patch-identity', 'preserved');
  expect(await page.evaluate(() => scrollY)).toBe(target);
});

for (const provider of [
  { name: 'Claude', value: 'claude', open: openClaude },
  { name: 'Codex', value: 'codex', open: openCodex },
]) {
  test(`${provider.name} live dashboard data patch preserves Today selection, focus, and document identity`, async ({ page }) => {
    await provider.open(page);
    const overview = page.locator('#today [data-hourly-overview]');
    const selected = overview.locator('.hc-col[data-hour] > .chart-bar').first();
    const hour = await selected.locator('..').getAttribute('data-hour');
    expect(hour).toBeTruthy();

    await selected.focus();
    await selected.press('Enter');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toBeFocused();
    await page.locator('body').evaluate((body) => { body.dataset.livePatchIdentity = 'preserved'; });

    await dispatchDashboardDataPatch(page, { provider: provider.value });

    const refreshed = overview.locator(`.hc-col[data-hour="${hour}"] > .chart-bar`);
    await expect(page.locator('#tab-today')).toHaveClass(/active/);
    await expect(refreshed).toHaveAttribute('aria-pressed', 'true');
    await expect(refreshed).toHaveClass(/selected/);
    await expect(refreshed).toBeFocused();
    await expect(page.locator('body')).toHaveAttribute('data-live-patch-identity', 'preserved');
    await expect(page.locator('[data-live-patch-fixture="unknown-models"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual({
      command: 'dashboardDataPatchAck',
      revision: 1,
      ok: true,
    });
  });
}

test('live dashboard data patch preserves an expanded day, chart metric, and scroll anchor', async ({ page }) => {
  await openCodex(page, { height: 560 });
  await page.locator('#tab-month').click();
  const day = '2026-07-19';
  const toggle = page.locator(`#month [data-codex-hourly-toggle][data-date="${day}"]`);
  await toggle.click();
  const metric = page.locator(
    '#month [data-codex-last30-daily] > .chart-tabs .chart-tab[data-metric="outputTokens"]',
  );
  await metric.click();
  await toggle.focus();
  await toggle.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    window.scrollBy(0, top - 120);
  });
  const anchorTop = await toggle.evaluate((element) => element.getBoundingClientRect().top);
  expect(anchorTop).toBeGreaterThan(100);
  expect(anchorTop).toBeLessThan(140);

  await dispatchDashboardDataPatch(page, { provider: 'codex' });

  const refreshedToggle = page.locator(`#month [data-codex-hourly-toggle][data-date="${day}"]`);
  await expect(page.locator('#tab-month')).toHaveClass(/active/);
  await expect(refreshedToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#month [data-codex-hourly-detail-row][data-date="${day}"]`)).toBeVisible();
  await expect(page.locator(
    '#month [data-codex-last30-daily] > .chart-tabs .chart-tab[data-metric="outputTokens"]',
  )).toHaveClass(/active/);
  await expect(refreshedToggle).toBeFocused();
  await expect.poll(async () => refreshedToggle.evaluate(
    (element) => Math.abs(element.getBoundingClientRect().top - 120),
  )).toBeLessThanOrEqual(2);
});

test('live dashboard data patch follows a host-selected tab instead of stale local state', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-today').click();
  await expect(page.locator('#tab-today')).toHaveClass(/active/);

  await dispatchDashboardDataPatch(page, { provider: 'codex', tab: 'month' });

  await expect(page.locator('#tab-month')).toHaveClass(/active/);
  await expect(page.locator('#month')).toBeVisible();
  await expect(page.locator('#tab-today')).not.toHaveClass(/active/);
});
