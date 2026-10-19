import AxeBuilder from '@axe-core/playwright';
import { test, expect, openCodex } from './support/app.mjs';

// Synthetic snapshots enter the real view, calculation and renderer. This is
// webview acceptance, not extension activation or a live quota/account test.
const base = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
const fixture = 'weekly-rough-partial';
// Same independent registered-token inventory as codex-visual.spec.mjs.
const registeredVariables = new Set([
  '--vscode-badge-background', '--vscode-badge-foreground',
  '--vscode-button-background', '--vscode-button-foreground', '--vscode-button-hoverBackground',
  '--vscode-button-secondaryBackground', '--vscode-button-secondaryForeground', '--vscode-button-secondaryHoverBackground',
  '--vscode-charts-blue', '--vscode-charts-foreground', '--vscode-charts-green', '--vscode-charts-lines',
  '--vscode-charts-orange', '--vscode-charts-purple', '--vscode-charts-red', '--vscode-charts-yellow',
  '--vscode-descriptionForeground', '--vscode-dropdown-background', '--vscode-dropdown-border', '--vscode-dropdown-foreground',
  '--vscode-editor-background', '--vscode-editor-font-family', '--vscode-editorWidget-background',
  '--vscode-errorForeground', '--vscode-focusBorder', '--vscode-font-family', '--vscode-font-size',
  '--vscode-foreground', '--vscode-input-background', '--vscode-input-border', '--vscode-input-foreground',
  '--vscode-inputValidation-warningBackground', '--vscode-inputValidation-warningBorder',
  '--vscode-list-hoverBackground', '--vscode-panel-border', '--vscode-progressBar-background',
  '--vscode-symbolIcon-functionForeground', '--vscode-testing-iconPassed',
  '--vscode-textBlockQuote-background', '--vscode-textBlockQuote-border', '--vscode-textCodeBlock-background',
  '--vscode-textLink-foreground', '--vscode-toolbar-hoverBackground', '--vscode-editor-foreground',
  '--vscode-editorWidget-foreground', '--vscode-list-inactiveSelectionBackground', '--vscode-sideBar-background', '--vscode-widget-shadow',
]);
const details = page => page.locator('#all .weekly-estimate-details');
const history = page => page.locator('#all .weekly-value-details');
const panel = page => page.locator('#all .daily-breakdown').filter({ has: page.locator('.weekly-estimate-details') });
// Independent expected copy: importing the production dictionary would let a
// missing translation silently fall back to English on both sides of a test.
const copy = {
  en: { current: 'Current period', rough: 'Rough conversion', blocked: 'No usable conversion sample',
    currentShort: 'Current', full: 'Cycle total (estimate)', unused: 'Unused estimate', sample: 'Sample estimate', used: 'Used equivalent', asOf: 'As of observation',
    reasons: ['Account unverified', 'Priced portion only', 'Boundary split', 'Indexing incomplete', 'Quota observation changed'] },
  'de-DE': { current: 'Aktueller Zeitraum', rough: 'Grobe Umrechnung', blocked: 'Keine nutzbare Umrechnungsstichprobe',
    currentShort: 'Aktuell', full: 'Zyklussumme (Schätzung)', unused: 'Ungenutzter Schätzwert', sample: 'Stichprobenschätzwert', used: 'Genutzter Gegenwert', asOf: 'Zum Beobachtungszeitpunkt',
    reasons: ['Kontozuordnung ungeprüft', 'Nur bepreister Anteil', 'Zeitanteilige Aufteilung', 'Indizierung unvollständig', 'Kontingentbeobachtung geändert'] },
  'zh-TW': { current: '目前週期', rough: '粗略換算', blocked: '暫無可用換算樣本',
    currentShort: '目前', full: '週期總額（估值）', unused: '未用估值', sample: '樣本估值', used: '已用等價值', asOf: '截至觀測',
    reasons: ['帳號未核實', '僅已定價部分', '邊界分攤', '索引未完成', '額度觀測變化'] },
  'zh-CN': { current: '当前周期', rough: '粗略换算', blocked: '暂无可用换算样本',
    currentShort: '当前', full: '周期总额（估值）', unused: '未用估值', sample: '样本估值', used: '已用等价值', asOf: '截至观测',
    reasons: ['账号未核实', '仅已定价部分', '边界分摊', '索引未完成', '额度观测变化'] },
  ja: { current: '現在の期間', rough: '概算換算', blocked: '利用可能な換算サンプルなし',
    currentShort: '現在', full: '周期総額（推定）', unused: '未使用推定額', sample: 'サンプル推定額', used: '使用済み等価値', asOf: '観測時点',
    reasons: ['アカウント未確認', '価格適用分のみ', '境界で按分', '索引未完了', '枠の観測値が変化'] },
  ko: { current: '현재 기간', rough: '대략적 환산', blocked: '사용 가능한 환산 표본 없음',
    currentShort: '현재', full: '주기 총액(추정)', unused: '미사용 추정액', sample: '표본 추정액', used: '사용 등가치', asOf: '관측 시점',
    reasons: ['계정 미확인', '가격 적용분만', '경계 분할', '인덱싱 미완료', '한도 관측값 변경'] },
  'pt-BR': { current: 'Período atual', rough: 'Conversão aproximada', blocked: 'Nenhuma amostra utilizável para conversão',
    currentShort: 'Atual', full: 'Total do ciclo (estimado)', unused: 'Valor não utilizado estimado', sample: 'Valor da amostra (estimado)', used: 'Equivalente usado', asOf: 'Na observação',
    reasons: ['Conta não verificada', 'Somente parte com preço', 'Rateio na fronteira', 'Indexação incompleta', 'Observação de cota alterada'] },
  id: { current: 'Periode saat ini', rough: 'Konversi kasar', blocked: 'Belum ada sampel konversi yang dapat digunakan',
    currentShort: 'Saat ini', full: 'Total siklus (estimasi)', unused: 'Estimasi belum terpakai', sample: 'Estimasi sampel', used: 'Ekuivalen terpakai', asOf: 'Saat pengamatan',
    reasons: ['Akun belum terverifikasi', 'Hanya bagian dengan harga', 'Pembagian pada batas', 'Pengindeksan belum selesai', 'Pengamatan kuota berubah'] },
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
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(row =>
    /fetch|pricing|publish|refresh/i.test(row.command)))).toEqual([]);
});

