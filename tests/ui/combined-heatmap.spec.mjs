import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import { test, expect, openClaude, openCompare } from './support/app.mjs';

const require = createRequire(import.meta.url);
const { renderCombinedHeatmapSvg } = require('../../out/combinedHeatmapSvg.js');

test('Compare opens one preview-first sharing workspace on the combined presentation', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'en' });

  const panel = page.locator('.sharing-workspace');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Sharing workspace' })).toBeVisible();
  await expect(page.getByLabel('Presentation')).toHaveValue('combinedHeatmap');
  await expect(page.getByRole('region', { name: 'Live preview' })).toBeVisible();
  await expect(page.locator('#combinedHeatmapPreview svg')).toHaveAttribute('role', 'img');
  await expect(page.getByRole('radio', { name: 'Academic Violet' })).toBeChecked();
  const markdown = page.locator('#combinedHeatmapMarkdown');
  await expect(markdown).toHaveAttribute('aria-label', 'README / Markdown snippet');
  await expect(markdown).toHaveValue(
    /^!\[Claude \+ Codex local activity\]\(claude-codex-activity-year-\d{4}-\d{2}-\d{2}\.svg\)$/,
  );
  await page.locator('.combined-output-panel summary').click();
  await expect(markdown).toBeVisible();
  const fonts = await markdown.evaluate((element) => ({
    markdown: getComputedStyle(element).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
  }));
  expect(fonts.markdown).toContain('monospace');
  expect(fonts.markdown).not.toBe(fonts.body);

  const tooltips = await page.locator('#combinedHeatmapPreview svg rect title').allTextContents();
  expect(tooltips.some((value) =>
    value.includes('Claude:') && value.includes('Codex:') && value.includes('Combined:'),
  )).toBe(true);
  await expect(page.locator('#combinedHeatmapPrivacyPreview')).toContainText('accounts, projects, thread titles, local paths, and log content');
  await expect(panel).toContainText('not productivity, subscription billing, or provider capability equivalence');
  const desktopPreviewGeometry = await page.locator('#combinedHeatmapPreview').evaluate((preview) => {
    const svg = preview.querySelector('svg');
    const more = [...preview.querySelectorAll('text')].find((element) => element.textContent === 'More');
    if (!svg || !more) {
      return null;
    }
    const previewRect = preview.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const moreRect = more.getBoundingClientRect();
    return {
      previewWidth: previewRect.width,
      svgWidth: svgRect.width,
      previewRight: previewRect.right,
      svgRight: svgRect.right,
      moreRight: moreRect.right,
      overflow: preview.scrollWidth - preview.clientWidth,
    };
  });
  expect(desktopPreviewGeometry).not.toBeNull();
  expect(desktopPreviewGeometry.overflow).toBeLessThanOrEqual(1);
  expect(desktopPreviewGeometry.svgWidth).toBeGreaterThanOrEqual(desktopPreviewGeometry.previewWidth * 0.95);
  expect(desktopPreviewGeometry.svgRight).toBeLessThanOrEqual(desktopPreviewGeometry.previewRight);
  expect(desktopPreviewGeometry.moreRight).toBeLessThanOrEqual(desktopPreviewGeometry.previewRight);
  const verticalLayout = await panel.evaluate((element) => {
    const preview = element.querySelector('.combined-preview-column');
    const settings = element.querySelector('.combined-config-card');
    if (!preview || !settings) return null;
    const previewRect = preview.getBoundingClientRect();
    const settingsRect = settings.getBoundingClientRect();
    return {
      previewBottom: previewRect.bottom,
      settingsTop: settingsRect.top,
      settingsWidth: settingsRect.width,
      panelWidth: element.getBoundingClientRect().width,
    };
  });
  expect(verticalLayout).not.toBeNull();
  expect(verticalLayout.settingsTop).toBeGreaterThanOrEqual(verticalLayout.previewBottom);
  expect(verticalLayout.settingsWidth).toBeLessThanOrEqual(verticalLayout.panelWidth);
});

