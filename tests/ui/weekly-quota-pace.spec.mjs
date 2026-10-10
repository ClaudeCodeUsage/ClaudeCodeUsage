import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './support/app.mjs';

// fakeHost only: synthetic quota responses and production HTML. No extension
// activation, normal credentials/cache/logs, quota fetch or host filesystem test.
const base = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
const pace = page => page.locator('#weeklyQuotaPace');
const setting = page => page.locator('#set_showWeeklyQuotaPace');
const posted = page => page.evaluate(() => window.__ccuPostedMessages);
const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
// Independent copy expectations, rather than importing the same translations
// that generate the HTML and allowing a missing locale to pass tautologically.
const copy = {
  en: ['Weekly quota pace', 'Used', 'Reference progress', 'Estimated at reset ≈', 'Forecast unavailable', 'Account-wide use includes other devices and members.'],
  'de-DE': ['Wöchentliches Kontingenttempo', 'Verbraucht', 'Referenzfortschritt', 'Geschätzt beim Zurücksetzen ≈', 'Prognose nicht verfügbar', 'Kontoweite Nutzung umfasst andere Geräte und Mitglieder.'],
  'zh-TW': ['週額度使用節奏', '已用', '參考進度', '週期末預計約', '預測暫不可用', '帳號總用量包含其他裝置及成員。'],
  'zh-CN': ['周额度使用节奏', '已用', '参考进度', '周期末预计约', '预测暂不可用', '账号总用量包含其他设备及成员。'],
  ja: ['週間クォータの使用ペース', '使用済み', '基準の進捗', 'リセット時の予測 ≈', '予測は利用できません', 'アカウント全体の使用量には他の端末やメンバーを含みます。'],
  ko: ['주간 할당량 사용 속도', '사용량', '기준 진행률', '초기화 시 예상 ≈', '예측을 사용할 수 없음', '계정 전체 사용량에는 다른 기기와 구성원이 포함됩니다.'],
  'pt-BR': ['Ritmo da cota semanal', 'Usado', 'Progresso de referência', 'Estimativa na redefinição ≈', 'Previsão indisponível', 'O uso da conta inclui outros dispositivos e membros.'],
  id: ['Laju kuota mingguan', 'Terpakai', 'Progres acuan', 'Perkiraan saat reset ≈', 'Perkiraan tidak tersedia', 'Pemakaian akun mencakup perangkat dan anggota lain.'],
};

async function open(page, options = {}) {
  const { width = 1280, height = 900, provider = 'claude', locale = 'en', theme = 'light',
    enabled = true, state = 'fresh' } = options;
  await page.setViewportSize({ width, height });
  const params = new URLSearchParams({ provider, locale, theme, fixture: 'weekly-quota-pace',
    quotaPace: String(enabled), quotaPaceState: state, autoRefresh: 'false' });
  const response = await page.goto(`${base}/?${params}`, { waitUntil: 'load' });
  expect(response.status()).toBe(200);
  await expect(page.locator('#provider-panel')).toBeVisible();
}

const network = new WeakMap();
test.beforeEach(async ({ page }) => {
  const evidence = { external: [], requests: [], errors: [] };
  network.set(page, evidence);
  page.on('request', request => evidence.requests.push(request.url()));
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    evidence.external.push(route.request().url());
    return route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(network.get(page).external).toEqual([]);
  expect(network.get(page).errors).toEqual([]);
  expect((await posted(page) ?? []).filter(row => /fetch|pricing|publish|refresh/i.test(row.command))).toEqual([]);
});

// Obtain replacement content from the actual production render helper through
// the fixture route, never from fabricated markup. APIRequestContext does not
// execute the replacement document or change the browser's current identity.
async function fakeHost(page, changes = {}) {
  const url = new URL(page.url());
  for (const [key, value] of Object.entries(changes)) url.searchParams.set(key, String(value));
  const response = await page.context().request.get(url.href);
  expect(response.status()).toBe(200);
  const html = await response.text();
  return page.evaluate(html => {
    const next = new DOMParser().parseFromString(html, 'text/html').getElementById('weeklyQuotaPace');
    if (!next) throw new Error('Production pace container missing from fixture HTML');
    const ready = window.__ccuPostedMessages.findLast(row => row.command === 'localDataClientReady');
    if (!ready?.documentId) throw new Error('Production document identity missing');
    return { command: 'weeklyQuotaPace', documentId: ready.documentId,
      provider: next.dataset.quotaPaceProvider, html: next.innerHTML };
  }, html);
}

