import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import { test, expect, openCompare, openClaude, openCodex } from './support/app.mjs';

const require = createRequire(import.meta.url);
const { buildApiHeatmapArtifact } = require('../../out/apiHeatmap.js');
const { API_HEATMAP_UI_TRANSLATIONS } = require('../../out/i18n.js');

// Browser protocol tests use fakeHost: no Extension Host save dialog, clipboard,
// filesystem write or pricing loader runs here. The synthetic response bytes do
// come from the current production artifact builder. Real-host immutable export
// and source/price retirement are covered separately by apiHeatmapHost.test.ts.
const usage = (tokens, amountUSD, pricingStatus = 'complete', estimated = false) => ({
  tokens, amountUSD, pricingStatus, estimated,
  pricedCount: ['empty', 'unpriced'].includes(pricingStatus) ? 0 : 2,
  unpricedCount: ['unpriced', 'partial'].includes(pricingStatus) ? 1 : 0,
});
const knownDaily = {
  '2026-07-20': { claude: usage(170_000, 17, 'complete', true), codex: usage(270_000, 27) },
};
const qualityDaily = {
  '2026-07-16': { claude: usage(100, null, 'unpriced', true) },
  '2026-07-17': { claude: usage(100, 2, 'partial', true) },
  '2026-07-18': { claude: { ...usage(0, 0), pricedCount: 0 } },
  '2026-07-20': knownDaily['2026-07-20'],
};
const preview = page => page.locator('#combinedHeatmapPreview');
const exports = page => page.locator('#combinedHeatmapExport');
const copies = page => page.locator('#combinedHeatmapCopy');
const posted = page => page.evaluate(() => window.__ccuPostedMessages);
const clearMessages = page => page.evaluate(() => { window.__ccuPostedMessages = []; });
const reply = (page, data) => page.evaluate(data => {
  window.dispatchEvent(new MessageEvent('message', { data }));
}, data);

async function requestPreview(page) {
  await page.locator('.combined-share-actions .btn-primary').click();
  const request = (await posted(page)).findLast(row => row.command === 'previewCombinedHeatmap');
  expect(request.documentId).toMatch(/^[0-9a-f]{48}$/);
  expect(Number.isSafeInteger(request.requestId) && request.requestId > 0).toBe(true);
  return request;
}

function fakeHost(request, { daily = knownDaily, locale = 'en' } = {}) {
  const artifact = buildApiHeatmapArtifact(daily, {
    ...request, endDateISO: '2026-07-20', timezone: 'Asia/Hong_Kong', locale, currency: 'USD',
  });
  return { artifact, response: {
    command: 'combinedHeatmapResult', documentId: request.documentId, requestId: request.requestId,
    previewId: request.requestId.toString(16).padStart(48, '0'), hasData: true,
    svg: artifact.svg, markdown: artifact.markdown, filename: artifact.filename,
  } };
}

async function acceptPreview(page, options) {
  const request = await requestPreview(page);
  const result = fakeHost(request, options);
  await reply(page, result.response);
  await expect(preview(page)).toHaveAttribute('data-preview-id', result.response.previewId);
  await expect(exports(page)).toBeEnabled();
  return { request, ...result };
}

async function expectRetired(page) {
  await expect(preview(page).locator('svg')).toHaveCount(0);
  await expect(preview(page)).toHaveAttribute('data-preview-id', '');
  await expect(preview(page)).toHaveAttribute('data-config-key', '');
  await expect(page.locator('#combinedHeatmapMarkdown')).toHaveValue('');
  await expect(exports(page)).toBeDisabled();
  await expect(copies(page)).toBeDisabled();
}

const attemptedExternalRequests = new WeakMap();
test.beforeEach(async ({ page }) => {
  const attempts = [];
  attemptedExternalRequests.set(page, attempts);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    attempts.push(url.origin);
    return route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(attemptedExternalRequests.get(page)).toEqual([]);
  expect((await posted(page)).some(row => /github|publish|pricing|fetch/i.test(row.command))).toBe(false);
});

