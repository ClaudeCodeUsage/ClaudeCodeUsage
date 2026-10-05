// Review composition from bundled artwork, not an installed-VSIX screenshot.
// npm run compile && node tests/ui/support/capture-achievement-catalog.mjs
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { achievementCatalog, renderCatalogGroup, renderCatalogMarkdown } = require('./achievement-catalog.cjs');
const output = resolve('test-results/v242-mobile-review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 440, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.route('**/*', (route) => route.abort());
  for (const locale of ['zh-CN', 'en']) {
    const catalog = achievementCatalog(locale);
    await writeFile(resolve(output, `catalog.${locale}.md`), renderCatalogMarkdown(catalog, locale));
    for (const group of ['claude', 'codex', 'combined', 'plugin']) {
      const html = renderCatalogGroup(catalog, group, locale);
      await writeFile(resolve(output, `${group}.${locale}.html`), html);
      if (locale !== 'zh-CN') continue;
      await page.setContent(html);
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
      await expect(page.locator('article')).toHaveCount(catalog.filter((card) => card.group === group).length);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(440);
      for (const heading of await page.locator('h2').all()) {
        expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await page.locator('main').screenshot({ path: resolve(output, `${group}.zh-CN.png`), animations: 'disabled' });
    }
  }
  await context.close();
} finally {
  await browser.close();
}
console.log(`Saved four mobile catalog sheets and bilingual reference: ${output}`);