async function open(page, options = {}) {
  await openCodex(page, { fixture, codexOnly: true, ...options });
  await page.locator('#tab-all').click();
}

async function reveal(page) {
  await history(page).locator(':scope > summary').click();
  await details(page).locator(':scope > summary').click();
  await expect(history(page)).toHaveAttribute('open', '');
  await expect(details(page)).toHaveAttribute('open', '');
}

async function expectAmounts(page, locale) {
  const current = history(page).locator('tbody tr').filter({ hasText: copy[locale].current });
  await expect(current).toHaveCount(1);
  await expect(current.locator('td').nth(1)).toHaveText('$120.00');
  await expect(current.locator('td').nth(2)).toContainText('25%');
  await expect(current.locator('td').nth(3)).toHaveText('$240.00');
  await expect(current.locator('td').nth(4)).toHaveText('$180.00');
  await expect(current.locator('td').nth(5)).toContainText(copy[locale].rough);
  await expect(current.locator('td').nth(6)).toHaveText('92%');
  // Estimate status is explicit in both tables' localized headers, rather than
  // repeated as an approximation symbol in every money cell.
  await expect(history(page).locator('thead th').nth(3)).toHaveText(copy[locale].full);
  await expect(history(page).locator('thead th').nth(4)).toHaveText(copy[locale].unused);
  await expect(details(page).locator('thead th').nth(2)).toHaveText(copy[locale].sample);
  await expect(details(page).locator('thead th').nth(4)).toHaveText(copy[locale].full);
  await expect(details(page).locator('thead th').nth(5)).toHaveText(copy[locale].unused);
  for (const text of await panel(page).locator('td').allTextContents()) expect(text).not.toContain('≈');

  // The conflicting reset is retained as a separate observation, never added
  // to the main period. Select the real sample by its computed full amount.
  await expect(details(page).locator('tbody tr')).toHaveCount(2);
  const record = details(page).locator('tbody tr').filter({
    has: page.getByRole('cell', { name: '$240.00', exact: true }),
  });
  await expect(record).toHaveCount(1);
  await expect(record.locator('td').nth(2)).toHaveText('$60.00');
  await expect(record.locator('td').nth(3)).toHaveText('25%');
  await expect(record.locator('td').nth(4)).toHaveText(await current.locator('td').nth(3).textContent());
  await expect(record.locator('td').nth(5)).toHaveText(await current.locator('td').nth(4).textContent());
  const otherRecord = details(page).locator('tbody tr').filter({
    has: page.getByRole('cell', { name: '$146.67', exact: true }),
  });
  await expect(otherRecord).toHaveCount(1);
  await expect(otherRecord.locator('td').nth(2)).toHaveText('$36.67');
  await expect(otherRecord.locator('td').nth(5)).toHaveText('$110.00');
  const method = record.locator('td').nth(6);
  await expect(method).toContainText(copy[locale].rough);
  const reasons = method.locator('.model-details').first();
  for (const reason of copy[locale].reasons) await expect(reasons).toContainText(reason);
  await expect(reasons).toContainText('92%');
  expect((await reasons.textContent()).split(' · ')).toHaveLength(5);
  await expect(details(page)).not.toContainText(copy[locale].blocked);
  if (locale !== 'en') {
    await expect(method).not.toContainText(copy.en.rough);
    for (const reason of copy.en.reasons) await expect(reasons).not.toContainText(reason);
  }

  // The actual-usage table retains both complete input amounts once. The chart
  // instead shows one latest valid snapshot per real reset; overlapping window
  // estimates are separate bars, not a sum or another actual-usage ledger.
  await expect(history(page).locator('tbody tr')).toHaveCount(1);
  const bars = panel(page).locator('.hc-bars .stack-bar');
  await expect(bars).toHaveCount(2);
  await expect(panel(page).locator('.hc-yaxis .hc-yval')).toHaveText(['$240.00', '$120.00', '$0.00']);
  await expect(panel(page).locator('.stack-seg.seg-input')).toHaveCount(2);
  await expect(panel(page).locator('.stack-seg.seg-cache-read')).toHaveCount(2);
  await expect(panel(page).locator('.stack-legend .legend-item')).toHaveText([copy[locale].used, copy[locale].unused]);
  const main = panel(page).locator('.hc-bars .stack-bar[title*="$240.00"]');
  const other = panel(page).locator('.hc-bars .stack-bar[title*="$146.67"]');
  await expect(main).toHaveCount(1);
  await expect(other).toHaveCount(1);
  for (const [bar, amounts] of [[main, ['$240.00', '$60.00', '$180.00']], [other, ['$146.67', '$36.67', '$110.00']]]) {
    await expect(bar).toHaveAttribute('role', 'img');
    const title = await bar.getAttribute('title');
    for (const value of [...amounts, copy[locale].full, copy[locale].used, copy[locale].unused, copy[locale].asOf]) {
      expect(title).toContain(value);
    }
    await expect(bar).toHaveAttribute('aria-label', title);
    await expect(bar).toHaveAccessibleName(title);
  }
  await expect(main.locator('.seg-input')).toHaveCSS('height', '30px');
  await expect(main.locator('.seg-cache-read')).toHaveCSS('height', '90px');
  await expect(main).toHaveCSS('height', '120px');
  // Current follows the latest observation, not the greatest reset timestamp.
  expect(await main.getAttribute('title')).toContain(copy[locale].current);
  expect(await other.getAttribute('title')).not.toContain(copy[locale].current);
  const labels = panel(page).locator('.hc-xlabel');
  await expect(labels).toHaveCount(2);
  const mainIndex = await bars.evaluateAll(nodes => nodes.findIndex(node => node.title.includes('$240.00')));
  await expect(labels.nth(mainIndex)).toHaveText(copy[locale].currentShort);
  expect(await labels.nth(1 - mainIndex).textContent()).not.toBe(copy[locale].currentShort);
}