test('presentation selection swaps truthful previews and survives reload', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'en' });

  const selector = page.getByLabel('Presentation');
  await expect(selector.locator('option')).toHaveText([
    'Combined activity heatmap',
    'Claude Share Card',
    'Claude token heatmap',
  ]);

  await selector.selectOption('claudeShareCard');
  await expect(page.locator('[data-sharing-presentation="combinedHeatmap"]')).toBeHidden();
  await expect(page.locator('[data-sharing-presentation="claudeShareCard"]')).toHaveClass(/sharing-presentation-placeholder/);
  await expect(page.locator('[data-sharing-presentation="claudeShareCard"]')).toBeVisible();
  await expect(page.locator('[data-sharing-presentation="claudeShareCard"] svg')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command === 'sharingTemplateChanged',
  ))).toEqual([{ command: 'sharingTemplateChanged', template: 'claudeShareCard' }]);

  await openCompare(page, {
    fixture: 'combined-heatmap',
    locale: 'en',
    commandTemplate: 'claudeShareCard',
  });
  const card = page.locator('[data-sharing-presentation="claudeShareCard"]');
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/sharing-presentation-placeholder/);
  await expect(card.locator('#scPreview svg')).toBeVisible();
  await expect(card.getByLabel('GitHub avatar')).toHaveCount(0);
  await expect(card.getByLabel('GitHub name')).toHaveCount(0);
  const cardLayout = await card.evaluate((element) => {
    const preview = element.querySelector('#scPreview');
    const controls = element.querySelector('.sharing-controls-panel');
    if (!preview || !controls) return null;
    return {
      previewBottom: preview.getBoundingClientRect().bottom,
      controlsTop: controls.getBoundingClientRect().top,
      previewWidth: preview.getBoundingClientRect().width,
      presentationWidth: element.getBoundingClientRect().width,
    };
  });
  expect(cardLayout).not.toBeNull();
  expect(cardLayout.controlsTop).toBeGreaterThanOrEqual(cardLayout.previewBottom);
  expect(cardLayout.previewWidth).toBeGreaterThanOrEqual(cardLayout.presentationWidth * 0.9);
  await page.evaluate(() => { window.__ccuPostedMessages = []; });
  await card.getByRole('button', { name: 'Update preview' }).click();
  await card.getByRole('button', { name: 'Export SVG…' }).click();
  const cardMessages = await page.evaluate(() => window.__ccuPostedMessages);
  expect(cardMessages.map(({ command }) => command)).toEqual(['buildShareCard', 'exportShareCard']);
  expect(cardMessages.every((message) => !('avatar' in message) && !('username' in message))).toBe(true);
  const cardA11y = await new AxeBuilder({ page })
    .include('[data-sharing-presentation="claudeShareCard"]')
    .analyze();
  expect(cardA11y.violations).toEqual([]);

  await page.reload({ waitUntil: 'load' });
  await expect(page.getByLabel('Presentation')).toHaveValue('claudeShareCard');
  await expect(page.locator('[data-sharing-presentation="claudeShareCard"]')).toBeVisible();

  await page.getByLabel('Presentation').selectOption('claudeHeatmap');
  await expect(page.locator('[data-sharing-presentation="claudeHeatmap"]')).toHaveClass(/sharing-presentation-placeholder/);
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command === 'sharingTemplateChanged',
  ).at(-1))).toEqual({ command: 'sharingTemplateChanged', template: 'claudeHeatmap' });
  await openCompare(page, {
    fixture: 'combined-heatmap',
    locale: 'en',
    commandTemplate: 'claudeHeatmap',
  });
  const heatmap = page.locator('[data-sharing-presentation="claudeHeatmap"]');
  await expect(heatmap).toBeVisible();
  await expect(heatmap).not.toHaveClass(/sharing-presentation-placeholder/);
  await expect(heatmap.locator('#claudeHeatmapPreview svg')).toBeVisible();
  const heatmapA11y = await new AxeBuilder({ page })
    .include('[data-sharing-presentation="claudeHeatmap"]')
    .analyze();
  expect(heatmapA11y.violations).toEqual([]);
  await page.evaluate(() => { window.__ccuPostedMessages = []; });
  await heatmap.getByRole('button', { name: 'Export SVG…' }).click();
  await heatmap.getByRole('button', { name: 'Publish to GitHub…' }).click();
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([
    { command: 'exportHeatmap' },
    { command: 'publishHeatmap' },
  ]);
});

