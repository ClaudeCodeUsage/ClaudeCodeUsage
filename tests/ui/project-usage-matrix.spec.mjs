import { test, expect, openClaude, openCodex } from './support/app.mjs';

async function openProjects(page) {
  await page.locator('#tab-projects').click();
  await expect(page.locator('#projects')).toBeVisible();
}

async function patchCurrentDashboard(page, provider) {
  const response = await page.context().request.get(page.url());
  const documentText = await response.text();
  await page.evaluate(({ nextProvider, documentText }) => {
    const nextDocument = new DOMParser().parseFromString(documentText, 'text/html');
    const nextPanel = nextDocument.getElementById('provider-panel');
    if (!nextPanel) throw new Error('Fixture did not render a provider panel');
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'dashboardDataPatch',
        provider: nextProvider,
        tab: 'projects',
        revision: 1,
        html: nextPanel.innerHTML,
        claudeLast30HoursByDay: {},
      },
    }));
  }, { nextProvider: provider, documentText });
}

test('Claude Projects starts with the bounded 30-day Token heatmap', async ({ page }) => {
  await openClaude(page);
  await openProjects(page);

  const matrix = page.locator('#projects [data-project-matrix="claude"]');
  await expect(matrix).toBeVisible();
  await expect(matrix).toContainText('Project activity');
  await expect(matrix).toContainText('Token activity only');
  await expect(matrix.locator('[data-metric="cost"], .cost-cell, .quota-card')).toHaveCount(0);
  await expect(matrix.locator('[data-project-matrix-range="30"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(matrix.locator('[data-project-matrix-view="heatmap"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(matrix.locator('[data-project-matrix-range-panel="30"]')).toBeVisible();
  await expect(matrix.locator('[data-project-matrix-range-panel="90"]')).toBeHidden();
  await expect(matrix.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] [data-project-matrix-heatmap]')).toBeVisible();
  await expect(matrix.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] [data-project-matrix-trend]')).toBeHidden();
  await expect(matrix.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] .project-matrix-row:not([hidden])')).toHaveCount(12);
  await expect(matrix.locator('[data-project-scale-panel="day"] .project-matrix-cell')).toHaveCount(16 * 30 + 16 * 90);
});

test('range, view, and expanded rows persist separately for Claude Projects', async ({ page }) => {
  await openClaude(page);
  await openProjects(page);
  const matrix = page.locator('#projects [data-project-matrix="claude"]');

  await matrix.locator('[data-project-matrix-range="90"]').click();
  await matrix.locator('[data-project-matrix-view="trend"]').click();
  await matrix.locator('[data-project-matrix-expand]').click();
  await expect(matrix.locator('[data-project-matrix-range-panel="90"]')).toBeVisible();
  await expect(matrix.locator('[data-project-matrix-range-panel="90"] [data-project-scale-panel="day"] [data-project-matrix-trend]')).toBeVisible();
  await expect(matrix.locator('[data-project-matrix-range-panel="90"] [data-project-scale-panel="day"] .project-matrix-row:not([hidden])')).toHaveCount(16);
  await expect(matrix.locator('[data-project-matrix-range-panel="90"] [data-project-scale-panel="day"] .project-matrix-trend-series')).toHaveCount(6);
  await expect(matrix).toContainText('Other projects');

  await page.reload({ waitUntil: 'load' });
  await openProjects(page);
  const restored = page.locator('#projects [data-project-matrix="claude"]');
  await expect(restored.locator('[data-project-matrix-range="90"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(restored.locator('[data-project-matrix-view="trend"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(restored.locator('[data-project-matrix-range-panel="90"] [data-project-scale-panel="day"] .project-matrix-row:not([hidden])')).toHaveCount(16);
});

test('Codex Projects uses its indexed project-day projection and exact partial-coverage tooltips', async ({ page }) => {
  await openCodex(page);
  await openProjects(page);

  const matrix = page.locator('#projects [data-project-matrix="codex"]');
  await expect(matrix).toBeVisible();
  await expect(matrix).toContainText('Indexed subtotal');
  await expect(matrix).toContainText('ClaudeCodeUsage');
  await expect(matrix.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] .project-matrix-cell[data-day="2026-07-20"]')).toHaveCount(3);
  await expect(matrix.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] .project-matrix-cell button[aria-label*="partial coverage"]').first()).toBeAttached();
});

test('a live dashboard patch preserves the active project range, view, and keyboard focus', async ({ page }) => {
  await openCodex(page);
  await openProjects(page);
  const matrix = page.locator('#projects [data-project-matrix="codex"]');
  await matrix.locator('[data-project-matrix-range="90"]').click();
  const trend = matrix.locator('[data-project-matrix-view="trend"]');
  await trend.click();
  await trend.focus();

  await patchCurrentDashboard(page, 'codex');

  const restored = page.locator('#projects [data-project-matrix="codex"]');
  await expect(restored.locator('[data-project-matrix-range="90"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(restored.locator('[data-project-matrix-view="trend"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(restored.locator('[data-project-matrix-view="trend"]')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual({
    command: 'dashboardDataPatchAck',
    revision: 1,
    ok: true,
  });
});

test('a live Codex patch preserves project-matrix selection, focus, document identity, and horizontal scroll', async ({ page }) => {
  await openCodex(page, { width: 560, height: 800 });
  await openProjects(page);

  const matrix = page.locator('#projects [data-project-matrix="codex"]');
  const scroller = matrix.locator(
    '[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] [data-project-matrix-heatmap] .project-matrix-scroll',
  );
  await expect(matrix.locator('[data-project-matrix-range="30"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(matrix.locator('[data-project-matrix-view="heatmap"]')).toHaveAttribute('aria-pressed', 'true');

  const before = await scroller.evaluate((element) => {
    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const setStateCalls = window.__ccuSetStateCalls;
    for (let step = 1; step <= 8; step += 1) {
      element.scrollLeft = Math.min(maxScrollLeft, step * 35);
      element.dispatchEvent(new Event('scroll'));
    }
    element.focus();
    document.body.dataset.livePatchIdentity = 'preserved';
    return {
      scrollLeft: element.scrollLeft,
      maxScrollLeft,
      setStateCalls,
      setStateCallsAfterGesture: window.__ccuSetStateCalls,
    };
  });
  expect(before.maxScrollLeft).toBeGreaterThan(0);
  expect(before.scrollLeft).toBeGreaterThan(0);
  expect(before.setStateCallsAfterGesture).toBe(before.setStateCalls);
  await expect(scroller).toBeFocused();

  await patchCurrentDashboard(page, 'codex');

  const restoredMatrix = page.locator('#projects [data-project-matrix="codex"]');
  const restoredScroller = restoredMatrix.locator(
    '[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] [data-project-matrix-heatmap] .project-matrix-scroll',
  );
  await expect(restoredMatrix.locator('[data-project-matrix-range="30"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(restoredMatrix.locator('[data-project-matrix-view="heatmap"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(restoredScroller).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-live-patch-identity', 'preserved');
  await expect.poll(() => restoredScroller.evaluate((element) => element.scrollLeft)).toBe(before.scrollLeft);
});

test('Project matrix stays inside a local scroller on a narrow page', async ({ page }) => {
  await openClaude(page, { width: 360, height: 800 });
  await openProjects(page);

  const geometry = await page.locator('[data-project-matrix="claude"] [data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] .project-matrix-scroll').evaluate((scroller) => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    clientWidth: scroller.clientWidth,
    scrollWidth: scroller.scrollWidth,
  }));
  expect(geometry.documentWidth, geometry).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.bodyWidth, geometry).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scrollWidth, geometry).toBeGreaterThan(geometry.clientWidth);
});

test('the shared presentation setting can hide the project matrix for either provider', async ({ page }) => {
  await openClaude(page, { projectMatrix: false });
  await openProjects(page);
  await expect(page.locator('[data-project-matrix]')).toHaveCount(0);

  await openCodex(page, { projectMatrix: false });
  await openProjects(page);
  await expect(page.locator('[data-project-matrix]')).toHaveCount(0);
});

for (const provider of ['claude','codex']) test(`${provider}: calendar scale and inspected evidence survive patch and reload`, async ({page}) => {
  await (provider === 'claude' ? openClaude : openCodex)(page);
  await openProjects(page);
  const root=page.locator('[data-project-matrix="'+provider+'"]');
  await root.locator('[data-project-scale]').selectOption('week');
  const panel=root.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="week"]');
  await expect(panel).toBeVisible();
  const cell=panel.locator('[data-project-inspect]').first();
  await cell.click();
  const detail=await root.locator('[data-project-selection]').textContent();
  expect(detail.length).toBeGreaterThan(5);
  await patchCurrentDashboard(page,provider);
  await expect(root.locator('[data-project-scale]')).toHaveValue('week');
  await expect(root.locator('[data-project-selection]')).toHaveText(detail);
  await page.reload({waitUntil:'load'});await openProjects(page);
  await expect(root.locator('[data-project-scale]')).toHaveValue('week');
  await expect(root.locator('[data-project-selection]')).toHaveText(detail);
  await root.locator('[data-project-matrix-view="area"]').click();
  await expect(panel.locator('svg.project-matrix-area')).toBeVisible();
});

test('unknown cells retain visible hatching instead of the confirmed-zero fill',async({page},info)=>{
 await openCodex(page,{locale:'zh-CN',theme:'dark'});await openProjects(page);
 const unknown=page.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] .project-matrix-level-unknown').first();
 await expect(unknown).toBeVisible();
 expect(await unknown.evaluate(node=>getComputedStyle(node).backgroundImage)).toContain('repeating-linear-gradient');
 await page.screenshot({path:info.outputPath('production-projects.png'),fullPage:false});
 await page.locator('[data-project-matrix-view="area"]').click();
 await expect(page.locator('[data-project-matrix-view="area"]')).toHaveAttribute('aria-pressed','true');
 for(let index=0;index<3;index++){
  const root=page.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"]');
  const fill=await root.locator('.project-matrix-area-'+index).first().evaluate(n=>getComputedStyle(n).fill);
  const legend=await root.locator('i.project-matrix-series-'+index).evaluate(n=>getComputedStyle(n).backgroundColor);
  expect(fill).toBe(legend);
 }
 await page.screenshot({path:info.outputPath('production-project-areas.png'),fullPage:false});
});

for (const provider of ['claude','codex']) for (const width of [320,1280]) test(`${provider}: area overview fits all dates without shrinking labels at ${width}px`,async({page},info)=>{
 await (provider==='claude'?openClaude:openCodex)(page,{locale:'zh-CN',theme:'dark',width});await openProjects(page);
 await page.locator('[data-project-matrix-view="area"]').click();
 for(const range of ['30','90']){
  await page.locator('[data-project-matrix-range="'+range+'"]').click();
  const plot=page.locator('[data-project-matrix-range-panel="'+range+'"] [data-project-scale-panel="day"] [data-project-area-mode]');
  await expect(plot.locator('.project-chart-axis')).toContainText('Token');
  await expect(plot.locator('.project-chart-axis')).toContainText('0');
  const geometry=await plot.evaluate(el=>{
   const svg=el.querySelector('svg').getBoundingClientRect(),box=el.getBoundingClientRect();
   return {fits:svg.left>=box.left&&svg.right<=box.right+1,overflow:el.scrollWidth>el.clientWidth+1,
    font:parseFloat(getComputedStyle(el.querySelector('.project-chart-dates')).fontSize),
    ticksFit:[...el.querySelectorAll('.project-chart-axis > span')].every(t=>t.getBoundingClientRect().left>=box.left)};
  });
  expect(geometry.ticksFit).toBe(true);expect(geometry.fits).toBe(true);expect(geometry.overflow).toBe(false);expect(geometry.font).toBeGreaterThanOrEqual(11);
  const marks=plot.locator('svg [data-project-inspect]');
  await marks.last().focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-project-selection]')).not.toBeEmpty();
  await plot.screenshot({path:info.outputPath(`area-${range}-${width}.png`)});
 }
});

for (const provider of ['claude','codex']) test(`${provider}: project heading and recent scroller retain evidence through update/reload`,async({page},info)=>{
 await (provider==='claude'?openClaude:openCodex)(page,{locale:'zh-CN',theme:'dark',width:360});await openProjects(page);
 const root=page.locator('[data-project-matrix="'+provider+'"]');
 const summary=root.locator('[data-project-summary-range="30"][data-project-summary-scale="day"]');
 await expect(summary).toBeVisible();await expect(summary).toContainText('Token');await expect(summary).toContainText('2026-07-20');
 const area=root.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] .project-matrix-scroll');
 await expect.poll(()=>area.evaluate(el=>el.scrollLeft>0&&Math.abs(el.scrollWidth-el.clientWidth-el.scrollLeft)<2)).toBe(true);
 await area.evaluate(el=>{el.scrollLeft=123;el.dispatchEvent(new Event('scroll'))});await page.clock.runFor(100);
 await root.locator('.project-matrix-basis > summary').click();
 await patchCurrentDashboard(page,provider);
 await expect(root.locator('.project-matrix-basis')).toHaveAttribute('open');
 await expect.poll(()=>area.evaluate(el=>el.scrollLeft)).toBeCloseTo(123,0);
 await page.reload();await openProjects(page);
 await expect(root.locator('.project-matrix-basis')).toHaveAttribute('open');
 await expect.poll(()=>area.evaluate(el=>el.scrollLeft)).toBeCloseTo(123,0);
 await root.locator('[data-project-matrix-range="90"]').click();
 await expect(root.locator('[data-project-summary-range="90"][data-project-summary-scale="day"]')).toBeVisible();
 await root.locator('[data-project-matrix-view="area"]').click();
 await root.screenshot({path:info.outputPath(`project-approved-${provider}.png`)});
});

test('first project scroll binds its source scope and retires on a source change',async({page})=>{
 await openCodex(page,{locale:'zh-CN',theme:'dark',width:360});await openProjects(page);
 const root=page.locator('[data-project-matrix="codex"]');
 const scroller=root.locator('[data-project-matrix-range-panel="30"] [data-project-scale-panel="day"] .project-matrix-scroll');
 await scroller.evaluate(el=>{el.scrollLeft=123;el.dispatchEvent(new Event('scroll'))});await page.clock.runFor(250);
 const scope=await root.getAttribute('data-project-filter-scope');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('__ccu-vscode-state')).projectUsageMatrix.codex.filterScope)).toBe(scope);
 const response=await page.request.get(page.url());
 await page.evaluate(html=>{
  const doc=new DOMParser().parseFromString(html,'text/html'),panel=doc.getElementById('provider-panel');
  panel.querySelector('[data-project-matrix="codex"]').setAttribute('data-project-filter-scope','11111111111111111111111111111111');
  dispatchEvent(new MessageEvent('message',{data:{command:'dashboardDataPatch',provider:'codex',tab:'projects',revision:93,html:panel.innerHTML,claudeLast30HoursByDay:{}}}));
 },await response.text());await page.clock.runFor(250);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('__ccu-vscode-state')).projectUsageMatrix.codex.scrolls)).toEqual({});
 await expect.poll(()=>scroller.evaluate(el=>Math.abs(el.scrollWidth-el.clientWidth-el.scrollLeft))).toBeLessThan(2);
});
