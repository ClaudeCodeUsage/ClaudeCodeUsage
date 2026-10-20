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
    local: 'Local 7-day usage', inferred: 'Inferred used (estimate)', usageOnly: 'Usage only',
    currentShort: 'Current', full: 'Cycle total (estimate)', unused: 'Unused estimate', sample: 'Sample estimate', used: 'Used equivalent', asOf: 'As of observation',
    reasons: ['Account unverified', 'Priced portion only', 'Boundary split', 'Indexing incomplete', 'Quota observation changed'] },
  'de-DE': { current: 'Aktueller Zeitraum', rough: 'Grobe Umrechnung', blocked: 'Keine nutzbare Umrechnungsstichprobe',
    local: 'Lokale 7-Tage-Nutzung', inferred: 'Abgeleitete Nutzung (Schätzung)', usageOnly: 'Nur Nutzung',
    currentShort: 'Aktuell', full: 'Zyklussumme (Schätzung)', unused: 'Ungenutzter Schätzwert', sample: 'Stichprobenschätzwert', used: 'Genutzter Gegenwert', asOf: 'Zum Beobachtungszeitpunkt',
    reasons: ['Kontozuordnung ungeprüft', 'Nur bepreister Anteil', 'Zeitanteilige Aufteilung', 'Indizierung unvollständig', 'Kontingentbeobachtung geändert'] },
  'zh-TW': { current: '目前週期', rough: '粗略換算', blocked: '暫無可用換算樣本',
    local: '本機七天用量', inferred: '推算已用（估值）', usageOnly: '僅已用值',
    currentShort: '目前', full: '週期總額（估值）', unused: '未用估值', sample: '樣本估值', used: '已用等價值', asOf: '截至觀測',
    reasons: ['帳號未核實', '僅已定價部分', '邊界分攤', '索引未完成', '額度觀測變化'] },
  'zh-CN': { current: '当前周期', rough: '粗略换算', blocked: '暂无可用换算样本',
    local: '本机七天用量', inferred: '推算已用（估值）', usageOnly: '仅已用值',
    currentShort: '当前', full: '周期总额（估值）', unused: '未用估值', sample: '样本估值', used: '已用等价值', asOf: '截至观测',
    reasons: ['账号未核实', '仅已定价部分', '边界分摊', '索引未完成', '额度观测变化'] },
  ja: { current: '現在の期間', rough: '概算換算', blocked: '利用可能な換算サンプルなし',
    local: 'ローカル7日間の使用量', inferred: '使用済み推定額', usageOnly: '使用分のみ',
    currentShort: '現在', full: '周期総額（推定）', unused: '未使用推定額', sample: 'サンプル推定額', used: '使用済み等価値', asOf: '観測時点',
    reasons: ['アカウント未確認', '価格適用分のみ', '境界で按分', '索引未完了', '枠の観測値が変化'] },
  ko: { current: '현재 기간', rough: '대략적 환산', blocked: '사용 가능한 환산 표본 없음',
    local: '로컬 7일 사용량', inferred: '사용 추정액', usageOnly: '사용분만',
    currentShort: '현재', full: '주기 총액(추정)', unused: '미사용 추정액', sample: '표본 추정액', used: '사용 등가치', asOf: '관측 시점',
    reasons: ['계정 미확인', '가격 적용분만', '경계 분할', '인덱싱 미완료', '한도 관측값 변경'] },
  'pt-BR': { current: 'Período atual', rough: 'Conversão aproximada', blocked: 'Nenhuma amostra utilizável para conversão',
    local: 'Uso local em 7 dias', inferred: 'Uso inferido (estimado)', usageOnly: 'Somente uso',
    currentShort: 'Atual', full: 'Total do ciclo (estimado)', unused: 'Valor não utilizado estimado', sample: 'Valor da amostra (estimado)', used: 'Equivalente usado', asOf: 'Na observação',
    reasons: ['Conta não verificada', 'Somente parte com preço', 'Rateio na fronteira', 'Indexação incompleta', 'Observação de cota alterada'] },
  id: { current: 'Periode saat ini', rough: 'Konversi kasar', blocked: 'Belum ada sampel konversi yang dapat digunakan',
    local: 'Penggunaan lokal 7 hari', inferred: 'Penggunaan tersirat (estimasi)', usageOnly: 'Hanya pemakaian',
    currentShort: 'Saat ini', full: 'Total siklus (estimasi)', unused: 'Estimasi belum terpakai', sample: 'Estimasi sampel', used: 'Ekuivalen terpakai', asOf: 'Saat pengamatan',
    reasons: ['Akun belum terverifikasi', 'Hanya bagian dengan harga', 'Pembagian pada batas', 'Pengindeksan belum selesai', 'Pengamatan kuota berubah'] },
};
const referenceCopy = {
  en: ['7d', '7-day reference period (UTC)', 'Observed reset'],
  'de-DE': ['7T', '7-Tage-Referenzzeitraum (UTC)', 'Beobachteter Reset'],
  'zh-TW': ['7天', '7天參考週期（UTC）', '原觀測重設時間'],
  'zh-CN': ['7天', '7天参考周期（UTC）', '原观测重置时间'],
  ja: ['7日', '7日間の参考期間（UTC）', '観測されたリセット'],
  ko: ['7일', '7일 참고 기간 (UTC)', '관측된 재설정'],
  'pt-BR': ['7d', 'Período de referência de 7 dias (UTC)', 'Redefinição observada'],
  id: ['7h', 'Periode referensi 7 hari (UTC)', 'Pengaturan ulang teramati'],
};
const cycleCopy = {
  en: ['Cycle details', 'Calibration evidence', 'Incomplete evidence', 'Awaiting calibration'],
  'de-DE': ['Zyklusdetails', 'Kalibrierungsbelege', 'Unvollständige Belege', 'Kalibrierung ausstehend'],
  'zh-TW': ['週期明細', '校準證據', '證據不完整', '待校準'],
  'zh-CN': ['周期明细', '校准证据', '证据不完整', '待校准'],
  ja: ['周期の詳細', '校正の根拠', '根拠が不完全', '校正待ち'],
  ko: ['주기 상세', '교정 근거', '근거 불완전', '교정 대기'],
  'pt-BR': ['Detalhes dos ciclos', 'Evidência de calibração', 'Evidência incompleta', 'Aguardando calibração'],
  id: ['Detail siklus', 'Bukti kalibrasi', 'Bukti tidak lengkap', 'Menunggu kalibrasi'],
};
const indexingCopy = {
  en: 'Indexing is incomplete; cycle estimates use only indexed usage.',
  'de-DE': 'Die Indizierung ist unvollständig; Zyklusschätzungen nutzen nur indizierte Nutzung.',
  'zh-TW': '索引尚未完成；週期估值僅以已索引用量為依據。',
  'zh-CN': '索引尚未完成；周期估值仅以已索引用量为依据。',
  ja: '索引作成は未完了です。周期の推定は索引済みの使用量のみに基づきます。',
  ko: '인덱싱이 끝나지 않아 주기 추정에는 인덱싱된 사용량만 사용됩니다.',
  'pt-BR': 'A indexação está incompleta; as estimativas por ciclo usam apenas o uso indexado.',
  id: 'Pengindeksan belum selesai; estimasi siklus hanya memakai penggunaan yang sudah diindeks.',
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
  if (await details(page).getAttribute('open') === null) await details(page).locator(':scope > summary').click();
  await expect(history(page)).toHaveCount(0);
  await expect(details(page)).toHaveAttribute('open', '');
}