for (const provider of ['claude', 'codex', 'both']) {
  for (const metric of ['tokens', 'apiEquivalent']) {
    test(`fakeHost accepts canonical ${provider} × ${metric}, then explicit export/copy`, async ({ page }) => {
      await openCompare(page, { fixture: 'combined-heatmap' });
      await expect(page.locator('#combinedHeatmapMetric')).toHaveValue('tokens');
      await expect(page.locator('#combinedHeatmapShowAmounts')).not.toBeChecked();
      await page.locator('#combinedHeatmapProvider').selectOption(provider);
      await page.locator('#combinedHeatmapMetric').selectOption(metric);
      await clearMessages(page);
      await expectRetired(page);
      // Even invoking the public handlers cannot emit an export before ACK.
      await page.evaluate(() => { exportCombinedHeatmap(); copyCombinedHeatmapMarkdown(); });
      expect(await posted(page)).toEqual([]);
      const { request, artifact, response } = await acceptPreview(page);
      expect((await posted(page)).map(row => row.command)).toEqual([
        'retireCombinedHeatmapPreview', 'previewCombinedHeatmap',
      ]);
      await expect(page.locator('#combinedHeatmapMarkdown')).toHaveValue(artifact.markdown);
      const svg = await preview(page).locator(':scope > svg').evaluate(node => node.outerHTML);
      if (metric === 'apiEquivalent') {
        const selected = provider === 'both' ? ['claude', 'codex'] : [provider];
        await expect(preview(page).locator('[data-provider]')).toHaveCount(selected.length);
        for (const source of selected) {
          await expect(preview(page).locator(`[data-provider="${source}"]`))
            .toContainText(source === 'claude' ? '$17.00' : '$27.00');
        }
        expect(svg + artifact.markdown).not.toContain('$44.00');
        await expect(page.locator('#combinedHeatmapAmountDisclosure')).toBeVisible();
      } else {
        expect(svg + artifact.markdown).not.toMatch(/\$|amountUSD|pricedCount|Current pricing|Coverage/);
        await expect(page.locator('#combinedHeatmapAmountDisclosure')).toBeHidden();
        expect(artifact.summary).toContain(provider === 'codex' ? '270K' : '170K');
      }
      expect(request).toMatchObject({ provider, metric, showAmounts: metric === 'apiEquivalent' });
      const acceptedIdentity = await preview(page).evaluate(node => ({
        html: node.innerHTML, previewId: node.dataset.previewId, configKey: node.dataset.configKey,
      }));
      // Privacy preview is UI information only. It travels with the draft but
      // cannot change artifact bytes or invalidate the accepted artifact key.
      await page.locator('#combinedHeatmapPrivacy').uncheck();
      expect(await preview(page).evaluate(node => ({
        html: node.innerHTML, previewId: node.dataset.previewId, configKey: node.dataset.configKey,
      }))).toEqual(acceptedIdentity);
      expect(fakeHost({ ...request, privacyPreview: false }).artifact).toEqual(artifact);
      await exports(page).click();
      await expect(exports(page)).toBeDisabled();
      await expect(copies(page)).toBeDisabled();
      await reply(page, { command: 'combinedHeatmapExportResult', documentId: request.documentId,
        previewId: response.previewId, ok: true });
      await expect(exports(page)).toBeEnabled();
      await copies(page).click();
      const actions = (await posted(page)).filter(row => /^(exportCombinedHeatmap|copyCombinedHeatmapMarkdown)$/.test(row.command));
      expect(actions).toEqual(['exportCombinedHeatmap', 'copyCombinedHeatmapMarkdown'].map(command => {
        const { command: _command, requestId: _requestId, ...draft } = request;
        return { command, ...draft, privacyPreview: false, previewId: response.previewId };
      }));
    });
  }
}

