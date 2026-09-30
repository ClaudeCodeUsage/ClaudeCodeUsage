import { test, expect, openCompare, openClaude, openCodex } from './support/app.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DEFAULT_SECTIONS } = require('../../out/shareCard.js');

function configKey(message) {
  const sections = Object.fromEntries(Object.keys(DEFAULT_SECTIONS).sort().map((key) =>
    [key, typeof message.sections[key] === 'boolean' ? message.sections[key] : DEFAULT_SECTIONS[key]]));
  return JSON.stringify({ range: message.range, scope: message.scope, theme: message.theme, fullNumbers: message.fullNumbers, sections });
}
async function dispatch(page, message) {
  await page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), message);
}
async function buildReply(page, request, id = 'accepted-preview', svg = '<svg viewBox="0 0 50 20"><text y="15">Accepted</text></svg>') {
  await dispatch(page, { command: 'shareCardResult', requestId: request.requestId, configKey: configKey(request), previewId: id, svg });
}

test('privacy, range and theme edits disable export until the exact new preview is accepted', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'claudeShareCard' });
  const preview = page.locator('#scPreview');
  const before = await preview.innerHTML();
  const exportButton = page.locator('#scExportBtn');
  await expect(exportButton).toBeEnabled();
  await page.locator('.sc-sec[data-sec="projectName"]').check();
  await page.locator('#scRange').selectOption('week');
  await page.locator('#scTheme').selectOption('auroraDark');
  await expect(exportButton).toBeDisabled();
  await expect(page.locator('#scPreviewStatus')).toHaveText('Update preview before exporting.');
  await expect(preview).toHaveJSProperty('innerHTML', before);
  await page.getByRole('button', { name: 'Update preview', exact: true }).click();
  const request = await page.evaluate(() => window.__ccuPostedMessages.findLast((m) => m.command === 'buildShareCard'));
  await expect(exportButton).toBeDisabled();
  await buildReply(page, request);
  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  const exported = await page.evaluate(() => window.__ccuPostedMessages.findLast((m) => m.command === 'exportShareCard'));
  expect(exported.previewId).toBe('accepted-preview');
  expect(exported.sections.projectName).toBe(true);
  expect(configKey(exported)).toBe(configKey(request));
});

test('late replies cannot accept a newer draft, and dirty state survives reload', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'claudeShareCard' });
  const update = page.getByRole('button', { name: 'Update preview', exact: true });
  await update.click();
  let requests = await page.evaluate(() => window.__ccuPostedMessages.filter((m) => m.command === 'buildShareCard'));
  await page.locator('#scFull').check();
  await update.click();
  requests = await page.evaluate(() => window.__ccuPostedMessages.filter((m) => m.command === 'buildShareCard'));
  await buildReply(page, requests[0], 'stale', '<svg><text>Stale</text></svg>');
  await expect(page.locator('#scExportBtn')).toBeDisabled();
  await expect(page.locator('#scPreview')).not.toContainText('Stale');
  await buildReply(page, requests[1], 'fresh');
  await expect(page.locator('#scExportBtn')).toBeEnabled();
  await page.locator('#scTheme').selectOption('auroraDark');
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#scTheme')).toHaveValue('auroraDark');
  await expect(page.locator('#scExportBtn')).toBeDisabled();
});

test('refresh errors leave current charts, scroll and focus intact and clear on success', async ({ page }) => {
  await openCodex(page);
  const before = await page.locator('#provider-panel').innerHTML();
  const focused = page.locator('#tab-today');
  await focused.focus();
  await page.evaluate(() => window.scrollTo(0, 100));
  const scroll = await page.evaluate(() => window.scrollY);
  await dispatch(page, { command: 'dashboardRefreshState', provider: 'codex', text: 'Refresh failed · showing last verified data. Last successful refresh: 12:00' });
  await expect(page.locator('[data-refresh-feedback="codex"]')).toBeVisible();
  expect(await page.locator('#provider-panel').innerHTML()).toBe(before);
  await expect(focused).toBeFocused();
  // Feedback may add height; it must not force a scroll-to-top or full reload.
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(scroll);
  await dispatch(page, { command: 'dashboardRefreshState', provider: 'codex', text: '' });
  await expect(page.locator('[data-refresh-feedback="codex"]')).toBeHidden();
});