for (const locale of Object.keys(copy)) {
  test(`${locale}: plain money cells, estimate headers and two as-of bars retain $240/$180 with short reasons`, async ({ page }) => {
    await open(page, { locale });
    await reveal(page);
    await expectAmounts(page, locale);
  });
}

async function expectThemeFidelity(page, theme) {
  const evidence = await page.evaluate(() => {
    const css = [...document.querySelectorAll('head style:not(#test-vscode-theme)')].map(el => el.textContent).join('\n');
    const themeCss = document.querySelector('#test-vscode-theme').textContent;
    const defined = new Map([...themeCss.matchAll(/(--vscode-[\w-]+)\s*:\s*([^;{}]*);/g)].map(m => [m[1], m[2].trim()]));
    const references = [...new Set([...css.matchAll(/var\(\s*(--vscode-[\w-]+)/g)].map(m => m[1]))];
    // Same registered-nullable exception as the established theme guard.
    const nullable = new Set(['--vscode-input-border', '--vscode-textBlockQuote-background', '--vscode-toolbar-hoverBackground',
      '--vscode-button-secondaryBackground', '--vscode-button-secondaryHoverBackground', '--vscode-charts-orange',
      '--vscode-list-inactiveSelectionBackground', '--vscode-widget-shadow']);
    const computed = getComputedStyle(document.documentElement);
    return { references, defined: [...defined.keys()],
      missing: references.filter(name => !defined.has(name) || (!computed.getPropertyValue(name).trim() &&
        !(nullable.has(name) && defined.get(name) === 'initial'))),
      background: computed.getPropertyValue('--vscode-editor-background').trim(), bodyClass: document.body.className };
  });
  expect(evidence.references.length).toBeGreaterThan(0);
  expect(evidence.references.filter(name => !registeredVariables.has(name))).toEqual([]);
  expect(evidence.defined.filter(name => !registeredVariables.has(name))).toEqual([]);
  expect(evidence.missing).toEqual([]);
  expect(evidence.background).toBe({ light: '#ffffff', dark: '#1e1e1e', highContrast: '#000000' }[theme]);
  expect(evidence.bodyClass).toContain({ light: 'vscode-light', dark: 'vscode-dark', highContrast: 'vscode-high-contrast' }[theme]);
}

async function expectExpandedContrast(page, testInfo) {
  // Axe cannot resolve backgrounds of cells clipped by an intentional horizontal
  // scroller. Check every expanded text style, including offscreen columns, from
  // its actual ancestor backgrounds without changing the viewport or stylesheet.
  // The thresholds are the existing codex-accessibility policy: ordinary text
  // 4.5:1; a registered theme accent with a non-color cue may use 3:1.
  const colors = await panel(page).evaluate(root => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = css => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value);
    };
    const over = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
    const luminance = rgb => rgb.map(value => value / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const theme = getComputedStyle(document.documentElement);
    const accents = ['--vscode-charts-blue', '--vscode-charts-green', '--vscode-charts-orange',
      '--vscode-charts-purple', '--vscode-charts-red', '--vscode-charts-yellow', '--vscode-focusBorder']
      .map(token => theme.getPropertyValue(token).trim()).filter(Boolean).map(rgba);
    return [...root.querySelectorAll('h3,summary,.table-hint,th,td,.model-details,.legend-item,.hc-yval,.hc-xlabel')].map(node => {
      const style = getComputedStyle(node), ancestors = [], unsupported = [];
      for (let element = node; element; element = element.parentElement) ancestors.unshift(element);
      let background = [255, 255, 255];
      for (const element of ancestors) {
        const current = getComputedStyle(element);
        if (current.backgroundImage !== 'none' || Number(current.opacity) !== 1) unsupported.push(element.className || element.tagName);
        background = over(rgba(current.backgroundColor), background);
      }
      const rawColor = rgba(style.color), foreground = over(rawColor, background);
      const accent = accents.some(color => color.every((value, index) => value === rawColor[index]));
      const nonColorCue = parseInt(style.fontWeight, 10) >= 600 || style.textDecorationLine !== 'none' ||
        (parseFloat(style.borderBottomWidth) >= 2 && style.borderBottomStyle !== 'none') ||
        Boolean(node.querySelector('svg,.codicon,[aria-hidden="true"]'));
      const a = luminance(foreground), b = luminance(background);
      return { text: node.textContent, foreground, background, unsupported,
        minimum: accent && nonColorCue ? 3 : 4.5, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  await testInfo.attach('expanded-resolved-colors', { body: JSON.stringify(colors), contentType: 'application/json' });
  expect(colors.length).toBeGreaterThan(30);
  for (const color of colors) {
    expect(color.unsupported, color.text).toEqual([]);
    expect(color.contrast, color.text).toBeGreaterThanOrEqual(color.minimum);
  }
}

for (const [locale, theme, width] of [
  ['en', 'light', 320], ['zh-CN', 'light', 360],
  ['de-DE', 'dark', 320], ['pt-BR', 'dark', 360],
  ['ko', 'highContrast', 320], ['ja', 'highContrast', 360],
]) {
  test(`${locale} ${theme} ${width}px: rough records fit the theme and accessible scroll containers`, async ({ page }, testInfo) => {
    await open(page, { locale, theme, width });
    await expectThemeFidelity(page, theme);
    await panel(page).scrollIntoViewIfNeeded();
    const result = await new AxeBuilder({ page }).include('#all .daily-breakdown:has(.weekly-estimate-details)')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    await testInfo.attach('axe-collapsed', { body: JSON.stringify({ violations: result.violations,
      incomplete: result.incomplete, passes: result.passes.map(row => row.id) }), contentType: 'application/json' });
    expect(result.violations).toEqual([]);
    expect(result.passes.some(row => row.id === 'color-contrast')).toBe(true);
    expect(result.incomplete.filter(row => row.id === 'color-contrast')).toEqual([]);
    await reveal(page);
    await expectAmounts(page, locale);
    for(const cell of await details(page).locator('tbody tr td:last-child').all()){
      expect(await cell.evaluate(node=>node.clientWidth)).toBeGreaterThanOrEqual(140);
    }
    const geometry = await panel(page).evaluate(node => {
      const texts = [...node.querySelectorAll('h3,summary,.table-hint')];
      const scrollers = [...node.querySelectorAll('.daily-table-container')];
      return { documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
        panelFits: node.scrollWidth <= node.clientWidth + 1,
        clipped: texts.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent),
        fonts: texts.map(el => parseFloat(getComputedStyle(el).fontSize)),
        scrollers: scrollers.map(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth,
          overflowX: getComputedStyle(el).overflowX, tabIndex: el.tabIndex })) };
    });
    expect(geometry.documentFits).toBe(true);
    expect(geometry.panelFits).toBe(true);
    expect(geometry.clipped).toEqual([]);
    expect(Math.min(...geometry.fonts)).toBeGreaterThanOrEqual(11);
    expect(geometry.scrollers).toHaveLength(2);
    for (const scroller of geometry.scrollers) {
      expect(scroller.width).toBeGreaterThan(0);
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.width);
      expect(scroller.overflowX).toBe('auto');
      expect(scroller.tabIndex).toBe(0);
    }
    for (const scroller of [history(page), details(page)]) {
      const table = scroller.locator('.daily-table-container');
      await table.focus();
      const before = await table.evaluate(node => node.scrollLeft);
      await page.keyboard.press('ArrowRight');
      await page.clock.runFor(300);
      await expect.poll(()=>table.evaluate(node=>node.scrollLeft)).toBeGreaterThan(before);
      await expect(table).toBeFocused();
    }
    await details(page).locator('tbody tr').first().hover();
    await expectExpandedContrast(page, testInfo);
    const screenshot = testInfo.outputPath(`rough-${locale}-${theme}-${width}.png`);
    await panel(page).screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('rough-records', { path: screenshot, contentType: 'image/png' });
  });
}