test('canonical artifact distinguishes missing, unpriced, partial and real zero in the browser', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap' });
  await page.locator('#combinedHeatmapProvider').selectOption('claude');
  await page.locator('#combinedHeatmapMetric').selectOption('apiEquivalent');
  await acceptPreview(page, { daily: qualityDaily });
  const cell = date => preview(page).locator('rect').filter({ has: page.locator('title', { hasText: date }) });
  await expect(cell('2026-07-16')).toHaveAttribute('fill', '#d1d5db');
  await expect(cell('2026-07-16')).toContainText('Unpriced');
  await expect(cell('2026-07-16')).not.toContainText('$0');
  await expect(cell('2026-07-17')).toHaveAttribute('stroke-dasharray', '2 2');
  await expect(cell('2026-07-17')).toContainText('Priced subtotal ≥$2.00');
  await expect(cell('2026-07-17')).toContainText('Coverage 2/3');
  await expect(cell('2026-07-18')).toHaveAttribute('fill', '#ebedf0');
  await expect(cell('2026-07-18')).toContainText('$0.00');
  await expect(cell('2026-07-19')).toHaveAttribute('fill', '#f6f8fa');
  await expect(cell('2026-07-19')).toContainText('No data');
  await expect(cell('2026-07-19')).not.toContainText('$0');
});

test('hide amounts synchronously retires money bytes, metadata, colors and rejects late money reply', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap' });
  await page.locator('#combinedHeatmapMetric').selectOption('apiEquivalent');
  const money = await acceptPreview(page);
  // Inspect immediately inside the actual change event turn, before any waits.
  const immediate = await page.locator('#combinedHeatmapShowAmounts').evaluate(input => {
    input.click();
    const node = document.getElementById('combinedHeatmapPreview');
    return { html: node.innerHTML, previewId: node.dataset.previewId,
      markdown: document.getElementById('combinedHeatmapMarkdown').value,
      disabled: document.getElementById('combinedHeatmapExport').disabled };
  });
  expect(immediate).toEqual({ html: '', previewId: '', markdown: '', disabled: true });
  await expect(page.locator('#combinedHeatmapMetric')).toHaveValue('tokens');
  await expect(page.locator('#combinedHeatmapAmountDisclosure')).toBeHidden();
  await reply(page, money.response);
  await expectRetired(page);
  // Also reject a genuinely pending money response after the opt-in is revoked.
  await page.locator('#combinedHeatmapMetric').selectOption('apiEquivalent');
  const pending = fakeHost(await requestPreview(page));
  await page.locator('#combinedHeatmapShowAmounts').uncheck();
  await reply(page, pending.response);
  await expectRetired(page);
  const token = await acceptPreview(page);
  const protectedDaily = { '2026-07-20': {} };
  for (const provider of ['claude', 'codex']) {
    const source = { tokens: knownDaily['2026-07-20'][provider].tokens };
    for (const key of ['amountUSD', 'pricingStatus', 'estimated', 'pricedCount', 'unpricedCount', 'sourceComplete']) {
      Object.defineProperty(source, key, { get() { throw new Error(`hidden read ${key}`); } });
    }
    protectedDaily['2026-07-20'][provider] = source;
  }
  expect(fakeHost(token.request, { daily: protectedDaily }).artifact).toEqual(token.artifact);
  const content = await preview(page).evaluate(node => node.innerHTML);
  expect(content + token.artifact.markdown).not.toMatch(/\$|amountUSD|pricedCount|Coverage|Current pricing|<desc/);
  const tokenFills = await preview(page).locator('rect').evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')));
  expect(tokenFills).not.toContain('#d1d5db');
  expect(tokenFills).not.toContain('#f6f8fa');
});