test('unapplied Share Card controls survive a dashboard refresh and can be reset', async ({ page }) => {
  await openCompare(page, {
    fixture: 'combined-heatmap',
    locale: 'en',
    commandTemplate: 'claudeShareCard',
  });
  await page.locator('#scRange').selectOption('week');
  await page.locator('#scTheme').selectOption('auroraDark');
  await page.locator('.sc-sec[data-sec="messages"]').check();
  await page.reload();
  await expect(page.locator('#scRange')).toHaveValue('week');
  await expect(page.locator('#scTheme')).toHaveValue('auroraDark');
  await expect(page.locator('.sc-sec[data-sec="messages"]')).toBeChecked();
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'localDataClientAction', action: 'reset-sharing-preferences' },
    }));
  });
  await expect(page.locator('#scRange')).toHaveValue('last30');
  await expect(page.locator('#scTheme')).toHaveValue('claudeClassic');
  await expect(page.locator('.sc-sec[data-sec="messages"]')).not.toBeChecked();
});

test('explicit legacy command intent overrides a saved Claude tab after a full render', async ({ page }) => {
  await openClaude(page, { fixture: 'combined-heatmap', claudeOnly: true });
  await page.getByRole('tab', { name: 'Last 30 Days' }).click();
  await expect(page.locator('#tab-month')).toHaveClass(/active/);

  await openClaude(page, {
    fixture: 'combined-heatmap',
    claudeOnly: true,
    commandTemplate: 'claudeHeatmap',
  });

  await expect(page.locator('#tab-all')).toHaveClass(/active/);
  await expect(page.locator('#all .sharing-workspace')).toBeVisible();
  await expect(page.getByLabel('Presentation')).toHaveValue('claudeHeatmap');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ccu.activeTab'))).toBe('all');
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command === 'sharingTemplateCommandAck',
  ))).toEqual([{ command: 'sharingTemplateCommandAck', revision: 1 }]);
});

test('sharing reset cannot collide with the next legacy command revision', async ({ page }) => {
  await openCompare(page, {
    fixture: 'combined-heatmap',
    commandTemplate: 'claudeHeatmap',
  });
  await expect(page.getByLabel('Presentation')).toHaveValue('claudeHeatmap');
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command === 'sharingTemplateCommandAck',
  ))).toEqual([{ command: 'sharingTemplateCommandAck', revision: 1 }]);

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataClientAction',
        action: 'reset-sharing-preferences',
        requestId: 'sharing-reset-between-commands',
      },
    }));
  });
  await page.getByLabel('Presentation').selectOption('claudeShareCard');

  await openCompare(page, {
    fixture: 'combined-heatmap',
    commandTemplate: 'claudeHeatmap',
    commandAfterReset: true,
  });
  await expect(page.getByLabel('Presentation')).toHaveValue('claudeHeatmap');
  await expect(page.locator('[data-sharing-presentation="claudeHeatmap"]')).toBeVisible();
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command === 'sharingTemplateCommandAck',
  ))).toEqual([{ command: 'sharingTemplateCommandAck', revision: 2 }]);
  expect(await page.evaluate(() => sessionStorage.getItem('ccu.sharing.commandRevision'))).toBeNull();
});

test('legacy Claude panels are consolidated and sharing exposes only one visible toggle', async ({ page }) => {
  await openClaude(page, { fixture: 'combined-heatmap', locale: 'en' });

  await page.getByRole('tab', { name: 'All Time' }).click();
  await expect(page.locator('.share-panel')).toHaveCount(0);
  await expect(page.locator('#all .sharing-workspace')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Enable sharing workspace', { exact: true })).toBeVisible();
  await expect(page.getByText('Show token heatmap (All-time tab)', { exact: true })).toHaveCount(0);
});

test('sharing workspace is on by default and can be hidden without removing Compare data', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'en' });
  await expect(page.locator('.combined-heatmap-panel')).toBeVisible();

  await openCompare(page, {
    fixture: 'combined-heatmap',
    locale: 'en',
    shareStudio: false,
  });
  await expect(page.locator('.combined-heatmap-panel')).toHaveCount(0);
  await expect(page.locator('.usage-summary')).toBeVisible();
  await expect(page.locator('.weekly-value-details')).toHaveCount(2);
});

