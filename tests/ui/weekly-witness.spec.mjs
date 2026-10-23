import { test, expect, openCodex } from './support/app.mjs';

const base = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
const panel = page => page.locator('#all [data-codex-cycle-panel]');
const details = page => panel(page).locator('.weekly-estimate-details');

async function expectRegisteredTheme(page) {
  const result = await page.evaluate(() => {
    const theme = document.getElementById('test-vscode-theme')?.textContent ?? '';
    const production = [...document.querySelectorAll('style')].filter(style => style.id !== 'test-vscode-theme')
      .map(style => style.textContent).join('\n');
    const used = new Set([...production.matchAll(/var\(\s*(--vscode-[\w-]+)/g)].map(match => match[1]));
    const defined = new Set([...theme.matchAll(/(--vscode-[\w-]+)\s*:\s*([^;}]+)/g)].map(match => match[1]));
    return { count: used.size, missing: [...used].filter(name => !defined.has(name)) };
  });
  // Values come from the existing registered Light+/Dark+/HC harness, including
  // its explicit `initial` declarations for registered null theme values.
  expect(result.count).toBeGreaterThan(30);
  expect(result.missing).toEqual([]);
}

async function expectAmounts(page, updated = false) {
  const chart = panel(page).locator('[data-codex-cycle-chart]'), bars = chart.locator('.stack-bar');
  await expect(bars).toHaveCount(8);
  await expect(chart.locator('.hc-xlabel')).toHaveCount(8);
  await expect(panel(page).locator('[data-codex-cycle-summary-row]')).toHaveCount(8);
  await expect(panel(page).locator('[data-cycle-pending], [data-weekly-actual-chart], .weekly-value-details')).toHaveCount(0);
  await expect(panel(page).locator('[data-codex-cycle-chart]')).toHaveCount(1);
  const capacity = bars.last(), usage = bars.nth(6);
  const expected = updated ? ['19.00', '40.00', '16.00', '24.00'] : ['17.00', '30.00', '12.00', '18.00'];
  const title = await capacity.getAttribute('title');
  for (const [label, value] of [['Observed priced usage', expected[0]], ['Conditional capacity estimate', expected[1]],
    ['Inferred used (estimate)', expected[2]], ['Unused estimate', expected[3]]]) {
    expect(title).toContain(`${label}: $${value}`);
  }
  expect(title).toContain('Priced coverage: 10%');
  expect(title).toContain('Excluded sources: 3');
  expect(title).toContain('Unpriced tokens: ' + (updated ? '17,100' : '15,300'));
  await expect(capacity).toHaveAccessibleName(title);
  const usageTitle = await usage.getAttribute('title');
  expect(usageTitle).toContain('Observed priced usage: $17.00');
  expect(usageTitle).not.toMatch(/Conditional capacity estimate:|Inferred used \(estimate\):|Unused estimate:/);
  await expect(usage).toHaveAccessibleName(usageTitle);
  await expect(usage.locator('.stack-seg')).toHaveCount(1);
  await expect(usage.locator('.seg-output')).toHaveCount(1);
  await expect(capacity.locator('.seg-input')).toHaveCSS('height', '48px');
  await expect(capacity.locator('.seg-cache-read')).toHaveCSS('height', '72px');
  const observedHeight = await usage.locator('.seg-output').evaluate(node => node.getBoundingClientRect().height);
  expect(observedHeight).toBeCloseTo(updated ? 51 : 68, 1);
  await expect(details(page).locator('thead th')).toHaveText(['Period', 'Account', 'Observed priced usage',
    'Conditional capacity estimate', 'Inferred used (estimate)', 'Unused estimate', 'As of observation', 'Calibration evidence']);
  const rows = details(page).locator('tbody tr');
  await expect(rows.first().locator('.cost-cell')).toHaveText(expected.map(value => '$' + value));
  await expect(rows.nth(1).locator('.cost-cell')).toHaveText(['$17.00', '—', '—', '—']);
  await expect(rows.locator(':scope > td:nth-child(2)')).toHaveText(Array(8).fill('Unassigned'));
  const keys = await rows.locator('[data-cycle-evidence]').evaluateAll(nodes => nodes.map(node => node.dataset.persist));
  expect(new Set(keys).size).toBe(8);
}