for (const theme of ['light', 'dark', 'highContrast']) {
  test(`${theme}: narrow 200% CSS surrogate setting is keyboard operable and axe labelled`, async ({ page }) => {
    await open(page, { theme, width: 640, enabled: false });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await expectThemeFidelity(page, theme);
    await page.locator('#tab-settings').focus();
    await page.keyboard.press('Enter');
    await expect(setting(page)).not.toBeChecked();
    await setting(page).focus();
    network.get(page).requests = [];
    await page.keyboard.press('Space');
    await expect(setting(page)).toBeChecked();
    await expect(setting(page)).toBeFocused();
    const result = await new AxeBuilder({ page }).include('.set-row:has(#set_showWeeklyQuotaPace)')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
    expect((await posted(page)).filter(row => row.command === 'updateSetting'))
      .toEqual([{ command: 'updateSetting', key: 'showWeeklyQuotaPace', value: true }]);
    expect(network.get(page).requests).toEqual([]);
  });
}
async function deliver(page, message) {
  await page.evaluate(data => dispatchEvent(new MessageEvent('message', { data })), message);
}

async function expectThemeFidelity(page, theme) {
  const evidence = await page.evaluate(() => {
    const css = [...document.querySelectorAll('head style:not(#test-vscode-theme)')].map(el => el.textContent).join('\n');
    const themeCss = document.querySelector('#test-vscode-theme').textContent;
    const defined = new Map([...themeCss.matchAll(/(--vscode-[\w-]+)\s*:\s*([^;{}]*);/g)].map(m => [m[1], m[2].trim()]));
    const references = [...new Set([...css.matchAll(/var\(\s*(--vscode-[\w-]+)/g)].map(m => m[1]))];
    // Registered nullable colors may compute empty only when explicitly initial.
    const nullable = new Set(['--vscode-input-border', '--vscode-textBlockQuote-background', '--vscode-toolbar-hoverBackground',
      '--vscode-button-secondaryBackground', '--vscode-button-secondaryHoverBackground', '--vscode-charts-orange',
      '--vscode-list-inactiveSelectionBackground', '--vscode-widget-shadow']);
    const computed = getComputedStyle(document.documentElement);
    return { count: references.length,
      missing: references.filter(name => !defined.has(name) || (!computed.getPropertyValue(name).trim() &&
        !(nullable.has(name) && defined.get(name) === 'initial'))),
      background: getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim(),
      bodyClass: document.body.className };
  });
  expect(evidence.count).toBeGreaterThan(0);
  expect(evidence.missing).toEqual([]);
  expect(evidence.background).toBe({ light: '#ffffff', dark: '#1e1e1e', highContrast: '#000000' }[theme]);
  expect(evidence.bodyClass).toContain({ light: 'vscode-light', dark: 'vscode-dark', highContrast: 'vscode-high-contrast' }[theme]);
}

test('default OFF renders no pace block and starts no new requests', async ({ page }) => {
  await open(page, { enabled: false });
  await expect(pace(page).locator('.quota-pace')).toHaveCount(0);
  await page.locator('#tab-settings').click();
  await expect(setting(page)).not.toBeChecked();
  await expect(page.locator('#set_dashboardAutoRefresh')).not.toBeChecked();
  network.get(page).requests = [];
  await page.clock.runFor(60_000);
  expect(network.get(page).requests).toEqual([]);
});

test('real keyboard setting OFF/ON emits updateSetting; fakeHost production patches preserve document', async ({ page }) => {
  await open(page, { enabled: false });
  await page.locator('#tab-settings').click();
  await setting(page).focus();
  network.get(page).requests = [];
  await page.evaluate(() => { window.__paceDocument = document.documentElement; });
  await page.keyboard.press('Space');
  await expect(setting(page)).toBeChecked();
  expect((await posted(page)).filter(row => row.command === 'updateSetting'))
    .toEqual([{ command: 'updateSetting', key: 'showWeeklyQuotaPace', value: true }]);
  const on = await fakeHost(page, { quotaPace: true });
  await deliver(page, on);
  await expect(pace(page)).toContainText('116%');
  await setting(page).focus();
  await page.keyboard.press('Space');
  await expect(setting(page)).not.toBeChecked();
  await deliver(page, await fakeHost(page, { quotaPace: false }));
  await expect(pace(page)).toBeHidden();
  expect((await posted(page)).filter(row => row.command === 'updateSetting').map(row => row.value)).toEqual([true, false]);
  expect(await page.evaluate(() => window.__paceDocument === document.documentElement)).toBe(true);
  expect(network.get(page).requests).toEqual([]);
});

for (const state of ['stale', 'reset', 'null']) {
  test(`${state} fakeHost patch withdraws 116 while auto-refresh is paused, preserving focus/scroll/document`, async ({ page }) => {
    await open(page);
    await expect(pace(page)).toContainText('116%');
    const valid = await fakeHost(page, { quotaPaceState: state });
    const previous = await pace(page).innerHTML();
    await deliver(page, { ...valid, documentId: 'retired-document' });
    await deliver(page, { ...valid, provider: 'codex' });
    expect(await pace(page).innerHTML()).toBe(previous);
    await page.locator('#tab-settings').click();
    await expect(page.locator('#set_dashboardAutoRefresh')).not.toBeChecked();
    await setting(page).focus();
    const before = await page.evaluate(() => {
      window.__paceDocument = document.documentElement;
      return { x: scrollX, y: scrollY, focus: document.activeElement.id };
    });
    expect(before.y).toBeGreaterThan(0);
    network.get(page).requests = [];
    await deliver(page, valid);
    await expect(pace(page)).not.toContainText('116%');
    expect(await page.evaluate(() => ({ sameDocument: window.__paceDocument === document.documentElement,
      x: scrollX, y: scrollY, focus: document.activeElement.id }))).toEqual({ ...before, sameDocument: true });
    expect(network.get(page).requests).toEqual([]);
    await page.locator('#tab-today').click();
    await expect(pace(page)).toContainText('Forecast unavailable');
  });
}

test('raw/numeric mismatch cannot display an apparently trusted 116', async ({ page }) => {
  await open(page, { state: 'raw-mismatch' });
  await expect(pace(page)).not.toContainText('116%');
  await expect(pace(page).locator('[data-quota-pace-status="unavailable"]')).toHaveCount(1);
  await expect(pace(page)).toContainText('160%');
});

for (const locale of locales) {
  test(`${locale}: genuine weekly 29/25/116 and scoped 40/25/160; 5h excluded; Codex unknown unavailable`, async ({ page }) => {
    await open(page, { locale });
    const [title, used, reference, forecast, unavailable, disclosure] = copy[locale];
    await expect(pace(page).locator('h3')).toHaveText(title);
    const rows = pace(page).locator('[data-quota-pace-status]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(`${used} 29% · ${reference} 25% · ${forecast} 116%`);
    await expect(rows.nth(1)).toContainText(`${used} 40% · ${reference} 25% · ${forecast} 160%`);
    await expect(rows.nth(1)).toContainText('Synthetic scoped model');
    await expect(pace(page)).not.toContainText('73%');
    await expect(pace(page)).toContainText('2026-07-20T12:00:00.000Z');
    await expect(pace(page)).toContainText(disclosure);
    await open(page, { locale, provider: 'codex' });
    await expect(pace(page)).toContainText(unavailable);
    await expect(pace(page)).not.toContainText('116%');
    await expect(pace(page).locator('[data-quota-pace-status="ready"]')).toHaveCount(0);
  });
}

for (const locale of locales) for (const theme of ['light', 'dark', 'highContrast']) for (const width of [320, 360]) {
  test(`${locale} ${theme} ${width}px: readable pace, theme guard, axe and 200% CSS surrogate`, async ({ page }, testInfo) => {
    await open(page, { locale, theme, width });
    await expectThemeFidelity(page, theme);
    await expect(pace(page)).toContainText('116%');
    for (const scale of [1, 2]) {
      // Layout stress surrogate only: doubling the viewport while applying CSS
      // zoom preserves the effective width. This is not native browser zoom.
      await page.setViewportSize({ width: width * scale, height: 900 });
      await page.evaluate(scale => { document.documentElement.style.zoom = String(scale); }, scale);
      await pace(page).scrollIntoViewIfNeeded();
      const geometry = await pace(page).evaluate(node => {
        const texts = [...node.querySelectorAll('h3,.label,.model-details')];
        return { fits: node.scrollWidth <= node.clientWidth + 1,
          overflow: texts.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent),
          fonts: texts.map(el => parseFloat(getComputedStyle(el).fontSize)) };
      });
      expect(geometry.fits).toBe(true);
      expect(geometry.overflow).toEqual([]);
      expect(Math.min(...geometry.fonts)).toBeGreaterThanOrEqual(11);
      const result = await new AxeBuilder({ page }).include('#weeklyQuotaPace')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      await testInfo.attach(`axe-${scale}x`, { body: JSON.stringify({ violations: result.violations,
        incomplete: result.incomplete, passes: result.passes.map(row => row.id) }), contentType: 'application/json' });
      expect(result.violations).toEqual([]);
      expect(result.passes.some(row => row.id === 'color-contrast')).toBe(true);
      expect(result.incomplete.filter(row => row.id === 'color-contrast')).toEqual([]);
      const screenshot = testInfo.outputPath(`pace-${locale}-${theme}-${width}-${scale}x-css-surrogate.png`);
      await pace(page).screenshot({ path: screenshot, animations: 'disabled' });
      await testInfo.attach(`pace-${scale}x`, { path: screenshot, contentType: 'image/png' });
    }
  });
}