test('Compare keeps provider costs and allowance estimates separate instead of summing them', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'en' });

  const summaryCards = page.locator('#provider-panel > .usage-summary .summary-item');
  await expect(summaryCards).toHaveCount(2);
  await expect(summaryCards.locator(':scope > h3')).toHaveText(['Claude', 'Codex']);
  const summaryText = (await summaryCards.allTextContents()).join('\n');
  expect(summaryText).not.toContain('$');
  expect(summaryText).not.toMatch(/quota|allowance/i);

  const allowancePanels = page.locator('#provider-panel > .daily-breakdown').filter({
    has: page.locator('.weekly-value-details'),
  });
  await expect(allowancePanels).toHaveCount(2);
  await expect(allowancePanels.locator(':scope > .section-header > h3')).toHaveText([
    'Weekly subscription allowance · API-equivalent estimate · Claude',
    'Weekly subscription allowance · API-equivalent estimate · Codex',
  ]);
});

test('combined share preferences stay local and every export action is explicit', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'en' });
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(
    (message) => message.command !== 'localDataClientReady',
  ))).toEqual([]);

  await page.locator('#combinedHeatmapTitle').fill('My local activity');
  await page.locator('#combinedHeatmapRange').selectOption('30d');
  await page.locator('#combinedHeatmapIntensityMode').selectOption('logarithmic');
  await page.getByRole('radio', { name: 'Custom' }).check();
  await page.locator('#combinedHeatmapCustomAccent').fill('#0f766e');
  await page.locator('#combinedHeatmapPrivacy').uncheck();
  await expect(page.locator('#combinedHeatmapPrivacyPreview')).toBeHidden();

  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#combinedHeatmapTitle')).toHaveValue('My local activity');
  await expect(page.locator('#combinedHeatmapRange')).toHaveValue('30d');
  await expect(page.locator('#combinedHeatmapIntensityMode')).toHaveValue('logarithmic');
  await expect(page.getByRole('radio', { name: 'Custom' })).toBeChecked();
  await expect(page.locator('#combinedHeatmapCustomAccent')).toHaveValue('#0f766e');
  await expect(page.locator('#combinedHeatmapPrivacy')).not.toBeChecked();
  await page.evaluate(() => { window.__ccuPostedMessages = []; });

  await page.getByRole('button', { name: 'Update preview' }).click();
  await page.getByRole('button', { name: 'Export SVG…' }).click();
  await page.getByRole('button', { name: 'Copy Markdown' }).click();

  const state = await page.evaluate(() => ({
    title: localStorage.getItem('ccu.combinedHeatmap.title'),
    range: localStorage.getItem('ccu.combinedHeatmap.range'),
    privacy: localStorage.getItem('ccu.combinedHeatmap.privacyPreview'),
    intensityMode: localStorage.getItem('ccu.combinedHeatmap.intensityMode'),
    palette: localStorage.getItem('ccu.combinedHeatmap.palette'),
    customAccent: localStorage.getItem('ccu.combinedHeatmap.customAccent'),
    messages: window.__ccuPostedMessages.filter(
      (message) => message.command !== 'localDataClientReady',
    ),
  }));
  expect(state).toMatchObject({
    title: 'My local activity', range: '30d', privacy: 'false',
    intensityMode: 'logarithmic', palette: 'custom', customAccent: '#0f766e',
  });
  expect(state.messages).toEqual([
    { command: 'previewCombinedHeatmap', title: 'My local activity', range: '30d', intensityMode: 'logarithmic', palette: 'custom', customAccent: '#0f766e' },
    { command: 'exportCombinedHeatmap', title: 'My local activity', range: '30d', intensityMode: 'logarithmic', palette: 'custom', customAccent: '#0f766e' },
    { command: 'copyCombinedHeatmapMarkdown', title: 'My local activity', range: '30d', intensityMode: 'logarithmic', palette: 'custom', customAccent: '#0f766e' },
  ]);
  expect(state.messages.some((message) => /publish/i.test(message.command))).toBe(false);

  await page.evaluate(() => { window.__ccuPostedMessages = []; });
  await page.getByRole('button', { name: 'Reset sharing preferences' }).click();
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([
    { command: 'runLocalDataAction', action: 'reset-sharing-preferences' },
  ]);
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataClientAction',
        action: 'reset-sharing-preferences',
        requestId: 'direct-sharing-reset-success',
      },
    }));
  });
  expect(await page.evaluate(() => window.__ccuPostedMessages.findLast(
    (message) => message.command === 'localDataClientActionAck',
  ))).toEqual({
    command: 'localDataClientActionAck',
    requestId: 'direct-sharing-reset-success',
    ok: true,
  });
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataActionResult',
        result: { ok: true, message: 'Sharing preferences and destination strings were reset.' },
      },
    }));
  });
  await expect(page.locator('#combinedHeatmapTitle')).toHaveValue('Claude + Codex local activity');
  await expect(page.locator('#combinedHeatmapRange')).toHaveValue('year');
  await expect(page.locator('#combinedHeatmapIntensityMode')).toHaveValue('quantile');
  await expect(page.getByRole('radio', { name: 'Academic Violet' })).toBeChecked();
  await expect(page.locator('#combinedHeatmapPrivacy')).toBeChecked();
  const reset = await page.evaluate(() => ({
    title: localStorage.getItem('ccu.combinedHeatmap.title'),
    range: localStorage.getItem('ccu.combinedHeatmap.range'),
    privacy: localStorage.getItem('ccu.combinedHeatmap.privacyPreview'),
    intensityMode: localStorage.getItem('ccu.combinedHeatmap.intensityMode'),
    palette: localStorage.getItem('ccu.combinedHeatmap.palette'),
    customAccent: localStorage.getItem('ccu.combinedHeatmap.customAccent'),
    messages: window.__ccuPostedMessages,
  }));
  expect(reset).toMatchObject({
    title: null,
    range: null,
    privacy: null,
    intensityMode: null,
    palette: null,
    customAccent: null,
  });
  expect(reset.messages.some((message) => message.command === 'resetCombinedHeatmapPreferences')).toBe(false);
  await expect(page.locator('#combinedHeatmapStatus')).toContainText('Sharing preferences and destination strings were reset.');

  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#combinedHeatmapTitle')).toHaveValue('Claude + Codex local activity');
  await expect(page.locator('#combinedHeatmapRange')).toHaveValue('year');
  await expect(page.locator('#combinedHeatmapIntensityMode')).toHaveValue('quantile');
  await expect(page.getByRole('radio', { name: 'Academic Violet' })).toBeChecked();
  await expect(page.locator('#combinedHeatmapPrivacy')).toBeChecked();
});