async function expectPendingPeriods(page, locale, periods = 1) {
  await expect(history(page)).toHaveCount(0);
  await expect(panel(page)).toContainText(indexingCopy[locale]);
  await expect(details(page).locator(':scope > summary')).toHaveText(cycleCopy[locale][0]);
  await expect(details(page).locator('thead th')).toHaveCount(7);
  await expect(details(page).locator('thead th').nth(2)).toHaveText(copy[locale].full);
  await expect(details(page).locator('thead th').nth(3)).toHaveText(copy[locale].inferred);
  await expect(details(page).locator('thead th').nth(4)).toHaveText(copy[locale].unused);
  await expect(details(page).locator('thead th').nth(5)).toHaveText(copy[locale].asOf);
  await expect(details(page).locator('thead th').nth(6)).toHaveText(cycleCopy[locale][1]);
  for (const text of await panel(page).locator('td').allTextContents()) expect(text).not.toContain('≈');

  // These original fixtures are incomplete and only 92% priced. The approved
  // contract retains their samples for audit, but no longer prices capacity
  // from them ($240/$180 and $146.67/$110 were old rough extrapolations).
  const rows = details(page).locator('tbody tr');
  await expect(rows).toHaveCount(periods);
  await expect(details(page).locator('details[data-cycle-evidence][data-persist]')).toHaveCount(periods);
  for (let index = 0; index < periods; index++) {
    const row = rows.nth(index);
    await expect(row.locator('td')).toHaveCount(7);
    for (const column of [2, 3, 4]) await expect(row.locator('td').nth(column)).toHaveText('—');
    expect(await row.locator('td').first().getAttribute('title')).toContain(referenceCopy[locale][1]);
    await expect(row.locator('td').nth(5)).toContainText('25%');
    const evidence = row.locator('details[data-cycle-evidence][data-persist]');
    await evidence.locator(':scope > summary').click();
    const facts = evidence.locator('[data-cycle-evidence-facts]');
    // Withheld capacity is not a usable conversion method. Keep the original
    // priced sample and its limitations readable inside the evidence disclosure.
    await expect(facts).toContainText(copy[locale].blocked);
    await expect(facts).toContainText(copy[locale].sample);
    const asOf = await row.locator('td').nth(5).evaluate(node => node.firstChild.textContent);
    await expect(facts.locator('dd').nth(1)).toHaveText(asOf);
    await expect(facts.locator('dd').nth(2)).toHaveText(index === 0 ? '$60.00' : '$36.67');
    await expect(facts).toContainText('92%');
    const reasons = evidence.locator('p.table-hint').filter({ hasText: copy[locale].reasons[0] });
    // Row evidence now labels the failed admission as incomplete evidence;
    // the panel-level status above retains the explicit indexing limitation.
    const localizedReasons = copy[locale].reasons.map((reason, reasonIndex) => reasonIndex === 3 ? cycleCopy[locale][2] : reason);
    const expectedReasons = index === 0 ? localizedReasons : localizedReasons.slice(0, -1);
    for (const reason of expectedReasons) await expect(reasons).toContainText(reason);
    expect((await reasons.textContent()).split(' · ')).toHaveLength(expectedReasons.length);
    if (locale !== 'en') {
      await expect(facts).not.toContainText(copy.en.rough);
      for (const reason of copy.en.reasons.map((reason, reasonIndex) => reasonIndex === 3 ? cycleCopy.en[2] : reason)) {
        await expect(reasons).not.toContainText(reason);
      }
    }
    await evidence.locator(':scope > summary').click();
  }
  for (const amount of ['$240.00', '$180.00', '$146.67', '$110.00']) await expect(panel(page)).not.toContainText(amount);

  await expect(panel(page).locator('[data-weekly-actual-chart]')).toHaveCount(0);
  await expect(panel(page).locator('.composition-chart')).toHaveCount(1);
  const estimatedChart = panel(page).locator('[data-weekly-estimate-chart]');
  const pending = estimatedChart.locator('.hc-bars [data-cycle-pending]');
  await expect(pending).toHaveCount(periods);
  await expect(estimatedChart.locator('.hc-bars .stack-bar')).toHaveCount(0);
  await expect(estimatedChart.locator('.hc-yaxis .hc-yval')).toHaveText(['—', '—', '—']);
  await expect(estimatedChart.locator('.stack-seg')).toHaveCount(0);
  await expect(estimatedChart.locator('.stack-legend .legend-item')).toHaveText([copy[locale].inferred, copy[locale].unused]);
  for (const marker of await pending.all()) {
    await expect(marker).toHaveAttribute('role', 'img');
    const title = await marker.getAttribute('title');
    for (const value of [copy[locale].asOf, cycleCopy[locale][3], ...referenceCopy[locale].slice(1)]) {
      expect(title).toContain(value);
    }
    expect(title).not.toContain('$');
    expect(title).not.toContain(copy[locale].current);
    await expect(marker).toHaveAttribute('aria-label', title);
    await expect(marker).toHaveAccessibleName(title);
  }
  const labels = estimatedChart.locator('.hc-xlabel');
  await expect(labels).toHaveCount(periods);
  await expect(labels.locator(':scope > span:last-child')).toHaveText(Array(periods).fill(referenceCopy[locale][0]));
  await expect(labels.locator(':scope > span:first-child')).toHaveText(periods === 2 ? ['7/20', '7/27'] : ['7/27']);
  for (const label of await labels.all()) await expect(label.locator(':scope > span')).toHaveCount(2);
  for (const label of await labels.all()) expect(await label.textContent()).not.toContain(copy[locale].currentShort);
}

