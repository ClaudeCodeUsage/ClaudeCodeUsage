import AxeBuilder from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';
import { test, expect, openCodex } from './support/app.mjs';

// Existing synthetic renderer only. These checks never activate an extension,
// start a daemon, or read a real account. The account fixture uses the actual
// estimator, coordinator public projection and an isolated in-memory SettingsStore.
const base = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
const setting = page => page.locator('#set_codex_officialQuota_enabled');
const details = page => page.locator('#all .weekly-estimate-details');
const labels = {
  en: 'Read official Codex quota', 'de-DE': 'Offizielles Codex-Kontingent lesen',
  'zh-TW': '讀取官方 Codex 額度', 'zh-CN': '读取官方 Codex 额度',
  ja: '公式 Codex クォータを取得', ko: '공식 Codex 할당량 읽기',
  'pt-BR': 'Ler cota oficial do Codex', id: 'Baca kuota resmi Codex',
};

const activity = new WeakMap();
test.beforeEach(async ({ page }) => {
  const evidence = { external: [], errors: [] };
  activity.set(page, evidence);
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    evidence.external.push(route.request().url());
    return route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(activity.get(page).external).toEqual([]);
  expect(activity.get(page).errors).toEqual([]);
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message =>
    /fetch|pricing|publish|refresh|daemon|login/i.test(message.command)))).toEqual([]);
});

for (const [locale, label] of Object.entries(labels)) {
  test(`${locale}: official quota defaults OFF and the localized setting is keyboard operable`, async ({ page }) => {
    await openCodex(page, { locale, codexOnly: true });
    await expect(page.locator('.weekly-official-quota')).toHaveCount(0);
    await page.locator('#tab-settings').click();
    await expect(setting(page)).not.toBeChecked();
    await expect(setting(page)).toHaveAccessibleName(label);
    await expect(page.locator('.set-row').filter({ has: setting(page) }).locator('.set-help')).toContainText(/daemon/i);
    await setting(page).focus();
    await page.keyboard.press('Space');
    await expect(setting(page)).toBeChecked();
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'updateSetting')))
      .toEqual([{ command: 'updateSetting', key: 'codex.officialQuota.enabled', value: true }]);
    await expect(page.locator('.weekly-official-quota')).toHaveCount(0);
  });
}

async function patch(page, tab, revision) {
  const response = await page.context().request.get(page.url());
  expect(response.status()).toBe(200);
  await page.evaluate(({ html, tab, revision }) => {
    const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
    if (!next) throw new Error('Production renderer provider panel missing');
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
      tab, revision, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
  }, { html: await response.text(), tab, revision });
  await page.clock.runFor(500);
  expect(await page.evaluate(revision => window.__ccuPostedMessages.filter(message =>
    message.command === 'dashboardDataPatchAck' && message.revision === revision), revision))
    .toEqual([{ command: 'dashboardDataPatchAck', revision, ok: true }]);
}

async function persistToggle(page, session, value) {
  await setting(page).focus(); await page.keyboard.press('Space');
  await expect(setting(page)).toBeChecked({ checked: value });
  const message = await page.evaluate(() => window.__ccuPostedMessages.findLast(message => message.command === 'updateSetting'));
  expect(message).toEqual({ command: 'updateSetting', key: 'codex.officialQuota.enabled', value });
  const response = await page.context().request.post(`${base}/__weekly_accounts_setting__`, { data: { session, ...message } });
  expect(response.status()).toBe(200); expect(await response.json()).toEqual({ ok: true });
}