test('wrong document, old request and changed draft cannot accept a reply', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap' });
  const first = fakeHost(await requestPreview(page));
  await reply(page, { ...first.response, documentId: 'f'.repeat(48) });
  await expectRetired(page);
  const second = fakeHost(await requestPreview(page));
  await reply(page, first.response);
  await expectRetired(page);
  // A changed draft is rejected even without firing a retirement event.
  await page.locator('#combinedHeatmapTitle').evaluate(input => { input.value = 'Different unsubmitted draft'; });
  await reply(page, second.response);
  await expectRetired(page);
  await acceptPreview(page);
  const messages = (await posted(page)).filter(row => /^(retireCombinedHeatmapPreview|previewCombinedHeatmap)$/.test(row.command));
  expect(messages.every((row, index) => row.requestId > 0 && (index === 0 || row.requestId > messages[index - 1].requestId))).toBe(true);
  expect(new Set(messages.map(row => row.documentId)).size).toBe(1);
});

test('each artifact input immediately retires an accepted preview without requesting export', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap' });
  for (const [id, value, event] of [
    ['combinedHeatmapTitle', 'Changed title', 'input'],
    ['combinedHeatmapRange', '30d', 'change'],
    ['combinedHeatmapIntensityMode', 'linear', 'change'],
    ['combinedHeatmapProvider', 'codex', 'change'],
    ['combinedHeatmapMetric', 'apiEquivalent', 'change'],
    ['combinedHeatmapCustomAccent', '#123456', 'change'],
  ]) {
    await acceptPreview(page);
    await clearMessages(page);
    const immediate = await page.locator(`#${id}`).evaluate((input, { value, event }) => {
      input.value = value;
      input.dispatchEvent(new Event(event, { bubbles: true }));
      return { html: document.getElementById('combinedHeatmapPreview').innerHTML,
        markdown: document.getElementById('combinedHeatmapMarkdown').value,
        disabled: document.getElementById('combinedHeatmapExport').disabled };
    }, { value, event });
    expect(immediate, id).toEqual({ html: '', markdown: '', disabled: true });
    expect((await posted(page)).map(row => row.command)).toEqual(['retireCombinedHeatmapPreview']);
  }
  await acceptPreview(page);
  await page.getByRole('radio', { name: 'Custom', exact: true }).check();
  await expectRetired(page);
});

test('no-data, failed and malformed preview acknowledgments cannot enable export', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap' });
  for (const invalid of [{ hasData: false }, { failed: true }, { previewId: 'invalid' }, { svg: '' }]) {
    const result = fakeHost(await requestPreview(page));
    await reply(page, { ...result.response, ...invalid });
    await expect(exports(page)).toBeDisabled();
    await expect(copies(page)).toBeDisabled();
    await expect(preview(page)).toHaveAttribute('data-preview-id', '');
    await expect(page.locator('#combinedHeatmapMarkdown')).toHaveValue('');
  }
});

for (const outcome of ['saved', 'cancelled', 'failed', 'stale']) {
  test(`matching API export ${outcome} feedback releases busy state`, async ({ page }) => {
    await openCompare(page, { fixture: 'combined-heatmap' });
    await page.locator('#combinedHeatmapMetric').selectOption('apiEquivalent');
    const accepted = await acceptPreview(page);
    await exports(page).click();
    const feedback = { command: 'combinedHeatmapExportResult', documentId: accepted.request.documentId,
      previewId: accepted.response.previewId, ok: outcome === 'saved',
      cancelled: outcome === 'cancelled', stale: outcome === 'stale' };
    await reply(page, { ...feedback, documentId: 'f'.repeat(48) });
    await reply(page, { ...feedback, previewId: 'e'.repeat(48) });
    await expect(exports(page)).toBeDisabled();
    await reply(page, feedback);
    await expect(page.locator('#combinedHeatmapStatus')).toHaveText(API_HEATMAP_UI_TRANSLATIONS.en[outcome]);
    if (outcome === 'stale') await expectRetired(page);
    else await expect(exports(page)).toBeEnabled();
    await acceptPreview(page);
    await exports(page).click();
    expect((await posted(page)).filter(row => row.command === 'exportCombinedHeatmap')).toHaveLength(2);
  });
}