for (const locale of Object.keys(copy)) {
  test(`${locale}: incomplete rough evidence remains pending once per UTC reference week`, async ({ page }) => {
    await open(page, { locale });
    await reveal(page);
    await expectPendingPeriods(page, locale);
    await open(page, { locale, fixture: 'weekly-rough-cross-week' });
    await reveal(page);
    await expectPendingPeriods(page, locale, 2);
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
    await expectPendingPeriods(page, locale);
    for(const cell of await details(page).locator('tbody tr td:nth-child(7)').all()){
      expect(await cell.evaluate(node=>node.clientWidth)).toBeGreaterThanOrEqual(140);
    }
    for(const cell of await panel(page).locator('.weekly-value-details .date-cell, .weekly-estimate-details .date-cell').all()){
      expect(await cell.evaluate(node=>node.clientWidth)).toBeGreaterThanOrEqual(100);
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
    expect(geometry.scrollers).toHaveLength(1);
    for (const scroller of geometry.scrollers) {
      expect(scroller.width).toBeGreaterThan(0);
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.width);
      expect(scroller.overflowX).toBe('auto');
      expect(scroller.tabIndex).toBe(0);
    }
    for (const scroller of [details(page)]) {
      const table = scroller.locator('.daily-table-container');
      await table.focus();
      // Opening the new last-column evidence summary scrolls it into view.
      // Start this independent keyboard-scroll proof away from the right edge.
      await table.evaluate(node => { node.scrollLeft = 0; });
      const before = await table.evaluate(node => node.scrollLeft);
      expect(before).toBe(0);
      await page.keyboard.press('ArrowRight');
      await page.clock.runFor(300);
      await expect.poll(()=>table.evaluate(node=>node.scrollLeft)).toBeGreaterThan(before);
      await expect(table).toBeFocused();
    }
    // Audit text now lives in a nested native disclosure. Exercise its expanded
    // styles as well as the outer table's hover and scroll behavior.
    for (const evidence of await details(page).locator('details[data-cycle-evidence]').all()) {
      await evidence.locator(':scope > summary').click();
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
    await expectPendingPeriods(page, 'en');
    await page.reload({ waitUntil: 'load' });
    await expect(details(page)).toHaveAttribute('open', '');
    await expectPendingPeriods(page, 'en');
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