async function expectAccountTable(page) {
  const rows = details(page).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  for (const [account, total, unused, inferred, sample] of [
    ['Account 1', '$150.00', '$90.00', '$60.00', '$30.00'],
    ['Account 2', '$200.00', '$120.00', '$80.00', '$40.00'],
  ]) {
    const row = rows.filter({ has: page.getByRole('cell', { name: account, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(4)).toHaveText(total);
    await expect(row.locator('td').nth(5)).toHaveText(unused);
    await expect(row.locator('td').nth(2)).toHaveText(inferred);
    await expect(row.locator('td').nth(6)).toHaveText(sample);
    await expect(row.locator('td').nth(7)).toContainText('Account quota delta · local usage proxy');
    await expect(row.locator('td').nth(7)).toContainText('Local usage ownership unverified');
  }
  const unknown = rows.filter({ has: page.getByRole('cell', { name: 'Unassigned', exact: true }) });
  await expect(unknown).toHaveCount(1);
  await expect(unknown).toContainText('Local-series estimate (account unverified)');
  const table = page.locator('#all .weekly-value-details');
  await expect(table).toHaveCount(0);
  const section = page.locator('#all .daily-breakdown').filter({ has: page.locator('.weekly-estimate-details') });
  const actualChart = section.locator('[data-weekly-actual-chart]');
  await expect(actualChart).toHaveCount(0);
  await expect(section.locator('.composition-chart')).toHaveCount(1);
  const estimates = section.locator('[data-weekly-estimate-chart]');
  await expect(estimates.locator('.hc-bars [role="img"]')).toHaveCount(3);
  await expect(estimates.locator('.hc-xlabel').filter({ hasText: /^Current · Account 2(?: · \d.+)?$/ })).toHaveCount(1);
  await expect(estimates.locator('.hc-xlabel')).not.toContainText(['Current · Account 1']);
  for (const text of await section.locator('td').allTextContents()) expect(text).not.toContain('≈');
  expect(await page.content()).not.toMatch(/a{64}|b{64}|accountScopeKey|private-hmac|synthetic-history/);
}

for (const theme of ['light', 'dark', 'highContrast']) for (const width of [320, 1280]) {
  test(`${theme} ${width}px: official account OFF → ON → persisted host patch → reload → OFF`, async ({ page }, testInfo) => {
    const session = randomBytes(16).toString('hex');
    const query = new URLSearchParams({ provider: 'codex', fixture: 'weekly-accounts', weeklyAccountSession: session,
      theme, locale: 'en', codexOnly: 'true', autoRefresh: 'false' });
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(`${base}/?${query}`, { waitUntil: 'load' });
    expect(response.status()).toBe(200);
    await expect(page.locator('.weekly-official-quota')).toHaveCount(0);
    await page.locator('#tab-settings').click();
    await expect(setting(page)).not.toBeChecked();
    await persistToggle(page, session, true); await patch(page, 'settings', 1);
    await expect(setting(page)).toBeChecked(); await expect(setting(page)).toBeFocused();
    await page.locator('#tab-all').click();
    const quota = page.locator('#all .weekly-official-quota');
    await expect(quota).toBeVisible(); await expect(quota).toContainText('Official quota · Account 2 · 40%');
    await expect(quota).not.toContainText('Collecting samples');
    expect(await quota.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const result = await new AxeBuilder({ page }).include('#all .weekly-official-quota')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
    expect(result.passes.some(result => result.id === 'color-contrast')).toBe(true);
    expect(result.incomplete.filter(result => result.id === 'color-contrast')).toEqual([]);
    const summary = details(page).locator(':scope > summary');
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(details(page)).toHaveAttribute('open', ''); await expectAccountTable(page);
    await summary.focus(); await page.clock.runFor(250);
    const top = await summary.evaluate(node => node.getBoundingClientRect().top);
    await patch(page, 'all', 2);
    await expect(details(page)).toHaveAttribute('open', ''); await expect(summary).toBeFocused();
    expect(Math.abs(await summary.evaluate(node => node.getBoundingClientRect().top) - top)).toBeLessThanOrEqual(1);
    await page.reload({ waitUntil: 'load' });
    await expect(setting(page)).toBeChecked(); await expect(details(page)).toHaveAttribute('open', '');
    await expect(quota).toBeVisible(); await expectAccountTable(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const screenshot = testInfo.outputPath(`official-accounts-${theme}-${width}.png`);
    await details(page).screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('official-account-records', { path: screenshot, contentType: 'image/png' });
    await page.locator('#tab-settings').click();
    await persistToggle(page, session, false); await patch(page, 'settings', 3);
    await expect(page.locator('.weekly-official-quota')).toHaveCount(0);
    await page.reload({ waitUntil: 'load' });
    await expect(setting(page)).not.toBeChecked();
    await expect(page.locator('.weekly-official-quota')).toHaveCount(0);
  });
}

for (const [theme, width] of [['light', 320], ['dark', 360], ['highContrast', 320]]) {
  test(`${theme}: account column and disclosure survive operation → dashboard patch → reload`, async ({ page }, testInfo) => {
    await openCodex(page, { theme, width, codexOnly: true });
    await page.locator('#tab-settings').click();
    await expect(setting(page)).not.toBeChecked();
    const result = await new AxeBuilder({ page }).include('.set-row:has(#set_codex_officialQuota_enabled)')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
    await page.locator('#tab-all').click();
    const summary = details(page).locator(':scope > summary');
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(details(page)).toHaveAttribute('open', '');
    await expect(details(page).locator('thead th').last()).toHaveText('Account');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('__ccu-vscode-state') ?? '{}').openDetails ?? []))
      .toContain('weekly-estimate-codex');
    await page.clock.runFor(250);
    const before = await summary.evaluate(node => node.getBoundingClientRect().top);
    const response = await page.context().request.get(page.url());
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
    await expect(summary).toBeFocused();
    expect(Math.abs(await summary.evaluate(node => node.getBoundingClientRect().top) - before)).toBeLessThanOrEqual(1);
    await page.reload({ waitUntil: 'load' });
    await expect(details(page)).toHaveAttribute('open', '');
    await expect(details(page).locator('thead th').last()).toHaveText('Account');
    await expect(page.locator('.weekly-official-quota')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const screenshot = testInfo.outputPath(`weekly-account-${theme}-${width}.png`);
    await details(page).screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('account-details', { path: screenshot, contentType: 'image/png' });
  });
}
