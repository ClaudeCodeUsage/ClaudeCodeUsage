// Local diagnostic, not a pass/fail test or an installed-VSIX measurement.
// Usage: node tests/ui/support/measure-scroll-refresh.mjs BASE_ROOT CANDIDATE_ROOT
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const roots = process.argv.slice(2).map((root) => resolve(root));
if (roots.length !== 2) throw new Error('Pass baseline and candidate checkout roots');
const fixtureNow = Date.parse('2026-07-20T12:00:00.000Z');
const browser = await chromium.launch();

async function measure(root) {
  const require = createRequire(resolve(root, 'package.json'));
  const { renderHarness } = require(resolve(root, 'tests/ui/support/render-harness.cjs'));
  const NativeDate = Date;
  let html;
  try {
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixtureNow])); }
      static now() { return fixtureNow; }
    };
    html = await renderHarness({ provider: 'codex', locale: 'en', theme: 'dark', fixture: 'default', autoRefresh: false });
  } finally {
    globalThis.Date = NativeDate;
  }
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const trials = [];
    for (let trial = 0; trial < 3; trial += 1) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 420 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__ccuAcks = [];
        window.acquireVsCodeApi = () => ({
          getState: () => undefined,
          setState: () => undefined,
          postMessage: (message) => { if (message.command === 'dashboardDataPatchAck') window.__ccuAcks.push(message); },
        });
      });
      await page.clock.install({ time: new Date(fixtureNow) });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const result = await page.evaluate(async () => {
        const panel = document.getElementById('provider-panel');
        if (!panel) throw new Error('Provider panel did not render');
        const filler = document.createElement('div');
        filler.style.height = '1600px';
        panel.appendChild(filler);
        const patchHtml = panel.innerHTML;
        let swaps = 0;
        const observer = new MutationObserver((records) => {
          swaps += records.filter((record) => record.type === 'childList').length;
        });
        observer.observe(panel, { childList: true });
        scrollTo(0, 160);
        let dispatchMs = 0;
        for (let revision = 1; revision <= 20; revision += 1) {
          window.dispatchEvent(new Event('scroll'));
          const start = performance.now();
          window.dispatchEvent(new MessageEvent('message', { data: {
            command: 'dashboardDataPatch', provider: 'codex', tab: 'today', revision,
            html: patchHtml, claudeLast30HoursByDay: {},
          } }));
          dispatchMs += performance.now() - start;
          await new Promise((done) => setTimeout(done, 25));
        }
        await new Promise((done) => setTimeout(done, 650));
        observer.disconnect();
        return { swaps, dispatchMs: Number(dispatchMs.toFixed(1)), acks: window.__ccuAcks.map((ack) => ack.revision) };
      });
      trials.push(result);
      await context.close();
    }
    return { root, trials };
  } finally {
    await new Promise((done) => server.close(done));
  }
}

try {
  for (const root of roots) process.stdout.write(`${JSON.stringify(await measure(root))}\n`);
} finally {
  await browser.close();
}
