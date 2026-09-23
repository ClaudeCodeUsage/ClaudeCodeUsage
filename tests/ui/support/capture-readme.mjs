// Documentation images use the production renderer, fixed synthetic aggregates,
// and the registered VS Code Light+/Dark+ variables from the shared UI harness.
// Run after compile and the visual-token guard. Pass view names to avoid
// regenerating already-released evidence, for example:
// node tests/ui/support/capture-readme.mjs projects
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { renderHarness } = require('./render-harness.cjs');
const fixtureNow = Date.parse('2026-07-20T12:00:00.000Z');
const v231Output = resolve('images/v2.3.1');
const v232Output = resolve('images/v2.3.2');
const views = {
  claude: { provider: 'claude', locale: 'zh-CN', theme: 'dark', fixture: 'default' },
  codex: { provider: 'codex', locale: 'zh-CN', theme: 'dark', fixture: 'default' },
  weekly: { provider: 'codex', locale: 'en', theme: 'dark', fixture: 'default' },
  compare: { provider: 'compare', locale: 'en', theme: 'light', fixture: 'combined-heatmap' },
  projects: { provider: 'claude', locale: 'en', theme: 'dark', fixture: 'default' },
};
const requestedViews = new Set(process.argv.slice(2));
for (const view of requestedViews) {
  if (!(view in views)) throw new Error(`Unknown capture view: ${view}`);
}
const server = createServer(async (request, response) => {
  const options = views[request.url?.slice(1)];
  if (!options) { response.writeHead(404); response.end(); return; }
  const NativeDate = Date;
  try {
    // The shared harness freezes Date.now; documentation must also freeze the
    // no-argument constructor used for the calendar end date.
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixtureNow])); }
      static now() { return fixtureNow; }
    };
    const html = await renderHarness({ ...options, autoRefresh: false, weeklyValue: true, shareStudio: true });
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  } catch {
    response.writeHead(500); response.end('Fixture rendering failed');
  } finally {
    globalThis.Date = NativeDate;
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  await mkdir(v231Output, { recursive: true });
  await mkdir(v232Output, { recursive: true });
  for (const [view, options] of Object.entries(views)) {
    if (requestedViews.size > 0 && !requestedViews.has(view)) continue;
    const context = await browser.newContext({
      viewport: { width: view === 'projects' ? 860 : 1280, height: 940 }, deviceScaleFactor: 1,
      locale: options.locale, timezoneId: 'Asia/Hong_Kong', reducedMotion: 'reduce',
      colorScheme: options.theme,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.acquireVsCodeApi = () => ({
        getState: () => JSON.parse(localStorage.getItem('readme-state') ?? 'null'),
        setState: (value) => localStorage.setItem('readme-state', JSON.stringify(value)),
        postMessage: () => Promise.resolve(true),
      });
    });
    await page.clock.install({ time: new Date('2026-07-20T12:00:00.000Z') });
    await page.goto(`${baseUrl}/${view}`);
    await page.locator('.provider-tabs').waitFor();
    const screenshot = { animations: 'disabled', caret: 'hide' };
    if (view === 'claude') {
      await expect(page.locator('#today .summary-grid')).not.toContainText('$0.00');
      await page.screenshot({ ...screenshot, path: resolve(v231Output, 'claude-today-zh-CN-dark.png') });
    } else if (view === 'codex') {
      await page.locator('#tab-month').click();
      await expect(page.locator('#month')).toContainText('未缓存用量');
      await page.screenshot({ ...screenshot, path: resolve(v231Output, 'codex-overview-zh-CN-dark.png') });
    } else if (view === 'weekly') {
      await page.locator('#tab-all').click();
      const panel = page.locator('#all .daily-breakdown').filter({
        hasText: 'Weekly subscription allowance · API-equivalent estimate · Codex',
      });
      await expect(panel.locator('.weekly-value-details')).not.toHaveAttribute('open', '');
      await expect(panel.locator('.seg-cache-read')).not.toHaveCount(0);
      await panel.screenshot({ ...screenshot, path: resolve(v231Output, 'codex-weekly-estimate-en-dark.png') });
    } else if (view === 'compare') {
      const panel = page.locator('.combined-heatmap-panel');
      await expect(panel.locator('#combinedHeatmapIntensityMode')).toHaveValue('quantile');
      await expect(panel.locator('.combined-config-card')).toBeVisible();
      await panel.screenshot({ ...screenshot, path: resolve(v231Output, 'compare-heatmap-en-light.png') });
    } else {
      await page.locator('#tab-projects').click();
      const panel = page.locator('#projects [data-project-matrix="claude"]');
      await expect(panel).toBeVisible();
      await expect(panel.locator('[data-project-matrix-range="30"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.locator('[data-project-matrix-view="heatmap"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.locator('.project-matrix-cell[data-tokens]:not([data-tokens="0"])').first()).toBeVisible();
      await panel.screenshot({ ...screenshot, path: resolve(v232Output, 'project-activity-matrix-en-dark.png') });
    }
    console.log(`Captured ${view}: production renderer, synthetic fixture, ${options.theme}`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