for (const [provider, metric] of [['both', 'apiEquivalent'], ['claude', 'tokens'], ['codex', 'tokens']]) {
  test(`default-title reload regenerates restored ${provider} ${metric} independently of title edits`, async ({ page }) => {
    await openCompare(page, { fixture: 'combined-heatmap' });
    const title = page.locator('#combinedHeatmapTitle');
    const defaultTitle = await title.getAttribute('data-default-value');
    await expect(title).toHaveValue(defaultTitle);
    if (provider !== 'both') await page.locator('#combinedHeatmapProvider').selectOption(provider);
    if (metric !== 'tokens') await page.locator('#combinedHeatmapMetric').selectOption(metric);
    const before = await acceptPreview(page);
    expect(await page.evaluate(() => localStorage.getItem('ccu.combinedHeatmap.title'))).toBe(defaultTitle);
    await page.reload({ waitUntil: 'load' });
    await expect(title).toHaveValue(defaultTitle);
    await expect(page.locator('#combinedHeatmapProvider')).toHaveValue(provider);
    await expect(page.locator('#combinedHeatmapMetric')).toHaveValue(metric);
    expect(await page.locator('#combinedHeatmapShowAmounts').isChecked()).toBe(metric === 'apiEquivalent');
    const restoredState = await page.evaluate(() => ({
      previewRequests: window.__ccuPostedMessages.filter(row => row.command === 'previewCombinedHeatmap').length,
      hasSvg: !!document.querySelector('#combinedHeatmapPreview svg'),
      exportDisabled: document.querySelector('#combinedHeatmapExport').disabled,
      copyDisabled: document.querySelector('#combinedHeatmapCopy').disabled,
    }));
    // Restored controls may not relabel the default both-provider token artifact
    // as accepted. Require a fresh, document-bound production request first.
    expect(restoredState).toEqual({ previewRequests: 1, hasSvg: false, exportDisabled: true, copyDisabled: true });
    await expectRetired(page);
    const request = (await posted(page)).findLast(row => row.command === 'previewCombinedHeatmap');
    expect(request).toMatchObject({ title: defaultTitle, provider, metric, showAmounts: metric === 'apiEquivalent' });
    expect(request.documentId).not.toBe(before.request.documentId);
    await reply(page, before.response);
    await expectRetired(page);
    const restored = fakeHost(request);
    await reply(page, restored.response);
    await expect(preview(page)).toHaveAttribute('data-preview-id', restored.response.previewId);
    await expect(exports(page)).toBeEnabled();
    await expect(copies(page)).toBeEnabled();
    await expect(page.locator('#combinedHeatmapMarkdown')).toHaveValue(restored.artifact.markdown);
    if (metric === 'apiEquivalent') {
      await expect(preview(page).locator('svg[data-provider]')).toHaveCount(2);
      for (const selected of ['claude', 'codex'])
        await expect(preview(page).locator(`svg[data-provider="${selected}"]`)).toHaveCount(1);
      await expect(preview(page)).toContainText('$17.00');
      await expect(preview(page)).toContainText('$27.00');
    } else {
      await expect(preview(page).locator(':scope > svg')).toHaveAttribute('aria-label', `${defaultTitle}. ${restored.artifact.summary}`);
      await expect(preview(page)).toContainText(restored.artifact.summary);
      expect(restored.artifact.summary).toContain(provider === 'claude' ? 'Claude 170K' : 'Codex 270K');
      expect(await preview(page).textContent()).not.toMatch(/\$17|\$27/);
    }
    // The resulting explicit export must carry the newly accepted identity.
    await exports(page).click();
    expect((await posted(page)).findLast(row => row.command === 'exportCombinedHeatmap'))
      .toMatchObject({ previewId: restored.response.previewId, documentId: request.documentId,
        provider, metric, showAmounts: metric === 'apiEquivalent' });
  });
}