for (const theme of ['light', 'dark', 'highContrast']) {
  test(`${theme}: details operation → real dashboard patch → reload preserves state`, async ({ page }) => {
    await open(page, { theme, width: 360 });
    await reveal(page);
    const summary = details(page).locator(':scope > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details(page)).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(details(page)).toHaveAttribute('open', '');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('__ccu-vscode-state') ?? '{}').openDetails ?? []))
      .toContain('weekly-estimate-codex');
    await page.clock.runFor(250);
    const before = await summary.evaluate(node => ({ top: node.getBoundingClientRect().top,
      documentId: window.__ccuPostedMessages.find(row => row.command === 'localDataClientReady').documentId }));
    const response = await page.context().request.get(page.url());
    expect(response.status()).toBe(200);
    await page.evaluate(html => {
      const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
      if (!next) throw new Error('Real renderer provider panel missing');
      document.getElementById('provider-panel').dataset.beforeRoughPatch = 'true';
      window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch', provider: 'codex',
        tab: 'all', revision: 1, html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
    }, await response.text());
    await page.clock.runFor(500);
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(row => row.command === 'dashboardDataPatchAck')))
      .toEqual([{ command: 'dashboardDataPatchAck', revision: 1, ok: true }]);
    await expect(page.locator('#provider-panel')).toHaveAttribute('data-before-rough-patch', 'true');
    await expect(details(page)).toHaveAttribute('open', '');
    await expect(summary).toBeFocused();
    const after = await summary.evaluate(node => ({ top: node.getBoundingClientRect().top,
      documentId: window.__ccuPostedMessages.find(row => row.command === 'localDataClientReady').documentId }));
    expect(after.documentId).toBe(before.documentId);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    // Reopen the read-only period table if it does not persist; this test owns
    // only the interactive state of the estimate-record disclosure.
    if (await history(page).getAttribute('open') === null) await history(page).locator(':scope > summary').click();
    await expectAmounts(page, 'en');
    await page.reload({ waitUntil: 'load' });
    await expect(details(page)).toHaveAttribute('open', '');
    if (await history(page).getAttribute('open') === null) await history(page).locator(':scope > summary').click();
    await expectAmounts(page, 'en');
  });
}

test('existing weekly-value switch hides rough amounts and records while retaining API-equivalent cost', async ({ page }) => {
  await open(page, { weeklyValue: false });
  await expect(history(page)).toHaveCount(0);
  await expect(details(page)).toHaveCount(0);
  await expect(page.locator('#all')).not.toContainText('$240.00');
  await expect(page.locator('#all')).not.toContainText('$180.00');
  await expect(page.locator('#all .summary-grid .summary-item').first()).toContainText('API-equivalent cost');
  await page.locator('#tab-settings').click();
  await expect(page.locator('#set_showWeeklyEquivalentValue')).not.toBeChecked();
  await expect(page.locator('#set_dashboardAutoRefresh')).not.toBeChecked();
});