test('direct sharing reset reports browser-storage removal failure through the host protocol', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'en' });
  await page.locator('#combinedHeatmapTitle').fill('Must survive failed reset');
  await page.getByRole('button', { name: 'Update preview' }).click();
  await page.evaluate(() => { window.__ccuPostedMessages = []; });

  await page.getByRole('button', { name: 'Reset sharing preferences' }).click();
  expect(await page.evaluate(() => window.__ccuPostedMessages)).toEqual([
    { command: 'runLocalDataAction', action: 'reset-sharing-preferences' },
  ]);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function failingSharingRemoveItem(key) {
      if (key === 'ccu.combinedHeatmap.title') {
        throw new Error('synthetic-sharing-storage-failure');
      }
      return original.call(this, key);
    };
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataClientAction',
        action: 'reset-sharing-preferences',
        requestId: 'direct-sharing-reset-failure',
      },
    }));
    Storage.prototype.removeItem = original;
  });
  expect(await page.evaluate(() => window.__ccuPostedMessages.findLast(
    (message) => message.command === 'localDataClientActionAck',
  ))).toEqual({
    command: 'localDataClientActionAck',
    requestId: 'direct-sharing-reset-failure',
    ok: false,
  });
  expect(await page.evaluate(() => localStorage.getItem('ccu.combinedHeatmap.title')))
    .toBe('Must survive failed reset');

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataActionResult',
        result: {
          ok: false,
          message: 'Host data was handled, but the Webview did not confirm its local reset.',
        },
      },
    }));
  });
  await expect(page.locator('#combinedHeatmapStatus')).toContainText(
    'Host data was handled, but the Webview did not confirm its local reset.',
  );
});