test('live patches preserve unfocused share drafts, pending previews and edit listeners', async ({ page }) => {
  await openClaude(page, { fixture: 'combined-heatmap', claudeOnly: true });
  await page.locator('#tab-all').click();
  await page.locator('#sharingTemplate').selectOption('claudeShareCard');
  const response = await page.context().request.get(page.url());
  const source = await response.text();
  async function patch(revision) {
    await page.evaluate(({ source, revision }) => {
      const panel = new DOMParser().parseFromString(source, 'text/html').getElementById('provider-panel');
      window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'dashboardDataPatch', provider: 'claude', tab: 'all', revision,
        html: panel.innerHTML, claudeLast30HoursByDay: {},
      } }));
    }, { source, revision });
    await expect.poll(() => page.evaluate((revision) => window.__ccuPostedMessages.some((m) =>
      m.command === 'dashboardDataPatchAck' && m.revision === revision && m.ok), revision)).toBe(true);
  }
  await page.locator('#scRange').selectOption('week');
  await page.locator('.sc-sec[data-sec="projectName"]').check();
  await page.locator('#tab-all').focus();
  await patch(1);
  await expect(page.locator('#scRange')).toHaveValue('week');
  await expect(page.locator('.sc-sec[data-sec="projectName"]')).toBeChecked();
  await expect(page.locator('#scExportBtn')).toBeDisabled();
  await expect(page.locator('#scPreviewStatus')).toBeVisible();
  await page.getByRole('button', { name: 'Update preview', exact: true }).click();
  const request = await page.evaluate(() => window.__ccuPostedMessages.findLast((m) => m.command === 'buildShareCard'));
  await patch(2);
  await expect(page.locator('#scExportBtn')).toBeDisabled();
  await expect(page.locator('#scPreviewStatus')).toHaveText('Generating preview…');
  await buildReply(page, request);
  await expect(page.locator('#scExportBtn')).toBeEnabled();
  await page.locator('#scTheme').selectOption('auroraDark');
  await expect(page.locator('#scExportBtn')).toBeDisabled();
  await patch(3);
  await expect(page.locator('#scTheme')).toHaveValue('auroraDark');
  await expect(page.locator('#scExportBtn')).toBeDisabled();
});

test('ordinary reset omits secrets and Codex recovery directory is editable on the Claude page', async ({ page }) => {
  await openClaude(page);
  await page.locator('#tab-settings').click();
  const directory = page.locator('#set_codex_dataDirectory');
  await expect(directory).toBeVisible();
  await directory.fill('/synthetic/invalid-codex');
  await directory.press('Tab');
  await expect.poll(async () => page.evaluate(() => window.__ccuPostedMessages.filter((m) => m.command === 'updateSetting').length)).toBeGreaterThan(0);
  const edit = await page.evaluate(() => window.__ccuPostedMessages.findLast((m) => m.command === 'updateSetting'));
  expect(edit.key).toBe('codex.dataDirectory');
  await page.locator('.settings-toolbar button').click();
  const reset = await page.evaluate(() => window.__ccuPostedMessages.findLast((m) => m.command === 'resetAllSettings'));
  expect(reset.keys).not.toContain('advice.apiKey');
  await openClaude(page, { claudeOnly: true });
  await page.locator('#tab-settings').click();
  await expect(page.locator('#set_codex_dataDirectory')).toBeVisible();
  await page.locator('#set_codex_dataDirectory').fill('');
  await page.locator('#set_codex_dataDirectory').press('Tab');
});

for (const locale of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
  test(`compact recovery and preview controls fit ${locale}/${theme} at narrow width`, async ({ page }) => {
    await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'claudeShareCard', locale, theme, width: 390 });
    await page.locator('.sc-sec[data-sec="projectName"]').check();
    await expect(page.locator('#scPreviewStatus')).toBeVisible();
    await expect(page.locator('#scExportBtn')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`share-recovery-${locale}-${theme}.png`), fullPage: true });
  });
}