for (const [theme, width] of [['light', 1280], ['dark', 320], ['highContrast', 320]]) {
  test(`${theme} ${width}px: witness amounts and expanded evidence survive update and reload`, async ({ page }, testInfo) => {
    const external = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await openCodex(page, { fixture: 'weekly-witness', codexOnly: true, theme, width });
    await page.locator('#tab-all').click();
    await expectRegisteredTheme(page);
    await details(page).locator(':scope > summary').click();
    await expectAmounts(page);
    const chart = panel(page).locator('[data-codex-cycle-chart]');
    const geometry = await chart.locator('.stack-bar').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { width: rect.width, left: rect.left, right: rect.right };
    }));
    expect(geometry.every(bar => bar.width === 40)).toBe(true);
    for (let index = 1; index < geometry.length; index++) expect(geometry[index].left - geometry[index - 1].right).toBe(6);
    if (width === 320) {
      for (const container of [chart.locator('.hc-scroll'), details(page).locator('.daily-table-container')]) {
        expect(await container.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
        await expect(container).toHaveCSS('overflow-x', 'auto');
        await container.focus(); await page.keyboard.press('ArrowRight'); await page.clock.runFor(500);
        expect(await container.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const evidence = details(page).locator('[data-cycle-evidence]').first();
    const key = await evidence.getAttribute('data-persist'), summary = evidence.locator(':scope > summary');
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(evidence).toHaveAttribute('open', '');
    await expect(evidence.locator('[data-witness-known-usage]')).toHaveText('$17.00');
    await expect(evidence.locator('[data-witness-delta]')).toHaveText('$9.00');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('__ccu-vscode-state') ?? '{}').openDetails ?? []))
      .toEqual(expect.arrayContaining(['weekly-estimate-codex', key]));
    await page.clock.runFor(250);
    const before = await summary.evaluate(node => ({ top: node.getBoundingClientRect().top,
      documentId: window.__ccuPostedMessages.find(message => message.command === 'localDataClientReady').documentId }));
    const nextUrl = new URL(page.url()); nextUrl.searchParams.set('fixture', 'weekly-witness-updated');
    const response = await page.context().request.get(nextUrl.href);
    expect(response.status()).toBe(200);
    await page.evaluate(html => {
      const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
      if (!next) throw new Error('Production renderer provider panel missing');
      window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
        tab: 'all', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
    }, await response.text());
    await page.clock.runFor(500);
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'dashboardDataPatchAck')))
      .toEqual([{ command: 'dashboardDataPatchAck', revision: 1, ok: true }]);
    await expect(details(page)).toHaveAttribute('open', '');
    await expect(evidence).toHaveAttribute('open', '');
    await expect(evidence).toHaveAttribute('data-persist', key);
    await expect(summary).toBeFocused();
    await expect(evidence.locator('[data-witness-known-usage]')).toHaveText('$19.00');
    await expect(evidence.locator('[data-witness-delta]')).toHaveText('$12.00');
    await expectAmounts(page, true);
    const after = await summary.evaluate(node => ({ top: node.getBoundingClientRect().top,
      documentId: window.__ccuPostedMessages.find(message => message.command === 'localDataClientReady').documentId }));
    expect(after.documentId).toBe(before.documentId);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    // Select the updated synthetic host snapshot for reload. Application state
    // is written only by the real click/keyboard/patch handlers above.
    await page.evaluate(url => history.replaceState(null, '', url), nextUrl.href);
    await page.reload({ waitUntil: 'load' });
    await expect(details(page)).toHaveAttribute('open', '');
    await expect(evidence).toHaveAttribute('open', '');
    await expect(evidence).toHaveAttribute('data-persist', key);
    await expect(details(page).locator('[data-cycle-evidence]').nth(1)).not.toHaveAttribute('open', '');
    await expectAmounts(page, true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(external).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message =>
      /fetch|pricing|publish|daemon|login/i.test(message.command)))).toEqual([]);
    const screenshot = testInfo.outputPath(`weekly-witness-${theme}-${width}.png`);
    await panel(page).screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('witness-cycles', { path: screenshot, contentType: 'image/png' });
  });
}