for (const theme of ['light', 'dark']) {
  test(`combined heatmap controls and preview are accessible in ${theme} theme`, async ({ page }) => {
    await openCompare(page, { fixture: 'combined-heatmap', locale: 'zh-CN', theme });
    const presentation = page.locator('[data-sharing-presentation="combinedHeatmap"]');
    await expect(presentation.getByLabel('分享标题')).toBeVisible();
    await expect(presentation.getByLabel('时间范围')).toBeVisible();
    await expect(presentation.getByLabel('色阶映射')).toHaveValue('quantile');
    await expect(presentation.getByRole('group', { name: '热力图配色' })).toBeVisible();
    await expect(presentation.getByLabel('显示隐私预览')).toBeChecked();
    await page.locator('.combined-output-panel').evaluate((element) => { element.open = true; });
    await expect(page.getByLabel('README / Markdown 引用片段')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('.combined-heatmap-panel')
      .analyze();
    expect(results.violations).toEqual([]);
    const unresolvedHtmlContrast = results.incomplete
      .filter((item) => item.id === 'color-contrast')
      .flatMap((item) => item.nodes)
      .filter((node) => !/^<text\b/.test(node.html));
    // Axe cannot resolve a painted SVG rect behind SVG text. Keep the whole
    // artifact in this scan and cover its labels deterministically in the SVG
    // renderer tests instead of excluding the SVG from accessibility checks.
    expect(unresolvedHtmlContrast).toEqual([]);
  });
}

test('Share studio copy is localized in every supported locale', async ({ page }) => {
  const expected = {
    en: ['Intensity scale', 'Sharing workspace', 'Presentation', 'More', 'total tokens'],
    'de-DE': ['Intensitätsskala', 'Freigabe-Arbeitsbereich', 'Darstellung', 'Mehr', 'Gesamttoken'],
    'zh-TW': ['色階映射', '分享工作區', '呈現方式', '較多', '總 token'],
    'zh-CN': ['色阶映射', '分享工作台', '呈现方式', '较多', '总 token'],
    ja: ['強度スケール', '共有ワークスペース', '表示形式', '多い', '総トークン'],
    ko: ['강도 스케일', '공유 작업 공간', '표시 형식', '많이', '총 토큰'],
    'pt-BR': ['Escala de intensidade', 'Espaço de compartilhamento', 'Apresentação', 'Mais', 'total de tokens'],
    id: ['Skala intensitas', 'Ruang kerja berbagi', 'Presentasi', 'Lebih banyak', 'total token'],
  };
  for (const [locale, [intensityLabel, heading, presentationLabel, combinedMarker, cardMarker]] of Object.entries(expected)) {
    await openCompare(page, { fixture: 'combined-heatmap', locale });
    await expect(page.getByLabel(intensityLabel)).toHaveValue('quantile');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByLabel(presentationLabel)).toHaveValue('combinedHeatmap');
    await expect(page.locator('#combinedHeatmapPreview svg')).toContainText(combinedMarker);
    const outOfBoundsLabels = await page.locator('#combinedHeatmapPreview svg').evaluate((svg) => {
      const viewBox = svg.viewBox.baseVal;
      return [...svg.querySelectorAll('text')].flatMap((label) => {
        const box = label.getBBox();
        return box.x < -0.5 || box.x + box.width > viewBox.width + 0.5
          ? [label.textContent]
          : [];
      });
    });
    expect(outOfBoundsLabels, { locale, outOfBoundsLabels }).toEqual([]);
    await openCompare(page, {
      fixture: 'combined-heatmap',
      locale,
      commandTemplate: 'claudeShareCard',
    });
    await expect(page.locator('#scPreview svg')).toContainText(cardMarker);
    await page.evaluate(() => localStorage.setItem('ccu.sharing.template', 'combinedHeatmap'));
  }
});