test('operation → reload preserves API preferences separately from Share Card estimatedCost', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'claudeShareCard' });
  await page.locator('.sc-sec[data-sec="estimatedCost"]').uncheck();
  await page.getByLabel('Presentation').selectOption('combinedHeatmap');
  await openCompare(page, { fixture: 'combined-heatmap' });
  await page.locator('#combinedHeatmapProvider').selectOption('codex');
  await page.locator('#combinedHeatmapMetric').selectOption('apiEquivalent');
  await page.locator('#combinedHeatmapTitle').fill('Saved API draft');
  await page.locator('#combinedHeatmapRange').selectOption('90d');
  const before = await acceptPreview(page);
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#combinedHeatmapProvider')).toHaveValue('codex');
  await expect(page.locator('#combinedHeatmapMetric')).toHaveValue('apiEquivalent');
  await expect(page.locator('#combinedHeatmapShowAmounts')).toBeChecked();
  await expect(page.locator('#combinedHeatmapTitle')).toHaveValue('Saved API draft');
  await expect(page.locator('#combinedHeatmapRange')).toHaveValue('90d');
  await expectRetired(page);
  const restored = (await posted(page)).findLast(row => row.command === 'previewCombinedHeatmap');
  expect(restored.documentId).not.toBe(before.request.documentId);
  await reply(page, before.response);
  await expectRetired(page);
  await reply(page, fakeHost(restored).response);
  await expect(exports(page)).toBeEnabled();
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'claudeShareCard' });
  await expect(page.locator('.sc-sec[data-sec="estimatedCost"]')).not.toBeChecked();
  await page.locator('.sc-sec[data-sec="estimatedCost"]').check();
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('.sc-sec[data-sec="estimatedCost"]')).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('ccu.combinedHeatmap.showAmounts'))).toBe('true');
});

