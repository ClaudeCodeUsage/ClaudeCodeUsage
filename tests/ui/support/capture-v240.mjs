// Reproducible synthetic documentation captures from the production renderer.
// These are not evidence of an installed VSIX or a user's actual usage.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { renderHarness } = require('./render-harness.cjs');
const fixtureNow = Date.parse('2026-07-20T12:00:00.000Z');
const output = resolve('images/v2.4.0');
const views = {
  compare: { provider: 'compare', locale: 'en', theme: 'light', fixture: 'combined-heatmap', width: 1280 },
  claude: { provider: 'claude', locale: 'zh-CN', theme: 'dark', fixture: 'combined-heatmap', claudeOnly: true, commandTemplate: 'claudeShareCard', width: 1280 },
  codex: { provider: 'codex', locale: 'zh-CN', theme: 'dark', fixture: 'default', width: 1280 },
  narrow: { provider: 'compare', locale: 'de-DE', theme: 'dark', fixture: 'combined-heatmap', width: 360 },
};
const server = createServer(async (request, response) => {
  const options = views[request.url?.slice(1)];
  if (!options) { response.writeHead(404); response.end(); return; }
  const NativeDate = Date;
  try {
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
const browser = await chromium.launch();
try {
  await mkdir(output, { recursive: true });
  for (const [view, options] of Object.entries(views)) {
    const context = await browser.newContext({
      viewport: { width: options.width, height: 900 },
      deviceScaleFactor: 1,
      locale: options.locale,
      timezoneId: 'Asia/Hong_Kong',
      reducedMotion: 'reduce',
      colorScheme: options.theme,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage: () => Promise.resolve(true),
      });
    });
    await page.clock.install({ time: new Date(fixtureNow) });
    await page.goto(`http://127.0.0.1:${server.address().port}/${view}`);
    const screenshot = { animations: 'disabled', caret: 'hide' };
    if (view === 'codex') {
      await page.locator('#tab-month').click();
      await expect(page.locator('#month')).toContainText('未缓存用量');
      await page.screenshot({ ...screenshot, path: resolve(output, 'codex-month-zh-CN-dark.png') });
    } else {
      if (view === 'claude') {
        await page.locator('#tab-all').click();
        await expect(page.locator('[data-sharing-presentation="claudeShareCard"]')).toBeVisible();
      } else {
        await expect(page.locator('[data-sharing-presentation="combinedHeatmap"]')).toBeVisible();
      }
      await page.locator('.sharing-workspace').screenshot({
        ...screenshot,
        path: resolve(output, `${view}-sharing-${options.locale}-${options.theme}.png`),
      });
    }
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