test('combined heatmap remains usable at a 360px webview width', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'zh-CN', width: 360, height: 900 });
  await expect(page.locator('.combined-heatmap-controls')).toHaveCSS('grid-template-columns', /\d+(?:\.\d+)?px/);
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  const previewOverflow = await page.locator('#combinedHeatmapPreview').evaluate((node) => {
    const svg = node.querySelector('svg');
    const viewBox = svg?.viewBox.baseVal;
    const outOfBoundsLabels = svg && viewBox
      ? [...svg.querySelectorAll('text')].flatMap((label) => {
          const box = label.getBBox();
          const epsilon = 0.5;
          return box.x < -epsilon || box.y < -epsilon ||
            box.x + box.width > viewBox.width + epsilon ||
            box.y + box.height > viewBox.height + epsilon
            ? [label.textContent]
            : [];
        })
      : ['missing-svg'];
    return {
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      outOfBoundsLabels,
    };
  });
  expect(previewOverflow.scrollWidth).toBeGreaterThan(previewOverflow.clientWidth);
  expect(previewOverflow.outOfBoundsLabels, previewOverflow).toEqual([]);
});

test('maximum ASCII and CJK titles remain inside the rendered SVG viewBox', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', locale: 'en', width: 360, height: 900 });
  for (const title of ['W'.repeat(80), '综合活动热力图'.repeat(12)]) {
    const svg = renderCombinedHeatmapSvg({}, {
      range: '30d',
      endDateISO: '2026-07-22',
      title,
    });
    await page.evaluate((renderedSvg) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          command: 'combinedHeatmapResult',
          svg: renderedSvg,
          markdown: '',
          filename: 'contained.svg',
          hasData: true,
        },
      }));
    }, svg);
    const geometry = await page.locator('#combinedHeatmapPreview svg').evaluate((element) => {
      const viewBox = element.viewBox.baseVal;
      const titleNode = element.querySelector('text');
      const box = titleNode?.getBBox();
      return {
        text: titleNode?.textContent,
        right: box ? box.x + box.width : Number.POSITIVE_INFINITY,
        width: viewBox.width,
      };
    });
    expect(geometry.text).toMatch(/…$/);
    expect(geometry.right, geometry).toBeLessThanOrEqual(geometry.width + 0.5);
  }
});

for (const template of ['claudeShareCard', 'claudeHeatmap']) {
  test(`${template} remains preview-first and accessible at a 360px webview width`, async ({ page }) => {
    await openCompare(page, {
      fixture: 'combined-heatmap',
      commandTemplate: template,
      width: 360,
      height: 900,
    });
    const presentation = page.locator(`[data-sharing-presentation="${template}"]`);
    await expect(presentation).toBeVisible();
    const geometry = await presentation.evaluate((element) => {
      const preview = element.querySelector('.sharing-artifact-preview');
      const controls = element.querySelector('.sharing-controls-panel');
      const svg = preview?.querySelector('svg');
      const viewBox = svg?.viewBox.baseVal;
      const scale = svg && viewBox?.width
        ? svg.getBoundingClientRect().width / viewBox.width
        : null;
      const outOfBoundsLabels = svg && viewBox
        ? [...svg.querySelectorAll('text')].flatMap((label) => {
            const box = label.getBBox();
            const epsilon = 0.5;
            return box.x < -epsilon || box.y < -epsilon ||
              box.x + box.width > viewBox.width + epsilon ||
              box.y + box.height > viewBox.height + epsilon
              ? [label.textContent]
              : [];
          })
        : ['missing-svg'];
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        previewBottom: preview?.getBoundingClientRect().bottom,
        previewWidth: preview?.getBoundingClientRect().width,
        previewClientWidth: preview?.clientWidth,
        previewScrollWidth: preview?.scrollWidth,
        controlsTop: controls?.getBoundingClientRect().top,
        presentationWidth: element.getBoundingClientRect().width,
        intrinsicWidth: viewBox?.width,
        scale,
        outOfBoundsLabels,
      };
    });
    expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
    expect(geometry.controlsTop).toBeGreaterThanOrEqual(geometry.previewBottom);
    expect(geometry.previewWidth).toBeGreaterThanOrEqual(geometry.presentationWidth * 0.9);
    expect(geometry.previewScrollWidth).toBeGreaterThan(geometry.previewClientWidth);
    expect(geometry.outOfBoundsLabels, geometry).toEqual([]);
    if (template === 'claudeShareCard') {
      expect(geometry.intrinsicWidth).toBe(1200);
      expect(geometry.scale, geometry).toBeGreaterThanOrEqual(0.99);
    }
    const results = await new AxeBuilder({ page })
      .include(`[data-sharing-presentation="${template}"]`)
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