for (const surviving of ['claude', 'codex']) {
  test(`unavailable restored provider cannot transfer amount opt-in to ${surviving}`, async ({ page }) => {
    await openCompare(page, { fixture: 'combined-heatmap' });
    await page.locator('#combinedHeatmapProvider').selectOption(surviving === 'claude' ? 'codex' : 'claude');
    await page.locator('#combinedHeatmapMetric').selectOption('apiEquivalent');
    await acceptPreview(page);
    if (surviving === 'claude') await openClaude(page, { fixture: 'combined-heatmap', claudeOnly: true });
    else await openCodex(page, { fixture: 'combined-heatmap', codexOnly: true });
    await page.locator('#tab-all').click();
    await page.getByLabel('Presentation').selectOption('combinedHeatmap');
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('#combinedHeatmapProvider')).toHaveValue(surviving);
    await expect(page.locator('#combinedHeatmapMetric')).toHaveValue('tokens');
    await expect(page.locator('#combinedHeatmapShowAmounts')).not.toBeChecked();
    await expect(page.locator('#combinedHeatmapAmountDisclosure')).toBeHidden();
    expect((await posted(page)).filter(row => row.command === 'previewCombinedHeatmap')
      .every(row => row.metric === 'tokens' && row.showAmounts === false)).toBe(true);
  });
}

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} provider, metric, opt-in and adjacent disclosure are localized and accessible`, async ({ page }) => {
    await openCompare(page, { fixture: 'combined-heatmap', locale });
    const copy = API_HEATMAP_UI_TRANSLATIONS[locale];
    const panel = page.locator('[data-sharing-presentation="combinedHeatmap"]');
    await expect(panel.getByRole('combobox', { name: copy.providerLabel, exact: true })).toHaveValue('both');
    await expect(panel.getByRole('combobox', { name: copy.metricLabel, exact: true })).toHaveValue('tokens');
    await expect(panel.getByRole('checkbox', { name: copy.showAmounts, exact: true })).not.toBeChecked();
    await panel.getByRole('combobox', { name: copy.metricLabel, exact: true }).selectOption('apiEquivalent');
    await expect(panel.getByRole('checkbox', { name: copy.showAmounts, exact: true })).toBeChecked();
    await expect(page.locator('#combinedHeatmapAmountDisclosure')).toHaveText(copy.amountDisclosure);
    await expect(page.locator('#combinedHeatmapAmountDisclosure')).toBeVisible();
    expect(await page.locator('#combinedHeatmapShowAmounts').evaluate(input =>
      input.closest('label').nextElementSibling.id)).toBe('combinedHeatmapAmountDisclosure');
    await acceptPreview(page, { locale });
    const results = await new AxeBuilder({ page }).include('.combined-heatmap-panel').analyze();
    expect(results.violations).toEqual([]);
  });
}

for (const [width, locale, theme] of [[320, 'en', 'light'], [360, 'zh-CN', 'dark']]) {
  test(`${width}px ${locale} ${theme} API scroller retains provider headings and actual screenshot`, async ({ page }, testInfo) => {
    await openCompare(page, { fixture: 'combined-heatmap', locale, theme, width, height: 900 });
    // Establish rendering-environment fidelity before accepting screenshots.
    const missingThemeVariables = await page.evaluate(() => {
      const css = [...document.querySelectorAll('head style:not(#test-vscode-theme)')].map(el => el.textContent).join('\n');
      const harnessCss = document.querySelector('#test-vscode-theme').textContent;
      const defined = new Map([...harnessCss.matchAll(/(--vscode-[\w-]+)\s*:\s*([^;{}]*);/g)]
        .map(match => [match[1], match[2].trim()]));
      const nullable = new Set(['--vscode-input-border', '--vscode-textBlockQuote-background', '--vscode-toolbar-hoverBackground',
        '--vscode-button-secondaryBackground', '--vscode-button-secondaryHoverBackground', '--vscode-charts-orange',
        '--vscode-list-inactiveSelectionBackground', '--vscode-widget-shadow']);
      const style = getComputedStyle(document.documentElement);
      return [...new Set([...css.matchAll(/var\(\s*(--vscode-[\w-]+)/g)].map(match => match[1]))]
        .filter(name => {
          if (!defined.has(name)) return true;
          if (style.getPropertyValue(name).trim()) return false;
          // An explicit registered null color is faithful; missing variables
          // and arbitrary empty definitions are never rescued by a fallback.
          return !(nullable.has(name) && defined.get(name) === 'initial');
        });
    });
    expect(missingThemeVariables).toEqual([]);
    await page.locator('#combinedHeatmapMetric').selectOption('apiEquivalent');
    await acceptPreview(page, { locale });
    await expect(preview(page)).toHaveAttribute('tabindex', '0');
    const geometry = await preview(page).evaluate(node => {
      const svg = node.querySelector(':scope > svg');
      const labels = [...svg.querySelectorAll('text')];
      return { pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        headings: labels.filter(label => /Claude|Codex/.test(label.textContent)).map(label => label.textContent),
        outside: [...svg.querySelectorAll('svg[data-provider]')].flatMap(block => {
          const box = block.viewBox.baseVal;
          return [...block.querySelectorAll('text')].filter(label => {
            const bounds = label.getBBox();
            return bounds.x < -0.5 || bounds.y < -0.5 || bounds.x + bounds.width > box.width + 0.5 || bounds.y + bounds.height > box.height + 0.5;
          }).map(label => label.textContent);
        }) };
    });
    expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
    expect(geometry.headings.some(text => text.includes('Claude'))).toBe(true);
    expect(geometry.headings.some(text => text.includes('Codex'))).toBe(true);
    expect(geometry.outside, geometry).toEqual([]);
    await preview(page).scrollIntoViewIfNeeded();
    const path = testInfo.outputPath(`api-${width}-${locale}-${theme}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach('API heatmap actual browser screenshot', { path, contentType: 'image/png' });
    await preview(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.clock.runFor(300);
    await expect.poll(() => preview(page).evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    const scrollerPath = testInfo.outputPath(`api-scroller-${width}-${locale}-${theme}.png`);
    await preview(page).screenshot({ path: scrollerPath });
    await testInfo.attach('API heatmap focused scroller screenshot', { path: scrollerPath, contentType: 'image/png' });
  });
}
